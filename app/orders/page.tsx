"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { confirmDialog } from "@/components/DialogHost";

type Period = "12m" | "this_year" | "last_year" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  "12m": "Laatste 12 maanden",
  this_year: "Dit jaar",
  last_year: "Vorig jaar",
  all: "Alles",
};

// Deze statussen tellen niet mee als "echte" bestelling voor omzet/aantal/topproducten (wel in de
// statusverdeling hieronder, zodat je ze niet kwijt bent).
const EXCLUDED_STATUSES = ["cancelled", "failed"];

const STATUS_LABELS: Record<string, string> = {
  pending: "In afwachting",
  processing: "In verwerking",
  "on-hold": "On hold",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
  refunded: "Terugbetaald",
  failed: "Mislukt",
  trash: "Prullenmand",
};
const STATUS_COLORS: Record<string, string> = {
  completed: "var(--moss)",
  processing: "var(--cyan)",
  "on-hold": "var(--yellow)",
  pending: "var(--yellow)",
  refunded: "var(--magenta)",
  cancelled: "var(--rust)",
  failed: "var(--rust)",
  trash: "var(--ink-faint)",
};

type OrderRow = { id: string; status: string; total: number; date_created: string };
type ItemRow = { name: string; sku: string | null; quantity: number; total: number };

function periodRange(period: Period): { start: Date | null; end: Date } {
  const now = new Date();
  if (period === "all") return { start: null, end: now };
  if (period === "this_year") return { start: new Date(now.getFullYear(), 0, 1), end: now };
  if (period === "last_year") return { start: new Date(now.getFullYear() - 1, 0, 1), end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59) };
  return { start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now };
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("nl-BE", { month: "short", year: "2-digit" });
}
/** Alle maand-sleutels tussen start en end (inclusief), zodat maanden zonder bestelling ook als lege balk verschijnen. */
function buildMonthRange(start: Date, end: Date): string[] {
  const keys: string[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return keys;
}

function eur(n: number): string {
  return n.toLocaleString("nl-BE", { style: "currency", currency: "EUR" });
}
function eurCompact(n: number): string {
  return n.toLocaleString("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export default function OrdersPage() {
  const ready = useAuthGuard();
  const [configured, setConfigured] = useState(true);
  const [period, setPeriod] = useState<Period>("12m");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [totalOrdersSynced, setTotalOrdersSynced] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { start, end } = periodRange(period);

    let orderQuery = supabase.from("wc_orders").select("id, status, total, date_created").lte("date_created", end.toISOString()).order("date_created");
    if (start) orderQuery = orderQuery.gte("date_created", start.toISOString());
    const { data: orderRows } = await orderQuery;
    setOrders((orderRows ?? []) as OrderRow[]);

    let itemQuery = supabase
      .from("wc_order_items")
      .select("name, sku, quantity, total, wc_orders!inner(status, date_created)")
      .lte("wc_orders.date_created", end.toISOString())
      .not("wc_orders.status", "in", `(${EXCLUDED_STATUSES.join(",")})`);
    if (start) itemQuery = itemQuery.gte("wc_orders.date_created", start.toISOString());
    const { data: itemRows } = await itemQuery;
    setItems((itemRows ?? []) as ItemRow[]);

    const { count } = await supabase.from("wc_orders").select("id", { count: "exact", head: true });
    setTotalOrdersSynced(count ?? 0);

    const { data: setting } = await supabase.from("settings").select("value").eq("key", "last_order_sync_at").maybeSingle();
    setLastSync(typeof setting?.value === "string" ? setting.value : null);

    setLoading(false);
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, period]);

  async function runSync(full: boolean) {
    if (full) {
      const ok = await confirmDialog(
        "Dit haalt de volledige bestelhistoriek op uit WooCommerce. Bij een shop met veel bestellingen kan dit een tijdje duren. Doorgaan?"
      );
      if (!ok) return;
    }
    setSyncing(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/woocommerce/orders-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
        body: JSON.stringify({ full }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 501) setConfigured(false);
        throw new Error(body.error ?? `Synchronisatie mislukt (${res.status})`);
      }
      const parts = [`${body.fetched} opgehaald`, `${body.upserted} opgeslagen`];
      if (body.errors?.length) parts.push(`fouten: ${body.errors.join("; ")}`);
      setMessage(`Synchronisatie voltooid: ${parts.join(" -- ")}`);
      await load();
    } catch (e: any) {
      setMessage(`Fout: ${e.message}`);
    }
    setSyncing(false);
  }

  const monthly = useMemo(() => {
    const included = orders.filter((o) => !EXCLUDED_STATUSES.includes(o.status));
    const map = new Map<string, { orders: number; revenue: number }>();
    for (const o of included) {
      const key = monthKey(o.date_created);
      const entry = map.get(key) ?? { orders: 0, revenue: 0 };
      entry.orders++;
      entry.revenue += Number(o.total) || 0;
      map.set(key, entry);
    }
    const { start, end } = periodRange(period);
    const rangeStart = start ?? (orders.length > 0 ? new Date(orders[0].date_created) : end);
    return buildMonthRange(rangeStart, end).map((key) => ({ key, label: monthLabel(key), ...(map.get(key) ?? { orders: 0, revenue: 0 }) }));
  }, [orders, period]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return Array.from(map.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [orders]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const it of items) {
      const key = it.sku || it.name;
      const entry = map.get(key) ?? { name: it.name, quantity: 0, revenue: 0 };
      entry.quantity += Number(it.quantity) || 0;
      entry.revenue += Number(it.total) || 0;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  }, [items]);

  const totals = useMemo(() => {
    const included = orders.filter((o) => !EXCLUDED_STATUSES.includes(o.status));
    const revenue = included.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const count = included.length;
    return { count, revenue, avg: count > 0 ? revenue / count : 0 };
  }, [orders]);

  if (!ready) return null;

  return (
    <div>
      <h1>Bestellingen</h1>
      <p className="sub">Overzicht van je WooCommerce-bestellingen: omzet en aantal per maand, en de meest verkochte producten. De cijfers komen uit de lokale kopie hieronder -- synchroniseer om ze bij te werken.</p>

      {!configured && (
        <div className="warning" style={{ marginBottom: 16 }}>
          WooCommerce is niet gekoppeld: stel <code>WOOCOMMERCE_URL</code>, <code>WOOCOMMERCE_CONSUMER_KEY</code> en <code>WOOCOMMERCE_CONSUMER_SECRET</code> in.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={syncing} onClick={() => runSync(false)}>{syncing ? "Bezig..." : "Synchroniseer bestellingen"}</button>
        <button className="btn secondary" disabled={syncing} onClick={() => runSync(true)}>Volledige historiek importeren</button>
        <span className="muted" style={{ fontSize: 12 }}>
          {totalOrdersSynced == null ? "" : `${totalOrdersSynced} bestelling(en) lokaal bekend`}
          {lastSync && ` -- laatst gesynchroniseerd op ${new Date(lastSync).toLocaleString("nl-BE")}`}
        </span>
      </div>

      {message && <p className="mono" style={{ marginBottom: 16 }}>{message}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Periode</label>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} style={{ maxWidth: 260 }}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="muted">Laden...</p>
      ) : totalOrdersSynced === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Nog geen bestellingen gesynchroniseerd. Klik hierboven op "Volledige historiek importeren" om te beginnen.</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Geen bestellingen gevonden in deze periode.</p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <div className="card stat-tile">
              <div className="stat-label">Bestellingen</div>
              <div className="stat-value">{totals.count}</div>
            </div>
            <div className="card stat-tile">
              <div className="stat-label">Omzet</div>
              <div className="stat-value">{eurCompact(totals.revenue)}</div>
            </div>
            <div className="card stat-tile">
              <div className="stat-label">Gem. bestelwaarde</div>
              <div className="stat-value">{eurCompact(totals.avg)}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Bestellingen per maand</h2>
            <MonthlyBarChart data={monthly.map((m) => ({ key: m.key, label: m.label, value: m.orders }))} color="var(--cyan)" formatValue={(v) => `${v}`} />
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Omzet per maand</h2>
            <MonthlyBarChart data={monthly.map((m) => ({ key: m.key, label: m.label, value: m.revenue }))} color="var(--yellow)" formatValue={eur} />
          </div>

          <details className="card" style={{ marginBottom: 16 }}>
            <summary style={{ cursor: "pointer", color: "var(--cyan)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Cijfers per maand tonen
            </summary>
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Maand</th><th>Bestellingen</th><th>Omzet</th></tr></thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.key}><td>{m.label}</td><td className="mono">{m.orders}</td><td className="mono">{eur(m.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>

          <div className="row">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Meest verkochte producten</h2>
              {topProducts.length === 0 ? (
                <p className="muted">Geen productregels in deze periode.</p>
              ) : (
                <RankedBarChart data={topProducts.map((p) => ({ key: p.name, label: p.name, value: p.quantity }))} formatValue={(v) => `${v}x`} />
              )}
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Bestellingen per status</h2>
              <StatusBreakdownBar data={statusBreakdown} />
              <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                Omzet, aantal en topproducten hierboven tellen "{STATUS_LABELS.cancelled}" en "{STATUS_LABELS.failed}" niet mee.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Verticale balkjesgrafiek voor een reeks over de tijd (bv. per maand) -- één kleur, waarde in de tooltip. */
function MonthlyBarChart({ data, color, formatValue }: { data: { key: string; label: string; value: number }[]; color: string; formatValue: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140, padding: "0 2px" }}>
      {data.map((d) => (
        <div key={d.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
          <div
            className="bar-chart__bar"
            tabIndex={0}
            title={`${d.label}: ${formatValue(d.value)}`}
            style={{
              width: "100%",
              maxWidth: 24,
              height: d.value > 0 ? `${Math.max((d.value / max) * 100, 2)}%` : 0,
              background: color,
              borderRadius: "4px 4px 0 0",
            }}
          />
          <span className="muted mono" style={{ fontSize: 10, marginTop: 4, whiteSpace: "nowrap" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontale, aflopend gesorteerde ranglijst (bv. meest verkochte producten) -- waarde rechts van de balk. */
function RankedBarChart({ data, formatValue }: { data: { key: string; label: string; value: number }[]; formatValue: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((d) => (
        <div key={d.key} className="rank-bar__track" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 160, flexShrink: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>{d.label}</span>
          <div style={{ flex: 1, background: "var(--line-soft)", height: 18 }}>
            <div className="rank-bar__fill" style={{ width: `${(d.value / max) * 100}%`, height: "100%", background: "var(--cyan)", borderRadius: "0 4px 4px 0" }} />
          </div>
          <span className="mono" style={{ width: 46, textAlign: "right", fontSize: 12, flexShrink: 0 }}>{formatValue(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Statusverdeling als één gestapelde balk + legende (part-to-whole, weinig categorieën). */
function StatusBreakdownBar({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <p className="muted">Geen data.</p>;
  return (
    <div>
      <div style={{ display: "flex", height: 16, borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)" }} role="img" aria-label="Bestellingen per status">
        {data.map((d) => (
          <div
            key={d.status}
            title={`${STATUS_LABELS[d.status] ?? d.status}: ${d.count}`}
            style={{ width: `${(d.count / total) * 100}%`, background: STATUS_COLORS[d.status] ?? "var(--ink-faint)" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }} className="muted">
        {data.map((d) => (
          <span key={d.status}>
            <span style={{ display: "inline-block", width: 9, height: 9, background: STATUS_COLORS[d.status] ?? "var(--ink-faint)", marginRight: 5 }} />
            {STATUS_LABELS[d.status] ?? d.status} <span className="mono">{d.count} ({Math.round((d.count / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
