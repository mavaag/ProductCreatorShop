"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { Collection } from "@/lib/types";
import { alertDialog, confirmDialog } from "@/components/DialogHost";
import { uploadProductImage } from "@/lib/uploadImage";
import { formatSeason, isHighlighted, isValidMmDd } from "@/lib/collections";
import { COLLECTION_BACKGROUNDS, backgroundCss } from "@/lib/collectionBackgrounds";

type Form = {
  name: string;
  description: string;
  banner_url: string;
  start_day: string;
  start_month: string;
  end_day: string;
  end_month: string;
  highlight: Collection["highlight"];
  sort_order: string;
  background: string;
  background_url: string;
  background_color: string;
};
const BLANK: Form = {
  name: "", description: "", banner_url: "", start_day: "", start_month: "", end_day: "", end_month: "", highlight: "season", sort_order: "0",
  background: "none", background_url: "", background_color: "",
};

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** Veelgebruikte collecties met een voorstel voor het seizoen (pas gerust aan). */
const PRESETS: { name: string; start: string; end: string; description: string }[] = [
  { name: "Kerst", start: "11-15", end: "12-26", description: "Cadeaus en decoratie voor de feestdagen." },
  { name: "Sinterklaas", start: "11-01", end: "12-06", description: "Leuke cadeautjes voor in de schoen." },
  { name: "Halloween", start: "10-01", end: "10-31", description: "Griezelige decoratie en gadgets." },
  { name: "Valentijn", start: "01-20", end: "02-14", description: "Gepersonaliseerde cadeaus voor je lief." },
  { name: "Pasen", start: "03-01", end: "04-21", description: "Paasdecoratie en cadeautjes." },
  { name: "Moederdag", start: "04-20", end: "05-12", description: "Een persoonlijk cadeau voor mama." },
  { name: "Vaderdag", start: "05-20", end: "06-15", description: "Een persoonlijk cadeau voor papa." },
];

function splitMmDd(v: string | null): [string, string] {
  if (!isValidMmDd(v)) return ["", ""];
  return [String(Number((v as string).slice(3))), String(Number((v as string).slice(0, 2)))];
}
function joinMmDd(day: string, month: string): string | null {
  if (!day || !month) return null;
  const v = `${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidMmDd(v) ? v : null;
}
function toForm(c: Collection): Form {
  const [sd, sm] = splitMmDd(c.season_start);
  const [ed, em] = splitMmDd(c.season_end);
  return {
    name: c.name,
    description: c.description ?? "",
    banner_url: c.banner_url ?? "",
    start_day: sd,
    start_month: sm,
    end_day: ed,
    end_month: em,
    highlight: c.highlight,
    sort_order: String(c.sort_order ?? 0),
    background: c.background ?? "none",
    background_url: c.background_url ?? "",
    background_color: c.background_color ?? "",
  };
}
function firstImage(urls: string | null | undefined): string {
  return String(urls ?? "").split(",").map((u) => u.trim()).filter(Boolean)[0] ?? "";
}

type ProductLite = { id: string; name: string; sku: string; image_url: string; published: boolean; updated_at: string; last_exported_at: string | null };

/** Product heeft wijzigingen die nog niet in de shop staan (zelfde regel als het label "Gewijzigd" op Producten). */
function productChanged(p: ProductLite | undefined): boolean {
  return !!p && (!p.last_exported_at || p.updated_at > p.last_exported_at);
}

/** Dag + maand kiezen (zonder jaar: een seizoen komt elk jaar terug). */
function DayMonth({ day, month, onChange }: { day: string; month: string; onChange: (day: string, month: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select value={day} onChange={(e) => onChange(e.target.value, month)} style={{ width: 80 }}>
        <option value="">dag</option>
        {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select value={month} onChange={(e) => onChange(day, e.target.value)}>
        <option value="">maand</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1)}>{m}</option>
        ))}
      </select>
    </div>
  );
}

/** Achtergrond van de collectiepagina: thema, eigen afbeelding of geen -- met voorbeeld. */
function BackgroundField({ form, setForm }: { form: Form; setForm: (f: Form) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const theme = COLLECTION_BACKGROUNDS.find((t) => t.key === form.background);
  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setForm({ ...form, background: "custom", background_url: await uploadProductImage(file) });
    } catch (e: any) {
      setError("Opladen mislukt: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="coll-bg-field">
      <div className="coll-bg-preview" style={backgroundCss(form.background, form.background_url, form.background_color)}>
        <div className="coll-bg-card" />
        <div className="coll-bg-card" />
        <div className="coll-bg-card" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <select value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })}>
          <option value="none">Geen (gewone achtergrond van de shop)</option>
          {COLLECTION_BACKGROUNDS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
          <option value="custom">Eigen afbeelding</option>
        </select>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <label className="btn secondary" style={{ margin: 0, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Opladen..." : "Eigen afbeelding opladen"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                upload(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {form.background !== "none" && (
            <>
              <input
                type="color"
                value={form.background_color || theme?.color || "#eef2f5"}
                onChange={(e) => setForm({ ...form, background_color: e.target.value })}
                title="Achtergrondkleur"
                style={{ width: 44, height: 32, padding: 2 }}
              />
              {form.background_color && (
                <button type="button" className="btn secondary" onClick={() => setForm({ ...form, background_color: "" })}>
                  Standaardkleur
                </button>
              )}
            </>
          )}
        </div>
        {form.background === "custom" && (
          <input style={{ marginTop: 6 }} placeholder="of plak een afbeeldings-URL" value={form.background_url} onChange={(e) => setForm({ ...form, background_url: e.target.value })} />
        )}
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Achter de producten op de collectiepagina. Eigen afbeelding: rustig beeld, wordt over de hele pagina uitgerekt (bv. 1920 × 1080).
        </p>
        {error && <p style={{ color: "var(--rust)", fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
      </div>
    </div>
  );
}

function BannerField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await uploadProductImage(file));
    } catch (e: any) {
      setError("Opladen mislukt: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="coll-banner-field">
      <div className="coll-banner-preview">{value ? <img src={value} alt="" /> : <span className="muted">Geen banner</span>}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label className="btn secondary" style={{ margin: 0, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Opladen..." : "Foto opladen"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                upload(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {value && (
            <button type="button" className="btn secondary" onClick={() => onChange("")} disabled={busy}>
              Wissen
            </button>
          )}
        </div>
        <input style={{ marginTop: 6 }} placeholder="of plak een afbeeldings-URL" value={value} onChange={(e) => onChange(e.target.value)} />
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Breed beeld werkt het best (bv. 1600 × 500).</p>
        {error && <p style={{ color: "var(--rust)", fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
      </div>
    </div>
  );
}

function CollectionForm({ form, setForm, onSubmit, onCancel, submitLabel, busy }: { form: Form; setForm: (f: Form) => void; onSubmit: () => void; onCancel?: () => void; submitLabel: string; busy: boolean }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="row">
        <div>
          <label>Naam</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="bv. Kerst" />
        </div>
        <div>
          <label>Zichtbaar in de shop</label>
          <select value={form.highlight} onChange={(e) => setForm({ ...form, highlight: e.target.value as Form["highlight"] })}>
            <option value="season">Tijdens het seizoen</option>
            <option value="always">Altijd</option>
            <option value="never">Nooit (enkel via de rechtstreekse link)</option>
          </select>
        </div>
      </div>
      <label>Tekst (bovenaan de collectiepagina in de shop)</label>
      <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="row">
        <div>
          <label>Seizoen van</label>
          <DayMonth day={form.start_day} month={form.start_month} onChange={(d, m) => setForm({ ...form, start_day: d, start_month: m })} />
        </div>
        <div>
          <label>tot en met</label>
          <DayMonth day={form.end_day} month={form.end_month} onChange={(d, m) => setForm({ ...form, end_day: d, end_month: m })} />
        </div>
        <div style={{ maxWidth: 120 }}>
          <label>Volgorde</label>
          <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
        </div>
      </div>
      <label>Banner</label>
      <BannerField value={form.banner_url} onChange={(url) => setForm({ ...form, banner_url: url })} />
      <label>Achtergrond van de collectiepagina</label>
      <BackgroundField form={form} setForm={setForm} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Opslaan..." : submitLabel}</button>
        {onCancel && (
          <button className="btn secondary" type="button" onClick={onCancel}>Annuleren</button>
        )}
      </div>
    </form>
  );
}

export default function CollectionsPage() {
  const ready = useAuthGuard();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({}); // collection_id -> product_ids
  const [removed, setRemoved] = useState<Record<string, string[]>>({}); // collection_id -> uit de collectie gehaald, nog niet gesynct
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<Form>(BLANK);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Form>(BLANK);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState<{ id: string; text: string } | null>(null);

  async function load() {
    const [c, pc, p] = await Promise.all([
      supabase.from("collections").select("*").order("sort_order").order("name"),
      supabase.from("product_collections").select("product_id, collection_id, removed_at"),
      supabase.from("products").select("id, name, sku, image_url, published, updated_at, last_exported_at").order("name"),
    ]);
    if (c.error) {
      setLoadError(c.error.message);
      return;
    }
    setLoadError("");
    setCollections((c.data ?? []) as Collection[]);
    const m: Record<string, string[]> = {};
    const r: Record<string, string[]> = {};
    for (const row of (pc.data ?? []) as { product_id: string; collection_id: string; removed_at: string | null }[]) {
      ((row.removed_at ? r : m)[row.collection_id] ??= []).push(row.product_id);
    }
    setMembers(m);
    setRemoved(r);
    setProducts((p.data ?? []) as ProductLite[]);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Wat van een collectie nog niet in de shop staat: gewijzigde producten (ook net weggehaalde) en/of de collectie zelf. */
  function pendingFor(c: Collection): { productIds: string[]; collectionChanged: boolean } {
    const ids = [...(members[c.id] ?? []), ...(removed[c.id] ?? [])];
    return {
      productIds: Array.from(new Set(ids)).filter((id) => productChanged(productById.get(id))),
      collectionChanged: !c.synced_at || c.updated_at > c.synced_at,
    };
  }

  function payload(f: Form) {
    return {
      name: f.name.trim(),
      description: f.description.trim(),
      banner_url: f.banner_url.trim() || null,
      season_start: joinMmDd(f.start_day, f.start_month),
      season_end: joinMmDd(f.end_day, f.end_month),
      highlight: f.highlight,
      sort_order: Number.parseInt(f.sort_order, 10) || 0,
      background: f.background === "custom" && !f.background_url.trim() ? "none" : f.background,
      background_url: f.background === "custom" ? f.background_url.trim() || null : null,
      background_color: f.background !== "none" ? f.background_color || null : null,
      updated_at: new Date().toISOString(),
    };
  }

  function seasonProblem(f: Form): string {
    const a = joinMmDd(f.start_day, f.start_month);
    const b = joinMmDd(f.end_day, f.end_month);
    const anyFilled = f.start_day || f.start_month || f.end_day || f.end_month;
    if (anyFilled && (!a || !b)) return "Vul het seizoen volledig in (dag én maand, van en tot), of laat het helemaal leeg.";
    if (f.highlight === "season" && !a) return 'Kies een seizoen, of zet "Zichtbaar in de shop" op Altijd of Nooit.';
    return "";
  }

  async function addCollection() {
    const problem = seasonProblem(form);
    if (problem) return alertDialog(problem);
    setBusy(true);
    const { data, error } = await supabase.from("collections").insert(payload(form)).select("id").single();
    setBusy(false);
    if (error) return alertDialog(error.message.includes("duplicate") ? `Er bestaat al een collectie "${form.name.trim()}".` : error.message);
    setForm(BLANK);
    setShowNew(false);
    setMessage(`Collectie "${form.name.trim()}" aangemaakt. Voeg nu producten toe.`);
    await load();
    setOpenId(data.id);
  }

  async function saveEdit() {
    if (!editingId) return;
    const problem = seasonProblem(editForm);
    if (problem) return alertDialog(problem);
    setBusy(true);
    const { error } = await supabase.from("collections").update(payload(editForm)).eq("id", editingId);
    setBusy(false);
    if (error) return alertDialog(error.message.includes("duplicate") ? `Er bestaat al een collectie "${editForm.name.trim()}".` : error.message);
    // Naam gewijzigd: de categorie wordt in de shop hernoemd, de producten blijven eraan gekoppeld (geen product-sync nodig).
    setEditingId(null);
    setMessage('Collectie opgeslagen. Klik "Naar de shop" om ze in de shop bij te werken.');
    load();
  }

  async function removeCollection(c: Collection) {
    const n = members[c.id]?.length ?? 0;
    const ok = await confirmDialog(
      `Collectie "${c.name}" verwijderen?\n\n${n} product(en) worden uit de collectie gehaald (de producten zelf blijven bestaan).` +
        (c.woo_category_id ? `\nDe collectiepagina in de shop (categorie "Collecties > ${c.name}") wordt ook verwijderd.` : ""),
      { confirmLabel: "Verwijderen", danger: true }
    );
    if (!ok) return;
    setBusy(true);
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch("/api/collections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ id: c.id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alertDialog(body.error ?? `Verwijderen mislukt (${res.status}).`);
    setMessage(`Collectie "${c.name}" verwijderd${body.note ? ` (${body.note})` : ""}.`);
    if (openId === c.id) setOpenId(null);
    load();
  }

  /**
   * "Naar de shop": werkt de collectie in WooCommerce bij en synchroniseert enkel de producten met wijzigingen
   * (toegevoegd, weggehaald of aangepast). Alles gesynct: niets te doen.
   */
  async function syncCollection(c: Collection) {
    const pending = pendingFor(c);
    if (pending.productIds.length === 0 && !pending.collectionChanged) {
      setMessage(`"${c.name}" staat al helemaal in de shop.`);
      return;
    }
    const what = [
      pending.collectionChanged ? "de collectiepagina (tekst, banner, seizoen)" : "",
      pending.productIds.length ? `${pending.productIds.length} gewijzigd(e) product(en) (ook hun prijs, beschrijving, categorieën en foto's)` : "",
    ]
      .filter(Boolean)
      .join(" en ");
    if (!(await confirmDialog(`Collectie "${c.name}" naar de shop sturen?\n\nWordt bijgewerkt in WooCommerce: ${what}.`))) return;
    setBusy(true);
    setMessage("");
    try {
      const { data: s } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}` };
      setSyncing({ id: c.id, text: "Voorbereiden..." });
      const productIds = pending.productIds;
      const agg = { updated: 0, unchanged: 0, missing: [] as string[], notes: [] as string[], errors: [] as string[] };
      let offset = 0;
      for (let guard = 0; guard < 1000; guard++) {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers,
          body: JSON.stringify(
            productIds.length > 0
              ? { createMissing: false, dryRun: false, productIds, offset, limit: 12 }
              : { createMissing: false, dryRun: false, collectionsOnly: true }
          ),
        });
        const b = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(b.error ?? `Synchronisatie mislukt (${res.status})`);
        agg.updated += b.updated ?? 0;
        agg.unchanged += b.unchanged ?? 0;
        agg.missing.push(...(b.missingProducts ?? []));
        agg.notes.push(...(b.notes ?? []));
        agg.errors.push(...(b.errors ?? []));
        const done = (b.offset ?? offset) + (b.processed ?? 0);
        setSyncing({ id: c.id, text: productIds.length ? `Synchroniseren... ${Math.min(done, productIds.length)}/${productIds.length}` : "Collectie bijwerken..." });
        if (b.done || b.nextOffset == null) break;
        offset = b.nextOffset;
      }
      const parts = [productIds.length ? `${productIds.length} product(en) gesynchroniseerd` : "collectiepagina bijgewerkt"];
      if (agg.missing.length) parts.push(`nog niet in de shop (eerst aanmaken via Producten): ${agg.missing.join(", ")}`);
      if (agg.errors.length) parts.push(`fouten: ${agg.errors.join("; ")}`);
      setMessage(`"${c.name}" naar de shop gestuurd: ${parts.join(" -- ")}.`);
      if (agg.errors.length) await alertDialog(`Niet alles lukte:\n\n${agg.errors.join("\n")}`);
    } catch (e: any) {
      setMessage(`Naar de shop mislukt: ${e?.message ?? String(e)}`);
    } finally {
      setSyncing(null);
      setBusy(false);
      load();
    }
  }

  /** Markeert producten als gewijzigd, zodat ze bij de volgende sync hun (collectie)categorieën meekrijgen. */
  async function touchProducts(ids: string[]) {
    if (ids.length === 0) return;
    await supabase.from("products").update({ updated_at: new Date().toISOString() }).in("id", ids);
  }

  async function addProduct(collectionId: string, productId: string) {
    const { error } = await supabase.from("product_collections").upsert({ collection_id: collectionId, product_id: productId, removed_at: null }, { onConflict: "product_id,collection_id" });
    if (error) return alertDialog(error.message);
    await touchProducts([productId]);
    load();
  }

  async function removeProduct(collectionId: string, productId: string) {
    // Niet meteen wissen: removed_at zorgt dat "Naar de shop" de categorie in de shop weghaalt.
    const { error } = await supabase.from("product_collections").update({ removed_at: new Date().toISOString() }).eq("collection_id", collectionId).eq("product_id", productId);
    if (error) return alertDialog(error.message);
    await touchProducts([productId]);
    load();
  }

  if (!ready) return null;

  if (loadError) {
    return (
      <div>
        <h1>Collecties</h1>
        <div className="warning">
          Collecties kunnen niet geladen worden: {loadError}
          <br />
          Is migratie <code>supabase/migration_035_collections.sql</code> al uitgevoerd?
        </div>
      </div>
    );
  }

  const highlighted = collections.filter((c) => isHighlighted(c));
  const openCollection = collections.find((c) => c.id === openId) ?? null;
  const openMembers = openCollection ? members[openCollection.id] ?? [] : [];
  const q = search.trim().toLowerCase();
  const candidates = openCollection
    ? products.filter((p) => !openMembers.includes(p.id) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))).slice(0, 40)
    : [];

  return (
    <div>
      <h1>Collecties</h1>
      <p className="sub">
        Thema&apos;s zoals Kerst, Halloween of Moederdag. Elke collectie wordt in de shop een eigen pagina (categorie <i>Collecties &gt; naam</i>) met tekst en banner.
        Een product kan in meerdere collecties zitten en blijft ook in zijn gewone categorie. Met <b>Naar de shop</b> stuur je een collectie en haar producten meteen naar de shop (ook de gewone <Link href="/products">synchronisatie</Link> neemt ze mee).
      </p>

      {message && <p className="mono" style={{ marginBottom: 16 }}>{message}</p>}

      <div className="coll-toolbar">
        <span className="muted">
          Nu zichtbaar in de shop: {highlighted.length > 0 ? highlighted.map((c) => c.name).join(", ") : "geen"}
        </span>
        {!showNew && (
          <button className="btn" onClick={() => setShowNew(true)} style={{ marginLeft: "auto" }}>
            Nieuwe collectie
          </button>
        )}
      </div>

      {showNew && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Nieuwe collectie</h2>
          <div className="coll-presets">
            <span className="muted">Snel starten:</span>
            {PRESETS.filter((pr) => !collections.some((c) => c.name.toLowerCase() === pr.name.toLowerCase())).map((pr) => (
              <button
                key={pr.name}
                type="button"
                className="btn secondary"
                onClick={() => {
                  const [sd, sm] = splitMmDd(pr.start);
                  const [ed, em] = splitMmDd(pr.end);
                  const bg = COLLECTION_BACKGROUNDS.some((t) => t.key === pr.name.toLowerCase()) ? pr.name.toLowerCase() : "none";
                  setForm({ ...BLANK, name: pr.name, description: pr.description, start_day: sd, start_month: sm, end_day: ed, end_month: em, background: bg });
                }}
              >
                {pr.name}
              </button>
            ))}
          </div>
          <CollectionForm form={form} setForm={setForm} onSubmit={addCollection} onCancel={() => { setShowNew(false); setForm(BLANK); }} submitLabel="Collectie aanmaken" busy={busy} />
        </div>
      )}

      {collections.length === 0 && !showNew && <p className="muted">Nog geen collecties. Klik op <b>Nieuwe collectie</b> om te beginnen.</p>}

      <div className="coll-grid">
        {collections.map((c) => {
          const n = members[c.id]?.length ?? 0;
          const season = formatSeason(c);
          const live = isHighlighted(c);
          const pend = pendingFor(c);
          const nPending = pend.productIds.length + (pend.collectionChanged ? 1 : 0);
          if (editingId === c.id) {
            return (
              <div key={c.id} className="card coll-card coll-card-wide">
                <h2 style={{ marginTop: 0 }}>{c.name} bewerken</h2>
                <CollectionForm form={editForm} setForm={setEditForm} onSubmit={saveEdit} onCancel={() => setEditingId(null)} submitLabel="Opslaan" busy={busy} />
              </div>
            );
          }
          return (
            <div key={c.id} className={`card coll-card${openId === c.id ? " open" : ""}`}>
              <div className="coll-banner" style={c.banner_url ? undefined : backgroundCss(c.background, c.background_url, c.background_color)}>
                {c.banner_url ? <img src={c.banner_url} alt="" loading="lazy" /> : <span style={{ color: "#222" }}>{c.name}</span>}
              </div>
              {c.background !== "none" && <div className="coll-bg-strip" style={backgroundCss(c.background, c.background_url, c.background_color)} title="Achtergrond van de collectiepagina" />}
              <div className="coll-body">
                <div className="coll-title">
                  <strong>{c.name}</strong>
                  {live && <span className="pill cyan">Nu zichtbaar</span>}
                </div>
                <div className="muted coll-meta">
                  {season ? `Seizoen ${season}` : "Geen seizoen"}
                  {" · "}
                  {c.highlight === "always" ? "altijd zichtbaar" : c.highlight === "never" ? "verborgen (enkel via link)" : "zichtbaar tijdens het seizoen"}
                </div>
                <div className="muted coll-meta">{n} product{n === 1 ? "" : "en"}</div>
                <div className={`coll-status${nPending ? " pending" : ""}`} title={pend.productIds.map((id) => productById.get(id)?.name).filter(Boolean).join("\n")}>
                  {nPending === 0
                    ? "In de shop ✓"
                    : !c.woo_category_id
                      ? "Nog niet in de shop"
                      : [pend.collectionChanged ? "collectie gewijzigd" : "", pend.productIds.length ? `${pend.productIds.length} product${pend.productIds.length === 1 ? "" : "en"} gewijzigd` : ""].filter(Boolean).join(" · ") + " -- nog niet in de shop"}
                </div>
                <div className="coll-actions">
                  <button className="btn secondary" onClick={() => { setOpenId(openId === c.id ? null : c.id); setSearch(""); }}>
                    {openId === c.id ? "Producten sluiten" : "Producten"}
                  </button>
                  <button className={nPending ? "btn" : "btn secondary"} disabled={busy} onClick={() => syncCollection(c)} title="Wijzigingen van de collectie en haar producten naar WooCommerce sturen">
                    {syncing?.id === c.id ? syncing.text : "Naar de shop"}
                  </button>
                  <button className="btn secondary" onClick={() => { setEditingId(c.id); setEditForm(toForm(c)); }}>Bewerken</button>
                  <button className="btn danger" disabled={busy} onClick={() => removeCollection(c)}>Verwijderen</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {openCollection && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>Producten in {openCollection.name} ({openMembers.length})</h2>
          {(removed[openCollection.id] ?? []).length > 0 && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Weggehaald, gaat er in de shop uit bij <b>Naar de shop</b>:{" "}
              {(removed[openCollection.id] ?? []).map((id) => productById.get(id)?.name).filter(Boolean).join(", ")}
            </p>
          )}
          {openMembers.length === 0 ? (
            <p className="muted">Nog geen producten. Zoek hieronder, of selecteer producten op de pagina <Link href="/products">Producten</Link> en kies <i>Aan collectie toevoegen</i>.</p>
          ) : (
            <div className="coll-products">
              {openMembers
                .map((id) => productById.get(id))
                .filter((p): p is ProductLite => !!p)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <div key={p.id} className="coll-product">
                    {firstImage(p.image_url) ? <img src={firstImage(p.image_url)} alt="" loading="lazy" /> : <div className="coll-product-noimg" />}
                    <Link href={`/products/${p.id}`} className="coll-product-name" title={`${p.name} (${p.sku})`}>{p.name}</Link>
                    {!p.published && <span className="muted" style={{ fontSize: 11 }}>niet gepubliceerd</span>}
                    {productChanged(p) && <span className="coll-dot" title="Wijziging nog niet in de shop" />}
                    <button className="btn secondary coll-remove" title="Uit de collectie halen" onClick={() => removeProduct(openCollection.id, p.id)}>×</button>
                  </div>
                ))}
            </div>
          )}

          <h3>Product toevoegen</h3>
          <input placeholder="Zoek op naam of SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="coll-products" style={{ marginTop: 10 }}>
            {candidates.map((p) => (
              <button key={p.id} type="button" className="coll-product coll-candidate" onClick={() => addProduct(openCollection.id, p.id)} title={`${p.sku} toevoegen`}>
                {firstImage(p.image_url) ? <img src={firstImage(p.image_url)} alt="" loading="lazy" /> : <div className="coll-product-noimg" />}
                <span className="coll-product-name" title={p.name}>{p.name}</span>
                <span className="coll-add">+</span>
              </button>
            ))}
          </div>
          {q && candidates.length === 0 && <p className="muted">Geen producten gevonden.</p>}
          {!q && <p className="muted" style={{ fontSize: 12 }}>De eerste 40 producten worden getoond; typ om te zoeken.</p>}
        </div>
      )}
    </div>
  );
}
