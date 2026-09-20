import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Synchroniseert de verkoopprijzen (suggested_price) van BESTAANDE producten rechtstreeks naar
// WooCommerce via de REST API, zonder CSV-import. Producten die nog niet in de shop bestaan
// worden niet aangemaakt maar gerapporteerd -- die importeer je eenmalig via de CSV-export.
//
// Vereist server-side omgevingsvariabelen (nooit NEXT_PUBLIC_, de sleutels mogen niet naar de browser):
//   WOOCOMMERCE_URL              bv. https://jouwshop.be
//   WOOCOMMERCE_CONSUMER_KEY     WooCommerce > Instellingen > Geavanceerd > REST API (lezen/schrijven)
//   WOOCOMMERCE_CONSUMER_SECRET
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).
//
// Body (JSON, optioneel): { type?: string, dryRun?: boolean }

type Report = { updated: number; unchanged: number; missingProducts: string[]; missingVariations: string[]; errors: string[] };

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
  if (userError || !userData.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type: string | undefined = body.type;
  const dryRun = body.dryRun === true;

  let query = supabase.from("products").select("id, sku, name, product_variations(id, sku, suggested_price)").order("name");
  if (type) query = query.eq("process_type", type);
  const { data: products, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const wc = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}/wp-json/wc/v3${path}`, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`WooCommerce ${res.status} bij ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  const report: Report = { updated: 0, unchanged: 0, missingProducts: [], missingVariations: [], errors: [] };

  for (const p of (products ?? []) as any[]) {
    try {
      const found = await wc(`/products?sku=${encodeURIComponent(p.sku)}`);
      const parent = found?.[0];
      if (!parent) {
        report.missingProducts.push(p.sku);
        continue;
      }
      const remote = new Map<string, { id: number; regular_price: string }>();
      for (let page = 1; ; page++) {
        const chunk = await wc(`/products/${parent.id}/variations?per_page=100&page=${page}`);
        for (const rv of chunk) remote.set(rv.sku, { id: rv.id, regular_price: rv.regular_price });
        if (chunk.length < 100) break;
      }

      const updates: { id: number; regular_price: string }[] = [];
      const synced: string[] = [];
      for (const v of p.product_variations as { id: string; sku: string; suggested_price: number | null }[]) {
        if (v.suggested_price == null) continue;
        const rv = remote.get(v.sku);
        if (!rv) {
          report.missingVariations.push(v.sku);
          continue;
        }
        const price = Number(v.suggested_price).toFixed(2);
        if (Number(rv.regular_price) === Number(price)) {
          report.unchanged++;
          synced.push(v.id);
          continue;
        }
        updates.push({ id: rv.id, regular_price: price });
        synced.push(v.id);
      }

      if (updates.length > 0 && !dryRun) {
        for (let i = 0; i < updates.length; i += 100) {
          await wc(`/products/${parent.id}/variations/batch`, { method: "POST", body: JSON.stringify({ update: updates.slice(i, i + 100) }) });
        }
      }
      report.updated += updates.length;

      if (!dryRun && synced.length > 0) {
        const now = new Date().toISOString();
        await supabase.from("products").update({ last_exported_at: now }).eq("id", p.id);
        const vs = (p.product_variations as { id: string; suggested_price: number | null }[]).filter((v) => synced.includes(v.id));
        await Promise.all(vs.map((v) => supabase.from("product_variations").update({ exported_price: v.suggested_price }).eq("id", v.id)));
      }
    } catch (e: any) {
      report.errors.push(`${p.sku}: ${e.message}`);
    }
  }

  return NextResponse.json({ dryRun, ...report });
}
