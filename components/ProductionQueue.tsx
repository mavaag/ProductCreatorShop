"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { PROCESS_TYPE_LABELS } from "@/lib/types";
import { CustomerFile, ProductFolder, downloadCustomerFiles, loadProductFolders, splitOrderMeta } from "@/lib/productionFiles";
import FolderBrowser from "@/components/FolderBrowser";

// Tabblad Bestellingen > Productie: openstaande bestellingen (in verwerking / on hold) met per regel het product,
// de gekozen opties en de productiebestanden op de NAS; per regel "gemaakt" afvinken (tabel wc_production).
// De bestellingen komen automatisch binnen via de maker-agent (tools/maker/orders_sync.py, elke 10 minuten).

const OPEN_STATUSES = ["processing", "on-hold"];

type Line = {
  id: string; wc_line_id: number | null; name: string; sku: string | null; quantity: number;
  total: number; total_tax: number | null; // regel excl. btw + btw (migratie 037)
  meta: { key: string; value: string }[] | null;
};
type Order = {
  id: string; wc_order_id: number; order_number: string; status: string; date_created: string;
  customer_name: string | null; shipping_method: string | null; customer_note: string | null; wc_order_items: Line[];
  total: number; shipping_total: number | null; shipping_tax: number | null; discount_total: number | null;
};

const euro = (n: number) => n.toLocaleString("nl-BE", { style: "currency", currency: "EUR" });

/**
 * Betaald, verzending, kostprijs en winst van een bestelling. Prijzen in de shop zijn wat de klant betaalt (geen
 * btw-plicht), dus omzet = regel + "btw" zoals WooCommerce ze opsplitst. Verzending gaat naar de vervoerder en telt
 * niet mee in de winst. Kostprijs = huidige kostprijs van de variant in de beheertool.
 */
function OrderAmounts({ o, costBySku }: { o: Order; costBySku: Map<string, number> }) {
  const shipping = Number(o.shipping_total ?? 0) + Number(o.shipping_tax ?? 0);
  const productsPaid = o.wc_order_items.reduce((s, l) => s + Number(l.total) + Number(l.total_tax ?? 0), 0);
  let cost = 0;
  const missing: string[] = [];
  for (const l of o.wc_order_items) {
    const c = costBySku.get(l.sku ?? "");
    if (c == null) missing.push(l.name);
    else cost += c * Number(l.quantity);
  }
  const profit = productsPaid - cost;
  const margin = productsPaid > 0 ? Math.round((profit / productsPaid) * 100) : 0;
  return (
    <div className="order-amounts">
      <span><b>Betaald</b> {euro(Number(o.total))}</span>
      <span><b>Producten</b> {euro(productsPaid)}</span>
      <span><b>Verzending</b> {euro(shipping)}</span>
      {Number(o.discount_total ?? 0) > 0 && <span><b>Korting</b> −{euro(Number(o.discount_total))}</span>}
      <span><b>Kostprijs</b> {euro(cost)}</span>
      <span className={profit >= 0 ? "order-profit" : "order-loss"} title="Producten min kostprijs (verzending niet meegerekend)">
        <b>Winst</b> {missing.length ? "≥ " : ""}{euro(profit)} ({margin}%)
      </span>
      {missing.length > 0 && (
        <span className="muted" title={missing.join("\n")}>kostprijs onbekend voor {missing.length} regel{missing.length === 1 ? "" : "s"}</span>
      )}
    </div>
  );
}
type ProductInfo = { id: string; name: string; process_type: string };

/** Bestanden die de klant opleverde of die de gravure-plugin maakte (logo, afbeelding, preview): bekijken of als zip. */
function CustomerFiles({ files, zipName }: { files: CustomerFile[]; zipName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function zip() {
    setBusy(true); setError(null);
    try { await downloadCustomerFiles(supabase, zipName, files); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div className="customer-files">
      <div className="customer-files-head">
        <b>Bestanden van de klant</b>
        <button type="button" className="btn secondary" disabled={busy} onClick={zip}>{busy ? "Bezig..." : "Download klantbestanden (zip)"}</button>
      </div>
      <div className="customer-files-list">
        {files.map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="customer-file" title={`${f.label} -- openen in een nieuw tabblad`}>
            {/\.pdf$/i.test(f.url) ? <span className="customer-file-pdf">PDF</span> : <img src={f.url} alt={f.label} loading="lazy" />}
            <span>{f.label}</span>
          </a>
        ))}
      </div>
      {error && <p className="warning" style={{ margin: "4px 0" }}>{error}</p>}
    </div>
  );
}

export default function ProductionQueue() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [productBySku, setProductBySku] = useState<Map<string, ProductInfo>>(new Map());
  const [costBySku, setCostBySku] = useState<Map<string, number>>(new Map());
  const [folders, setFolders] = useState<Map<string, ProductFolder[]>>(new Map());
  const [hideDone, setHideDone] = useState(true);
  const [tech, setTech] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stockByLine, setStockByLine] = useState<Map<string, number>>(new Map());

  async function load() {
    const { data, error } = await supabase.from("wc_orders")
      .select("id, wc_order_id, order_number, status, date_created, customer_name, shipping_method, customer_note, total, shipping_total, shipping_tax, discount_total, wc_order_items(id, wc_line_id, name, sku, quantity, total, total_tax, meta)")
      .in("status", OPEN_STATUSES).order("date_created", { ascending: true });
    if (error) { setError(error.message); return; }
    const list = (data ?? []) as Order[];
    const wcIds = list.map((o) => o.wc_order_id);
    const skus = Array.from(new Set(list.flatMap((o) => o.wc_order_items.map((l) => l.sku).filter(Boolean) as string[])));
    const [{ data: prod }, { data: vars }, { data: made }] = await Promise.all([
      skus.length ? supabase.from("products").select("id, sku, name, process_type").in("sku", skus) : Promise.resolve({ data: [] as any[] }),
      skus.length ? supabase.from("product_variations").select("sku, product_id, cost_price").in("sku", skus) : Promise.resolve({ data: [] as any[] }),
      wcIds.length ? supabase.from("wc_production").select("wc_order_id, wc_line_id").in("wc_order_id", wcIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    // Regels die (deels) uit "klaar op voorraad" komen (migratie 039; ontbreekt de tabel, dan leeg).
    const { data: fromStock } = wcIds.length
      ? await supabase.from("order_line_stock").select("wc_order_id, wc_line_id, from_stock").in("wc_order_id", wcIds).gt("from_stock", 0)
      : { data: [] as any[] };
    setStockByLine(new Map((fromStock ?? []).map((r: any) => [`${r.wc_order_id}:${r.wc_line_id}`, Number(r.from_stock)])));
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
    const costs = new Map<string, number>();
    for (const v of vars ?? []) if (v.cost_price != null && Number(v.cost_price) > 0) costs.set(v.sku, Number(v.cost_price));
    setCostBySku(costs);
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
          <OrderAmounts o={(orders ?? []).find((x) => x.id === o.id) ?? o} costBySku={costBySku} />
          {o.customer_note && <p className="warning" style={{ margin: "8px 0" }}>Opmerking klant: {o.customer_note}</p>}
          {o.wc_order_items.map((l) => {
            const p = productBySku.get(l.sku ?? "");
            const key = `${o.wc_order_id}:${l.wc_line_id}`;
            const fs = p ? folders.get(p.id) ?? [] : [];
            const { options, files } = splitOrderMeta(l.meta, `${o.order_number}-${l.wc_line_id ?? "regel"}`);
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
                  {(stockByLine.get(key) ?? 0) > 0 && (
                    <div className="from-stock">
                      {stockByLine.get(key)! >= l.quantity
                        ? "Uit voorraad -- enkel inpakken"
                        : `${stockByLine.get(key)} uit voorraad (enkel inpakken), ${l.quantity - stockByLine.get(key)!} nog te maken`}
                    </div>
                  )}
                  {options.length > 0 && (
                    <dl className="order-options">
                      {options.map((m, i) => (
                        <div key={i} className="order-option">
                          <dt>{m.key}</dt>
                          <dd>{String(m.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {files.length > 0 && <CustomerFiles files={files} zipName={`bestelling-${o.order_number}-regel-${l.wc_line_id ?? l.id}`} />}
                  {!p ? <p className="muted" style={{ margin: "4px 0" }}>Geen product met deze SKU in de beheertool.</p>
                    : fs.length === 0 ? (files.length > 0 ? null : <p className="muted" style={{ margin: "4px 0" }}>Nog geen bestanden gekoppeld -- koppel een map op de <Link href={`/products/${p.id}`}>productpagina</Link>.</p>)
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
