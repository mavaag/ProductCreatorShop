"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { PROCESS_TYPE_LABELS } from "@/lib/types";
import { slugifyForSku, nextAvailableSku } from "@/lib/sku";

export default function NewProductPage() {
  const ready = useAuthGuard();
  const router = useRouter();
  const [form, setForm] = useState({
    sku: "",
    name: "",
    process_type: "3d_print",
    published: true,
  });
  const [attributeNames, setAttributeNames] = useState<string[]>(["Grootte"]);
  const [error, setError] = useState<string | null>(null);
  const [skuAuto, setSkuAuto] = useState(true); // false zodra de gebruiker zelf in het SKU-veld typt
  const [generatingSku, setGeneratingSku] = useState(false);

  // Genereert automatisch een SKU op basis van de productnaam, zolang de gebruiker
  // het veld niet zelf heeft aangepast. Controleert meteen of de SKU al bestaat.
  useEffect(() => {
    if (!skuAuto) return;
    const base = slugifyForSku(form.name);
    if (!base) {
      setForm((f) => ({ ...f, sku: "" }));
      return;
    }
    let cancelled = false;
    setGeneratingSku(true);
    nextAvailableSku(supabase, "products", base).then((sku) => {
      if (!cancelled) {
        setForm((f) => ({ ...f, sku }));
        setGeneratingSku(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name, skuAuto]);

  function updateAttrName(idx: number, value: string) {
    const next = [...attributeNames];
    next[idx] = value;
    setAttributeNames(next);
  }
  function addAttrName() {
    setAttributeNames([...attributeNames, ""]);
  }
  function removeAttrName(idx: number) {
    setAttributeNames(attributeNames.filter((_, i) => i !== idx));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanNames = attributeNames.map((n) => n.trim()).filter(Boolean);
    if (cleanNames.length === 0) {
      setError("Geef minstens 1 attribuut op (bv. Grootte).");
      return;
    }
    const { data, error } = await supabase
      .from("products")
      .insert({ ...form, attribute_names: cleanNames })
      .select()
      .single();
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
      <p className="sub">Maak eerst het hoofdproduct aan -- op de volgende pagina voeg je de varianten toe met hun eigen prijsberekening. Je kan op meerdere attributen tegelijk laten varieren (bv. Grootte + Kleur).</p>

      <div className="card">
        <form onSubmit={create}>
          <label>Productnaam</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <label>Parent SKU</label>
          <input
            className="mono"
            required
            value={form.sku}
            onChange={(e) => {
              setSkuAuto(false);
              setForm({ ...form, sku: e.target.value });
            }}
            placeholder="bv. VAAS-001"
          />
          <p className="muted" style={{ marginTop: 4 }}>
            {generatingSku
              ? "SKU wordt gegenereerd..."
              : skuAuto
                ? "Automatisch gegenereerd op basis van de naam -- pas gerust zelf aan."
                : (
                  <>
                    Zelf aangepast.{" "}
                    <a href="#" onClick={(e) => { e.preventDefault(); setSkuAuto(true); }} style={{ color: "var(--amber-ink)" }}>
                      Opnieuw automatisch genereren
                    </a>
                  </>
                )}
          </p>

          <label>Techniek</label>
          <select value={form.process_type} onChange={(e) => setForm({ ...form, process_type: e.target.value })}>
            {Object.entries(PROCESS_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <label>Attributen waarop varianten verschillen</label>
          {attributeNames.map((name, idx) => (
            <div className="line-item" key={idx}>
              <div className="grow">
                <input
                  value={name}
                  onChange={(e) => updateAttrName(idx, e.target.value)}
                  placeholder="bv. Grootte, Kleur, Materiaal"
                />
              </div>
              {attributeNames.length > 1 && (
                <button className="btn danger" type="button" onClick={() => removeAttrName(idx)}>x</button>
              )}
            </div>
          ))}
          <button className="btn secondary" type="button" onClick={addAttrName}>+ Attribuut toevoegen</button>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
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
