import { supabase } from "@/lib/supabaseClient";

/**
 * Laadt een lokaal bestand op naar de publieke "product-images" storage bucket en geeft de
 * publieke URL terug. Die URL kan je gewoon in een image_url-veld zetten -- bij het
 * synchroniseren met WooCommerce wordt zo'n externe URL net als een handmatig geplakte URL
 * behandeld (WooCommerce downloadt ze zelf), er is dus geen aparte sync-logica voor nodig.
 */
export async function uploadProductImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}
