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
// Body (JSON, optioneel): { type?: string, productIds?: string[], dryRun?: boolean, createMissing?: boolean }
// productIds beperkt de sync tot die specifieke producten (bv. een selectie op de productenlijst).
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
  const productIds: string[] | undefined = Array.isArray(body.productIds) && body.productIds.length > 0 ? body.productIds : undefined;
  const dryRun = body.dryRun === true;
  const createMissing = body.createMissing === true;

  let query = supabase
    .from("products")
    .select("id, sku, name, published, last_exported_published, attribute_names, default_attribute_values, description, categories, image_url, weight_kg, shipping_class, personalization, product_variations(id, sku, attribute_values, suggested_price, image_url)")
    .order("name");
  if (type) query = query.eq("process_type", type);
  if (productIds) query = query.in("id", productIds);
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
          await supabase.from("products").update({ last_exported_at: now, last_exported_published: p.published }).eq("id", p.id);
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
        const { published: effectivePublished, adoptedFromWoo } = reconcilePublishedStatus(p, parent);
        if (adoptedFromWoo) report.notes.push(`${p.sku}: publicatiestatus was in WooCommerce zelf gewijzigd sinds de vorige sync -- lokaal overgenomen i.p.v. overschreven.`);
        if (!dryRun) {
          const ok = await updateProductMetadata(wc, parent, p, report, categoryCache, attributeCache, effectivePublished, priceChanged ? price : null);
          if (!ok && priceChanged) {
            report.errors.push(`${p.sku}: prijs niet bijgewerkt (zie opmerkingen)`);
            continue;
          }
        }
        if (price == null) continue;
        if (priceChanged) report.updated++;
        else report.unchanged++;
        if (!dryRun) {
          await supabase.from("products").update({ last_exported_at: new Date().toISOString(), published: effectivePublished, last_exported_published: effectivePublished }).eq("id", p.id);
          await supabase.from("product_variations").update({ exported_price: v.suggested_price }).eq("id", v.id);
        }
        continue;
      }

      const remote = new Map<string, { id: number; regular_price: string; image_src: string | null }>();
      for (let page = 1; ; page++) {
        const chunk = await wc(`/products/${parent.id}/variations?per_page=100&page=${page}`);
        for (const rv of chunk) remote.set(rv.sku, { id: rv.id, regular_price: rv.regular_price, image_src: rv.image?.src ?? null });
        if (chunk.length < 100) break;
      }

      const updates: { id: number; regular_price?: string; image?: { src: string } }[] = [];
      const synced: string[] = [];
      for (const v of p.product_variations as { id: string; sku: string; suggested_price: number | null; image_url: string | null }[]) {
        if (v.suggested_price == null) continue;
        const rv = remote.get(v.sku);
        if (!rv) {
          report.missingVariations.push(v.sku);
          continue;
        }
        const price = Number(v.suggested_price).toFixed(2);
        const priceChanged = Number(rv.regular_price) !== Number(price);
        // Enkel pushen als er lokaal een afbeelding is ingevuld -- een leeg lokaal veld wist nooit
        // een bestaande WooCommerce-afbeelding (zelfde voorzichtige aanpak als bij de productafbeeldingen).
        const imageChanged = !!v.image_url && v.image_url !== rv.image_src;
        if (!priceChanged && !imageChanged) {
          report.unchanged++;
          synced.push(v.id);
          continue;
        }
        updates.push({
          id: rv.id,
          ...(priceChanged ? { regular_price: price } : {}),
          ...(imageChanged ? { image: { src: v.image_url as string } } : {}),
        });
        synced.push(v.id);
      }

      // Publicatiestatus: als WooCommerce afwijkt van wat we de vorige keer zelf pushten, is die buiten
      // de app om gewijzigd (bv. handmatig gepubliceerd in de WooCommerce-admin) -- dan nemen we die
      // wijziging over i.p.v. ze te overschrijven.
      const { published: effectivePublished, adoptedFromWoo } = reconcilePublishedStatus(p, parent);
      if (adoptedFromWoo) report.notes.push(`${p.sku}: publicatiestatus was in WooCommerce zelf gewijzigd sinds de vorige sync -- lokaal overgenomen i.p.v. overschreven.`);

      // Update product metadata (naam, beschrijving, categorieën, afbeeldingen, attributen, etc.)
      if (!dryRun) {
        await updateProductMetadata(wc, parent, p, report, categoryCache, attributeCache, effectivePublished);
      }

      // Update prijzen van varianten
      if (updates.length > 0 && !dryRun) {
        for (let i = 0; i < updates.length; i += 100) {
          await wc(`/products/${parent.id}/variations/batch`, { method: "POST", body: JSON.stringify({ update: updates.slice(i, i + 100) }) });
        }
      }
      report.updated += updates.length;

      if (!dryRun) {
        const now = new Date().toISOString();
        await supabase.from("products").update({ last_exported_at: now, published: effectivePublished, last_exported_published: effectivePublished }).eq("id", p.id);
        if (synced.length > 0) {
          const vs = (p.product_variations as { id: string; suggested_price: number | null }[]).filter((v) => synced.includes(v.id));
          await Promise.all(vs.map((v) => supabase.from("product_variations").update({ exported_price: v.suggested_price }).eq("id", v.id)));
        }
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

/**
 * Bepaalt welke publicatiestatus deze sync-run effectief moet gebruiken. Normaal pushen we gewoon de
 * lokale "published"-waarde door. Maar wijkt de huidige status in WooCommerce af van wat we de VORIGE
 * keer zelf gepusht hebben (last_exported_published), dan is die tussentijds handmatig gewijzigd in de
 * WooCommerce-admin (bv. iemand heeft het product daar zelf gepubliceerd) -- in dat geval nemen we die
 * wijziging over in plaats van ze bij deze sync ongedaan te maken.
 */
function reconcilePublishedStatus(p: any, parent: { status: string }): { published: boolean; adoptedFromWoo: boolean } {
  const wcPublished = parent.status === "publish";
  const lastExported = p.last_exported_published as boolean | null | undefined;
  if (lastExported != null && wcPublished !== lastExported) {
    return { published: wcPublished, adoptedFromWoo: true };
  }
  return { published: p.published, adoptedFromWoo: false };
}

/** Post-meta sleutel per zone van een personalisatieplugin -- moet overeenkomen met lib/types.ts PERSONALIZATION_ZONES. */
const PERSONALIZATION_META_KEYS: Record<string, Record<string, string>> = {
  gravure_uv: { single: "_tdp_fee" },
  tshirt: { front: "_tdpt_fee", back: "_tdpt_back_fee" },
};

/**
 * Bouwt de meta_data-array voor de meerprijs van een personalisatieplugin (3DP Gravure Preview /
 * 3DP T-shirt Preview -- zie lib/types.ts Personalization). Hergebruikt het bestaande meta_data-id
 * van WooCommerce voor een sleutel als die al bestaat, anders maakt WooCommerce elke sync een nieuwe
 * meta-rij aan i.p.v. de bestaande bij te werken.
 */
function buildPersonalizationMetaData(
  existing: { id: number; key: string; value: unknown }[],
  personalization: { plugin: string; zones: { key: string; fee: number | null }[] } | null | undefined
): { id?: number; key: string; value: string }[] {
  const plugin = personalization?.plugin;
  if (!plugin || plugin === "none") return [];
  const metaKeys = PERSONALIZATION_META_KEYS[plugin];
  if (!metaKeys) return [];
  const result: { id?: number; key: string; value: string }[] = [];
  for (const zone of personalization?.zones ?? []) {
    const metaKey = metaKeys[zone.key];
    if (!metaKey || zone.fee == null) continue;
    const found = existing.find((m) => m.key === metaKey);
    result.push({ ...(found ? { id: found.id } : {}), key: metaKey, value: Number(zone.fee).toFixed(2) });
  }
  return result;
}

/** Maakt een variabel product met al zijn varianten (of een simpel product) aan in WooCommerce. Geeft true terug als dat gelukt is. */
async function createProduct(wc: WcFn, p: any, report: Report, categoryCache: Map<string, number>, attributeCache: Map<string, number>): Promise<boolean> {
  const attrNames: string[] = p.attribute_names ?? [];
  const variations = p.product_variations as { sku: string; attribute_values: Record<string, string>; suggested_price: number | null; image_url: string | null }[];

  let attributes: ({ id: number; visible: boolean; variation: boolean; options: string[] } | { name: string; visible: boolean; variation: boolean; options: string[] })[] = [];
  let defaultAttributes: ({ id: number; option: string } | { name: string; option: string })[] = [];
  try {
    attributes = await buildProductAttributes(wc, attrNames, variations, attributeCache);
    defaultAttributes = await buildDefaultAttributes(wc, attrNames, p.default_attribute_values ?? {}, attributeCache);
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
    if (defaultAttributes.length > 0) payload.default_attributes = defaultAttributes;
  }
  if (p.weight_kg != null) payload.weight = String(p.weight_kg);
  if (p.shipping_class) payload.shipping_class = p.shipping_class;
  const personalizationMeta = buildPersonalizationMetaData([], p.personalization);
  if (personalizationMeta.length > 0) payload.meta_data = personalizationMeta;

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
    ...(v.image_url ? { image: { src: v.image_url } } : {}),
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
  parent: { id: number; meta_data?: { id: number; key: string; value: unknown }[] },
  p: any,
  report: Report,
  categoryCache: Map<string, number>,
  attributeCache: Map<string, number>,
  published: boolean, // effectieve publicatiestatus voor deze sync-run, zie reconcilePublishedStatus()
  regularPrice: string | null = null // enkel voor simpele producten: nieuwe prijs, of null om ze niet te wijzigen
): Promise<boolean> {
  const productId = parent.id;
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
      status: published ? "publish" : "draft",
      description: p.description ?? "",
      categories: categoryIds,
    };
    if (p.weight_kg != null) payload.weight = String(p.weight_kg);
    if (p.shipping_class) payload.shipping_class = p.shipping_class;
    if (images.length > 0) payload.images = images;
    if (regularPrice != null) payload.regular_price = regularPrice;
    const personalizationMeta = buildPersonalizationMetaData(parent.meta_data ?? [], p.personalization);
    if (personalizationMeta.length > 0) payload.meta_data = personalizationMeta;

    if (!isSimple(p)) {
      // Attributen mee bijwerken: een nieuwe waarde voor een attribuut dat al globaal bestaat, wordt zo
      // alsnog als term aangemaakt en zichtbaar in de waardenlijst van dat attribuut. Bestaat het attribuut
      // zelf nog niet globaal, dan blijft het lokaal (er wordt geen nieuw globaal attribuut aangemaakt).
      try {
        const attrNames: string[] = p.attribute_names ?? [];
        const variations = p.product_variations as { attribute_values: Record<string, string> }[];
        payload.attributes = await buildProductAttributes(wc, attrNames, variations, attributeCache);
        const defaultAttributes = await buildDefaultAttributes(wc, attrNames, p.default_attribute_values ?? {}, attributeCache);
        payload.default_attributes = defaultAttributes; // ook een lege lijst versturen wist een oude standaardwaarde die niet meer gekozen is
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

/**
 * Bouwt de "Default Form Values" van een product op: de waarde per attribuut die al geselecteerd
 * staat wanneer een klant de productpagina opent, voor die klant zelf een variant kiest. Attributen
 * zonder gekozen standaardwaarde worden overgeslagen.
 */
async function buildDefaultAttributes(
  wc: WcFn,
  attrNames: string[],
  defaultValues: Record<string, string>,
  cache: Map<string, number>
): Promise<({ id: number; option: string } | { name: string; option: string })[]> {
  const result: ({ id: number; option: string } | { name: string; option: string })[] = [];
  for (const name of attrNames) {
    const value = (defaultValues?.[name] ?? "").trim();
    if (!value) continue;
    const id = await resolveGlobalAttribute(wc, name, cache);
    result.push(id ? { id, option: value } : { name, option: value });
  }
  return result;
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
