"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { PROCESS_TYPE_LABELS } from "@/lib/types";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { AGENT_ONLINE_MS, MAKER_MODEL_COLUMNS, MakerAgent, MakerDoc, MakerJob, MakerModel, MakerPick, createProductFromDoc, licenseWarning } from "@/lib/maker";

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
  // tab "Klaar om aan te maken": welke modellen je nu als product wil aanmaken (niet bewaard)
  const [toMake, setToMake] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        fetchAll<MakerModel>("maker_models", MAKER_MODEL_COLUMNS, "id"),
        fetchAll<MakerPick>("maker_picks", "model_id, product_id, created_at", "model_id"),
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
    if (m.has_doc) return "ready";
    return pick ? "doc" : null;
  }

  const titles = useMemo(() => new Map(models.map((m) => [m.id, m.title])), [models]);
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
        lastId = await createProductFromDoc(supabase, row.doc as MakerDoc);
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

      <AgentPanel
        waiting={models.filter((m) => stageOf(m) === "doc")}
        titles={titles}
        onJobFinished={load}
      />

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
                style={{ "--prod-color": KIND_COLORS[m.kind] ?? "var(--cyan)" } as CSSProperties}
              >
                <button type="button" className="prod-thumb maker-thumb-btn" onClick={() => setOpenId(m.id)} aria-label={`Details van ${m.title}`}>
                  {m.thumb_url ? <img src={m.thumb_url} alt="" loading="lazy" /> : <div className="prod-thumb-empty">geen voorbeeld</div>}
                </button>
                <label className="prod-check" title={inReadyTab ? "Aanvinken om als product aan te maken" : "Selecteren (de agent maakt er een document voor)"}>
                  <input type="checkbox" style={{ width: "auto" }} aria-label={`Selecteer ${m.title}`} checked={picked}
                    onChange={() => (inReadyTab ? toggleMake(m.id) : togglePick(m))} />
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
      (thenProcess ? " Daarna maakt de agent meteen platen en productdocumenten voor de nieuwe modellen." : "") +
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
            <b style={{ color: "var(--yellow)" }}>{todo.length}</b> geselecteerd zonder productdocument
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
          Nieuwe modellen (bestanden, mappen, zip/rar) zet je in <span className="mono">\\NASMAT\MakerProducts\_Inbox</span>.
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
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={thenProcess} onChange={(e) => setThenProcess(e.target.checked)} />
                Daarna meteen platen + documenten maken
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
                      {isInbox ? `Inbox, ${keys.length} item${keys.length === 1 ? "" : "s"}` : `${keys.length} model${keys.length === 1 ? "" : "len"}`}
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
                  {!doc && <button className="btn secondary" onClick={onToggle}>{pick ? "Uit selectie halen" : "Selecteren"}</button>}
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
