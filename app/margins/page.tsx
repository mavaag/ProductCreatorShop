"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { effectiveMargin, totalMachineHours } from "@/lib/pricing";
import { loadMinMargin, saveMinMargin } from "@/lib/settings";
import { DEFAULT_MIN_MARGIN, DEFAULT_VAT_RATE, PROCESS_TYPE_LABELS, Product, ProductVariation } from "@/lib/types";

type Row = {
  variation: ProductVariation;
  product: Product;
  margin: number | null;
  profit: number | null; // € winst excl. btw
  profitPerHour: number | null; // € winst per machine-uur
};

type SortKey = "margin" | "profit" | "profitPerHour" | "name";

export default function MarginsPage() {
  const ready = useAuthGuard();
  const [rows, setRows] = useState<Row[]>([]);
  const [minMargin, setMinMargin] = useState(DEFAULT_MIN_MARGIN);
  const [minInput, setMinInput] = useState(String(Math.round(DEFAULT_MIN_MARGIN * 100)));
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("margin");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [min, { data: products }] = await Promise.all([
        loadMinMargin(supabase),
        supabase.from("products").select("*, product_variations(*)"),
      ]);
      setMinMargin(min);
      setMinInput(String(Math.round(min * 100)));
      const list: Row[] = [];
      for (const p of (products ?? []) as (Product & { product_variations: ProductVariation[] })[]) {
        for (const v of p.product_variations) {
          const vat = v.cost_inputs?.vat_rate ?? DEFAULT_VAT_RATE;
          const margin = effectiveMargin(v.cost_price, v.suggested_price, vat);
          const profit = v.cost_price != null && v.suggested_price != null ? v.suggested_price / (1 + vat) - v.cost_price : null;
          const hours = totalMachineHours(v.cost_inputs);
          list.push({ variation: v, product: p, margin, profit, profitPerHour: profit != null && hours > 0 ? profit / hours : null });
        }
      }
      setRows(list);
    })();
  }, [ready]);

  async function saveMin() {
    const pct = parseFloat(minInput);
    if (!(pct > 0 && pct < 100)) {
      setMessage("Geef een percentage tussen 1 en 99.");
      return;
    }
    const { error } = await saveMinMargin(supabase, pct / 100);
    if (error) setMessage(error.message);
    else {
      setMinMargin(pct / 100);
      setMessage("Minimale marge opgeslagen.");
    }
  }

  const belowCount = rows.filter((r) => r.margin != null && r.margin < minMargin).length;

  const shown = useMemo(() => {
    let list = onlyBelow ? rows.filter((r) => r.margin != null && r.margin < minMargin) : rows;
    const key = (r: Row) => (sortKey === "name" ? 0 : (r[sortKey] ?? Infinity));
    list = [...list].sort((a, b) => (sortKey === "name" ? a.product.name.localeCompare(b.product.name) : key(a) - key(b)));
    return list;
  }, [rows, onlyBelow, sortKey, minMargin]);

  if (!ready) return null;

  return (
    <div>
      <h1>Marge-overzicht</h1>
      <p className="sub">
        De werkelijke marge na afronden op ,95 (excl. btw), en de winst per machine-uur -- zo zie je welke producten weinig opbrengen
        voor de tijd die de machine bezet is.
      </p>

      <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 160 }}>
          <label>Minimale marge (%)</label>
          <input type="number" value={minInput} onChange={(e) => setMinInput(e.target.value)} />
        </div>
        <button className="btn secondary" onClick={saveMin}>Opslaan</button>
        <div style={{ width: 200 }}>
          <label>Sorteren op</label>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="margin">Marge (laag naar hoog)</option>
            <option value="profit">Winst per stuk (laag naar hoog)</option>
            <option value="profitPerHour">Winst per machine-uur (laag naar hoog)</option>
            <option value="name">Productnaam</option>
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} />
          Enkel onder het minimum
        </label>
      </div>
      {message && <p className="muted">{message}</p>}

      {belowCount > 0 && (
        <div className="warning" style={{ marginBottom: 16 }}>
          {belowCount} variant(en) zitten onder je minimum van {Math.round(minMargin * 100)}%.
        </div>
      )}

      <table>
        <thead>
          <tr><th>Product</th><th>Techniek</th><th>Variant (SKU)</th><th>Kostprijs</th><th>Verkoopprijs</th><th>Marge</th><th>Winst</th><th>Winst / machine-uur</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const low = r.margin != null && r.margin < minMargin;
            return (
              <tr key={r.variation.id}>
                <td><Link href={`/products/${r.product.id}`}>{r.product.name}</Link></td>
                <td><span className="pill">{PROCESS_TYPE_LABELS[r.product.process_type]}</span></td>
                <td className="mono">{r.variation.sku}</td>
                <td className="mono">{money(r.variation.cost_price)}</td>
                <td className="mono">{money(r.variation.suggested_price)}</td>
                <td className="mono" style={low ? { color: "var(--rust)", fontWeight: 600 } : undefined}>
                  {r.margin != null ? `${(r.margin * 100).toFixed(1)}%` : "--"}
                </td>
                <td className="mono">{money(r.profit)}</td>
                <td className="mono">{r.profitPerHour != null ? `€${r.profitPerHour.toFixed(2)}/u` : "--"}</td>
              </tr>
            );
          })}
          {shown.length === 0 && <tr><td colSpan={8} className="muted">Geen varianten om te tonen.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function money(n: number | null) {
  return n == null ? "--" : `€${Number(n).toFixed(2)}`;
}
