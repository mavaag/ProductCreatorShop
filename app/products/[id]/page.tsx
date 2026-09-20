"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { calculatePrice, machineHourlyCosts } from "@/lib/pricing";
import { toHours } from "@/lib/types";
import { slugifyForSku, nextAvailableSku } from "@/lib/sku";
import {
  Product,
  ProductVariation,
  Machine,
  Material,
  CostInputs,
  EMPTY_COST_INPUTS,
  PROCESS_TYPE_LABELS,
  TimeUnit,
  TIME_UNIT_LABELS,
} from "@/lib/types";

export default function ProductEditPage() {
  const ready = useAuthGuard();
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [variations, setVariations] = useState<ProductVariation[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [attrDraft, setAttrDraft] = useState<string[]>([]);
  const [savingAttrs, setSavingAttrs] = useState(false);

  const load = useCallback(async () => {
    const [{ data: p }, { data: v }, { data: m }, { data: mat }] = await Promise.all([
      supabase.from("products").select("*").eq("id", productId).single(),
      supabase.from("product_variations").select("*").eq("product_id", productId).order("sku"),
      supabase.from("machines").select("*"),
      supabase.from("materials").select("*"),
    ]);
    setProduct(p);
    setAttrDraft(p?.attribute_names ?? []);
    setVariations(v ?? []);
    setMachines(m ?? []);
    setMaterials(mat ?? []);
  }, [productId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function addVariation() {
    // Tijdelijke, gegarandeerd unieke SKU -- wordt automatisch vervangen zodra de
    // gebruiker attributen invult (zie VariationEditor). De "-NIEUW-" markering
    // laat de editor weten dat dit nog een auto-gegenereerde SKU is.
    const placeholderSku = `${product?.sku}-NIEUW-${Date.now().toString(36).toUpperCase()}`;
    // Voor UV-printen en sublimatie combineer je vaak twee stappen (printer + heat
    // press): daarom starten we daar meteen met 2 machinetijd-regels i.p.v. 1.
    const machineLines = product?.process_type === "sublimation" || product?.process_type === "uv_print" ? 2 : 1;
    const cost_inputs: CostInputs = {
      ...EMPTY_COST_INPUTS,
      machine_time: Array.from({ length: machineLines }, () => ({ machine_id: "", hours: 0 })),
    };
    const { error } = await supabase.from("product_variations").insert({
      product_id: productId,
      sku: placeholderSku,
      attribute_values: {},
      cost_inputs,
    });
    if (error) alert(error.message);
    load();
  }

  async function deleteVariation(id: string) {
    if (!confirm("Deze variant verwijderen?")) return;
    await supabase.from("product_variations").delete().eq("id", id);
    load();
  }

  async function deleteProduct() {
    if (!confirm("Dit hele product (met alle varianten) verwijderen?")) return;
    await supabase.from("products").delete().eq("id", productId);
    router.push("/products");
  }

  function updateAttrDraft(idx: number, value: string) {
    const next = [...attrDraft];
    next[idx] = value;
    setAttrDraft(next);
  }
  function addAttrDraft() {
    setAttrDraft([...attrDraft, ""]);
  }
  function removeAttrDraft(idx: number) {
    setAttrDraft(attrDraft.filter((_, i) => i !== idx));
  }

  async function saveAttrs() {
    const cleanNames = attrDraft.map((n) => n.trim()).filter(Boolean);
    if (cleanNames.length === 0) {
      alert("Geef minstens 1 attribuut op.");
      return;
    }
    setSavingAttrs(true);
    await supabase.from("products").update({ attribute_names: cleanNames, updated_at: new Date().toISOString() }).eq("id", productId);
    setSavingAttrs(false);
    load();
  }

  if (!ready || !product) return null;

  const machinesById = new Map(machines.map((m) => [m.id, m]));
  const materialsById = new Map(materials.map((m) => [m.id, m]));
  const attrsChanged = JSON.stringify(attrDraft.map((n) => n.trim()).filter(Boolean)) !== JSON.stringify(product.attribute_names);

  return (
    <div>
      <h1>{product.name}</h1>
      <p className="sub">
        <span className="pill">{PROCESS_TYPE_LABELS[product.process_type]}</span>{" "}
        SKU: {product.sku}
      </p>

      <div style={{ marginBottom: 16 }}>
        <button className="btn secondary" onClick={() => router.push("/products")}>&larr; Terug naar productenlijst</button>
        <button className="btn danger" style={{ marginLeft: 8 }} onClick={deleteProduct}>Product verwijderen</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 14 }}>Attributen (waarop varianten verschillen)</h2>
        <p className="muted">Bv. Grootte + Kleur samen -- de volgorde bepaalt Attribute 1/2/3 in de WooCommerce-export.</p>
        {attrDraft.map((name, idx) => (
          <div className="line-item" key={idx}>
            <div className="grow">
              <input value={name} onChange={(e) => updateAttrDraft(idx, e.target.value)} placeholder="bv. Grootte" />
            </div>
            {attrDraft.length > 1 && (
              <button className="btn danger" type="button" onClick={() => removeAttrDraft(idx)}>x</button>
            )}
          </div>
        ))}
        <button className="btn secondary" type="button" onClick={addAttrDraft}>+ Attribuut toevoegen</button>
        {attrsChanged && (
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={saveAttrs} disabled={savingAttrs}>{savingAttrs ? "Opslaan..." : "Attributen opslaan"}</button>
            <span className="muted" style={{ marginLeft: 8 }}>
              Bestaande varianten behouden hun huidige waarden voor attributen die je verwijdert of hernoemt; vul die dan opnieuw in per variant.
            </span>
          </div>
        )}
      </div>

      <h2>Varianten &amp; prijsberekening</h2>
      <p className="muted">
        Elke variant heeft zijn eigen prijsberekening (materialen, machinetijd, arbeid, marge). Deze gegevens blijven
        hier bewaard en aanpasbaar -- bij de WooCommerce-export wordt enkel de berekende verkoopprijs meegenomen, niet
        deze rekendetails.
      </p>

      {variations.map((v) => (
        <VariationEditor
          key={v.id}
          variation={v}
          productSku={product.sku}
          attributeNames={product.attribute_names}
          machines={machines}
          materials={materials}
          machinesById={machinesById}
          materialsById={materialsById}
          onSaved={load}
          onDelete={() => deleteVariation(v.id)}
        />
      ))}

      <button className="btn" onClick={addVariation}>+ Variant toevoegen</button>
    </div>
  );
}

function VariationEditor({
  variation,
  productSku,
  attributeNames,
  machines,
  materials,
  machinesById,
  materialsById,
  onSaved,
  onDelete,
}: {
  variation: ProductVariation;
  productSku: string;
  attributeNames: string[];
  machines: Machine[];
  materials: Material[];
  machinesById: Map<string, Machine>;
  materialsById: Map<string, Material>;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [sku, setSku] = useState(variation.sku);
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>(variation.attribute_values ?? {});
  const [inputs, setInputs] = useState<CostInputs>({ ...EMPTY_COST_INPUTS, ...(variation.cost_inputs ?? {}) });
  const [saving, setSaving] = useState(false);
  // Enkel varianten die net met "+ Variant toevoegen" zijn aangemaakt (herkenbaar aan
  // de "-NIEUW-" markering) krijgen automatische SKU-generatie -- bestaande varianten
  // met een SKU die je zelf (of via import) al hebt gezet, blijven onaangeroerd.
  const [skuAuto, setSkuAuto] = useState(variation.sku.includes("-NIEUW-"));
  const [generatingSku, setGeneratingSku] = useState(false);

  useEffect(() => {
    if (!skuAuto) return;
    const values = attributeNames.map((n) => attributeValues[n]).filter((v) => v && v.trim());
    if (values.length === 0) return; // nog niets ingevuld om een SKU uit af te leiden
    const base = `${productSku}-` + values.map(slugifyForSku).join("-");
    let cancelled = false;
    setGeneratingSku(true);
    nextAvailableSku(supabase, "product_variations", base, variation.id).then((generated) => {
      if (!cancelled) {
        setSku(generated);
        setGeneratingSku(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributeValues, skuAuto]);

  const { costPrice, salePrice, salePriceInclVat, suggestedPrice, warnings } = calculatePrice(inputs, machinesById, materialsById);

  function updateMaterialLine(idx: number, patch: Partial<{ material_id: string; quantity: number }>) {
    const next = [...inputs.materials];
    next[idx] = { ...next[idx], ...patch };
    setInputs({ ...inputs, materials: next });
  }
  function addMaterialLine() {
    setInputs({ ...inputs, materials: [...inputs.materials, { material_id: materials[0]?.id ?? "", quantity: 0 }] });
  }
  function removeMaterialLine(idx: number) {
    setInputs({ ...inputs, materials: inputs.materials.filter((_, i) => i !== idx) });
  }

  function updateMachineLine(idx: number, patch: Partial<{ machine_id: string; hours: number; unit: TimeUnit }>) {
    const next = [...inputs.machine_time];
    next[idx] = { ...next[idx], ...patch };
    setInputs({ ...inputs, machine_time: next });
  }
  function addMachineLine() {
    setInputs({ ...inputs, machine_time: [...inputs.machine_time, { machine_id: machines[0]?.id ?? "", hours: 0, unit: "u" }] });
  }
  function removeMachineLine(idx: number) {
    setInputs({ ...inputs, machine_time: inputs.machine_time.filter((_, i) => i !== idx) });
  }

  async function save() {
    setSaving(true);
    await supabase
      .from("product_variations")
      .update({
        sku,
        attribute_values: attributeValues,
        cost_inputs: inputs,
        cost_price: costPrice,
        sale_price: salePrice,
        suggested_price: suggestedPrice,
        updated_at: new Date().toISOString(),
      })
      .eq("id", variation.id);
    setSaving(false);
    onSaved();
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <label>SKU (variatie)</label>
          <input
            className="mono"
            value={sku}
            onChange={(e) => {
              setSkuAuto(false);
              setSku(e.target.value);
            }}
          />
          {(skuAuto || generatingSku) && (
            <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
              {generatingSku ? "SKU wordt gegenereerd..." : "Automatisch op basis van de attributen -- pas gerust zelf aan."}
            </p>
          )}
        </div>
        {attributeNames.map((attrName) => (
          <div key={attrName}>
            <label>{attrName}</label>
            <input
              value={attributeValues[attrName] ?? ""}
              onChange={(e) => setAttributeValues({ ...attributeValues, [attrName]: e.target.value })}
              placeholder={`bv. ${attrName === "Grootte" ? "M" : "waarde"}`}
            />
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 14, marginTop: 20 }}>Materialen</h2>
      {inputs.materials.map((line, idx) => {
        const mat = materialsById.get(line.material_id);
        return (
          <div className="line-item" key={idx}>
            <div className="grow">
              <select value={line.material_id} onChange={(e) => updateMaterialLine(idx, { material_id: e.target.value })}>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name} (€{m.price_per_unit}/{m.unit})</option>)}
              </select>
            </div>
            <div className="small">
              <input
                type="number"
                step="0.01"
                value={line.quantity}
                onChange={(e) => updateMaterialLine(idx, { quantity: parseFloat(e.target.value) || 0 })}
                placeholder={mat?.unit === "kg" ? "gram" : mat?.unit}
              />
            </div>
            <button className="btn danger" type="button" onClick={() => removeMaterialLine(idx)}>x</button>
          </div>
        );
      })}
      <button className="btn secondary" type="button" onClick={addMaterialLine}>+ Materiaal</button>

      <h2 style={{ fontSize: 14, marginTop: 20 }}>Machinetijd</h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>
        Voeg meerdere machines toe om hun kosten te combineren -- bv. bij UV-printen of sublimatie eerst de printer, dan de heat press.
      </p>
      {inputs.machine_time.map((line, idx) => {
        const machine = machinesById.get(line.machine_id);
        const breakdown = machine ? machineHourlyCosts(machine) : null;
        const lineHours = toHours(line.hours, line.unit);
        const lineCost = breakdown ? lineHours * (breakdown.depreciationPerHour + breakdown.powerCostPerHour) : 0;
        return (
          <div key={idx} style={{ marginBottom: 8 }}>
            <div className="line-item" style={{ marginBottom: breakdown ? 2 : 8 }}>
              <div className="grow">
                <select value={line.machine_id} onChange={(e) => updateMachineLine(idx, { machine_id: e.target.value })}>
                  {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="small">
                <input
                  type="number"
                  step="0.01"
                  value={line.hours}
                  onChange={(e) => updateMachineLine(idx, { hours: parseFloat(e.target.value) || 0 })}
                  placeholder="tijdsduur"
                />
              </div>
              <div className="unit-select">
                <select value={line.unit ?? "u"} onChange={(e) => updateMachineLine(idx, { unit: e.target.value as TimeUnit })}>
                  {(Object.entries(TIME_UNIT_LABELS) as [TimeUnit, string][]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <button className="btn danger" type="button" onClick={() => removeMachineLine(idx)}>x</button>
            </div>
            {breakdown && (
              <p className="mono muted" style={{ fontSize: 11.5, margin: 0 }}>
                €{breakdown.depreciationPerHour.toFixed(3)}/u afschrijving + €{breakdown.powerCostPerHour.toFixed(3)}/u stroom &times; {lineHours.toFixed(3)}u = €{lineCost.toFixed(3)}
              </p>
            )}
          </div>
        );
      })}
      <button className="btn secondary" type="button" onClick={addMachineLine}>+ Machine</button>

      <div className="row" style={{ marginTop: 16 }}>
        <div>
          <label>Arbeidstijd (min)</label>
          <input type="number" value={inputs.labor_minutes} onChange={(e) => setInputs({ ...inputs, labor_minutes: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label>Uurloon (€/u)</label>
          <input type="number" step="0.01" value={inputs.labor_rate} onChange={(e) => setInputs({ ...inputs, labor_rate: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label>Overige kosten (€)</label>
          <input type="number" step="0.01" value={inputs.other_costs} onChange={(e) => setInputs({ ...inputs, other_costs: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label>Marge (%)</label>
          <input
            type="number"
            step="1"
            value={Math.round(inputs.margin * 100)}
            onChange={(e) => setInputs({ ...inputs, margin: (parseFloat(e.target.value) || 0) / 100 })}
          />
        </div>
        <div>
          <label>Btw (%)</label>
          <input
            type="number"
            step="1"
            value={Math.round(inputs.vat_rate * 100)}
            onChange={(e) => setInputs({ ...inputs, vat_rate: (parseFloat(e.target.value) || 0) / 100 })}
          />
        </div>
      </div>

      <div className="price-box">
        <div className="mono readout-row">Kostprijs<span>€{costPrice.toFixed(2)}</span></div>
        <div className="mono readout-row">Verkoopprijs excl. btw<span>€{salePrice != null ? salePrice.toFixed(2) : "--"}</span></div>
        <div className="mono readout-row">Verkoopprijs incl. btw<span>€{salePriceInclVat != null ? salePriceInclVat.toFixed(2) : "--"}</span></div>
        <div className="readout-suggested">
          <span>Voorgestelde verkoopprijs</span>
          <span className="big">€{suggestedPrice != null ? suggestedPrice.toFixed(2) : "--"}</span>
        </div>
        <p className="readout-note">Afgerond naar boven op een ,95-prijs (charm pricing) -- nooit onder je berekende prijs incl. btw. Pas gerust zelf aan.</p>
        {warnings.map((w, i) => <div className="warning" key={i}>{w}</div>)}
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={save} disabled={saving}>{saving ? "Opslaan..." : "Opslaan"}</button>
        <button className="btn danger" style={{ marginLeft: 8 }} onClick={onDelete}>Variant verwijderen</button>
      </div>
    </div>
  );
}
