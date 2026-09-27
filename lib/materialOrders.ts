import { SupabaseClient } from "@supabase/supabase-js";
import { Material, MaterialOrder } from "./types";

export type NewMaterialOrder = {
  material_id: string;
  packages: number;
  units_per_package: number;
  total_price: number;
  supplier_name: string | null;
  ordered_at: string;
  notes: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hoogt de voorraad van een materiaal op met `quantity` -- start voorraadopvolging (vanaf 0) als die nog niet actief was. */
async function bumpStock(supabase: SupabaseClient, materialId: string, quantity: number): Promise<void> {
  const { data: material, error } = await supabase.from("materials").select("stock_quantity").eq("id", materialId).single();
  if (error) throw error;
  const current = (material as Pick<Material, "stock_quantity"> | null)?.stock_quantity;
  const { error: updateError } = await supabase
    .from("materials")
    .update({ stock_quantity: (current ?? 0) + quantity })
    .eq("id", materialId);
  if (updateError) throw updateError;
}

/**
 * Legt een materiaalbestelling vast (packages x units_per_package = quantity, in de eenheid van het
 * materiaal). Bij `markReceived` wordt ze meteen als ontvangen gezet en telt de hoeveelheid meteen mee
 * bij de voorraad; anders blijft ze "onderweg" tot iemand ze later ontvangt via markMaterialOrderReceived.
 */
export async function createMaterialOrder(supabase: SupabaseClient, order: NewMaterialOrder, markReceived: boolean): Promise<void> {
  const quantity = order.packages * order.units_per_package;
  const received_at = markReceived ? todayIso() : null;
  const { error } = await supabase.from("material_orders").insert({ ...order, quantity, received_at });
  if (error) throw error;
  if (markReceived) await bumpStock(supabase, order.material_id, quantity);
}

/** Markeert een nog onderweg zijnde bestelling als ontvangen en telt haar hoeveelheid bij de voorraad op. */
export async function markMaterialOrderReceived(supabase: SupabaseClient, order: MaterialOrder): Promise<void> {
  if (order.received_at) return;
  const { error } = await supabase.from("material_orders").update({ received_at: todayIso() }).eq("id", order.id);
  if (error) throw error;
  await bumpStock(supabase, order.material_id, order.quantity);
}

/** Verwijdert een bestelling uit de geschiedenis. Past de voorraad niet aan -- als ze al ontvangen was,
 * is de hoeveelheid mogelijk al (deels) verbruikt. */
export async function deleteMaterialOrder(supabase: SupabaseClient, order: MaterialOrder): Promise<void> {
  const { error } = await supabase.from("material_orders").delete().eq("id", order.id);
  if (error) throw error;
}
