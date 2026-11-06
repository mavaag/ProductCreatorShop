import { SupabaseClient } from "@supabase/supabase-js";

/** Betaalde licentie van een artiest (tabel licenses, migratie 041). */
export type License = {
  id: string;
  artist: string;
  platform: Platform;
  profile_url: string;
  platform_user_id: string | null;
  handle: string | null;
  purchased_on: string;          // YYYY-MM-DD
  valid_until: string | null;    // YYYY-MM-DD, null = loopt niet af
  price: number | null;
  currency: string;
  terms: string;
  notes: string;
  folder: string;
  reminder_sent_for: string | null;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ModelPick = "yes" | "maybe" | "no";

/** Eén model van de artiest zoals bij de laatste update gezien (tabel license_models). */
export type LicenseModel = {
  license_id: string;
  source_id: string;
  title: string;
  url: string;
  cover_url: string | null;
  downloads: number;
  likes: number;
  prints: number;
  published_at: string | null;
  print_minutes: number | null;
  weight_g: number | null;
  profiles: number | null;
  tags: string[];
  trademark: string | null;
  pick: ModelPick | null;
  picked_at: string | null;
  maker_model_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
};

export type LicenseRefresh = { id: string; license_id: string; created_at: string; source: string; total: number; new_count: number; removed_count: number };

export type Platform = "makerworld" | "printables" | "thangs" | "patreon" | "myminifactory" | "cults3d" | "stlflix" | "other";
export const PLATFORM_LABELS: Record<Platform, string> = {
  makerworld: "MakerWorld", printables: "Printables", thangs: "Thangs", patreon: "Patreon",
  myminifactory: "MyMiniFactory", cults3d: "Cults3D", stlflix: "STLFlix", other: "Ander platform",
};
/** Voor deze platformen kan de modellenlijst opgehaald worden (knop "Modellen ophalen" op het profiel). */
export const REFRESHABLE: Platform[] = ["makerworld", "stlflix"];
/** Voor deze platformen downloadt de extensie de bestanden zelf; bij de andere download je ze zelf (STLFlix: botcontrole bij elke download). */
export const AUTO_DOWNLOAD: Platform[] = ["makerworld"];

export const PICK_LABELS: Record<ModelPick, string> = { yes: "Overnemen", maybe: "Misschien", no: "Nee" };

/** Zoveel dagen voor de vervaldatum komt er een melding in de tool en een herinneringsmail. */
export const REMIND_DAYS = 30;

export type LicenseState = { kind: "active" | "soon" | "expired" | "open"; daysLeft: number | null; label: string };

function dayDiff(iso: string, today = new Date()): number {
  const [y, m, d] = iso.split("-").map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}

export function licenseState(l: Pick<License, "valid_until">, today = new Date()): LicenseState {
  if (!l.valid_until) return { kind: "open", daysLeft: null, label: "Loopt niet af" };
  const n = dayDiff(l.valid_until, today);
  if (n < 0) return { kind: "expired", daysLeft: n, label: `Verlopen sinds ${formatDate(l.valid_until)}` };
  if (n <= REMIND_DAYS) return { kind: "soon", daysLeft: n, label: n === 0 ? "Verloopt vandaag" : `Verloopt over ${n} dag${n === 1 ? "" : "en"}` };
  return { kind: "active", daysLeft: n, label: `Geldig tot ${formatDate(l.valid_until)}` };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Datum + 1 jaar (de meeste licenties lopen een jaar), als YYYY-MM-DD. */
export function plusOneYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y + 1, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);   // 29 februari -> 28 februari
  return t.toISOString().slice(0, 10);
}

/** Merken en personages van anderen: je licentie dekt het ontwerp van de artiest, niet het merk zelf.
 *  Zelfde lijst als in tools/licenses/licenses_lib.py. */
const TRADEMARKS: [RegExp, string][] = [
  [/pok[eé]mon|pikachu/i, "Pokémon (Nintendo)"],
  [/crash bandicoot/i, "Crash Bandicoot (Activision)"],
  [/garfield/i, "Garfield (Paws Inc.)"],
  [/godzill|kaiju/i, "Godzilla (Toho)"],
  [/toothless|night fury|light fury/i, "How to Train Your Dragon (DreamWorks)"],
  [/baymax/i, "Big Hero 6 (Disney)"],
  [/grinch/i, "The Grinch (Dr. Seuss)"],
  [/stitch|mickey|minnie|disney|frozen|olaf/i, "Disney"],
  [/mario|luigi|yoshi|zelda|kirby/i, "Nintendo"],
  [/star wars|baby yoda|grogu|mandalorian/i, "Star Wars (Disney)"],
  [/marvel|spider-?man|batman|superman|hello kitty|labubu|minecraft|sonic/i, "merk van een ander"],
];
export function detectTrademark(title: string): string | null {
  for (const [re, name] of TRADEMARKS) if (re.test(title)) return name;
  return null;
}

/** Modelgegevens zoals de knop op MakerWorld (of Claude) ze aanlevert. */
export type ImportItem = {
  id: string; title: string; cover?: string | null; dl?: number; lk?: number; pr?: number;
  date?: string | null; w?: number | null; tm?: number | null; ni?: number | null; tags?: string[];
  url?: string | null;            // link naar het model (STLFlix: /product/<slug>); anders afgeleid van het id
};
export type ImportPayload = { type: "license-import"; platform: Platform; uid?: string; handle?: string; name?: string; items: ImportItem[] };

/** Leest wat je plakte: de JSON van de knop op MakerWorld, of de ruwe API-uitvoer van MakerWorld ({hits:[...]}). */
export function parseImport(text: string): ImportPayload {
  let data: any;
  try { data = JSON.parse(text.trim()); } catch { throw new Error("Dit is geen geldige modellenlijst. Kopieer ze opnieuw met de knop op MakerWorld."); }
  if (data?.type === "license-import" && Array.isArray(data.items)) return data as ImportPayload;
  const hits = Array.isArray(data) ? data : Array.isArray(data?.hits) ? data.hits : null;
  if (!hits) throw new Error("Geen modellen gevonden in wat je plakte.");
  return { type: "license-import", platform: "makerworld", items: hits.map(fromMakerWorldHit) };
}

/** Eén model uit de MakerWorld-API omzetten (printtijd in seconden -> wordt minuten bij het opslaan). */
export function fromMakerWorldHit(h: any): ImportItem {
  const inst = (h.instances ?? []).find((i: any) => i.id === h.defaultInstanceId) ?? h.instances?.[0] ?? {};
  return {
    id: String(h.id), title: String(h.title ?? "").trim(), cover: h.coverUrl ?? null,
    dl: h.downloadCount ?? 0, lk: h.likeCount ?? 0, pr: h.printCount ?? 0,
    date: (h.publishTime ?? h.createTime ?? "").slice(0, 10) || null,
    w: inst.weight ?? null, tm: inst.prediction ?? null, ni: h.totalInstCnt ?? null, tags: (h.tags ?? []).slice(0, 12),
  };
}

export function modelUrl(platform: Platform, id: string): string {
  return platform === "makerworld" ? `https://makerworld.com/en/models/${id}` : "";
}

/** Kleinere thumbnail van de MakerWorld-CDN (de originele covers zijn tot 2 MB). */
export function thumbUrl(cover: string | null): string | null {
  if (!cover) return null;
  // STLFlix: zelfde beeld via hun CDN, verkleind (zoals op hun eigen site)
  const sf = cover.match(/^https:\/\/s3\.[a-z0-9-]+\.amazonaws\.com\/static\.stlflix\.com\/([^?]+)$/);
  if (sf) return `https://stlflix.b-cdn.net/${sf[1]}?width=400&format=webp`;
  return /bblmw\.com/.test(cover) && !cover.includes("?") ? `${cover}?x-oss-process=image/resize,w_320/format,webp` : cover;
}

/** Per licentie het moment van de eerste lijst (vroegste first_seen_at). */
export function firstImportTimes(rows: { license_id: string; first_seen_at: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const t = new Date(r.first_seen_at).getTime();
    if (!out.has(r.license_id) || t < (out.get(r.license_id) as number)) out.set(r.license_id, t);
  }
  return out;
}

/** "Nieuw": opgedoken bij een latere update (niet in de allereerste lijst) en nog niet beoordeeld. */
export function isNew(m: { first_seen_at: string; pick: string | null; removed_at?: string | null }, firstImport: number | undefined): boolean {
  if (m.pick || m.removed_at || firstImport == null) return false;
  return new Date(m.first_seen_at).getTime() - firstImport > 10 * 60 * 1000;
}

export type ImportResult = { total: number; added: number; removed: number; returned: number };

/**
 * Modellenlijst opslaan: nieuwe modellen toevoegen (first_seen_at = nu, dus "Nieuw"), bestaande bijwerken zonder je
 * keuze of de koppeling met de catalogus aan te raken, en wat niet meer in de lijst staat als verdwenen markeren.
 */
export async function importModels(supabase: SupabaseClient, license: License, payload: ImportPayload, source: string): Promise<ImportResult> {
  const items = payload.items.filter((i) => i.id && i.title);
  if (items.length === 0) throw new Error("De lijst is leeg.");
  const { data: existing, error: e0 } = await supabase.from("license_models").select("source_id, removed_at").eq("license_id", license.id);
  if (e0) throw e0;
  const known = new Map((existing ?? []).map((r) => [r.source_id as string, r.removed_at as string | null]));
  const seen = new Set(items.map((i) => i.id));
  const now = new Date().toISOString();
  const rows = items.map((i) => ({
    license_id: license.id, source_id: i.id, title: i.title, url: i.url || modelUrl(license.platform, i.id), cover_url: i.cover ?? null,
    downloads: i.dl ?? 0, likes: i.lk ?? 0, prints: i.pr ?? 0, published_at: i.date || null,
    print_minutes: i.tm != null ? Math.round(i.tm / 60) : null, weight_g: i.w != null ? Math.round(i.w) : null, profiles: i.ni ?? null,
    tags: i.tags ?? [], trademark: detectTrademark(i.title), last_seen_at: now, removed_at: null,
  }));
  for (let k = 0; k < rows.length; k += 300) {
    const { error } = await supabase.from("license_models").upsert(rows.slice(k, k + 300), { onConflict: "license_id,source_id" });
    if (error) throw error;
  }
  const gone = Array.from(known.entries()).filter(([id, rem]) => !seen.has(id) && !rem).map(([id]) => id);
  for (let k = 0; k < gone.length; k += 200) {
    const { error } = await supabase.from("license_models").update({ removed_at: now }).eq("license_id", license.id).in("source_id", gone.slice(k, k + 200));
    if (error) throw error;
  }
  const added = items.filter((i) => !known.has(i.id)).length;
  const returned = items.filter((i) => known.get(i.id)).length;
  const patch: Partial<License> = { last_refreshed_at: now, updated_at: now };
  if (payload.uid && !license.platform_user_id) patch.platform_user_id = payload.uid;
  if (payload.handle && !license.handle) patch.handle = payload.handle;
  await supabase.from("licenses").update(patch).eq("id", license.id);
  await supabase.from("license_refreshes").insert({ license_id: license.id, source, total: items.length, new_count: added, removed_count: gone.length });
  return { total: items.length, added, removed: gone.length, returned };
}

/**
 * Bladwijzer-knop voor MakerWorld. Je opent het profiel van de artiest (ingelogd, in je eigen browser) en klikt erop:
 * de knop leest de modellenlijst via de eigen website van MakerWorld en toont een venster met "Kopieer en open de
 * beheertool". In de tool plak je dat bij de juiste licentie. Er gaat niets naar een andere website.
 */
export function bookmarklet(toolOrigin: string): string {
  const js = `(async()=>{
const T=${JSON.stringify(toolOrigin)};
if(!/(^|\\.)makerworld\\.com$/.test(location.hostname)){alert('Open eerst het profiel van de artiest op makerworld.com en klik dan opnieuw.');return;}
let p;try{p=JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps;}catch(e){}
const u=p&&p.userInfo;if(!u){alert('Geen profiel gevonden. Open de pagina van de artiest (makerworld.com/@naam) en klik opnieuw.');return;}
const h=(u.personal&&u.personal.handle)||'';
const box=document.createElement('div');box.style.cssText='position:fixed;z-index:2147483647;right:20px;top:20px;width:360px;background:#0d0e1b;color:#d7e3ff;border:1px solid #00f0ff;padding:16px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
box.textContent='Modellen van '+u.name+' ophalen...';document.body.appendChild(box);
const all=[];
try{for(let o=0;o<5000;o+=50){const r=await fetch('/api/v1/design-service/published/'+u.uid+'/design?handle=@'+encodeURIComponent(h)+'&limit=50&offset='+o,{credentials:'include'});if(!r.ok)throw new Error('MakerWorld antwoordde '+r.status);const j=await r.json();const hits=j.hits||[];
for(const x of hits){const i=(x.instances||[]).find(k=>k.id===x.defaultInstanceId)||(x.instances||[])[0]||{};all.push({id:String(x.id),title:String(x.title||'').trim(),cover:x.coverUrl||null,dl:x.downloadCount||0,lk:x.likeCount||0,pr:x.printCount||0,date:String(x.publishTime||x.createTime||'').slice(0,10)||null,w:i.weight==null?null:i.weight,tm:i.prediction==null?null:i.prediction,ni:x.totalInstCnt==null?null:x.totalInstCnt,tags:(x.tags||[]).slice(0,12)});}
box.textContent='Modellen ophalen... '+all.length;if(hits.length<50)break;}}catch(e){box.textContent='Ophalen mislukt: '+e.message;return;}
const data=JSON.stringify({type:'license-import',platform:'makerworld',uid:String(u.uid),handle:h,name:u.name,items:all});
box.textContent='';const t=document.createElement('div');t.textContent=all.length+' modellen van '+u.name+' gevonden.';t.style.marginBottom='10px';box.appendChild(t);
const b=document.createElement('button');b.textContent='Kopieer en open de beheertool';b.style.cssText='background:#00f0ff;color:#07070d;border:0;padding:8px 12px;font-weight:700;cursor:pointer;margin-right:8px';
b.onclick=async()=>{try{await navigator.clipboard.writeText(data);}catch(e){const a=document.createElement('textarea');a.value=data;a.style.cssText='width:100%;height:80px;margin-top:8px';box.appendChild(a);a.select();t.textContent='Kopieer de tekst hieronder (Ctrl+C) en plak ze in de beheertool.';return;}
window.open(T+'/licenses/import?handle='+encodeURIComponent(h)+'&uid='+u.uid,'_blank');t.textContent='Gekopieerd. Plak de lijst in de beheertool (Ctrl+V).';};
const c=document.createElement('button');c.textContent='Sluiten';c.style.cssText='background:none;color:#9aa7d6;border:1px solid #2b2f5a;padding:8px 12px;cursor:pointer';c.onclick=()=>box.remove();
box.appendChild(b);box.appendChild(c);})();`;
  return "javascript:" + encodeURIComponent(js.replace(/\n/g, ""));
}

/** Ruwe indeling op naam (thema, soort, stijl) om te kunnen filteren; geen beslissing, enkel een hulp. */
export function categorize(title: string, tags: string[] = []): { theme: string; type: string; style: string } {
  // STLFlix levert zelf categorieën (tags met voorvoegsel cat:/sub:, zie de extensie): die gebruiken
  const cat = tags.find((x) => x.startsWith("cat:"));
  if (cat) {
    const sub = tags.find((x) => x.startsWith("sub:")) ?? tags.find((x) => x.startsWith("group:"));
    return { theme: cat.slice(4), type: sub ? sub.slice(sub.indexOf(":") + 1) : "Overige", style: "Cute / flexi" };
  }
  const t = title.toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => new RegExp(`\\b${w}`).test(t));
  const theme = has("christmas", "santa", "gingerbread", "gingy", "reindeer", "snow", "grinch", "winter", "gnome", "ornament", "angel", "pine", "penguin", "deer", "flowstag", "candy", "evergreen", "xmas")
    ? "Kerst" : has("valentine", "heart", "love", "rose", "couple", "lovebite") ? "Valentijn"
    : has("bat", "pumpkin", "ghost", "reaper", "spider", "halloween", "skull") ? "Halloween"
    : has("easter", "bunny egg") ? "Pasen" : "Heel het jaar";
  const type = has("candle", "tea light", "vase", "book nook", "book holder", "decor", "ornament", "display tree", "geometric", "wire heart", "wireframe", "pine trees", "christmas star", "star with", "minimalistic", "spiral snake", "lamp")
    ? "Decoratie" : has("spintop", "tic tac", "twisty", "fidget", "box", "game", "puzzle") ? "Fidget & spel"
    : has("dragon", "noodragon", "azuralis", "ironscales", "tasskak", "beaklash", "falsgar", "hydra", "dragosaur", "rexagon", "gaiarex", "light fury", "night fury", "toothless", "wyvern") ? "Draak"
    : has("rex", "raptor") || ["saur", "tops", "spino", "dino", "brachio", "pteranodon", "ankylo", "soriatitan", "therizino", "parasaurolophus", "sauropod", "godzill", "kaiju", "smilodon", "similodon", "sabertooth", "mosasaurus", "plesiosaurus", "mammoth", "dactyl"].some((w) => t.includes(w)) ? "Dino & oertijd"
    : has("shark", "megalodon", "whale", "octopus", "manta", "angler", "swordfish", "narwhal", "dolphin", "crab", "turtle", "axolotl", "fish", "jellyfish", "seahorse") ? "Zee & water"
    : "Dieren & figuren";
  const style = has("skelet") ? "Skeletal" : has("knit") ? "Knitted" : has("realistic", "cyberpunk") ? "Realistic" : "Cute / flexi";
  return { theme, type, style };
}

/* ---------- Chrome-extensie "MakerWorld-hulp" (browser-extension/makerworld-helper) ---------- */

type ExtMsg = {
  source: "apfy-ext"; type: string; reqId?: string; version?: string; ok?: boolean; error?: string;
  uid?: string; handle?: string; name?: string; items?: ImportItem[];
  key?: string; size?: number; chunks?: number; b64?: string;
};

function askExtension(msg: Record<string, unknown>, answerType: string, timeoutMs: number): Promise<ExtMsg | null> {
  return new Promise((resolve) => {
    const reqId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { window.removeEventListener("message", on); resolve(null); }, timeoutMs);
    function on(e: MessageEvent) {
      const d = e.data as ExtMsg;
      if (e.source !== window || e.origin !== window.location.origin || d?.source !== "apfy-ext" || d.type !== answerType || d.reqId !== reqId) return;
      clearTimeout(timer); window.removeEventListener("message", on); resolve(d);
    }
    window.addEventListener("message", on);
    window.postMessage({ source: "apfy-tool", reqId, ...msg }, window.location.origin);
  });
}

/** Versie van de geïnstalleerde extensie, of null als ze niet (aan) staat. */
export async function extensionVersion(): Promise<string | null> {
  const r = await askExtension({ type: "ping" }, "pong", 1500);
  return r?.version ?? null;
}

/** Nieuwste modellenlijst via de extensie (in je eigen Chrome, met je MakerWorld-login). */
export async function fetchViaExtension(license: License): Promise<ImportPayload> {
  if (license.platform === "stlflix") {
    const version = await extensionVersion();
    if (!version) throw new Error("NO_EXTENSION");
    if (!versionAtLeast(version, STLFLIX_MIN_VERSION)) throw new Error("OLD_EXTENSION");
    const r = await askExtension({ type: "sf-models" }, "sf-models-result", 900000);
    if (!r) throw new Error("De extensie gaf binnen 15 minuten geen antwoord. Ben je ingelogd op platform.stlflix.com in deze Chrome?");
    if (!r.ok || !r.items) throw new Error(r.error || "Ophalen bij STLFlix mislukt.");
    return { type: "license-import", platform: "stlflix", name: r.name, items: r.items };
  }
  if (license.platform !== "makerworld") throw new Error("Automatisch ophalen kan (nog) alleen voor MakerWorld en STLFlix.");
  const handle = license.handle || (license.profile_url.match(/@([A-Za-z0-9_.-]+)/)?.[1] ?? "");
  if (!handle) throw new Error("Vul bij de licentie de link naar het profiel op MakerWorld in (bv. https://makerworld.com/en/@PinkyWings).");
  if (!(await extensionVersion())) throw new Error("NO_EXTENSION");
  const r = await askExtension({ type: "mw-models", uid: license.platform_user_id ?? "", handle }, "mw-models-result", 180000);
  if (!r) throw new Error("De extensie gaf binnen 3 minuten geen antwoord. Ben je ingelogd op makerworld.com in deze Chrome?");
  if (!r.ok || !r.items) throw new Error(r.error || "Ophalen bij MakerWorld mislukt.");
  return { type: "license-import", platform: "makerworld", uid: r.uid, handle: r.handle, name: r.name, items: r.items };
}

/** Versie a.b.c vergelijken: true als v minstens min is. */
function versionAtLeast(v: string, min: string): boolean {
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
}

export const LICENSE_INBOX_BUCKET = "license-inbox";
export const DOWNLOAD_MIN_VERSION = "1.1.0";
export const STLFLIX_MIN_VERSION = "1.2.0";

export type DownloadProgress = { done: number; total: number; current?: string; bytes: number };
export type DownloadResult = { ok: { id: string; title: string; name: string; size: number }[]; failed: { id: string; title: string; error: string }[] };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function storageName(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "model.3mf";
}

/**
 * Modelbestanden downloaden via de extensie (met je MakerWorld-login) en in stukken klaarzetten in de bucket
 * license-inbox/<licentie>/<model-id>/. De agent (opdracht "license") zet ze daarna in _Inbox/_Licenties/<artiest>
 * en in de Catalogus. Gooit "NO_EXTENSION" of "OLD_EXTENSION" als de extensie ontbreekt of te oud is.
 */
export async function downloadViaExtension(
  supabase: SupabaseClient, license: License, models: { source_id: string; title: string }[],
  onProgress: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  if (license.platform !== "makerworld") throw new Error("Automatisch downloaden kan (nog) alleen voor MakerWorld.");
  const version = await extensionVersion();
  if (!version) throw new Error("NO_EXTENSION");
  if (!versionAtLeast(version, DOWNLOAD_MIN_VERSION)) throw new Error("OLD_EXTENSION");
  const result: DownloadResult = { ok: [], failed: [] };
  let bytes = 0;
  try {
    for (const [n, m] of models.entries()) {
      onProgress({ done: n, total: models.length, current: m.title, bytes });
      try {
        const f = await askExtension({ type: "mw-file", id: m.source_id }, "mw-file-result", 300000);
        if (!f) throw new Error("geen antwoord van de extensie binnen 5 minuten");
        if (!f.ok || !f.key || !f.chunks) throw new Error(f.error || "downloaden mislukt");
        const base = `${license.id}/${m.source_id}/${storageName(f.name || m.source_id + ".3mf")}`;
        try {
          for (let i = 0; i < f.chunks; i++) {
            const c = await askExtension({ type: "mw-chunk", key: f.key, index: i }, "mw-chunk-result", 120000);
            if (!c?.ok || !c.b64) throw new Error(c?.error || "stuk van het bestand niet ontvangen");
            const { error } = await supabase.storage.from(LICENSE_INBOX_BUCKET)
              .upload(`${base}.part${String(i).padStart(3, "0")}`, b64ToBytes(c.b64), { upsert: true, contentType: "application/octet-stream" });
            if (error) throw new Error(`opslaan mislukt: ${error.message}`);
          }
          // klaar-teken: de agent zet enkel volledige bestanden in de Inbox
          const { error } = await supabase.storage.from(LICENSE_INBOX_BUCKET)
            .upload(`${base}.done`, new Blob([String(f.size ?? 0)], { type: "text/plain" }), { upsert: true });
          if (error) throw new Error(`opslaan mislukt: ${error.message}`);
        } finally {
          await askExtension({ type: "mw-release", key: f.key }, "mw-release-result", 10000);
        }
        bytes += f.size ?? 0;
        result.ok.push({ id: m.source_id, title: m.title, name: f.name || "", size: f.size ?? 0 });
      } catch (e: any) {
        result.failed.push({ id: m.source_id, title: m.title, error: e?.message ?? String(e) });
        if (/429|too many|te veel/i.test(e?.message ?? "")) break;   // MakerWorld remt af: stoppen
      }
    }
  } finally {
    await askExtension({ type: "mw-done" }, "mw-done-result", 10000);
  }
  onProgress({ done: models.length, total: models.length, bytes });
  return result;
}

/* ---------- zelf gedownloade bestanden (STLFlix-zips) in de tool slepen ---------- */

/** Naam van een download vergelijkbaar maken met een titel: "Vault_Tower_2b1971f242.zip" -> "vault tower". */
export function normName(s: string): string {
  return s.replace(/\.(zip|3mf|stl|rar|7z)$/i, "").replace(/_[0-9a-f]{10}$/i, "").replace(/[_\-–—.,!()&+'’]+/g, " ")
    .toLowerCase().replace(/\b(stl ?flix|files?)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** Dice-coëfficiënt op tekenparen: snel en goed genoeg om een bestandsnaam bij een titel te zoeken. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (x: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const pa = pairs(a), pb = pairs(b);
  let hit = 0;
  pa.forEach((n, k) => { hit += Math.min(n, pb.get(k) ?? 0); });
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

/** Bij welk model hoort dit bestand? Exacte naam eerst, anders de beste gelijkenis (minstens 0,75 en duidelijk beter dan de tweede). */
export function guessModel(fileName: string, models: { source_id: string; title: string }[]): string | null {
  const n = normName(fileName);
  const exact = models.filter((m) => normName(m.title) === n);
  if (exact.length === 1) return exact[0].source_id;
  const scores = models.map((m) => ({ id: m.source_id, s: similarity(n, normName(m.title)) })).sort((a, b) => b.s - a.s);
  if (scores.length && scores[0].s >= 0.75 && scores[0].s - (scores[1]?.s ?? 0) >= 0.08) return scores[0].id;
  return null;
}

/**
 * Zelf gedownloade bestanden (bv. de zips van STLFlix) in stukken van 8 MB klaarzetten in de bucket license-inbox,
 * op dezelfde manier als de extensie dat doet: <licentie>/<model-id>/<naam>.partNNN + <naam>.done.
 * Daarna zet de agent (opdracht "license") ze in de bibliotheek en de Catalogus.
 */
export async function uploadOwnFiles(
  supabase: SupabaseClient, license: License, files: { file: File; source_id: string }[],
  onProgress: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const CHUNK = 8 * 1024 * 1024;
  const result: DownloadResult = { ok: [], failed: [] };
  let bytes = 0;
  for (const [n, { file, source_id }] of files.entries()) {
    onProgress({ done: n, total: files.length, current: file.name, bytes });
    try {
      const base = `${license.id}/${source_id}/${storageName(file.name)}`;
      const chunks = Math.max(1, Math.ceil(file.size / CHUNK));
      for (let i = 0; i < chunks; i++) {
        const { error } = await supabase.storage.from(LICENSE_INBOX_BUCKET)
          .upload(`${base}.part${String(i).padStart(3, "0")}`, file.slice(i * CHUNK, (i + 1) * CHUNK), { upsert: true, contentType: "application/octet-stream" });
        if (error) throw new Error(`opslaan mislukt: ${error.message}`);
      }
      // klaar-teken: de agent zet enkel volledige bestanden in de Inbox
      const { error } = await supabase.storage.from(LICENSE_INBOX_BUCKET)
        .upload(`${base}.done`, new Blob([String(file.size)], { type: "text/plain" }), { upsert: true });
      if (error) throw new Error(`opslaan mislukt: ${error.message}`);
      bytes += file.size;
      result.ok.push({ id: source_id, title: file.name, name: file.name, size: file.size });
    } catch (e: any) {
      result.failed.push({ id: source_id, title: file.name, error: e?.message ?? String(e) });
    }
  }
  onProgress({ done: files.length, total: files.length, bytes });
  return result;
}
