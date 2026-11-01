import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// "Uitgelicht" (het sterretje in WooCommerce > Producten). De homepage toont deze producten in
// "Populair in de shop". De beheertool bewaart dit bewust NIET zelf: WooCommerce is de enige bron,
// zodat een sterretje dat in wp-admin gezet wordt nooit door een sync overschreven wordt.
//   GET  /api/woocommerce/featured                       -> { products: [{ id, sku, name }] }
//   POST /api/woocommerce/featured { sku, featured }     -> zet/verwijdert de ster op het product met die SKU
// Vereist WOOCOMMERCE_URL / _CONSUMER_KEY / _CONSUMER_SECRET en een ingelogde sessie.

async function guard(request: Request) {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!base || !key || !secret) {
    return { error: NextResponse.json({ error: "WooCommerce is niet gekoppeld." }, { status: 501 }) };
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "Niet ingelogd." }, { status: 401 }) };
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 }) };
  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  return { base, auth };
}

export async function GET(request: Request) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  try {
    const products: { id: number; sku: string; name: string }[] = [];
    for (let page = 1; page <= 10; page++) {
      const q = new URLSearchParams({ featured: "true", status: "any", per_page: "100", page: String(page), _fields: "id,sku,name" });
      const res = await fetch(`${g.base}/wp-json/wc/v3/products?${q}`, { headers: { Authorization: g.auth }, cache: "no-store" });
      if (!res.ok) throw new Error(`WooCommerce API error: ${res.status}`);
      const rows = await res.json();
      products.push(...rows);
      if (rows.length < 100) break;
    }
    return NextResponse.json({ products });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { sku, featured } = await request.json().catch(() => ({}));
  if (!sku || typeof featured !== "boolean") {
    return NextResponse.json({ error: "sku en featured (true/false) zijn vereist." }, { status: 400 });
  }
  try {
    const res = await fetch(`${g.base}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&status=any&_fields=id`, {
      headers: { Authorization: g.auth }, cache: "no-store",
    });
    if (!res.ok) throw new Error(`WooCommerce API error: ${res.status}`);
    const found = await res.json();
    if (!found?.[0]) {
      return NextResponse.json({ error: `Dit product (SKU ${sku}) staat nog niet in WooCommerce. Synchroniseer het eerst.` }, { status: 404 });
    }
    const put = await fetch(`${g.base}/wp-json/wc/v3/products/${found[0].id}`, {
      method: "PUT",
      headers: { Authorization: g.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ featured }),
    });
    if (!put.ok) throw new Error(`WooCommerce API error: ${put.status}`);
    const saved = await put.json();
    return NextResponse.json({ id: saved.id, featured: saved.featured });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
