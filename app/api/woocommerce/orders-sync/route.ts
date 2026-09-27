import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Haalt WooCommerce-bestellingen (en hun regels) op en bewaart ze lokaal, voor de Bestellingen-
// rapportagepagina (omzet/aantal orders per maand, meest bestelde producten). Bron van waarheid blijft
// WooCommerce -- dit is puur een lokale kopie voor snelle grafieken.
//
// Incrementeel: onthoudt de laatst geziene wijzigingsdatum in de bestaande "settings"-tabel
// (key "last_order_sync_at") en haalt bij een volgende sync enkel nieuwe/gewijzigde bestellingen op.
// Body { full: true } negeert die cursor en haalt de volledige historiek opnieuw op (upsert op
// wc_order_id, dus onschadelijk om te herhalen).
//
// Vereist server-side omgevingsvariabelen (nooit NEXT_PUBLIC_, de sleutels mogen niet naar de browser):
//   WOOCOMMERCE_URL
//   WOOCOMMERCE_CONSUMER_KEY
//   WOOCOMMERCE_CONSUMER_SECRET
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).
//
// Body (JSON, optioneel): { full?: boolean }

export const maxDuration = 300; // een volledige historiek kan even duren -- vraagt Vercel om meer tijd (plan-afhankelijk begrensd)

const SYNC_CURSOR_KEY = "last_order_sync_at";

type Report = {
  fetched: number;
  upserted: number;
  errors: string[];
};

export async function POST(request: Request) {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;

  if (!base || !key || !secret) {
    return NextResponse.json(
      { error: "WooCommerce is niet gekoppeld: stel WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY en WOOCOMMERCE_CONSUMER_SECRET in." },
      { status: 501 }
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const full = body?.full === true;
  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");

  let modifiedAfter: string | null = null;
  if (!full) {
    const { data: setting } = await supabase.from("settings").select("value").eq("key", SYNC_CURSOR_KEY).maybeSingle();
    if (typeof setting?.value === "string") {
      // Kleine overlap van 1 minuut zodat een bestelling die net op de grens gewijzigd werd niet gemist
      // wordt -- een al gekende bestelling opnieuw verwerken is onschadelijk (upsert op wc_order_id).
      modifiedAfter = new Date(new Date(setting.value).getTime() - 60_000).toISOString();
    }
  }

  const report: Report = { fetched: 0, upserted: 0, errors: [] };
  let latestModified = modifiedAfter;

  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const params = new URLSearchParams({ per_page: "100", page: String(page), orderby: "date", order: "asc", status: "any" });
    if (modifiedAfter) params.set("modified_after", modifiedAfter);

    let orders: any[];
    try {
      const res = await fetch(`${base}/wp-json/wc/v3/orders?${params}`, { headers: { Authorization: auth } });
      if (!res.ok) throw new Error(`WooCommerce API error: ${res.status}`);
      orders = await res.json();
    } catch (e: any) {
      report.errors.push(`Bestellingen ophalen (pagina ${page}) mislukt: ${e.message}`);
      break;
    }
    if (orders.length === 0) break;
    report.fetched += orders.length;

    const orderRows = orders.map((o) => ({
      wc_order_id: o.id,
      order_number: String(o.number ?? o.id),
      status: o.status,
      currency: o.currency,
      total: parseFloat(o.total) || 0,
      date_created: `${o.date_created_gmt}Z`,
      date_modified: `${o.date_modified_gmt}Z`,
    }));

    const { data: upserted, error: upsertError } = await supabase
      .from("wc_orders")
      .upsert(orderRows, { onConflict: "wc_order_id" })
      .select("id, wc_order_id");
    if (upsertError) {
      report.errors.push(`Bestellingen opslaan (pagina ${page}) mislukt: ${upsertError.message}`);
    } else {
      const idByWcId = new Map((upserted ?? []).map((r: any) => [r.wc_order_id as number, r.id as string]));
      const orderIds = Array.from(idByWcId.values());

      // Regels worden bij elke (her)sync volledig vervangen -- eenvoudiger en correcter dan proberen
      // te "diffen" (WooCommerce laat toe om regels van een bestelling achteraf te wijzigen).
      if (orderIds.length > 0) {
        await supabase.from("wc_order_items").delete().in("order_id", orderIds);
      }
      const itemRows = orders.flatMap((o) => {
        const orderId = idByWcId.get(o.id);
        if (!orderId) return [];
        return (o.line_items ?? []).map((li: any) => ({
          order_id: orderId,
          wc_product_id: li.product_id || null,
          wc_variation_id: li.variation_id || null,
          sku: li.sku || null,
          name: li.name,
          quantity: li.quantity,
          total: parseFloat(li.total) || 0,
        }));
      });
      if (itemRows.length > 0) {
        const { error: itemsError } = await supabase.from("wc_order_items").insert(itemRows);
        if (itemsError) report.errors.push(`Bestelregels opslaan (pagina ${page}) mislukt: ${itemsError.message}`);
      }
      report.upserted += idByWcId.size;
    }

    for (const o of orders) {
      const modified = `${o.date_modified_gmt}Z`;
      if (!latestModified || modified > latestModified) latestModified = modified;
    }

    hasMore = orders.length === 100;
    page++;
  }

  if (latestModified) {
    await supabase.from("settings").upsert({ key: SYNC_CURSOR_KEY, value: latestModified });
  }

  return NextResponse.json(report);
}
