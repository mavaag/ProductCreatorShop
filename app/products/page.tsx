"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { Product, ProductVariation, PROCESS_TYPE_LABELS } from "@/lib/types";
import { downloadExport } from "@/lib/download";
import { duplicateProduct } from "@/lib/duplicate";
import { setMarginForProducts } from "@/lib/recalc";
import { nextAvailableSku, skuExists } from "@/lib/sku";
import { PromptModal } from "@/components/PromptModal";
import { confirmDialog } from "@/components/DialogHost";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMargin, setBulkMargin] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<{ product: ProductWithVariations; suggested: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; product: string } | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; product: string } | null>(null);

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
    const product = products.find(p => p.id === id);
    if (!product) return;

    if (!(await confirmDialog(`"${product.name}" (en al zijn varianten) verwijderen uit de lokale database?`, { confirmLabel: "Verwijderen", danger: true }))) return;

    // Vraag of het ook uit WooCommerce verwijderd moet worden
    const deleteFromWoo = await confirmDialog(
      `Ook uit WooCommerce verwijderen?\n\n` +
      `Klik "Ja, ook uit WooCommerce" om het product zowel lokaal als in WooCommerce te verwijderen.\n` +
      `Klik Annuleren om alleen lokaal te verwijderen (het product blijft in WooCommerce staan).`,
      { confirmLabel: "Ja, ook uit WooCommerce", danger: true }
    );

    setBusy(true);
    setMessage(null);

    try {
      // Verwijder uit WooCommerce indien gewenst
      if (deleteFromWoo) {
        const { data } = await supabase.auth.getSession();
        const res = await fetch("/api/woocommerce/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
          body: JSON.stringify({ sku: product.sku })
        });

        const body = await res.json();

        if (res.ok && body.deleted) {
          setMessage(`Product "${product.name}" verwijderd uit WooCommerce.`);
        } else if (res.ok && !body.deleted) {
          setMessage(`Product niet gevonden in WooCommerce. Alleen lokaal verwijderd.`);
        } else {
          throw new Error(body.error ?? "Fout bij verwijderen uit WooCommerce");
        }
      }

      // Verwijder uit lokale database
      await supabase.from("products").delete().eq("id", id);

      if (!deleteFromWoo) {
        setMessage(`Product "${product.name}" verwijderd uit lokale database. Het product blijft bestaan in WooCommerce.`);
      }

      load();
    } catch (e: any) {
      setMessage(`Fout: ${e.message}`);
    }

    setBusy(false);
  }

  function isChanged(p: ProductWithVariations) {
    if (!p.last_exported_at || p.updated_at > p.last_exported_at) return true;
    return p.product_variations.some((v) => v.suggested_price != null && Number(v.suggested_price) !== Number(v.exported_price));
  }

  async function runExport(params: Record<string, string>, label: string) {
    setBusy(true);
    setMessage(null);
    setExportProgress(`${label}...`);
    try {
      const count = await downloadExport({ ...params, ...(activeTab !== "all" ? { type: activeTab } : {}), mark: "1" });
      setExportProgress(null);
      setMessage(`${label}: ${count} product(en) geëxporteerd.`);
      load();
    } catch (e: any) {
      setExportProgress(null);
      setMessage(e.message);
    }
    setBusy(false);
  }

  async function callSync(options: { createMissing: boolean; dryRun: boolean }, productIds?: string[]) {
    const { data } = await supabase.auth.getSession();
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify({ ...options, ...(activeTab !== "all" ? { type: activeTab } : {}), ...(productIds ? { productIds } : {}) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Synchronisatie mislukt (${res.status})`);
    return body;
  }

  // createMissing false: enkel prijzen van bestaande producten. true: ook nieuwe producten aanmaken,
  // na een droge run die eerst toont wat er precies zou gebeuren. productIds: beperk tot deze producten
  // (bv. een selectie op de lijst) i.p.v. alle producten (binnen het actieve techniek-tabblad).
  async function runSync(createMissing: boolean, productIds?: string[]) {
    setBusy(true);
    setMessage(null);
    setSyncProgress(null);
    try {
      // Toon initiële loading indicator
      setSyncProgress({ current: 0, total: 0, product: "Voorbereiden..." });

      if (createMissing) {
        const plan = await callSync({ createMissing: true, dryRun: true }, productIds);
        setSyncProgress(null);
        const names = plan.created.length ? plan.created.join(", ") : "geen";
        const proceed = await confirmDialog(
          `Nieuw aan te maken in WooCommerce (${plan.created.length}): ${names}\n\n` +
            `Prijzen bij te werken bij bestaande producten: ${plan.updated}\n\n` +
            `Gepubliceerde producten staan meteen live in je shop, niet-gepubliceerde komen als concept. Doorgaan?`
        );
        if (!proceed) {
          setBusy(false);
          return;
        }
      } else {
        setSyncProgress(null);
        const message = productIds
          ? `${productIds.length} geselecteerde product(en) synchroniseren met WooCommerce?\n\nDit update: prijzen, beschrijving, categorieën, afbeeldingen, gewicht en verzendklasse.`
          : "Bestaande producten synchroniseren met WooCommerce?\n\nDit update: prijzen, beschrijving, categorieën, afbeeldingen, gewicht en verzendklasse.";
        if (!(await confirmDialog(message))) {
          setBusy(false);
          return;
        }
      }

      // Haal de producten op die gesynchroniseerd gaan worden
      setSyncProgress({ current: 0, total: 0, product: "Producten ophalen..." });
      let query = supabase.from("products").select("id, sku, name").order("name");
      if (productIds) query = query.in("id", productIds);
      else if (activeTab !== "all") query = query.eq("process_type", activeTab);
      const { data: productsToSync } = await query;
      const total = productsToSync?.length ?? 0;

      if (total === 0) {
        setSyncProgress(null);
        setMessage("Geen producten om te synchroniseren.");
        setBusy(false);
        return;
      }

      // Toon initiële voortgang
      setSyncProgress({ current: 0, total, product: "Verbinding maken met WooCommerce..." });

      // Simuleer voortgang tijdens het synchroniseren (elke 800ms een product verder)
      let estimatedProgress = 0;
      const progressInterval = setInterval(() => {
        if (estimatedProgress < total - 1) {
          estimatedProgress++;
          const currentProduct = (productsToSync ?? [])[estimatedProgress] as any;
          setSyncProgress({
            current: estimatedProgress,
            total,
            product: `${currentProduct?.name ?? "..."}`
          });
        }
      }, 800);

      try {
        const body = await callSync({ createMissing, dryRun: false }, productIds);
        clearInterval(progressInterval);

        // Toon 100% voltooid
        setSyncProgress({ current: total, total, product: "Synchronisatie voltooid!" });
        setTimeout(() => setSyncProgress(null), 1500);

        const parts = [`${body.updated} prijs/prijzen bijgewerkt`, `${body.unchanged} ongewijzigd`];
        if (body.created.length) parts.push(`aangemaakt: ${body.created.join(", ")}`);
        if (body.missingProducts.length) parts.push(`nog niet in de shop: ${body.missingProducts.join(", ")}`);
        if (body.missingVariations.length) parts.push(`varianten niet in de shop: ${body.missingVariations.join(", ")}`);
        if (body.notes.length) parts.push(`opmerkingen: ${body.notes.join("; ")}`);
        if (body.errors.length) parts.push(`fouten: ${body.errors.join("; ")}`);
        setMessage(`Synchronisatie: ${parts.join(" -- ")}`);
        load();
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    } catch (e: any) {
      setMessage(e.message);
      setSyncProgress(null);
    }
    setBusy(false);
  }

  async function startDuplicate(p: ProductWithVariations) {
    const suggested = await nextAvailableSku(supabase, "products", `${p.sku}-KOPIE`);
    setDuplicateTarget({ product: p, suggested });
  }

  async function confirmDuplicate(sku: string) {
    if (!duplicateTarget) return;
    setBusy(true);
    try {
      const id = await duplicateProduct(supabase, duplicateTarget.product, sku);
      window.location.href = `/products/${id}`;
    } catch (e: any) {
      setMessage(e.message);
      setBusy(false);
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function bulkPublish(published: boolean) {
    setBusy(true);
    await supabase.from("products").update({ published, updated_at: new Date().toISOString() }).in("id", Array.from(selected));
    setMessage(`${selected.size} product(en) ${published ? "gepubliceerd" : "gedepubliceerd"}.`);
    setBusy(false);
    load();
  }

  async function bulkDelete() {
    if (!(await confirmDialog(`${selected.size} product(en) met al hun varianten verwijderen?`, { confirmLabel: "Verwijderen", danger: true }))) return;
    setBusy(true);
    await supabase.from("products").delete().in("id", Array.from(selected));
    setSelected(new Set());
    setMessage("Producten verwijderd.");
    setBusy(false);
    load();
  }

  async function bulkSetMargin() {
    const pct = parseFloat(bulkMargin);
    if (!(pct >= 0 && pct < 100)) {
      setMessage("Geef een marge tussen 0 en 99 (%).");
      return;
    }
    if (!(await confirmDialog(`Marge van alle varianten van ${selected.size} product(en) op ${pct}% zetten en de prijzen herberekenen?`))) return;
    setBusy(true);
    const n = await setMarginForProducts(supabase, Array.from(selected), pct / 100);
    setMessage(`${n} variant(en) herberekend met ${pct}% marge.`);
    setBulkMargin("");
    setBusy(false);
    load();
  }

  async function runImportMeta() {
    if (!(await confirmDialog("Naam, beschrijving, categorieën, afbeeldingen, gewicht en verzendklasse van alle producten uit WooCommerce importeren en lokaal bijwerken? (De prijs blijft altijd vanuit de app komen.)"))) return;
    setBusy(true);
    setMessage(null);
    setImportProgress(null);

    try {
      // Haal de producten op die geïmporteerd gaan worden
      setImportProgress({ current: 0, total: 0, product: "Producten ophalen..." });
      let query = supabase.from("products").select("id, sku, name").order("name");
      if (activeTab !== "all") query = query.eq("process_type", activeTab);
      const { data: productsToImport } = await query;
      const total = productsToImport?.length ?? 0;

      if (total === 0) {
        setImportProgress(null);
        setMessage("Geen producten om te importeren.");
        setBusy(false);
        return;
      }

      // Toon initiële voortgang
      setImportProgress({ current: 0, total, product: "Verbinding maken met WooCommerce..." });

      // Simuleer voortgang tijdens het importeren (elke 500ms een product verder)
      let estimatedProgress = 0;
      const progressInterval = setInterval(() => {
        if (estimatedProgress < total - 1) {
          estimatedProgress++;
          const currentProduct = (productsToImport ?? [])[estimatedProgress] as any;
          setImportProgress({
            current: estimatedProgress,
            total,
            product: `${currentProduct?.name ?? "..."}`
          });
        }
      }, 500);

      try {
        const { data } = await supabase.auth.getSession();
        const res = await fetch("/api/woocommerce/import-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
        });

        const body = await res.json();
        clearInterval(progressInterval);

        if (!res.ok) {
          throw new Error(body.error ?? `Import mislukt (${res.status})`);
        }

        // Toon 100% voltooid
        setImportProgress({ current: total, total, product: "Import voltooid!" });
        setTimeout(() => setImportProgress(null), 1500);

        const parts = [`${body.updated} bijgewerkt`, `${body.unchanged} ongewijzigd`, `${body.notFound} niet gevonden in WooCommerce`];
        if (body.errors.length) parts.push(`fouten: ${body.errors.join("; ")}`);
        if (body.changes?.length) parts.push(`details: ${body.changes.join(" | ")}`);
        setMessage(`Import: ${parts.join(" -- ")}`);
        load();
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    } catch (e: any) {
      setMessage(e.message);
      setImportProgress(null);
    }
    setBusy(false);
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
          <Link className="btn" href="/products/new">+ Nieuw product</Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 14 }}>
          WooCommerce-export {activeTab === "all" ? "(alle technieken)" : `(${PROCESS_TYPE_LABELS[activeTab]})`}
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
          <button className="btn secondary" style={{ flexShrink: 0 }} disabled={busy} onClick={() => runExport({}, "Volledige export")}>Alles exporteren</button>
          <button className="btn secondary" style={{ flexShrink: 0 }} disabled={busy} onClick={() => runExport({ changed: "1" }, "Export van wijzigingen")}>
            Enkel nieuw/gewijzigd
          </button>
          <button className="btn secondary" style={{ flexShrink: 0 }} disabled={busy} onClick={() => runExport({ prices: "1" }, "Prijsexport")}>
            Enkel prijzen (bestaande producten bijwerken)
          </button>
          <button className="btn secondary" style={{ flexShrink: 0 }} disabled={busy} onClick={() => runSync(false)}>Bestaande producten synchroniseren</button>
          <button className="btn" style={{ flexShrink: 0 }} disabled={busy} onClick={() => runSync(true)}>Alle producten synchroniseren (+ nieuwe aanmaken)</button>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <p className="muted" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>
            WooCommerce → Lokale database
          </p>
          <button className="btn secondary" disabled={busy} onClick={runImportMeta}>
            📥 Productgegevens importeren uit WooCommerce
          </button>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            Haalt naam, beschrijving, categorieën, afbeeldingen, gewicht en verzendklasse op uit WooCommerce en werkt de lokale database bij -- handig als je die rechtstreeks in WooCommerce hebt aangepast. Gebruik dit vóór je synchroniseert, anders overschrijft de sync die wijzigingen weer. De prijs komt altijd vanuit de app; die wordt hier nooit teruggehaald.
          </p>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Elke export markeert de producten als geëxporteerd. "Enkel nieuw/gewijzigd" neemt dan enkel wat sindsdien nieuw of aangepast is; met "Alles exporteren" heb je altijd de volledige set. Voor "Enkel prijzen" kies je bij het importeren in WooCommerce "Bestaande producten bijwerken".
        </p>
        {exportProgress && (
          <div style={{ marginTop: 12, padding: 12, background: "rgba(0, 255, 255, 0.1)", border: "1px solid rgba(0, 255, 255, 0.3)", borderRadius: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 20,
                height: 20,
                border: "3px solid rgba(0, 255, 255, 0.3)",
                borderTop: "3px solid #0ff",
                borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
              <strong style={{ color: "#0ff" }}>{exportProgress}</strong>
            </div>
            <style jsx>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}
        {syncProgress && (
          <div style={{ marginTop: 12, padding: 12, background: "rgba(0, 255, 255, 0.1)", border: "1px solid rgba(0, 255, 255, 0.3)", borderRadius: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ color: "#0ff" }}>Synchroniseren...</strong>
              {syncProgress.total > 0 && (
                <span className="mono" style={{ color: "#0ff" }}>
                  {syncProgress.current} / {syncProgress.total}
                </span>
              )}
            </div>
            {syncProgress.total > 0 ? (
              <div style={{ width: "100%", height: 8, background: "rgba(0, 0, 0, 0.3)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                <div
                  style={{
                    width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #0ff, #f0f)",
                    transition: "width 0.3s ease",
                    boxShadow: "0 0 10px rgba(0, 255, 255, 0.5)"
                  }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{
                  width: 20,
                  height: 20,
                  border: "3px solid rgba(0, 255, 255, 0.3)",
                  borderTop: "3px solid #0ff",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }} />
              </div>
            )}
            <p className="mono" style={{ margin: 0, fontSize: 12, color: "#0ff" }}>
              {syncProgress.product}
            </p>
          </div>
        )}
        {importProgress && (
          <div style={{ marginTop: 12, padding: 12, background: "rgba(0, 255, 255, 0.1)", border: "1px solid rgba(0, 255, 255, 0.3)", borderRadius: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ color: "#0ff" }}>Importeren...</strong>
              {importProgress.total > 0 && (
                <span className="mono" style={{ color: "#0ff" }}>
                  {importProgress.current} / {importProgress.total}
                </span>
              )}
            </div>
            {importProgress.total > 0 ? (
              <div style={{ width: "100%", height: 8, background: "rgba(0, 0, 0, 0.3)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                <div
                  style={{
                    width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #f0f, #0ff)",
                    transition: "width 0.3s ease",
                    boxShadow: "0 0 10px rgba(255, 0, 255, 0.5)"
                  }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{
                  width: 20,
                  height: 20,
                  border: "3px solid rgba(255, 0, 255, 0.3)",
                  borderTop: "3px solid #f0f",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }} />
              </div>
            )}
            <p className="mono" style={{ margin: 0, fontSize: 12, color: "#f0f" }}>
              {importProgress.product}
            </p>
          </div>
        )}
        {message && <p className="mono" style={{ marginBottom: 0 }}>{message}</p>}
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

      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{selected.size} geselecteerd</strong>
          <button className="btn secondary" disabled={busy} onClick={() => bulkPublish(true)}>Publiceren</button>
          <button className="btn secondary" disabled={busy} onClick={() => bulkPublish(false)}>Depubliceren</button>
          <input
            type="number"
            style={{ width: 110 }}
            placeholder="Marge %"
            value={bulkMargin}
            onChange={(e) => setBulkMargin(e.target.value)}
          />
          <button className="btn secondary" disabled={busy || !bulkMargin} onClick={bulkSetMargin}>Marge toepassen</button>
          <button className="btn danger" disabled={busy} onClick={bulkDelete}>Verwijderen</button>
          <button className="btn secondary" disabled={busy} onClick={() => runSync(true, Array.from(selected))}>Synchroniseer geselecteerde</button>
          <button className="btn secondary" onClick={() => setSelected(new Set())}>Selectie wissen</button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                aria-label="Alles selecteren"
                checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())}
              />
            </th>
            <th>Naam</th><th>Techniek</th><th>SKU</th><th>Attributen</th><th>Varianten</th><th>Verkoopprijs</th><th>Gepubliceerd</th><th>Export</th><th></th></tr>
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
                <td>
                  <input type="checkbox" style={{ width: "auto" }} aria-label={`Selecteer ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                </td>
                <td><Link href={`/products/${p.id}`}>{p.name}</Link></td>
                <td><span className="pill">{PROCESS_TYPE_LABELS[p.process_type]}</span></td>
                <td className="mono">{p.sku}</td>
                <td>{p.attribute_names.length > 0 ? p.attribute_names.join(", ") : <span className="muted">Simpel product</span>}</td>
                <td className="mono">{p.product_variations.length}</td>
                <td className="mono">{priceLabel}</td>
                <td>{p.published ? "Ja" : "Nee"}</td>
                <td>{isChanged(p) ? <span className="pill">{p.last_exported_at ? "Gewijzigd" : "Nieuw"}</span> : <span className="muted">Up-to-date</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link className="btn secondary" href={`/products/${p.id}`} style={{ marginRight: 6 }}>Bewerken</Link>
                  <button className="btn secondary" disabled={busy} onClick={() => startDuplicate(p)} style={{ marginRight: 6 }}>Dupliceer</button>
                  <button className="btn danger" onClick={() => deleteProduct(p.id)}>Verwijder</button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={10} className="muted">
              {products.length === 0
                ? 'Nog geen producten -- klik op "+ Nieuw product" om te starten.'
                : "Geen producten gevonden voor deze filter/zoekopdracht."}
            </td></tr>
          )}
        </tbody>
      </table>

      <PromptModal
        open={duplicateTarget != null}
        title="Product dupliceren"
        message="Geef de SKU op voor het gedupliceerde product."
        initialValue={duplicateTarget?.suggested ?? ""}
        confirmLabel="Dupliceren"
        validate={async (sku) => ((await skuExists(supabase, "products", sku)) ? `SKU "${sku}" bestaat al -- kies een andere SKU.` : null)}
        onConfirm={confirmDuplicate}
        onCancel={() => setDuplicateTarget(null)}
      />
    </div>
  );
}
