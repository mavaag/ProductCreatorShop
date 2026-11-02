"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { authHeader } from "@/lib/productionFiles";
import { confirmDialog } from "@/components/DialogHost";

// Acties in de shop (plugin "3DP Acties"): X kopen + Y gratis/aan korting (goedkoopste), vanaf N stuks % korting,
// en % korting met doorstreepte prijs. Gelden standaard op de hele shop (producten mixen mag), optioneel op categorieën.
// De plugin toont een label op de producten, uitleg op de productpagina, de korting in het mandje en [tdp_acties].

type ActieType = "bundle" | "volume" | "percent";
type Actie = {
  id?: string; name: string; type: ActieType;
  buy: number; get: number; get_pct: number; // bundle
  min_qty: number; pct: number;              // volume / percent
  categories: number[]; start: string; end: string; active: boolean; text: string;
  label?: string; running?: boolean; stats?: { orders: number } | null;
};
type Category = { id: number; name: string; count: number };

const PRESETS: { label: string; hint: string; value: Partial<Actie> }[] = [
  { label: "1 + 1 gratis", hint: "per 2 stuks is het goedkoopste gratis", value: { type: "bundle", buy: 1, get: 1, get_pct: 100 } },
  { label: "2 + 1 gratis", hint: "per 3 stuks is het goedkoopste gratis", value: { type: "bundle", buy: 2, get: 1, get_pct: 100 } },
  { label: "2e aan halve prijs", hint: "per 2 stuks is het goedkoopste -50%", value: { type: "bundle", buy: 1, get: 1, get_pct: 50 } },
  { label: "Vanaf 5 stuks -15%", hint: "op alle stuks zodra er 5 in het mandje zitten", value: { type: "volume", min_qty: 5, pct: 15 } },
  { label: "-20% op alles", hint: "doorstreepte prijs in de shop", value: { type: "percent", pct: 20 } },
];

const EMPTY: Actie = { name: "", type: "bundle", buy: 2, get: 1, get_pct: 100, min_qty: 5, pct: 10, categories: [], start: "", end: "", active: false, text: "" };

/** Zelfde naamgeving als de plugin (voor het voorbeeld tijdens het invullen). */
function label(a: Actie): string {
  const n = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  if (a.type === "percent") return `-${n(a.pct)}%`;
  if (a.type === "volume") return `Vanaf ${a.min_qty} stuks -${n(a.pct)}%`;
  if (a.get_pct >= 100) return `${a.buy} + ${a.get} gratis`;
  if (a.buy === 1 && a.get === 1 && a.get_pct === 50) return "2e aan halve prijs";
  return a.get === 1 ? `${a.buy + 1}e aan -${n(a.get_pct)}%` : `${a.buy} + ${a.get} aan -${n(a.get_pct)}%`;
}

function status(a: Actie): { text: string; cls: string } {
  if (!a.active) return { text: "uit", cls: "" };
  const today = new Date().toISOString().slice(0, 10);
  if (a.start && today < a.start) return { text: `start ${new Date(a.start).toLocaleDateString("nl-BE")}`, cls: "yellow" };
  if (a.end && today > a.end) return { text: "afgelopen", cls: "rust" };
  return { text: "loopt nu", cls: "cyan" };
}

export default function ActiesPage() {
  const ready = useAuthGuard();
  const [acties, setActies] = useState<Actie[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState<{ index: number | null; value: Actie } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [catQ, setCatQ] = useState("");

  async function call(method: "GET" | "POST", body?: unknown) {
    const res = await fetch("/api/acties", {
      method,
      headers: { ...(await authHeader(supabase)), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    setActies(data.acties);
    setCats(data.categories ?? []);
  }
  useEffect(() => { if (ready) call("GET").catch((e) => { setError(e.message); setActies([]); }); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveAll(list: Actie[]) {
    setBusy(true); setError("");
    try { await call("POST", { acties: list }); setEditing(null); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);

  if (!ready) return null;
  const e = editing?.value;
  const set = (patch: Partial<Actie>) => editing && setEditing({ ...editing, value: { ...editing.value, ...patch } });

  return (
    <div>
      <h1>Acties</h1>
      <p className="sub">
        Acties in de shop: <b>X kopen + Y gratis</b> (het goedkoopste), <b>2e aan halve prijs</b>, <b>vanaf X stuks % korting</b> of <b>% korting</b> met doorstreepte prijs.
        Klanten mogen producten mixen. Lopen er meerdere acties in het mandje, dan krijgt de klant de voordeligste.
      </p>
      {error && <p className="warning">{error}</p>}

      {!editing && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <button type="button" className="btn" onClick={() => setEditing({ index: null, value: { ...EMPTY } })}>+ Nieuwe actie</button>
        </div>
      )}

      {e && (
        <div className="card actie-form">
          <h2 style={{ marginTop: 0 }}>{editing!.index === null ? "Nieuwe actie" : "Actie aanpassen"} <span className="actie-preview">{label(e)}</span></h2>
          <label>Snel kiezen</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn secondary" title={p.hint} onClick={() => set(p.value)}>{p.label}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>Naam (voor jezelf en op de Acties-pagina)</label>
              <input value={e.name} onChange={(x) => set({ name: x.target.value })} placeholder="bv. Flexi-feest" />
            </div>
            <div>
              <label>Soort</label>
              <select value={e.type} onChange={(x) => set({ type: x.target.value as ActieType })}>
                <option value="bundle">X kopen + Y gratis / aan korting</option>
                <option value="volume">Vanaf X stuks % korting</option>
                <option value="percent">% korting (doorstreepte prijs)</option>
              </select>
            </div>
          </div>
          {e.type === "bundle" && (
            <div className="row">
              <div><label>Koop (X)</label><input className="mono" type="number" min={1} value={e.buy} onChange={(x) => set({ buy: parseInt(x.target.value) || 1 })} /></div>
              <div><label>Krijg erbij (Y)</label><input className="mono" type="number" min={1} value={e.get} onChange={(x) => set({ get: parseInt(x.target.value) || 1 })} /></div>
              <div><label>Korting op die Y (%, 100 = gratis)</label><input className="mono" type="number" min={1} max={100} value={e.get_pct} onChange={(x) => set({ get_pct: parseFloat(x.target.value) || 100 })} /></div>
            </div>
          )}
          {e.type === "volume" && (
            <div className="row">
              <div><label>Vanaf (stuks)</label><input className="mono" type="number" min={2} value={e.min_qty} onChange={(x) => set({ min_qty: parseInt(x.target.value) || 2 })} /></div>
              <div><label>Korting (%)</label><input className="mono" type="number" min={1} max={90} value={e.pct} onChange={(x) => set({ pct: parseFloat(x.target.value) || 10 })} /></div>
            </div>
          )}
          {e.type === "percent" && (
            <div className="row">
              <div><label>Korting (%)</label><input className="mono" type="number" min={1} max={90} value={e.pct} onChange={(x) => set({ pct: parseFloat(x.target.value) || 10 })} /></div>
            </div>
          )}
          <div className="row">
            <div><label>Vanaf (leeg = meteen)</label><input type="date" value={e.start} onChange={(x) => set({ start: x.target.value })} /></div>
            <div><label>Tot en met (leeg = geen einde)</label><input type="date" value={e.end} onChange={(x) => set({ end: x.target.value })} /></div>
          </div>

          <label>Op welke producten</label>
          <p className="muted" style={{ margin: "0 0 6px", fontSize: 13 }}>
            Niets aangevinkt = <b>hele shop</b>. Vink je categorieën (of collecties) aan, dan telt de actie enkel daarvoor (subcategorieën horen erbij).
          </p>
          {e.categories.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {e.categories.map((id) => (
                <span key={id} className="pill cyan" style={{ cursor: "pointer" }} onClick={() => set({ categories: e.categories.filter((c) => c !== id) })} title="Klik om weg te halen">{catName.get(id) ?? id} ✕</span>
              ))}
            </div>
          )}
          <input placeholder="Zoek een categorie of collectie" value={catQ} onChange={(x) => setCatQ(x.target.value)} style={{ maxWidth: 320 }} />
          {catQ.trim() && (
            <div className="actie-cats">
              {cats.filter((c) => c.name.toLowerCase().includes(catQ.trim().toLowerCase()) && !e.categories.includes(c.id)).slice(0, 12).map((c) => (
                <button key={c.id} type="button" className="btn secondary" onClick={() => { set({ categories: [...e.categories, c.id] }); setCatQ(""); }}>{c.name} <span className="muted">({c.count})</span></button>
              ))}
            </div>
          )}

          <label>Uitleg voor klanten (leeg = automatisch)</label>
          <textarea rows={2} value={e.text} onChange={(x) => set({ text: x.target.value })} placeholder="bv. Stel zelf je flexi-bende samen: per 3 is de goedkoopste gratis!" style={{ width: "100%" }} />

          <label className="customers-check" style={{ marginTop: 10 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={e.active} onChange={(x) => set({ active: x.target.checked })} />
            <b>Actief</b> <span className="muted">(binnen de datums zichtbaar in de shop)</span>
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn" disabled={busy || !acties} onClick={() => {
              const list = [...(acties ?? [])];
              if (editing!.index === null) list.unshift(e); else list[editing!.index] = e;
              saveAll(list);
            }}>{busy ? "Bezig..." : "Bewaren en naar de shop"}</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => setEditing(null)}>Annuleren</button>
          </div>
        </div>
      )}

      {acties === null ? <p className="muted">Laden...</p> : acties.length === 0 && !editing ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Nog geen acties. Klik op <i>+ Nieuwe actie</i>.</p></div>
      ) : (
        <div className="actie-list">
          {acties.map((a, i) => {
            const st = status(a);
            return (
              <div key={a.id ?? i} className={`card actie-card${st.cls === "cyan" ? " running" : ""}`}>
                <div className="actie-badge">{a.label ?? label(a)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{a.name || a.label || label(a)} <span className={`pill ${st.cls}`}>{st.text}</span></div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {a.categories.length ? a.categories.map((c) => catName.get(c) ?? c).join(", ") : "Hele shop"}
                    {(a.start || a.end) && ` · ${a.start ? new Date(a.start).toLocaleDateString("nl-BE") : "nu"} – ${a.end ? new Date(a.end).toLocaleDateString("nl-BE") : "geen einde"}`}
                    {a.stats && ` · in ${a.stats.orders} bestelling${a.stats.orders === 1 ? "" : "en"} gebruikt`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => saveAll(acties.map((x, j) => (j === i ? { ...x, active: !x.active } : x)))}>{a.active ? "Uitzetten" : "Aanzetten"}</button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => setEditing({ index: i, value: { ...EMPTY, ...a } })}>Aanpassen</button>
                  <button type="button" className="btn danger" disabled={busy} onClick={async () => { if (await confirmDialog(`Actie "${a.name || a.label}" verwijderen?`, { confirmLabel: "Verwijderen", danger: true })) saveAll(acties.filter((_, j) => j !== i)); }}>Verwijderen</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Waar zie je de acties in de shop?</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Een oranje <b>label</b> op de productfoto in de shop (bv. <i>2 + 1 gratis</i>); bij % korting de doorstreepte prijs en <i>-20%</i>.</li>
          <li>Op de <b>productpagina</b> een kader met de uitleg en de einddatum.</li>
          <li>In het <b>mandje</b> een regel <i>Actie: 2 + 1 gratis</i> met de korting.</li>
          <li>Op de pagina <b>Acties</b> in de shop (shortcode <span className="mono">[tdp_acties]</span>) alle lopende acties.</li>
        </ul>
      </div>
    </div>
  );
}
