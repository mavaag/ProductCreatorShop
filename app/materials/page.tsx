"use client";

import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import Link from "next/link";
import { Material, MaterialOrder, ProductVariation } from "@/lib/types";
import { offerRecalculation } from "@/lib/recalc";
import { createMaterialOrder, deleteMaterialOrder, markMaterialOrderReceived, NewMaterialOrder } from "@/lib/materialOrders";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { uploadProductImage } from "@/lib/uploadImage";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const UNITS = ["g", "kg", "ml", "vel", "stuk", "m2"];
const CATEGORIES = [
  { value: "filament", label: "Filament" },
  { value: "resin", label: "Resin" },
  { value: "ink", label: "Inkt" },
  { value: "paper", label: "Papier" },
  { value: "blank", label: "Blanco object" },
  { value: "laser_material", label: "Lasermateriaal" },
  { value: "overig", label: "Overig" },
];

type MaterialForm = { name: string; category: string; unit: string; price_per_unit: number; stock_quantity: string; min_stock: string; supplier_name: string; supplier_url: string; ink_coverage_ml_per_m2: string; image_url: string };
const BLANK_FORM: MaterialForm = { name: "", category: "filament", unit: "kg", price_per_unit: 0, stock_quantity: "", min_stock: "", supplier_name: "", supplier_url: "", ink_coverage_ml_per_m2: "", image_url: "" };

// Lege invoer betekent "voorraad niet bijgehouden" (null in de database).
function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function toPayload(f: MaterialForm) {
  return {
    name: f.name,
    category: f.category,
    unit: f.unit,
    price_per_unit: f.price_per_unit,
    stock_quantity: toNumberOrNull(f.stock_quantity),
    min_stock: toNumberOrNull(f.min_stock),
    supplier_name: f.supplier_name.trim() || null,
    supplier_url: f.supplier_url.trim() || null,
    ink_coverage_ml_per_m2: toNumberOrNull(f.ink_coverage_ml_per_m2),
    image_url: f.image_url.trim() || null,
  };
}

/**
 * Haalt de productfoto achter een leverancierslink op en bewaart ze in de opslag (zie /api/materials/image).
 * Met materialId wordt ze meteen bij het materiaal gezet. Gooit een fout met een leesbare uitleg.
 */
async function fetchMaterialImage(url: string, materialId?: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/materials/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify({ url, materialId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.image_url) throw new Error(body.error ?? `fout ${res.status}`);
  return body.image_url as string;
}

/** Foto van een materiaal: voorbeeld + ophalen van de leverancierslink, zelf opladen of een URL plakken. */
function MaterialImageField({ value, supplierUrl, onChange }: { value: string; supplierUrl: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState<"" | "fetch" | "upload">("");
  const [error, setError] = useState("");

  async function fromLink() {
    setBusy("fetch");
    setError("");
    try {
      onChange(await fetchMaterialImage(supplierUrl.trim()));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File | null) {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      onChange(await uploadProductImage(file));
    } catch (e: any) {
      setError("Opladen mislukt: " + (e?.message ?? String(e)));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mat-image-field">
      <div className="mat-image-preview">
        {value ? <img src={value} alt="" /> : <span className="muted">Geen foto</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <button type="button" className="btn secondary" disabled={!supplierUrl.trim() || !!busy} onClick={fromLink} title={supplierUrl.trim() ? "Productfoto ophalen van de link naar de leverancier" : "Vul eerst een link in"}>
            {busy === "fetch" ? "Ophalen..." : "Foto van link ophalen"}
          </button>
          <label className="btn secondary" style={{ margin: 0, cursor: busy ? "default" : "pointer" }}>
            {busy === "upload" ? "Opladen..." : "Zelf opladen"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              disabled={!!busy}
              onChange={(e) => {
                upload(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {value && (
            <button type="button" className="btn secondary" onClick={() => onChange("")} disabled={!!busy}>
              Wissen
            </button>
          )}
        </div>
        <input style={{ marginTop: 6 }} placeholder="of plak een afbeeldings-URL" value={value} onChange={(e) => onChange(e.target.value)} />
        {error && <p style={{ color: "var(--rust)", fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
      </div>
    </div>
  );
}

type Usage = { productId: string; productName: string; variations: number };

function isLowStock(m: Material) {
  return m.stock_quantity != null && m.min_stock != null && m.stock_quantity <= m.min_stock;
}

const CATEGORY_COLORS: Record<string, string> = {
  filament: "var(--cyan)",
  ink: "var(--magenta)",
  paper: "var(--ink)",
  blank: "var(--yellow)",
  laser_material: "#ff8a3d",
  overig: "var(--ink-soft)",
};
// Twee decimalen ("€8.40"), maar fijnere prijzen (bv. €0.018/ml) niet afronden.
function formatPrice(p: number) {
  return Number.isInteger(Math.round(p * 1e6) / 1e4) ? p.toFixed(2) : String(p);
}
function categoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? "var(--ink-soft)";
}

/** Klein lijn-icoon per materiaalcategorie (spoel, druppel, vel, kubus, laserstraal, doos). */
function CategoryIcon({ category, size = 20 }: { category: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (category) {
    case "filament":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" opacity="0.5" /></svg>;
    case "ink":
      return <svg {...common}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5" opacity="0.6" /></svg>;
    case "paper":
      return <svg {...common}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>;
    case "blank":
      return <svg {...common}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>;
    case "laser_material":
      return <svg {...common}><path d="M12 2v9" /><path d="M8 11h8l-4 4z" /><path d="M3 20h18M7 17l-2 3M17 17l2 3" /></svg>;
    default:
      return <svg {...common}><rect x="3" y="7" width="18" height="13" /><path d="M3 7l3-4h12l3 4M10 11h4" /></svg>;
  }
}

/**
 * Voorraadmeter: balk gevuld tot de huidige voorraad, met een streepje op het minimum. Schaal = 3x het
 * minimum (of de voorraad zelf als die hoger ligt), zodat "bijna op" visueel meteen opvalt.
 */
function StockGauge({ material: m }: { material: Material }) {
  if (m.stock_quantity == null) {
    return <div className="mat-gauge-empty muted">Voorraad niet bijgehouden</div>;
  }
  const stock = Math.max(0, m.stock_quantity);
  const min = m.min_stock;
  const max = Math.max(stock, min != null && min > 0 ? min * 3 : stock, 1);
  const pct = Math.min(100, (stock / max) * 100);
  const level = min == null ? "ok" : stock <= min ? "low" : stock <= min * 1.5 ? "mid" : "ok";
  return (
    <div className="mat-gauge">
      <div className="mat-gauge-labels">
        <span className="mono"><strong>{m.stock_quantity}</strong> {m.unit}</span>
        {min != null && <span className="muted mono" style={{ fontSize: 11.5 }}>min. {min}</span>}
      </div>
      <div className={`mat-gauge-track ${level}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={stock} aria-label="Voorraad">
        <div className="mat-gauge-fill" style={{ width: `${pct}%` }} />
        {min != null && min > 0 && <div className="mat-gauge-min" style={{ left: `${(min / max) * 100}%` }} />}
      </div>
    </div>
  );
}

export default function MaterialsPage() {
  const ready = useAuthGuard();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [usage, setUsage] = useState<Record<string, Usage[]>>({});
  const [openUsage, setOpenUsage] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, MaterialOrder[]>>({});
  const [openOrders, setOpenOrders] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialForm>(BLANK_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MaterialForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [used30, setUsed30] = useState<Record<string, number>>({});

  async function load() {
    const { data } = await supabase.from("materials").select("*").order("category").order("name");
    setMaterials(data ?? []);

    // Haal unieke leveranciers op voor de dropdown
    const uniqueSuppliers = Array.from(new Set(
      (data ?? [])
        .map((m: Material) => m.supplier_name)
        .filter((s): s is string => !!s && s.trim() !== "")
    )).sort();
    setSuppliers(uniqueSuppliers);

    // In welke producten zit elk materiaal? (afgeleid uit de materiaallijnen van alle varianten)
    const [{ data: variations }, { data: products }] = await Promise.all([
      supabase.from("product_variations").select("id, product_id, cost_inputs"),
      supabase.from("products").select("id, name"),
    ]);
    const names = new Map((products ?? []).map((p: any) => [p.id as string, p.name as string]));
    const perMaterial: Record<string, Map<string, Usage>> = {};
    for (const v of (variations ?? []) as Pick<ProductVariation, "id" | "product_id" | "cost_inputs">[]) {
      for (const line of v.cost_inputs?.materials ?? []) {
        const byProduct = (perMaterial[line.material_id] ??= new Map());
        const entry = byProduct.get(v.product_id) ?? { productId: v.product_id, productName: names.get(v.product_id) ?? "?", variations: 0 };
        entry.variations++;
        byProduct.set(v.product_id, entry);
      }
    }
    setUsage(Object.fromEntries(Object.entries(perMaterial).map(([id, m]) => [id, Array.from(m.values()).sort((a, b) => a.productName.localeCompare(b.productName))])));

    // Bestelhistoriek per materiaal, meest recente eerst.
    const { data: materialOrders } = await supabase.from("material_orders").select("*").order("ordered_at", { ascending: false }).order("created_at", { ascending: false });
    const perMaterialOrders: Record<string, MaterialOrder[]> = {};
    for (const o of (materialOrders ?? []) as MaterialOrder[]) {
      (perMaterialOrders[o.material_id] ??= []).push(o);
    }
    setOrders(perMaterialOrders);

    // Verbruik door bestellingen, laatste 30 dagen (migratie 038; ontbreekt de tabel nog, dan gewoon leeg).
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: consumption } = await supabase.from("material_consumption").select("material_id, quantity").gte("created_at", since);
    const perMaterialUse: Record<string, number> = {};
    for (const c of (consumption ?? []) as { material_id: string; quantity: number }[]) {
      perMaterialUse[c.material_id] = (perMaterialUse[c.material_id] ?? 0) + Number(c.quantity);
    }
    setUsed30(perMaterialUse);
  }


  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function addMaterial(e: React.FormEvent) {
    e.preventDefault();
    const { data: created } = await supabase.from("materials").insert(toPayload(form)).select("id").single();
    const link = form.supplier_url.trim();
    const needsImage = !!created && !form.image_url.trim() && !!link;
    setForm({ ...BLANK_FORM });
    load();
    // Nog geen foto maar wel een link: foto automatisch ophalen (lukt het niet, dan blijft het icoon staan).
    if (needsImage) fetchMaterialImage(link, created.id).then(load, () => {});
  }

  const [bulkImages, setBulkImages] = useState("");
  /** Haalt een foto op voor alle materialen met een leverancierslink maar nog zonder foto. */
  async function fetchMissingImages() {
    const todo = materials.filter((m) => !m.image_url && m.supplier_url);
    let ok = 0;
    const failed: string[] = [];
    for (let i = 0; i < todo.length; i++) {
      setBulkImages(`${i + 1}/${todo.length}...`);
      try {
        await fetchMaterialImage(todo[i].supplier_url as string, todo[i].id);
        ok++;
      } catch {
        failed.push(todo[i].name);
      }
    }
    setBulkImages("");
    load();
    await alertDialog(
      `${ok} van ${todo.length} foto's opgehaald.` +
        (failed.length ? `\n\nGeen foto gevonden voor:\n${failed.join("\n")}\n\nLaad die zelf op via Bewerken.` : "")
    );
  }

  function startEdit(m: Material) {
    setEditingId(m.id);
    setEditForm({
      name: m.name,
      category: m.category,
      unit: m.unit,
      price_per_unit: m.price_per_unit,
      stock_quantity: m.stock_quantity != null ? String(m.stock_quantity) : "",
      min_stock: m.min_stock != null ? String(m.min_stock) : "",
      supplier_name: m.supplier_name ?? "",
      supplier_url: m.supplier_url ?? "",
      ink_coverage_ml_per_m2: m.ink_coverage_ml_per_m2 != null ? String(m.ink_coverage_ml_per_m2) : "",
      image_url: m.image_url ?? "",
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    const priceChanged = materials.find((m) => m.id === id)?.price_per_unit !== editForm.price_per_unit;
    await supabase.from("materials").update(toPayload(editForm)).eq("id", id);
    if (priceChanged) await offerRecalculation(supabase, `Materiaalprijs: ${editForm.name}`, { materialId: id });
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function deleteMaterial(id: string) {
    if (!(await confirmDialog("Dit materiaal verwijderen? Producten die ernaar verwijzen tonen dan geen prijs meer tot je een ander materiaal kiest.", { confirmLabel: "Verwijderen", danger: true }))) return;
    await supabase.from("materials").delete().eq("id", id);
    load();
  }

  /** Legt een bestelling vast en biedt aan om de prijs per eenheid van het materiaal bij te werken
   * als die duidelijk afwijkt van wat er nu ingesteld staat. */
  async function submitOrder(material: Material, order: NewMaterialOrder, markReceived: boolean) {
    await createMaterialOrder(supabase, order, markReceived);
    const quantity = order.packages * order.units_per_package;
    if (quantity > 0) {
      const pricePerUnit = Math.round((order.total_price / quantity) * 100) / 100;
      if (Math.abs(pricePerUnit - material.price_per_unit) >= 0.01) {
        const update = await confirmDialog(
          `Prijs per eenheid van "${material.name}" bijwerken naar €${pricePerUnit.toFixed(2)} (was €${material.price_per_unit.toFixed(2)})?`
        );
        if (update) {
          await supabase.from("materials").update({ price_per_unit: pricePerUnit }).eq("id", material.id);
          await offerRecalculation(supabase, `Materiaalbestelling: ${material.name}`, { materialId: material.id });
        }
      }
    }
    setOpenOrders(null);
    load();
  }

  async function receiveOrder(order: MaterialOrder) {
    await markMaterialOrderReceived(supabase, order);
    load();
  }

  async function removeOrder(order: MaterialOrder) {
    const message = order.received_at
      ? "Deze bestelling verwijderen? De voorraad wordt NIET automatisch verminderd -- pas die zelf aan als dat nodig is."
      : "Deze bestelling verwijderen?";
    if (!(await confirmDialog(message, { confirmLabel: "Verwijderen", danger: true }))) return;
    await deleteMaterialOrder(supabase, order);
    load();
  }

  if (!ready) return null;

  const lowStock = materials.filter(isLowStock);
  const stockValue = materials.reduce((sum, m) => sum + (m.stock_quantity ?? 0) * m.price_per_unit, 0);
  const pendingOrders = Object.values(orders).flat().filter((o) => !o.received_at).length;
  const visibleMaterials = filter === "all" ? materials : filter === "low" ? lowStock : materials.filter((m) => m.category === filter);

  return (
    <div>
      <h1>Materialen</h1>
      <p className="sub">Filament, inkt, papier, blanco objecten, lasermateriaal, ... -- prijs per eenheid (filament geef je in per kg, de rest per ml/vel/stuk/m²).</p>

      <div className="mat-stats">
        <div className="card stat-tile">
          <div className="stat-label">Materialen</div>
          <div className="stat-value">{materials.length}</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Voorraadwaarde</div>
          <div className="stat-value">€{stockValue.toFixed(0)}</div>
        </div>
        <div className="card stat-tile" style={{ cursor: "pointer" }} onClick={() => setFilter("low")} title="Naar Bij te bestellen">
          <div className="stat-label">Bij te bestellen</div>
          <div className="stat-value" style={lowStock.length > 0 ? { color: "var(--rust)", textShadow: "0 0 10px rgba(255, 56, 96, 0.6)" } : { color: "var(--moss)", textShadow: "none" }}>{lowStock.length}</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Onderweg</div>
          <div className="stat-value">{pendingOrders}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Nieuw materiaal</h2>
        <form onSubmit={addMaterial}>
          <div className="row">
            <div>
              <label>Naam</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label>Categorie</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>Eenheid</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label>Prijs per eenheid (€)</label>
              <input type="number" step="0.01" value={form.price_per_unit} onChange={(e) => setForm({ ...form, price_per_unit: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          {form.unit === "ml" && (
            <div className="row">
              <div>
                <label>Inktverbruik bij volledige dekking (ml/m²)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.ink_coverage_ml_per_m2}
                  onChange={(e) => setForm({ ...form, ink_coverage_ml_per_m2: e.target.value })}
                  placeholder="optioneel, bv. 12"
                />
                <p className="muted" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
                  Optioneel -- laat toe om bij een personalisatiezone (UV-print/sublimatie) de hoeveelheid te schatten uit de printzone-afmetingen.
                </p>
              </div>
            </div>
          )}
          <div className="row">
            <div>
              <label>Voorraad (optioneel, in de eenheid hierboven)</label>
              <input value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} placeholder="leeg = niet bijhouden" />
            </div>
            <div>
              <label>Waarschuwing onder (optioneel)</label>
              <input value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} placeholder="bv. 2" />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Leverancier / Shop naam (optioneel)</label>
              <input
                list="suppliers-new"
                value={form.supplier_name}
                onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                placeholder="Kies bestaande of typ nieuwe..."
              />
              <datalist id="suppliers-new">
                {suppliers.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label>Link naar product (optioneel)</label>
              <input type="url" value={form.supplier_url} onChange={(e) => setForm({ ...form, supplier_url: e.target.value })} placeholder="https://..." />
            </div>
          </div>
          <label>Foto (optioneel -- leeg met een link = automatisch van de link)</label>
          <MaterialImageField value={form.image_url} supplierUrl={form.supplier_url} onChange={(url) => setForm({ ...form, image_url: url })} />
          <button className="btn" type="submit" style={{ marginTop: 16 }}>Materiaal toevoegen</button>
        </form>
      </div>

      <div className="tabs">
        <button type="button" className={`tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
          Alles <span className="tab-count">{materials.length}</span>
        </button>
        {CATEGORIES.filter((c) => materials.some((m) => m.category === c.value)).map((c) => (
          <button key={c.value} type="button" className={`tab mat-tab${filter === c.value ? " active" : ""}`} onClick={() => setFilter(c.value)}>
            <CategoryIcon category={c.value} size={15} />
            {c.label} <span className="tab-count">{materials.filter((m) => m.category === c.value).length}</span>
          </button>
        ))}
        <button type="button" className={`tab${filter === "low" ? " active" : ""}`} onClick={() => setFilter("low")} style={{ color: filter === "low" || lowStock.length === 0 ? undefined : "var(--rust)" }}>
          Bij te bestellen <span className="tab-count">{lowStock.length}</span>
        </button>
        {materials.some((m) => !m.image_url && m.supplier_url) && (
          <button
            type="button"
            className="btn secondary"
            style={{ marginLeft: "auto" }}
            disabled={!!bulkImages}
            onClick={fetchMissingImages}
            title="Foto ophalen voor alle materialen met een link naar de leverancier maar nog zonder foto"
          >
            {bulkImages ? `Foto's ophalen ${bulkImages}` : `Foto's ophalen (${materials.filter((m) => !m.image_url && m.supplier_url).length})`}
          </button>
        )}
      </div>

      {filter === "low" && (
        <div className="card reorder">
          {lowStock.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Niets bij te bestellen: alle bijgehouden materialen zitten boven hun minimum.</p>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Materialen op of onder hun minimum. Klik <b>Bestellen</b> om een bestelling te registreren; bij <i>Ontvangen</i> komt ze bij de voorraad.
              </p>
              {[...lowStock]
                .sort((a, b) => Number((orders[a.id] ?? []).some((o) => !o.received_at)) - Number((orders[b.id] ?? []).some((o) => !o.received_at)) || a.name.localeCompare(b.name))
                .map((m) => {
                  const onTheWay = (orders[m.id] ?? []).filter((o) => !o.received_at);
                  const open = openOrders === m.id;
                  return (
                    <div key={m.id} className={`reorder-item${onTheWay.length ? " ordered" : ""}`}>
                      <div className="reorder-row">
                        {m.image_url ? <img className="reorder-photo" src={m.image_url} alt="" loading="lazy" /> : <span className="reorder-photo"><CategoryIcon category={m.category} size={18} /></span>}
                        <span className="reorder-name">{m.name}</span>
                        <span className="reorder-stock mono">
                          <b>{m.stock_quantity}</b> / min. {m.min_stock} {m.unit}
                        </span>
                        {used30[m.id] ? <span className="muted reorder-used">30 d: {Math.round(used30[m.id] * 100) / 100} {m.unit}</span> : <span className="reorder-used" />}
                        <span className="reorder-status">
                          {onTheWay.length > 0
                            ? <span className="pill cyan">onderweg: {onTheWay.reduce((t, o) => t + o.quantity, 0)} {m.unit}</span>
                            : <span className="pill rust">te bestellen</span>}
                        </span>
                        <span className="reorder-actions">
                          {m.supplier_url && <a className="btn secondary" href={m.supplier_url} target="_blank" rel="noopener noreferrer" title={m.supplier_name ?? "Leverancier"}>Leverancier</a>}
                          <button type="button" className={`btn${open ? " secondary" : ""}`} onClick={() => setOpenOrders(open ? null : m.id)}>
                            {open ? "Sluiten" : onTheWay.length ? "Ontvangen / bestellen" : "Bestellen"}
                          </button>
                        </span>
                      </div>
                      {open && (
                        <div className="reorder-panel">
                          <MaterialOrdersPanel
                            material={m}
                            orders={orders[m.id] ?? []}
                            suppliers={suppliers}
                            defaultReceived={false}
                            onSubmit={(order, markReceived) => submitOrder(m, order, markReceived)}
                            onReceive={receiveOrder}
                            onDelete={removeOrder}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}

      {filter !== "low" && visibleMaterials.length === 0 && <p className="muted">Geen materialen in deze selectie.</p>}

      <div className="mat-grid" style={filter === "low" ? { display: "none" } : undefined}>
        {visibleMaterials.map((m) => {
          const color = categoryColor(m.category);
          if (editingId === m.id) {
            return (
              <div key={m.id} className="mat-card editing" style={{ "--mat-color": color } as React.CSSProperties}>
                <label style={{ marginTop: 0 }}>Naam</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                <div className="row">
                  <div>
                    <label>Categorie</label>
                    <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Eenheid</label>
                    <select value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label>Prijs / eenheid (€)</label>
                    <input className="mono" type="number" step="0.01" value={editForm.price_per_unit} onChange={(e) => setEditForm({ ...editForm, price_per_unit: parseFloat(e.target.value) || 0 })} />
                  </div>
                  {editForm.unit === "ml" && (
                    <div>
                      <label>ml/m² volle dekking</label>
                      <input className="mono" type="number" step="0.1" value={editForm.ink_coverage_ml_per_m2} onChange={(e) => setEditForm({ ...editForm, ink_coverage_ml_per_m2: e.target.value })} />
                    </div>
                  )}
                </div>
                <div className="row">
                  <div>
                    <label>Voorraad</label>
                    <input className="mono" placeholder="leeg = niet bijhouden" value={editForm.stock_quantity} onChange={(e) => setEditForm({ ...editForm, stock_quantity: e.target.value })} />
                  </div>
                  <div>
                    <label>Minimum</label>
                    <input className="mono" value={editForm.min_stock} onChange={(e) => setEditForm({ ...editForm, min_stock: e.target.value })} />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label>Leverancier</label>
                    <input list="suppliers-edit" placeholder="Shop naam" value={editForm.supplier_name} onChange={(e) => setEditForm({ ...editForm, supplier_name: e.target.value })} />
                    <datalist id="suppliers-edit">
                      {suppliers.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div>
                    <label>Link</label>
                    <input placeholder="https://..." value={editForm.supplier_url} onChange={(e) => setEditForm({ ...editForm, supplier_url: e.target.value })} />
                  </div>
                </div>
                <label>Foto</label>
                <MaterialImageField value={editForm.image_url} supplierUrl={editForm.supplier_url} onChange={(url) => setEditForm({ ...editForm, image_url: url })} />
                <div style={{ marginTop: 14 }}>
                  <button className="btn" onClick={() => saveEdit(m.id)} disabled={saving} style={{ marginRight: 6 }}>{saving ? "..." : "Opslaan"}</button>
                  <button className="btn secondary" onClick={() => setEditingId(null)}>Annuleer</button>
                </div>
              </div>
            );
          }
          const materialOrders = orders[m.id] ?? [];
          const pending = materialOrders.filter((o) => !o.received_at).length;
          const used = usage[m.id] ?? [];
          return (
            <Fragment key={m.id}>
              <div id={`mat-${m.id}`} className={`mat-card${isLowStock(m) ? " low" : ""}`} style={{ "--mat-color": color } as React.CSSProperties}>
                <div className="mat-head">
                  {m.image_url ? (
                    <a className="mat-photo" href={m.image_url} target="_blank" rel="noopener noreferrer" title="Foto openen">
                      <img src={m.image_url} alt="" loading="lazy" />
                    </a>
                  ) : (
                    <div className="mat-icon"><CategoryIcon category={m.category} size={26} /></div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mat-name">{m.name}</div>
                    <div className="mat-cat">{CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category}</div>
                  </div>
                  <div className="mat-price">
                    <span className="mono">€{formatPrice(m.price_per_unit)}</span>
                    <span className="mat-unit">/ {m.unit}</span>
                  </div>
                </div>

                <StockGauge material={m} />
                {m.unit === "ml" && m.ink_coverage_ml_per_m2 != null && (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{m.ink_coverage_ml_per_m2} ml/m² bij volle dekking</div>
                )}

                <div className="mat-chips">
                  <button type="button" className={`mat-chip${openOrders === m.id ? " active" : ""}`} onClick={() => setOpenOrders(openOrders === m.id ? null : m.id)} title="Bestellingen">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h11L21 7H6.2" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></svg>
                    {materialOrders.length === 0 ? "Bestellen" : materialOrders.length}
                    {pending > 0 && <span className="mat-chip-badge" title={`${pending} onderweg`}>{pending} onderweg</span>}
                  </button>
                  {used.length > 0 && (
                    <button type="button" className={`mat-chip${openUsage === m.id ? " active" : ""}`} onClick={() => setOpenUsage(openUsage === m.id ? null : m.id)} title="Gebruikt in producten">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
                      {used.length} product{used.length === 1 ? "" : "en"}
                    </button>
                  )}
                  {m.supplier_name && (
                    m.supplier_url ? (
                      <a className="mat-chip" href={m.supplier_url} target="_blank" rel="noopener noreferrer" title="Open bij leverancier">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" /></svg>
                        {m.supplier_name} ↗
                      </a>
                    ) : (
                      <span className="mat-chip static">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" /></svg>
                        {m.supplier_name}
                      </span>
                    )
                  )}
                </div>

                {openUsage === m.id && used.length > 0 && (
                  <ul className="mat-usage">
                    {used.map((u) => (
                      <li key={u.productId}><Link href={`/products/${u.productId}`}>{u.productName}</Link> <span className="muted">({u.variations} var.)</span></li>
                    ))}
                  </ul>
                )}

                <div className="mat-actions">
                  <button className="icon-btn" onClick={() => startEdit(m)} title="Bewerken" aria-label="Bewerken">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                  </button>
                  <button className="icon-btn mat-delete" onClick={() => deleteMaterial(m.id)} title="Verwijderen" aria-label="Verwijderen">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                  </button>
                </div>
              </div>
              {openOrders === m.id && (
                <div className="mat-orders-panel">
                  <MaterialOrdersPanel
                    material={m}
                    orders={materialOrders}
                    suppliers={suppliers}
                    onSubmit={(order, markReceived) => submitOrder(m, order, markReceived)}
                    onReceive={receiveOrder}
                    onDelete={removeOrder}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Bestelhistoriek + nieuw-bestelling-formulier voor één materiaal. "Aantal verpakkingen" x "inhoud
 * per verpakking" (in de eenheid van het materiaal, bv. 4 cartridges x 70 ml) geeft de totale
 * hoeveelheid -- zo blijft de invoer makkelijk of je nu een losse hoeveelheid of een doos/pak/zak koopt.
 */
function MaterialOrdersPanel({
  material,
  orders,
  suppliers,
  onSubmit,
  onReceive,
  onDelete,
  defaultReceived = true,
}: {
  defaultReceived?: boolean;
  material: Material;
  orders: MaterialOrder[];
  suppliers: string[];
  onSubmit: (order: NewMaterialOrder, markReceived: boolean) => Promise<void>;
  onReceive: (order: MaterialOrder) => Promise<void>;
  onDelete: (order: MaterialOrder) => Promise<void>;
}) {
  const [packages, setPackages] = useState("1");
  const [unitsPerPackage, setUnitsPerPackage] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [supplierName, setSupplierName] = useState(material.supplier_name ?? "");
  const [orderedAt, setOrderedAt] = useState(todayIso());
  const [received, setReceived] = useState(defaultReceived);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const packagesNum = parseFloat(packages.replace(",", ".")) || 0;
  const unitsPerPackageNum = parseFloat(unitsPerPackage.replace(",", ".")) || 0;
  const quantity = packagesNum * unitsPerPackageNum;
  const totalPriceNum = parseFloat(totalPrice.replace(",", ".")) || 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quantity <= 0) return;
    setSubmitting(true);
    try {
      await onSubmit(
        {
          material_id: material.id,
          packages: packagesNum,
          units_per_package: unitsPerPackageNum,
          total_price: totalPriceNum,
          supplier_name: supplierName.trim() || null,
          ordered_at: orderedAt,
          notes: notes.trim() || null,
        },
        received
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReceive(order: MaterialOrder) {
    setBusyOrderId(order.id);
    try {
      await onReceive(order);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleDelete(order: MaterialOrder) {
    setBusyOrderId(order.id);
    try {
      await onDelete(order);
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <div style={{ padding: "12px 4px" }}>
      <h3 style={{ marginTop: 0, fontSize: 13 }}>Bestellingen -- {material.name}</h3>

      {orders.length > 0 && (
        <table style={{ marginBottom: 16 }}>
          <thead>
            <tr><th>Besteld op</th><th>Hoeveelheid</th><th>Totaalprijs</th><th>€/eenheid</th><th>Leverancier</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.ordered_at}</td>
                <td className="mono">
                  {o.quantity} {material.unit}
                  {(o.packages !== 1 || o.units_per_package !== 1) && (
                    <div className="muted" style={{ fontSize: 11 }}>{o.packages} x {o.units_per_package}</div>
                  )}
                </td>
                <td className="mono">€{o.total_price.toFixed(2)}</td>
                <td className="mono">{o.quantity > 0 ? `€${(o.total_price / o.quantity).toFixed(2)}` : "--"}</td>
                <td>{o.supplier_name ?? <span className="muted">--</span>}</td>
                <td>
                  {o.received_at
                    ? <span>Ontvangen op {o.received_at}</span>
                    : <span style={{ color: "var(--yellow)" }}>Onderweg</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {!o.received_at && (
                    <button className="btn secondary" disabled={busyOrderId === o.id} onClick={() => handleReceive(o)} style={{ marginRight: 6 }}>
                      Markeer ontvangen
                    </button>
                  )}
                  <button className="btn danger" disabled={busyOrderId === o.id} onClick={() => handleDelete(o)}>Verwijder</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleSubmit}>
        <div className="row">
          <div>
            <label>Aantal verpakkingen</label>
            <input className="mono" type="number" step="1" min="0" value={packages} onChange={(e) => setPackages(e.target.value)} placeholder="bv. 1 doos" />
          </div>
          <div>
            <label>Inhoud per verpakking ({material.unit})</label>
            <input className="mono" type="number" step="any" min="0" value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} placeholder={`bv. 4 cartridges x 70 = 280 ${material.unit}`} />
          </div>
          <div>
            <label>Totale hoeveelheid</label>
            <input className="mono" value={quantity > 0 ? `${quantity} ${material.unit}` : "--"} disabled />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Totale prijs (€)</label>
            <input className="mono" type="number" step="0.01" min="0" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} />
          </div>
          <div>
            <label>Leverancier (optioneel)</label>
            <input list="suppliers-order" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            <datalist id="suppliers-order">
              {suppliers.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label>Besteldatum</label>
            <input type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Notities (optioneel)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="bv. besteldnummer" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none", fontSize: 14, letterSpacing: "normal", fontWeight: 500, margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={received} onChange={(e) => setReceived(e.target.checked)} />
              Al ontvangen (voorraad meteen bijwerken)
            </label>
          </div>
        </div>
        <button className="btn" type="submit" disabled={submitting || quantity <= 0} style={{ marginTop: 12 }}>
          {submitting ? "..." : "Bestelling toevoegen"}
        </button>
      </form>
    </div>
  );
}
