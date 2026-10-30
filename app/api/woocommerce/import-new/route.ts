import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Importeert WooCommerce-producten die NOG NIET in de lokale database staan (gematcht op SKU) en maakt ze
// lokaal aan (product + varianten), zodat je ze in de app kunt beheren en daarna terug kunt synchroniseren.
// De prijs wordt als startwaarde overgenomen uit WooCommerce; verfijn de kostprijsberekening daarna in de app.
// De techniek (process_type) wordt geraden uit de categorie en kan je achteraf aanpassen.
//
// In batches (limit per aanvraag) zodat één aanvraag ruim onder de Cloudflare-limiet van 100s blijft.
// Vereist WOOCOMMERCE_URL / _CONSUMER_KEY / _CONSUMER_SECRET en een ingelogde sessie.

type WooCategory = { id: number; name: string; slug: string; parent: number };

function guessProcessType(categories: string): string {
  const c = categories.toLowerCase();
  if (c.includes("laser") && c.includes("engrav")) return "laser_engraving";
  if (c.includes("laser")) return "laser_cutting";
  if (c.includes("sublim")) return "sublimation";
  if (c.includes("uv")) return "uv_print";
  if (c.includes("resin")) return "resin_print";
  return "3d_print";
}

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
  // Optioneel beperken tot één techniek (het actieve tabblad). De techniek wordt geraden uit de categorie.
  const type: string | undefined = typeof body.type === "string" && body.type !== "all" ? body.type : undefined;

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const wcGet = async (path: string) => {
    const res = await fetch(`${base}/wp-json/wc/v3${path}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`WooCommerce ${res.status} bij ${path}`);
    return res.json();
  };

  // Lokale SKU's (zowel producten als varianten, zodat we niets dubbel aanmaken)
  const { data: localProducts, error: lpErr } = await supabase.from("products").select("sku");
  if (lpErr) return NextResponse.json({ error: lpErr.message }, { status: 500 });
  const localSkus = new Set((localProducts ?? []).map((p: any) => p.sku));

  // Categorie-paden (id -> "Parent > Kind")
  const categoryMap = new Map<number, string>();
  try {
    const all: WooCategory[] = [];
    for (let page = 1; ; page++) {
      const cats: WooCategory[] = await wcGet(`/products/categories?per_page=100&page=${page}`);
      all.push(...cats);
      if (cats.length < 100) break;
    }
    const byId = new Map(all.map((c) => [c.id, c]));
    const buildPath = (c: WooCategory): string => (c.parent === 0 ? c.name : `${buildPath(byId.get(c.parent) ?? c)} > ${c.name}`);
    for (const c of all) categoryMap.set(c.id, buildPath(c));
  } catch (e: any) {
    return NextResponse.json({ error: `Categorieën ophalen mislukt: ${e.message}` }, { status: 500 });
  }

  // Alle WooCommerce-producten
  const wcProducts: any[] = [];
  try {
    for (let page = 1; ; page++) {
      const chunk = await wcGet(`/products?per_page=100&page=${page}`);
      wcProducts.push(...chunk);
      if (chunk.length < 100) break;
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Producten ophalen mislukt: ${e.message}` }, { status: 500 });
  }

  const catPath = (wp: any): string =>
    (wp.categories || []).map((c: any) => categoryMap.get(c.id)).filter((x: any): x is string => !!x).join(", ");
  let missing = wcProducts.filter((p) => p.sku && !localSkus.has(p.sku));
  if (type) missing = missing.filter((p) => guessProcessType(catPath(p)) === type);
  const report = { created: [] as string[], errors: [] as string[] };

  if (dryRun) {
    return NextResponse.json({ dryRun: true, count: missing.length, toCreate: missing.map((p) => `${p.name} (${p.sku})`) });
  }

  const batch = missing.slice(0, limit);
  for (const wp of batch) {
    try {
      const categories = catPath(wp);
      const attrNames = (wp.attributes || []).filter((a: any) => a.variation).map((a: any) => a.name);
      const defaults: Record<string, string> = {};
      for (const da of wp.default_attributes || []) {
        const a = (wp.attributes || []).find((x: any) => x.id === da.id || x.name === da.name);
        if (a && da.option) defaults[a.name] = da.option;
      }
      // komt uit de shop, dus meteen "gesynct": anders toont Producten het als "Nieuw" (nog nooit naar WooCommerce)
      const now = new Date().toISOString();
      const productRow = {
        sku: wp.sku,
        updated_at: now,
        last_exported_at: now,
        last_exported_published: wp.status === "publish",
        name: wp.name || wp.sku,
        process_type: guessProcessType(categories),
        published: wp.status === "publish",
        attribute_names: attrNames,
        default_attribute_values: defaults,
        description: wp.description || "",
        categories,
        image_url: (wp.images || []).map((i: any) => i.src).filter(Boolean).join(", "),
        weight_kg: wp.weight && wp.weight !== "" ? parseFloat(wp.weight) : null,
        shipping_class: wp.shipping_class || "",
      };
      const { data: inserted, error: insErr } = await supabase.from("products").insert(productRow).select("id").single();
      if (insErr || !inserted) throw new Error(insErr?.message || "aanmaken product mislukt");
      const productId = inserted.id;

      let variationRows: any[];
      if (wp.type === "variable") {
        const rvs: any[] = [];
        for (let page = 1; ; page++) {
          const chunk = await wcGet(`/products/${wp.id}/variations?per_page=100&page=${page}`);
          rvs.push(...chunk);
          if (chunk.length < 100) break;
        }
        variationRows = rvs
          .filter((rv) => rv.sku)
          .map((rv) => ({
            product_id: productId,
            sku: rv.sku,
            attribute_values: Object.fromEntries((rv.attributes || []).map((a: any) => [a.name, a.option]).filter(([, o]: [string, string]) => !!o)),
            suggested_price: rv.price && rv.price !== "" ? parseFloat(rv.price) : null,
            exported_price: rv.price && rv.price !== "" ? parseFloat(rv.price) : null,
            image_url: rv.image?.src || null,
          }));
      } else {
        // Simpel product: één variant-rij die de prijs draagt (zo modelleert de app dat).
        variationRows = [{ product_id: productId, sku: wp.sku, attribute_values: {}, suggested_price: wp.price && wp.price !== "" ? parseFloat(wp.price) : null, exported_price: wp.price && wp.price !== "" ? parseFloat(wp.price) : null, image_url: null }];
      }
      if (variationRows.length > 0) {
        const { error: vErr } = await supabase.from("product_variations").insert(variationRows);
        if (vErr) throw new Error(`varianten: ${vErr.message}`);
      }
      report.created.push(`${wp.name} (${wp.sku})`);
    } catch (e: any) {
      report.errors.push(`${wp.sku}: ${e.message}`);
    }
  }

  const done = missing.length <= limit;
  return NextResponse.json({ dryRun: false, totalMissing: missing.length, created: report.created, errors: report.errors, remaining: Math.max(0, missing.length - report.created.length), done });
}
