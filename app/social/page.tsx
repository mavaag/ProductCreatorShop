"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { authHeader } from "@/lib/productionFiles";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { SOCIAL_THEMES, SocialFormat, canvasToJpeg, renderSocial } from "@/lib/socialImage";

// Social (plugin "3DP Klanten" 1.7.0): een post voor de Facebook-pagina en Instagram maken -- afbeelding (vierkant
// voor de feed, staand voor Stories) + tekst -- en die nu of ingepland plaatsen via de Meta Graph API.
// Zonder koppeling kan je de afbeelding downloaden en de tekst kopiëren om zelf te posten.

type Channels = { fb: boolean; ig: boolean; ig_story: boolean };
type Design = { title: string; subtitle: string; badge: string; theme: string; show_prices: boolean; product_ids: number[] };
type Result = { id?: string; url?: string; error?: string; at?: string };
type Post = {
  id?: string; name: string; caption: string; link: string; channels: Channels; design: Design;
  image_feed?: string; image_story?: string; status?: "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";
  publish_at?: string; results?: Partial<Record<keyof Channels, Result>>; created?: string; published_at?: string;
};
type Connection = { connected: boolean; page_name: string; page_id: string; ig: boolean; ig_username: string; connected_at: string; pages: { id: string; name: string }[] };
type Product = { id: number; name: string; price: number; image: string; image_large?: string };
type ShopData = { categories: { id: number; name: string; count: number }[]; acties: { id: string; name: string; label: string; active: boolean }[] };

const CH_LABEL: Record<keyof Channels, string> = { fb: "Facebook", ig: "Instagram", ig_story: "Instagram-story" };

const EMPTY: Post = {
  name: "Nieuwe post", caption: "", link: "https://3dprintforyou.be/",
  channels: { fb: true, ig: false, ig_story: false },
  design: { title: "", subtitle: "", badge: "", theme: "warm", show_prices: true, product_ids: [] },
};

async function api(path: string, method: "GET" | "POST" = "GET", body?: unknown, base = "social") {
  const res = await fetch(`/api/${base}/${path}`, {
    method,
    headers: { ...(await authHeader(supabase)), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function fmt(s?: string) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? s : d.toLocaleString("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const euro = (v: number) => "€ " + v.toFixed(2).replace(".", ",");
const tag = (s: string) => "#" + s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

function statusPill(p: Post) {
  switch (p.status) {
    case "scheduled": return <span className="pill yellow">ingepland {fmt(p.publish_at)}</span>;
    case "publishing": return <span className="pill cyan">bezig…</span>;
    case "published": return <span className="pill cyan">geplaatst {fmt(p.published_at)}</span>;
    case "partial": return <span className="pill yellow">deels geplaatst</span>;
    case "failed": return <span className="pill rust">mislukt</span>;
    default: return <span className="pill">concept</span>;
  }
}

/** Voorstel voor de tekst (aanpasbaar). Instagram toont geen klikbare links, vandaar "link in bio". */
function suggestCaption(post: Post, products: Product[], extra: { collection?: string; actie?: string }) {
  const names = products.slice(0, 4).map((p) => p.name.replace(/\s+[–-]\s+.*$/, ""));
  const lines: string[] = [];
  if (extra.actie) lines.push(`🎉 ${extra.actie}`);
  if (extra.collection) lines.push(`✨ Nieuw in de shop: onze collectie ${extra.collection}!`);
  else if (post.design.title && !extra.actie) lines.push(`✨ ${post.design.title}`);
  if (post.design.subtitle) lines.push(post.design.subtitle);
  if (names.length) lines.push("", ...names.map((n) => `• ${n}`));
  lines.push("", "Alles kan je personaliseren met een naam, datum of eigen tekst. Ontworpen en gemaakt in België 🇧🇪");
  lines.push("", `👉 ${post.link || "3dprintforyou.be"}${post.channels.ig ? " (link in bio)" : ""}`);
  const tags = ["#3dprintforyou", "#gepersonaliseerd", "#cadeau", "#madeinbelgium", "#3dprinting"];
  if (extra.collection) tags.unshift(tag(extra.collection));
  lines.push("", tags.join(" "));
  return lines.join("\n");
}

export default function SocialPage() {
  const ready = useAuthGuard();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [conn, setConn] = useState<Connection | null>(null);
  const [shop, setShop] = useState<ShopData | null>(null);
  const [edit, setEdit] = useState<Post | null>(null);
  const [products, setProducts] = useState<Map<number, Product>>(new Map());
  const [preview, setPreview] = useState<{ feed: string; story: string }>({ feed: "", story: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [publishAt, setPublishAt] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [actieLabel, setActieLabel] = useState("");
  const bitmaps = useRef(new Map<string, Promise<ImageBitmap | null>>());

  function applyList(r: { posts: Post[]; connection: Connection }) {
    setPosts(r.posts); setConn(r.connection);
  }
  async function load() {
    try {
      applyList(await api("list"));
      const c = await api("list", "GET", undefined, "campaigns");
      setShop({ categories: c.categories, acties: c.acties });
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { if (ready) load(); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = (ps: Product[]) => setProducts((m) => { const n = new Map(m); ps.forEach((p) => n.set(p.id, p)); return n; });

  // Vanuit Collecties: ?collectie=<term_id>
  const fromQuery = useRef(false);
  useEffect(() => {
    if (!shop || fromQuery.current) return;
    fromQuery.current = true;
    const termId = parseInt(new URLSearchParams(window.location.search).get("collectie") ?? "") || 0;
    if (!termId) return;
    window.history.replaceState(null, "", "/social");
    pickCollection(termId, { ...EMPTY, design: { ...EMPTY.design } });
  }, [shop]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickCollection(termId: number, base: Post) {
    const cat = shop?.categories.find((c) => c.id === termId);
    const name = (cat?.name ?? "").replace("Collecties > ", "");
    setCollectionName(name); setActieLabel("");
    let ps: Product[] = [];
    try { ps = await api(`products?cat=${termId}`, "GET", undefined, "campaigns"); remember(ps); } catch { /* geen producten */ }
    const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const post: Post = {
      ...base, name: `Collectie ${name}`,
      link: cat?.name.startsWith("Collecties >") ? `https://3dprintforyou.be/product-category/collecties/${slug}/` : base.link,
      design: { ...base.design, title: `Nieuw: collectie ${name}`, subtitle: "Persoonlijke cadeaus, met naam of eigen tekst", badge: "Nieuw", product_ids: ps.slice(0, 4).map((p) => p.id) },
    };
    post.caption = suggestCaption(post, ps.slice(0, 4), { collection: name });
    setEdit(post); setPublishAt("");
  }

  function pickActie(id: string) {
    if (!edit) return;
    const a = shop?.acties.find((x) => x.id === id);
    if (!a) return;
    setActieLabel(a.label); setCollectionName("");
    const pct = a.label.match(/-?\d+\s?%/);
    const next = { ...edit, name: `Actie ${a.name || a.label}`, link: "https://3dprintforyou.be/acties/", design: { ...edit.design, title: a.name || a.label, subtitle: a.label, badge: pct ? (pct[0].startsWith("-") ? pct[0] : "-" + pct[0]).replace(/\s/g, "") : "Actie" } };
    next.caption = suggestCaption(next, edit.design.product_ids.map((i) => products.get(i)).filter(Boolean) as Product[], { actie: a.label });
    setEdit(next);
  }

  function open(p: Post) {
    setEdit(JSON.parse(JSON.stringify({ ...EMPTY, ...p, design: { ...EMPTY.design, ...(p.design ?? {}) } })));
    setInfo(""); setError(""); setPublishAt(p.publish_at ? p.publish_at.replace(" ", "T") : "");
    setCollectionName(""); setActieLabel("");
    const ids = (p.design?.product_ids ?? []).filter((id) => !products.has(id));
    if (ids.length) api(`products?ids=${ids.join(",")}`, "GET", undefined, "campaigns").then(remember).catch(() => {});
  }

  // productfoto's laden via de eigen server (anders mag het canvas niet geëxporteerd worden)
  async function loadImage(url: string): Promise<ImageBitmap | null> {
    if (!bitmaps.current.has(url)) {
      bitmaps.current.set(url, (async () => {
        try {
          const res = await fetch(`/api/social/img?url=${encodeURIComponent(url)}`, { headers: await authHeader(supabase) });
          if (!res.ok) return null;
          return await createImageBitmap(await res.blob());
        } catch { return null; }
      })());
    }
    return bitmaps.current.get(url) as Promise<ImageBitmap | null>;
  }

  const designFor = (p: Post) => ({
    title: p.design.title, subtitle: p.design.subtitle, badge: p.design.badge, theme: p.design.theme, showPrices: p.design.show_prices,
    products: p.design.product_ids.map((id) => products.get(id)).filter(Boolean).map((x) => ({ name: x!.name, price: x!.price, image: x!.image_large || x!.image })),
  });
  async function render(p: Post, f: SocialFormat) {
    return canvasToJpeg(await renderSocial(designFor(p), f, loadImage));
  }

  // voorbeeld vernieuwen
  const key = edit ? JSON.stringify(edit.design) + [...products.keys()].join(",") : "";
  useEffect(() => {
    if (!edit) return;
    let stop = false;
    const t = setTimeout(async () => {
      const [feed, story] = await Promise.all([render(edit, "feed"), render(edit, "story")]);
      if (!stop) setPreview({ feed, story });
    }, 400);
    return () => { stop = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // zoeken
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      api(`products?q=${encodeURIComponent(q.trim())}`, "GET", undefined, "campaigns").then((r: Product[]) => { setHits(r); remember(r); }).catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = !!edit && (edit.status === "published" || edit.status === "publishing");
  const setDesign = (d: Partial<Design>) => edit && setEdit({ ...edit, design: { ...edit.design, ...d } });

  /** Afbeeldingen maken + uploaden, dan bewaren / inplannen / plaatsen. */
  async function act(action: "save" | "schedule" | "publish_now") {
    if (!edit) return;
    setBusy(true); setError(""); setInfo("");
    try {
      const feed = await render(edit, "feed");
      const up1 = await api("action", "POST", { action: "upload", data: feed });
      let story = edit.image_story ?? "";
      if (edit.channels.ig_story) story = (await api("action", "POST", { action: "upload", data: await render(edit, "story") })).url;
      const post = { ...edit, image_feed: up1.url, image_story: story };
      const r = await api("action", "POST", { action, post, publish_at: publishAt.replace("T", " ") });
      applyList(r);
      const saved = (r.posts as Post[]).find((p) => p.id === r.saved_id);
      if (saved) setEdit({ ...edit, ...saved, design: edit.design });
      if (action === "save") setInfo("Bewaard als concept.");
      if (action === "schedule") setInfo(`Ingepland op ${fmt(publishAt.replace("T", " "))}.`);
      if (action === "publish_now" && saved) {
        const fails = (Object.keys(CH_LABEL) as (keyof Channels)[]).filter((c) => saved.channels[c] && saved.results?.[c]?.error);
        if (fails.length) await alertDialog(`Niet alles lukte:\n\n${fails.map((c) => `${CH_LABEL[c]}: ${saved.results?.[c]?.error}`).join("\n")}`);
        else setInfo("Geplaatst!");
      }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function listAct(action: string, id: string) {
    setBusy(true); setError("");
    try {
      const r = await api("action", "POST", { action, id });
      applyList(r);
      if (action === "duplicate") { const c = (r.posts as Post[]).find((p) => p.id === r.saved_id); if (c) open(c); }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  function download(dataUrl: string, name: string) {
    const a = document.createElement("a");
    a.href = dataUrl; a.download = name; a.click();
  }

  const chosen = useMemo(() => (edit ? edit.design.product_ids.map((id) => products.get(id)).filter(Boolean) as Product[] : []), [edit, products]);

  if (!ready) return null;

  /* ---------- bewerken ---------- */
  if (edit) {
    const needIg = edit.channels.ig || edit.channels.ig_story;
    return (
      <div>
        <p><button type="button" className="btn secondary" onClick={() => { setEdit(null); setPreview({ feed: "", story: "" }); load(); }}>‹ Alle posts</button></p>
        <h1>{edit.id ? edit.name : "Nieuwe post"} {statusPill(edit)}</h1>
        {error && <p className="warning">{error}</p>}
        {info && <p className="pill cyan" style={{ display: "inline-block" }}>{info}</p>}
        {locked && <div className="card"><b>Deze post is geplaatst.</b> <span className="muted">Aanpassen kan niet meer; maak een kopie in de lijst.</span></div>}
        <div className="camp-grid">
          <fieldset disabled={locked || busy} className="camp-fieldset">
            <div className="card">
              <h2>Inhoud</h2>
              <div className="row">
                <div><label>Naam (enkel voor jou)</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              </div>
              <div className="row">
                <div>
                  <label>Collectie (vult alles in)</label>
                  <select value="" onChange={(e) => { const id = parseInt(e.target.value); if (id) pickCollection(id, edit); }}>
                    <option value="">— kies om in te vullen —</option>
                    {shop?.categories.filter((c) => c.name.startsWith("Collecties >")).map((c) => <option key={c.id} value={c.id}>{c.name.replace("Collecties > ", "")} ({c.count})</option>)}
                  </select>
                </div>
                <div>
                  <label>Actie (vult titel en label in)</label>
                  <select value="" onChange={(e) => pickActie(e.target.value)}>
                    <option value="">— kies om in te vullen —</option>
                    {shop?.acties.map((a) => <option key={a.id} value={a.id}>{a.name || a.label} – {a.label}{a.active ? "" : " (staat uit)"}</option>)}
                  </select>
                </div>
              </div>
              <div className="row">
                <div><label>Titel op de afbeelding</label><input value={edit.design.title} onChange={(e) => setDesign({ title: e.target.value })} /></div>
                <div style={{ flex: "0 0 160px" }}><label>Label (rond)</label><input value={edit.design.badge} placeholder="bv. Nieuw of -10%" maxLength={10} onChange={(e) => setDesign({ badge: e.target.value })} /></div>
              </div>
              <div className="row">
                <div><label>Ondertitel</label><input value={edit.design.subtitle} onChange={(e) => setDesign({ subtitle: e.target.value })} /></div>
              </div>
              <label>Producten op de afbeelding (max. 4)</label>
              {chosen.length > 0 && (
                <div className="camp-chips">
                  {edit.design.product_ids.map((id, i) => (
                    <span key={id} className="camp-chip">
                      {products.get(id)?.image && <img src={products.get(id)!.image} alt="" />}
                      {products.get(id)?.name ?? `#${id}`}
                      <button type="button" title="Naar links" disabled={i === 0} onClick={() => { const n = [...edit.design.product_ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setDesign({ product_ids: n }); }}>‹</button>
                      <button type="button" title="Weghalen" onClick={() => setDesign({ product_ids: edit.design.product_ids.filter((x) => x !== id) })}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              {edit.design.product_ids.length < 4 && <input placeholder="Zoek een product om toe te voegen" value={q} onChange={(e) => setQ(e.target.value)} />}
              {hits.length > 0 && (
                <div className="camp-hits">
                  {hits.filter((h) => !edit.design.product_ids.includes(h.id)).slice(0, 10).map((h) => (
                    <button key={h.id} type="button" className="camp-hit" onClick={() => { setDesign({ product_ids: [...edit.design.product_ids, h.id] }); setQ(""); setHits([]); }}>
                      {h.image ? <img src={h.image} alt="" /> : <span className="camp-noimg" />}
                      <span>{h.name}</span><span className="muted">{euro(h.price)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
                <div>
                  <label>Kleuren</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {SOCIAL_THEMES.map((t) => (
                      <button key={t.key} type="button" className={edit.design.theme === t.key ? "btn" : "btn secondary"} onClick={() => setDesign({ theme: t.key })}>
                        <span className="social-swatch" style={{ background: t.bg, borderColor: t.accent }} /> {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="customers-check" style={{ flex: "0 0 auto" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={edit.design.show_prices} onChange={(e) => setDesign({ show_prices: e.target.checked })} /> Prijzen tonen
                </label>
              </div>
            </div>

            <div className="card">
              <h2>Tekst</h2>
              <textarea rows={10} value={edit.caption} onChange={(e) => setEdit({ ...edit, caption: e.target.value })} />
              <div className="row" style={{ alignItems: "end" }}>
                <div><label>Link (Facebook zet hem onder de tekst)</label><input value={edit.link} onChange={(e) => setEdit({ ...edit, link: e.target.value })} /></div>
                <div style={{ flex: "0 0 auto", display: "flex", gap: 6 }}>
                  <button type="button" className="btn secondary" onClick={() => setEdit({ ...edit, caption: suggestCaption(edit, chosen, { collection: collectionName || undefined, actie: actieLabel || undefined }) })}>Tekst voorstellen</button>
                  <button type="button" className="btn secondary" onClick={() => navigator.clipboard.writeText(edit.caption).then(() => setInfo("Tekst gekopieerd."))}>Kopiëren</button>
                </div>
              </div>
              <p className="muted" style={{ margin: "6px 0 0" }}>{edit.caption.length} tekens · Instagram: max. 2200 tekens en 30 hashtags; links zijn daar niet klikbaar.</p>
            </div>

            <div className="card">
              <h2>Plaatsen</h2>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {(Object.keys(CH_LABEL) as (keyof Channels)[]).map((c) => (
                  <label key={c} className="customers-check">
                    <input type="checkbox" style={{ width: "auto" }} checked={edit.channels[c]} onChange={(e) => setEdit({ ...edit, channels: { ...edit.channels, [c]: e.target.checked } })} />
                    {CH_LABEL[c]}
                    {edit.results?.[c]?.id && (edit.results[c]!.url ? <a href={edit.results[c]!.url} target="_blank" rel="noreferrer"> ✓ bekijken</a> : " ✓")}
                    {edit.results?.[c]?.error && <span className="muted" title={edit.results[c]!.error}> ✗</span>}
                  </label>
                ))}
              </div>
              {!conn?.connected && <p className="warning" style={{ marginTop: 8 }}>Facebook/Instagram is nog niet gekoppeld (zie onderaan de lijst). Je kan de afbeelding wel downloaden en de tekst kopiëren.</p>}
              {conn?.connected && needIg && !conn.ig && <p className="warning" style={{ marginTop: 8 }}>Er is nog geen Instagram-bedrijfsaccount aan de pagina gekoppeld.</p>}
              <div className="row" style={{ alignItems: "end", marginTop: 8 }}>
                <div><label>Inplannen op</label><input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></div>
                <div style={{ flex: "0 0 auto" }}>
                  <button type="button" className="btn secondary" disabled={busy || !publishAt || !conn?.connected} onClick={async () => {
                    if (await confirmDialog(`Post inplannen op ${fmt(publishAt.replace("T", " "))} op ${(Object.keys(CH_LABEL) as (keyof Channels)[]).filter((c) => edit.channels[c]).map((c) => CH_LABEL[c]).join(", ")}?`)) act("schedule");
                  }}>Inplannen</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => act("save")}>Bewaren</button>
                {edit.status === "scheduled" && edit.id && <button type="button" className="btn secondary" disabled={busy} onClick={() => listAct("cancel", edit.id!).then(() => setEdit({ ...edit, status: "draft", publish_at: "" }))}>Planning annuleren</button>}
                <button type="button" className="btn" disabled={busy || !conn?.connected} onClick={async () => {
                  const where = (Object.keys(CH_LABEL) as (keyof Channels)[]).filter((c) => edit.channels[c]).map((c) => CH_LABEL[c]).join(", ");
                  if (!where) return alertDialog("Kies minstens één kanaal.");
                  if (await confirmDialog(`Nu plaatsen op ${where}?\n\nDe post is meteen openbaar zichtbaar.`)) act("publish_now");
                }}>{busy ? "Bezig…" : "Nu plaatsen"}</button>
              </div>
            </div>
          </fieldset>

          <div className="camp-preview">
            <div className="muted" style={{ marginBottom: 6 }}>Feed (Facebook en Instagram, 1080×1080)</div>
            {preview.feed ? <img src={preview.feed} alt="Voorbeeld feed" className="social-img" /> : <div className="social-img social-wait">Afbeelding maken…</div>}
            <div style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
              <button type="button" className="btn secondary" disabled={!preview.feed} onClick={() => download(preview.feed, `${edit.name || "post"}-feed.jpg`)}>Download feed</button>
              <button type="button" className="btn secondary" disabled={!preview.story} onClick={() => download(preview.story, `${edit.name || "post"}-story.jpg`)}>Download story</button>
            </div>
            <div className="muted" style={{ marginBottom: 6 }}>Story (1080×1920)</div>
            {preview.story ? <img src={preview.story} alt="Voorbeeld story" className="social-img social-story" /> : null}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- lijst ---------- */
  return (
    <div>
      <h1>Social</h1>
      <p className="muted">Posts voor Facebook en Instagram: de beheertool maakt de afbeelding (feed en story) en een tekstvoorstel; jij plaatst nu of plant in. Er gaat nooit iets online zonder jouw klik.</p>
      {error && <p className="warning">{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 16px" }}>
        <button type="button" className="btn" onClick={() => open({ ...EMPTY, design: { ...EMPTY.design } })}>+ Nieuwe post</button>
      </div>

      <div className="card">
        <h2>Posts</h2>
        {!posts ? <p className="muted">Laden…</p> : posts.length === 0 ? <p className="muted">Nog geen posts.</p> : (
          <div className="camp-list">
            {posts.map((p) => (
              <div key={p.id} className="camp-row">
                {p.image_feed && <img src={p.image_feed} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: "cover" }} />}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <b>{p.name}</b> {statusPill(p)}
                  <div className="muted" style={{ fontSize: 13 }}>
                    {(Object.keys(CH_LABEL) as (keyof Channels)[]).filter((c) => p.channels[c]).map((c) => (
                      <span key={c} style={{ marginRight: 10 }}>
                        {CH_LABEL[c]}{p.results?.[c]?.id ? (p.results[c]!.url ? <> <a href={p.results[c]!.url} target="_blank" rel="noreferrer">✓</a></> : " ✓") : p.results?.[c]?.error ? " ✗" : ""}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn secondary" onClick={() => open(p)}>{p.status === "published" ? "Bekijken" : "Openen"}</button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => listAct("duplicate", p.id!)}>Kopie</button>
                  {p.status !== "published" && p.status !== "partial" && (
                    <button type="button" className="btn danger" disabled={busy} onClick={async () => { if (await confirmDialog(`Post "${p.name}" verwijderen?${p.status === "scheduled" ? "\n\nDe planning vervalt." : ""}`)) listAct("delete", p.id!); }}>✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {conn && <ConnectionCard conn={conn} busy={busy} onResult={applyList} setBusy={setBusy} />}
    </div>
  );
}

/* ---------- koppeling met Meta ---------- */

function ConnectionCard({ conn, busy, setBusy, onResult }: { conn: Connection; busy: boolean; setBusy: (b: boolean) => void; onResult: (r: any) => void }) {
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(!conn.connected);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg("");
    try {
      onResult(await api("action", "POST", { action, ...extra }));
      if (action === "connect") { setSecret(""); setToken(""); setShow(false); setMsg("Gekoppeld."); }
      if (action === "refresh_ig") setMsg("Nagekeken.");
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Koppeling met Facebook en Instagram</h2>
      {conn.connected ? (
        <p>
          Facebook-pagina: <b>{conn.page_name}</b><br />
          Instagram: {conn.ig ? <b>@{conn.ig_username}</b> : <span className="muted">nog niet gekoppeld aan de pagina</span>}<br />
          <span className="muted" style={{ fontSize: 13 }}>Gekoppeld op {fmt(conn.connected_at)}</span>
        </p>
      ) : <p className="muted">Nog niet gekoppeld. Volg de stappen op de helppagina (Social → Koppelen) en vul hieronder de drie gegevens in.</p>}
      {msg && <p className={msg === "Gekoppeld." || msg === "Nagekeken." ? "pill cyan" : "warning"} style={{ display: msg.length < 20 ? "inline-block" : undefined }}>{msg}</p>}
      {conn.connected && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => run("refresh_ig")}>Instagram opnieuw nakijken</button>
          <button type="button" className="btn secondary" onClick={() => setShow(!show)}>{show ? "Sluiten" : "Opnieuw koppelen"}</button>
          <button type="button" className="btn danger" disabled={busy} onClick={async () => { if (await confirmDialog("Koppeling met Facebook/Instagram verwijderen? Ingeplande posts worden dan niet geplaatst.")) run("disconnect"); }}>Ontkoppelen</button>
        </div>
      )}
      {show && (
        <div style={{ marginTop: 12, maxWidth: 640 }}>
          <div className="row">
            <div><label>App-ID</label><input className="mono" value={appId} onChange={(e) => setAppId(e.target.value)} autoComplete="off" /></div>
            <div><label>App-geheim</label><input className="mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" /></div>
          </div>
          <label>Toegangssleutel (uit de Graph API Explorer)</label>
          <input className="mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" />
          {conn.pages.length > 1 && (
            <>
              <label>Pagina</label>
              <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
                <option value="">eerste pagina</option>
                {conn.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}
          <p className="muted" style={{ fontSize: 13 }}>De shop zet de sleutel om naar een paginasleutel die niet verloopt. Het app-geheim en deze sleutel worden niet bewaard.</p>
          <button type="button" className="btn" disabled={busy || !token} onClick={() => run("connect", { app_id: appId, app_secret: secret, user_token: token, page_id: pageId })}>Koppelen</button>
        </div>
      )}
    </div>
  );
}
