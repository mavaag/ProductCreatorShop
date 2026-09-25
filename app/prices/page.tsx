"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { RecalcChange, applyRecalculation, previewRecalculation } from "@/lib/recalc";
import { confirmDialog } from "@/components/DialogHost";

export default function PricesPage() {
  const ready = useAuthGuard();
  const [changes, setChanges] = useState<RecalcChange[] | null>(null);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function preview() {
    setBusy(true);
    setMessage(null);
    const [result, { data: products }] = await Promise.all([
      previewRecalculation(supabase),
      supabase.from("products").select("id, name"),
    ]);
    setProductNames(Object.fromEntries((products ?? []).map((p: any) => [p.id, p.name])));
    setChanges(result);
    setBusy(false);
  }

  async function apply() {
    if (!changes || changes.length === 0) return;
    if (!(await confirmDialog(`${changes.length} variant(en) bijwerken? De oude prijzen blijven terug te vinden in de prijsgeschiedenis.`))) return;
    setBusy(true);
    await applyRecalculation(supabase, changes, "Herberekening (materiaal-/machineprijzen)");
    setMessage(`${changes.length} variant(en) bijgewerkt.`);
    setChanges(null);
    setBusy(false);
  }

  if (!ready) return null;

  return (
    <div>
      <h1>Prijzen herberekenen</h1>
      <p className="sub">
        Wijzigde een materiaalprijs, machinekost of stroomtarief? Bereken hier de prijzen van alle varianten opnieuw en bekijk
        eerst wat er verandert voordat je iets opslaat.
      </p>

      <div style={{ marginBottom: 16 }}>
        <button className="btn" onClick={preview} disabled={busy}>{busy ? "Bezig..." : "Toon wat er verandert"}</button>
        {changes && changes.length > 0 && (
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={apply} disabled={busy}>
            {changes.length} wijziging(en) toepassen
          </button>
        )}
      </div>
      {message && <div className="card" style={{ background: "var(--moss-soft)" }}>{message}</div>}

      {changes && changes.length === 0 && <p className="muted">Alle prijzen zijn al up-to-date met de huidige materiaal- en machinegegevens.</p>}

      {changes && changes.length > 0 && (
        <table>
          <thead>
            <tr><th>Product</th><th>Variant (SKU)</th><th>Kostprijs</th><th>Verkoopprijs</th><th>Verschil</th></tr>
          </thead>
          <tbody>
            {changes.map((c) => {
              const diff = c.oldPrice != null && c.newPrice != null ? c.newPrice - c.oldPrice : null;
              return (
                <tr key={c.variationId}>
                  <td><Link href={`/products/${c.productId}`}>{productNames[c.productId] ?? c.productId}</Link></td>
                  <td className="mono">{c.sku}</td>
                  <td className="mono">{fmt(c.oldCost)} → {fmt(c.newCost)}</td>
                  <td className="mono">{fmt(c.oldPrice)} → {fmt(c.newPrice)}</td>
                  <td className="mono" style={{ color: diff == null ? undefined : diff > 0 ? "var(--rust)" : "var(--moss)" }}>
                    {diff == null ? "--" : `${diff > 0 ? "+" : ""}€${diff.toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function fmt(n: number | null) {
  return n == null ? "--" : `€${Number(n).toFixed(2)}`;
}
