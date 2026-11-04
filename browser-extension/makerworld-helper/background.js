// Haalt de modellenlijst van een artiest op MakerWorld op, zoals je browser dat doet als je het profiel opent.
// 1) Rechtstreeks via de website van MakerWorld (met je eigen login), als het id van de artiest gekend is.
// 2) Lukt dat niet, dan opent de extensie het profiel in een achtergrondtabblad, leest daar de lijst en sluit het weer.
// Er gaat niets naar een andere website dan makerworld.com; het resultaat gaat enkel terug naar de beheertool.

const PAGE = 50;
const MAX = 5000;

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

async function direct(uid, handle) {
  const items = [];
  for (let o = 0; o < MAX; o += PAGE) {
    const r = await fetch(`https://makerworld.com/api/v1/design-service/published/${uid}/design?handle=@${encodeURIComponent(handle)}&limit=${PAGE}&offset=${o}`,
      { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(`MakerWorld antwoordde ${r.status}`);
    const hits = (await r.json()).hits || [];
    items.push(...hits.map(slim));
    if (hits.length < PAGE) break;
  }
  return { uid: String(uid), handle, items };
}

// Draait IN het tabblad van MakerWorld (zelfde werkwijze als de bladwijzer "Modellen ophalen").
async function readInPage(PAGE, MAX) {
  const p = JSON.parse(document.getElementById("__NEXT_DATA__").textContent).props.pageProps;
  const u = p && p.userInfo;
  if (!u) return { ok: false, error: "Geen profiel gevonden op deze pagina." };
  const handle = (u.personal && u.personal.handle) || "";
  const hits = [];
  for (let o = 0; o < MAX; o += PAGE) {
    const r = await fetch(`/api/v1/design-service/published/${u.uid}/design?handle=@${encodeURIComponent(handle)}&limit=${PAGE}&offset=${o}`, { credentials: "include" });
    if (!r.ok) return { ok: false, error: `MakerWorld antwoordde ${r.status}` };
    const h = (await r.json()).hits || [];
    hits.push(...h);
    if (h.length < PAGE) break;
  }
  return { ok: true, uid: String(u.uid), handle, name: u.name, hits };
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

async function viaTab(handle) {
  const tab = await chrome.tabs.create({ url: `https://makerworld.com/en/@${encodeURIComponent(handle)}/upload`, active: false });
  try {
    await waitForLoad(tab.id, 45000);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: readInPage, args: [PAGE, MAX] });
    const out = res && res.result;
    if (!out || !out.ok) throw new Error((out && out.error) || "Kon de lijst niet lezen op MakerWorld.");
    return { uid: out.uid, handle: out.handle, name: out.name, items: out.hits.map(slim) };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function getModels(uid, handle) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle || "")) throw new Error("Geen geldige MakerWorld-naam (handle) bij deze licentie.");
  if (uid && /^\d{1,20}$/.test(String(uid))) {
    try { return await direct(uid, handle); } catch (e) { /* dan via een tabblad */ }
  }
  return await viaTab(handle);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // enkel berichten van ons eigen content script op de beheertool
  if (sender.id !== chrome.runtime.id || !msg || msg.type !== "mw-models") return;
  getModels(msg.uid, msg.handle)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;   // antwoord komt asynchroon
});
