"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { authHeader } from "@/lib/productionFiles";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { SOCIAL_THEMES, SocialFormat, canvasToJpeg, renderSlide, renderSocial } from "@/lib/socialImage";

// Social (plugin "3DP Klanten" 1.7.0): een post voor de Facebook-pagina en Instagram maken -- afbeelding (vierkant
// voor de feed, staand voor Stories) + tekst -- en die nu of ingepland plaatsen via de Meta Graph API.
// Zonder koppeling kan je de afbeelding downloaden en de tekst kopiëren om zelf te posten.

type Channels = { fb: boolean; ig: boolean; ig_story: boolean };
type Design = { title: string; subtitle: string; badge: string; theme: string; show_prices: boolean; product_ids: number[]; image?: string; slides?: string[]; logo_corner?: boolean };
type PostType = "image" | "carousel" | "video";
type Result = { id?: string; url?: string; error?: string; pending?: string; at?: string };
type Post = {
  id?: string; type?: PostType; name: string; caption: string; link: string; channels: Channels; design: Design;
  image_feed?: string; image_story?: string; images?: string[]; video?: string;
  status?: "draft" | "scheduled" | "publishing" | "processing" | "published" | "partial" | "failed";
  publish_at?: string; results?: Partial<Record<keyof Channels, Result>>; created?: string; published_at?: string;
};
type Connection = { connected: boolean; page_name: string; page_id: string; ig: boolean; ig_username: string; connected_at: string; pages: { id: string; name: string }[] };
type Product = { id: number; name: string; price: number; image: string; image_large?: string };
type ShopData = { categories: { id: number; name: string; count: number }[]; acties: { id: string; name: string; label: string; active: boolean }[] };

const CH_LABEL: Record<keyof Channels, string> = { fb: "Facebook", ig: "Instagram", ig_story: "Instagram-story" };
const CH_LABEL_VIDEO: Record<keyof Channels, string> = { fb: "Facebook-video", ig: "Instagram-Reel", ig_story: "Instagram-story (video)" };
const TYPES: { value: PostType; label: string; hint: string }[] = [
  { value: "image", label: "Afbeelding", hint: "Eén afbeelding (feed) en eventueel een story." },
  { value: "carousel", label: "Carrousel", hint: "Een titelafbeelding + één slide per product of eigen foto (max. 10); op Facebook een post met meerdere foto's." },
  { value: "video", label: "Video", hint: "Jouw video (MP4/MOV, max. 200 MB) als Facebook-video, Instagram-Reel en/of video-story. Best staand 9:16, 3 s tot 3 min." },
];
const CHUNK = 600 * 1024;

const EMPTY: Post = {
  type: "image", name: "Nieuwe post", caption: "", link: "https://3dprintforyou.be/",
  channels: { fb: true, ig: false, ig_story: false },
  design: { title: "", subtitle: "", badge: "", theme: "warm", show_prices: true, product_ids: [], logo_corner: true },
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
    case "processing": return <span className="pill yellow">video wordt verwerkt…</span>;
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
  const [slides, setSlides] = useState<string[]>([]);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [publishAt, setPublishAt] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [actieLabel, setActieLabel] = useState("");
  const [logo, setLogo] = useState("");
  const bitmaps = useRef(new Map<string, Promise<ImageBitmap | null>>());

  function applyList(r: { posts: Post[]; connection: Connection; logo?: string }) {
    setPosts(r.posts); setConn(r.connection);
    if (r.logo) setLogo(r.logo);
  }

  /** Eigen afbeelding uploaden (logo of foto): verkleinen tot max. 1600 px, PNG blijft PNG (transparantie). */
  async function uploadOwnImage(file: File | null) {
    if (!file || !edit) return;
    setBusy(true); setError("");
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      (c.getContext("2d") as CanvasRenderingContext2D).drawImage(bmp, 0, 0, c.width, c.height);
      const png = file.type === "image/png";
      const data = png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
      const r = await api("action", "POST", { action: "upload", asset: true, data });
      setEdit({ ...edit, design: { ...edit.design, image: r.url } });
    } catch (e: any) { setError(`Afbeelding uploaden mislukt: ${e.message}`); }
    setBusy(false);
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
    image: p.design.image || undefined,
    logo: p.design.logo_corner !== false && logo ? logo : undefined,
  });
  async function render(p: Post, f: SocialFormat) {
    return canvasToJpeg(await renderSocial(designFor(p), f, loadImage));
  }

  // voorbeeld vernieuwen
  const key = edit ? JSON.stringify(edit.design) + edit.type + logo + [...products.keys()].join(",") : "";
  useEffect(() => {
    if (!edit) return;
    let stop = false;
    const t = setTimeout(async () => {
      if (edit.type === "video") { setPreview({ feed: "", story: "" }); setSlides([]); return; }
      const [feed, story] = await Promise.all([render(edit, "feed"), render(edit, "story")]);
      const sl = edit.type === "carousel" ? await renderSlides(edit) : [];
      if (!stop) { setPreview({ feed, story }); setSlides(sl); }
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

  const locked = !!edit && (edit.status === "published" || edit.status === "publishing" || edit.status === "processing");
  const labels = edit?.type === "video" ? CH_LABEL_VIDEO : CH_LABEL;
  const maxProducts = edit?.type === "carousel" ? 9 : 4;
  const setDesign = (d: Partial<Design>) => edit && setEdit({ ...edit, design: { ...edit.design, ...d } });

  /** Slides van een carrousel (na de titelafbeelding): producten, dan eigen foto's; samen max. 9. */
  function slideSpecs(p: Post) {
    const prods = p.design.product_ids.map((id) => products.get(id)).filter(Boolean) as Product[];
    return [
      ...prods.map((x) => ({ kind: "product" as const, name: x.name, price: x.price, image: x.image_large || x.image })),
      ...(p.design.slides ?? []).map((u) => ({ kind: "photo" as const, image: u })),
    ].slice(0, 9);
  }
  async function renderSlides(p: Post) {
    const specs = slideSpecs(p);
    const total = specs.length + 1;
    const lg = p.design.logo_corner !== false && logo ? logo : undefined;
    return Promise.all(specs.map(async (s, i) => canvasToJpeg(await renderSlide(s, { theme: p.design.theme, showPrices: p.design.show_prices, logo: lg }, i + 1, total, loadImage))));
  }

  /** Eigen foto's als extra carrouselslides (zelfde verkleining als bij "Eigen afbeelding"). */
  async function addSlidePhotos(files: FileList | null) {
    if (!files || !edit) return;
    setBusy(true); setError("");
    const urls: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, 9)) {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
        (c.getContext("2d") as CanvasRenderingContext2D).drawImage(bmp, 0, 0, c.width, c.height);
        const r = await api("action", "POST", { action: "upload", asset: true, data: c.toDataURL("image/jpeg", 0.9) });
        urls.push(r.url);
      }
    } catch (e: any) { setError(`Foto uploaden mislukt: ${e.message}`); }
    setEdit((cur) => (cur ? { ...cur, design: { ...cur.design, slides: [...(cur.design.slides ?? []), ...urls].slice(0, 9) } } : cur));
    setBusy(false);
  }

  /** Video in stukken naar de shop sturen (grote bestanden passen niet in één verzoek). */
  async function uploadVideo(file: File | null) {
    if (!file || !edit) return;
    if (file.size > 200 * 1024 * 1024) return alertDialog("Die video is groter dan 200 MB. Maak hem korter of kleiner (bv. 1080p).");
    setBusy(true); setError(""); setVideoProgress(0);
    try {
      const start = await api("action", "POST", { action: "video_upload", step: "start" });
      for (let off = 0; off < file.size; off += CHUNK) {
        const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await api("action", "POST", { action: "video_upload", step: "chunk", upload_id: start.upload_id, offset: off, data: btoa(bin) });
        setVideoProgress(Math.min(100, Math.round(((off + buf.length) / file.size) * 100)));
      }
      const done = await api("action", "POST", { action: "video_upload", step: "finish", upload_id: start.upload_id });
      setEdit((cur) => (cur ? { ...cur, video: done.url } : cur));
    } catch (e: any) { setError(`Video uploaden mislukt: ${e.message}`); }
    setVideoProgress(null);
    setBusy(false);
  }

  /** Afbeeldingen maken + uploaden, dan bewaren / inplannen / plaatsen. */
  async function act(action: "save" | "schedule" | "publish_now") {
    if (!edit) return;
    setBusy(true); setError(""); setInfo("");
    try {
      const up = async (data: string) => (await api("action", "POST", { action: "upload", data })).url as string;
      let post: Post = { ...edit };
      if (edit.type !== "video") {
        const feedUrl = await up(await render(edit, "feed"));
        let story = edit.image_story ?? "";
        if (edit.channels.ig_story) story = await up(await render(edit, "story"));
        post = { ...post, image_feed: feedUrl, image_story: story };
        if (edit.type === "carousel") {
          const rest: string[] = [];
          for (const s of await renderSlides(edit)) rest.push(await up(s));
          post.images = [feedUrl, ...rest];
        } else post.images = [];
      } else {
        post = { ...post, image_feed: "", images: [] };
      }
      const r = await api("action", "POST", { action, post, publish_at: publishAt.replace("T", " ") });
      applyList(r);
      const saved = (r.posts as Post[]).find((p) => p.id === r.saved_id);
      if (saved) setEdit({ ...edit, ...saved, design: edit.design });
      if (action === "save") setInfo("Bewaard als concept.");
      if (action === "schedule") setInfo(`Ingepland op ${fmt(publishAt.replace("T", " "))}.`);
      if (action === "publish_now" && saved) {
        const fails = (Object.keys(CH_LABEL) as (keyof Channels)[]).filter((c) => saved.channels[c] && saved.results?.[c]?.error);
        if (fails.length) await alertDialog(`Niet alles lukte:\n\n${fails.map((c) => `${CH_LABEL[c]}: ${saved.results?.[c]?.error}`).join("\n")}`);
        else if (saved.status === "processing") setInfo("Facebook is geplaatst of bezig; Instagram verwerkt de video nog. De shop plaatst hem zodra hij klaar is (binnen 10 minuten nagekeken), of klik later op Nu nakijken.");
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
              <label>Soort post</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TYPES.map((t) => (
                  <button key={t.value} type="button" className={(edit.type ?? "image") === t.value ? "btn" : "btn secondary"} onClick={() => setEdit({ ...edit, type: t.value })}>{t.label}</button>
                ))}
              </div>
              <p className="muted" style={{ margin: "6px 0 10px", fontSize: 13 }}>{TYPES.find((t) => t.value === (edit.type ?? "image"))?.hint}</p>
              {edit.type === "video" && (
                <div style={{ marginBottom: 6 }}>
                  <label>Video</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <label className="btn secondary" style={{ cursor: "pointer", margin: 0 }}>
                      {edit.video ? "Andere video kiezen" : "Video kiezen"}
                      <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" style={{ display: "none" }} onChange={(e) => { uploadVideo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                    </label>
                    {videoProgress !== null && <span className="muted">Uploaden… {videoProgress}%</span>}
                    {edit.video && videoProgress === null && <span className="muted">✓ video staat klaar</span>}
                  </div>
                </div>
              )}
              {edit.type !== "video" && (<>
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
              <label>{edit.type === "carousel" ? "Eigen afbeelding op de titelafbeelding (bv. je logo)" : "Eigen afbeelding (bv. je logo of een foto), in plaats van producten"}</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                {edit.design.image && <img src={edit.design.image} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 6, background: "#fff" }} />}
                <label className="btn secondary" style={{ cursor: "pointer", margin: 0 }}>
                  Afbeelding kiezen
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => { uploadOwnImage(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                </label>
                {logo && <button type="button" className="btn secondary" onClick={() => setDesign({ image: logo })}>Logo van de shop</button>}
                {edit.design.image && <button type="button" className="btn secondary" onClick={() => setDesign({ image: "" })}>Weghalen (producten tonen)</button>}
              </div>
              <label>{edit.type === "carousel" ? `Producten: elk een eigen slide (max. ${maxProducts}); de eerste 4 ook op de titelafbeelding` : `Producten op de afbeelding (max. ${maxProducts})`}{edit.type !== "carousel" && edit.design.image ? ": worden niet getoond zolang er een eigen afbeelding is" : ""}</label>
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
              {edit.design.product_ids.length < maxProducts && <input placeholder="Zoek een product om toe te voegen" value={q} onChange={(e) => setQ(e.target.value)} />}
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
                <label className="customers-check" style={{ flex: "0 0 auto" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={edit.design.logo_corner !== false} disabled={!logo} onChange={(e) => setDesign({ logo_corner: e.target.checked })} /> Logo in de hoek
                </label>
              </div>
              {edit.type === "carousel" && (
                <div style={{ marginTop: 10 }}>
                  <label>Eigen foto's als extra slides (bv. foto's van je producten of werkplaats)</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {(edit.design.slides ?? []).map((u) => (
                      <span key={u} className="camp-chip">
                        <img src={u} alt="" />
                        <button type="button" title="Weghalen" onClick={() => setDesign({ slides: (edit.design.slides ?? []).filter((x) => x !== u) })}>✕</button>
                      </span>
                    ))}
                    <label className="btn secondary" style={{ cursor: "pointer", margin: 0 }}>
                      Foto's toevoegen
                      <input type="file" multiple accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => { addSlidePhotos(e.target.files); e.target.value = ""; }} />
                    </label>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{slideSpecs(edit).length + 1} van max. 10 afbeeldingen (titelafbeelding + {slideSpecs(edit).length} slides).</p>
                </div>
              )}
              </>)}
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
                    {labels[c]}
                    {edit.results?.[c]?.pending && <span className="muted"> (wordt verwerkt…)</span>}
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
                    if (await confirmDialog(`Post inplannen op ${fmt(publishAt.replace("T", " "))} op ${(Object.keys(labels) as (keyof Channels)[]).filter((c) => edit.channels[c]).map((c) => labels[c]).join(", ")}?`)) act("schedule");
                  }}>Inplannen</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => act("save")}>Bewaren</button>
                {edit.status === "scheduled" && edit.id && <button type="button" className="btn secondary" disabled={busy} onClick={() => listAct("cancel", edit.id!).then(() => setEdit({ ...edit, status: "draft", publish_at: "" }))}>Planning annuleren</button>}
                {edit.status === "processing" && edit.id && <button type="button" className="btn secondary" onClick={async () => { await listAct("check", edit.id!); const p = (await api("list")).posts.find((x: Post) => x.id === edit.id); if (p) setEdit({ ...edit, ...p, design: edit.design }); }}>Nu nakijken</button>}
                <button type="button" className="btn" disabled={busy || !conn?.connected} onClick={async () => {
                  const where = (Object.keys(labels) as (keyof Channels)[]).filter((c) => edit.channels[c]).map((c) => labels[c]).join(", ");
                  if (!where) return alertDialog("Kies minstens één kanaal.");
                  if (await confirmDialog(`Nu plaatsen op ${where}?\n\nDe post is meteen openbaar zichtbaar.`)) act("publish_now");
                }}>{busy ? "Bezig…" : "Nu plaatsen"}</button>
              </div>
            </div>
          </fieldset>

          <div className="camp-preview">
            {edit.type === "video" ? (
              edit.video ? <video src={edit.video} controls className="social-img social-story" /> : <div className="social-img social-wait">Kies een video</div>
            ) : (<>
            <div className="muted" style={{ marginBottom: 6 }}>{edit.type === "carousel" ? "Titelafbeelding (1/" + (slides.length + 1) + ")" : "Feed (Facebook en Instagram, 1080×1080)"}</div>
            {preview.feed ? <img src={preview.feed} alt="Voorbeeld feed" className="social-img" /> : <div className="social-img social-wait">Afbeelding maken…</div>}
            <div style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
              <button type="button" className="btn secondary" disabled={!preview.feed} onClick={() => download(preview.feed, `${edit.name || "post"}-feed.jpg`)}>Download feed</button>
              <button type="button" className="btn secondary" disabled={!preview.story} onClick={() => download(preview.story, `${edit.name || "post"}-story.jpg`)}>Download story</button>
            </div>
            {edit.type === "carousel" && slides.length > 0 && (
              <>
                <div className="muted" style={{ marginBottom: 6 }}>Slides</div>
                <div className="social-slides">
                  {slides.map((s, i) => <img key={i} src={s} alt={`Slide ${i + 2}`} title="Klik om te downloaden" onClick={() => download(s, `${edit.name || "post"}-${i + 2}.jpg`)} />)}
                </div>
              </>
            )}
            <div className="muted" style={{ margin: "12px 0 6px" }}>Story (1080×1920){edit.type === "carousel" ? ": een carrousel bestaat niet als story, de story toont de titelafbeelding" : ""}</div>
            {preview.story ? <img src={preview.story} alt="Voorbeeld story" className="social-img social-story" /> : null}
            </>)}
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
                {p.image_feed ? <img src={p.image_feed} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: "cover" }} /> : p.type === "video" ? <span className="social-thumb">🎬</span> : null}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <b>{p.name}</b> {p.type === "carousel" ? <span className="muted">· carrousel ({p.images?.length ?? 0})</span> : p.type === "video" ? <span className="muted">· video</span> : null} {statusPill(p)}
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
