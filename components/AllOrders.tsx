"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import OrderActions from "@/components/OrderActions";

// Tabblad Bestellingen > Alle bestellingen: de laatste bestellingen (lokale kopie wc_orders) met hun status en
// knoppen om de status in WooCommerce te wijzigen of een testbestelling te verwijderen.

type Row = { id: string; wc_order_id: number; order_number: string; status: string; date_created: string; customer_name: string | null; total: number };

const STATUS_LABELS: Record<string, string> = {
  pending: "wacht op betaling", processing: "in verwerking", "on-hold": "in de wacht", completed: "voltooid",
  cancelled: "geannuleerd", refunded: "terugbetaald", failed: "mislukt", trash: "verwijderd",
};
const FILTERS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "Alle", statuses: null },
  { key: "open", label: "Open", statuses: ["pending", "processing", "on-hold"] },
  { key: "completed", label: "Voltooid", statuses: ["completed"] },
  { key: "stopped", label: "Geannuleerd / mislukt", statuses: ["cancelled", "failed", "refunded"] },
  { key: "trash", label: "Verwijderd", statuses: ["trash"] },
];
const euro = (n: number) => Number(n).toLocaleString("nl-BE", { style: "currency", currency: "EUR" });

export default function AllOrders() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const f = FILTERS.find((x) => x.key === filter)!;
    let query = supabase.from("wc_orders").select("id, wc_order_id, order_number, status, date_created, customer_name, total")
      .order("date_created", { ascending: false }).limit(200);
    if (f.statuses) query = query.in("status", f.statuses);
    else query = query.neq("status", "trash");
    const { data, error } = await query;
    if (error) setError(error.message);
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const needle = q.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => !needle || r.order_number.includes(needle) || (r.customer_name ?? "").toLowerCase().includes(needle));

  return (
    <div>
      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`tab${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Zoek op nummer of klant" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <span className="muted" style={{ fontSize: 12 }}>
          De laatste 200. Een wijziging gaat meteen naar WooCommerce. Geld terugstorten doe je in WooCommerce zelf (Terugbetalen); dat komt dan vanzelf hierin.
        </span>
      </div>
      {error && <p className="warning">{error}</p>}
      {rows === null ? <p className="muted">Laden...</p> : visible.length === 0 ? <p className="muted">Geen bestellingen.</p> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="all-orders">
            <thead><tr><th>Bestelling</th><th>Datum</th><th>Klant</th><th>Totaal</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="mono">#{r.order_number}</td>
                  <td className="mono">{new Date(r.date_created).toLocaleDateString("nl-BE")}</td>
                  <td>{r.customer_name || <span className="muted">--</span>}</td>
                  <td className="mono">{euro(r.total)}</td>
                  <td><span className={`pill status-${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span></td>
                  <td>
                    <OrderActions wcOrderId={r.wc_order_id} status={r.status}
                      onChanged={(status) => setRows((cur) => (cur ?? []).map((x) => (x.id === r.id ? { ...x, status } : x)))} />
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
