import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Productiebestanden van een product: mappen op de NAS (relatief t.o.v. MakerProducts).
 *  - catalog: het catalogusmodel waaruit het product gemaakt is (maker_picks) -> zijn LaserReady/PrintReady-sets;
 *  - shop / manual: de map in _Shop (kopie van de PRODUCTS-map op de pc) uit product_files.
 * Downloaden gaat via /api/files (zie app/api/files/route.ts).
 */
export type ProductFolder = { path: string; label: string; source: "catalog" | "shop" | "manual"; confirmed: boolean; score?: number };

export const NAS_SHARE = "\\\\NASMAT\\MakerProducts";

export function nasPath(rel: string): string {
  return `${NAS_SHARE}\\${rel.replace(/\//g, "\\")}`;
}

/** Mappen per product-id. Onbevestigde voorstellen enkel als includeSuggestions (productpagina). */
export async function loadProductFolders(
  supabase: SupabaseClient, productIds: string[], includeSuggestions = false,
): Promise<Map<string, ProductFolder[]>> {
  const out = new Map<string, ProductFolder[]>();
  if (productIds.length === 0) return out;
  const add = (id: string, f: ProductFolder) => out.set(id, [...(out.get(id) ?? []), f]);
  const [{ data: picks }, { data: files }] = await Promise.all([
    supabase.from("maker_picks").select("model_id, product_id").in("product_id", productIds),
    supabase.from("product_files").select("product_id, path, source, confirmed, score").in("product_id", productIds),
  ]);
  const modelIds = (picks ?? []).map((p) => p.model_id);
  const { data: models } = modelIds.length
    ? await supabase.from("maker_models").select("id, path, laser_ready, technique").in("id", modelIds)
    : { data: [] as { id: string; path: string; laser_ready: string[]; technique: string }[] };
  const modelById = new Map((models ?? []).map((m) => [m.id, m]));
  for (const p of picks ?? []) {
    const m = modelById.get(p.model_id);
    if (!m) continue;
    add(p.product_id, { path: m.path, label: "Catalogusmodel (met LaserReady/PrintReady)", source: "catalog", confirmed: true });
  }
  for (const f of files ?? []) {
    if (!f.confirmed && !includeSuggestions) continue;
    add(f.product_id, {
      path: f.path, source: f.source, confirmed: f.confirmed, score: f.score,
      label: f.source === "manual" ? "Zelf gekozen map" : f.confirmed ? "Map uit je PRODUCTS-map" : "Voorstel uit je PRODUCTS-map",
    });
  }
  return out;
}

async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
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
