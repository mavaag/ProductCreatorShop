import { CostInputs, Machine, Material } from "./types";

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
 * Berekent kostprijs en verkoopprijs (excl. btw) voor één productvariatie,
 * op basis van zijn cost_inputs + de machines/materialen waarnaar die verwijzen.
 * Werkt identiek voor 3D-printen, UV-printen, laser engraving/cutting en sublimatie --
 * het enige verschil zit in welke materialen/machines de gebruiker koppelt.
 */
export function calculatePrice(
  costInputs: CostInputs,
  machinesById: Map<string, Machine>,
  materialsById: Map<string, Material>
): { costPrice: number; salePrice: number | null; warnings: string[] } {
  const warnings: string[] = [];
  let cost = 0;

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
    cost += qty * material.price_per_unit;
  }

  for (const line of costInputs.machine_time ?? []) {
    const machine = machinesById.get(line.machine_id);
    if (!machine) {
      warnings.push("Een machine in dit product bestaat niet meer -- controleer de machinetijd-lijnen.");
      continue;
    }
    const { depreciationPerHour, powerCostPerHour } = machineHourlyCosts(machine);
    cost += line.hours * (depreciationPerHour + powerCostPerHour);
  }

  cost += (costInputs.labor_minutes / 60) * costInputs.labor_rate;
  cost += costInputs.other_costs ?? 0;

  const margin = costInputs.margin ?? 0;
  const salePrice = margin < 1 ? cost / (1 - margin) : null;
  if (margin >= 1) {
    warnings.push("Marge moet lager zijn dan 100% om een verkoopprijs te kunnen berekenen.");
  }

  return { costPrice: round2(cost), salePrice: salePrice !== null ? round2(salePrice) : null, warnings };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
