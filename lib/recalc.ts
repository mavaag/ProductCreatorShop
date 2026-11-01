import { SupabaseClient } from "@supabase/supabase-js";
import { calculatePrice } from "./pricing";
import { CostInputs, DEFAULT_VAT_RATE, EMPTY_COST_INPUTS, Machine, Material, ProductVariation } from "./types";
import { confirmDialog } from "@/components/DialogHost";

export type RecalcChange = {
  variationId: string;
  productId: string;
  sku: string;
  oldPrice: number | null;
  newPrice: number | null;
  oldCost: number | null;
  newCost: number;
  newSale: number | null;
  margin: number;
};

/** Beperkt een herberekening tot de varianten die een bepaald materiaal of een bepaalde machine gebruiken. */
export type RecalcScope = { materialId: string } | { machineId: string };

function usesScope(inputs: CostInputs, scope: RecalcScope): boolean {
  if ("materialId" in scope) return (inputs.materials ?? []).some((l) => l.material_id === scope.materialId);
  return (inputs.machine_time ?? []).some((l) => l.machine_id === scope.machineId);
}

/** Geen materialen, machinetijd, arbeid of andere kosten: de prijs is met de hand gezet (bv. geïmporteerd). */
function hasNoCostBuildup(inputs: CostInputs): boolean {
  return (
    (inputs.materials ?? []).length === 0 &&
    (inputs.machine_time ?? []).length === 0 &&
    !(inputs.labor_minutes > 0 && inputs.labor_rate > 0) &&
    !((inputs.other_costs ?? 0) > 0)
  );
}

/**
 * Berekent voor alle varianten (of enkel de opgegeven productIds, of enkel de varianten die een bepaald
 * materiaal/machine gebruiken) de prijs opnieuw met de huidige materiaal- en machinegegevens, en geeft enkel
 * de varianten terug waarvan de voorgestelde verkoopprijs of kostprijs effectief verandert.
 * Varianten zonder kostenopbouw (prijs met de hand gezet, bv. geïmporteerd) worden overgeslagen -- anders
 * zou hun prijs naar €0 gaan.
 */
export async function previewRecalculation(supabase: SupabaseClient, productIds?: string[], scope?: RecalcScope): Promise<RecalcChange[]> {
  const [{ data: machines }, { data: materials }] = await Promise.all([
    supabase.from("machines").select("*"),
    supabase.from("materials").select("*"),
  ]);
  let query = supabase.from("product_variations").select("*");
  if (productIds) query = query.in("product_id", productIds);
  const { data: variations } = await query;

  const machinesById = new Map(((machines ?? []) as Machine[]).map((m) => [m.id, m]));
  const materialsById = new Map(((materials ?? []) as Material[]).map((m) => [m.id, m]));

  const changes: RecalcChange[] = [];
  for (const v of (variations ?? []) as ProductVariation[]) {
    const inputs: CostInputs = { ...EMPTY_COST_INPUTS, ...(v.cost_inputs ?? {}) };
    if (scope && !usesScope(inputs, scope)) continue;
    if (hasNoCostBuildup(inputs)) continue;
    const result = calculatePrice(inputs, machinesById, materialsById);
    const same =
      numEq(v.suggested_price, result.suggestedPrice) &&
      numEq(v.cost_price, result.costPrice) &&
      numEq(v.sale_price, result.salePrice);
    if (same) continue;
    changes.push({
      variationId: v.id,
      productId: v.product_id,
      sku: v.sku,
      oldPrice: v.suggested_price,
      newPrice: result.suggestedPrice,
      oldCost: v.cost_price,
      newCost: result.costPrice,
      newSale: result.salePrice,
      margin: inputs.margin,
    });
  }
  return changes;
}

/** Schrijft de berekende prijzen weg en legt elke wijziging vast in de prijsgeschiedenis. */
export async function applyRecalculation(supabase: SupabaseClient, changes: RecalcChange[], reason: string) {
  const now = new Date().toISOString();
  for (const c of changes) {
    await supabase
      .from("product_variations")
      .update({ cost_price: c.newCost, sale_price: c.newSale, suggested_price: c.newPrice, updated_at: now })
      .eq("id", c.variationId);
  }
  if (changes.length > 0) {
    await supabase.from("price_history").insert(
      changes.map((c) => ({
        variation_id: c.variationId,
        cost_price: c.newCost,
        sale_price: c.newSale,
        suggested_price: c.newPrice,
        margin: c.margin,
        reason,
      }))
    );
  }
}

/** Legt de huidige prijs van één variant vast in de prijsgeschiedenis, enkel als die verschilt van de laatste. */
export async function recordPriceHistory(
  supabase: SupabaseClient,
  variationId: string,
  values: { cost_price: number | null; sale_price: number | null; suggested_price: number | null; margin: number },
  reason: string
) {
  const { data: last } = await supabase
    .from("price_history")
    .select("suggested_price, cost_price")
    .eq("variation_id", variationId)
    .order("created_at", { ascending: false })
    .limit(1);
  const prev = last?.[0];
  if (prev && numEq(prev.suggested_price, values.suggested_price) && numEq(prev.cost_price, values.cost_price)) return;
  await supabase.from("price_history").insert({ variation_id: variationId, ...values, reason });
}

/**
 * Handige wrapper voor pagina's die een materiaal/machine opslaan: vraagt of de prijzen van de
 * varianten die DAT materiaal of DIE machine gebruiken meteen herberekend mogen worden.
 * Geeft het aantal aangepaste varianten terug.
 */
export async function offerRecalculation(supabase: SupabaseClient, reason: string, scope: RecalcScope): Promise<number> {
  const changes = await previewRecalculation(supabase, undefined, scope);
  if (changes.length === 0) return 0;
  const ok = await confirmDialog(
    `${changes.length} variant(en) die dit ${"materialId" in scope ? "materiaal" : "machine"} gebruiken krijgen een andere prijs.\n\nNu herberekenen en in de prijsgeschiedenis bewaren?\n(Je kan dit ook later doen via Prijzen > Herbereken.)`
  );
  if (!ok) return 0;
  await applyRecalculation(supabase, changes, reason);
  return changes.length;
}

function numEq(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

export { DEFAULT_VAT_RATE };

/** Zet de marge van alle varianten van de opgegeven producten en herberekent hun prijzen (met prijsgeschiedenis). */
export async function setMarginForProducts(supabase: SupabaseClient, productIds: string[], margin: number): Promise<number> {
  const [{ data: machines }, { data: materials }, { data: variations }] = await Promise.all([
    supabase.from("machines").select("*"),
    supabase.from("materials").select("*"),
    supabase.from("product_variations").select("*").in("product_id", productIds),
  ]);
  const machinesById = new Map(((machines ?? []) as Machine[]).map((m) => [m.id, m]));
  const materialsById = new Map(((materials ?? []) as Material[]).map((m) => [m.id, m]));

  const history: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  for (const v of (variations ?? []) as ProductVariation[]) {
    const inputs: CostInputs = { ...EMPTY_COST_INPUTS, ...(v.cost_inputs ?? {}), margin };
    const r = calculatePrice(inputs, machinesById, materialsById);
    await supabase
      .from("product_variations")
      .update({ cost_inputs: inputs, cost_price: r.costPrice, sale_price: r.salePrice, suggested_price: r.suggestedPrice, updated_at: now })
      .eq("id", v.id);
    history.push({
      variation_id: v.id,
      cost_price: r.costPrice,
      sale_price: r.salePrice,
      suggested_price: r.suggestedPrice,
      margin,
      reason: `Bulk: marge naar ${Math.round(margin * 100)}%`,
    });
  }
  if (history.length > 0) await supabase.from("price_history").insert(history);
  return history.length;
}
