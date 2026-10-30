import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { gravureSettingsMeta, gravureImageMeta, withExistingMetaIds, metaUpToDate } from "@/lib/gravure";

// Synchroniseert rechtstreeks met WooCommerce via de REST API, zonder CSV-import:
//   * producten die al in de shop staan (zelfde SKU): update product metadata (naam, beschrijving, categorieën,
//     afbeeldingen, gewicht, verzendklasse, status, attributen) + update de verkoopprijzen (suggested_price)
//     van de varianten
//   * producten die nog niet bestaan: worden enkel aangemaakt als createMissing true is (variabel product met
//     attributen, varianten + prijzen, beschrijving, categorieën, afbeelding(en), gewicht en verzendklasse).
//     Anders worden ze gerapporteerd.
//
// Attributen: elk product-attribuut (bv. "Kleur", "Maat") wordt gekoppeld aan het GLOBALE WooCommerce-
// attribuut met die naam (Producten > Attributen). Bestaat dat globale attribuut nog niet, dan maakt de
// app het nu zelf aan en gebruikt het -- zo delen alle producten hetzelfde globale attribuut (nodig voor
// kleur-swatches, filters en consistente varianten). Een nieuwe waarde wordt automatisch als term
// aangemaakt. Zo kan een product nooit meer een los lokaal attribuut met dezelfde naam krijgen.
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

/**
 * Zoekt uit of een afbeeldings-URL die al op de eigen WooCommerce-site staat (bv. omdat je de afbeelding
 * zelf al had opgeladen naar de media-bibliotheek en enkel de URL hier invult) overeenkomt met een
 * bestaand media-item. Zo ja, geef je het bestaande media-id mee in plaats van de URL ("src") -- geeft
 * je enkel "src" mee, dan downloadt WooCommerce de afbeelding altijd opnieuw en zet ze als NIEUW
 * media-item weg, met dubbele afbeeldingen in de bibliotheek tot gevolg. Externe URL's (niet van deze
 * site) blijven gewoon via "src" gaan, want daar is er sowieso geen bestaand media-item voor.
 */
async function resolveImageRef(base: string, url: string, cache: Map<string, number | null>): Promise<{ src: string } | { id: number }> {
  if (!url.toLowerCase().startsWith(base.toLowerCase())) return { src: url };
  const cached = cache.get(url);
  if (cached !== undefined) return cached ? { id: cached } : { src: url };
  try {
    const fileName = decodeURIComponent((url.split("/").pop() ?? "").split("?")[0]);
    const search = fileName.replace(/\.[a-z0-9]+$/i, "");
    const res = await fetch(`${base}/wp-json/wp/v2/media?search=${encodeURIComponent(search)}&per_page=20`);
    if (res.ok) {
      const results: { id: number; source_url: string }[] = await res.json();
      const match = results.find((m) => m.source_url === url);
      if (match) {
        cache.set(url, match.id);
        return { id: match.id };
      }
    }
  } catch {
    // val terug op src
  }
  cache.set(url, null);
  return { src: url };
}

async function resolveImageRefs(base: string, urls: string[], cache: Map<string, number | null>): Promise<({ src: string } | { id: number })[]> {
  return Promise.all(urls.map((url) => resolveImageRef(base, url, cache)));
}

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
  // Batching: verwerk slechts een deel (offset..offset+limit) zodat één aanvraag kort blijft (Cloudflare kapt na 100s af).
  const offset = Number.isFinite(body.offset) && body.offset > 0 ? Math.floor(body.offset) : 0;
  const limit = Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : null;

  let query = supabase
    .from("products")
    .select("id, sku, name, published, last_exported_published, attribute_names, default_attribute_values, description, short_description, categories, image_url, weight_kg, shipping_class, personalization, product_variations(id, sku, attribute_values, suggested_price, image_url)")
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
  const mediaCache = new Map<string, number | null>(); // url -> bestaand media-id (of null = geen match gevonden)
  const allProducts = (products ?? []) as any[];
  const total = allProducts.length;
  const batch = limit != null ? allProducts.slice(offset, offset + limit) : allProducts.slice(offset);

  console.log(`[WooCommerce Sync] Start: ${batch.length}/${total} producten (offset ${offset})`);

  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    console.log(`[WooCommerce Sync] ${offset + i + 1}/${total}: ${p.name} (${p.sku})`);
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
        const ok = await createProduct(wc, base, p, report, categoryCache, attributeCache, mediaCache);
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
          const ok = await updateProductMetadata(wc, base, parent, p, report, categoryCache, attributeCache, mediaCache, effectivePublished, priceChanged ? price : null);
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

      // Simpel product in WooCommerce dat hier varianten kreeg (bv. "Overnemen in shopproduct" in de Catalogus): omzetten
      // naar een variabel product (zelfde id, URL en reviews) en de varianten aanmaken. Enkel als elke variant een prijs
      // heeft -- een variabel product zonder (geprijsde) varianten kan niemand kopen.
      const convert = parent.type === "simple";
      if (convert) {
        const unpriced = (p.product_variations as { sku: string; suggested_price: number | null }[]).filter((v) => v.suggested_price == null);
        if (unpriced.length > 0) {
          report.errors.push(`${p.sku}: staat in WooCommerce als simpel product en krijgt nu varianten -- vul eerst de prijs in van ${unpriced.map((v) => v.sku).join(", ")}`);
          continue;
        }
        report.notes.push(`${p.sku}: ${dryRun ? "wordt" : "is"} omgezet van simpel naar variabel product met ${p.product_variations.length} varianten`);
      }

      const remote = new Map<string, { id: number; regular_price: string; image_src: string | null; attributes: { id: number; name?: string; option: string }[] }>();
      for (let page = 1; ; page++) {
        const chunk = await wc(`/products/${parent.id}/variations?per_page=100&page=${page}`);
        for (const rv of chunk) remote.set(rv.sku, { id: rv.id, regular_price: rv.regular_price, image_src: rv.image?.src ?? null, attributes: rv.attributes ?? [] });
        if (chunk.length < 100) break;
      }

      const updates: { id: number; regular_price?: string; image?: { src: string } | { id: number } }[] = [];
      const synced: string[] = [];
      const toCreate: any[] = []; // varianten van een omgezet product (zie convert)
      for (const v of p.product_variations as { id: string; sku: string; suggested_price: number | null; image_url: string | null }[]) {
        if (v.suggested_price == null) continue;
        const rv = remote.get(v.sku);
        if (!rv && convert) {
          toCreate.push(v);
          synced.push(v.id);
          continue;
        }
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
          ...(imageChanged ? { image: await resolveImageRef(base, v.image_url as string, mediaCache) } : {}),
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
        const ok = await updateProductMetadata(wc, base, parent, p, report, categoryCache, attributeCache, mediaCache, effectivePublished, null, convert);
        if (!ok && convert) {
          report.errors.push(`${p.sku}: niet omgezet naar een variabel product (zie opmerkingen)`);
          continue;
        }
      }
      if (toCreate.length > 0 && !dryRun) {
        const payloads = await newVariationPayloads(base, p.attribute_names ?? [], toCreate, attributeCache, mediaCache);
        for (let i = 0; i < payloads.length; i += 100) {
          await wc(`/products/${parent.id}/variations/batch`, { method: "POST", body: JSON.stringify({ create: payloads.slice(i, i + 100) }) });
        }
      }
      report.updated += toCreate.length;

      // Variant-attributen (globaal) herstellen/zetten wanneer ze ontbreken of afwijken van de app-data.
      // Nodig o.a. nadat een attribuut van lokaal naar globaal is omgezet: de varianten moeten dan opnieuw
      // aan de globale termen worden gekoppeld, anders kan een klant geen variant (en dus geen prijs) kiezen.
      if (!dryRun && !isSimple(p)) {
        const attrNames: string[] = p.attribute_names ?? [];
        const attrFixes: { id: number; attributes: ({ id: number; option: string } | { name: string; option: string })[] }[] = [];
        for (const v of p.product_variations as { sku: string; attribute_values: Record<string, string> }[]) {
          const rv = remote.get(v.sku);
          if (!rv) continue;
          const desired = attrNames
            .filter((n) => v.attribute_values?.[n])
            .map((n) => {
              const id = attributeCache.get(n.toLowerCase());
              return id ? { id, option: v.attribute_values[n] } : { name: n, option: v.attribute_values[n] };
            });
          if (desired.length === 0) continue;
          const norm = (arr: { id?: number; name?: string; option: string }[]) =>
            arr.map((a) => `${a.id ?? a.name ?? ""}=${String(a.option).toLowerCase()}`).sort().join("|");
          if (norm(rv.attributes) !== norm(desired)) attrFixes.push({ id: rv.id, attributes: desired });
        }
        for (let i = 0; i < attrFixes.length; i += 100) {
          await wc(`/products/${parent.id}/variations/batch`, { method: "POST", body: JSON.stringify({ update: attrFixes.slice(i, i + 100) }) });
        }
        if (attrFixes.length > 0) report.notes.push(`${p.sku}: ${attrFixes.length} variant-attributen (her)gekoppeld aan de globale termen.`);
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

  const done = offset + batch.length >= total;
  return NextResponse.json({ dryRun, total, offset, processed: batch.length, nextOffset: done ? null : offset + batch.length, done, ...report });
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
  gravure_uv: { front: "_tdp_fee", back: "_tdp_back_fee" },
  tshirt: { front: "_tdpt_fee", back: "_tdpt_back_fee" },
  mug: { single: "_pfy_mug_fee" },
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
  // 3DP Gravure Preview: ook de zone, soort, kleur, ... (alles behalve de afbeeldingen -- die volgen in
  // syncGravureImages, omdat we daarvoor de URL's nodig hebben die WooCommerce aan de foto's geeft).
  result.push(...withExistingMetaIds(existing, gravureSettingsMeta(personalization as any)));
  return result;
}

/**
 * Tweede stap voor de 3DP Gravure Preview-plugin: zet _tdp_image / _tdp_back_image op de URL die
 * WooCommerce aan de gekozen productafbeelding gaf. Kan pas NA het opslaan van het product, want
 * WooCommerce downloadt de afbeeldingen zelf en geeft ze een nieuwe URL op de eigen site.
 * Doet niets (geen extra request) als alles al klopt.
 */
async function syncGravureImages(wc: WcFn, saved: any, p: any, report: Report): Promise<void> {
  const srcs: string[] = (saved?.images ?? []).map((img: any) => String(img?.src ?? "")).filter(Boolean);
  const { meta, warnings } = gravureImageMeta(p.personalization, srcs);
  for (const w of warnings) report.notes.push(`${p.sku}: ${w}`);
  if (meta.length === 0) return;
  const existing: { id: number; key: string; value: unknown }[] = saved?.meta_data ?? [];
  if (metaUpToDate(existing, meta)) return;
  try {
    await wc(`/products/${saved.id}`, { method: "PUT", body: JSON.stringify({ meta_data: withExistingMetaIds(existing, meta) }) });
  } catch (e: any) {
    report.notes.push(`${p.sku}: gravure-afbeeldingen niet ingesteld (${e.message})`);
  }
}

/** Maakt een variabel product met al zijn varianten (of een simpel product) aan in WooCommerce. Geeft true terug als dat gelukt is. */
async function createProduct(wc: WcFn, base: string, p: any, report: Report, categoryCache: Map<string, number>, attributeCache: Map<string, number>, mediaCache: Map<string, number | null>): Promise<boolean> {
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

  const images = await resolveImageRefs(base, String(p.image_url ?? "").split(",").map((u: string) => u.trim()).filter(Boolean), mediaCache);

  const simple = isSimple(p);
  const payload: Record<string, unknown> = {
    name: p.name,
    type: simple ? "simple" : "variable",
    sku: p.sku,
    status: p.published ? "publish" : "draft",
    description: p.description ?? "",
    categories: categoryIds,
  };
  if (p.short_description) payload.short_description = p.short_description; // leeg = korte beschrijving in WooCommerce ongemoeid laten
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

  await syncGravureImages(wc, created, p, report);

  if (simple) return true;

  const toCreate = await newVariationPayloads(base, attrNames, variations, attributeCache, mediaCache);
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

/** Payloads om varianten aan te maken in WooCommerce (sku, prijs, foto, attributen). attributeCache moet al gevuld zijn. */
async function newVariationPayloads(
  base: string,
  attrNames: string[],
  variations: { sku: string; attribute_values: Record<string, string>; suggested_price: number | null; image_url: string | null }[],
  attributeCache: Map<string, number>,
  mediaCache: Map<string, number | null>
) {
  return Promise.all(variations.map(async (v) => ({
    sku: v.sku,
    ...(v.suggested_price != null ? { regular_price: Number(v.suggested_price).toFixed(2) } : {}),
    ...(v.image_url ? { image: await resolveImageRef(base, v.image_url, mediaCache) } : {}),
    attributes: attrNames
      .filter((n) => v.attribute_values?.[n])
      .map((n) => {
        const id = attributeCache.get(n.toLowerCase());
        // Globaal attribuut (id gekend en > 0) -> referentie via id; anders lokaal via naam.
        return id ? { id, option: v.attribute_values[n] } : { name: n, option: v.attribute_values[n] };
      }),
  })));
}

/** Update de metadata van een bestaand product in WooCommerce (naam, beschrijving, categorieën, afbeeldingen, attributen, etc.). */
async function updateProductMetadata(
  wc: WcFn,
  base: string,
  parent: { id: number; meta_data?: { id: number; key: string; value: unknown }[] },
  p: any,
  report: Report,
  categoryCache: Map<string, number>,
  attributeCache: Map<string, number>,
  mediaCache: Map<string, number | null>,
  published: boolean, // effectieve publicatiestatus voor deze sync-run, zie reconcilePublishedStatus()
  regularPrice: string | null = null, // enkel voor simpele producten: nieuwe prijs, of null om ze niet te wijzigen
  makeVariable = false // simpel product in WooCommerce omzetten naar variabel (zelfde product-id)
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

    const images = await resolveImageRefs(base, String(p.image_url ?? "").split(",").map((u: string) => u.trim()).filter(Boolean), mediaCache);

    const payload: Record<string, unknown> = {
      name: p.name,
      status: published ? "publish" : "draft",
      description: p.description ?? "",
      categories: categoryIds,
    };
    if (p.short_description) payload.short_description = p.short_description; // leeg = korte beschrijving in WooCommerce ongemoeid laten
    if (p.weight_kg != null) payload.weight = String(p.weight_kg);
    if (p.shipping_class) payload.shipping_class = p.shipping_class;
    if (images.length > 0) payload.images = images;
    if (regularPrice != null) payload.regular_price = regularPrice;
    if (makeVariable) payload.type = "variable";
    const personalizationMeta = buildPersonalizationMetaData(parent.meta_data ?? [], p.personalization);
    if (personalizationMeta.length > 0) payload.meta_data = personalizationMeta;

    if (!isSimple(p)) {
      // Attributen mee bijwerken: ze worden gekoppeld aan het globale attribuut (dat zo nodig wordt
      // aangemaakt). Een nieuwe waarde wordt automatisch als term van dat globale attribuut aangemaakt.
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

    const saved = await wc(`/products/${productId}`, { method: "PUT", body: JSON.stringify(payload) });
    await syncGravureImages(wc, saved, p, report);
    console.log(`[WooCommerce Sync] Product ${p.sku} metadata bijgewerkt`);
    return true;
  } catch (e: any) {
    report.notes.push(`${p.sku}: metadata update mislukt (${e.message})`);
    return false;
  }
}

/**
 * Zoekt een globaal WooCommerce-attribuut (Producten > Attributen) op naam op (hoofdletterongevoelig).
 * Bestaat het nog niet globaal, dan wordt het nu als globaal attribuut AANGEMAAKT en gebruikt, zodat elk
 * product hetzelfde globale attribuut deelt (nodig voor kleur-swatches, filters en consistente varianten).
 * Geeft het id terug, of 0 als aanmaken onverhoopt niet lukte (dan valt dat ene product terug op lokaal).
 */
async function resolveGlobalAttribute(wc: WcFn, name: string, cache: Map<string, number>): Promise<number> {
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const found: any[] = await wc(`/products/attributes?per_page=100&search=${encodeURIComponent(name)}`);
  let id = found.find((a) => String(a.name).toLowerCase() === key)?.id ?? 0;
  if (!id) {
    // Bestaat nog niet globaal -> nu aanmaken als globaal attribuut, zodat elk product hetzelfde
    // (globale) attribuut deelt. Nodig voor kleur-swatches, filters en consistente varianten, en
    // het voorkomt dat producten een los lokaal attribuut met dezelfde naam krijgen.
    try {
      const created: any = await wc(`/products/attributes`, {
        method: "POST",
        body: JSON.stringify({ name, type: "select", order_by: "menu_order", has_archives: false }),
      });
      id = created?.id ?? 0;
    } catch {
      // Kon niet aanmaken (bv. bestond intussen toch al door een parallelle run) -> opnieuw opzoeken.
      const again: any[] = await wc(`/products/attributes?per_page=100&search=${encodeURIComponent(name)}`);
      id = again.find((a) => String(a.name).toLowerCase() === key)?.id ?? 0;
    }
  }
  cache.set(key, id);
  return id;
}

/**
 * Bouwt de attributenlijst van een product op. Elk attribuut wordt gekoppeld aan het globale attribuut
 * (dat zo nodig wordt aangemaakt, zie resolveGlobalAttribute) via zijn id -- een nieuwe waarde wordt door
 * WooCommerce automatisch als term aangemaakt. Attributen zonder ingevulde waarden worden overgeslagen.
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
