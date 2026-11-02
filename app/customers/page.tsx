"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { authHeader } from "@/lib/productionFiles";

// Klanten uit de shop (plugin "3DP Klanten"): wie besteld heeft (ook als gast) en wie een account heeft.
// Bedoeld om gericht een kortingscode te sturen (verjaardag, trouwe klant, ...). Standaard enkel klanten
// die toestemming gaven voor reclame-mails -- de anderen mag je niet zomaar mailen.

type Customer = {
  email: string;
  name: string;
  city: string;
  orders: number;
  spent: number;
  first_order: string | null;
  last_order: string | null;
  account: boolean;
  registered?: string;
  optin: boolean;
  optin_source: string | null;
  unsubscribed?: string;
  birthday: string;
  unsubscribe_url: string;
};

type Preset = "all" | "birthday_month" | "birthday_next" | "loyal" | "big" | "inactive" | "new";

const PRESETS: { key: Preset; label: string; title: string }[] = [
  { key: "all", label: "Iedereen", title: "Alle klanten" },
  { key: "birthday_month", label: "Jarig deze maand", title: "Verjaardag in de huidige maand" },
  { key: "birthday_next", label: "Jarig volgende maand", title: "Verjaardag volgende maand -- op tijd een code klaarzetten" },
  { key: "loyal", label: "Trouwe klanten", title: "Minstens het ingestelde aantal bestellingen" },
  { key: "big", label: "Grote kopers", title: "Minstens het ingestelde bedrag besteed" },
  { key: "inactive", label: "Lang niets besteld", title: "Laatste bestelling langer geleden dan het ingestelde aantal maanden" },
  { key: "new", label: "Nieuw (1 bestelling)", title: "Precies één bestelling" },
];

function fmtDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("nl-BE") : "--";
}
function birthdayMonth(b: string): number | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(b);
  return m ? parseInt(m[2]) : null;
}

export default function CustomersPage() {
  const ready = useAuthGuard();
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [onlyOptin, setOnlyOptin] = useState(true);
  const [minOrders, setMinOrders] = useState("10");
  const [minSpent, setMinSpent] = useState("100");
  const [months, setMonths] = useState("6");
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState("");

  async function load() {
    setError("");
    const res = await fetch("/api/customers", { headers: await authHeader(supabase) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? res.statusText); setRows([]); return; }
    setRows(body as Customer[]);
  }
  useEffect(() => { if (ready) load(); }, [ready]);

  const now = new Date();
  const visible = useMemo(() => {
    if (!rows) return [];
    const thisMonth = now.getMonth() + 1;
    const nextMonth = (thisMonth % 12) + 1;
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - (parseInt(months) || 0));
    const needle = q.trim().toLowerCase();
    return rows
      .filter((c) => !onlyOptin || c.optin)
      .filter((c) => !needle || c.email.includes(needle) || c.name.toLowerCase().includes(needle) || c.city.toLowerCase().includes(needle))
      .filter((c) => {
        switch (preset) {
          case "birthday_month": return birthdayMonth(c.birthday) === thisMonth;
          case "birthday_next": return birthdayMonth(c.birthday) === nextMonth;
          case "loyal": return c.orders >= (parseInt(minOrders) || 0);
          case "big": return c.spent >= (parseFloat(minSpent.replace(",", ".")) || 0);
          case "inactive": return c.orders > 0 && !!c.last_order && new Date(c.last_order) < cutoff;
          case "new": return c.orders === 1;
          default: return true;
        }
      })
      .sort((a, b) => b.orders - a.orders || b.spent - a.spent || a.email.localeCompare(b.email));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, preset, onlyOptin, minOrders, minSpent, months, q]);

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 2000);
  }

  if (!ready) return null;
  const total = rows?.length ?? 0;
  const optins = rows?.filter((c) => c.optin).length ?? 0;
  const withBirthday = rows?.filter((c) => c.birthday).length ?? 0;
  const withAccount = rows?.filter((c) => c.account).length ?? 0;
  const mailable = visible.filter((c) => c.optin);

  return (
    <div>
      <h1>Klanten</h1>
      <p className="sub">
        Iedereen die in de shop besteld heeft (ook als gast) of een account heeft. Mail enkel klanten met <b>toestemming</b> voor reclame;
        de afmeldlink per klant zet je onderaan je mail.
      </p>

      <div className="mat-stats">
        <div className="card stat-tile"><div className="stat-label">Klanten</div><div className="stat-value">{total}</div></div>
        <div className="card stat-tile"><div className="stat-label">Met toestemming</div><div className="stat-value">{optins}</div></div>
        <div className="card stat-tile"><div className="stat-label">Met account</div><div className="stat-value">{withAccount}</div></div>
        <div className="card stat-tile"><div className="stat-label">Verjaardag gekend</div><div className="stat-value">{withBirthday}</div></div>
      </div>

      {error && <p className="warning">{error}</p>}

      <div className="tabs">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" title={p.title} className={`tab${preset === p.key ? " active" : ""}`} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="card customers-filters">
        {preset === "loyal" && (
          <label>Minstens <input className="mono" type="number" min={1} value={minOrders} onChange={(e) => setMinOrders(e.target.value)} /> bestellingen</label>
        )}
        {preset === "big" && (
          <label>Minstens € <input className="mono" value={minSpent} onChange={(e) => setMinSpent(e.target.value)} /> besteed</label>
        )}
        {preset === "inactive" && (
          <label>Niets besteld in <input className="mono" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} /> maanden</label>
        )}
        <input placeholder="Zoek op naam, e-mail of gemeente" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <label className="customers-check">
          <input type="checkbox" checked={onlyOptin} onChange={(e) => setOnlyOptin(e.target.checked)} style={{ width: "auto" }} />
          Enkel met toestemming
        </label>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {copied && <span className="pill cyan">{copied} gekopieerd</span>}
          <button type="button" className="btn" disabled={mailable.length === 0} onClick={() => copy(mailable.map((c) => c.email).join(", "), `${mailable.length} e-mailadres(sen)`)}
            title="E-mailadressen (enkel met toestemming) om in BCC te plakken">
            Kopieer e-mails ({mailable.length})
          </button>
        </span>
      </div>

      {rows === null ? (
        <p className="muted">Laden...</p>
      ) : visible.length === 0 ? (
        <p className="muted">Geen klanten in deze selectie{onlyOptin ? " (met toestemming)" : ""}.</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="customers-table">
            <thead>
              <tr>
                <th>Klant</th><th>Bestellingen</th><th>Besteed</th><th>Eerste / laatste</th><th>Verjaardag</th><th>Account</th><th>Reclame</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.email}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{c.name || <span className="muted">--</span>}</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>{c.email}{c.city && ` · ${c.city}`}</div>
                  </td>
                  <td className="mono">{c.orders}</td>
                  <td className="mono">€{c.spent.toFixed(2)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtDate(c.first_order)}<br />{fmtDate(c.last_order)}</td>
                  <td className="mono">{c.birthday || <span className="muted">--</span>}</td>
                  <td>{c.account ? "ja" : <span className="muted">gast</span>}</td>
                  <td>
                    {c.optin ? <span className="pill cyan">ja</span>
                      : c.unsubscribed ? <span className="pill rust" title={`afgemeld op ${fmtDate(c.unsubscribed)}`}>afgemeld</span>
                      : <span className="muted">nee</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn secondary" onClick={() => copy(c.email, "E-mail")}>E-mail</button>{" "}
                    {c.optin && <button type="button" className="btn secondary" onClick={() => copy(c.unsubscribe_url, "Afmeldlink")} title="Persoonlijke afmeldlink om onderaan je mail te zetten">Afmeldlink</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
