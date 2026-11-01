import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Productiebestanden van een product: mappen op de NAS (relatief t.o.v. MakerProducts).
 *  - catalog: de map van het catalogusmodel (product_files met model_id; geschreven door tools/maker/shop_links.py,
 *    "Map koppelen" of een bevestigd voorstel van match_shop_files.py). Regel 2026-10-29: alles blijft in de
 *    Catalogus, er wordt niets meer naar _Shop gekopieerd. Zolang er nog geen rij is, tonen we de modelmap via maker_picks;
 *  - manual: een zelf gekozen pad dat geen catalogusmodel is; shop: oude koppeling met een map in _Shop.
 * Downloaden gaat via /api/files (zie app/api/files/route.ts).
 */
export type ProductFolder = { path: string; label: string; source: "catalog" | "shop" | "manual"; confirmed: boolean; score?: number; modelId?: string };

export const NAS_SHARE = "\\\\NASMAT\\MakerProducts";

export function nasPath(rel: string): string {
  return `${NAS_SHARE}\\${rel.replace(/\//g, "\\")}`;
}

/** Mappen per product-id. Onbevestigde voorstellen enkel als includeSuggestions (productpagina, productenlijst). */
export async function loadProductFolders(
  supabase: SupabaseClient, productIds: string[], includeSuggestions = false,
): Promise<Map<string, ProductFolder[]>> {
  const out = new Map<string, ProductFolder[]>();
  if (productIds.length === 0) return out;
  const add = (id: string, f: ProductFolder) => out.set(id, [...(out.get(id) ?? []), f]);
  const [{ data: picks }, { data: files }] = await Promise.all([
    supabase.from("maker_picks").select("model_id, product_id").in("product_id", productIds),
    supabase.from("product_files").select("product_id, path, source, confirmed, score, model_id").in("product_id", productIds),
  ]);
  const modelIds = (picks ?? []).map((p) => p.model_id);
  const { data: models } = modelIds.length
    ? await supabase.from("maker_models").select("id, path, laser_ready, technique").in("id", modelIds)
    : { data: [] as { id: string; path: string; laser_ready: string[]; technique: string }[] };
  const modelById = new Map((models ?? []).map((m) => [m.id, m]));
  const copied = new Set((files ?? []).filter((f) => f.source === "catalog").map((f) => `${f.product_id}:${f.model_id}`));
  // product met een eigen bevestigde map in _Shop: de modelmap in de catalogus is daar het origineel van -- niet als
  // tweede pad tonen; de link "model in de catalogus" komt bij de _Shop-map
  const ownFolder = new Set((files ?? []).filter((f) => f.confirmed && f.source !== "catalog").map((f) => f.product_id));
  const hiddenModel = new Map<string, string>();
  for (const p of picks ?? []) {
    const m = modelById.get(p.model_id);
    if (!m || copied.has(`${p.product_id}:${p.model_id}`)) continue;
    if (ownFolder.has(p.product_id)) { hiddenModel.set(p.product_id, m.id); continue; }
    add(p.product_id, { path: m.path, label: "Catalogusmodel (met LaserReady/PrintReady)", source: "catalog", confirmed: true, modelId: m.id });
  }
  for (const f of files ?? []) {
    if (!f.confirmed && !includeSuggestions) continue;
    if (f.source === "catalog" && !f.path.startsWith("_Shop/") && ownFolder.has(f.product_id)) {
      if (f.model_id) hiddenModel.set(f.product_id, f.model_id);
      continue;
    }
    add(f.product_id, {
      path: f.path, source: f.source, confirmed: f.confirmed, score: f.score, modelId: f.model_id ?? undefined,
      label: f.source === "catalog"
        ? (f.path.startsWith("_Shop/") ? "Uit de catalogus (oude kopie in _Shop)" : f.confirmed ? "Catalogusmodel" : "Voorstel uit de catalogus")
        : f.source === "manual" ? "Zelf gekozen map" : f.confirmed ? "Map in _Shop" : "Voorstel uit _Shop",
    });
  }
  for (const [pid, modelId] of hiddenModel) {
    const own = out.get(pid)?.find((f) => f.confirmed && f.source !== "catalog");
    if (own && !own.modelId) own.modelId = modelId;
  }
  return out;
}

export async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token}` };
}

export type FolderListing = { dirs: string[]; files: { name: string; size: number }[] };

export async function listFolder(supabase: SupabaseClient, rel: string): Promise<FolderListing> {
  const res = await fetch(`/api/files?path=${encodeURIComponent(rel)}`, { headers: await authHeader(supabase) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

/** Bestand (mode "file") of map als zip (mode "zip") downloaden naar de browser. */
export async function downloadPath(supabase: SupabaseClient, rel: string, mode: "file" | "zip"): Promise<void> {
  const res = await fetch(`/api/files?path=${encodeURIComponent(rel)}&download=${mode === "zip" ? "zip" : "1"}`, {
    headers: await authHeader(supabase),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rel.split("/").pop() + (mode === "zip" ? ".zip" : "");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Samenvatting per product voor de productenlijst: catalogusmodel, bevestigde map, open voorstel. */
export type FileStatus = { modelId: string | null; hasFolder: boolean; hasSuggestion: boolean };
export type FileFilter = "all" | "catalog" | "folder" | "suggestion" | "none";

export async function loadFileStatus(supabase: SupabaseClient): Promise<Map<string, FileStatus>> {
  const [{ data: picks }, { data: files }] = await Promise.all([
    supabase.from("maker_picks").select("model_id, product_id").not("product_id", "is", null),
    supabase.from("product_files").select("product_id, source, confirmed, model_id"),
  ]);
  const out = new Map<string, FileStatus>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { modelId: null, hasFolder: false, hasSuggestion: false }));
    return s;
  };
  for (const p of picks ?? []) { const s = get(p.product_id); s.modelId ??= p.model_id; s.hasFolder = true; }
  for (const f of files ?? []) {
    const s = get(f.product_id);
    if (f.source === "catalog" && f.model_id && f.confirmed) s.modelId ??= f.model_id;   // voorstel telt niet als "Catalogus"
    if (f.confirmed) s.hasFolder = true; else s.hasSuggestion = true;
  }
  return out;
}

export function matchesFileFilter(s: FileStatus | undefined, filter: FileFilter): boolean {
  switch (filter) {
    case "catalog": return !!s?.modelId;
    case "folder": return !!s?.hasFolder;
    case "suggestion": return !!s?.hasSuggestion && !s.hasFolder;
    case "none": return !s?.hasFolder && !s?.hasSuggestion;
    default: return true;
  }
}

/** Bestand van de klant bij een bestelregel (opgeladen logo/afbeelding of preview van de gravure-plugin). */
export type CustomerFile = { label: string; url: string; fileName: string };

const CUSTOMER_FILE = /^https?:\/\/\S+\/wp-content\/uploads\/tdp-gravure\/\S+\.(png|jpe?g|webp|gif|svg|pdf)$/i;

/** Splitst de opties van een bestelregel in gewone opties en bestanden van de klant. */
export function splitOrderMeta(meta: { key: string; value: string }[] | null, prefix: string): {
  options: { key: string; value: string }[];
  files: CustomerFile[];
} {
  const options: { key: string; value: string }[] = [];
  const files: CustomerFile[] = [];
  for (const m of meta ?? []) {
    const v = String(m.value ?? "").trim();
    if (CUSTOMER_FILE.test(v)) {
      const ext = v.split(".").pop()!.toLowerCase();
      const slug = m.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bestand";
      files.push({ label: m.key, url: v, fileName: `${prefix}-${slug}.${ext}` });
    } else {
      options.push(m);
    }
  }
  return { options, files };
}

/** Alle bestanden van de klant bij een bestelregel als één zip downloaden. */
export async function downloadCustomerFiles(supabase: SupabaseClient, zipName: string, files: CustomerFile[]): Promise<void> {
  const res = await fetch("/api/order-files", {
    method: "POST",
    headers: { ...(await authHeader(supabase)), "Content-Type": "application/json" },
    body: JSON.stringify({ name: zipName, files: files.map((f) => ({ url: f.url, name: f.fileName })) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
