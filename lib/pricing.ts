import { CostInputs, Machine, Material, DEFAULT_VAT_RATE, toHours } from "./types";

/**
 * Berekent afschrijving (€/u) en stroomkosten (€/u) voor een machine.
 */
export function machineHourlyCosts(machine: Machine) {
  const depreciationPerHour =
    machine.expected_lifetime_hours > 0
      ? machine.purchase_price / machine.expected_lifetime_hours
      : 0;
  const powerCostPerHour = (machine.avg_power_w / 1000) * machine.electricity_price;
  return { depreciationPerHour, powerCostPerHour };
}

/**
 * Rondt een prijs af naar een "psychologische" verkoopprijs die eindigt op ,95 --
 * altijd naar BOVEN afgerond, zodat de voorgestelde prijs nooit onder je berekende
 * verkoopprijs uitkomt. Dit is een eenvoudige vuistregel, geen boekhoudkundig advies --
 * pas gerust zelf aan als je liever een ronde prijs of een andere eindcijfer gebruikt.
 */
export function suggestRetailPrice(price: number): number {
  let candidate = Math.ceil(price) - 0.05;
  if (candidate < price) candidate += 1;
  return round2(candidate);
}

/**
 * Berekent kostprijs, verkoopprijs excl./incl. btw en een voorgestelde afgeronde
 * verkoopprijs voor één productvariatie, op basis van zijn cost_inputs + de
 * machines/materialen waarnaar die verwijzen. Werkt identiek voor 3D-printen,
 * UV-printen, laser engraving/cutting en sublimatie -- het enige verschil zit in
 * welke materialen/machines de gebruiker koppelt.
 */
export function calculatePrice(
  costInputs: CostInputs,
  machinesById: Map<string, Machine>,
  materialsById: Map<string, Material>
): {
  costPrice: number;
  salePrice: number | null; // excl. btw -- dit is wat naar WooCommerce geëxporteerd wordt
  salePriceInclVat: number | null;
  suggestedPrice: number | null;
  breakdown: CostBreakdown;
  warnings: string[];
} {
  const warnings: string[] = [];
  let cost = 0;
  let materialCost = 0;
  let machineCost = 0;

  for (const line of costInputs.materials ?? []) {
    const material = materialsById.get(line.material_id);
    if (!material) {
      warnings.push("Een materiaal in dit product bestaat niet meer -- controleer de materiaallijnen.");
      continue;
    }
    // price_per_unit staat per 'unit'. Voor filament (unit 'kg') geven we quantity in gram op,
    // dus rekenen we om naar kg. Voor alle andere eenheden (ml, vel, stuk, m2) is quantity al
    // in dezelfde eenheid als price_per_unit.
    const qty = material.unit === "kg" ? line.quantity / 1000 : line.quantity;
    materialCost += qty * material.price_per_unit;
  }

  for (const line of costInputs.machine_time ?? []) {
    const machine = machinesById.get(line.machine_id);
    if (!machine) {
      warnings.push("Een machine in dit product bestaat niet meer -- controleer de machinetijd-lijnen.");
      continue;
    }
    const { depreciationPerHour, powerCostPerHour } = machineHourlyCosts(machine);
    const hoursValue = toHours(line.hours, line.unit);
    machineCost += hoursValue * (depreciationPerHour + powerCostPerHour);
  }

  const laborCost = (costInputs.labor_minutes / 60) * costInputs.labor_rate;
  const otherCost = costInputs.other_costs ?? 0;
  cost = materialCost + machineCost + laborCost + otherCost;

  const margin = costInputs.margin ?? 0;
  const salePrice = margin < 1 ? cost / (1 - margin) : null;
  if (margin >= 1) {
    warnings.push("Marge moet lager zijn dan 100% om een verkoopprijs te kunnen berekenen.");
  }

  const vatRate = costInputs.vat_rate ?? DEFAULT_VAT_RATE;
  const salePriceInclVat = salePrice !== null ? salePrice * (1 + vatRate) : null;
  // Voor hobbyverkoop zonder BTW: suggestedPrice is gebaseerd op verkoopprijs ZONDER BTW
  const suggestedPrice = salePrice !== null ? suggestRetailPrice(salePrice) : null;

  return {
    costPrice: round2(cost),
    salePrice: salePrice !== null ? round2(salePrice) : null,
    salePriceInclVat: salePriceInclVat !== null ? round2(salePriceInclVat) : null,
    suggestedPrice,
    breakdown: { materials: materialCost, machines: machineCost, labor: laborCost, other: otherCost },
    warnings,
  };
}

export type CostBreakdown = { materials: number; machines: number; labor: number; other: number };

/**
 * Netto-marge op de uiteindelijke (afgeronde) verkoopprijs -- dus inclusief
 * het effect van het naar boven afronden op ,95. Dit is de marge die je echt overhoudt.
 */
export function effectiveMargin(costPrice: number | null, suggestedPrice: number | null, vatRate: number): number | null {
  if (costPrice == null || suggestedPrice == null || suggestedPrice <= 0) return null;
  // Voor hobbyverkoop: suggestedPrice is al excl. BTW, dus geen conversie nodig
  return (suggestedPrice - costPrice) / suggestedPrice;
}

/** Totaal aantal machine-uren van een variant (voor "winst per machine-uur"). */
export function totalMachineHours(costInputs: CostInputs): number {
  return (costInputs.machine_time ?? []).reduce((sum, l) => sum + toHours(l.hours, l.unit), 0);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
