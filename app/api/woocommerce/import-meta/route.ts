import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { personalizationFromWooMeta, stableStringify } from "@/lib/gravure";
import { EMPTY_PERSONALIZATION } from "@/lib/types";

// Haalt naam, beschrijving, categorieën, afbeeldingen, gewicht en verzendklasse van bestaande WooCommerce
// producten op en schrijft deze naar de lokale database. Dit is een "reverse sync" - van WooCommerce naar
// de database -- voor wanneer je die gegevens rechtstreeks in WooCommerce hebt aangepast i.p.v. in de app.
// De prijs (suggested_price) wordt bewust NOOIT teruggehaald: de app is en blijft daarvoor de bron van
// waarheid, dat is precies waar de kostprijsberekening voor dient.
//
// Vereist server-side omgevingsvariabelen:
//   WOOCOMMERCE_URL
//   WOOCOMMERCE_CONSUMER_KEY
//   WOOCOMMERCE_CONSUMER_SECRET
// De aanvrager moet ingelogd zijn (Supabase-sessietoken in de Authorization-header).

type ImportReport = {
  updated: number;
  unchanged: number;
  notFound: number;
  errors: string[];
  changes: string[]; // bv. "SKU-123: description, image_url" -- welke velden per product effectief bijgewerkt zijn
};

type WooCategory = {
  id: number;
  name: string;
  slug: string;
  parent: number;
};

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

  // Optioneel beperken tot één techniek (type) en in batches (offset/limit) zodat één aanvraag kort blijft.
  const body = await request.json().catch(() => ({}));
  const type: string | undefined = typeof body.type === "string" && body.type !== "all" ? body.type : undefined;
  const offset = Number.isFinite(body.offset) && body.offset > 0 ? Math.floor(body.offset) : 0;
  const limit = Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : null;

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");

  // Haal alle lokale producten op
  let pq = supabase
    .from("products")
    .select("id, sku, name, description, categories, image_url, weight_kg, shipping_class, personalization, product_variations(id, sku, image_url)")
    .order("name");
  if (type) pq = pq.eq("process_type", type);
  const { data: products, error } = await pq;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report: ImportReport = { updated: 0, unchanged: 0, notFound: 0, errors: [], changes: [] };
  const allProducts = (products ?? []) as any[];
  const total = allProducts.length;
  const batch = limit != null ? allProducts.slice(offset, offset + limit) : allProducts.slice(offset);

  console.log(`[WooCommerce Import Meta] Start: ${batch.length}/${total} producten (offset ${offset})`);

  // Haal alle WooCommerce categorieën op en bouw een map van id -> hiërarchisch pad
  const categoryMap = new Map<number, string>();
  try {
    const allCategories: WooCategory[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(`${base}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`, {
        headers: { Authorization: auth }
      });
      if (!res.ok) throw new Error(`Categorieën ophalen mislukt: ${res.status}`);
      const categories: WooCategory[] = await res.json();
      allCategories.push(...categories);
      hasMore = categories.length === 100;
      page++;
    }

    // Bouw hiërarchische paden
    const catById = new Map(allCategories.map(c => [c.id, c]));
    function buildPath(cat: WooCategory): string {
      if (cat.parent === 0) return cat.name;
      const parent = catById.get(cat.parent);
      if (!parent) return cat.name;
      return `${buildPath(parent)} > ${cat.name}`;
    }

    for (const cat of allCategories) {
      categoryMap.set(cat.id, buildPath(cat));
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Categorieën ophalen mislukt: ${e.message}` }, { status: 500 });
  }

  // Loop door alle producten en haal metadata op uit WooCommerce
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    console.log(`[WooCommerce Import Meta] ${offset + i + 1}/${total}: ${p.name} (${p.sku})`);

    try {
      // Zoek product in WooCommerce op basis van SKU
      const res = await fetch(`${base}/wp-json/wc/v3/products?sku=${encodeURIComponent(p.sku)}`, {
        headers: { Authorization: auth }
      });

      if (!res.ok) {
        throw new Error(`WooCommerce API error: ${res.status}`);
      }

      const found = await res.json();
      const wcProduct = found?.[0];

      if (!wcProduct) {
        report.notFound++;
        console.log(`[WooCommerce Import Meta] ${p.sku} niet gevonden in WooCommerce`);
        continue;
      }

      // Haal naam, description, categories, afbeeldingen, gewicht en verzendklasse op
      const wcName = wcProduct.name || "";
      const wcDescription = wcProduct.description || "";
      const wcCategoryIds: number[] = (wcProduct.categories || []).map((c: any) => c.id);
      const wcCategories = wcCategoryIds
        .map(id => categoryMap.get(id))
        .filter((c): c is string => !!c)
        .join(", ");
      const wcImageUrl = (wcProduct.images || []).map((img: any) => img.src).filter(Boolean).join(", ");
      const wcWeight = wcProduct.weight && wcProduct.weight !== "" ? parseFloat(wcProduct.weight) : null;
      const wcShippingClass = wcProduct.shipping_class || "";

      // Check of er iets gewijzigd is. Net als bij description/categories hierboven geldt WooCommerce
      // hier voor elk veld als bron van waarheid -- ook een leeg/verwijderd veld in WooCommerce wordt
      // overgenomen. Heb je lokaal net iets aangepast dat je nog niet naar WooCommerce gepusht hebt,
      // gebruik dan eerst "Alle producten synchroniseren" voor je importeert, anders verlies je die wijziging.
      const nameChanged = !!wcName.trim() && p.name !== wcName;
      const descriptionChanged = p.description !== wcDescription;
      const categoriesChanged = p.categories !== wcCategories;
      const imageChanged = p.image_url !== wcImageUrl;
      const weightChanged = p.weight_kg !== wcWeight;
      const shippingClassChanged = p.shipping_class !== wcShippingClass;

      // Update lokale database
      const updates: any = {};
      if (nameChanged) updates.name = wcName;
      if (descriptionChanged) updates.description = wcDescription;
      if (categoriesChanged) updates.categories = wcCategories;
      if (imageChanged) updates.image_url = wcImageUrl;
      if (weightChanged) updates.weight_kg = wcWeight;
      if (shippingClassChanged) updates.shipping_class = wcShippingClass;

      // Instellingen van de 3DP Gravure Preview-plugin (zone, soort, kleur, voor-/achterkant, ...) zoals
      // ze in WooCommerce bij het product staan. De meerprijs en de kostenberekening blijven lokaal.
      const currentPersonalization = { ...EMPTY_PERSONALIZATION, ...(p.personalization ?? {}) };
      const wcImageSrcs: string[] = (wcProduct.images || []).map((img: any) => img.src).filter(Boolean);
      const wooPersonalization = personalizationFromWooMeta(currentPersonalization, wcProduct.meta_data || [], wcImageSrcs);
      if (wooPersonalization && stableStringify(wooPersonalization) !== stableStringify(currentPersonalization)) {
        updates.personalization = wooPersonalization;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("products").update(updates).eq("id", p.id);
        report.changes.push(`${p.sku}: ${Object.keys(updates).join(", ")}`);
      }

      // Afbeelding per variant (enkel voor variabele producten): WooCommerce-varianten koppelen op SKU.
      const variationChanges: string[] = [];
      if (wcProduct.type === "variable") {
        const localVariations = (p.product_variations ?? []) as { id: string; sku: string; image_url: string | null }[];
        const remoteVariations: any[] = [];
        for (let page = 1; ; page++) {
          const chunk = await fetch(`${base}/wp-json/wc/v3/products/${wcProduct.id}/variations?per_page=100&page=${page}`, {
            headers: { Authorization: auth },
          }).then((r) => r.json());
          remoteVariations.push(...chunk);
          if (chunk.length < 100) break;
        }
        const remoteBySku = new Map(remoteVariations.map((rv) => [rv.sku, rv]));
        for (const lv of localVariations) {
          const rv = remoteBySku.get(lv.sku);
          if (!rv) continue;
          const rvImageUrl = rv.image?.src || null;
          if (lv.image_url !== rvImageUrl) {
            await supabase.from("product_variations").update({ image_url: rvImageUrl }).eq("id", lv.id);
            variationChanges.push(lv.sku);
          }
        }
        if (variationChanges.length > 0) {
          report.changes.push(`${p.sku}: image_url van variant(en) ${variationChanges.join(", ")}`);
        }
      }

      if (Object.keys(updates).length === 0 && variationChanges.length === 0) {
        report.unchanged++;
        continue;
      }

      report.updated++;
      console.log(`[WooCommerce Import Meta] ${p.sku} bijgewerkt: ${Object.keys(updates).join(", ")}${variationChanges.length ? ` + variant-afbeeldingen: ${variationChanges.join(", ")}` : ""}`);

    } catch (e: any) {
      console.error(`[WooCommerce Import Meta] Fout bij ${p.sku}:`, e.message);
      report.errors.push(`${p.sku}: ${e.message}`);
    }
  }

  console.log(`[WooCommerce Import Meta] Voltooid: ${report.updated} bijgewerkt, ${report.unchanged} ongewijzigd, ${report.notFound} niet gevonden`);

  const done = offset + batch.length >= total;
  return NextResponse.json({ ...report, total, offset, processed: batch.length, nextOffset: done ? null : offset + batch.length, done });
}
