"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { authHeader } from "@/lib/productionFiles";

// Persoonlijke kortingscodes (plugin "3DP Klanten" 1.2.0): met de hand sturen vanuit de Klanten-pagina en de
// instellingen voor de automatische codes (verjaardag, N-de bestelling). De shop maakt per klant een unieke
// WooCommerce-code (enkel voor dat e-mailadres, 1 keer bruikbaar) en mailt ze.

export type PromoType = "percent" | "fixed_cart" | "free_shipping";
export type PromoConfig = { type: PromoType; amount: number; days: number; min: number; subject: string; body: string; enabled?: boolean; orders?: number };
export type PromoSettings = { birthday: PromoConfig; milestone: PromoConfig; manual: PromoConfig };
export type SentCode = { code: string; reason: string; created: string | null; expires: string | null; used: boolean; sent: string; discount: string };

const TYPE_LABELS: Record<PromoType, string> = { percent: "% korting", fixed_cart: "€ korting", free_shipping: "Gratis verzending" };

export const PLACEHOLDERS = "{naam} = voornaam, {code} = de code, {korting} = bv. \"10% korting\", {minimum} = \" (vanaf € 25)\" of niets, {geldig_tot} = einddatum, {shop} = 3dprintforyou.be";

export function reasonLabel(r: string) {
  if (r.startsWith("birthday")) return "verjaardag " + r.slice(9);
  if (r.startsWith("milestone")) return r.slice(10) + "e bestelling";
  return "persoonlijk";
}

async function api(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const res = await fetch(`/api/customers/${path}`, {
    method,
    headers: { ...(await authHeader(supabase)), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function myEmail(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? "";
}

/** Formulier voor één soort code: soort korting, bedrag, geldigheid, minimum, onderwerp en tekst. */
function PromoConfigFields({ value, onChange, showOrders }: { value: PromoConfig; onChange: (c: PromoConfig) => void; showOrders?: boolean }) {
  const set = (patch: Partial<PromoConfig>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="row">
        {showOrders && (
          <div>
            <label>Bij bestelling nr.</label>
            <input className="mono" type="number" min={2} value={value.orders ?? 10} onChange={(e) => set({ orders: parseInt(e.target.value) || 10 })} />
          </div>
        )}
        <div>
          <label>Soort</label>
          <select value={value.type} onChange={(e) => set({ type: e.target.value as PromoType })}>
            {(Object.keys(TYPE_LABELS) as PromoType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        {value.type !== "free_shipping" && (
          <div>
            <label>{value.type === "percent" ? "Korting (%)" : "Korting (€)"}</label>
            <input className="mono" type="number" min={0} step="any" value={value.amount} onChange={(e) => set({ amount: parseFloat(e.target.value) || 0 })} />
          </div>
        )}
        <div>
          <label>Geldig (dagen)</label>
          <input className="mono" type="number" min={1} value={value.days} onChange={(e) => set({ days: parseInt(e.target.value) || 30 })} />
        </div>
        <div>
          <label>Vanaf bedrag (€, 0 = geen)</label>
          <input className="mono" type="number" min={0} step="any" value={value.min} onChange={(e) => set({ min: parseFloat(e.target.value) || 0 })} />
        </div>
      </div>
      <label>Onderwerp</label>
      <input value={value.subject} onChange={(e) => set({ subject: e.target.value })} />
      <label>Tekst van de mail</label>
      <textarea rows={8} value={value.body} onChange={(e) => set({ body: e.target.value })} />
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{PLACEHOLDERS}{showOrders ? ", {aantal} = het aantal bestellingen" : ""}. De afmeldlink komt er altijd automatisch onder.</p>
    </>
  );
}

/** Paneel "Kortingscode sturen" voor de gekozen klanten. */
export function SendCodePanel({ emails, onClose, onSent }: { emails: string[]; onClose: () => void; onSent: () => void }) {
  const [cfg, setCfg] = useState<PromoConfig | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    api("settings").then((s: PromoSettings) => setCfg(s.manual)).catch((e) => setMsg(e.message));
  }, []);

  async function test() {
    if (!cfg) return;
    setBusy("test"); setMsg("");
    try {
      const to = await myEmail();
      await api("test", "POST", { to, kind: "manual", config: cfg });
      setMsg(`Voorbeeldmail verstuurd naar ${to}.`);
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  }

  async function send() {
    if (!cfg) return;
    setBusy("send"); setMsg("");
    try {
      const res = await api("send", "POST", { emails, config: cfg, remember });
      setResults(res);
      onSent();
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  }

  return (
    <div className="card codes-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Kortingscode sturen naar {emails.length} klant{emails.length === 1 ? "" : "en"}</h2>
        <button type="button" className="btn secondary" onClick={onClose}>Sluiten</button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        Elke klant krijgt een eigen code die enkel met zijn e-mailadres en maar één keer werkt. Enkel klanten met toestemming krijgen een mail.
      </p>
      {results ? (
        <>
          <table>
            <thead><tr><th>Klant</th><th>Code</th><th>Resultaat</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.email}>
                  <td className="mono">{r.email}</td>
                  <td className="mono">{r.code ?? "--"}</td>
                  <td>{r.skipped ? <span className="muted">overgeslagen: {r.skipped}</span> : r.sent ? <span className="pill cyan">gemaild</span> : <span className="pill rust">code gemaakt, mail mislukt</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn" style={{ marginTop: 12 }} onClick={onClose}>Klaar</button>
        </>
      ) : !cfg ? (
        <p className="muted">{msg || "Laden..."}</p>
      ) : (
        <>
          <PromoConfigFields value={cfg} onChange={setCfg} />
          <label className="customers-check" style={{ marginTop: 10 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Deze instellingen onthouden als standaard
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={!!busy} onClick={send}>{busy === "send" ? "Bezig..." : `Maak en stuur ${emails.length} code${emails.length === 1 ? "" : "s"}`}</button>
            <button type="button" className="btn secondary" disabled={!!busy} onClick={test}>{busy === "test" ? "..." : "Voorbeeld naar mij"}</button>
            {msg && <span className="muted">{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** Instellingen voor de automatische codes (verjaardag en N-de bestelling). */
export function AutoCodesSettings() {
  const [s, setS] = useState<PromoSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open && !s) api("settings").then(setS).catch((e) => setMsg(e.message));
  }, [open, s]);

  async function save() {
    if (!s) return;
    setBusy("save"); setMsg("");
    try { setS(await api("settings", "POST", s)); setMsg("Bewaard."); } catch (e: any) { setMsg(e.message); }
    setBusy("");
  }
  async function test(kind: "birthday" | "milestone") {
    if (!s) return;
    setBusy(kind); setMsg("");
    try {
      const to = await myEmail();
      await api("test", "POST", { to, kind, config: s[kind] });
      setMsg(`Voorbeeldmail verstuurd naar ${to}.`);
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  }

  const block = (kind: "birthday" | "milestone", title: string, help: string) =>
    s && (
      <div className="codes-auto-block">
        <label className="customers-check" style={{ fontSize: 15 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!s[kind].enabled} onChange={(e) => setS({ ...s, [kind]: { ...s[kind], enabled: e.target.checked } })} />
          <b>{title}</b>
        </label>
        <p className="muted" style={{ margin: "4px 0 8px", fontSize: 13 }}>{help}</p>
        {s[kind].enabled && (
          <>
            <PromoConfigFields value={s[kind]} onChange={(c) => setS({ ...s, [kind]: c })} showOrders={kind === "milestone"} />
            <button type="button" className="btn secondary" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => test(kind)}>{busy === kind ? "..." : "Voorbeeld naar mij"}</button>
          </>
        )}
      </div>
    );

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button type="button" className="codes-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? "▾" : "▸"}</span> <b>Automatische kortingscodes</b>
        <span className="muted" style={{ fontWeight: 400 }}> -- verjaardag en mijlpaal, elke ochtend om 08:00</span>
      </button>
      {open && (!s ? <p className="muted">{msg || "Laden..."}</p> : (
        <>
          {block("birthday", "Op de verjaardag", "Klanten met toestemming en een ingevulde verjaardag krijgen 's ochtends een persoonlijke code (één keer per jaar).")}
          {block("milestone", "Bij de zoveelste bestelling", "Klanten met toestemming krijgen één keer een bedankcode zodra ze dit aantal bestellingen bereikt hebben (de ochtend erna).")}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <button type="button" className="btn" disabled={!!busy} onClick={save}>{busy === "save" ? "..." : "Bewaren"}</button>
            {msg && <span className="muted">{msg}</span>}
          </div>
        </>
      ))}
    </div>
  );
}
