import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Haalt alle WooCommerce product attributen op via de REST API, inclusief hun waarden (terms)
// Vereist server-side omgevingsvariabelen:
//   WOOCOMMERCE_URL
//   WOOCOMMERCE_CONSUMER_KEY
//   WOOCOMMERCE_CONSUMER_SECRET
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).

type WooAttribute = {
  id: number;
  name: string;
  slug: string;
  type: string;
  order_by: string;
  has_archives: boolean;
};

type WooAttributeTerm = {
  id: number;
  name: string;
  slug: string;
  description: string;
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
    // Haal alle attributen op
    const res = await fetch(`${base}/wp-json/wc/v3/products/attributes?per_page=100`, {
      headers: { Authorization: auth }
    });

    if (!res.ok) {
      throw new Error(`WooCommerce API error: ${res.status}`);
    }

    const attributes: WooAttribute[] = await res.json();

    // Voor elk attribuut, haal de waarden (terms) op
    const attributesWithTerms = await Promise.all(
      attributes.map(async (attr) => {
        try {
          const termsRes = await fetch(`${base}/wp-json/wc/v3/products/attributes/${attr.id}/terms?per_page=100`, {
            headers: { Authorization: auth }
          });

          if (!termsRes.ok) {
            console.warn(`Could not fetch terms for attribute ${attr.name}`);
            return { name: attr.name, terms: [] };
          }

          const terms: WooAttributeTerm[] = await termsRes.json();
          return {
            name: attr.name,
            terms: terms.map(t => t.name).sort()
          };
        } catch (e) {
          console.warn(`Error fetching terms for attribute ${attr.name}:`, e);
          return { name: attr.name, terms: [] };
        }
      })
    );

    // Sorteer attributen alfabetisch
    attributesWithTerms.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ attributes: attributesWithTerms });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
