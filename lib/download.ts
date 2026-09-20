import { supabase } from "./supabaseClient";

/**
 * Haalt een export op met het sessietoken van de ingelogde gebruiker (zodat de database-beveiliging
 * geldt) en laat de browser het bestand downloaden. Geeft het aantal geëxporteerde producten terug.
 */
export async function downloadExport(params: Record<string, string>): Promise<number> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/export${qs ? "?" + qs : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Export mislukt (${res.status})`);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "woocommerce-export.csv";
  const count = Number(res.headers.get("X-Exported-Products") ?? 0);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return count;
}
