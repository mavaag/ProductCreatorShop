import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Zet vrije tekst om in een SKU-vriendelijke slug: hoofdletters, cijfers en
 * koppeltekens, accenten weg, gelimiteerd in lengte.
 */
export function slugifyForSku(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accenten weg
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Zoekt een unieke SKU op basis van een basiswaarde: als "VAAS-ROOD" al bestaat,
 * probeert dit "VAAS-ROOD-2", "VAAS-ROOD-3", enz. tot een vrije waarde gevonden is.
 * excludeId laat toe om de huidige rij (bij het bewerken van een bestaande SKU) niet
 * als "bezet" te tellen.
 */
export async function nextAvailableSku(
  supabase: SupabaseClient,
  table: "products" | "product_variations",
  base: string,
  excludeId?: string
): Promise<string> {
  if (!base) return base;
  let query = supabase.from(table).select("id, sku").ilike("sku", `${base}%`);
  const { data } = await query;
  const taken = new Set(
    (data ?? []).filter((r: any) => !excludeId || r.id !== excludeId).map((r: any) => r.sku as string)
  );
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
