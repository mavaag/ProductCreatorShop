"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { PROCESS_TYPE_LABELS } from "@/lib/types";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { AGENT_ONLINE_MS, MAKER_MODEL_COLUMNS, MakerAgent, MakerDoc, MakerJob, MakerModel, MakerPick, MakerWooLink, applyDocToProduct, canSplit, canSplitManually, createProductFromDoc, licenseWarning, shopProductId, TECHNIQUE_LABELS, Technique, techniqueLabel, techniqueOf } from "@/lib/maker";

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

const KIND_COLORS: Record<string, string> = {
  Lasercut: "#ff5a5a", "3D-Print": "var(--cyan)", resin: "#3dffc5", "UV-Print": "#c77dff", Engraving: "#ffb347", Sublimation: "#ff6fb5",
};
const PAGE_SIZE = 120;

/** Haalt alle rijen op in blokken van 1000 (PostgREST geeft er standaard maximaal 1000 per keer). */
async function fetchAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order(orderBy).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export default function CatalogPage() {
  const ready = useAuthGuard();
  const [models, setModels] = useState<MakerModel[]>([]);
  const [picks, setPicks] = useState<Map<string, MakerPick>>(new Map());
  const [links, setLinks] = useState<Map<string, MakerWooLink>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("all");
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);
  const [onlyTrademark, setOnlyTrademark] = useState(false);
  const [onlyBundles, setOnlyBundles] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobsKey, setJobsKey] = useState(0);
  // modellen waarvoor al een opsplits-opdracht loopt of die de agent als "één model" terugstuurde: geen knop meer
  const [splitDone, setSplitDone] = useState<Set<string>>(new Set());
  // tab "Klaar om aan te maken": welke modellen je nu als product wil aanmaken (niet bewaard)
  const [toMake, setToMake] = useState<Set<string>>(new Set());
  // per model zelf gekozen WooCommerce-categorie (anders de voorgestelde uit het document); geldt bij "Maak product"
  const [categoryChoice, setCategoryChoice] = useState<Map<string, string>>(new Map());
  const [wcCategories, setWcCategories] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [m, p, l] = await Promise.all([
        fetchAll<MakerModel>("maker_models", MAKER_MODEL_COLUMNS, "id"),
        fetchAll<MakerPick>("maker_picks", "model_id, product_id, created_at", "model_id"),
        fetchAll<MakerWooLink>("maker_woo_links", "model_id, woo_product_id, woo_name, woo_permalink", "model_id"),
      ]);
      setModels(m.sort((a, b) => a.title.localeCompare(b.title)));
      // /catalog?model=<id> (label "Catalogus" op de productenlijst): dat model meteen openen
      const want = new URLSearchParams(window.location.search).get("model");
      if (want && m.some((x) => x.id === want)) setOpenId(want);
      setPicks(new Map(p.map((x) => [x.model_id, x])));
      setLinks(new Map(l.map((x) => [x.model_id, x])));
      const { data: splits } = await supabase.from("maker_jobs").select("model_ids, status, results").eq("kind", "split");
      setSplitDone(new Set((splits ?? []).flatMap((j) => (j.model_ids as string[]).filter((id) =>
        j.status === "queued" || j.status === "running" || (j.results as Record<string, { status: string }> | null)?.[id]?.status === "skipped"))));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (ready) { load(); loadWooCategories(); }
  }, [ready]);

  async function loadWooCategories() {
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/woocommerce/categories", { headers: { Authorization: `Bearer ${session.session?.access_token}` } });
      if (res.ok) setWcCategories((await res.json()).categories ?? []);
    } catch {
      // geen lijst: je kan de categorie nog altijd zelf typen
    }
  }

  useEffect(() => setShown(PAGE_SIZE), [stage, kind, category, search, onlyReady, onlyTrademark, onlyBundles]);

  function stageOf(m: MakerModel): Exclude<Stage, "all" | "picked"> | null {
    const pick = picks.get(m.id);
    if (pick?.product_id) return "created";
    if (shopProductId(m, links.get(m.id))) return "shop";
    if (m.has_doc) return "ready";
    return pick ? "doc" : null;
  }

  const titles = useMemo(() => new Map(models.map((m) => [m.id, m.title])), [models]);
  const categories = useMemo(
    () => Array.from(new Set(models.filter((m) => !kind || techniqueOf(m) === kind).map((m) => m.category || "(geen)"))).sort(),
    [models, kind]
  );

  /** In de shop: vanuit de Catalogus aangemaakt ("created") of gekoppeld aan / herkend als een bestaand shopproduct ("shop"). */
  const inShop = (s: Stage | null) => s === "created" || s === "shop";

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { all: models.length, picked: picks.size, doc: 0, ready: 0, created: 0, shop: 0 };
    for (const m of models) {
      const s = stageOf(m);
      if (s) c[s]++;
      if (s === "created") c.shop++;   // "Al in de shop" = alles wat in de shop zit: zelf gemaakt én gekoppeld
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, picks, links]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (kind && techniqueOf(m) !== kind) return false;
      if (category && (m.category || "(geen)") !== category) return false;
      if (onlyReady && (m.kind !== "Lasercut" || m.laser_ready.length === 0)) return false;   // snijklaar = enkel lasermodellen met platen
      if (onlyTrademark && !m.is_trademark) return false;
      if (onlyBundles && !canSplit(m)) return false;
      if (stage === "picked" && !picks.has(m.id)) return false;
      if (stage === "shop" ? !inShop(stageOf(m)) : stage !== "all" && stage !== "picked" && stageOf(m) !== stage) return false;
      if (q && !`${m.title} ${m.collection} ${m.category} ${m.path}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, picks, links, stage, kind, category, search, onlyReady, onlyTrademark, onlyBundles]);

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

  /** Bundel (map met veel losse modellen) door de agent laten opsplitsen in één submap per model. */
  async function splitBundle(m: MakerModel) {
    const msg = `"${m.title}" door de agent laten opsplitsen? Hij kopieert de bestanden per model naar een eigen submap ` +
      "(er wordt niets verplaatst of verwijderd). Daarna verschijnt elk model als apart kaartje en verdwijnt dit kaartje.";
    if (!(await confirmDialog(msg, { confirmLabel: "Opsplitsen" }))) return;
    const { error } = await supabase.from("maker_jobs").insert({ kind: "split", model_ids: [m.id], note: "" });
    if (error) { setError(error.message); return; }
    setOpenId(null);
    setJobsKey((k) => k + 1);   // agentpaneel meteen herladen, zodat de opdracht er staat
    setSplitDone(new Set(splitDone).add(m.id));
  }

  async function makeProducts(ids: string[]) {
    if (ids.length === 0) return;
    if (ids.length > 1 && !(await confirmDialog(`${ids.length} producten aanmaken in de beheertool (als concept, nog niet gepubliceerd)?`))) return;
    const { data, error } = await supabase.from("maker_models").select("id, doc").in("id", ids);
    if (error) { setError(error.message); return; }
    const restricted = (data ?? []).filter((r) => licenseWarning(r.doc as MakerDoc));
    if (restricted.length > 0 && !(await confirmDialog(
      `Let op, licentie: ${restricted.map((r) => (r.doc as MakerDoc).product.name).join(", ")} ` +
      `${restricted.length === 1 ? "heeft" : "hebben"} een niet-commerciële licentie. Verkopen mag pas met toestemming van de ontwerper. Toch aanmaken?`,
      { confirmLabel: "Toch aanmaken", danger: true },
    ))) return;
    const failed: string[] = [];
    let lastId: string | null = null;
    for (const [i, row] of (data ?? []).entries()) {
      setBusy(`Product ${i + 1}/${data!.length} aanmaken...`);
      try {
        lastId = await createProductFromDoc(supabase, row.doc as MakerDoc, { categories: categoryChoice.get(row.id) });
      } catch (e: any) {
        failed.push(`${(row.doc as MakerDoc)?.product?.name ?? row.id}: ${e.message ?? e}`);
      }
    }
    setBusy(null);
    setToMake(new Set());
    await load();
    if (failed.length > 0) await alertDialog(`Niet gelukt:\n${failed.join("\n")}`);
    else if (ids.length === 1 && lastId) window.location.href = `/products/${lastId}`;
  }

  if (!ready) return null;

  const inReadyTab = stage === "ready";
  const chosen = models.filter((m) => toMake.has(m.id) && stageOf(m) === "ready").map((m) => m.id);

  function toggleMake(id: string) {
    const next = new Set(toMake);
    if (next.has(id)) next.delete(id); else next.add(id);
    setToMake(next);
  }

  return (
    <div>
      <h1>Catalogus</h1>
      <p className="sub">
        Alle modellen uit de MakerProducts-bibliotheek op de NAS. Vink aan wat je wil verkopen en laat de agent het
        verwerken; modellen met een volledig productdocument (beschrijving, foto&apos;s, varianten) verschijnen vanzelf bij
        &quot;Klaar om aan te maken&quot;, waar je kiest welke je als product aanmaakt.
      </p>

      {/* agent bovenaan: tabbladen, filters en kaartjes staan zo samen */}
      <AgentPanel
        key={jobsKey}
        // te verwerken: geselecteerd zonder document, en ook een aangevinkt model dat al aan een shopproduct gekoppeld
        // is maar nog geen document of (laser) geen snijklare platen heeft
        waiting={models.filter((m) => stageOf(m) === "doc" || (stageOf(m) === "shop" && picks.has(m.id)
          && (!m.has_doc || (m.kind === "Lasercut" && (m.laser_ready ?? []).length === 0))))}
        titles={titles}
        onJobFinished={load}
      />

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
            <option value="laser">Laser</option>
            <option value="fdm">3D-print FDM</option>
            <option value="resin">3D-print Resin</option>
            <option value="uv">UV-print</option>
            <option value="engraving">Gravure</option>
            <option value="sublimation">Sublimatie</option>
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
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }} title="Modellen met een merk of personage van iemand anders (bv. Marvel), om ze later snel terug te vinden">
          <input type="checkbox" style={{ width: "auto" }} checked={onlyTrademark} onChange={(e) => setOnlyTrademark(e.target.checked)} />
          Enkel merkfiguren
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }} title="Mappen met veel verschillende ontwerpen, die je kan laten opsplitsen in aparte modellen">
          <input type="checkbox" style={{ width: "auto" }} checked={onlyBundles} onChange={(e) => setOnlyBundles(e.target.checked)} />
          Enkel bundels
        </label>
      </div>

      {inReadyTab ? (
        <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ flex: 1, minWidth: 240 }}>
            Deze modellen hebben een volledig productdocument (tekst, foto&apos;s, varianten). Vink aan welke je als product
            wil aanmaken in de beheertool (als concept, nog niet gepubliceerd).
            {chosen.length > 0 && <> <b style={{ color: "var(--moss)" }}>{chosen.length}</b> aangevinkt.</>}
          </span>
          {chosen.length > 0 && (
            <button className="btn secondary" disabled={!!busy} onClick={() => setToMake(new Set())}>Selectie wissen</button>
          )}
          <button className="btn" disabled={!!busy || chosen.length === 0} onClick={() => makeProducts(chosen)}>
            Maak {chosen.length || ""} product{chosen.length === 1 ? "" : "en"}
          </button>
          {busy && <span className="muted">{busy}</span>}
        </div>
      ) : counts.ready > 0 && (
        <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ flex: 1, minWidth: 240 }}>
            <b style={{ color: "var(--moss)" }}>{counts.ready}</b> model{counts.ready === 1 ? "" : "len"} volledig klaar om als product aan te maken.
          </span>
          <button className="btn" onClick={() => setStage("ready")}>Bekijk en kies</button>
        </div>
      )}

      {error && <p className="warning">{error}</p>}

      <div className="prod-viewbar">
        <div className="prod-viewbar-left">
          {filtered.length > 0 && (
            <button className="btn secondary" type="button"
              onClick={inReadyTab ? () => setToMake(new Set([...toMake, ...filtered.map((m) => m.id)])) : selectAllFiltered}>
              Alles in deze lijst selecteren
            </button>
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
            const picked = inReadyTab ? toMake.has(m.id) : picks.has(m.id);
            return (
              <div
                key={m.id}
                className={`prod-card${picked ? " selected" : ""}`}
                style={{ "--prod-color": KIND_COLORS[m.technique === "resin" ? "resin" : m.kind] ?? "var(--cyan)" } as CSSProperties}
              >
                <button type="button" className="prod-thumb maker-thumb-btn" onClick={() => setOpenId(m.id)} aria-label={`Details van ${m.title}`}>
                  {m.thumb_url ? <img src={m.thumb_url} alt="" loading="lazy" /> : <div className="prod-thumb-empty">geen voorbeeld</div>}
                </button>
                <label className="prod-check" title={inReadyTab ? "Aanvinken om als product aan te maken" : "Selecteren (de agent maakt er een document voor)"}>
                  <input type="checkbox" style={{ width: "auto" }} aria-label={`Selecteer ${m.title}`} checked={picked}
                    onChange={() => (inReadyTab ? toggleMake(m.id) : togglePick(m))} />
                </label>
                <span className="prod-process">{techniqueLabel(m)}</span>
                <div className="prod-body">
                  <button type="button" className="prod-name maker-name-btn" onClick={() => setOpenId(m.id)}>{m.title}</button>
                  <div className="prod-sku">{[m.collection, m.category].filter(Boolean).join(" · ")}</div>
                  <div className="prod-cats">
                    {m.kind === "Lasercut" && m.laser_ready.length > 0 && <span className="pill cyan">Snijklaar</span>}
                    {m.has_doc && <span className="pill cyan">Document</span>}
                    {canSplit(m) && !m.has_doc && (splitDone.has(m.id) ? (
                      <span className="pill" title="De agent splitst deze bundel op, of gaf aan dat het één model is">{BUNDLE_ICON} Bundel</span>
                    ) : (
                      <button type="button" className="pill maker-bundle-pill" onClick={() => splitBundle(m)}
                        title={`Bundel met ~${m.designs} verschillende ontwerpen. Klik om de agent ze in aparte modellen te laten opsplitsen.`}>
                        {BUNDLE_ICON} Bundel · ~{m.designs}
                      </button>
                    ))}
                    {m.is_trademark && <span className="pill" style={{ color: "var(--yellow)", borderColor: "var(--yellow)" }} title="Merk/personage van iemand anders">Merk</span>}
                    {shopProductId(m, links.get(m.id)) && <span className="pill">In shop #{shopProductId(m, links.get(m.id))}</span>}
                  </div>
                </div>
                <div className="prod-foot">
                  <span className={`prod-status${inShop(s) || s === "ready" ? " on" : ""}`}>
                    <i />
                    {s === "created" ? "Product gemaakt" : s === "ready" ? "Klaar om aan te maken" : s === "doc" ? "Wacht op document" : s === "shop" ? "Gekoppeld aan shopproduct" : "Niet geselecteerd"}
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
          onSplit={() => splitBundle(models.find((m) => m.id === openId)!)}
          splittable={canSplitManually(models.find((m) => m.id === openId)!) && !splitDone.has(openId)}
          link={links.get(openId)}
          onLinked={load}
          category={categoryChoice.get(openId)}
          wcCategories={wcCategories}
          onCategory={(c) => {
            const next = new Map(categoryChoice);
            if (c === null) next.delete(openId); else next.set(openId, c);
            setCategoryChoice(next);
          }}
        />
      )}
    </div>
  );
}

const JOB_STATUS_LABELS: Record<MakerJob["status"], string> = {
  queued: "In de wachtrij",
  running: "Bezig",
  done: "Klaar",
  failed: "Mislukt",
  cancelled: "Geannuleerd",
};

/**
 * Opdrachten voor de MakerProducts-agent (Docker-container op de NAS, zie maker-agent/): geselecteerde modellen
 * zonder document laten verwerken -- lasermodellen eerst 3 mm-platen voor de xTool M2 + LaserPecker LX2, dan het
 * productdocument. De agent pikt de opdracht op, schrijft zijn voortgang terug in maker_jobs en publiceert zelf.
 */
function AgentPanel({ waiting, titles, onJobFinished }: {
  waiting: MakerModel[];
  titles: Map<string, string>;
  onJobFinished: () => void;
}) {
  const [jobs, setJobs] = useState<MakerJob[]>([]);
  const [agent, setAgent] = useState<MakerAgent | null>(null);
  const [note, setNote] = useState("");
  const [inboxNote, setInboxNote] = useState("");
  const [thenProcess, setThenProcess] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0); // herteken "x min geleden"

  async function loadJobs() {
    const [{ data: j, error: e1 }, { data: a }] = await Promise.all([
      supabase.from("maker_jobs").select("*").order("created_at", { ascending: false }).limit(5),
      supabase.from("maker_agent").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (e1) { setError(e1.message); return; }
    const next = (j ?? []) as MakerJob[];
    setJobs((prev) => {
      // een opdracht die net afgerond is -> modellen opnieuw laden zodat de nieuwe documenten verschijnen
      const finished = next.some((x) => (x.status === "done" || x.status === "failed") &&
        prev.some((p) => p.id === x.id && (p.status === "running" || p.status === "queued")));
      if (finished) setTimeout(onJobFinished, 0);
      return next;
    });
    setAgent((a as MakerAgent | null) ?? null);
    setError(null);
  }

  const active = jobs.some((j) => j.status === "queued" || j.status === "running") || (agent?.inbox ?? []).some((i) => !i.ready);
  useEffect(() => {
    loadJobs();
    const t = setInterval(() => { loadJobs(); setTick((x) => x + 1); }, active ? 15000 : 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const inJob = new Set(jobs.filter((j) => j.status === "queued" || j.status === "running").flatMap((j) => j.model_ids));
  const todo = waiting.filter((m) => !inJob.has(m.id));
  const needPlates = todo.filter((m) => m.kind === "Lasercut" && (m.laser_ready ?? []).length === 0).length;
  const online = !!agent?.seen_at && Date.now() - new Date(agent.seen_at).getTime() < AGENT_ONLINE_MS;
  const inInboxJob = new Set(jobs.filter((j) => j.status === "queued" || j.status === "running").flatMap((j) => j.items ?? []));
  const inbox = (agent?.inbox ?? []).filter((i) => !inInboxJob.has(i.name));
  const inboxReady = inbox.filter((i) => i.ready);

  async function queueInbox() {
    const msg = `${inboxReady.length} item${inboxReady.length === 1 ? "" : "s"} uit de Inbox in de bibliotheek laten zetten?` +
      (thenProcess ? " Daarna maakt de agent meteen de productdocumenten voor de nieuwe modellen (en snijklare platen voor lasermodellen)." : "") +
      " Wat lukt, gaat daarna naar _Inbox/_verwerkt.";
    if (!(await confirmDialog(msg, { confirmLabel: "Verwerken" }))) return;
    const { error } = await supabase.from("maker_jobs").insert({
      kind: "inbox", model_ids: [], items: inboxReady.map((i) => i.name), note: inboxNote.trim(), then_process: thenProcess,
    });
    if (error) { setError(error.message); return; }
    setInboxNote("");
    loadJobs();
  }

  async function queue() {
    const msg = `${todo.length} model${todo.length === 1 ? "" : "len"} door de agent laten verwerken?` +
      (needPlates > 0 ? ` Voor ${needPlates} lasermodel${needPlates === 1 ? "" : "len"} worden eerst 3 mm-platen gemaakt (xTool M2 + LaserPecker LX2).` : "") +
      " Dit kan een tijd duren en gebruikt je Claude-abonnement.";
    if (!(await confirmDialog(msg, { confirmLabel: "Verwerken" }))) return;
    const { error } = await supabase.from("maker_jobs").insert({ model_ids: todo.map((m) => m.id), note: note.trim() });
    if (error) { setError(error.message); return; }
    setNote("");
    loadJobs();
  }

  async function cancel(job: MakerJob) {
    const { error } = await supabase.from("maker_jobs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "queued");
    if (error) setError(error.message);
    loadJobs();
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Agent</h2>
        <span className={`prod-status${online ? " on" : ""}`}>
          <i />
          {online
            ? `Agent actief${agent?.status ? ` -- ${agent.status}` : ""}`
            : agent?.seen_at
              ? `Agent niet actief (laatst gezien ${timeAgo(agent.seen_at)})`
              : "Agent nog nooit gezien -- start de maker-agent container op de NAS"}
        </span>
      </div>

      {todo.length === 0 && jobs.length === 0 && (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Vink modellen aan die nog geen productdocument hebben; dan kan de agent ze hier voor je verwerken
          (3 mm-platen voor lasermodellen, shoptekst, varianten en foto&apos;s).
        </p>
      )}

      {todo.length > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
          <p className="muted" style={{ flex: "1 1 100%", margin: 0 }}>
            <b style={{ color: "var(--yellow)" }}>{todo.length}</b> geselecteerd zonder productdocument of platen
            {needPlates > 0 && <> (waarvan <b style={{ color: "var(--yellow)" }}>{needPlates}</b> lasermodellen zonder snijklare platen)</>}.
            De agent maakt de platen (3 mm, xTool M2 + LaserPecker LX2), de shoptekst, de varianten en de foto&apos;s.
          </p>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label>Extra instructies voor de agent (optioneel)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bv. ook een 6 mm-versie maken van de lampen" />
          </div>
          <button className="btn" onClick={queue}>Laat de agent dit verwerken ({todo.length})</button>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--line, #2a2f55)", marginTop: 14, paddingTop: 12 }}>
        <h3 style={{ margin: "0 0 6px" }}>Inbox</h3>
        <p className="muted" style={{ margin: 0 }}>
          Nieuwe modellen (bestanden, mappen, zip/rar) zet je in <span className="mono">\\NASMAT\MakerProducts\_Inbox</span>,
          bij voorkeur in de juiste techniekmap: <span className="mono">FDM</span>, <span className="mono">Resin</span> of{" "}
          <span className="mono">Laser</span>. Dan weet de agent meteen hoe het geproduceerd wordt; los in de Inbox beslist hij zelf.
          De agent zet ze op de juiste plek in de bibliotheek; wat lukt, gaat naar <span className="mono">_Inbox\_verwerkt</span>.
          {agent?.inbox_info && <> {agent.inbox_info}.</>}
        </p>
        {inbox.length === 0 ? (
          <p className="muted" style={{ margin: "8px 0 0" }}>{agent?.inbox ? "De Inbox is leeg." : "Nog geen gegevens van de agent over de Inbox."}</p>
        ) : (
          <>
            <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
              {inbox.map((i) => (
                <li key={i.name}>
                  <span className="mono">{i.name}</span>{" "}
                  {i.technique && <span className="pill cyan" style={{ marginRight: 6 }}>{TECHNIQUE_LABELS[i.technique as Technique] ?? i.technique}</span>}
                  {i.wall_art && <span className="pill cyan" style={{ marginRight: 6 }} title="De agent maakt er meteen mockups van met de Wall Art-templates">Wall Art + mockups</span>}
                  <span className="muted">
                    ({i.kind === "folder" ? `map, ${i.files} bestand${i.files === 1 ? "" : "en"}` : "bestand"}, {formatSize(i.size)})
                    {!i.ready && " -- wordt nog gekopieerd..."}
                  </span>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label>Instructies voor de agent (optioneel)</label>
                <input value={inboxNote} onChange={(e) => setInboxNote(e.target.value)} placeholder="bv. dit zijn allemaal lampen van één ontwerper" />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }} title="Shoptekst, foto's en varianten; voor lasermodellen ook 3 mm-platen, voor resin de printerkeuze">
                <input type="checkbox" style={{ width: "auto" }} checked={thenProcess} onChange={(e) => setThenProcess(e.target.checked)} />
                Daarna meteen productdocumenten maken
              </label>
              <button className="btn" disabled={inboxReady.length === 0} onClick={queueInbox}>Inbox verwerken ({inboxReady.length})</button>
            </div>
          </>
        )}
      </div>

      {error && <p className="warning">{error}</p>}

      {jobs.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Opdracht</th><th>Status</th><th>Voortgang</th><th></th></tr></thead>
          <tbody>
            {jobs.map((j) => {
              const isInbox = j.kind === "inbox";
              const isSplit = j.kind === "split";
              const keys = isInbox ? (j.items ?? []) : j.model_ids;
              // inbox-opdracht: resultaten per inbox-item, plus eventueel per nieuw model (bij "daarna meteen verwerken")
              const extra = isInbox ? Object.keys(j.results ?? {}).filter((k) => !keys.includes(k)) : [];
              const res = keys.map((k) => j.results?.[k]).filter(Boolean) as { status: string }[];
              const ok = res.filter((r) => r.status === "ok").length;
              const bad = res.length - ok;
              return (
                <Fragment key={j.id}>
                  <tr>
                    <td className="mono">
                      {new Date(j.created_at).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                      {isInbox ? `Inbox, ${keys.length} item${keys.length === 1 ? "" : "s"}` : isSplit ? "Bundel opsplitsen" : `${keys.length} model${keys.length === 1 ? "" : "len"}`}
                    </td>
                    <td style={{ color: j.status === "failed" ? "var(--rust)" : j.status === "done" ? "var(--moss)" : j.status === "running" ? "var(--cyan)" : undefined }}>
                      {JOB_STATUS_LABELS[j.status]}
                    </td>
                    <td className="muted">
                      {res.length > 0 && <>{ok} gelukt{bad > 0 && <>, <span style={{ color: "var(--rust)" }}>{bad} niet</span></>} · </>}
                      {j.progress}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn secondary" onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? "Verberg" : "Details"}</button>
                      {j.status === "queued" && <button className="btn danger" style={{ marginLeft: 6 }} onClick={() => cancel(j)}>Annuleren</button>}
                    </td>
                  </tr>
                  {open === j.id && (
                    <tr>
                      <td colSpan={4}>
                        {j.note && <p className="muted" style={{ marginTop: 0 }}>Instructies: {j.note}</p>}
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {[...keys, ...extra].map((id) => {
                            const r = j.results?.[id];
                            return (
                              <li key={id}>
                                {titles.get(id) ?? id}{" "}
                                <span style={{ color: !r ? "var(--ink-faint)" : r.status === "ok" ? "var(--moss)" : "var(--rust)" }}>
                                  {!r ? "-- nog niet verwerkt" : r.status === "ok" ? "-- gelukt" : r.status === "skipped" ? "-- overgeslagen" : "-- mislukt"}
                                </span>
                                {r?.note && <span className="muted"> ({r.note})</span>}
                              </li>
                            );
                          })}
                        </ul>
                        {j.log_tail && (
                          <details>
                            <summary className="muted">Logboek van de agent</summary>
                            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 280, overflow: "auto" }}>{j.log_tail}</pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Icoon voor een bundel: gestapelde bladen. */
const BUNDLE_ICON = (
  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{ verticalAlign: "-1px" }}>
    <rect x="1.5" y="5.5" width="9" height="9" /><path d="M4.5 3.5h8v8M7 1.5h7.5V9" />
  </svg>
);

type WooHit = { id: number; name: string; sku: string; status: string; permalink: string; image: string | null };

/** Producten in WooCommerce zoeken op naam of SKU; een getal = het product met dat id. */
async function searchWoo(q: string): Promise<WooHit[]> {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch(`/api/woocommerce/products?search=${encodeURIComponent(q.trim())}`, {
    headers: { Authorization: `Bearer ${session.session?.access_token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body.products;
}

/**
 * Koppeling van een catalogusmodel aan een bestaand WooCommerce-product. Jouw koppeling (maker_woo_links) gaat voor op
 * de suggestie van de agent (doc.woo_existing); "Klopt niet" bewaart een koppeling zonder product.
 * Met een document kun je het overnemen in dat shopproduct (applyDocToProduct): beschrijving, foto's en varianten.
 */
function ShopLink({ model, doc, link, onLinked, category }: { model: MakerModel; doc: MakerDoc | null; link: MakerWooLink | undefined; onLinked: () => void; category: string | undefined }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WooHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // product in de beheertool bij het gekoppelde shopproduct (zelfde SKU); null = (nog) niet geïmporteerd
  const [target, setTarget] = useState<{ id: string; name: string; sku: string } | null | undefined>(undefined);
  const [replaceName, setReplaceName] = useState(false);
  const [applying, setApplying] = useState(false);
  const suggestion = doc?.woo_existing ?? null;
  const linkedId = shopProductId(model, link);
  // vermoedens van de agent in de notities, bv. "Possibly already in the shop as #1212 (...)"
  const guesses = Array.from(new Set((doc?.notes_internal ?? []).flatMap((n) =>
    /in the shop/i.test(n) ? Array.from(n.matchAll(/#(\d+)/g), (x) => x[1]) : [])));

  useEffect(() => {
    setTarget(undefined);
    if (!doc || !link?.woo_product_id) return;
    let stale = false;
    searchWoo(String(link.woo_product_id)).then(async (rows) => {
      const sku = rows[0]?.sku;
      const { data } = sku ? await supabase.from("products").select("id, name, sku").eq("sku", sku).maybeSingle() : { data: null };
      if (!stale) setTarget(data ?? null);
    }).catch((e) => !stale && setError(e.message ?? String(e)));
    return () => { stale = true; };
  }, [doc, link?.woo_product_id]);

  async function search(q = query) {
    if (!q.trim()) return;
    setSearching(true); setError(null);
    try {
      setHits(await searchWoo(q));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
    setSearching(false);
  }

  async function apply() {
    if (!doc || !target) return;
    const variants = doc.variations.map((v) => Object.values(v.attributes).join(" / ")).filter(Boolean);
    const msg = `Het document overnemen in "${target.name}" (SKU ${target.sku})?

`
      + `Beschrijving, korte beschrijving, foto's en categorie worden vervangen`
      + (replaceName ? `, de naam wordt "${doc.product.name}"` : `; de naam blijft`) + `.
`
      + `De varianten worden vervangen door: ${variants.join(", ") || "één variant"} (prijzen daarna zelf invullen).

`
      + `In de shop verandert pas iets als je daarna synchroniseert; het blijft hetzelfde WooCommerce-product (zelfde URL en reviews).`;
    if (!(await confirmDialog(msg, { confirmLabel: "Overnemen" }))) return;
    setApplying(true); setError(null);
    try {
      await applyDocToProduct(supabase, doc, target.id, { replaceName, categories: category });
      onLinked();
      if (await confirmDialog("Overgenomen. Nu de prijzen invullen op de productpagina?", { confirmLabel: "Open product" })) {
        window.location.href = `/products/${target.id}`;
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
    setApplying(false);
  }

  async function save(woo: { id: number; name: string; permalink: string } | null) {
    const { error } = await supabase.from("maker_woo_links").upsert({
      model_id: model.id, woo_product_id: woo?.id ?? null, woo_name: woo?.name ?? "", woo_permalink: woo?.permalink ?? "",
    });
    if (error) { setError(error.message); return; }
    setHits(null); setQuery("");
    onLinked();
  }

  async function reset() {
    const { error } = await supabase.from("maker_woo_links").delete().eq("model_id", model.id);
    if (error) { setError(error.message); return; }
    onLinked();
  }

  return (
    <details open={!!linkedId || !!suggestion || guesses.length > 0} style={{ marginTop: 12 }}>
      <summary>Koppeling met de shop{linkedId ? ` -- #${linkedId}` : ""}</summary>
      {linkedId ? (
        <p style={{ margin: "8px 0" }}>
          {link ? "Gekoppeld aan" : "De agent vond dit product in de shop:"}{" "}
          {(link?.woo_permalink || null) ? (
            <a href={link!.woo_permalink} target="_blank" rel="noreferrer">#{linkedId} {link!.woo_name}</a>
          ) : (
            <b>#{linkedId} {link?.woo_name || suggestion?.name}</b>
          )}
          . Je maakt er dus geen nieuw product van{doc && link ? "" : "; importeer het via Producten > Import als je het in de beheertool wil"}.{" "}
          {link ? (
            <button type="button" className="btn secondary" onClick={reset}>Ontkoppelen</button>
          ) : (
            <>
              <button type="button" className="btn secondary" onClick={() => save({ id: suggestion!.id, name: suggestion!.name, permalink: "" })}>Klopt</button>{" "}
              <button type="button" className="btn secondary" onClick={() => save(null)}>Klopt niet</button>
            </>
          )}
        </p>
      ) : null}
      {linkedId && doc && link && (
        target === undefined ? (
          <p className="muted" style={{ margin: "0 0 8px" }}>Product in de beheertool zoeken...</p>
        ) : target === null ? (
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Dit shopproduct staat nog niet in de beheertool. Importeer het eerst via Producten &gt; Import; daarna kun je hier
            de beschrijving, foto&apos;s en varianten uit het document overnemen.
          </p>
        ) : (
          <div style={{ margin: "0 0 8px" }}>
            <p style={{ margin: "0 0 6px" }}>
              In de beheertool: <Link href={`/products/${target.id}`}>{target.name}</Link> <span className="muted">({target.sku})</span>.
              Neem de beschrijving, foto&apos;s en varianten van dit document over in dat product; de sync werkt daarna het
              bestaande shopproduct bij (zelfde URL, reviews en bestellingen).
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={applying} onClick={apply}>{applying ? "Bezig..." : "Overnemen in shopproduct"}</button>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }} title={`Anders blijft de naam uit de shop staan (beter voor bestaande links en zoekmachines)`}>
                <input type="checkbox" style={{ width: "auto" }} checked={replaceName} onChange={(e) => setReplaceName(e.target.checked)} />
                Naam ook vervangen door &quot;{doc.product.name}&quot;
              </label>
            </div>
          </div>
        )
      )}
      {!linkedId && (
        <>
          <p className="muted" style={{ margin: "8px 0" }}>
            {link && suggestion
              ? <>Je gaf aan dat dit model niet in de shop staat (de agent stelde #{suggestion.id} voor). <button type="button" className="maker-name-btn" style={{ textDecoration: "underline" }} onClick={reset}>Terugzetten</button></>
              : "Staat dit model al in je shop? Zoek het product en koppel het, dan maak je er geen dubbel product van."}
          </p>
          {!link && guesses.length > 0 && (
            <p style={{ margin: "0 0 8px", color: "var(--yellow)" }}>
              De agent vermoedt dat dit model al in de shop staat:{" "}
              {guesses.map((g) => (
                <button key={g} type="button" className="btn secondary" style={{ marginRight: 6 }} onClick={() => { setQuery(g); search(g); }}>Bekijk #{g}</button>
              ))}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="naam, SKU of product-id in de shop" />
            <button type="button" className="btn secondary" disabled={searching || !query.trim()} onClick={() => search()}>{searching ? "Zoeken..." : "Zoeken"}</button>
          </div>
          {hits && (hits.length === 0 ? <p className="muted">Niets gevonden.</p> : (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
              {hits.map((h) => (
                <li key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  {h.image ? <img src={h.image} alt="" style={{ width: 40, height: 40, objectFit: "cover" }} /> : <span style={{ width: 40 }} />}
                  <span style={{ flex: 1 }}>
                    <a href={h.permalink} target="_blank" rel="noreferrer">#{h.id} {h.name}</a>{" "}
                    <span className="muted">{h.sku}{h.status !== "publish" ? ` · ${h.status}` : ""}</span>
                  </span>
                  <button type="button" className="btn" onClick={() => save(h)}>Koppel</button>
                </li>
              ))}
            </ul>
          ))}
        </>
      )}
      {error && <p className="warning">{error}</p>}
    </details>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "zonet";
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} u geleden` : `${Math.round(h / 24)} dagen geleden`;
}

function ModelDetail({ model, pick, busy, onClose, onToggle, onMake, onSplit, splittable, link, onLinked, category, wcCategories, onCategory }: {
  model: MakerModel;
  pick: MakerPick | null;
  busy: boolean;
  onClose: () => void;
  onToggle: () => void;
  onMake: () => void;
  onSplit: () => void;
  /** "Bundel opsplitsen" tonen: veel verschillende ontwerpen, nog niet opgesplitst */
  splittable: boolean;
  link: MakerWooLink | undefined;
  onLinked: () => void;
  /** zelf gekozen categorie; undefined = de voorgestelde uit het document */
  category: string | undefined;
  wcCategories: string[];
  onCategory: (c: string | null) => void;
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

  const shopId = shopProductId(model, link);
  const images = [...(doc?.product.image_urls ?? []), ...(model.thumb_url && !(doc?.product.image_urls ?? []).length ? [model.thumb_url] : [])];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal-panel maker-detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={model.title}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 style={{ marginTop: 0 }}>{doc?.product.name ?? model.title}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {techniqueLabel(model)} · {[model.collection, model.category, model.bundle && `uit bundel ${model.bundle}`].filter(Boolean).join(" · ")} · <span className="mono">{model.path}</span>
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
                Nog geen productdocument. {pick ? "Dit model is geselecteerd -- laat het door de agent verwerken (knop bovenaan de pagina)." : "Selecteer dit model om er een document voor te laten maken."}
              </p>
            ) : (
              <>
                {licenseWarning(doc) && (
                  <p className="warning" style={{ marginTop: 0 }}>
                    <b>Licentie: niet commercieel.</b> {licenseWarning(doc)} Verkopen mag pas met toestemming van de ontwerper.
                  </p>
                )}
                <div className="prod-cats" style={{ marginTop: 0 }}>
                  <span className="pill cyan">{PROCESS_TYPE_LABELS[doc.product.process_type]}</span>
                  <span className="pill">{category ?? doc.product.categories}</span>
                  <span className="pill">{doc.product.type === "simple" ? "simpel" : `${doc.variations.length} varianten`}</span>
                  <span className="pill mono">{doc.product.sku_base}</span>
                </div>
                {!pick?.product_id && !shopId && (
                  <div style={{ marginBottom: 12 }}>
                    <label>WooCommerce-categorie</label>
                    <input
                      list="maker-wc-categories"
                      value={category ?? doc.product.categories}
                      onChange={(e) => onCategory(e.target.value === doc.product.categories ? null : e.target.value)}
                      placeholder="bv. 3D Printing > Figurines"
                    />
                    <datalist id="maker-wc-categories">
                      {wcCategories.map((c) => <option key={c} value={c} />)}
                    </datalist>
                    <span className="muted">
                      {category === undefined
                        ? "Voorgesteld door de agent. Pas aan als het product ergens anders moet staan; geldt bij Maak product."
                        : <>Zelf gekozen (voorgesteld: {doc.product.categories}).{" "}
                            <button type="button" className="maker-name-btn" style={{ textDecoration: "underline" }} onClick={() => onCategory(null)}>Terugzetten</button>
                            {category.trim() && !wcCategories.includes(category.trim()) && wcCategories.length > 0 &&
                              <span style={{ color: "var(--yellow)" }}> Deze categorie bestaat nog niet in WooCommerce; de sync maakt ze aan.</span>}
                          </>}
                    </span>
                  </div>
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

            <ShopLink model={model} doc={doc} link={link} onLinked={onLinked} category={category} />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {pick?.product_id ? (
                <Link className="btn" href={`/products/${pick.product_id}`}>Open product</Link>
              ) : (
                <>
                  <button className="btn" disabled={busy || !doc || !!shopId} title={shopId ? "Staat al in de shop -- ontkoppel eerst als je toch een nieuw product wil" : undefined} onClick={onMake}>Maak product</button>
                  {!doc && <button className="btn secondary" onClick={onToggle}>{pick ? "Uit selectie halen" : "Selecteren"}</button>}
                  {!doc && splittable && (
                    <button className="btn secondary" onClick={onSplit} title="Map met verschillende modellen (bv. 25 klokken)? Laat de agent ze in aparte submappen zetten; is het toch één model, dan laat hij het zo.">
                      Bundel opsplitsen
                    </button>
                  )}
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
