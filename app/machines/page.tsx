"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { Machine } from "@/lib/types";

const CATEGORIES = [
  { value: "3d_printer", label: "3D-printer" },
  { value: "uv_printer", label: "UV-printer" },
  { value: "laser", label: "Laser" },
  { value: "sublimation_printer", label: "Sublimatieprinter" },
  { value: "heat_press", label: "Heat press" },
  { value: "overig", label: "Overig" },
];

export default function MachinesPage() {
  const ready = useAuthGuard();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [form, setForm] = useState({
    name: "",
    category: "3d_printer",
    purchase_price: 0,
    expected_lifetime_hours: 4000,
    avg_power_w: 150,
    electricity_price: 0.30,
  });

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
    setForm({ ...form, name: "" });
    load();
  }

  async function deleteMachine(id: string) {
    if (!confirm("Deze machine verwijderen?")) return;
    await supabase.from("machines").delete().eq("id", id);
    load();
  }

  if (!ready) return null;

  return (
    <div>
      <h1>Machines</h1>
      <p className="sub">Aankoopprijs, levensduur en vermogen -- afschrijving en stroomkosten per uur worden automatisch berekend bij de prijsberekening van je producten.</p>

      <table>
        <thead>
          <tr><th>Naam</th><th>Categorie</th><th>Aankoopprijs</th><th>Levensduur (u)</th><th>Vermogen (W)</th><th>Elektriciteit (€/kWh)</th><th></th></tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category}</td>
              <td>€{m.purchase_price}</td>
              <td>{m.expected_lifetime_hours}</td>
              <td>{m.avg_power_w}</td>
              <td>€{m.electricity_price}</td>
              <td><button className="btn danger" onClick={() => deleteMachine(m.id)}>Verwijder</button></td>
            </tr>
          ))}
        </tbody>
      </table>

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
