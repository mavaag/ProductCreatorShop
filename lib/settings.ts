import { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MIN_MARGIN } from "./types";

/** Minimale marge (0-1) waaronder de app waarschuwt. Valt terug op de standaardwaarde als de tabel nog ontbreekt. */
export async function loadMinMargin(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("settings").select("value").eq("key", "min_margin").maybeSingle();
  const v = Number(data?.value);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_MIN_MARGIN;
}

export async function saveMinMargin(supabase: SupabaseClient, value: number) {
  return supabase.from("settings").upsert({ key: "min_margin", value });
}
