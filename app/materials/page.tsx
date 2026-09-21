"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import Link from "next/link";
import { Material, ProductVariation } from "@/lib/types";
import { offerRecalculation } from "@/lib/recalc";

const UNITS = ["g", "kg", "ml", "vel", "stuk", "m2"];
const CATEGORIES = [
  { value: "filament", label: "Filament" },
  { value: "ink", label: "Inkt" },
  { value: "paper", label: "Papier" },
  { value: "blank", label: "Blanco object" },
  { value: "laser_material", label: "Lasermateriaal" },
  { value: "overig", label: "Overig" },
];

type MaterialForm = { name: string; category: string; unit: string; price_per_unit: number; stock_quantity: string; min_stock: string; supplier_name: string; supplier_url: string };
const BLANK_FORM: MaterialForm = { name: "", category: "filament", unit: "kg", price_per_unit: 0, stock_quantity: "", min_stock: "", supplier_name: "", supplier_url: "" };

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
    supplier_url: f.supplier_url.trim() || null
  };
}

type Usage = { productId: string; productName: string; variations: number };

function isLowStock(m: Material) {
  return m.stock_quantity != null && m.min_stock != null && m.stock_quantity <= m.min_stock;
}

export default function MaterialsPage() {
  const ready = useAuthGuard();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [usage, setUsage] = useState<Record<string, Usage[]>>({});
  const [openUsage, setOpenUsage] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialForm>(BLANK_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MaterialForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  const [suppliers, setSuppliers] = useState<string[]>([]);

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
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function addMaterial(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("materials").insert(toPayload(form));
    setForm({ ...BLANK_FORM });
    load();
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
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    const priceChanged = materials.find((m) => m.id === id)?.price_per_unit !== editForm.price_per_unit;
    await supabase.from("materials").update(toPayload(editForm)).eq("id", id);
    if (priceChanged) await offerRecalculation(supabase, `Materiaalprijs: ${editForm.name}`);
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function deleteMaterial(id: string) {
    if (!confirm("Dit materiaal verwijderen? Producten die ernaar verwijzen tonen dan geen prijs meer tot je een ander materiaal kiest.")) return;
    await supabase.from("materials").delete().eq("id", id);
    load();
  }

  if (!ready) return null;

  return (
    <div>
      <h1>Materialen</h1>
      <p className="sub">Filament, inkt, papier, blanco objecten, lasermateriaal, ... -- prijs per eenheid (filament geef je in per kg, de rest per ml/vel/stuk/m²).</p>

      {materials.some(isLowStock) && (
        <div className="warning" style={{ marginBottom: 16 }}>
          <strong>Voorraad bijna op:</strong>{" "}
          {materials.filter(isLowStock).map((m) => `${m.name} (${m.stock_quantity} ${m.unit}, minimum ${m.min_stock})`).join(" -- ")}
        </div>
      )}

      <table>
        <thead>
          <tr><th>Naam</th><th>Categorie</th><th>Eenheid</th><th>Prijs per eenheid</th><th>Voorraad / minimum</th><th>Leverancier</th><th>Gebruikt in</th><th></th></tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            if (editingId === m.id) {
              return (
                <tr key={m.id}>
                  <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                  <td>
                    <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><input className="mono" type="number" step="0.01" value={editForm.price_per_unit} onChange={(e) => setEditForm({ ...editForm, price_per_unit: parseFloat(e.target.value) || 0 })} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input className="mono" placeholder="voorraad" value={editForm.stock_quantity} onChange={(e) => setEditForm({ ...editForm, stock_quantity: e.target.value })} />
                      <input className="mono" placeholder="minimum" value={editForm.min_stock} onChange={(e) => setEditForm({ ...editForm, min_stock: e.target.value })} />
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        list="suppliers-edit"
                        placeholder="Shop naam"
                        value={editForm.supplier_name}
                        onChange={(e) => setEditForm({ ...editForm, supplier_name: e.target.value })}
                      />
                      <datalist id="suppliers-edit">
                        {suppliers.map((s) => <option key={s} value={s} />)}
                      </datalist>
                      <input placeholder="Link (optioneel)" value={editForm.supplier_url} onChange={(e) => setEditForm({ ...editForm, supplier_url: e.target.value })} />
                    </div>
                  </td>
                  <td></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" onClick={() => saveEdit(m.id)} disabled={saving} style={{ marginRight: 6 }}>{saving ? "..." : "Opslaan"}</button>
                    <button className="btn secondary" onClick={() => setEditingId(null)}>Annuleer</button>
                  </td>
                </tr>
              );
            }
            return (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category}</td>
                <td className="mono">{m.unit}</td>
                <td className="mono">€{m.price_per_unit}</td>
                <td className="mono">
                  {m.stock_quantity == null ? <span className="muted">niet bijgehouden</span> : (
                    <span style={isLowStock(m) ? { color: "var(--rust)", fontWeight: 600 } : undefined}>
                      {m.stock_quantity} {m.unit}{m.min_stock != null ? ` / min. ${m.min_stock}` : ""}
                    </span>
                  )}
                </td>
                <td>
                  {!m.supplier_name ? <span className="muted">--</span> : (
                    <>
                      {m.supplier_url ? (
                        <a href={m.supplier_url} target="_blank" rel="noopener noreferrer" style={{ color: "#0ff" }}>
                          {m.supplier_name}
                        </a>
                      ) : (
                        <span>{m.supplier_name}</span>
                      )}
                    </>
                  )}
                </td>
                <td>
                  {(usage[m.id]?.length ?? 0) === 0 ? <span className="muted">--</span> : (
                    <>
                      <a href="#" onClick={(e) => { e.preventDefault(); setOpenUsage(openUsage === m.id ? null : m.id); }}>
                        {usage[m.id].length} product(en)
                      </a>
                      {openUsage === m.id && (
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {usage[m.id].map((u) => (
                            <li key={u.productId}><Link href={`/products/${u.productId}`}>{u.productName}</Link> <span className="muted">({u.variations} var.)</span></li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn secondary" onClick={() => startEdit(m)} style={{ marginRight: 6 }}>Bewerken</button>
                  <button className="btn danger" onClick={() => deleteMaterial(m.id)}>Verwijder</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 20 }}>
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
          <button className="btn" type="submit" style={{ marginTop: 16 }}>Materiaal toevoegen</button>
        </form>
      </div>
    </div>
  );
}
