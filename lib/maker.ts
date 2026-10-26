import { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_COST_INPUTS, Product } from "@/lib/types";
import { nextAvailableSku, slugifyForSku } from "@/lib/sku";

/** Eén model uit de MakerProducts-bibliotheek (tabel maker_models, zonder het zware doc-veld). */
export type MakerModel = {
  id: string;
  title: string;
  kind: "Lasercut" | "3D-Print" | string;
  collection: string;
  category: string;
  path: string;
  laser_ready: string[];
  thumb_url: string | null;
  has_doc: boolean;
  woo_product_id: number | null;
};

export const MAKER_MODEL_COLUMNS = "id, title, kind, collection, category, path, laser_ready, thumb_url, has_doc, woo_product_id";

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

/**
 * Maakt van een productdocument een (concept)product met al zijn varianten in de beheertool en koppelt het
 * aan de selectie in maker_picks. De prijsberekening blijft leeg -- die vul je daarna in op de productpagina.
 */
export async function createProductFromDoc(supabase: SupabaseClient, doc: MakerDoc): Promise<string> {
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
      categories: p.categories,
      image_url: (p.image_urls ?? []).join(","),
    })
    .select()
    .single();
  if (error) throw error;

  const rows = [];
  for (const v of attributeNames.length === 0 ? [{ attributes: {} as Record<string, string> }] : doc.variations) {
    const values = attributeNames.map((n) => v.attributes[n]).filter(Boolean);
    const variationSku = values.length === 0
      ? product.sku
      : await nextAvailableSku(supabase, "product_variations", `${product.sku}-` + values.map(slugifyForSku).join("-"));
    rows.push({ product_id: product.id, sku: variationSku, attribute_values: v.attributes, cost_inputs: emptyCostInputs(p.process_type) });
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

/** Opdracht voor de MakerProducts-agent op de NAS (tabel maker_jobs, zie maker-agent/). */
export type MakerJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  /** models = geselecteerde modellen verwerken; inbox = nieuwe bestanden uit _Inbox in de bibliotheek zetten */
  kind?: "models" | "inbox";
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
  inbox?: { name: string; kind: "file" | "folder"; files: number; size: number; ready: boolean }[];
  inbox_info?: string;
};

/** De agent schrijft elke minuut een hartslag; langer dan 5 minuten stil = waarschijnlijk niet actief. */
export const AGENT_ONLINE_MS = 5 * 60 * 1000;
