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
};

export type MaterialLine = {
  material_id: string;
  quantity: number; // in de eenheid van het materiaal (g, ml, vel, stuk, ...)
};

export type MachineTimeLine = {
  machine_id: string;
  hours: number;
};

export type CostInputs = {
  materials: MaterialLine[];
  machine_time: MachineTimeLine[];
  labor_minutes: number;
  labor_rate: number; // €/u
  other_costs: number; // €
  margin: number; // 0-1, bv. 0.45 = 45%
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  process_type: "3d_print" | "uv_print" | "laser_engraving" | "laser_cutting" | "sublimation";
  published: boolean;
  attribute_names: string[];
};

export type ProductVariation = {
  id: string;
  product_id: string;
  sku: string;
  attribute_values: Record<string, string>;
  cost_inputs: CostInputs;
  cost_price: number | null;
  sale_price: number | null;
};

export const PROCESS_TYPE_LABELS: Record<Product["process_type"], string> = {
  "3d_print": "3D-printen",
  uv_print: "UV-printen",
  laser_engraving: "Laser engraving",
  laser_cutting: "Laser cutting",
  sublimation: "Sublimatie",
};

export const EMPTY_COST_INPUTS: CostInputs = {
  materials: [],
  machine_time: [],
  labor_minutes: 0,
  labor_rate: 18,
  other_costs: 0,
  margin: 0.45,
};
