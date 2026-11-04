"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { confirmDialog } from "@/components/DialogHost";
import { License, PLATFORM_LABELS, Platform, REMIND_DAYS, bookmarklet, firstImportTimes, formatDate, isNew, licenseState, plusOneYear } from "@/lib/licenses";

type Form = {
  artist: string; platform: Platform; profile_url: string; purchased_on: string; valid_until: string; no_end: boolean;
  price: string; currency: string; terms: string; notes: string; folder: string;
};
const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({
  artist: "", platform: "makerworld", profile_url: "", purchased_on: today(), valid_until: plusOneYear(today()), no_end: false,
  price: "", currency: "EUR", terms: "Verkoop van geprinte modellen toegelaten; de bestanden zelf niet doorverkopen of delen.", notes: "", folder: "",
});
type Counts = { total: number; yes: number; maybe: number; open: number; inCatalog: number; fresh: number };

/** MakerWorld-handle uit een profiel-URL, bv. https://makerworld.com/en/@PinkyWings -> pinkywings. */
function handleFromUrl(url: string): string | null {
  const m = url.match(/makerworld\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?@([A-Za-z0-9_.-]+)/i);
  return m ? m[1].toLowerCase() : null;
}
const folderFor = (artist: string) => "3D-Print/" + artist.trim().replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "-");

export default function LicensesPage() {
  const ready = useAuthGuard();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [counts, setCounts] = useState<Map<string, Counts>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(BLANK());
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("licenses").select("*").order("artist");
    if (error) { setError(error.message.includes("licenses") ? "De tabel voor licenties bestaat nog niet: voer migratie 041 uit in Supabase." : error.message); setLoading(false); return; }
    setLicenses((data ?? []) as License[]);
    const { data: rows } = await supabase.from("license_models").select("license_id, pick, maker_model_id, first_seen_at, removed_at").range(0, 9999);
    const firstImport = firstImportTimes(rows ?? []);
    const c = new Map<string, Counts>();
    for (const r of rows ?? []) {
      if (r.removed_at) continue;
      const x = c.get(r.license_id) ?? { total: 0, yes: 0, maybe: 0, open: 0, inCatalog: 0, fresh: 0 };
      x.total++;
      if (r.pick === "yes") x.yes++; else if (r.pick === "maybe") x.maybe++; else if (!r.pick) x.open++;
      if (r.maker_model_id) x.inCatalog++;
      if (isNew(r, firstImport.get(r.license_id))) x.fresh++;
      c.set(r.license_id, x);
    }
    setCounts(c); setError(null); setLoading(false);
  }
  useEffect(() => { if (ready) { load(); setOrigin(window.location.origin); } }, [ready]);

  function startNew() { setForm(BLANK()); setEditing("new"); }
  function startEdit(l: License) {
    setForm({
      artist: l.artist, platform: l.platform, profile_url: l.profile_url, purchased_on: l.purchased_on,
      valid_until: l.valid_until ?? "", no_end: !l.valid_until, price: l.price != null ? String(l.price) : "", currency: l.currency,
      terms: l.terms, notes: l.notes, folder: l.folder,
    });
    setEditing(l.id);
  }

  async function save() {
    if (!form.artist.trim()) { setError("Vul de naam van de artiest in."); return; }
    if (!form.purchased_on) { setError("Vul de betaaldatum in."); return; }
    setSaving(true);
    const row = {
      artist: form.artist.trim(), platform: form.platform, profile_url: form.profile_url.trim(),
      handle: form.platform === "makerworld" ? handleFromUrl(form.profile_url) : null,
      purchased_on: form.purchased_on, valid_until: form.no_end ? null : (form.valid_until || plusOneYear(form.purchased_on)),
      price: form.price.trim() ? Number(form.price.replace(",", ".")) : null, currency: form.currency || "EUR",
      terms: form.terms.trim(), notes: form.notes.trim(), folder: form.folder.trim() || folderFor(form.artist),
      updated_at: new Date().toISOString(),
    };
    const old = editing !== "new" ? licenses.find((l) => l.id === editing) : null;
    // nieuwe vervaldatum (verlengd): de herinnering mag voor de nieuwe periode opnieuw vertrekken
    const patch = old && old.valid_until !== row.valid_until ? { ...row, reminder_sent_for: null } : row;
    const { error } = editing === "new" ? await supabase.from("licenses").insert(row) : await supabase.from("licenses").update(patch).eq("id", editing);
    setSaving(false);
    if (error) { setError(error.message); return; }
    setEditing(null); load();
  }

  async function renew(l: License) {
    const from = l.valid_until && l.valid_until > today() ? l.valid_until : today();
    const ok = await confirmDialog(`Licentie van ${l.artist} verlengen tot ${formatDate(plusOneYear(from))}? Pas daarna eventueel de prijs aan.`);
    if (!ok) return;
    const { error } = await supabase.from("licenses").update({
      purchased_on: today(), valid_until: plusOneYear(from), reminder_sent_for: null, updated_at: new Date().toISOString(),
    }).eq("id", l.id);
    if (error) setError(error.message); else load();
  }

  async function remove(l: License) {
    const c = counts.get(l.id);
    const ok = await confirmDialog(`Licentie van ${l.artist} verwijderen? De lijst met ${c?.total ?? 0} modellen en je keuzes verdwijnen ook. Modellen die al in de Catalogus staan, blijven daar.`);
    if (!ok) return;
    const { error } = await supabase.from("licenses").delete().eq("id", l.id);
    if (error) setError(error.message); else load();
  }

  const sorted = useMemo(() => [...licenses].sort((a, b) => (a.valid_until ?? "9999").localeCompare(b.valid_until ?? "9999")), [licenses]);
  const bm = useMemo(() => (origin ? bookmarklet(origin) : ""), [origin]);

  if (!ready) return null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Licenties</h1>
          <p className="muted" style={{ margin: 0 }}>
            Betaalde licenties van artiesten. Je ziet wanneer ze vervallen ({REMIND_DAYS} dagen op voorhand krijg je een melding en een mail),
            en per artiest alle modellen om te kiezen wat in de Catalogus komt.
          </p>
        </div>
        {editing === null && <button className="btn" onClick={startNew}>Licentie toevoegen</button>}
      </div>

      {error && <p className="warning">{error}</p>}

      {editing !== null && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{editing === "new" ? "Nieuwe licentie" : `Licentie van ${form.artist} aanpassen`}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div><label htmlFor="lic-artist">Artiest</label><input id="lic-artist" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} placeholder="bv. PinkyWings" /></div>
            <div>
              <label htmlFor="lic-platform">Platform</label>
              <select id="lic-platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })}>
                {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label htmlFor="lic-url">Profiel van de artiest</label>
              <input id="lic-url" value={form.profile_url} onChange={(e) => setForm({ ...form, profile_url: e.target.value })} placeholder="https://makerworld.com/en/@PinkyWings" />
            </div>
            <div>
              <label htmlFor="lic-bought">Betaald op</label>
              <input id="lic-bought" type="date" value={form.purchased_on}
                onChange={(e) => setForm({ ...form, purchased_on: e.target.value, valid_until: e.target.value ? plusOneYear(e.target.value) : form.valid_until })} />
            </div>
            <div>
              <label htmlFor="lic-until">Geldig tot</label>
              <input id="lic-until" type="date" value={form.valid_until} disabled={form.no_end} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
              <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, fontSize: 13 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.no_end} onChange={(e) => setForm({ ...form, no_end: e.target.checked })} /> Loopt niet af
              </label>
            </div>
            <div><label htmlFor="lic-price">Prijs</label><input id="lic-price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="bv. 49,99" /></div>
            <div><label htmlFor="lic-cur">Munt</label><input id="lic-cur" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label htmlFor="lic-terms">Wat mag je ermee</label><textarea id="lic-terms" rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label htmlFor="lic-notes">Notities</label><textarea id="lic-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="bv. bestelnummer, account, contact" /></div>
            <div>
              <label htmlFor="lic-folder">Map in de bibliotheek</label>
              <input id="lic-folder" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} placeholder={form.artist ? folderFor(form.artist) : "3D-Print/<artiest>"} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={saving} onClick={save}>{saving ? "Bewaren..." : "Bewaren"}</button>
            <button className="btn secondary" onClick={() => setEditing(null)}>Annuleren</button>
          </div>
        </div>
      )}

      {loading ? <p className="muted">Laden...</p> : sorted.length === 0 && !error ? (
        <p className="muted" style={{ marginTop: 16 }}>Nog geen licenties. Voeg je eerste licentie toe met de knop hierboven.</p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {sorted.map((l) => {
            const s = licenseState(l);
            const c = counts.get(l.id);
            const color = s.kind === "expired" ? "var(--rust)" : s.kind === "soon" ? "var(--yellow)" : "var(--moss)";
            return (
              <div key={l.id} className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", borderLeft: `3px solid ${color}` }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <Link href={`/licenses/${l.id}`} style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{l.artist}</Link>
                    <span className="pill">{PLATFORM_LABELS[l.platform]}</span>
                    <span style={{ color, fontWeight: 600 }}>{s.label}</span>
                  </div>
                  <div className="muted mono" style={{ marginTop: 4 }}>
                    Betaald {formatDate(l.purchased_on)}{l.price != null && <> · {l.price.toLocaleString("nl-BE", { style: "currency", currency: l.currency || "EUR" })}</>}
                    {l.last_refreshed_at && <> · modellen bijgewerkt {formatDate(l.last_refreshed_at)}</>}
                  </div>
                  {c && (
                    <div className="muted" style={{ marginTop: 4 }}>
                      {c.total} modellen · <span style={{ color: "var(--moss)" }}>{c.yes} overnemen</span> · {c.maybe} misschien · {c.open} nog te bekijken
                      · {c.inCatalog} in de Catalogus{c.fresh > 0 && <> · <span style={{ color: "var(--magenta)" }}>{c.fresh} nieuw</span></>}
                    </div>
                  )}
                </div>
                <div className="row">
                  <Link className="btn" href={`/licenses/${l.id}`}>Modellen</Link>
                  {(s.kind === "soon" || s.kind === "expired") && <button className="btn secondary" onClick={() => renew(l)}>Verlengd</button>}
                  <button className="btn secondary" onClick={() => startEdit(l)}>Aanpassen</button>
                  <button className="btn danger" onClick={() => remove(l)}>Verwijderen</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Modellen van een artiest ophalen of bijwerken</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Open de licentie en klik op <b>Nieuwste modellen ophalen</b>. Dat loopt via de Chrome-extensie <b>MakerWorld-hulp</b>
          (eenmalig te installeren per pc, de tool legt uit hoe): MakerWorld laat geen opvragingen van servers toe, dus de lijst
          wordt in je eigen Chrome opgehaald, met je eigen login. Nieuwe modellen krijgen het label <b>Nieuw</b>.
        </p>
        <p className="muted">
          Reserve zonder extensie: sleep de knop hieronder naar je bladwijzerbalk, klik erop op het profiel van de artiest en
          kies <b>Kopieer en open de beheertool</b>; dan plak je de lijst. Je kan het ook aan Claude vragen.
        </p>
        {bm && (
          // eslint-disable-next-line react/jsx-no-script-url
          <a className="btn" href={bm} onClick={(e) => e.preventDefault()} title="Sleep mij naar je bladwijzerbalk" style={{ cursor: "grab" }}>
            Modellen ophalen (MakerWorld)
          </a>
        )}
      </div>
    </div>
  );
}

