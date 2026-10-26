"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { PROCESS_TYPE_LABELS } from "@/lib/types";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { MAKER_MODEL_COLUMNS, MakerDoc, MakerModel, MakerPick, createProductFromDoc } from "@/lib/maker";

/** Stappen van een model: kiezen -> document (beschrijving, foto's, varianten) -> product in de beheertool. */
type Stage = "all" | "picked" | "doc" | "ready" | "created" | "shop";

const STAGES: { value: Stage; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "picked", label: "Geselecteerd" },
  { value: "doc", label: "Wacht op document" },
  { value: "ready", label: "Klaar om aan te maken" },
  { value: "created", label: "Product gemaakt" },
  { value: "shop", label: "Al in de shop" },
];

const KIND_COLORS: Record<string, string> = { Lasercut: "#ff5a5a", "3D-Print": "var(--cyan)" };
const KIND_LABELS: Record<string, string> = { Lasercut: "Laser", "3D-Print": "3D-print" };
const PAGE_SIZE = 120;

/** Haalt alle rijen op in blokken van 1000 (PostgREST geeft er standaard maximaal 1000 per keer). */
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export default function CatalogPage() {
  const ready = useAuthGuard();
  const [models, setModels] = useState<MakerModel[]>([]);
  const [picks, setPicks] = useState<Map<string, MakerPick>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("all");
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        fetchAll<MakerModel>("maker_models", MAKER_MODEL_COLUMNS),
        fetchAll<MakerPick>("maker_picks", "model_id, product_id, created_at"),
      ]);
      setModels(m.sort((a, b) => a.title.localeCompare(b.title)));
      setPicks(new Map(p.map((x) => [x.model_id, x])));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  useEffect(() => setShown(PAGE_SIZE), [stage, kind, category, search, onlyReady]);

  function stageOf(m: MakerModel): Exclude<Stage, "all" | "picked"> | null {
    const pick = picks.get(m.id);
    if (pick?.product_id) return "created";
    if (m.woo_product_id) return "shop";
    if (!pick) return null;
    return m.has_doc ? "ready" : "doc";
  }

  const categories = useMemo(
    () => Array.from(new Set(models.filter((m) => !kind || m.kind === kind).map((m) => m.category || "(geen)"))).sort(),
    [models, kind]
  );

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { all: models.length, picked: picks.size, doc: 0, ready: 0, created: 0, shop: 0 };
    for (const m of models) {
      const s = stageOf(m);
      if (s) c[s]++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, picks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (kind && m.kind !== kind) return false;
      if (category && (m.category || "(geen)") !== category) return false;
      if (onlyReady && m.kind === "Lasercut" && m.laser_ready.length === 0) return false;
      if (stage === "picked" && !picks.has(m.id)) return false;
      if (stage !== "all" && stage !== "picked" && stageOf(m) !== stage) return false;
      if (q && !`${m.title} ${m.collection} ${m.category} ${m.path}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, picks, stage, kind, category, search, onlyReady]);

  async function togglePick(m: MakerModel) {
    const pick = picks.get(m.id);
    if (pick?.product_id) {
      await alertDialog("Van dit model is al een product gemaakt -- verwijder eerst het product als je het opnieuw wil aanmaken.");
      return;
    }
    const next = new Map(picks);
    if (pick) {
      next.delete(m.id);
      setPicks(next);
      const { error } = await supabase.from("maker_picks").delete().eq("model_id", m.id);
      if (error) { setError(error.message); load(); }
    } else {
      next.set(m.id, { model_id: m.id, product_id: null, created_at: new Date().toISOString() });
      setPicks(next);
      const { error } = await supabase.from("maker_picks").insert({ model_id: m.id });
      if (error) { setError(error.message); load(); }
    }
  }

  async function selectAllFiltered() {
    const add = filtered.filter((m) => !picks.has(m.id)).map((m) => ({ model_id: m.id }));
    if (add.length === 0) return;
    if (add.length > 50 && !(await confirmDialog(`${add.length} modellen selecteren?`))) return;
    const { error } = await supabase.from("maker_picks").insert(add);
    if (error) setError(error.message);
    load();
  }

  async function makeProducts(ids: string[]) {
    if (ids.length === 0) return;
    if (ids.length > 1 && !(await confirmDialog(`${ids.length} producten aanmaken in de beheertool (als concept, nog niet gepubliceerd)?`))) return;
    const { data, error } = await supabase.from("maker_models").select("id, doc").in("id", ids);
    if (error) { setError(error.message); return; }
    const failed: string[] = [];
    let lastId: string | null = null;
    for (const [i, row] of (data ?? []).entries()) {
      setBusy(`Product ${i + 1}/${data!.length} aanmaken...`);
      try {
        lastId = await createProductFromDoc(supabase, row.doc as MakerDoc);
      } catch (e: any) {
        failed.push(`${(row.doc as MakerDoc)?.product?.name ?? row.id}: ${e.message ?? e}`);
      }
    }
    setBusy(null);
    await load();
    if (failed.length > 0) await alertDialog(`Niet gelukt:\n${failed.join("\n")}`);
    else if (ids.length === 1 && lastId) window.location.href = `/products/${lastId}`;
  }

  if (!ready) return null;

  const readyIds = models.filter((m) => stageOf(m) === "ready").map((m) => m.id);

  return (
    <div>
      <h1>Catalogus</h1>
      <p className="sub">
        Alle modellen uit de MakerProducts-bibliotheek op de NAS. Vink aan wat je wil verkopen; zodra er een productdocument
        is (beschrijving, foto&apos;s, varianten) maak je er met één klik een product van in de beheertool.
      </p>

      <div className="tabs">
        {STAGES.map((s) => (
          <button key={s.value} type="button" className={`tab${stage === s.value ? " active" : ""}`} onClick={() => setStage(s.value)}>
            {s.label} <span className="tab-count">{counts[s.value]}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label>Zoeken</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="naam, collectie, categorie..." />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label>Techniek</label>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setCategory(""); }}>
            <option value="">Alle</option>
            <option value="Lasercut">Laser</option>
            <option value="3D-Print">3D-print</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>Categorie</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Alle</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }} title="Lasermodellen met snijklare platen (LaserReady)">
          <input type="checkbox" style={{ width: "auto" }} checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} />
          Enkel snijklaar
        </label>
      </div>

      {(counts.doc > 0 || readyIds.length > 0) && (
        <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {counts.doc > 0 && (
            <span className="muted" style={{ flex: 1, minWidth: 240 }}>
              <b style={{ color: "var(--yellow)" }}>{counts.doc}</b> geselecteerd zonder productdocument -- vraag Claude om de
              documenten te maken (beschrijving, foto&apos;s, varianten); ze verschijnen daarna hier vanzelf.
            </span>
          )}
          {readyIds.length > 0 && (
            <button className="btn" disabled={!!busy} onClick={() => makeProducts(readyIds)}>
              Maak {readyIds.length} product{readyIds.length === 1 ? "" : "en"}
            </button>
          )}
          {busy && <span className="muted">{busy}</span>}
        </div>
      )}

      {error && <p className="warning">{error}</p>}

      <div className="prod-viewbar">
        <div className="prod-viewbar-left">
          {filtered.length > 0 && (
            <button className="btn secondary" type="button" onClick={selectAllFiltered}>Alles in deze lijst selecteren</button>
          )}
          <span className="muted">{loading ? "laden..." : `${filtered.length} model${filtered.length === 1 ? "" : "len"}`}</span>
        </div>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {models.length === 0
              ? "De catalogus is nog leeg -- draai eerst tools/maker/sync_catalog.py op de NAS."
              : "Geen modellen gevonden voor deze filter/zoekopdracht."}
          </p>
        </div>
      ) : (
        <div className="prod-grid">
          {filtered.slice(0, shown).map((m) => {
            const s = stageOf(m);
            const picked = picks.has(m.id);
            return (
              <div
                key={m.id}
                className={`prod-card${picked ? " selected" : ""}`}
                style={{ "--prod-color": KIND_COLORS[m.kind] ?? "var(--cyan)" } as CSSProperties}
              >
                <button type="button" className="prod-thumb maker-thumb-btn" onClick={() => setOpenId(m.id)} aria-label={`Details van ${m.title}`}>
                  {m.thumb_url ? <img src={m.thumb_url} alt="" loading="lazy" /> : <div className="prod-thumb-empty">geen voorbeeld</div>}
                </button>
                <label className="prod-check" title="Selecteren">
                  <input type="checkbox" style={{ width: "auto" }} aria-label={`Selecteer ${m.title}`} checked={picked} onChange={() => togglePick(m)} />
                </label>
                <span className="prod-process">{KIND_LABELS[m.kind] ?? m.kind}</span>
                <div className="prod-body">
                  <button type="button" className="prod-name maker-name-btn" onClick={() => setOpenId(m.id)}>{m.title}</button>
                  <div className="prod-sku">{[m.collection, m.category].filter(Boolean).join(" · ")}</div>
                  <div className="prod-cats">
                    {m.kind === "Lasercut" && m.laser_ready.length > 0 && <span className="pill cyan">Snijklaar</span>}
                    {m.has_doc && <span className="pill cyan">Document</span>}
                    {m.woo_product_id && <span className="pill">In shop #{m.woo_product_id}</span>}
                  </div>
                </div>
                <div className="prod-foot">
                  <span className={`prod-status${s === "created" || s === "ready" ? " on" : ""}`}>
                    <i />
                    {s === "created" ? "Product gemaakt" : s === "ready" ? "Klaar om aan te maken" : s === "doc" ? "Wacht op document" : s === "shop" ? "Al in de shop" : "Niet geselecteerd"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {filtered.length > shown && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn secondary" onClick={() => setShown(shown + PAGE_SIZE)}>
            Meer tonen ({filtered.length - shown} resterend)
          </button>
        </div>
      )}

      {openId && (
        <ModelDetail
          model={models.find((m) => m.id === openId)!}
          pick={picks.get(openId) ?? null}
          busy={!!busy}
          onClose={() => setOpenId(null)}
          onToggle={() => togglePick(models.find((m) => m.id === openId)!)}
          onMake={() => makeProducts([openId])}
        />
      )}
    </div>
  );
}

function ModelDetail({ model, pick, busy, onClose, onToggle, onMake }: {
  model: MakerModel;
  pick: MakerPick | null;
  busy: boolean;
  onClose: () => void;
  onToggle: () => void;
  onMake: () => void;
}) {
  const [doc, setDoc] = useState<MakerDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(model.has_doc);
  const [image, setImage] = useState(0);

  useEffect(() => {
    if (!model.has_doc) return;
    supabase.from("maker_models").select("doc").eq("id", model.id).single().then(({ data }) => {
      setDoc((data?.doc as MakerDoc) ?? null);
      setLoadingDoc(false);
    });
  }, [model.id, model.has_doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const images = [...(doc?.product.image_urls ?? []), ...(model.thumb_url && !(doc?.product.image_urls ?? []).length ? [model.thumb_url] : [])];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal-panel maker-detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={model.title}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 style={{ marginTop: 0 }}>{doc?.product.name ?? model.title}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {KIND_LABELS[model.kind] ?? model.kind} · {[model.collection, model.category].filter(Boolean).join(" · ")} · <span className="mono">{model.path}</span>
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Sluiten">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
        </div>

        <div className="maker-detail-grid">
          <div>
            <div className="maker-detail-img">
              {images[image] ? <img src={images[image]} alt="" /> : <div className="prod-thumb-empty">geen voorbeeld</div>}
            </div>
            {images.length > 1 && (
              <div className="maker-detail-thumbs">
                {images.map((u, i) => (
                  <button key={u} type="button" className={i === image ? "active" : ""} onClick={() => setImage(i)}><img src={u} alt="" /></button>
                ))}
              </div>
            )}
          </div>

          <div>
            {loadingDoc ? (
              <p className="muted">Document laden...</p>
            ) : !doc ? (
              <p className="muted">
                Nog geen productdocument. {pick ? "Dit model is geselecteerd -- Claude maakt het document (beschrijving, foto's, varianten)." : "Selecteer dit model om er een document voor te laten maken."}
              </p>
            ) : (
              <>
                <div className="prod-cats" style={{ marginTop: 0 }}>
                  <span className="pill cyan">{PROCESS_TYPE_LABELS[doc.product.process_type]}</span>
                  <span className="pill">{doc.product.categories}</span>
                  <span className="pill">{doc.product.type === "simple" ? "simpel" : `${doc.variations.length} varianten`}</span>
                  <span className="pill mono">{doc.product.sku_base}</span>
                </div>
                {doc.woo_existing && (
                  <p className="warning">
                    Staat al in WooCommerce als #{doc.woo_existing.id} &quot;{doc.woo_existing.name}&quot; ({doc.woo_existing.type}, €{doc.woo_existing.price}).
                    Importeer het via Producten &gt; Import i.p.v. een nieuw product te maken; de varianten hieronder kan je daarna toevoegen.
                  </p>
                )}
                <div className="maker-desc" dangerouslySetInnerHTML={{ __html: doc.product.short_description }} />
                <details>
                  <summary>Volledige beschrijving</summary>
                  <div className="maker-desc" dangerouslySetInnerHTML={{ __html: doc.product.description }} />
                </details>
                {doc.attributes.length > 0 && (
                  <details open>
                    <summary>Varianten</summary>
                    <table>
                      <thead><tr>{doc.attributes.map((a) => <th key={a.name}>{a.name}</th>)}<th>Productie</th></tr></thead>
                      <tbody>
                        {doc.variations.map((v, i) => (
                          <tr key={i}>
                            {doc.attributes.map((a) => <td key={a.name}>{v.attributes[a.name]}</td>)}
                            <td className="muted">{productionLabel(v.production)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                {(doc.notes_internal.length > 0 || doc.license.trademark) && (
                  <details>
                    <summary>Notities ({doc.notes_internal.length + (doc.license.trademark ? 1 : 0)})</summary>
                    <ul className="muted">
                      {doc.license.trademark && <li style={{ color: "var(--yellow)" }}>Merk/licentiefiguur: eerst licentie nakijken voor je verkoopt.</li>}
                      {doc.notes_internal.map((n) => <li key={n}>{n}</li>)}
                      <li>{doc.license.note}</li>
                    </ul>
                  </details>
                )}
              </>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {pick?.product_id ? (
                <Link className="btn" href={`/products/${pick.product_id}`}>Open product</Link>
              ) : (
                <>
                  <button className="btn" disabled={busy || !doc || !!doc.woo_existing} onClick={onMake}>Maak product</button>
                  <button className="btn secondary" onClick={onToggle}>{pick ? "Uit selectie halen" : "Selecteren"}</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Korte samenvatting van de productiegegevens van een variant (platen per laser / printschaal). */
function productionLabel(p: Record<string, any>): string {
  if (p.status === "plates_to_generate") return `platen nog te maken (${p.scale_pct}%)`;
  if (p.machines) {
    return Object.entries(p.machines as Record<string, { sheets: number; scale_pct: number }>)
      .map(([m, x]) => `${m}: ${x.sheets} platen @ ${x.scale_pct}%`)
      .join(" · ");
  }
  if (p.target_cm) return `${p.target_cm} cm${p.scale_pct ? ` (schaal ${p.scale_pct}%)` : ""}`;
  return "";
}
