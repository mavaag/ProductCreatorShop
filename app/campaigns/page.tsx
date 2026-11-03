"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { authHeader } from "@/lib/productionFiles";
import { confirmDialog } from "@/components/DialogHost";

// Campagnes (plugin "3DP Klanten" 1.5.0): een reclamemail opbouwen uit blokken (titel, tekst, collectie, producten,
// actie, knop, afbeelding, persoonlijke code) en versturen naar klanten met toestemming -- meteen of ingepland.
// De shop maakt de mail en verstuurt ze via Resend (afzender, afmeldlink en List-Unsubscribe zoals de kortingscodes).

type Block =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "collection"; term_id: number; text: string }
  | { type: "products"; ids: number[] }
  | { type: "actie"; id: string }
  | { type: "button"; text: string; url: string }
  | { type: "image"; url: string; link: string }
  | { type: "code"; cfg: { type: "percent" | "fixed_cart" | "free_shipping"; amount: number; days: number; min: number } };
type AudienceType = "all" | "newsletter" | "buyers" | "loyal" | "inactive" | "new";
type Campaign = {
  id?: string; name: string; subject: string; title: string; preheader: string; blocks: Block[];
  audience: { type: AudienceType; n: number }; send_at: string;
  status?: "draft" | "scheduled" | "sending" | "sent"; updated?: string; started_at?: string; finished_at?: string;
  total?: number; sent_count?: number; failed_count?: number; queue_count?: number; skipped?: number; cancelled?: number;
  stats?: { orders: number; revenue: number } | null;
};
type Data = {
  campaigns: Campaign[]; counts: Record<string, number>; categories: { id: number; name: string; count: number; image: boolean }[];
  acties: { id: string; name: string; label: string; active: boolean; end: string }[];
  settings: { daily_cap: number }; sent_today: number; now: string;
};
type Product = { id: number; name: string; price: number; image: string };

const BLOCK_LABELS: Record<Block["type"], string> = {
  heading: "Titel", text: "Tekst", collection: "Collectie", products: "Producten", actie: "Actie", button: "Knop", image: "Afbeelding", code: "Persoonlijke code",
};
const NEW_BLOCK: Record<Block["type"], () => Block> = {
  heading: () => ({ type: "heading", text: "" }),
  text: () => ({ type: "text", text: "" }),
  collection: () => ({ type: "collection", term_id: 0, text: "" }),
  products: () => ({ type: "products", ids: [] }),
  actie: () => ({ type: "actie", id: "" }),
  button: () => ({ type: "button", text: "Naar de shop", url: "https://3dprintforyou.be/" }),
  image: () => ({ type: "image", url: "", link: "" }),
  code: () => ({ type: "code", cfg: { type: "percent", amount: 10, days: 14, min: 0 } }),
};
const AUDIENCES: { value: AudienceType; label: string; n?: string }[] = [
  { value: "all", label: "Iedereen met toestemming" },
  { value: "newsletter", label: "Enkel nieuwsbrief-inschrijvers" },
  { value: "buyers", label: "Klanten die al besteld hebben" },
  { value: "loyal", label: "Trouwe klanten (min. aantal bestellingen)", n: "bestellingen" },
  { value: "inactive", label: "Lang niets besteld", n: "maanden" },
  { value: "new", label: "Nieuwe klanten / inschrijvers", n: "dagen" },
];
const EMPTY: Campaign = { name: "", subject: "", title: "", preheader: "", blocks: [], audience: { type: "all", n: 3 }, send_at: "" };
const TEMPLATES: { label: string; make: () => Campaign }[] = [
  { label: "Nieuwe collectie", make: () => ({ ...EMPTY, name: "Nieuwe collectie", subject: "Nieuw: onze collectie ...", title: "Nieuw in de shop", preheader: "Net binnen, bekijk ze als eerste", blocks: [
    { type: "text", text: "Hallo {naam},\n\nWe hebben net een nieuwe collectie online gezet. Jij ziet ze als eerste!" },
    { type: "collection", term_id: 0, text: "" }, { type: "products", ids: [] }] }) },
  { label: "Feestdag", make: () => ({ ...EMPTY, name: "Feestdag", subject: "Klaar voor ...? Onze cadeautips", title: "Cadeautips", preheader: "Persoonlijke cadeaus, gemaakt in België", blocks: [
    { type: "text", text: "Hallo {naam},\n\n... komt eraan! Op zoek naar een origineel cadeau? Hier zijn onze favorieten, en alles kan je personaliseren." },
    { type: "products", ids: [] }, { type: "button", text: "Bekijk alle cadeaus", url: "https://3dprintforyou.be/shop/" }] }) },
  { label: "Actie", make: () => ({ ...EMPTY, name: "Actie", subject: "Actie: ...", title: "Nu in actie", preheader: "Maar voor even!", blocks: [
    { type: "text", text: "Hallo {naam},\n\nEven niet te missen:" }, { type: "actie", id: "" }, { type: "products", ids: [] }] }) },
  { label: "Leeg", make: () => ({ ...EMPTY, blocks: [{ type: "text", text: "Hallo {naam},\n\n" }] }) },
];

async function api(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const res = await fetch(`/api/campaigns/${path}`, {
    method,
    headers: { ...(await authHeader(supabase)), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function fmt(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return isNaN(d.getTime()) ? iso : d.toLocaleString("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const euro = (v: number) => "€ " + v.toFixed(2).replace(".", ",");

function statusPill(c: Campaign) {
  switch (c.status) {
    case "scheduled": return <span className="pill yellow">ingepland {fmt(c.send_at)}</span>;
    case "sending": return <span className="pill cyan">bezig ({c.sent_count}/{c.total})</span>;
    case "sent": return <span className="pill cyan">verstuurd {fmt(c.finished_at || c.started_at)}</span>;
    default: return <span className="pill">concept</span>;
  }
}

/* ---------- producten kiezen ---------- */

function ProductPicker({ ids, onChange, names, remember }: { ids: number[]; onChange: (ids: number[]) => void; names: Map<number, Product>; remember: (p: Product[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      api(`products?q=${encodeURIComponent(q.trim())}`).then((r: Product[]) => { setHits(r); remember(r); }).catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {ids.length > 0 && (
        <div className="camp-chips">
          {ids.map((id, i) => (
            <span key={id} className="camp-chip">
              {names.get(id)?.image && <img src={names.get(id)!.image} alt="" />}
              {names.get(id)?.name ?? `#${id}`}
              <button type="button" title="Naar links" disabled={i === 0} onClick={() => { const n = [...ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>‹</button>
              <button type="button" title="Weghalen" onClick={() => onChange(ids.filter((x) => x !== id))}>✕</button>
            </span>
          ))}
        </div>
      )}
      {ids.length < 8 && <input placeholder="Zoek een product om toe te voegen (max. 8)" value={q} onChange={(e) => setQ(e.target.value)} />}
      {hits.length > 0 && (
        <div className="camp-hits">
          {hits.filter((h) => !ids.includes(h.id)).slice(0, 10).map((h) => (
            <button key={h.id} type="button" className="camp-hit" onClick={() => { onChange([...ids, h.id]); setQ(""); setHits([]); }}>
              {h.image ? <img src={h.image} alt="" /> : <span className="camp-noimg" />}
              <span>{h.name}</span><span className="muted">{euro(h.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- één blok ---------- */

function BlockEditor({ b, set, data, names, remember }: { b: Block; set: (b: Block) => void; data: Data; names: Map<number, Product>; remember: (p: Product[]) => void }) {
  switch (b.type) {
    case "heading":
      return <input value={b.text} placeholder="bv. Nieuw: de Flexi-collectie" onChange={(e) => set({ ...b, text: e.target.value })} />;
    case "text":
      return <textarea rows={4} value={b.text} placeholder="{naam} = voornaam van de klant" onChange={(e) => set({ ...b, text: e.target.value })} />;
    case "collection": {
      const collecties = data.categories.filter((c) => c.name.startsWith("Collecties >"));
      const andere = data.categories.filter((c) => !c.name.startsWith("Collecties >"));
      return (
        <>
          <select value={b.term_id} onChange={(e) => set({ ...b, term_id: parseInt(e.target.value) || 0 })}>
            <option value={0}>Kies een collectie of categorie</option>
            <optgroup label="Collecties">{collecties.map((c) => <option key={c.id} value={c.id}>{c.name.replace("Collecties > ", "")} ({c.count}){c.image ? "" : " – geen foto"}</option>)}</optgroup>
            <optgroup label="Categorieën">{andere.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count}){c.image ? "" : " – geen foto"}</option>)}</optgroup>
          </select>
          <textarea rows={2} value={b.text} placeholder="Eigen tekst (leeg = de beschrijving van de collectie)" onChange={(e) => set({ ...b, text: e.target.value })} />
        </>
      );
    }
    case "products":
      return <ProductPicker ids={b.ids} onChange={(ids) => set({ ...b, ids })} names={names} remember={remember} />;
    case "actie":
      return (
        <select value={b.id} onChange={(e) => set({ ...b, id: e.target.value })}>
          <option value="">Kies een actie</option>
          {data.acties.map((a) => <option key={a.id} value={a.id}>{a.name || a.label} – {a.label}{a.active ? "" : " (staat uit)"}</option>)}
        </select>
      );
    case "button":
      return (
        <div className="row">
          <input value={b.text} placeholder="Tekst op de knop" onChange={(e) => set({ ...b, text: e.target.value })} />
          <input value={b.url} placeholder="https://3dprintforyou.be/..." onChange={(e) => set({ ...b, url: e.target.value })} />
        </div>
      );
    case "image":
      return (
        <div className="row">
          <input value={b.url} placeholder="Adres van de afbeelding (bv. uit de Mediabibliotheek)" onChange={(e) => set({ ...b, url: e.target.value })} />
          <input value={b.link} placeholder="Link bij klikken (optioneel)" onChange={(e) => set({ ...b, link: e.target.value })} />
        </div>
      );
    case "code":
      return (
        <>
          <div className="row">
            <select value={b.cfg.type} onChange={(e) => set({ ...b, cfg: { ...b.cfg, type: e.target.value as any } })}>
              <option value="percent">% korting</option><option value="fixed_cart">€ korting</option><option value="free_shipping">Gratis verzending</option>
            </select>
            {b.cfg.type !== "free_shipping" && <input className="mono" type="number" min={1} value={b.cfg.amount} title="Korting" onChange={(e) => set({ ...b, cfg: { ...b.cfg, amount: parseFloat(e.target.value) || 0 } })} />}
            <input className="mono" type="number" min={1} value={b.cfg.days} title="Dagen geldig" onChange={(e) => set({ ...b, cfg: { ...b.cfg, days: parseInt(e.target.value) || 14 } })} />
            <input className="mono" type="number" min={0} value={b.cfg.min} title="Minimum bedrag (0 = geen)" onChange={(e) => set({ ...b, cfg: { ...b.cfg, min: parseFloat(e.target.value) || 0 } })} />
          </div>
          <p className="muted" style={{ margin: "4px 0 0" }}>Soort · korting · dagen geldig · minimum bedrag. Elke ontvanger krijgt een eigen code (enkel voor zijn e-mailadres, 1 keer).</p>
        </>
      );
  }
}

/* ---------- pagina ---------- */

export default function CampaignsPage() {
  const ready = useAuthGuard();
  const [data, setData] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Campaign | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [testTo, setTestTo] = useState("");
  const [names] = useState(() => new Map<number, Product>());
  const [, bump] = useState(0);
  const remember = (ps: Product[]) => { ps.forEach((p) => names.set(p.id, p)); bump((x) => x + 1); };

  async function load() {
    try { setData(await api("list")); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => {
    if (!ready) return;
    load();
    supabase.auth.getUser().then(({ data: u }) => setTestTo(u.user?.email ?? ""));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = !!edit && (edit.status === "sending" || edit.status === "sent");

  // voorbeeld vernieuwen (even wachten tot er niet meer getypt wordt)
  const editKey = useMemo(() => (edit ? JSON.stringify({ ...edit, audience: undefined, send_at: undefined }) : ""), [edit]);
  useEffect(() => {
    if (!edit) return;
    const t = setTimeout(() => {
      api("preview", "POST", { campaign: edit }).then((r) => setPreview(r.html)).catch((e) => setPreview(`<p style="font-family:sans-serif;color:#c00">${String(e.message)}</p>`));
    }, 700);
    return () => clearTimeout(t);
  }, [editKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // aantal ontvangers
  const audKey = edit ? JSON.stringify(edit.audience) : "";
  useEffect(() => {
    if (!edit) return;
    setCount(null);
    api("action", "POST", { action: "count", audience: edit.audience }).then((r) => setCount(r.count)).catch(() => setCount(null));
  }, [audKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // namen van producten in een geopende campagne ophalen
  function open(c: Campaign) {
    setEdit(JSON.parse(JSON.stringify(c)));
    setInfo(""); setError("");
    const ids = c.blocks.flatMap((b) => (b.type === "products" ? b.ids : [])).filter((id) => !names.has(id));
    if (ids.length) api(`products?ids=${ids.join(",")}`).then(remember).catch(() => {});
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setInfo("");
    try {
      const r = await api("action", "POST", { action, campaign: edit, ...extra });
      setData(r);
      if (r.saved_id && edit) setEdit({ ...edit, id: r.saved_id, status: r.campaigns.find((c: Campaign) => c.id === r.saved_id)?.status });
      return r;
    } catch (e: any) { setError(e.message); return null; } finally { setBusy(false); }
  }

  if (!ready) return null;

  const setBlock = (i: number, b: Block) => edit && setEdit({ ...edit, blocks: edit.blocks.map((x, j) => (j === i ? b : x)) });
  const moveBlock = (i: number, d: number) => {
    if (!edit) return;
    const n = [...edit.blocks]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setEdit({ ...edit, blocks: n });
  };
  const audDef = edit ? AUDIENCES.find((a) => a.value === edit.audience.type) : null;

  /* ---------- bewerken ---------- */
  if (edit && data) {
    return (
      <div>
        <p><button type="button" className="btn secondary" onClick={() => { setEdit(null); setPreview(""); load(); }}>‹ Alle campagnes</button></p>
        <h1 style={{ marginBottom: 4 }}>{edit.name || edit.subject || "Nieuwe campagne"} {statusPill(edit)}</h1>
        {error && <p className="warning">{error}</p>}
        {info && <p className="pill cyan" style={{ display: "inline-block" }}>{info}</p>}
        {locked && (
          <div className="card">
            <b>{edit.sent_count ?? 0}</b> van {edit.total ?? 0} verstuurd{edit.failed_count ? `, ${edit.failed_count} mislukt` : ""}{edit.skipped ? `, ${edit.skipped} overgeslagen (intussen afgemeld)` : ""}{edit.cancelled ? `, ${edit.cancelled} geannuleerd` : ""}.
            {edit.stats && <> In de 14 dagen erna: <b>{edit.stats.orders}</b> bestelling{edit.stats.orders === 1 ? "" : "en"} van ontvangers ({euro(edit.stats.revenue)}).</>}
            <p className="muted" style={{ margin: "6px 0 0" }}>Een verstuurde campagne kan je niet meer aanpassen. Met <i>Kopie maken</i> in de lijst start je een nieuwe op basis van deze.</p>
          </div>
        )}
        <div className="camp-grid">
          <div>
            <fieldset disabled={locked || busy} className="camp-fieldset">
              <div className="card">
                <div className="row">
                  <div><label>Naam (enkel voor jezelf)</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="bv. Sinterklaas 2026" /></div>
                  <div><label>Onderwerp</label><input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} placeholder="Wat de klant in zijn inbox ziet" /></div>
                </div>
                <div className="row">
                  <div><label>Kop bovenaan de mail</label><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="leeg = het onderwerp" /></div>
                  <div><label>Voorbeeldtekst in de inbox</label><input value={edit.preheader} onChange={(e) => setEdit({ ...edit, preheader: e.target.value })} placeholder="korte zin naast het onderwerp" /></div>
                </div>
              </div>

              {edit.blocks.map((b, i) => (
                <div key={i} className="card camp-block">
                  <div className="camp-block-head">
                    <b>{BLOCK_LABELS[b.type]}</b>
                    <span>
                      <button type="button" className="btn secondary" disabled={i === 0} onClick={() => moveBlock(i, -1)} title="Omhoog">↑</button>
                      <button type="button" className="btn secondary" disabled={i === edit.blocks.length - 1} onClick={() => moveBlock(i, 1)} title="Omlaag">↓</button>
                      <button type="button" className="btn danger" onClick={() => setEdit({ ...edit, blocks: edit.blocks.filter((_, j) => j !== i) })} title="Weghalen">✕</button>
                    </span>
                  </div>
                  <BlockEditor b={b} set={(nb) => setBlock(i, nb)} data={data} names={names} remember={remember} />
                </div>
              ))}

              <div className="card">
                <label style={{ marginTop: 0 }}>Blok toevoegen</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(Object.keys(BLOCK_LABELS) as Block["type"][]).map((t) => (
                    <button key={t} type="button" className="btn secondary" disabled={t === "code" && edit.blocks.some((b) => b.type === "code")}
                      onClick={() => setEdit({ ...edit, blocks: [...edit.blocks, NEW_BLOCK[t]()] })}>+ {BLOCK_LABELS[t]}</button>
                  ))}
                </div>
              </div>

              <div className="card">
                <h2>Naar wie</h2>
                <div className="row">
                  <select value={edit.audience.type} onChange={(e) => {
                    const t = e.target.value as AudienceType;
                    setEdit({ ...edit, audience: { type: t, n: t === "loyal" ? 3 : t === "inactive" ? 6 : t === "new" ? 30 : 3 } });
                  }}>
                    {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {audDef?.n && (
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input className="mono" type="number" min={1} value={edit.audience.n} style={{ width: 90 }}
                        onChange={(e) => setEdit({ ...edit, audience: { ...edit.audience, n: parseInt(e.target.value) || 1 } })} />
                      <span className="muted">{audDef.n}</span>
                    </span>
                  )}
                </div>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {count === null ? "Ontvangers tellen..." : <><b>{count}</b> ontvanger{count === 1 ? "" : "s"}</>} — enkel klanten en inschrijvers die toestemming gaven; wie zich intussen afmeldt, wordt overgeslagen.
                  {count !== null && count > data.settings.daily_cap && <> Meer dan {data.settings.daily_cap} per dag: de rest gaat de volgende dag(en).</>}
                </p>
              </div>
            </fieldset>

            {!locked && (
              <div className="card">
                <h2>Versturen</h2>
                <div className="row" style={{ alignItems: "end" }}>
                  <div><label>Testmail naar</label><input value={testTo} onChange={(e) => setTestTo(e.target.value)} /></div>
                  <div style={{ flex: "0 0 auto" }}>
                    <button type="button" className="btn secondary" disabled={busy || !testTo} onClick={async () => {
                      const r = await act("test", { to: testTo });
                      if (r) setInfo(r.test_sent ? `Testmail verstuurd naar ${testTo}` : "Testmail kon niet verstuurd worden");
                    }}>Testmail</button>
                  </div>
                </div>
                <div className="row" style={{ alignItems: "end" }}>
                  <div><label>Inplannen op</label><input type="datetime-local" value={edit.send_at.replace(" ", "T")} onChange={(e) => setEdit({ ...edit, send_at: e.target.value.replace("T", " ") })} /></div>
                  <div style={{ flex: "0 0 auto" }}>
                    <button type="button" className="btn secondary" disabled={busy || !edit.send_at} onClick={async () => {
                      const r = await act("schedule"); if (r) setInfo(`Ingepland op ${fmt(edit.send_at)}`);
                    }}>{edit.status === "scheduled" ? "Planning bijwerken" : "Inplannen"}</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" className="btn secondary" disabled={busy} onClick={async () => { const r = await act("save"); if (r) setInfo("Bewaard als concept"); }}>
                    {edit.status === "scheduled" ? "Planning stoppen (concept)" : "Bewaren als concept"}
                  </button>
                  <button type="button" className="btn" disabled={busy || !count} onClick={async () => {
                    if (!(await confirmDialog(`"${edit.subject}" nu versturen naar ${count} ontvanger${count === 1 ? "" : "s"}?`, { confirmLabel: "Nu versturen" }))) return;
                    const r = await act("send_now");
                    if (r) { setInfo("Verzending gestart"); const c = r.campaigns.find((x: Campaign) => x.id === r.saved_id); if (c) setEdit(c); }
                  }}>{busy ? "Bezig..." : "Nu versturen"}</button>
                </div>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  Vandaag al {data.sent_today} van max. {data.settings.daily_cap} reclamemails verstuurd. De shop verstuurt in porties van 25; de rest volgt binnen ongeveer 10 minuten.
                </p>
              </div>
            )}
          </div>

          <div className="camp-preview">
            <div className="muted" style={{ marginBottom: 6 }}>Voorbeeld (met "Voornaam"{edit.blocks.some((b) => b.type === "code") ? " en VOORBEELD-CODE" : ""})</div>
            <iframe title="Voorbeeld van de mail" srcDoc={preview || "<p style='font-family:sans-serif;color:#888'>Voorbeeld laden...</p>"} />
          </div>
        </div>
      </div>
    );
  }

  /* ---------- lijst ---------- */
  return (
    <div>
      <h1>Campagnes</h1>
      <p className="sub">
        Reclamemails naar klanten die toestemming gaven: een nieuwe collectie, een feestdag, een actie. Elke mail heeft een afmeldlink;
        wie zich afmeldt, krijgt niets meer. Hou het bij 1 à 2 mails per maand.
      </p>
      {error && <p className="warning">{error}</p>}
      {!data ? <p className="muted">Laden...</p> : (
        <>
          <div className="card">
            <label style={{ marginTop: 0 }}>Nieuwe campagne</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TEMPLATES.map((t) => <button key={t.label} type="button" className="btn" onClick={() => open(t.make())}>+ {t.label}</button>)}
            </div>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              Met toestemming nu: <b>{data.counts.all ?? 0}</b> (waarvan {data.counts.newsletter ?? 0} via de nieuwsbrief, {data.counts.buyers ?? 0} die al besteld hebben).
            </p>
          </div>

          {data.campaigns.length === 0 ? <p className="muted">Nog geen campagnes.</p> : (
            <div className="camp-list">
              {data.campaigns.map((c) => (
                <div key={c.id} className="card camp-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{c.name || c.subject || "(zonder naam)"} {statusPill(c)}</div>
                    <div className="muted">
                      {c.subject}
                      {(c.status === "sent" || c.status === "sending") && <> · {c.sent_count}/{c.total} verstuurd{c.stats ? ` · ${c.stats.orders} bestelling${c.stats.orders === 1 ? "" : "en"} (${euro(c.stats.revenue)})` : ""}</>}
                      {(!c.status || c.status === "draft") && c.updated && <> · bewaard {fmt(c.updated)}</>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn secondary" onClick={() => open(c)}>{c.status === "sent" || c.status === "sending" ? "Bekijken" : "Openen"}</button>
                    <button type="button" className="btn secondary" disabled={busy} onClick={() => act("duplicate", { id: c.id, campaign: undefined })}>Kopie maken</button>
                    {(c.status === "scheduled" || c.status === "sending") && (
                      <button type="button" className="btn secondary" disabled={busy} onClick={async () => {
                        if (await confirmDialog(c.status === "sending" ? "De rest van deze campagne niet meer versturen?" : "Deze planning stoppen? De campagne wordt terug een concept.")) act("cancel", { id: c.id, campaign: undefined });
                      }}>{c.status === "sending" ? "Stoppen" : "Planning stoppen"}</button>
                    )}
                    {c.status !== "sending" && (
                      <button type="button" className="btn danger" disabled={busy} onClick={async () => {
                        if (await confirmDialog(`Campagne "${c.name || c.subject}" verwijderen?`, { confirmLabel: "Verwijderen", danger: true })) act("delete", { id: c.id, campaign: undefined });
                      }}>Verwijderen</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Instellingen</h2>
            <div className="row" style={{ alignItems: "end", maxWidth: 520 }}>
              <div>
                <label>Max. reclamemails per dag</label>
                <input className="mono" type="number" min={1} defaultValue={data.settings.daily_cap} id="camp-cap" />
              </div>
              <div style={{ flex: "0 0 auto" }}>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => {
                  const v = parseInt((document.getElementById("camp-cap") as HTMLInputElement).value) || 90;
                  act("settings", { daily_cap: v, campaign: undefined });
                }}>Bewaren</button>
              </div>
            </div>
            <p className="muted" style={{ margin: "8px 0 0" }}>Het gratis plan van Resend laat 100 mails per dag toe (alles samen, ook bestelmails). Heb je een betaald plan, zet dit dan hoger.</p>
          </div>
        </>
      )}
    </div>
  );
}
