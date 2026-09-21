import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Verwijdert een product uit WooCommerce op basis van SKU
// Vereist server-side omgevingsvariabelen:
//   WOOCOMMERCE_URL
//   WOOCOMMERCE_CONSUMER_KEY
//   WOOCOMMERCE_CONSUMER_SECRET

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

  const body = await request.json();
  const { sku } = body;

  if (!sku) {
    return NextResponse.json({ error: "SKU is vereist." }, { status: 400 });
  }

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");

  try {
    console.log(`[WooCommerce Delete] Zoeken naar product met SKU: ${sku}`);

    // Zoek het product in WooCommerce op basis van SKU
    const res = await fetch(`${base}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`, {
      headers: { Authorization: auth }
    });

    if (!res.ok) {
      throw new Error(`WooCommerce API error: ${res.status}`);
    }

    const found = await res.json();
    const product = found?.[0];

    if (!product) {
      console.log(`[WooCommerce Delete] Product ${sku} niet gevonden in WooCommerce`);
      return NextResponse.json({
        deleted: false,
        message: "Product niet gevonden in WooCommerce"
      });
    }

    console.log(`[WooCommerce Delete] Product gevonden: ${product.name} (ID: ${product.id})`);

    // Verwijder het product (force=true zorgt ervoor dat het permanent verwijderd wordt)
    const deleteRes = await fetch(`${base}/wp-json/wc/v3/products/${product.id}?force=true`, {
      method: "DELETE",
      headers: { Authorization: auth }
    });

    if (!deleteRes.ok) {
      throw new Error(`Verwijderen mislukt: ${deleteRes.status}`);
    }

    console.log(`[WooCommerce Delete] Product ${sku} succesvol verwijderd uit WooCommerce`);

    return NextResponse.json({
      deleted: true,
      message: `Product "${product.name}" verwijderd uit WooCommerce`,
      productId: product.id
    });

  } catch (e: any) {
    console.error(`[WooCommerce Delete] Fout bij verwijderen van ${sku}:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
