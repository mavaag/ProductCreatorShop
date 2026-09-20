"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { machineHourlyCosts } from "@/lib/pricing";
import { Machine } from "@/lib/types";
import { offerRecalculation } from "@/lib/recalc";

const CATEGORIES = [
  { value: "3d_printer", label: "3D-printer" },
  { value: "uv_printer", label: "UV-printer" },
  { value: "laser", label: "Laser" },
  { value: "sublimation_printer", label: "Sublimatieprinter" },
  { value: "heat_press", label: "Heat press" },
  { value: "overig", label: "Overig" },
];

const BLANK_FORM = {
  name: "",
  category: "3d_printer",
  purchase_price: 0,
  expected_lifetime_hours: 4000,
  avg_power_w: 150,
  electricity_price: 0.30,
};

export default function MachinesPage() {
  const ready = useAuthGuard();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from("machines").select("*").order("name");
    setMachines(data ?? []);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("machines").insert(form);
    setForm({ ...BLANK_FORM });
    load();
  }

  function startEdit(m: Machine) {
    setEditingId(m.id);
    setEditForm({
      name: m.name,
      category: m.category,
      purchase_price: m.purchase_price,
      expected_lifetime_hours: m.expected_lifetime_hours,
      avg_power_w: m.avg_power_w,
      electricity_price: m.electricity_price,
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    await supabase.from("machines").update(editForm).eq("id", id);
    await offerRecalculation(supabase, "Machinewijziging");
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function deleteMachine(id: string) {
    if (!confirm("Deze machine verwijderen? Producten die ernaar verwijzen tonen dan geen prijs meer tot je een andere machine kiest.")) return;
    await supabase.from("machines").delete().eq("id", id);
    load();
  }

  if (!ready) return null;

  return (
    <div>
      <h1>Machines</h1>
      <p className="sub">Aankoopprijs, levensduur en vermogen -- afschrijving en stroomkosten per uur worden automatisch berekend en meegeteld bij de prijsberekening van je producten.</p>

      <table>
        <thead>
          <tr>
            <th>Naam</th><th>Categorie</th><th>Aankoopprijs</th><th>Levensduur (u)</th><th>Vermogen (W)</th><th>Elektriciteit (€/kWh)</th>
            <th>Afschrijving/u</th><th>Stroom/u</th><th></th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            if (editingId === m.id) {
              return (
                <tr key={m.id}>
                  <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                  <td>
                    <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </td>
                  <td><input className="mono" type="number" step="0.01" value={editForm.purchase_price} onChange={(e) => setEditForm({ ...editForm, purchase_price: parseFloat(e.target.value) || 0 })} /></td>
                  <td><input className="mono" type="number" value={editForm.expected_lifetime_hours} onChange={(e) => setEditForm({ ...editForm, expected_lifetime_hours: parseFloat(e.target.value) || 0 })} /></td>
                  <td><input className="mono" type="number" value={editForm.avg_power_w} onChange={(e) => setEditForm({ ...editForm, avg_power_w: parseFloat(e.target.value) || 0 })} /></td>
                  <td><input className="mono" type="number" step="0.01" value={editForm.electricity_price} onChange={(e) => setEditForm({ ...editForm, electricity_price: parseFloat(e.target.value) || 0 })} /></td>
                  <td colSpan={2} className="muted">wordt herberekend na opslaan</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" onClick={() => saveEdit(m.id)} disabled={saving} style={{ marginRight: 6 }}>{saving ? "..." : "Opslaan"}</button>
                    <button className="btn secondary" onClick={() => setEditingId(null)}>Annuleer</button>
                  </td>
                </tr>
              );
            }
            const { depreciationPerHour, powerCostPerHour } = machineHourlyCosts(m);
            return (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category}</td>
                <td className="mono">€{m.purchase_price}</td>
                <td className="mono">{m.expected_lifetime_hours}</td>
                <td className="mono">{m.avg_power_w}</td>
                <td className="mono">€{m.electricity_price}</td>
                <td className="mono">€{depreciationPerHour.toFixed(3)}</td>
                <td className="mono">€{powerCostPerHour.toFixed(3)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn secondary" onClick={() => startEdit(m)} style={{ marginRight: 6 }}>Bewerken</button>
                  <button className="btn danger" onClick={() => deleteMachine(m.id)}>Verwijder</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        "Afschrijving/u" en "Stroom/u" zijn precies de twee kostenposten die per machine-uur meegerekend worden in de kostprijs van elk product dat deze machine gebruikt.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>Nieuwe machine</h2>
        <form onSubmit={addMachine}>
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
              <label>Aankoopprijs (€)</label>
              <input type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label>Verwachte levensduur (u)</label>
              <input type="number" value={form.expected_lifetime_hours} onChange={(e) => setForm({ ...form, expected_lifetime_hours: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Gemiddeld vermogen (W)</label>
              <input type="number" value={form.avg_power_w} onChange={(e) => setForm({ ...form, avg_power_w: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label>Elektriciteitsprijs (€/kWh)</label>
              <input type="number" step="0.01" value={form.electricity_price} onChange={(e) => setForm({ ...form, electricity_price: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <button className="btn" type="submit" style={{ marginTop: 16 }}>Machine toevoegen</button>
        </form>
      </div>
    </div>
  );
}
