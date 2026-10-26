import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Zoekt producten in WooCommerce (enkel lezen), om een catalogusmodel aan een bestaand shopproduct te koppelen.
//   GET /api/woocommerce/products?search=banshee   -> zoekt op naam/SKU (max. 20 resultaten)
//   GET /api/woocommerce/products?search=1103      -> een getal = product-id
// Vereist WOOCOMMERCE_URL / _CONSUMER_KEY / _CONSUMER_SECRET en een ingelogde sessie.

type WooProduct = {
  id: number;
  name: string;
  sku: string;
  status: string;
  permalink: string;
  images?: { src: string }[];
};

const FIELDS = "id,name,sku,status,permalink,images";

export async function GET(request: Request) {
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

  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
  if (!search) return NextResponse.json({ products: [] });

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  try {
    let rows: WooProduct[];
    if (/^\d+$/.test(search)) {
      const res = await fetch(`${base}/wp-json/wc/v3/products/${search}?_fields=${FIELDS}`, { headers: { Authorization: auth } });
      rows = res.ok ? [await res.json()] : [];
    } else {
      const q = new URLSearchParams({ search, per_page: "20", status: "any", _fields: FIELDS });
      const res = await fetch(`${base}/wp-json/wc/v3/products?${q}`, { headers: { Authorization: auth } });
      if (!res.ok) throw new Error(`WooCommerce API error: ${res.status}`);
      rows = await res.json();
    }
    return NextResponse.json({
      products: rows.map((p) => ({
        id: p.id, name: p.name, sku: p.sku, status: p.status, permalink: p.permalink, image: p.images?.[0]?.src ?? null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
