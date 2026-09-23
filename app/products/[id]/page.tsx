"use client";

import { useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { calculatePrice, machineHourlyCosts, effectiveMargin } from "@/lib/pricing";
import { duplicateProduct } from "@/lib/duplicate";
import { recordPriceHistory } from "@/lib/recalc";
import { loadMinMargin } from "@/lib/settings";
import { cartesian, comboKey } from "@/lib/variants";
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
  const [defaultAttrDraft, setDefaultAttrDraft] = useState<Record<string, string>>({});
  const [savingDefaultAttrs, setSavingDefaultAttrs] = useState(false);
  const [minMargin, setMinMargin] = useState(DEFAULT_MIN_MARGIN);
  const [wc, setWc] = useState({ description: "", categories: "", image_url: "", weight_kg: "", shipping_class: "" });
  const [savingWc, setSavingWc] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [genValues, setGenValues] = useState<Record<string, string[]>>({});
  const [genCustomInput, setGenCustomInput] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [wcCategories, setWcCategories] = useState<string[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [bulkMargin, setBulkMargin] = useState<string>("");
  const editorRefs = useRef<Map<string, VariationEditorHandle>>(new Map());
  const [wooAttributeTerms, setWooAttributeTerms] = useState<Record<string, string[]>>({});

  const isSimple = (product?.attribute_names.length ?? 0) === 0;

  const load = useCallback(async () => {
    const [{ data: p }, { data: v }, { data: m }, { data: mat }] = await Promise.all([
      supabase.from("products").select("*").eq("id", productId).single(),
      supabase.from("product_variations").select("*").eq("product_id", productId).order("sku"),
      supabase.from("machines").select("*").order("name"),
      supabase.from("materials").select("*").order("name"),
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
    setDefaultAttrDraft(p?.default_attribute_values ?? {});
    setVariations(v ?? []);
    setMachines(m ?? []);
    setMaterials(mat ?? []);
  }, [productId]);

  useEffect(() => {
    if (ready) {
      load();
      loadMinMargin(supabase).then(setMinMargin);
      loadWooCategories();
      loadWooAttributeTerms();
    }
  }, [ready, load]);

  async function loadWooCategories() {
    setLoadingCategories(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/woocommerce/categories", {
        headers: { Authorization: `Bearer ${session.session?.access_token}` }
      });
      if (res.ok) {
        const body = await res.json();
        setWcCategories(body.categories ?? []);
      }
    } catch (e) {
      // Stilletjes falen - gebruiker kan nog steeds handmatig typen
    }
    setLoadingCategories(false);
  }

  async function loadWooAttributeTerms() {
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/woocommerce/attributes", {
        headers: { Authorization: `Bearer ${session.session?.access_token}` }
      });
      if (res.ok) {
        const body = await res.json();
        // Convert array to object: { "Kleur": ["Rood", "Blauw"], "Maat": ["S", "M", "L"] }
        const termsMap: Record<string, string[]> = {};
        for (const attr of body.attributes) {
          termsMap[attr.name] = attr.terms;
        }
        setWooAttributeTerms(termsMap);
      }
    } catch (e) {
      // Stilletjes falen - gebruiker kan nog steeds handmatig typen
    }
  }

  // Startpunt voor een nieuwe variant: de laatste variant als die er is, anders een leeg model.
  // Voor UV-printen/sublimatie staan meteen 2 machinetijd-regels klaar (printer + heat press).
  // Elke regel krijgt meteen de eerste beschikbare machine (zoals ook bij "+ Machine" op een
  // bestaande variant) -- anders toont de dropdown wel een machine, maar bevat de opgeslagen
  // waarde geen geldig machine_id, wat de "machine bestaat niet meer"-melding triggert.
  function templateCostInputs(): CostInputs {
    if (variations.length > 0) return variations[variations.length - 1].cost_inputs;
    const machineLines = product?.process_type === "sublimation" || product?.process_type === "uv_print" ? 2 : 1;
    return {
      ...EMPTY_COST_INPUTS,
      machine_time: Array.from({ length: machineLines }, () => ({ machine_id: machines[0]?.id ?? "", hours: 0 })),
    };
  }

  async function addVariation() {
    // Tijdelijke, gegarandeerd unieke SKU -- wordt automatisch vervangen zodra de
    // gebruiker attributen invult (zie VariationEditor). De "-NIEUW-" markering
    // laat de editor weten dat dit nog een auto-gegenereerde SKU is.
    const placeholderSku = isSimple ? product!.sku : `${product?.sku}-NIEUW-${Date.now().toString(36).toUpperCase()}`;

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

  async function saveName() {
    const name = nameDraft.trim();
    if (!name) return;
    if (name !== product?.name) {
      const { error } = await supabase
        .from("products")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", productId);
      if (error) {
        alert(error.message);
        return;
      }
      setNotice("Naam aangepast. Gebruik de WooCommerce-sync om de nieuwe naam ook in de webshop bij te werken (de SKU blijft ongewijzigd).");
      load();
    }
    setEditingName(false);
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
        const existing = new Set(variations.map((v) => comboKey(product.attribute_names, v.attribute_values ?? {})));
        return cartesian(product.attribute_names, genValues).filter((c) => !existing.has(comboKey(product.attribute_names, c)));
      })()
    : [];

  /** Zet een waarde aan/uit in de selectie voor een attribuut (bv. "M" toevoegen/verwijderen bij "Grootte"). */
  function toggleGenValue(name: string, value: string) {
    const current = genValues[name] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setGenValues({ ...genValues, [name]: next });
  }

  /** Voegt een zelf getypte waarde toe aan de selectie (voor waarden die niet in de WooCommerce-lijst staan). */
  function addGenCustomValue(name: string) {
    const value = (genCustomInput[name] ?? "").trim();
    if (!value) return;
    const current = genValues[name] ?? [];
    if (!current.includes(value)) setGenValues({ ...genValues, [name]: [...current, value] });
    setGenCustomInput({ ...genCustomInput, [name]: "" });
  }

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
    if (!product) return;

    if (!confirm(`"${product.name}" (en al zijn varianten) verwijderen uit de lokale database?`)) return;

    // Vraag of het ook uit WooCommerce verwijderd moet worden
    const deleteFromWoo = confirm(
      `Ook uit WooCommerce verwijderen?\n\n` +
      `Klik OK om het product zowel lokaal als in WooCommerce te verwijderen.\n` +
      `Klik Annuleren om alleen lokaal te verwijderen (het product blijft in WooCommerce staan).`
    );

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

        if (!res.ok || !body.deleted) {
          const proceed = confirm(
            `Waarschuwing: ${body.message || body.error || "Product niet gevonden in WooCommerce"}\n\n` +
            `Toch doorgaan met lokaal verwijderen?`
          );
          if (!proceed) return;
        }
      }

      // Verwijder uit lokale database
      await supabase.from("products").delete().eq("id", productId);
      router.push("/products");

    } catch (e: any) {
      alert(`Fout bij verwijderen: ${e.message}`);
    }
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
    if (!product) return;
    const cleanNames = attrDraft.map((n) => n.trim()).filter(Boolean);
    if (cleanNames.length === 0 && variations.length > 1) {
      alert("Een simpel product (zonder attributen) heeft maar 1 prijsberekening. Verwijder eerst de overige varianten.");
      return;
    }
    setSavingAttrs(true);
    if (cleanNames.length === 0 && variations.length === 1) {
      // Wordt een simpel product: de enige variant neemt de SKU van het product over.
      await supabase.from("product_variations").update({ sku: product.sku, attribute_values: {} }).eq("id", variations[0].id);
    } else if (product.attribute_names.length === 0 && cleanNames.length > 0) {
      // Simpel product wordt variabel: de variant mag niet langer de SKU van het product dragen.
      // De "-NIEUW-" markering zorgt dat de SKU automatisch uit de attributen gegenereerd wordt.
      for (const v of variations.filter((v) => v.sku === product.sku)) {
        await supabase.from("product_variations").update({ sku: `${product.sku}-NIEUW-${Date.now().toString(36).toUpperCase()}` }).eq("id", v.id);
      }
    }
    await supabase.from("products").update({ attribute_names: cleanNames, updated_at: new Date().toISOString() }).eq("id", productId);
    setSavingAttrs(false);
    load();
  }

  /** Alle waarden die effectief gebruikt worden voor een attribuut, over alle varianten heen (voor de standaardwaarde-keuzelijst). */
  function usedValuesFor(attrName: string): string[] {
    return Array.from(new Set(variations.map((v) => v.attribute_values?.[attrName]).filter((v): v is string => !!v && !!v.trim()))).sort();
  }

  async function saveDefaultAttrs() {
    if (!product) return;
    setSavingDefaultAttrs(true);
    // Enkel waarden voor attributen die nog bestaan, en enkel als er effectief een waarde gekozen is.
    const cleaned = Object.fromEntries(
      product.attribute_names
        .map((n) => [n, (defaultAttrDraft[n] ?? "").trim()] as const)
        .filter(([, v]) => v)
    );
    await supabase.from("products").update({ default_attribute_values: cleaned, updated_at: new Date().toISOString() }).eq("id", productId);
    setSavingDefaultAttrs(false);
    load();
  }

  async function saveAllVariations() {
    if (variations.length === 0) return;
    if (!confirm(`Alle ${variations.length} varianten opslaan?`)) return;

    setSavingAll(true);
    for (const v of variations) {
      await editorRefs.current.get(v.id)?.save("Bulk opgeslagen");
    }

    await supabase.from("products").update({ updated_at: new Date().toISOString() }).eq("id", productId);
    setSavingAll(false);
    setNotice(`Alle ${variations.length} varianten opgeslagen!`);
    load();
  }

  function applyBulkMargin() {
    const newMargin = parseFloat(bulkMargin);
    if (!newMargin || newMargin < 0 || newMargin > 100) {
      alert("Voer een geldige marge in tussen 0 en 100%");
      return;
    }

    const marginDecimal = newMargin / 100;
    for (const v of variations) {
      editorRefs.current.get(v.id)?.setMargin(marginDecimal);
    }

    setBulkMargin("");
    setNotice(`Marge van alle varianten lokaal ingesteld op ${newMargin}% -- klik op "Alle varianten opslaan" om te bewaren.`);
  }

  if (!ready || !product) return null;

  const machinesById = new Map(machines.map((m) => [m.id, m]));
  const materialsById = new Map(materials.map((m) => [m.id, m]));
  const attrsChanged = JSON.stringify(attrDraft.map((n) => n.trim()).filter(Boolean)) !== JSON.stringify(product.attribute_names);
  const savedDefaultAttrs = Object.fromEntries(Object.entries(product.default_attribute_values ?? {}).filter(([, v]) => v));
  const defaultAttrsChanged = JSON.stringify(defaultAttrDraft) !== JSON.stringify(savedDefaultAttrs);

  return (
    <div>
      {editingName ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") setEditingName(false);
            }}
            style={{ flex: 1, fontSize: 18 }}
          />
          <button className="btn" onClick={saveName}>Opslaan</button>
          <button className="btn secondary" onClick={() => setEditingName(false)}>Annuleren</button>
        </div>
      ) : (
        <h1>
          {product.name}{" "}
          <button
            className="icon-btn"
            title="Naam wijzigen"
            aria-label="Naam wijzigen"
            onClick={() => { setNameDraft(product.name); setEditingName(true); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
              <path d="M4 20l1-5L16 4l4 4L9 19l-5 1z" />
              <path d="M14 6l4 4" />
            </svg>
          </button>
        </h1>
      )}
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
        <p className="muted">
          Bv. Grootte + Kleur samen -- de volgorde bepaalt Attribute 1/2/3 in de WooCommerce-export.
          {isSimple && " Geen attributen = simpel product zonder varianten."}
        </p>
        {attrDraft.map((name, idx) => (
          <div className="line-item" key={idx}>
            <div className="grow">
              <input value={name} onChange={(e) => updateAttrDraft(idx, e.target.value)} placeholder="bv. Grootte" />
            </div>
            {(attrDraft.length > 1 || variations.length <= 1) && (
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

      {!isSimple && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 14 }}>Standaardwaarden</h2>
          <p className="muted">
            De waarde die al geselecteerd staat wanneer een klant de productpagina opent (WooCommerce "Default Form Values").
            Optioneel -- laat op "Geen standaardwaarde" als je de klant zelf wil laten kiezen.
          </p>
          <div className="row">
            {product.attribute_names.map((name) => {
              const options = usedValuesFor(name);
              return (
                <div key={name}>
                  <label>{name}</label>
                  <select
                    value={defaultAttrDraft[name] ?? ""}
                    onChange={(e) => setDefaultAttrDraft({ ...defaultAttrDraft, [name]: e.target.value })}
                  >
                    <option value="">Geen standaardwaarde</option>
                    {options.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  {options.length === 0 && (
                    <p className="muted" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>Nog geen varianten met een waarde voor dit attribuut.</p>
                  )}
                </div>
              );
            })}
          </div>
          {defaultAttrsChanged && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={saveDefaultAttrs} disabled={savingDefaultAttrs}>{savingDefaultAttrs ? "Opslaan..." : "Standaardwaarden opslaan"}</button>
            </div>
          )}
        </div>
      )}

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
        {wc.description.trim() && (
          <div style={{ marginTop: 8, padding: 12, background: "rgba(0, 255, 255, 0.05)", border: "1px solid rgba(0, 255, 255, 0.2)", borderRadius: 4 }}>
            <p className="muted" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>Preview (HTML gerenderd):</p>
            <div dangerouslySetInnerHTML={{ __html: wc.description }} />
          </div>
        )}
        <div className="row">
          <div>
            <label>Categorieën {loadingCategories && <span className="muted">(laden...)</span>}</label>
            <input
              list="wc-categories"
              value={wc.categories}
              onChange={(e) => setWc({ ...wc, categories: e.target.value })}
              placeholder="bv. Woondecoratie > Vazen, Cadeaus"
            />
            {wcCategories.length > 0 && (
              <datalist id="wc-categories">
                {wcCategories.map((cat) => <option key={cat} value={cat} />)}
              </datalist>
            )}
            {!loadingCategories && wcCategories.length === 0 && (
              <p className="muted" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
                Categorieën ophalen mislukt. Typ handmatig of controleer je WooCommerce instellingen.
              </p>
            )}
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

      {!isSimple && (
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 14 }}>Varianten genereren</h2>
        <p className="muted">
          Selecteer per attribuut de waarden die je wil combineren (meerdere mogelijk). Alle nieuwe combinaties worden aangemaakt met de prijsberekening van je laatste variant als startpunt; bestaande combinaties worden overgeslagen.
        </p>
        <div className="row">
          {product.attribute_names.map((name) => {
            const terms = wooAttributeTerms[name] || [];
            const selected = genValues[name] ?? [];
            // Zelf getypte waarden die niet in de WooCommerce-lijst staan, tonen we als extra chips.
            const customSelected = selected.filter((v) => !terms.includes(v));
            return (
              <div key={name}>
                <label>{name}</label>
                <div className="chip-group">
                  {[...terms, ...customSelected].map((term) => (
                    <button
                      key={term}
                      type="button"
                      className={`chip-toggle${selected.includes(term) ? " active" : ""}`}
                      onClick={() => toggleGenValue(name, term)}
                    >
                      {term}
                    </button>
                  ))}
                  {terms.length === 0 && customSelected.length === 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>Nog geen waarden -- typ er hieronder een.</span>
                  )}
                </div>
                <div className="line-item" style={{ marginTop: 6, marginBottom: 0 }}>
                  <div className="grow">
                    <input
                      value={genCustomInput[name] ?? ""}
                      onChange={(e) => setGenCustomInput({ ...genCustomInput, [name]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addGenCustomValue(name);
                        }
                      }}
                      placeholder="andere waarde toevoegen..."
                    />
                  </div>
                  <button className="btn secondary" type="button" onClick={() => addGenCustomValue(name)}>+</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={generateVariations} disabled={generating || genCombos.length === 0}>
            {generating ? "Aanmaken..." : `${genCombos.length} nieuwe variant(en) aanmaken`}
          </button>
        </div>
      </div>
      )}

      <h2>{isSimple ? "Prijsberekening" : <>Varianten &amp; prijsberekening</>}</h2>
      <p className="muted">
        {isSimple ? "Dit is een simpel product met één prijsberekening." : "Elke variant heeft"} zijn eigen prijsberekening (materialen, machinetijd, arbeid, marge). Deze gegevens blijven
        hier bewaard en aanpasbaar -- bij de WooCommerce-export wordt enkel de berekende verkoopprijs meegenomen, niet
        deze rekendetails.
      </p>

      {!isSimple && variations.length > 0 && (
        <div className="card" style={{ background: "var(--moss-soft)", marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Bulk acties</h3>
          <div className="row">
            <div>
              <label>Marge voor alle varianten wijzigen (%)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  step="1"
                  value={bulkMargin}
                  onChange={(e) => setBulkMargin(e.target.value)}
                  placeholder="bv. 35"
                  style={{ flexGrow: 1 }}
                />
                <button
                  className="btn secondary"
                  onClick={applyBulkMargin}
                  disabled={!bulkMargin}
                >
                  Marge instellen
                </button>
              </div>
              <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
                Wordt pas bewaard nadat je op &quot;Alle varianten opslaan&quot; klikt.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                className="btn"
                onClick={saveAllVariations}
                disabled={savingAll}
                style={{ width: "100%" }}
              >
                {savingAll ? "Bezig met opslaan..." : `Alle ${variations.length} varianten opslaan`}
              </button>
            </div>
          </div>
        </div>
      )}

      {variations.map((v) => (
        <VariationEditor
          key={v.id}
          ref={(el) => {
            if (el) editorRefs.current.set(v.id, el);
            else editorRefs.current.delete(v.id);
          }}
          variation={v}
          productSku={product.sku}
          attributeNames={product.attribute_names}
          isSimple={isSimple}
          wooAttributeTerms={wooAttributeTerms}
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

      {(!isSimple || variations.length === 0) && (
        <button className="btn" onClick={addVariation}>{isSimple ? "+ Prijsberekening toevoegen" : "+ Variant toevoegen"}</button>
      )}
    </div>
  );
}

type VariationEditorHandle = { save: (reason?: string) => Promise<void>; setMargin: (margin: number) => void };

const VariationEditor = forwardRef<VariationEditorHandle, {
  variation: ProductVariation;
  productSku: string;
  attributeNames: string[];
  isSimple: boolean;
  wooAttributeTerms: Record<string, string[]>;
  machines: Machine[];
  materials: Material[];
  machinesById: Map<string, Machine>;
  materialsById: Map<string, Material>;
  minMargin: number;
  onSaved: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}>(function VariationEditor({
  variation,
  productSku,
  attributeNames,
  isSimple,
  wooAttributeTerms,
  machines,
  materials,
  machinesById,
  materialsById,
  minMargin,
  onSaved,
  onDelete,
  onDuplicate,
}, ref) {
  const [sku, setSku] = useState(variation.sku);
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>(variation.attribute_values ?? {});
  const [inputs, setInputs] = useState<CostInputs>({ ...EMPTY_COST_INPUTS, ...(variation.cost_inputs ?? {}) });
  const [saving, setSaving] = useState(false);
  // Enkel varianten die net met "+ Variant toevoegen" zijn aangemaakt (herkenbaar aan
  // de "-NIEUW-" markering) krijgen automatische SKU-generatie -- bestaande varianten
  // met een SKU die je zelf (of via import) al hebt gezet, blijven onaangeroerd.
  const [skuAuto, setSkuAuto] = useState(variation.sku.includes("-NIEUW-"));
  const [generatingSku, setGeneratingSku] = useState(false);

  // Sync lokale state met de variant prop wanneer deze van buitenaf wordt bijgewerkt
  // (bv. na bulk acties zoals "Marge toepassen" of "Alles opslaan")
  useEffect(() => {
    setSku(variation.sku);
    setAttributeValues(variation.attribute_values ?? {});
    setInputs({ ...EMPTY_COST_INPUTS, ...(variation.cost_inputs ?? {}) });
  }, [variation.sku, variation.attribute_values, variation.cost_inputs]);

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

  async function save(reason = "Handmatig opgeslagen") {
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
      reason
    );
    setSaving(false);
  }

  useImperativeHandle(ref, () => ({
    save,
    setMargin: (margin: number) => setInputs((prev) => ({ ...prev, margin })),
  }));

  const baselineInputs = { ...EMPTY_COST_INPUTS, ...(variation.cost_inputs ?? {}) };
  const dirty =
    sku !== variation.sku ||
    JSON.stringify(attributeValues) !== JSON.stringify(variation.attribute_values ?? {}) ||
    JSON.stringify(inputs) !== JSON.stringify(baselineInputs);

  return (
    <div className="card" style={dirty ? { borderColor: "var(--yellow)" } : undefined}>
      <div className="row">
        <div>
          <label>
            {isSimple ? "SKU (gelijk aan het product)" : "SKU (variatie)"}
            {dirty && (
              <span className="mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--yellow)" }}>
                * niet opgeslagen
              </span>
            )}
          </label>
          <input
            className="mono"
            readOnly={isSimple}
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
        {attributeNames.map((attrName) => {
          const terms = wooAttributeTerms[attrName] || [];
          const hasTerms = terms.length > 0;
          return (
            <div key={attrName}>
              <label>{attrName}</label>
              <input
                list={hasTerms ? `woo-terms-${variation.id}-${attrName}` : undefined}
                value={attributeValues[attrName] ?? ""}
                onChange={(e) => setAttributeValues({ ...attributeValues, [attrName]: e.target.value })}
                placeholder={`bv. ${attrName === "Grootte" ? "M" : "waarde"}`}
              />
              {hasTerms && (
                <datalist id={`woo-terms-${variation.id}-${attrName}`}>
                  {terms.map((term) => <option key={term} value={term} />)}
                </datalist>
              )}
            </div>
          );
        })}
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
      </div>

      <div className="price-box">
        <div className="mono readout-row">Kostprijs<span>€{costPrice.toFixed(2)}</span></div>
        <div className="mono readout-row" style={{ color: "var(--moss-ink)", fontWeight: 600 }}>
          Winst
          <span>{salePrice != null ? `€${(salePrice - costPrice).toFixed(2)}` : "--"}</span>
        </div>
        <div className="readout-suggested">
          <span>Voorgestelde verkoopprijs</span>
          <span className="big">€{suggestedPrice != null ? suggestedPrice.toFixed(2) : "--"}</span>
        </div>
        <p className="readout-note">
          Gebaseerd op je kostprijs (€{costPrice.toFixed(2)}) + {Math.round(inputs.margin * 100)}% marge, afgerond naar ,95 (charm pricing).
          Pas gerust zelf aan indien gewenst.
        </p>
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
        <button className="btn" onClick={async () => { await save(); onSaved(); }} disabled={saving || !dirty}>
          {saving ? "Opslaan..." : dirty ? "Opslaan" : "Geen wijzigingen"}
        </button>
        {!isSimple && (
          <>
            <button className="btn secondary" style={{ marginLeft: 8 }} onClick={onDuplicate}>Dupliceer als nieuwe variant</button>
            <button className="btn danger" style={{ marginLeft: 8 }} onClick={onDelete}>Variant verwijderen</button>
          </>
        )}
      </div>
    </div>
  );
});

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
