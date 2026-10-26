"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { PROCESS_TYPE_LABELS } from "@/lib/types";
import { ProductFolder, loadProductFolders } from "@/lib/productionFiles";
import FolderBrowser from "@/components/FolderBrowser";

// Tabblad Bestellingen > Productie: openstaande bestellingen (in verwerking / on hold) met per regel het product,
// de gekozen opties en de productiebestanden op de NAS; per regel "gemaakt" afvinken (tabel wc_production).
// De bestellingen komen automatisch binnen via de maker-agent (tools/maker/orders_sync.py, elke 10 minuten).

const OPEN_STATUSES = ["processing", "on-hold"];

type Line = {
  id: string; wc_line_id: number | null; name: string; sku: string | null; quantity: number;
  meta: { key: string; value: string }[] | null;
};
type Order = {
  id: string; wc_order_id: number; order_number: string; status: string; date_created: string;
  customer_name: string | null; shipping_method: string | null; customer_note: string | null; wc_order_items: Line[];
};
type ProductInfo = { id: string; name: string; process_type: string };

export default function ProductionQueue() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [productBySku, setProductBySku] = useState<Map<string, ProductInfo>>(new Map());
  const [folders, setFolders] = useState<Map<string, ProductFolder[]>>(new Map());
  const [hideDone, setHideDone] = useState(true);
  const [tech, setTech] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from("wc_orders")
      .select("id, wc_order_id, order_number, status, date_created, customer_name, shipping_method, customer_note, wc_order_items(id, wc_line_id, name, sku, quantity, meta)")
      .in("status", OPEN_STATUSES).order("date_created", { ascending: true });
    if (error) { setError(error.message); return; }
    const list = (data ?? []) as Order[];
    const wcIds = list.map((o) => o.wc_order_id);
    const skus = Array.from(new Set(list.flatMap((o) => o.wc_order_items.map((l) => l.sku).filter(Boolean) as string[])));
    const [{ data: prod }, { data: vars }, { data: made }] = await Promise.all([
      skus.length ? supabase.from("products").select("id, sku, name, process_type").in("sku", skus) : Promise.resolve({ data: [] as any[] }),
      skus.length ? supabase.from("product_variations").select("sku, product_id").in("sku", skus) : Promise.resolve({ data: [] as any[] }),
      wcIds.length ? supabase.from("wc_production").select("wc_order_id, wc_line_id").in("wc_order_id", wcIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    // SKU van een variant -> zijn product; SKU van een simpel product -> dat product
    const byId = new Map<string, ProductInfo>((prod ?? []).map((p: any) => [p.id, p]));
    const varProductIds = Array.from(new Set((vars ?? []).map((v: any) => v.product_id).filter((id: string) => !byId.has(id))));
    if (varProductIds.length) {
      const { data: more } = await supabase.from("products").select("id, sku, name, process_type").in("id", varProductIds);
      for (const p of more ?? []) byId.set(p.id, p);
    }
    const bySku = new Map<string, ProductInfo>();
    for (const p of prod ?? []) bySku.set(p.sku, byId.get(p.id)!);
    for (const v of vars ?? []) if (byId.has(v.product_id)) bySku.set(v.sku, byId.get(v.product_id)!);
    setProductBySku(bySku);
    setFolders(await loadProductFolders(supabase, Array.from(new Set(Array.from(bySku.values()).map((p) => p.id)))));
    setDone(new Set((made ?? []).map((m: any) => `${m.wc_order_id}:${m.wc_line_id}`)));
    setOrders(list);
  }
  useEffect(() => { load(); }, []);

  async function toggleDone(o: Order, l: Line) {
    if (l.wc_line_id == null) return;
    const key = `${o.wc_order_id}:${l.wc_line_id}`;
    const { error } = done.has(key)
      ? await supabase.from("wc_production").delete().eq("wc_order_id", o.wc_order_id).eq("wc_line_id", l.wc_line_id)
      : await supabase.from("wc_production").upsert({ wc_order_id: o.wc_order_id, wc_line_id: l.wc_line_id });
    if (error) { setError(error.message); return; }
    const next = new Set(done);
    if (next.has(key)) next.delete(key); else next.add(key);
    setDone(next);
  }

  const visible = useMemo(() => (orders ?? []).map((o) => ({
    ...o,
    wc_order_items: o.wc_order_items.filter((l) =>
      (!hideDone || !done.has(`${o.wc_order_id}:${l.wc_line_id}`)) &&
      (!tech || productBySku.get(l.sku ?? "")?.process_type === tech)),
  })).filter((o) => o.wc_order_items.length > 0), [orders, done, hideDone, tech, productBySku]);

  const openLines = (orders ?? []).reduce((n, o) => n + o.wc_order_items.filter((l) => !done.has(`${o.wc_order_id}:${l.wc_line_id}`)).length, 0);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 200 }}>
          <label>Techniek</label>
          <select value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(PROCESS_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Gemaakte regels verbergen
        </label>
        <button className="btn secondary" onClick={load}>Vernieuwen</button>
        <span className="muted" style={{ fontSize: 12 }}>
          {orders && `${orders.length} open bestelling(en), ${openLines} regel(s) nog te maken.`} Nieuwe bestellingen komen elke 10 minuten automatisch binnen.
        </span>
      </div>
      {error && <p className="warning">{error}</p>}
      {orders === null ? <p className="muted">Laden...</p> : visible.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Niets meer te maken. 🎉</p></div>
      ) : visible.map((o) => (
        <div key={o.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>#{o.order_number} {o.customer_name && <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· {o.customer_name}</span>}</h2>
            <span className="muted mono">
              {new Date(o.date_created).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })}
              {o.shipping_method && ` · ${o.shipping_method}`} · {o.status === "on-hold" ? "on hold" : "in verwerking"}
            </span>
          </div>
          {o.customer_note && <p className="warning" style={{ margin: "8px 0" }}>Opmerking klant: {o.customer_note}</p>}
          {o.wc_order_items.map((l) => {
            const p = productBySku.get(l.sku ?? "");
            const key = `${o.wc_order_id}:${l.wc_line_id}`;
            const fs = p ? folders.get(p.id) ?? [] : [];
            return (
              <div key={l.id} className="production-line">
                <label className="production-check" title="Gemaakt">
                  <input type="checkbox" style={{ width: "auto" }} checked={done.has(key)} disabled={l.wc_line_id == null} onChange={() => toggleDone(o, l)} />
                </label>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <b>{l.quantity} ×</b> {l.name} {l.sku && <span className="muted mono">{l.sku}</span>}
                    {p && <> · <span className="pill cyan">{PROCESS_TYPE_LABELS[p.process_type as keyof typeof PROCESS_TYPE_LABELS] ?? p.process_type}</span> <Link href={`/products/${p.id}`}>product</Link></>}
                  </div>
                  {(l.meta ?? []).length > 0 && (
                    <div className="muted" style={{ fontSize: 12.5 }}>{(l.meta ?? []).map((m) => `${m.key}: ${m.value}`).join(" · ")}</div>
                  )}
                  {!p ? <p className="muted" style={{ margin: "4px 0" }}>Geen product met deze SKU in de beheertool.</p>
                    : fs.length === 0 ? <p className="muted" style={{ margin: "4px 0" }}>Nog geen bestanden gekoppeld -- koppel een map op de <Link href={`/products/${p.id}`}>productpagina</Link>.</p>
                    : fs.map((f) => <FolderBrowser key={f.path} path={f.path} title={f.path} />)}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
