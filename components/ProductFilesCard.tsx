"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ProductFolder, loadProductFolders } from "@/lib/productionFiles";
import FolderBrowser from "@/components/FolderBrowser";

/**
 * Blok "Productiebestanden" op de productpagina: de mappen op de NAS bij dit product (catalogusmodel en/of map uit
 * de PRODUCTS-kopie in _Shop), met downloaden. Een voorstel van match_shop_files.py bevestig je of wijs je af;
 * een andere map kies je door het pad te plakken.
 */
export default function ProductFilesCard({ productId }: { productId: string }) {
  const [folders, setFolders] = useState<ProductFolder[] | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const m = await loadProductFolders(supabase, [productId], true);
    setFolders(m.get(productId) ?? []);
  }
  useEffect(() => { load(); }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm(path: string) {
    const { error } = await supabase.from("product_files").update({ confirmed: true }).eq("product_id", productId).eq("path", path);
    if (error) setError(error.message); else load();
  }
  async function remove(path: string) {
    const { error } = await supabase.from("product_files").delete().eq("product_id", productId).eq("path", path);
    if (error) setError(error.message); else load();
  }
  async function addManual() {
    // \\NASMAT\MakerProducts\_Shop\... of _Shop/... -> relatief pad met /
    const rel = manual.trim().replace(/\\/g, "/").replace(/^\/\/[^/]+\/MakerProducts\//i, "").replace(/^\/+|\/+$/g, "");
    if (!rel) return;
    const { error } = await supabase.from("product_files").upsert({ product_id: productId, path: rel, source: "manual", confirmed: true });
    if (error) setError(error.message); else { setManual(""); load(); }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Productiebestanden</h2>
      {folders === null ? <p className="muted">Laden...</p> : folders.length === 0 ? (
        <p className="muted">Nog geen map gekoppeld. Plak hieronder het pad van de map (of van één bestand) op de NAS.</p>
      ) : folders.map((f) => (
        <div key={f.path} style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {f.label}
            {!f.confirmed && (
              <>
                {" "}-- klopt dit?{" "}
                <button type="button" className="btn secondary" onClick={() => confirm(f.path)}>Ja, bevestigen</button>{" "}
                <button type="button" className="btn secondary" onClick={() => remove(f.path)}>Nee</button>
              </>
            )}
            {f.confirmed && f.source !== "catalog" && (
              <> {" "}<button type="button" className="link-btn" onClick={() => remove(f.path)}>ontkoppelen</button></>
            )}
          </div>
          <FolderBrowser path={f.path} title={f.path} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="\\NASMAT\MakerProducts\_Shop\3DPrinting\Figurines\Kirby" />
        <button type="button" className="btn secondary" disabled={!manual.trim()} onClick={addManual}>Map koppelen</button>
      </div>
      {error && <p className="warning">{error}</p>}
    </div>
  );
}
