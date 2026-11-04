// Draait enkel op de beheertool (zie manifest.json). Brug tussen de pagina en de extensie:
// de pagina stuurt {source: "apfy-tool", type: "ping" | "mw-models", ...} met window.postMessage,
// dit script geeft het door aan background.js en stuurt het antwoord terug als {source: "apfy-ext", ...}.
const VERSION = chrome.runtime.getManifest().version;

function reply(msg) {
  window.postMessage({ source: "apfy-ext", version: VERSION, ...msg }, window.location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== "apfy-tool") return;
  if (msg.type === "ping") { reply({ type: "pong", reqId: msg.reqId }); return; }
  if (msg.type === "mw-models") {
    chrome.runtime.sendMessage({ type: "mw-models", uid: msg.uid, handle: msg.handle }, (res) => {
      const err = chrome.runtime.lastError;
      reply({ type: "mw-models-result", reqId: msg.reqId, ...(err ? { ok: false, error: err.message } : res) });
    });
  }
});

reply({ type: "hello" });
