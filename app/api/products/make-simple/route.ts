import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Maakt variabele producten SIMPEL (zonder varianten) -- zowel in de lokale database als in WooCommerce.
// Voor producten die per vergissing als variabel staan (bv. laser cutting zonder maat/kleur).
//  - Lokaal: houdt één variant-rij over (die de prijs draagt), maakt die attribuutloos, en zet
//    attribute_names/default_attribute_values leeg -> isSimple() = true.
//  - WooCommerce: verwijdert de varianten, zet het product op type 'simple' met een regular_price.
// In batches (limit) + dry-run. Scope via process_type (type) of productIds. DESTRUCTIEF: varianten worden
// verwijderd, daarom gebruikt de UI eerst een dry-run-preview met bevestiging.

export async function POST(request: Request) {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!base || !key || !secret) {
    return NextResponse.json({ error: "WooCommerce is niet gekoppeld: stel WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY en WOOCOMMERCE_CONSUMER_SECRET in." }, { status: 501 });
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
  const dryRun = body.dryRun === true;
  const limit = Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : 10;
  const type: string | undefined = typeof body.type === "string" && body.type !== "all" ? body.type : undefined;
  const productIds: string[] | undefined = Array.isArray(body.productIds) && body.productIds.length ? body.productIds : undefined;

  let query = supabase.from("products").select("id, sku, name, attribute_names, process_type, product_variations(id, sku, suggested_price)");
  if (type) query = query.eq("process_type", type);
  if (productIds) query = query.in("id", productIds);
  const { data: products, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "variabel" = heeft attributen of meer dan één variant-rij
  const targets = (products ?? []).filter((p: any) => (p.attribute_names?.length ?? 0) > 0 || (p.product_variations?.length ?? 0) > 1);

  if (dryRun) {
    return NextResponse.json({ dryRun: true, count: targets.length, toConvert: targets.map((p: any) => `${p.name} (${p.sku})`) });
  }

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const wc = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}/wp-json/wc/v3${path}`, { ...init, headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`WooCommerce ${res.status} bij ${path}`);
    return res.json();
  };

  const report = { converted: [] as string[], errors: [] as string[] };
  const batch = targets.slice(0, limit);
  for (const p of batch as any[]) {
    try {
      const variations = (p.product_variations ?? []) as { id: string; sku: string; suggested_price: number | null }[];
      const keep = variations.find((v) => v.suggested_price != null) ?? variations[0];
      const price = keep?.suggested_price != null ? Number(keep.suggested_price).toFixed(2) : null;

      // --- LOKAAL ---
      const toDelete = variations.filter((v) => keep && v.id !== keep.id).map((v) => v.id);
      if (toDelete.length) {
        const { error: delErr } = await supabase.from("product_variations").delete().in("id", toDelete);
        if (delErr) throw new Error(`varianten verwijderen (lokaal): ${delErr.message}`);
      }
      if (keep) {
        const { error: upErr } = await supabase.from("product_variations").update({ attribute_values: {} }).eq("id", keep.id);
        if (upErr) throw new Error(`variant bijwerken (lokaal): ${upErr.message}`);
      }
      const { error: pErr } = await supabase.from("products").update({ attribute_names: [], default_attribute_values: {} }).eq("id", p.id);
      if (pErr) throw new Error(`product bijwerken (lokaal): ${pErr.message}`);

      // --- WOOCOMMERCE ---
      const found = await wc(`/products?sku=${encodeURIComponent(p.sku)}`);
      const wp = found?.[0];
      if (wp) {
        if (wp.type === "variable") {
          const rvs: any[] = [];
          for (let page = 1; ; page++) {
            const chunk = await wc(`/products/${wp.id}/variations?per_page=100&page=${page}`);
            rvs.push(...chunk);
            if (chunk.length < 100) break;
          }
          if (rvs.length) await wc(`/products/${wp.id}/variations/batch`, { method: "POST", body: JSON.stringify({ delete: rvs.map((r) => r.id) }) });
        }
        await wc(`/products/${wp.id}`, { method: "PUT", body: JSON.stringify({ type: "simple", attributes: [], ...(price != null ? { regular_price: price } : {}) }) });
      }

      report.converted.push(`${p.name} (${p.sku})`);
    } catch (e: any) {
      report.errors.push(`${p.sku}: ${e.message}`);
    }
  }

  const done = targets.length <= limit;
  return NextResponse.json({ dryRun: false, totalTargets: targets.length, converted: report.converted, errors: report.errors, done });
}
