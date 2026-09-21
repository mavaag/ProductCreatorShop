export type Machine = {
  id: string;
  name: string;
  category: string;
  purchase_price: number;
  expected_lifetime_hours: number;
  avg_power_w: number;
  electricity_price: number;
};

export type Material = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price_per_unit: number;
  stock_quantity: number | null; // null = voorraad niet bijgehouden
  min_stock: number | null;
  supplier_name: string | null;
  supplier_url: string | null;
};

export type MaterialLine = {
  material_id: string;
  quantity: number; // in de eenheid van het materiaal (g, ml, vel, stuk, ...)
};

export type TimeUnit = "u" | "min" | "sec";

export type MachineTimeLine = {
  machine_id: string;
  hours: number; // waarde in de eenheid hieronder (ondanks de veldnaam -- zo blijft bestaande data geldig)
  unit?: TimeUnit; // ontbreekt in oudere/geïmporteerde data -> dan geldt "u" (uren)
};

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = { u: "uur", min: "min", sec: "sec" };

/** Zet een tijdsduur in u/min/sec om naar uren, voor gebruik in de prijsberekening. */
export function toHours(amount: number, unit: TimeUnit | undefined): number {
  switch (unit) {
    case "min": return amount / 60;
    case "sec": return amount / 3600;
    default: return amount; // "u" of onbekend -> aannemen dat het al in uren staat
  }
}

export type CostInputs = {
  materials: MaterialLine[];
  machine_time: MachineTimeLine[];
  labor_minutes: number;
  labor_rate: number; // €/u
  other_costs: number; // €
  margin: number; // 0-1, bv. 0.45 = 45%
  vat_rate: number; // 0-1, bv. 0.21 = 21% -- ontbreekt in oudere/geïmporteerde data, dan valt de app terug op 21%
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  process_type: "3d_print" | "uv_print" | "laser_engraving" | "laser_cutting" | "sublimation";
  published: boolean;
  attribute_names: string[];
  description: string;
  categories: string; // WooCommerce-notatie, bv. "Woondecoratie > Vazen, Cadeaus"
  image_url: string; // één of meerdere URL's, gescheiden door komma
  weight_kg: number | null;
  shipping_class: string;
  last_exported_at: string | null;
  updated_at: string;
};

export type ProductVariation = {
  id: string;
  product_id: string;
  sku: string;
  attribute_values: Record<string, string>;
  cost_inputs: CostInputs;
  cost_price: number | null;
  sale_price: number | null; // excl. btw
  suggested_price: number | null; // afgeronde ,95-prijs incl. btw -- dit wordt geëxporteerd naar WooCommerce
  exported_price: number | null; // suggested_price zoals die de laatste keer geëxporteerd werd
};

export type PriceHistoryEntry = {
  id: string;
  variation_id: string;
  cost_price: number | null;
  sale_price: number | null;
  suggested_price: number | null;
  margin: number | null;
  reason: string;
  created_at: string;
};

export const DEFAULT_MIN_MARGIN = 0.3;

export const PROCESS_TYPE_LABELS: Record<Product["process_type"], string> = {
  "3d_print": "3D-printen",
  uv_print: "UV-printen",
  laser_engraving: "Laser engraving",
  laser_cutting: "Laser cutting",
  sublimation: "Sublimatie",
};

export const DEFAULT_VAT_RATE = 0.21; // Belgisch standaardtarief -- pas aan per variant indien nodig

export const EMPTY_COST_INPUTS: CostInputs = {
  materials: [],
  machine_time: [],
  labor_minutes: 0,
  labor_rate: 18,
  other_costs: 0,
  margin: 0.45,
  vat_rate: DEFAULT_VAT_RATE,
};
