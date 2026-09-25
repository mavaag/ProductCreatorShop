import { SupabaseClient } from "@supabase/supabase-js";
import { nextAvailableSku } from "./sku";
import { EMPTY_PERSONALIZATION, Product, ProductVariation } from "./types";

/**
 * Kopieert een product met al zijn varianten (attributen, prijsberekening, WooCommerce-gegevens) als
 * startpunt voor een nieuw product. Het nieuwe product start als niet-gepubliceerd, met unieke SKU's.
 * Geeft het id van het nieuwe product terug.
 */
export async function duplicateProduct(supabase: SupabaseClient, source: Product): Promise<string> {
  const newSku = await nextAvailableSku(supabase, "products", `${source.sku}-KOPIE`);
  const { data: created, error } = await supabase
    .from("products")
    .insert({
      sku: newSku,
      name: `${source.name} (kopie)`,
      process_type: source.process_type,
      published: false,
      attribute_names: source.attribute_names,
      default_attribute_values: source.default_attribute_values ?? {},
      description: source.description ?? "",
      categories: source.categories ?? "",
      image_url: source.image_url ?? "",
      weight_kg: source.weight_kg ?? null,
      shipping_class: source.shipping_class ?? "",
      personalization: source.personalization ?? EMPTY_PERSONALIZATION,
    })
    .select()
    .single();
  if (error || !created) throw new Error(error?.message ?? "Product dupliceren mislukt");

  const { data: variations } = await supabase.from("product_variations").select("*").eq("product_id", source.id).order("sku");
  for (const v of (variations ?? []) as ProductVariation[]) {
    // Vervang de oude parent-SKU door de nieuwe, zodat de variant-SKU's bij het nieuwe product passen.
    const base = v.sku.startsWith(source.sku) ? newSku + v.sku.slice(source.sku.length) : `${newSku}-${v.sku}`;
    const sku = await nextAvailableSku(supabase, "product_variations", base);
    await supabase.from("product_variations").insert({
      product_id: created.id,
      sku,
      attribute_values: v.attribute_values,
      cost_inputs: v.cost_inputs,
      cost_price: v.cost_price,
      sale_price: v.sale_price,
      suggested_price: v.suggested_price,
      image_url: v.image_url,
    });
  }
  return created.id as string;
}
