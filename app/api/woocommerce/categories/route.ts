import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Haalt alle WooCommerce categorieën op via de REST API
// Vereist server-side omgevingsvariabelen:
//   WOOCOMMERCE_URL
//   WOOCOMMERCE_CONSUMER_KEY
//   WOOCOMMERCE_CONSUMER_SECRET
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).

type WooCategory = {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
};

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
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });
  }

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");

  try {
    const allCategories: WooCategory[] = [];
    let page = 1;
    let hasMore = true;

    // WooCommerce API pagineert met max 100 items per pagina
    while (hasMore) {
      const res = await fetch(`${base}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`, {
        headers: { Authorization: auth }
      });

      if (!res.ok) {
        throw new Error(`WooCommerce API error: ${res.status}`);
      }

      const categories: WooCategory[] = await res.json();
      allCategories.push(...categories);

      // Check if there are more pages
      hasMore = categories.length === 100;
      page++;
    }

    // Bouw hiërarchische paden op (bv. "Woondecoratie > Vazen")
    const categoryMap = new Map(allCategories.map(c => [c.id, c]));
    const paths: string[] = [];

    function buildPath(cat: WooCategory): string {
      if (cat.parent === 0) return cat.name;
      const parent = categoryMap.get(cat.parent);
      if (!parent) return cat.name;
      return `${buildPath(parent)} > ${cat.name}`;
    }

    for (const cat of allCategories) {
      paths.push(buildPath(cat));
    }

    // Sorteer alfabetisch
    paths.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ categories: paths });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
