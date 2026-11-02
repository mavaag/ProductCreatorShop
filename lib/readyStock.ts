import { SupabaseClient } from "@supabase/supabase-js";
import { CostInputs } from "./types";

// "Klaar op voorraad" (migratie 039): afgewerkte stuks van een variant, bv. op voorhand geprinte wall art.
// Bij een bestelling komt een regel eerst uit deze voorraad (tools/maker/orders_sync.py) -- dan gaan er geen
// materialen meer af, want die gingen er al af bij "+ gemaakt".

async function log(supabase: SupabaseClient, variationId: string, delta: number, reason: string) {
  await supabase.from("ready_stock_moves").insert({ variation_id: variationId, delta, reason });
}

/** n stuks gemaakt voor de voorraad: ready_stock + n en de materialen (kostenopbouw x n) van de materiaalvoorraad. */
export async function addMadeToStock(supabase: SupabaseClient, variationId: string, n: number, costInputs: CostInputs): Promise<number> {
  const { data, error } = await supabase.from("product_variations").select("ready_stock").eq("id", variationId).single();
  if (error) throw error;
  const next = (Number(data?.ready_stock) || 0) + n;
  const { error: upd } = await supabase.from("product_variations").update({ ready_stock: next }).eq("id", variationId);
  if (upd) throw upd;
  for (const line of costInputs.materials ?? []) {
    const q = Number(line.quantity) * n;
    if (!line.material_id || !(q > 0)) continue;
    const { data: m } = await supabase.from("materials").select("stock_quantity").eq("id", line.material_id).single();
    if (m?.stock_quantity == null) continue; // voorraad van dit materiaal wordt niet bijgehouden
    await supabase.from("materials").update({ stock_quantity: Math.round((Number(m.stock_quantity) - q) * 10000) / 10000 }).eq("id", line.material_id);
  }
  await log(supabase, variationId, n, "gemaakt");
  return next;
}

/** Correctie (geteld, kapot, weggegeven, ...): zet het aantal zonder iets aan de materialen te doen. */
export async function correctReadyStock(supabase: SupabaseClient, variationId: string, from: number, to: number): Promise<void> {
  const { error } = await supabase.from("product_variations").update({ ready_stock: to }).eq("id", variationId);
  if (error) throw error;
  await log(supabase, variationId, to - from, "correctie");
}
