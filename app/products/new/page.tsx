"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { PROCESS_TYPE_LABELS } from "@/lib/types";

export default function NewProductPage() {
  const ready = useAuthGuard();
  const router = useRouter();
  const [form, setForm] = useState({
    sku: "",
    name: "",
    process_type: "3d_print",
    attribute_name: "Grootte",
    published: true,
  });
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data, error } = await supabase.from("products").insert(form).select().single();
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/products/${data.id}`);
  }

  if (!ready) return null;

  return (
    <div>
      <h1>Nieuw product</h1>
      <p className="sub">Maak eerst het hoofdproduct aan -- op de volgende pagina voeg je de varianten (bv. per grootte/kleur/materiaal) toe met hun eigen prijsberekening.</p>

      <div className="card">
        <form onSubmit={create}>
          <label>Productnaam</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <label>Parent SKU</label>
          <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="bv. VAAS-001" />

          <label>Techniek</label>
          <select value={form.process_type} onChange={(e) => setForm({ ...form, process_type: e.target.value })}>
            {Object.entries(PROCESS_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <label>Naam van het kenmerk waarop varianten verschillen</label>
          <input value={form.attribute_name} onChange={(e) => setForm({ ...form, attribute_name: e.target.value })} placeholder="bv. Grootte, Kleur, Materiaal" />

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
            Gepubliceerd (zichtbaar in de shop)
          </label>

          <button className="btn" type="submit" style={{ marginTop: 16 }}>Product aanmaken &amp; varianten toevoegen</button>
          {error && <p className="warning">{error}</p>}
        </form>
      </div>
    </div>
  );
}
