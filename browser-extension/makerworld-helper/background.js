// MakerWorld-hulp: doet in je eigen Chrome, met je eigen MakerWorld-login, wat je anders met de hand doet.
// - mw-models: de modellenlijst van een artiest (zoals wanneer je het profiel opent).
// - mw-file / mw-chunk / mw-release / mw-done: het 3MF-bestand van een model downloaden (zoals de knop "Download 3MF")
//   en het in stukken teruggeven aan de beheertool, die het voor de agent op de NAS klaarzet.
// Werkt eerst rechtstreeks; lukt dat niet, dan via een tabblad op makerworld.com op de achtergrond.
// Er gaat niets naar een andere website dan makerworld.com (en hun bestandsserver *.bblmw.com).

const PAGE = 50;
const MAX = 5000;
const CHUNK = 8 * 1024 * 1024;          // stukken van 8 MB naar de beheertool
const files = new Map();                 // key -> {name, bytes, at}
let mwTab = null;                        // achtergrondtabblad op makerworld.com, hergebruikt tijdens een reeks

function slim(x) {
  const inst = (x.instances || []).find((k) => k.id === x.defaultInstanceId) || (x.instances || [])[0] || {};
  return {
    id: String(x.id), title: String(x.title || "").trim(), cover: x.coverUrl || null,
    dl: x.downloadCount || 0, lk: x.likeCount || 0, pr: x.printCount || 0,
    date: String(x.publishTime || x.createTime || "").slice(0, 10) || null,
    w: inst.weight == null ? null : inst.weight, tm: inst.prediction == null ? null : inst.prediction,
    ni: x.totalInstCnt == null ? null : x.totalInstCnt, tags: (x.tags || []).slice(0, 12),
  };
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error("MakerWorld laadde niet op tijd.")); }, timeoutMs);
    function on(id, info) {
      if (id === tabId && info.status === "complete") { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(on);
  });
}

async function ensureTab(url = "https://makerworld.com/en") {
  if (mwTab) {
    try {
      await chrome.tabs.get(mwTab);
      if (url !== "https://makerworld.com/en") { await chrome.tabs.update(mwTab, { url }); await waitForLoad(mwTab, 45000); }
      return mwTab;
    } catch (e) { mwTab = null; }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  mwTab = tab.id;
  await waitForLoad(tab.id, 45000);
  return mwTab;
}

async function closeTab() {
  if (mwTab) { const t = mwTab; mwTab = null; await chrome.tabs.remove(t).catch(() => {}); }
}

// Draait IN het tabblad van MakerWorld.
async function fetchJsonInPage(path) {
  const r = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
  let body = null;
  try { body = await r.json(); } catch (e) { /* geen json */ }
  return { status: r.status, body };
}

/** JSON van de MakerWorld-API: eerst rechtstreeks, anders via het tabblad. */
async function mwJson(path) {
  try {
    const r = await fetch(`https://makerworld.com${path}`, { credentials: "include", headers: { Accept: "application/json" } });
    if ((r.headers.get("content-type") || "").includes("json")) return { status: r.status, body: await r.json() };
  } catch (e) { /* dan via een tabblad */ }
  const tabId = await ensureTab();
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: fetchJsonInPage, args: [path] });
  if (!res || !res.result) throw new Error("Kon MakerWorld niet bereiken.");
  return res.result;
}

// ---------- modellenlijst ----------

// Draait IN het tabblad op het profiel: id, handle en naam van de artiest.
function readProfile() {
  const p = JSON.parse(document.getElementById("__NEXT_DATA__").textContent).props.pageProps;
  const u = p && p.userInfo;
  return u ? { uid: String(u.uid), handle: (u.personal && u.personal.handle) || "", name: u.name } : null;
}

async function getModels(uid, handle) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle || "")) throw new Error("Geen geldige MakerWorld-naam (handle) bij deze licentie.");
  let id = /^\d{1,20}$/.test(String(uid || "")) ? String(uid) : null;
  let name;
  try {
    if (!id) {
      const tabId = await ensureTab(`https://makerworld.com/en/@${encodeURIComponent(handle)}/upload`);
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readProfile });
      const u = res && res.result;
      if (!u) throw new Error("Geen profiel gevonden op MakerWorld.");
      id = u.uid; handle = u.handle || handle; name = u.name;
    }
    const items = [];
    for (let o = 0; o < MAX; o += PAGE) {
      const r = await mwJson(`/api/v1/design-service/published/${id}/design?handle=@${encodeURIComponent(handle)}&limit=${PAGE}&offset=${o}`);
      if (r.status !== 200 || !r.body) throw new Error(`MakerWorld antwoordde ${r.status}`);
      const hits = r.body.hits || [];
      items.push(...hits.map(slim));
      if (hits.length < PAGE) break;
    }
    return { uid: id, handle, name, items };
  } finally { await closeTab(); }
}

// ---------- bestanden ----------

async function getFile(id) {
  if (!/^\d{1,12}$/.test(String(id))) throw new Error("Ongeldig model-id.");
  const d = await mwJson(`/api/v1/design-service/design/${id}`);
  if (d.status !== 200 || !d.body) throw new Error(`Model niet gevonden (${d.status}).`);
  // standaard-printprofiel eerst, dan de andere (soms bestaat het standaardprofiel niet meer)
  const insts = [...new Set([d.body.defaultInstanceId, ...(d.body.instances || []).map((i) => i.id)].filter(Boolean))];
  let link = null, last = "geen printprofiel met een 3MF";
  for (const inst of insts) {
    const f = await mwJson(`/api/v1/design-service/instance/${inst}/f3mf`);
    if (f.status === 200 && f.body && f.body.url) { link = f.body; break; }
    last = (f.body && (f.body.error || f.body.message)) || `MakerWorld antwoordde ${f.status}`;
    if (f.status === 429) break;   // te veel downloads: niet verder proberen
  }
  if (!link) throw new Error(last);
  const host = new URL(link.url).hostname;
  if (!(host === "makerworld.com" || host.endsWith(".bblmw.com"))) throw new Error(`Onverwachte downloadserver ${host}.`);
  const r = await fetch(link.url);
  if (!r.ok) throw new Error(`Download mislukt (${r.status}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const name = String(link.name || `${id}.3mf`);
  const key = Math.random().toString(36).slice(2);
  for (const [k, v] of files) if (Date.now() - v.at > 15 * 60000) files.delete(k);   // vergeten resten opruimen
  files.set(key, { name, bytes, at: Date.now() });
  return { key, name, size: bytes.length, chunks: Math.max(1, Math.ceil(bytes.length / CHUNK)) };
}

function chunkB64(key, i) {
  const f = files.get(key);
  if (!f) throw new Error("Bestand niet meer in het geheugen; probeer opnieuw.");
  const part = f.bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
  let s = "";
  for (let o = 0; o < part.length; o += 0x8000) s += String.fromCharCode.apply(null, part.subarray(o, o + 0x8000));
  return { b64: btoa(s) };
}

// ---------- berichten van de beheertool (via content.js) ----------

const HANDLERS = {
  "mw-models": (m) => getModels(m.uid, m.handle),
  "mw-file": (m) => getFile(m.id),
  "mw-chunk": async (m) => chunkB64(m.key, Number(m.index) || 0),
  "mw-release": async (m) => { files.delete(m.key); return {}; },
  "mw-done": async () => { files.clear(); await closeTab(); return {}; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // enkel berichten van ons eigen content script op de beheertool
  if (sender.id !== chrome.runtime.id || !msg || !HANDLERS[msg.type]) return;
  HANDLERS[msg.type](msg)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;   // antwoord komt asynchroon
});
