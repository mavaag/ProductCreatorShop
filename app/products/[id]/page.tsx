"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { calculatePrice, machineHourlyCosts, effectiveMargin } from "@/lib/pricing";
import { duplicateProduct } from "@/lib/duplicate";
import { recordPriceHistory } from "@/lib/recalc";
import { loadMinMargin } from "@/lib/settings";
import { cartesian, comboKey, parseValueList } from "@/lib/variants";
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
  PriceHistoryEntry,
  DEFAULT_MIN_MARGIN,
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
  const [minMargin, setMinMargin] = useState(DEFAULT_MIN_MARGIN);
  const [wc, setWc] = useState({ description: "", categories: "", image_url: "", weight_kg: "", shipping_class: "" });
  const [savingWc, setSavingWc] = useState(false);
  const [genValues, setGenValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: p }, { data: v }, { data: m }, { data: mat }] = await Promise.all([
      supabase.from("products").select("*").eq("id", productId).single(),
      supabase.from("product_variations").select("*").eq("product_id", productId).order("sku"),
      supabase.from("machines").select("*"),
      supabase.from("materials").select("*"),
    ]);
    setProduct(p);
    if (p) {
      setWc({
        description: p.description ?? "",
        categories: p.categories ?? "",
        image_url: p.image_url ?? "",
        weight_kg: p.weight_kg != null ? String(p.weight_kg) : "",
        shipping_class: p.shipping_class ?? "",
      });
    }
    setAttrDraft(p?.attribute_names ?? []);
    setVariations(v ?? []);
    setMachines(m ?? []);
    setMaterials(mat ?? []);
  }, [productId]);

  useEffect(() => {
    if (ready) {
      load();
      loadMinMargin(supabase).then(setMinMargin);
    }
  }, [ready, load]);

  // Startpunt voor een nieuwe variant: de laatste variant als die er is, anders een leeg model.
  // Voor UV-printen/sublimatie staan meteen 2 machinetijd-regels klaar (printer + heat press).
  function templateCostInputs(): CostInputs {
    if (variations.length > 0) return variations[variations.length - 1].cost_inputs;
    const machineLines = product?.process_type === "sublimation" || product?.process_type === "uv_print" ? 2 : 1;
    return {
      ...EMPTY_COST_INPUTS,
      machine_time: Array.from({ length: machineLines }, () => ({ machine_id: "", hours: 0 })),
    };
  }

  async function addVariation() {
    // Tijdelijke, gegarandeerd unieke SKU -- wordt automatisch vervangen zodra de
    // gebruiker attributen invult (zie VariationEditor). De "-NIEUW-" markering
    // laat de editor weten dat dit nog een auto-gegenereerde SKU is.
    const placeholderSku = `${product?.sku}-NIEUW-${Date.now().toString(36).toUpperCase()}`;

    // Bestaat er al een variant van dit product? Neem dan zijn materialen, machines,
    // arbeid, marge en btw over als startpunt -- meestal verschilt enkel het attribuut
    // (en soms een hoeveelheid), dus dat scheelt telkens alles opnieuw intypen.
    const cost_inputs = templateCostInputs();

    const { error } = await supabase.from("product_variations").insert({
      product_id: productId,
      sku: placeholderSku,
      attribute_values: {},
      cost_inputs,
    });
    if (error) alert(error.message);
    load();
  }

  async function duplicateVariation(source: ProductVariation) {
    const placeholderSku = `${product?.sku}-NIEUW-${Date.now().toString(36).toUpperCase()}`;
    const { error } = await supabase.from("product_variations").insert({
      product_id: productId,
      sku: placeholderSku,
      // Attributen worden mee overgenomen als startpunt -- pas enkel aan wat
      // effectief verschilt (bv. Grootte), de rest hoeft niet opnieuw.
      attribute_values: source.attribute_values,
      cost_inputs: source.cost_inputs,
    });
    if (error) alert(error.message);
    load();
  }

  async function duplicateThisProduct() {
    if (!product) return;
    try {
      const id = await duplicateProduct(supabase, product);
      router.push(`/products/${id}`);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function saveWc() {
    setSavingWc(true);
    const weight = wc.weight_kg.trim() === "" ? null : parseFloat(wc.weight_kg.replace(",", "."));
    const { error } = await supabase
      .from("products")
      .update({
        description: wc.description,
        categories: wc.categories.trim(),
        image_url: wc.image_url.trim(),
        weight_kg: weight != null && Number.isFinite(weight) ? weight : null,
        shipping_class: wc.shipping_class.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId);
    setSavingWc(false);
    if (error) alert(error.message);
    load();
  }

  const genCombos = product
    ? (() => {
        const parsed: Record<string, string[]> = {};
        for (const n of product.attribute_names) parsed[n] = parseValueList(genValues[n] ?? "");
        const existing = new Set(variations.map((v) => comboKey(product.attribute_names, v.attribute_values ?? {})));
        return cartesian(product.attribute_names, parsed).filter((c) => !existing.has(comboKey(product.attribute_names, c)));
      })()
    : [];

  async function generateVariations() {
    if (!product || genCombos.length === 0) return;
    if (genCombos.length > 1 && !confirm(`${genCombos.length} nieuwe varianten aanmaken met de prijsberekening van je laatste variant als startpunt?`)) return;
    setGenerating(true);
    const template = templateCostInputs();
    const machinesById = new Map(machines.map((m) => [m.id, m]));
    const materialsById = new Map(materials.map((m) => [m.id, m]));
    const price = calculatePrice({ ...EMPTY_COST_INPUTS, ...template }, machinesById, materialsById);
    let created = 0;
    for (const combo of genCombos) {
      const values = product.attribute_names.map((n) => combo[n]).filter((v) => v && v.trim());
      const sku = await nextAvailableSku(supabase, "product_variations", `${product.sku}-` + values.map(slugifyForSku).join("-"));
      const { data: row, error } = await supabase
        .from("product_variations")
        .insert({
          product_id: productId,
          sku,
          attribute_values: combo,
          cost_inputs: template,
          cost_price: price.costPrice,
          sale_price: price.salePrice,
          suggested_price: price.suggestedPrice,
        })
        .select("id")
        .single();
      if (error || !row) {
        alert(error?.message ?? "Variant aanmaken mislukt");
        break;
      }
      await recordPriceHistory(
        supabase,
        row.id,
        { cost_price: price.costPrice, sale_price: price.salePrice, suggested_price: price.suggestedPrice, margin: template.margin },
        "Variant gegenereerd"
      );
      created++;
    }
    await supabase.from("products").update({ updated_at: new Date().toISOString() }).eq("id", productId);
    setGenValues({});
    setGenerating(false);
    setNotice(`${created} variant(en) aangemaakt. Controleer de hoeveelheden per variant en pas aan waar nodig.`);
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
        <button className="btn secondary" style={{ marginLeft: 8 }} onClick={duplicateThisProduct}>Product dupliceren</button>
        <button className="btn danger" style={{ marginLeft: 8 }} onClick={deleteProduct}>Product verwijderen</button>
      </div>
      {notice && <div className="card" style={{ background: "var(--moss-soft)" }}>{notice}</div>}

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

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 14 }}>WooCommerce-gegevens</h2>
        <p className="muted">Deze velden gaan mee in de export naar WooCommerce (bij het hoofdproduct).</p>
        <label>Beschrijving</label>
        <textarea
          value={wc.description}
          onChange={(e) => setWc({ ...wc, description: e.target.value })}
          rows={4}
          style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 3, font: "inherit" }}
        />
        <div className="row">
          <div>
            <label>Categorieën</label>
            <input value={wc.categories} onChange={(e) => setWc({ ...wc, categories: e.target.value })} placeholder="bv. Woondecoratie > Vazen, Cadeaus" />
          </div>
          <div>
            <label>Verzendklasse</label>
            <input value={wc.shipping_class} onChange={(e) => setWc({ ...wc, shipping_class: e.target.value })} placeholder="slug uit WooCommerce, bv. klein-pakket" />
          </div>
          <div>
            <label>Gewicht (kg)</label>
            <input value={wc.weight_kg} onChange={(e) => setWc({ ...wc, weight_kg: e.target.value })} placeholder="bv. 0.25" />
          </div>
        </div>
        <label>Afbeelding(en) -- URL, meerdere gescheiden door een komma</label>
        <input value={wc.image_url} onChange={(e) => setWc({ ...wc, image_url: e.target.value })} placeholder="https://..." />
        {wc.image_url.trim() && (
          <img
            src={wc.image_url.split(",")[0].trim()}
            alt="Voorbeeld"
            style={{ maxHeight: 120, marginTop: 10, border: "1px solid var(--line)", borderRadius: 3 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={saveWc} disabled={savingWc}>{savingWc ? "Opslaan..." : "WooCommerce-gegevens opslaan"}</button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 14 }}>Varianten genereren</h2>
        <p className="muted">
          Vul per attribuut de waarden in, gescheiden door een komma. Alle nieuwe combinaties worden aangemaakt met de prijsberekening van je laatste variant als startpunt; bestaande combinaties worden overgeslagen.
        </p>
        <div className="row">
          {product.attribute_names.map((name) => (
            <div key={name}>
              <label>{name}</label>
              <input value={genValues[name] ?? ""} onChange={(e) => setGenValues({ ...genValues, [name]: e.target.value })} placeholder="bv. S, M, L" />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={generateVariations} disabled={generating || genCombos.length === 0}>
            {generating ? "Aanmaken..." : `${genCombos.length} nieuwe variant(en) aanmaken`}
          </button>
        </div>
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
          minMargin={minMargin}
          onSaved={() => {
            supabase.from("products").update({ updated_at: new Date().toISOString() }).eq("id", productId).then(() => load());
          }}
          onDelete={() => deleteVariation(v.id)}
          onDuplicate={() => duplicateVariation(v)}
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
  minMargin,
  onSaved,
  onDelete,
  onDuplicate,
}: {
  variation: ProductVariation;
  productSku: string;
  attributeNames: string[];
  machines: Machine[];
  materials: Material[];
  machinesById: Map<string, Machine>;
  materialsById: Map<string, Material>;
  minMargin: number;
  onSaved: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
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

  const { costPrice, salePrice, salePriceInclVat, suggestedPrice, breakdown, warnings } = calculatePrice(inputs, machinesById, materialsById);
  const realMargin = effectiveMargin(costPrice, suggestedPrice, inputs.vat_rate ?? 0.21);
  const belowMin = realMargin != null && realMargin < minMargin;
  const [history, setHistory] = useState<PriceHistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!showHistory) return;
    supabase
      .from("price_history")
      .select("*")
      .eq("variation_id", variation.id)
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => setHistory((data as PriceHistoryEntry[]) ?? []));
  }, [showHistory, variation.id, variation.suggested_price]);

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
    await recordPriceHistory(
      supabase,
      variation.id,
      { cost_price: costPrice, sale_price: salePrice, suggested_price: suggestedPrice, margin: inputs.margin },
      "Handmatig opgeslagen"
    );
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
        {realMargin != null && (
          <div className="mono readout-row" style={{ marginTop: 6 }}>Werkelijke marge na afronding<span>{(realMargin * 100).toFixed(1)}%</span></div>
        )}
        {belowMin && (
          <div className="warning">
            Marge onder je minimum van {Math.round(minMargin * 100)}% -- controleer de kosten of verhoog de marge.
          </div>
        )}
        {warnings.map((w, i) => <div className="warning" key={i}>{w}</div>)}
      </div>

      <CostBreakdownBar breakdown={breakdown} total={costPrice} />

      <div style={{ marginTop: 12 }}>
        <button className="btn secondary" type="button" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? "Prijsgeschiedenis verbergen" : "Prijsgeschiedenis tonen"}
        </button>
        {showHistory && (
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Datum</th><th>Kostprijs</th><th>Verkoopprijs</th><th>Marge</th><th>Reden</th></tr></thead>
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="mono">{new Date(h.created_at).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="mono">{h.cost_price != null ? `€${Number(h.cost_price).toFixed(2)}` : "--"}</td>
                  <td className="mono">{h.suggested_price != null ? `€${Number(h.suggested_price).toFixed(2)}` : "--"}</td>
                  <td className="mono">{h.margin != null ? `${Math.round(Number(h.margin) * 100)}%` : "--"}</td>
                  <td>{h.reason}</td>
                </tr>
              ))}
              {history && history.length === 0 && <tr><td colSpan={5} className="muted">Nog geen geschiedenis.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={save} disabled={saving}>{saving ? "Opslaan..." : "Opslaan"}</button>
        <button className="btn secondary" style={{ marginLeft: 8 }} onClick={onDuplicate}>Dupliceer als nieuwe variant</button>
        <button className="btn danger" style={{ marginLeft: 8 }} onClick={onDelete}>Variant verwijderen</button>
      </div>
    </div>
  );
}

const BREAKDOWN_PARTS: { key: "materials" | "machines" | "labor" | "other"; label: string; color: string }[] = [
  { key: "materials", label: "Materiaal", color: "#c98500" },
  { key: "machines", label: "Machine", color: "#43684a" },
  { key: "labor", label: "Arbeid", color: "#4b5560" },
  { key: "other", label: "Overig", color: "#b8452e" },
];

function CostBreakdownBar({ breakdown, total }: { breakdown: { materials: number; machines: number; labor: number; other: number }; total: number }) {
  const sum = breakdown.materials + breakdown.machines + breakdown.labor + breakdown.other;
  if (sum <= 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ marginTop: 0 }}>Kostenopbouw (€{total.toFixed(2)})</label>
      <div style={{ display: "flex", height: 14, borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)" }} role="img" aria-label="Kostenopbouw">
        {BREAKDOWN_PARTS.map((part) => {
          const value = breakdown[part.key];
          return value > 0 ? <div key={part.key} style={{ width: `${(value / sum) * 100}%`, background: part.color }} title={`${part.label}: €${value.toFixed(2)}`} /> : null;
        })}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }} className="muted">
        {BREAKDOWN_PARTS.map((part) => (
          <span key={part.key}>
            <span style={{ display: "inline-block", width: 9, height: 9, background: part.color, marginRight: 5 }} />
            {part.label} <span className="mono">€{breakdown[part.key].toFixed(2)} ({Math.round((breakdown[part.key] / sum) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
