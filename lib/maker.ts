import { SupabaseClient } from "@supabase/supabase-js";
import { CostInputs, EMPTY_COST_INPUTS, Product } from "@/lib/types";
import { nextAvailableSku, slugifyForSku } from "@/lib/sku";

/** Eén model uit de MakerProducts-bibliotheek (tabel maker_models, zonder het zware doc-veld). */
export type MakerModel = {
  id: string;
  title: string;
  kind: "Lasercut" | "3D-Print" | "UV-Print" | "Engraving" | "Sublimation" | string;
  collection: string;
  category: string;
  path: string;
  laser_ready: string[];
  thumb_url: string | null;
  has_doc: boolean;
  woo_product_id: number | null;
  /** merk/personage van iemand anders (doc.license.trademark): kan later verwijderd moeten worden */
  is_trademark: boolean;
  /** geschat aantal verschillende ontwerpen in de map (build_catalog.py) */
  designs: number;
  /** bundel waaruit dit model kwam ("" = geen) */
  bundle: string;
  /** "resin" / "fdm" / "laser" / "uv" / "engraving" / "sublimation", of "" = nog niet bekend (uit _technique.txt, de
   *  Inbox-techniekmap, de hoofdmap in de bibliotheek of de bestanden) */
  technique: string;
};

export const MAKER_MODEL_COLUMNS = "id, title, kind, collection, category, path, laser_ready, thumb_url, has_doc, woo_product_id, is_trademark, designs, bundle, technique";

export type MakerPick = { model_id: string; product_id: string | null; created_at: string };

/** Productdocument (schema 1) zoals de generator het in _catalog/products/<id>.json schrijft. */
export type MakerDoc = {
  schema: number;
  catalog_id: string;
  source_title: string;
  source_path: string;
  status: string;
  product: {
    name: string;
    sku_base: string;
    process_type: Product["process_type"];
    type: "simple" | "variable";
    categories: string;
    tags: string[];
    short_description: string;
    description: string;
    images: string[]; // paden binnen MakerProducts
    image_urls?: string[]; // publieke URL's, ingevuld door tools/maker/publish_docs.py
  };
  woo_existing: { id: number; name: string; sku: string; type: string; status: string; price: string; categories: string[]; action: string } | null;
  attributes: { name: string; default: string; options: string[] }[];
  variations: { attributes: Record<string, string>; production: Record<string, any> }[];
  notes_internal: string[];
  /** status "non-commercial" = de ontwerper verbiedt verkoop (bv. CC BY-NC): eerst toestemming vragen. */
  license: { status: string; note: string; trademark?: boolean };
};

/** Machinetijd-regels zoals een nieuw product ze krijgt (zie app/products/new): 1 regel, 2 bij UV/sublimatie. */
function emptyCostInputs(processType: string) {
  const machineLines = processType === "sublimation" || processType === "uv_print" ? 2 : 1;
  return { ...EMPTY_COST_INPUTS, machine_time: Array.from({ length: machineLines }, () => ({ machine_id: "", hours: 0 })) };
}

/** Resin-gegevens die resin_plates.py in variations[].production zet (zie maker-agent/AGENT_PROMPT.md). */
type ResinProduction = { technology?: string; printer?: string; print_hours?: number; resin_ml?: number };

/**
 * Kostenopbouw voor een resinvariant vooraf invullen uit het document: machinetijd op de gekozen printer (één figuur)
 * en de resin (eerste materiaal met "resin" in naam of categorie, omgerekend naar zijn eenheid). Wat niet gevonden
 * wordt, blijft leeg -- dat vul je dan zelf in.
 */
async function resinCostInputs(supabase: SupabaseClient, prod: ResinProduction): Promise<CostInputs> {
  const base = emptyCostInputs("resin_print");
  if (prod.technology !== "resin" || !prod.print_hours) return base;
  const [{ data: machines }, { data: materials }] = await Promise.all([
    supabase.from("machines").select("id, name, category"),
    supabase.from("materials").select("id, name, category, unit"),
  ]);
  // "UniFormation GK3 Ultra" -> zoeken op het typenummer (GK3, M3 MAX, SATURN 3)
  const key = (prod.printer ?? "").toUpperCase().match(/GK3|M3 MAX|SATURN 3/)?.[0];
  const machine = (machines ?? []).find((m) => key && m.name.toUpperCase().includes(key))
    ?? (machines ?? []).find((m) => m.category === "resin_printer");
  const resin = (materials ?? []).find((m) => /resin/i.test(`${m.name} ${m.category}`));
  const ml = prod.resin_ml ?? 0;
  const perUnit: Record<string, number> = { ml: 1, l: 1 / 1000, g: 1.1, kg: 1.1 / 1000 };   // resin ~1,1 g/ml
  return {
    ...base,
    machine_time: [{ machine_id: machine?.id ?? "", hours: Math.round(prod.print_hours * 100) / 100 }],
    materials: resin && ml && perUnit[resin.unit]
      ? [{ material_id: resin.id, quantity: Math.round(ml * perUnit[resin.unit] * 1000) / 1000 }]
      : [],
  };
}

/**
 * Wall Art (uv_print): alle posters hebben per MATERIAL/Size dezelfde kostenopbouw (printer, plaat/kader, inkt, arbeid)
 * en prijs. Per variant nemen we de meest voorkomende opbouw van de bestaande posters met dezelfde attribuutwaarden
 * over (enkel varianten waarvan elke machinelijn een machine heeft). Geen match -> null (dan leeg, zelf invullen).
 */
async function siblingCostInputs(supabase: SupabaseClient, processType: string) {
  const { data } = await supabase
    .from("product_variations")
    .select("attribute_values, cost_inputs, suggested_price, products!inner(process_type)")
    .eq("products.process_type", processType);
  const key = (a: Record<string, string>) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]]));
  const counts = new Map<string, Map<string, { n: number; cost_inputs: CostInputs; suggested_price: number | null }>>();
  for (const v of data ?? []) {
    const ci = v.cost_inputs as CostInputs;
    if (!ci?.machine_time?.length || ci.machine_time.some((l) => !l.machine_id)) continue;
    const k = key(v.attribute_values ?? {});
    const perAttr = counts.get(k) ?? new Map();
    const id = JSON.stringify([ci, v.suggested_price]);
    const hit = perAttr.get(id) ?? { n: 0, cost_inputs: ci, suggested_price: v.suggested_price };
    hit.n++;
    perAttr.set(id, hit);
    counts.set(k, perAttr);
  }
  return (attrs: Record<string, string>) => {
    const options = Array.from(counts.get(key(attrs))?.values() ?? []);
    return options.sort((a, b) => b.n - a.n)[0] ?? null;
  };
}

/**
 * Maakt van een productdocument een (concept)product met al zijn varianten in de beheertool en koppelt het
 * aan de selectie in maker_picks. De prijsberekening blijft leeg -- die vul je daarna in op de productpagina -- behalve
 * bij resin, waar printer, printtijd en resin uit resin_plates.py al ingevuld worden, en bij Wall Art (uv_print), waar
 * kostenopbouw en prijs van de bestaande posters met dezelfde MATERIAL/Size overgenomen worden.
 */
/** opts.categories: de categorie die je in de Catalogus koos (anders de voorgestelde uit het document). */
export async function createProductFromDoc(supabase: SupabaseClient, doc: MakerDoc, opts: { categories?: string } = {}): Promise<string> {
  const p = doc.product;
  const attributeNames = doc.attributes.map((a) => a.name);
  const sku = await nextAvailableSku(supabase, "products", p.sku_base);
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      sku,
      name: p.name,
      process_type: p.process_type,
      published: false, // eerst nakijken en prijzen invullen, daarna zelf publiceren
      attribute_names: attributeNames,
      default_attribute_values: Object.fromEntries(doc.attributes.map((a) => [a.name, a.default])),
      description: p.description,
      short_description: p.short_description,
      categories: opts.categories?.trim() || p.categories,
      image_url: (p.image_urls ?? []).join(","),
    })
    .select()
    .single();
  if (error) throw error;

  const rows = [];
  const sibling = p.process_type === "uv_print" ? await siblingCostInputs(supabase, p.process_type) : null;
  const variations = attributeNames.length === 0
    ? [{ attributes: {} as Record<string, string>, production: doc.variations[0]?.production ?? {} }]
    : doc.variations;
  for (const v of variations) {
    const values = attributeNames.map((n) => v.attributes[n]).filter(Boolean);
    const variationSku = values.length === 0
      ? product.sku
      : await nextAvailableSku(supabase, "product_variations", `${product.sku}-` + values.map(slugifyForSku).join("-"));
    const copied = sibling?.(v.attributes);
    const cost_inputs = copied ? copied.cost_inputs
      : p.process_type === "resin_print" ? await resinCostInputs(supabase, v.production as ResinProduction)
      : emptyCostInputs(p.process_type);
    rows.push({ product_id: product.id, sku: variationSku, attribute_values: v.attributes, cost_inputs,
                ...(copied?.suggested_price != null ? { suggested_price: copied.suggested_price } : {}) });
  }
  const { error: varError } = await supabase.from("product_variations").insert(rows);
  if (varError) {
    await supabase.from("products").delete().eq("id", product.id); // geen half product achterlaten
    throw varError;
  }

  const { error: pickError } = await supabase.from("maker_picks").upsert({ model_id: doc.catalog_id, product_id: product.id });
  if (pickError) throw pickError;
  return product.id as string;
}

/** Licentie die verkoop niet zomaar toelaat (bv. CC BY-NC): de Catalogus waarschuwt voor je een product maakt. */
export function licenseWarning(doc: MakerDoc | null | undefined): string | null {
  if (!doc?.license) return null;
  if (doc.license.status === "non-commercial") return doc.license.note || "Niet-commerciële licentie.";
  return null;
}

/** Zelf gemaakte koppeling model -> WooCommerce-product (tabel maker_woo_links); woo_product_id null = bewust niet in de shop. */
export type MakerWooLink = { model_id: string; woo_product_id: number | null; woo_name: string; woo_permalink: string };

/** Shopproduct van een model: jouw koppeling gaat voor op de suggestie van de agent (doc.woo_existing). */
export function shopProductId(m: MakerModel, link: MakerWooLink | undefined): number | null {
  return link ? link.woo_product_id : m.woo_product_id;
}

/**
 * Vanaf zoveel ontwerpen is een map waarschijnlijk een bundel van losse modellen. Laser: verschillende bestandsnamen
 * (zonder dikte/maat), dus pas vanaf 8. 3D-print: submappen met elk een eigen model (maat- en supportmappen tellen
 * niet), dus vanaf 2.
 */
export const BUNDLE_MIN_DESIGNS = 8;
export const BUNDLE_MIN_DESIGNS_3D = 2;

/** Mag "Bundel opsplitsen" bij dit model? Niet bij een al opgesplitst model, een vaste collectie of te weinig ontwerpen. */
export function canSplit(m: MakerModel): boolean {
  const min = m.kind === "3D-Print" ? BUNDLE_MIN_DESIGNS_3D : BUNDLE_MIN_DESIGNS;
  if (DESIGN_KINDS.includes(m.kind)) return false;   // UV/gravure/sublimatie: één ontwerp per map
  return !m.bundle && m.collection !== "Heads AAS26" && (m.designs ?? 0) >= min;
}

/** Hoofdmappen met ontwerpen (fase 2, 2026-10-28): UV-Print/, Engraving/, Sublimation/ in de bibliotheek. */
export const DESIGN_KINDS = ["UV-Print", "Engraving", "Sublimation"];

export type Technique = "laser" | "resin" | "fdm" | "uv" | "engraving" | "sublimation";

/**
 * Techniek in de Catalogus. 3D-print = FDM (gebruikerskeuze 2026-10-26); een 3D-model is enkel Resin als dat
 * gemarkeerd of herkend is (technique "resin"). UV-print, gravure en sublimatie volgen uit hun hoofdmap.
 */
export function techniqueOf(m: Pick<MakerModel, "kind" | "technique">): Technique {
  if (m.kind === "Lasercut") return "laser";
  if (m.kind === "UV-Print") return "uv";
  if (m.kind === "Engraving") return "engraving";
  if (m.kind === "Sublimation") return "sublimation";
  return m.technique === "resin" ? "resin" : "fdm";
}

export const TECHNIQUE_LABELS: Record<Technique, string> = {
  laser: "Laser", fdm: "3D-print FDM", resin: "3D-print Resin", uv: "UV-print", engraving: "Gravure", sublimation: "Sublimatie",
};

/** Label op een catalogus-kaartje. */
export function techniqueLabel(m: Pick<MakerModel, "kind" | "technique">): string {
  return TECHNIQUE_LABELS[techniqueOf(m)];
}

/** Opdracht voor de MakerProducts-agent op de NAS (tabel maker_jobs, zie maker-agent/). */
export type MakerJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  /** models = geselecteerde modellen verwerken; inbox = nieuwe bestanden uit _Inbox in de bibliotheek zetten */
  kind?: "models" | "inbox" | "split";
  model_ids: string[];
  items?: string[];
  then_process?: boolean;
  note: string;
  progress: string;
  results: Record<string, { status: "ok" | "failed" | "skipped"; note: string }>;
  log_tail: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** Hartslag van de agent (tabel maker_agent, één rij). */
export type MakerAgent = {
  seen_at: string | null;
  status: string;
  version: string;
  /** inhoud van \\NASMAT\MakerProducts\_Inbox; ready = de laatste 2 minuten niet meer gewijzigd (kopiëren klaar) */
  inbox?: { name: string; kind: "file" | "folder"; files: number; size: number; ready: boolean; technique?: string; wall_art?: boolean }[];
  inbox_info?: string;
};

/** De agent schrijft elke minuut een hartslag; langer dan 5 minuten stil = waarschijnlijk niet actief. */
export const AGENT_ONLINE_MS = 5 * 60 * 1000;
