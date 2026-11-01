/**
 * Zoekt de productfoto achter een leverancierslink (Temu, AliExpress, xTool, Shopify-winkels, ...), voor de
 * Materialen-pagina. Volgorde:
 *   1. een afbeelding in de link zelf (bv. Temu: ?top_gallery_url=https://img.kwcdn.com/...jpg)
 *   2. de link is zelf een afbeelding
 *   3. in de HTML: og:image / twitter:image, Amazon (data-old-hires / landingImage), JSON-LD "image"
 * Werkt niet altijd (sommige winkels blokkeren of tonen enkel via JavaScript) -- dan laad je zelf een foto op.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/** Enkel publieke http(s)-adressen: geen localhost of interne netwerken (de server staat in het thuisnetwerk). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal")) return false;
  if (h.includes(":") || h.startsWith("[")) return false; // IPv6-literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");
}

function absolute(src: string, base: string): string | null {
  try {
    const u = new URL(decodeHtml(src.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Afbeelding die als parameter in de link zelf zit (Temu e.d.). */
function imageFromQuery(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    for (const [, v] of Array.from(u.searchParams.entries())) {
      if (/^https?:\/\//i.test(v) && IMG_EXT.test(v)) return v;
    }
  } catch {
    /* ongeldige link */
  }
  return null;
}

function imageFromHtml(html: string, base: string): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i,
    /data-old-hires=["']([^"']+)/i, // Amazon
    /id=["']landingImage["'][^>]*src=["']([^"']+)/i, // Amazon
    /"image"\s*:\s*\[?\s*"([^"]+)"/i, // JSON-LD
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const abs = absolute(m[1], base);
      if (abs) return abs;
    }
  }
  return null;
}

/** Geeft de URL van de productfoto, of null als er niets gevonden werd. */
export async function findSupplierImage(pageUrl: string): Promise<string | null> {
  const fromQuery = imageFromQuery(pageUrl);
  if (fromQuery) return fromQuery;
  if (IMG_EXT.test(new URL(pageUrl).pathname)) return pageUrl;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.8" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`de winkel antwoordde met ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("image/")) return res.url || pageUrl;
  const html = (await res.text()).slice(0, 1_500_000);
  return imageFromHtml(html, res.url || pageUrl);
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

/** Downloadt een afbeelding (max 8 MB). */
export async function downloadImage(url: string): Promise<{ data: ArrayBuffer; type: string; ext: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`afbeelding niet te downloaden (${res.status})`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) throw new Error("de gevonden link is geen afbeelding");
  const data = await res.arrayBuffer();
  if (data.byteLength > 8 * 1024 * 1024) throw new Error("afbeelding is groter dan 8 MB");
  return { data, type, ext: EXT[type] ?? "jpg" };
}
