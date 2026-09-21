import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Synchroniseert rechtstreeks met WooCommerce via de REST API, zonder CSV-import:
//   * producten die al in de shop staan (zelfde SKU): enkel de verkoopprijzen (suggested_price) van de varianten
//   * producten die nog niet bestaan: worden enkel aangemaakt als createMissing true is (variabel product met
//     attributen, varianten + prijzen, beschrijving, categorieën, afbeelding(en), gewicht en verzendklasse).
//     Anders worden ze gerapporteerd.
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
        const ok = await createProduct(wc, p, report, categoryCache);
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

/** Maakt een variabel product met al zijn varianten aan in WooCommerce. Geeft true terug als dat gelukt is. */
async function createProduct(wc: WcFn, p: any, report: Report, categoryCache: Map<string, number>): Promise<boolean> {
  const attrNames: string[] = p.attribute_names ?? [];
  const variations = p.product_variations as { sku: string; attribute_values: Record<string, string>; suggested_price: number | null }[];

  const attributes = attrNames
    .map((name) => ({
      name,
      visible: true,
      variation: true,
      options: Array.from(new Set(variations.map((v) => v.attribute_values?.[name]).filter((x): x is string => !!x && !!x.trim()))),
    }))
    .filter((a) => a.options.length > 0);

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

  const payload: Record<string, unknown> = {
    name: p.name,
    type: "variable",
    sku: p.sku,
    status: p.published ? "publish" : "draft",
    description: p.description ?? "",
    attributes,
    categories: categoryIds,
  };
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

  const toCreate = variations.map((v) => ({
    sku: v.sku,
    ...(v.suggested_price != null ? { regular_price: Number(v.suggested_price).toFixed(2) } : {}),
    attributes: attrNames.filter((n) => v.attribute_values?.[n]).map((n) => ({ name: n, option: v.attribute_values[n] })),
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
