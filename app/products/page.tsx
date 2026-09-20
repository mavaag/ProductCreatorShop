"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { Product, ProductVariation, PROCESS_TYPE_LABELS } from "@/lib/types";

type ProcessType = Product["process_type"];
type ProductWithVariations = Product & { product_variations: ProductVariation[] };

const TABS: { value: ProcessType | "all"; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "3d_print", label: PROCESS_TYPE_LABELS["3d_print"] },
  { value: "uv_print", label: PROCESS_TYPE_LABELS["uv_print"] },
  { value: "laser_engraving", label: PROCESS_TYPE_LABELS["laser_engraving"] },
  { value: "laser_cutting", label: PROCESS_TYPE_LABELS["laser_cutting"] },
  { value: "sublimation", label: PROCESS_TYPE_LABELS["sublimation"] },
];

type SortKey = "name" | "sku" | "price_low" | "price_high" | "variations";
type PublishFilter = "all" | "published" | "unpublished";

function priceRange(p: ProductWithVariations) {
  const prices = p.product_variations.map((v) => v.suggested_price).filter((x): x is number => x != null);
  if (prices.length === 0) return { min: null as number | null, max: null as number | null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export default function ProductsPage() {
  const ready = useAuthGuard();
  const [products, setProducts] = useState<ProductWithVariations[]>([]);
  const [activeTab, setActiveTab] = useState<ProcessType | "all">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [publishFilter, setPublishFilter] = useState<PublishFilter>("all");

  async function load() {
    const { data } = await supabase
      .from("products")
      .select("*, product_variations(*)")
      .order("name");
    setProducts((data as ProductWithVariations[]) ?? []);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function deleteProduct(id: string) {
    if (!confirm("Dit product (en al zijn varianten) verwijderen?")) return;
    await supabase.from("products").delete().eq("id", id);
    load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: products.length };
    for (const p of products) c[p.process_type] = (c[p.process_type] ?? 0) + 1;
    return c;
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (activeTab !== "all") list = list.filter((p) => p.process_type === activeTab);
    if (publishFilter !== "all") list = list.filter((p) => (publishFilter === "published" ? p.published : !p.published));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));

    const withPrices = list.map((p) => ({ p, range: priceRange(p) }));
    withPrices.sort((a, b) => {
      switch (sortKey) {
        case "sku":
          return a.p.sku.localeCompare(b.p.sku, undefined, { numeric: true });
        case "price_low":
          return (a.range.min ?? Infinity) - (b.range.min ?? Infinity);
        case "price_high":
          return (b.range.max ?? -Infinity) - (a.range.max ?? -Infinity);
        case "variations":
          return b.p.product_variations.length - a.p.product_variations.length;
        case "name":
        default:
          return a.p.name.localeCompare(b.p.name);
      }
    });
    return withPrices.map((x) => x.p);
  }, [products, activeTab, publishFilter, search, sortKey]);

  if (!ready) return null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>Producten</h1>
          <p className="sub">Prijsberekening blijft hier bewaard per product -- de export naar WooCommerce bevat enkel de velden die WooCommerce nodig heeft.</p>
        </div>
        <div>
          <a
            className="btn secondary"
            href={activeTab === "all" ? "/api/export" : `/api/export?type=${activeTab}`}
            style={{ marginRight: 8 }}
          >
            {activeTab === "all" ? "Exporteer alles (WooCommerce CSV)" : `Exporteer ${PROCESS_TYPE_LABELS[activeTab]} (WooCommerce CSV)`}
          </a>
          <Link className="btn" href="/products/new">+ Nieuw product</Link>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            className={`tab ${activeTab === t.value ? "active" : ""}`}
            onClick={() => setActiveTab(t.value)}
          >
            {t.label} <span className="tab-count">{counts[t.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label>Zoeken</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Naam of SKU..." />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>Sorteren op</label>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="name">Naam (A-Z)</option>
            <option value="sku">SKU</option>
            <option value="price_low">Prijs (laag naar hoog)</option>
            <option value="price_high">Prijs (hoog naar laag)</option>
            <option value="variations">Aantal varianten</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>Publicatiestatus</label>
          <select value={publishFilter} onChange={(e) => setPublishFilter(e.target.value as PublishFilter)}>
            <option value="all">Alles</option>
            <option value="published">Enkel gepubliceerd</option>
            <option value="unpublished">Enkel niet-gepubliceerd</option>
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Naam</th><th>Techniek</th><th>SKU</th><th>Attributen</th><th>Varianten</th><th>Verkoopprijs</th><th>Gepubliceerd</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const { min, max } = priceRange(p);
            const priceLabel = min == null
              ? "-- nog niet berekend --"
              : min !== max
                ? `€${min.toFixed(2)} - €${max!.toFixed(2)}`
                : `€${min.toFixed(2)}`;
            return (
              <tr key={p.id}>
                <td><Link href={`/products/${p.id}`}>{p.name}</Link></td>
                <td><span className="pill">{PROCESS_TYPE_LABELS[p.process_type]}</span></td>
                <td className="mono">{p.sku}</td>
                <td>{p.attribute_names.join(", ")}</td>
                <td className="mono">{p.product_variations.length}</td>
                <td className="mono">{priceLabel}</td>
                <td>{p.published ? "Ja" : "Nee"}</td>
                <td>
                  <Link className="btn secondary" href={`/products/${p.id}`} style={{ marginRight: 6 }}>Bewerken</Link>
                  <button className="btn danger" onClick={() => deleteProduct(p.id)}>Verwijder</button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={8} className="muted">
              {products.length === 0
                ? 'Nog geen producten -- klik op "+ Nieuw product" om te starten.'
                : "Geen producten gevonden voor deze filter/zoekopdracht."}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
