"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { Material } from "@/lib/types";

const UNITS = ["g", "kg", "ml", "vel", "stuk", "m2"];
const CATEGORIES = [
  { value: "filament", label: "Filament" },
  { value: "ink", label: "Inkt" },
  { value: "paper", label: "Papier" },
  { value: "blank", label: "Blanco object" },
  { value: "laser_material", label: "Lasermateriaal" },
  { value: "overig", label: "Overig" },
];

const BLANK_FORM = { name: "", category: "filament", unit: "kg", price_per_unit: 0 };

export default function MaterialsPage() {
  const ready = useAuthGuard();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from("materials").select("*").order("category").order("name");
    setMaterials(data ?? []);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function addMaterial(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("materials").insert(form);
    setForm({ ...BLANK_FORM });
    load();
  }

  function startEdit(m: Material) {
    setEditingId(m.id);
    setEditForm({ name: m.name, category: m.category, unit: m.unit, price_per_unit: m.price_per_unit });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    await supabase.from("materials").update(editForm).eq("id", id);
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

      <table>
        <thead>
          <tr><th>Naam</th><th>Categorie</th><th>Eenheid</th><th>Prijs per eenheid</th><th></th></tr>
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
          <button className="btn" type="submit" style={{ marginTop: 16 }}>Materiaal toevoegen</button>
        </form>
      </div>
    </div>
  );
}
