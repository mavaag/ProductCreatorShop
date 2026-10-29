"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ProductFolder, loadProductFolders } from "@/lib/productionFiles";
import FolderBrowser from "@/components/FolderBrowser";

/**
 * Blok "Productiebestanden" op de productpagina: de mappen op de NAS bij dit product (normaal de map van zijn
 * catalogusmodel), met downloaden. Een voorstel van match_shop_files.py bevestig je of wijs je af; een andere map kies
 * je door het pad te plakken -- ligt dat pad in een catalogusmodel, dan wordt het model gekoppeld (source 'catalog').
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
  // vanuit de productenlijst (label Map / Voorstel? / Geen bestanden): naar dit blok scrollen zodra het geladen is
  useEffect(() => {
    if (folders !== null && window.location.hash === "#productiebestanden") {
      document.getElementById("productiebestanden")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [folders]);

  async function confirm(path: string) {
    const { error } = await supabase.from("product_files").update({ confirmed: true }).eq("product_id", productId).eq("path", path);
    if (error) setError(error.message); else load();
  }
  async function remove(path: string) {
    const { error } = await supabase.from("product_files").delete().eq("product_id", productId).eq("path", path);
    if (error) setError(error.message); else load();
  }
  async function addManual() {
    // \\NASMAT\MakerProducts\3D-Print\... of 3D-Print/... -> relatief pad met /
    const rel = manual.trim().replace(/\\/g, "/").replace(/^\/\/[^/]+\/MakerProducts\//i, "").replace(/^\/+|\/+$/g, "");
    if (!rel) return;
    // het catalogusmodel waar dit pad (of een bovenliggende map) het model van is -> dat model koppelen
    const parts = rel.split("/");
    const candidates = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    const { data: models } = await supabase.from("maker_models").select("id, path").in("path", candidates);
    const model = (models ?? []).sort((a, b) => b.path.length - a.path.length)[0];
    const { error } = await supabase.from("product_files").upsert(model
      ? { product_id: productId, path: model.path, source: "catalog", confirmed: true, model_id: model.id }
      : { product_id: productId, path: rel, source: "manual", confirmed: true });
    if (error) setError(error.message); else { setManual(""); load(); }
  }

  return (
    <div className="card" id="productiebestanden" style={{ marginTop: 16, scrollMarginTop: 16 }}>
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
            {f.modelId && <> {" "}<a className="link-btn" href={`/catalog?model=${f.modelId}`}>model in de catalogus</a></>}
            {f.confirmed && (
              <> {" "}<button type="button" className="link-btn" onClick={() => remove(f.path)}>ontkoppelen</button></>
            )}
          </div>
          <FolderBrowser path={f.path} title={f.path} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="\\NASMAT\MakerProducts\3D-Print\Figurines\Kirby" />
        <button type="button" className="btn secondary" disabled={!manual.trim()} onClick={addManual}>Map koppelen</button>
      </div>
      {error && <p className="warning">{error}</p>}
    </div>
  );
}
