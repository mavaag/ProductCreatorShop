import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// DELETE { id }: verwijdert een collectie uit de beheertool én haar categorie in WooCommerce ("Collecties > <naam>").
// De producten zelf blijven bestaan; WooCommerce haalt de categorie bij die producten automatisch weg.
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).
export async function DELETE(request: Request) {
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
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Geen collectie opgegeven." }, { status: 400 });

  const { data: c, error } = await supabase.from("collections").select("id, name, woo_category_id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!c) return NextResponse.json({ error: "Collectie niet gevonden." }, { status: 404 });

  let wooNote = "";
  if (c.woo_category_id) {
    const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
    const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
    const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
    if (base && key && secret) {
      const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
      // Categorieën hebben geen prullenbak in WooCommerce: force=true is verplicht.
      const res = await fetch(`${base}/wp-json/wc/v3/products/categories/${c.woo_category_id}?force=true`, {
        method: "DELETE",
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        return NextResponse.json({ error: `WooCommerce ${res.status}: categorie niet verwijderd -- ${(await res.text()).slice(0, 200)}` }, { status: 502 });
      }
      wooNote = res.ok ? "categorie in de shop verwijderd" : "categorie stond al niet meer in de shop";
    } else {
      wooNote = "WooCommerce niet gekoppeld: verwijder de categorie zelf in de shop";
    }
  }

  const { error: delError } = await supabase.from("collections").delete().eq("id", id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
  return NextResponse.json({ ok: true, note: wooNote });
}
