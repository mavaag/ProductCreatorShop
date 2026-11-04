"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { MakerJob } from "@/lib/maker";
import {
  License, LicenseModel, LicenseRefresh, ModelPick, PICK_LABELS, PLATFORM_LABELS, REFRESHABLE, categorize, firstImportTimes,
  ImportPayload, fetchViaExtension, formatDate, importModels, isNew, licenseState, parseImport, thumbUrl,
} from "@/lib/licenses";

type Status = "" | ModelPick | "open" | "new" | "catalog" | "removed";
type Sort = "dl" | "new" | "old" | "tm" | "w";
const PAGE = 120;
const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",") + "k" : String(n));
const hm = (m: number | null) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)}u${String(m % 60).padStart(2, "0")}` : `${m} min`);

/** Alle rijen in blokken van 1000 (PostgREST geeft er standaard maximaal 1000 per keer). */
async function fetchModels(licenseId: string): Promise<LicenseModel[]> {
  const out: LicenseModel[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("license_models").select("*").eq("license_id", licenseId).order("source_id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as LicenseModel[]));
    if (!data || data.length < 1000) return out;
  }
}

export default function LicenseModelsPage() {
  const ready = useAuthGuard();
  const { id } = useParams<{ id: string }>();
  const [license, setLicense] = useState<License | null>(null);
  const [models, setModels] = useState<LicenseModel[]>([]);
  const [refreshes, setRefreshes] = useState<LicenseRefresh[]>([]);
  const [jobs, setJobs] = useState<MakerJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("");
  const [theme, setTheme] = useState("");
  const [typ, setTyp] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("dl");
  const [hideTm, setHideTm] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [noExtension, setNoExtension] = useState(false);

  async function load() {
    try {
      const { data: l, error: e1 } = await supabase.from("licenses").select("*").eq("id", id).maybeSingle();
      if (e1) throw e1;
      if (!l) { setError("Deze licentie bestaat niet (meer)."); return; }
      setLicense(l as License);
      setModels(await fetchModels(id));
      const { data: r } = await supabase.from("license_refreshes").select("*").eq("license_id", id).order("created_at", { ascending: false }).limit(5);
      setRefreshes((r ?? []) as LicenseRefresh[]);
      loadJobs();
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }
  async function loadJobs(): Promise<MakerJob[]> {
    const { data } = await supabase.from("maker_jobs").select("*").eq("kind", "license").contains("items", [id]).order("created_at", { ascending: false }).limit(3);
    const js = (data ?? []) as MakerJob[];
    setJobs(js);
    return js;
  }
  useEffect(() => {
    if (!ready || !id) return;
    load();
    // vanuit de bladwijzer op MakerWorld (/licenses/import): plakvak meteen open
    if (new URLSearchParams(window.location.search).get("paste") === "1") setPasteOpen(true);
  }, [ready, id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setShown(PAGE), [status, theme, typ, search, sort, hideTm]);
  // een lopende opdracht volgen tot ze klaar is
  useEffect(() => {
    if (!jobs.some((j) => j.status === "queued" || j.status === "running")) return;
    const t = setInterval(async () => {
      const js = await loadJobs();
      if (!js.some((j) => j.status === "queued" || j.status === "running")) load();   // klaar: koppelingen met de Catalogus tonen
    }, 15000);
    return () => clearInterval(t);
  }, [jobs]);   // eslint-disable-line react-hooks/exhaustive-deps

  const firstImport = useMemo(() => firstImportTimes(models).get(id), [models, id]);
  const enriched = useMemo(() => models.map((m) => ({ ...m, ...categorize(m.title), fresh: isNew(m, firstImport) })), [models, firstImport]);
  const themes = useMemo(() => Array.from(new Set(enriched.map((m) => m.theme))).sort(), [enriched]);
  const types = useMemo(() => Array.from(new Set(enriched.map((m) => m.type))).sort(), [enriched]);

  const counts = useMemo(() => {
    const c = { all: 0, yes: 0, maybe: 0, no: 0, open: 0, new: 0, catalog: 0, removed: 0 };
    for (const m of enriched) {
      if (m.removed_at) { c.removed++; continue; }
      c.all++;
      if (m.pick) c[m.pick]++; else c.open++;
      if (m.fresh) c.new++;
      if (m.maker_model_id) c.catalog++;
    }
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = enriched.filter((m) => {
      if (status === "removed") { if (!m.removed_at) return false; }
      else {
        if (m.removed_at) return false;
        if (status === "open" && m.pick) return false;
        if ((status === "yes" || status === "maybe" || status === "no") && m.pick !== status) return false;
        if (status === "new" && !m.fresh) return false;
        if (status === "catalog" && !m.maker_model_id) return false;
      }
      if (theme && m.theme !== theme) return false;
      if (typ && m.type !== typ) return false;
      if (hideTm && m.trademark) return false;
      if (q && !m.title.toLowerCase().includes(q) && !m.tags.some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
    const cmp: Record<Sort, (a: LicenseModel, b: LicenseModel) => number> = {
      dl: (a, b) => b.downloads - a.downloads,
      new: (a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""),
      old: (a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""),
      tm: (a, b) => (a.print_minutes ?? 1e9) - (b.print_minutes ?? 1e9),
      w: (a, b) => (a.weight_g ?? 1e9) - (b.weight_g ?? 1e9),
    };
    return list.sort(cmp[sort]);
  }, [enriched, status, theme, typ, search, sort, hideTm]);

  async function setPick(m: LicenseModel, pick: ModelPick | null) {
    const prev = m.pick;
    setModels((all) => all.map((x) => (x.source_id === m.source_id ? { ...x, pick } : x)));
    const { error } = await supabase.from("license_models").update({ pick, picked_at: pick ? new Date().toISOString() : null })
      .eq("license_id", m.license_id).eq("source_id", m.source_id);
    if (error) {
      setModels((all) => all.map((x) => (x.source_id === m.source_id ? { ...x, pick: prev } : x)));
      setError(`Keuze niet bewaard: ${error.message}`);
    }
  }

  async function doImport(input: string | ImportPayload, source = "paste") {
    if (!license) return;
    setImporting(true); setNotice(null); setNoExtension(false);
    try {
      const payload = typeof input === "string" ? parseImport(input) : input;
      if (payload.handle && license.handle && payload.handle.toLowerCase() !== license.handle.toLowerCase()) {
        throw new Error(`Deze lijst is van @${payload.handle}, maar deze licentie is van @${license.handle}. Open het juiste profiel op MakerWorld.`);
      }
      const r = await importModels(supabase, license, payload, source);
      setNotice(`${r.total} modellen bijgewerkt: ${r.added} nieuw${r.removed ? `, ${r.removed} niet meer online` : ""}${r.returned ? `, ${r.returned} terug online` : ""}.`);
      setPasteText(""); setPasteOpen(false);
      if (r.added > 0) setStatus("new");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
    setImporting(false);
  }

  /** Knop "Nieuwste modellen ophalen": via de Chrome-extensie MakerWorld-hulp, alles blijft in de tool. */
  async function fetchLatest() {
    if (!license) return;
    setFetching(true); setError(null); setNotice(null); setNoExtension(false);
    try {
      const payload = await fetchViaExtension(license);
      setFetching(false);
      await doImport(payload, "extension");
    } catch (e: any) {
      if (e.message === "NO_EXTENSION") setNoExtension(true);
      else setError(e.message ?? String(e));
    }
    setFetching(false);
  }

  async function pasteFromClipboard() {
    try { const t = await navigator.clipboard.readText(); setPasteText(t); if (t.trim()) await doImport(t); }
    catch { setError("De tool mag je klembord niet lezen. Klik in het vak en plak met Ctrl+V."); }
  }

  const toFetch = enriched.filter((m) => m.pick === "yes" && !m.maker_model_id && !m.removed_at);
  const inbox = license ? `\\\\NASMAT\\MakerProducts\\_Inbox\\_Licenties\\${license.artist.replace(/[^A-Za-z0-9 _-]/g, "").trim()}` : "";

  async function queuePlace() {
    if (!license) return;
    const { error } = await supabase.from("maker_jobs").insert({ kind: "license", model_ids: [], items: [license.id], note: "" });
    if (error) { setError(error.message); return; }
    setNotice("Opdracht staat klaar voor de agent. Die zet de bestanden in de bibliotheek en bouwt de Catalogus opnieuw.");
    loadJobs();
  }

  if (!ready) return null;
  if (!license) return <div>{error ? <p className="warning">{error}</p> : <p className="muted">Laden...</p>}</div>;
  const s = licenseState(license);
  const sColor = s.kind === "expired" ? "var(--rust)" : s.kind === "soon" ? "var(--yellow)" : "var(--moss)";
  const STATUS_TABS: [Status, string, number][] = [
    ["", "Alle", counts.all], ["open", "Nog te bekijken", counts.open], ["new", "Nieuw", counts.new], ["yes", PICK_LABELS.yes, counts.yes],
    ["maybe", PICK_LABELS.maybe, counts.maybe], ["no", PICK_LABELS.no, counts.no], ["catalog", "In de Catalogus", counts.catalog],
    ...(counts.removed ? [["removed", "Niet meer online", counts.removed] as [Status, string, number]] : []),
  ];

  return (
    <div>
      <p className="muted" style={{ margin: "0 0 6px" }}><Link href="/licenses">Licenties</Link> /</p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: 0 }}>{license.artist}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {PLATFORM_LABELS[license.platform]} · <span style={{ color: sColor, fontWeight: 600 }}>{s.label}</span> · betaald {formatDate(license.purchased_on)}
            {license.profile_url && <> · <a href={license.profile_url} target="_blank" rel="noopener noreferrer">profiel</a></>}
            {license.last_refreshed_at && <> · lijst bijgewerkt {formatDate(license.last_refreshed_at)}</>}
          </p>
          {license.terms && <p className="muted" style={{ margin: "4px 0 0" }}>Licentie: {license.terms}</p>}
        </div>
        <div className="row">
          {REFRESHABLE.includes(license.platform) && (
            <button className="btn" disabled={fetching || importing} onClick={fetchLatest}
              title="Haalt de lijst op via de Chrome-extensie MakerWorld-hulp, met je eigen MakerWorld-login">
              {fetching ? "Ophalen bij MakerWorld..." : importing ? "Opslaan..." : "Nieuwste modellen ophalen"}
            </button>
          )}
          <button className="btn secondary" onClick={() => setPasteOpen(!pasteOpen)} title="Lijst plakken (via de bladwijzer op MakerWorld)">Lijst plakken</button>
        </div>
      </div>

      {error && <p className="warning" onClick={() => setError(null)}>{error}</p>}
      {notice && <p style={{ color: "var(--moss)" }}>{notice}</p>}

      {noExtension && (
        <div className="card" style={{ marginTop: 12, borderLeft: "3px solid var(--yellow)" }}>
          <p style={{ marginTop: 0 }}><b>De Chrome-extensie MakerWorld-hulp is niet gevonden.</b> Die is nodig om de lijst vanuit de tool op te halen (MakerWorld laat geen opvragingen van servers toe). Eenmalig installeren per pc:</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Open <span className="mono">chrome://extensions</span> en zet rechtsboven <b>Ontwikkelaarsmodus</b> aan.</li>
            <li>Klik <b>Uitgepakte extensie laden</b> en kies de map <span className="mono">browser-extension\makerworld-helper</span> uit de repo (bv. <span className="mono">D:\Development\WebShopProductCreator\browser-extension\makerworld-helper</span>).</li>
            <li>Herlaad deze pagina en klik opnieuw op <b>Nieuwste modellen ophalen</b>. Zorg dat je in Chrome ingelogd bent op makerworld.com.</li>
          </ol>
          <p className="muted" style={{ marginBottom: 0 }}>Geen extensie op deze pc? Gebruik dan <b>Lijst plakken</b>, of vraag het aan Claude.</p>
        </div>
      )}

      {pasteOpen && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Open het profiel van {license.artist} op MakerWorld, klik op je bladwijzer <b>Modellen ophalen</b> (zie <Link href="/licenses">Licenties</Link>) en
            daarna op <b>Kopieer en open de beheertool</b>. Plak de lijst hier.
          </p>
          <textarea id="lic-paste" rows={4} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Plak hier de lijst (Ctrl+V)" style={{ fontFamily: "var(--font-mono), monospace", fontSize: 12 }} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" disabled={importing || !pasteText.trim()} onClick={() => doImport(pasteText)}>{importing ? "Bezig..." : "Importeren"}</button>
            <button className="btn secondary" disabled={importing} onClick={pasteFromClipboard}>Plakken uit klembord</button>
          </div>
          {refreshes.length > 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              Vorige updates: {refreshes.map((r) => `${formatDate(r.created_at)} (${r.total}, ${r.new_count} nieuw${r.removed_count ? `, ${r.removed_count} weg` : ""})`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {(toFetch.length > 0 || jobs.length > 0) && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Naar de Catalogus</h3>
          {toFetch.length > 0 ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {toFetch.length} model{toFetch.length === 1 ? "" : "len"} op <b>Overnemen</b> staan nog niet in de Catalogus. Download de bestanden (3MF of STL) van
                MakerWorld naar <span className="mono">{inbox}</span>, of vraag het aan Claude. Daarna zet de agent ze in de bibliotheek
                ({license.folder || "3D-Print/" + license.artist}) met de foto van MakerWorld, en kun je er in de Catalogus een product van maken.
              </p>
              <details>
                <summary className="muted">Lijst om te downloaden</summary>
                <ul style={{ columns: "2 280px", margin: "8px 0", paddingLeft: 18 }}>
                  {toFetch.map((m) => <li key={m.source_id}><a href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a> <span className="muted mono">({m.source_id})</span></li>)}
                </ul>
              </details>
              <button className="btn" style={{ marginTop: 8 }} onClick={queuePlace} disabled={jobs.some((j) => j.status === "queued" || j.status === "running")}>
                Gedownloade bestanden in de Catalogus zetten
              </button>
            </>
          ) : <p className="muted" style={{ marginTop: 0 }}>Alles wat op Overnemen staat, zit in de Catalogus.</p>}
          {jobs.map((j) => (
            <p key={j.id} className="muted" style={{ margin: "8px 0 0" }}>
              {new Date(j.created_at).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })} ·{" "}
              <span style={{ color: j.status === "failed" ? "var(--rust)" : j.status === "done" ? "var(--moss)" : "var(--cyan)" }}>
                {{ queued: "in de wachtrij", running: "bezig", done: "klaar", failed: "mislukt", cancelled: "geannuleerd" }[j.status]}
              </span>{j.progress && <> · {j.progress}</>}
            </p>
          ))}
        </div>
      )}

      {models.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>Nog geen modellen. Klik op <b>Lijst toevoegen</b>.</p>
      ) : (
        <>
          <div className="tabs" style={{ marginTop: 16 }}>
            {STATUS_TABS.map(([v, l, n]) => (
              <button key={v || "all"} className={`tab${status === v ? " active" : ""}`} onClick={() => setStatus(v)}>
                {l} <span className="tab-count">{n}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ alignItems: "center", margin: "12px 0" }}>
            <input id="lic-search" style={{ flex: "1 1 220px", width: "auto" }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek op naam of tag (bv. dragon, knitted)" />
            <select id="lic-theme" style={{ width: "auto" }} value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="">Alle thema's</option>{themes.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select id="lic-type" style={{ width: "auto" }} value={typ} onChange={(e) => setTyp(e.target.value)}>
              <option value="">Alle soorten</option>{types.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select id="lic-sort" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="dl">Meest gedownload</option><option value="new">Nieuwste eerst</option><option value="old">Oudste eerst</option>
              <option value="tm">Kortste printtijd</option><option value="w">Minste filament</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={hideTm} onChange={(e) => setHideTm(e.target.checked)} /> Verberg merken
            </label>
            <span className="muted mono">{filtered.length} van {counts.all}</span>
          </div>

          <div className="prod-grid">
            {filtered.slice(0, shown).map((m) => {
              const border = m.pick === "yes" ? "var(--moss)" : m.pick === "maybe" ? "var(--yellow)" : undefined;
              return (
                <div key={m.source_id} className="prod-card" style={{ borderColor: border, opacity: m.pick === "no" ? 0.5 : 1 }}>
                  <a className="prod-thumb" href={m.url} target="_blank" rel="noopener noreferrer" style={{ position: "relative" }}>
                    {m.cover_url ? <img src={thumbUrl(m.cover_url) ?? ""} alt={m.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div className="prod-thumb-empty">geen foto</div>}
                    <span style={{ position: "absolute", right: 6, top: 6, background: "rgba(7,7,13,.8)", color: "#fff", padding: "2px 6px", fontSize: 11 }} className="mono" title={`${m.downloads} downloads`}>↓ {fmt(m.downloads)}</span>
                    {m.fresh && <span className="pill" style={{ position: "absolute", left: 6, top: 6, background: "var(--magenta)", color: "#07070d" }}>Nieuw</span>}
                    {m.trademark && <span className="pill" style={{ position: "absolute", left: 6, bottom: 6, background: "var(--rust)", color: "#fff" }} title={`Gebruikt ${m.trademark}: je licentie dekt het ontwerp, niet het merk`}>Merk</span>}
                  </a>
                  <div className="prod-body">
                    <a className="prod-name" href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a>
                    <div className="prod-meta mono">
                      {m.print_minutes != null && <span>{hm(m.print_minutes)}</span>}
                      {m.weight_g != null && <span>{m.weight_g} g</span>}
                      {m.profiles != null && <span>{m.profiles} profiel{m.profiles === 1 ? "" : "en"}</span>}
                      {m.published_at && <span>{formatDate(m.published_at)}</span>}
                    </div>
                    <div className="prod-cats">
                      {m.theme !== "Heel het jaar" && <span className="pill">{m.theme}</span>}
                      <span className="pill">{m.type}</span>
                      {m.style !== "Cute / flexi" && <span className="pill">{m.style}</span>}
                    </div>
                    {m.trademark && <div style={{ color: "var(--rust)", fontSize: 12 }}>Gebruikt {m.trademark}</div>}
                    {m.maker_model_id && <Link href={`/catalog?model=${m.maker_model_id}`} style={{ fontSize: 12.5, color: "var(--moss)" }}>In de Catalogus →</Link>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "1px solid var(--line-soft)" }}>
                    {(["yes", "maybe", "no"] as ModelPick[]).map((k) => {
                      const on = m.pick === k;
                      const c = k === "yes" ? "var(--moss)" : k === "maybe" ? "var(--yellow)" : "var(--ink-soft)";
                      return (
                        <button key={k} type="button" aria-pressed={on} onClick={() => setPick(m, on ? null : k)} disabled={!!m.removed_at}
                          style={{ background: on ? "rgba(255,255,255,.06)" : "none", border: 0, borderLeft: k !== "yes" ? "1px solid var(--line-soft)" : 0,
                            color: on ? c : "var(--ink-faint)", fontWeight: on ? 700 : 500, padding: "9px 4px", cursor: "pointer", font: "inherit", fontSize: 13 }}>
                          {PICK_LABELS[k]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > shown && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="btn secondary" onClick={() => setShown(shown + PAGE)}>Meer tonen ({filtered.length - shown})</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
