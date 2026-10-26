"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { FolderListing, downloadPath, formatBytes, listFolder, nasPath } from "@/lib/productionFiles";

/**
 * Een map met productiebestanden op de NAS: openklappen, bestanden of de hele map (zip) downloaden, NAS-pad kopiëren.
 * Submappen (bv. LaserReady/<set>, PrintReady/<printer>) klap je op dezelfde manier open.
 */
export default function FolderBrowser({ path, title }: { path: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const name = path.split("/").pop();

  async function toggle() {
    if (!open && !listing) {
      try { setListing(await listFolder(supabase, path)); } catch (e: any) { setError(e.message); }
    }
    setOpen(!open);
  }
  async function download(rel: string, mode: "file" | "zip") {
    setBusy(rel); setError(null);
    try { await downloadPath(supabase, rel, mode); } catch (e: any) { setError(e.message); }
    setBusy(null);
  }

  return (
    <div className="folder-browser">
      <div className="folder-row">
        <button type="button" className="maker-name-btn" onClick={toggle} aria-expanded={open}>
          {open ? "▾" : "▸"} {title ?? name}
        </button>
        <span className="folder-actions">
          <button type="button" className="btn secondary" disabled={busy === path} onClick={() => download(path, "zip")}>
            {busy === path ? "Bezig..." : "Download map (zip)"}
          </button>
          <button type="button" className="btn secondary" onClick={() => navigator.clipboard?.writeText(nasPath(path))} title={nasPath(path)}>
            Kopieer NAS-pad
          </button>
        </span>
      </div>
      {error && <p className="warning" style={{ margin: "4px 0" }}>{error}</p>}
      {open && listing && (
        <div className="folder-children">
          {listing.dirs.map((d) => <FolderBrowser key={d} path={`${path}/${d}`} />)}
          {listing.files.map((f) => (
            <div key={f.name} className="folder-file">
              <span className="mono">{f.name}</span>
              <span className="muted">{formatBytes(f.size)}</span>
              <button type="button" className="btn secondary" disabled={busy === `${path}/${f.name}`} onClick={() => download(`${path}/${f.name}`, "file")}>
                {busy === `${path}/${f.name}` ? "..." : "Download"}
              </button>
            </div>
          ))}
          {listing.dirs.length === 0 && listing.files.length === 0 && <p className="muted">Lege map.</p>}
        </div>
      )}
    </div>
  );
}
