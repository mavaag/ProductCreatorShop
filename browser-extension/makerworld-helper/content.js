// Draait enkel op de beheertool (zie manifest.json). Brug tussen de pagina en de extensie:
// de pagina stuurt {source: "apfy-tool", type, reqId, ...} met window.postMessage, dit script geeft het door aan
// background.js en stuurt het antwoord terug als {source: "apfy-ext", type: "<type>-result", reqId, ...}.
const VERSION = chrome.runtime.getManifest().version;
const FORWARD = new Set(["mw-models", "mw-file", "mw-chunk", "mw-release", "mw-done", "sf-models"]);

function reply(msg) {
  window.postMessage({ source: "apfy-ext", version: VERSION, ...msg }, window.location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== "apfy-tool") return;
  if (msg.type === "ping") { reply({ type: "pong", reqId: msg.reqId }); return; }
  if (!FORWARD.has(msg.type)) return;
  const { source, reqId, ...rest } = msg;
  chrome.runtime.sendMessage(rest, (res) => {
    const err = chrome.runtime.lastError;
    reply({ type: `${msg.type}-result`, reqId, ...(err ? { ok: false, error: err.message } : res) });
  });
});

reply({ type: "hello" });
