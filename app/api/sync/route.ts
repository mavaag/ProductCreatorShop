import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Synchroniseert rechtstreeks met WooCommerce via de REST API, zonder CSV-import:
//   * producten die al in de shop staan (zelfde SKU): update product metadata (naam, beschrijving, categorieën,
//     afbeeldingen, gewicht, verzendklasse, status, attributen) + update de verkoopprijzen (suggested_price)
//     van de varianten
//   * producten die nog niet bestaan: worden enkel aangemaakt als createMissing true is (variabel product met
//     attributen, varianten + prijzen, beschrijving, categorieën, afbeelding(en), gewicht en verzendklasse).
//     Anders worden ze gerapporteerd.
//
// Attributen: als een attribuut (bv. "Kleur") al bestaat als GLOBAAL WooCommerce-attribuut (Producten >
// Attributen), wordt het als zodanig gekoppeld -- een nieuwe waarde ervoor wordt dan automatisch als term
// aangemaakt, zodat ze ook zichtbaar is in de waardenlijst van dat attribuut. Bestaat het attribuut nog
// niet globaal, dan wordt het NIET automatisch aangemaakt: de app maakt zelf geen nieuwe globale attributen
// aan, enkel nieuwe waarden voor een attribuut dat al bestaat. In dat geval blijft het attribuut lokaal
// (per product), zoals voorheen.
//
// Vereist server-side omgevingsvariabelen (nooit NEXT_PUBLIC_, de sleutels mogen niet naar de browser):
//   WOOCOMMERCE_URL              bv. https://jouwshop.be
//   WOOCOMMERCE_CONSUMER_KEY     WooCommerce > Instellingen > Geavanceerd > REST API (lezen/schrijven)
//   WOOCOMMERCE_CONSUMER_SECRET
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).
//
// Body (JSON, optioneel): { type?: string, dryRun?: boolean, createMissing?: boolean }
// dryRun schrijft niets weg (noch in WooCommerce, noch in de database) en meldt wat er zou gebeuren.

type Report = {
  updated: number;
  unchanged: number;
  created: string[]; // SKU's van (te) creëren producten
  notes: string[];
  missingProducts: string[];
  missingVariations: string[];
  errors: string[];
  progress?: { current: number; total: number; productName: string };
};

type WcFn = (path: string, init?: RequestInit) => Promise<any>;

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
  const createMissing = body.createMissing === true;

  let query = supabase
    .from("products")
    .select("id, sku, name, published, attribute_names, description, categories, image_url, weight_kg, shipping_class, product_variations(id, sku, attribute_values, suggested_price)")
    .order("name");
  if (type) query = query.eq("process_type", type);
  const { data: products, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const wc: WcFn = async (path, init) => {
    const res = await fetch(`${base}/wp-json/wc/v3${path}`, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`WooCommerce ${res.status} bij ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  const report: Report = { updated: 0, unchanged: 0, created: [], notes: [], missingProducts: [], missingVariations: [], errors: [] };
  const categoryCache = new Map<string, number>();
  const attributeCache = new Map<string, number>(); // 0 = bevestigd geen globaal attribuut met die naam
  const allProducts = (products ?? []) as any[];
  const total = allProducts.length;

  console.log(`[WooCommerce Sync] Start: ${total} producten te synchroniseren`);

  for (let i = 0; i < allProducts.length; i++) {
    const p = allProducts[i];
    console.log(`[WooCommerce Sync] ${i + 1}/${total}: ${p.name} (${p.sku})`);
    try {
      const found = await wc(`/products?sku=${encodeURIComponent(p.sku)}`);
      const parent = found?.[0];
      if (!parent) {
        if (!createMissing) {
          report.missingProducts.push(p.sku);
          continue;
        }
        if (dryRun) {
          report.created.push(p.sku);
          continue;
        }
        const ok = await createProduct(wc, p, report, categoryCache, attributeCache);
        if (ok) {
          report.created.push(p.sku);
          const now = new Date().toISOString();
          await supabase.from("products").update({ last_exported_at: now }).eq("id", p.id);
          await Promise.all(
            (p.product_variations as { id: string; suggested_price: number | null }[])
              .filter((v) => v.suggested_price != null)
              .map((v) => supabase.from("product_variations").update({ exported_price: v.suggested_price }).eq("id", v.id))
          );
        }
        continue;
      }

      if (isSimple(p)) {
        // Simpel product: de prijs staat op het product zelf, er zijn geen varianten.
        const v = (p.product_variations as { id: string; suggested_price: number | null }[])[0];
        const price = v?.suggested_price != null ? Number(v.suggested_price).toFixed(2) : null;
        const priceChanged = price != null && Number(parent.regular_price) !== Number(price);
        if (!dryRun) {
          const ok = await updateProductMetadata(wc, parent.id, p, report, categoryCache, attributeCache, priceChanged ? price : null);
          if (!ok && priceChanged) {
            report.errors.push(`${p.sku}: prijs niet bijgewerkt (zie opmerkingen)`);
            continue;
          }
        }
        if (price == null) continue;
        if (priceChanged) report.updated++;
        else report.unchanged++;
        if (!dryRun) {
          await supabase.from("products").update({ last_exported_at: new Date().toISOString() }).eq("id", p.id);
          await supabase.from("product_variations").update({ exported_price: v.suggested_price }).eq("id", v.id);
        }
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

      // Update product metadata (naam, beschrijving, categorieën, afbeeldingen, attributen, etc.)
      if (!dryRun) {
        await updateProductMetadata(wc, parent.id, p, report, categoryCache, attributeCache);
      }

      // Update prijzen van varianten
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
      console.error(`[WooCommerce Sync] Fout bij ${p.sku}:`, e.message);
      report.errors.push(`${p.sku}: ${e.message}`);
    }
  }

  console.log(`[WooCommerce Sync] Voltooid: ${report.updated} bijgewerkt, ${report.created.length} aangemaakt, ${report.errors.length} fouten`);

  return NextResponse.json({ dryRun, ...report });
}

/** Een product zonder attributen is een simpel product (WooCommerce type "simple"). */
function isSimple(p: any): boolean {
  return (p.attribute_names?.length ?? 0) === 0;
}

/** Maakt een variabel product met al zijn varianten (of een simpel product) aan in WooCommerce. Geeft true terug als dat gelukt is. */
async function createProduct(wc: WcFn, p: any, report: Report, categoryCache: Map<string, number>, attributeCache: Map<string, number>): Promise<boolean> {
  const attrNames: string[] = p.attribute_names ?? [];
  const variations = p.product_variations as { sku: string; attribute_values: Record<string, string>; suggested_price: number | null }[];

  let attributes: ({ id: number; visible: boolean; variation: boolean; options: string[] } | { name: string; visible: boolean; variation: boolean; options: string[] })[] = [];
  try {
    attributes = await buildProductAttributes(wc, attrNames, variations, attributeCache);
  } catch (e: any) {
    report.notes.push(`${p.sku}: attributen niet gelukt (${e.message})`);
  }

  const categoryIds: { id: number }[] = [];
  for (const path of String(p.categories ?? "").split(",").map((c: string) => c.trim()).filter(Boolean)) {
    try {
      // Haal alle category IDs op (inclusief alle parent categorieën)
      const allIds = await resolveCategoryWithParents(wc, path, categoryCache);
      for (const id of allIds) {
        // Voeg alleen toe als nog niet in de lijst (duplicaten vermijden)
        if (!categoryIds.some(c => c.id === id)) {
          categoryIds.push({ id });
        }
      }
    } catch (e: any) {
      report.notes.push(`${p.sku}: categorie "${path}" niet gelukt (${e.message})`);
    }
  }

  const images = String(p.image_url ?? "").split(",").map((u: string) => u.trim()).filter(Boolean).map((src: string) => ({ src }));

  const simple = isSimple(p);
  const payload: Record<string, unknown> = {
    name: p.name,
    type: simple ? "simple" : "variable",
    sku: p.sku,
    status: p.published ? "publish" : "draft",
    description: p.description ?? "",
    categories: categoryIds,
  };
  if (simple) {
    const price = variations[0]?.suggested_price;
    if (price != null) payload.regular_price = Number(price).toFixed(2);
  } else {
    payload.attributes = attributes;
  }
  if (p.weight_kg != null) payload.weight = String(p.weight_kg);
  if (p.shipping_class) payload.shipping_class = p.shipping_class;

  let created: any;
  try {
    created = await wc("/products", { method: "POST", body: JSON.stringify({ ...payload, images }) });
  } catch (e: any) {
    if (images.length === 0) {
      report.errors.push(`${p.sku}: ${e.message}`);
      return false;
    }
    // WooCommerce weigert het hele product als een afbeelding niet te downloaden is -- probeer zonder.
    try {
      created = await wc("/products", { method: "POST", body: JSON.stringify(payload) });
      report.notes.push(`${p.sku}: aangemaakt zonder afbeelding (${e.message.slice(0, 120)})`);
    } catch (e2: any) {
      report.errors.push(`${p.sku}: ${e2.message}`);
      return false;
    }
  }

  if (simple) return true;

  const toCreate = variations.map((v) => ({
    sku: v.sku,
    ...(v.suggested_price != null ? { regular_price: Number(v.suggested_price).toFixed(2) } : {}),
    attributes: attrNames
      .filter((n) => v.attribute_values?.[n])
      .map((n) => {
        const id = attributeCache.get(n.toLowerCase());
        // Globaal attribuut (id gekend en > 0) -> referentie via id; anders lokaal via naam.
        return id ? { id, option: v.attribute_values[n] } : { name: n, option: v.attribute_values[n] };
      }),
  }));
  try {
    for (let i = 0; i < toCreate.length; i += 100) {
      await wc(`/products/${created.id}/variations/batch`, { method: "POST", body: JSON.stringify({ create: toCreate.slice(i, i + 100) }) });
    }
  } catch (e: any) {
    report.errors.push(`${p.sku}: product aangemaakt maar varianten mislukt (${e.message})`);
    return false;
  }
  return true;
}

/** Update de metadata van een bestaand product in WooCommerce (naam, beschrijving, categorieën, afbeeldingen, attributen, etc.). */
async function updateProductMetadata(
  wc: WcFn,
  productId: number,
  p: any,
  report: Report,
  categoryCache: Map<string, number>,
  attributeCache: Map<string, number>,
  regularPrice: string | null = null // enkel voor simpele producten: nieuwe prijs, of null om ze niet te wijzigen
): Promise<boolean> {
  try {
    // Verzamel categorieën (inclusief parent categorieën)
    const categoryIds: { id: number }[] = [];
    for (const path of String(p.categories ?? "").split(",").map((c: string) => c.trim()).filter(Boolean)) {
      try {
        const allIds = await resolveCategoryWithParents(wc, path, categoryCache);
        for (const id of allIds) {
          if (!categoryIds.some(c => c.id === id)) {
            categoryIds.push({ id });
          }
        }
      } catch (e: any) {
        report.notes.push(`${p.sku}: categorie "${path}" niet gelukt (${e.message})`);
      }
    }

    const images = String(p.image_url ?? "").split(",").map((u: string) => u.trim()).filter(Boolean).map((src: string) => ({ src }));

    const payload: Record<string, unknown> = {
      name: p.name,
      status: p.published ? "publish" : "draft",
      description: p.description ?? "",
      categories: categoryIds,
    };
    if (p.weight_kg != null) payload.weight = String(p.weight_kg);
    if (p.shipping_class) payload.shipping_class = p.shipping_class;
    if (images.length > 0) payload.images = images;
    if (regularPrice != null) payload.regular_price = regularPrice;

    if (!isSimple(p)) {
      // Attributen mee bijwerken: een nieuwe waarde voor een attribuut dat al globaal bestaat, wordt zo
      // alsnog als term aangemaakt en zichtbaar in de waardenlijst van dat attribuut. Bestaat het attribuut
      // zelf nog niet globaal, dan blijft het lokaal (er wordt geen nieuw globaal attribuut aangemaakt).
      try {
        const attrNames: string[] = p.attribute_names ?? [];
        const variations = p.product_variations as { attribute_values: Record<string, string> }[];
        payload.attributes = await buildProductAttributes(wc, attrNames, variations, attributeCache);
      } catch (e: any) {
        report.notes.push(`${p.sku}: attributen niet bijgewerkt (${e.message})`);
      }
    }

    await wc(`/products/${productId}`, { method: "PUT", body: JSON.stringify(payload) });
    console.log(`[WooCommerce Sync] Product ${p.sku} metadata bijgewerkt`);
    return true;
  } catch (e: any) {
    report.notes.push(`${p.sku}: metadata update mislukt (${e.message})`);
    return false;
  }
}

/**
 * Zoekt een BESTAAND globaal WooCommerce-attribuut (Producten > Attributen) op naam op (hoofdletterongevoelig).
 * Maakt zelf GEEN nieuw globaal attribuut aan -- geeft 0 terug als er nog geen attribuut met die naam bestaat,
 * dan blijft het attribuut lokaal (per product), zoals voorheen.
 */
async function resolveGlobalAttribute(wc: WcFn, name: string, cache: Map<string, number>): Promise<number> {
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const found: any[] = await wc(`/products/attributes?per_page=100&search=${encodeURIComponent(name)}`);
  const match = found.find((a) => String(a.name).toLowerCase() === key);
  const id = match?.id ?? 0;
  cache.set(key, id);
  return id;
}

/**
 * Bouwt de attributenlijst van een product op. Een attribuut dat al globaal bestaat in WooCommerce wordt
 * gekoppeld via zijn id -- een nieuwe waarde ervoor wordt door WooCommerce automatisch als term aangemaakt
 * en is dan zichtbaar in de waardenlijst van dat attribuut. Een attribuut dat nog niet globaal bestaat,
 * blijft lokaal (per product), net als voorheen. Attributen zonder ingevulde waarden worden overgeslagen.
 */
async function buildProductAttributes(
  wc: WcFn,
  attrNames: string[],
  variations: { attribute_values: Record<string, string> }[],
  cache: Map<string, number>
): Promise<({ id: number; visible: boolean; variation: boolean; options: string[] } | { name: string; visible: boolean; variation: boolean; options: string[] })[]> {
  const attributes: ({ id: number; visible: boolean; variation: boolean; options: string[] } | { name: string; visible: boolean; variation: boolean; options: string[] })[] = [];
  for (const name of attrNames) {
    const options = Array.from(new Set(variations.map((v) => v.attribute_values?.[name]).filter((x): x is string => !!x && !!x.trim())));
    if (options.length === 0) continue;
    const id = await resolveGlobalAttribute(wc, name, cache);
    attributes.push(id ? { id, visible: true, variation: true, options } : { name, visible: true, variation: true, options });
  }
  return attributes;
}

/** Zoekt een categoriepad zoals "Woondecoratie > Vazen" op (of maakt het aan) en geeft het id van de laatste categorie. */
async function resolveCategory(wc: WcFn, path: string, cache: Map<string, number>): Promise<number> {
  const parts = path.split(">").map((x) => x.trim()).filter(Boolean);
  let parentId = 0;
  let key = "";
  for (const name of parts) {
    key += `/${name.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) {
      parentId = cached;
      continue;
    }
    const found: any[] = await wc(`/products/categories?per_page=100&search=${encodeURIComponent(name)}`);
    const match = found.find((c) => String(c.name).replace(/&amp;/g, "&").toLowerCase() === name.toLowerCase() && Number(c.parent) === parentId);
    const id: number =
      match?.id ?? (await wc("/products/categories", { method: "POST", body: JSON.stringify({ name, ...(parentId ? { parent: parentId } : {}) }) })).id;
    cache.set(key, id);
    parentId = id;
  }
  return parentId;
}

/**
 * Zoekt een categoriepad zoals "3D Printing > KeyChains" op en geeft ALLE category IDs terug,
 * inclusief alle parent categorieën. Bijvoorbeeld: ["3D Printing", "3D Printing > KeyChains"]
 * geeft terug: [id van "3D Printing", id van "KeyChains"]
 */
async function resolveCategoryWithParents(wc: WcFn, path: string, cache: Map<string, number>): Promise<number[]> {
  const parts = path.split(">").map((x) => x.trim()).filter(Boolean);
  const allIds: number[] = [];
  let parentId = 0;
  let key = "";

  for (const name of parts) {
    key += `/${name.toLowerCase()}`;
    const cached = cache.get(key);

    if (cached) {
      parentId = cached;
      allIds.push(cached);
      continue;
    }

    const found: any[] = await wc(`/products/categories?per_page=100&search=${encodeURIComponent(name)}`);
    const match = found.find((c) => String(c.name).replace(/&amp;/g, "&").toLowerCase() === name.toLowerCase() && Number(c.parent) === parentId);
    const id: number =
      match?.id ?? (await wc("/products/categories", { method: "POST", body: JSON.stringify({ name, ...(parentId ? { parent: parentId } : {}) }) })).id;

    cache.set(key, id);
    allIds.push(id);
    parentId = id;
  }

  return allIds;
}
