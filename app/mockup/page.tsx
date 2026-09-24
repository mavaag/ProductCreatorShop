"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { MockupTemplate } from "@/lib/types";
import { DEFAULT_CORNERS, Quad, drawPrintInQuad, loadImage } from "@/lib/mockup";

type Screen = { kind: "list" } | { kind: "edit-template"; template: MockupTemplate | null } | { kind: "compose"; template: MockupTemplate };

const CORNER_LABELS = ["linksboven", "rechtsboven", "rechtsonder", "linksonder"];

export default function MockupPage() {
  const ready = useAuthGuard();
  const [templates, setTemplates] = useState<MockupTemplate[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });

  async function load() {
    const { data } = await supabase.from("mockup_templates").select("*").order("name");
    setTemplates((data as MockupTemplate[]) ?? []);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function deleteTemplate(t: MockupTemplate) {
    if (!confirm(`Template "${t.name}" verwijderen?`)) return;
    await supabase.from("mockup_templates").delete().eq("id", t.id);
    load();
  }

  if (!ready) return null;

  return (
    <div>
      <h1>Mockup generator</h1>
      <p className="sub">Plaats een print (bv. een UV-print) realistisch in het kader van een kamerfoto, en download het resultaat als één afbeelding.</p>

      {screen.kind === "list" && (
        <>
          <div className="card">
            <h2>Templates</h2>
            {templates.length === 0 ? (
              <p className="muted">Nog geen templates. Maak er hieronder één aan: een kamerfoto met de positie van het kader erin ingesteld. Die kan je daarna telkens hergebruiken.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                {templates.map((t) => (
                  <div key={t.id} className="card" style={{ width: 220, padding: 12 }}>
                    <img src={t.room_image_url} alt={t.name} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 2, display: "block" }} />
                    <div style={{ fontWeight: 700, margin: "10px 0 8px" }}>{t.name}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => setScreen({ kind: "compose", template: t })}>Print plaatsen</button>
                      <button className="btn secondary" onClick={() => setScreen({ kind: "edit-template", template: t })}>Kader bijstellen</button>
                      <button className="btn danger" onClick={() => deleteTemplate(t)}>Verwijder</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <h2>Nieuwe template</h2>
            <button className="btn" onClick={() => setScreen({ kind: "edit-template", template: null })}>+ Kamerfoto opladen</button>
          </div>
        </>
      )}

      {screen.kind === "edit-template" && (
        <TemplateEditor
          template={screen.template}
          onCancel={() => setScreen({ kind: "list" })}
          onSaved={() => {
            setScreen({ kind: "list" });
            load();
          }}
        />
      )}

      {screen.kind === "compose" && (
        <ComposeView template={screen.template} onBack={() => setScreen({ kind: "list" })} />
      )}
    </div>
  );
}

// ============================================================
// Template aanmaken/bewerken: kamerfoto opladen + 4 hoekpunten van het kader slepen
// ============================================================

function TemplateEditor({
  template,
  onCancel,
  onSaved,
}: {
  template: MockupTemplate | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(template?.room_image_url ?? null);
  const [corners, setCorners] = useState<Quad>(
    template ? (template.corners as Quad) : DEFAULT_CORNERS
  );
  const [saving, setSaving] = useState(false);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const draggingIndex = useRef<number | null>(null);

  function onFileChosen(f: File | null) {
    setFile(f);
    if (f) setPreviewUrl(URL.createObjectURL(f));
  }

  function pointFromEvent(e: PointerEvent | React.PointerEvent) {
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function startDrag(index: number, e: React.PointerEvent) {
    e.preventDefault();
    draggingIndex.current = index;
    const move = (ev: PointerEvent) => {
      const p = pointFromEvent(ev);
      if (!p || draggingIndex.current === null) return;
      setCorners((prev) => {
        const next = [...prev] as Quad;
        next[draggingIndex.current as number] = p;
        return next;
      });
    };
    const up = () => {
      draggingIndex.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function save() {
    if (!name.trim()) return alert("Geef de template een naam.");
    if (!previewUrl) return alert("Kies eerst een kamerfoto.");
    setSaving(true);
    try {
      let roomImageUrl = template?.room_image_url ?? "";
      if (file) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("mockup-templates").upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("mockup-templates").getPublicUrl(path);
        roomImageUrl = data.publicUrl;
      }
      if (template) {
        await supabase.from("mockup_templates").update({ name: name.trim(), room_image_url: roomImageUrl, corners }).eq("id", template.id);
      } else {
        await supabase.from("mockup_templates").insert({ name: name.trim(), room_image_url: roomImageUrl, corners });
      }
      onSaved();
    } catch (err: any) {
      alert("Opslaan mislukt: " + (err?.message ?? String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>{template ? "Template bewerken" : "Nieuwe template"}</h2>
      <div className="row">
        <div>
          <label>Naam</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Gaming room" />
        </div>
        <div>
          <label>Kamerfoto</label>
          <input type="file" accept="image/*" onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)} />
        </div>
      </div>

      {previewUrl && (
        <>
          <p className="muted" style={{ marginTop: 16 }}>
            Sleep de 4 punten naar de binnenkant van het kader (waar de print zichtbaar moet worden).
          </p>
          <div
            ref={imgWrapRef}
            style={{ position: "relative", display: "inline-block", maxWidth: "100%", userSelect: "none", touchAction: "none" }}
          >
            <img src={previewUrl} alt="" style={{ display: "block", maxWidth: "100%", width: 700 }} draggable={false} />
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              <polygon
                points={corners.map((c) => `${c.x * 100}%,${c.y * 100}%`).join(" ")}
                fill="rgba(0,240,255,0.18)"
                stroke="var(--cyan)"
                strokeWidth={2}
              />
            </svg>
            {corners.map((c, i) => (
              <div
                key={i}
                onPointerDown={(e) => startDrag(i, e)}
                title={CORNER_LABELS[i]}
                style={{
                  position: "absolute",
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  width: 18,
                  height: 18,
                  marginLeft: -9,
                  marginTop: -9,
                  borderRadius: "50%",
                  background: "var(--magenta)",
                  border: "2px solid #fff",
                  boxShadow: "0 0 8px rgba(255,43,214,0.8)",
                  cursor: "grab",
                }}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <button className="btn" onClick={save} disabled={saving}>{saving ? "Opslaan..." : "Template opslaan"}</button>
        <button className="btn secondary" onClick={onCancel}>Annuleer</button>
      </div>
    </div>
  );
}

// ============================================================
// Print in het kader plaatsen en het resultaat downloaden
// ============================================================

function ComposeView({ template, onBack }: { template: MockupTemplate; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [printFile, setPrintFile] = useState<File | null>(null);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!printUrl) return;
    let cancelled = false;
    setRendering(true);
    setError(null);
    (async () => {
      try {
        const [roomImg, printImg] = await Promise.all([loadImage(template.room_image_url), loadImage(printUrl)]);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = roomImg.naturalWidth;
        canvas.height = roomImg.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(roomImg, 0, 0);
        const quad = (template.corners as { x: number; y: number }[]).map((c) => ({
          x: c.x * canvas.width,
          y: c.y * canvas.height,
        })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
        drawPrintInQuad(ctx, printImg, quad);
      } catch (err: any) {
        if (!cancelled) setError("Afbeelding laden mislukt: " + (err?.message ?? String(err)));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template, printUrl]);

  function onPrintChosen(f: File | null) {
    setPrintFile(f);
    setPrintUrl(f ? URL.createObjectURL(f) : null);
  }

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `mockup-${template.name.toLowerCase().replace(/\s+/g, "-")}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  return (
    <div className="card">
      <h2>Print plaatsen -- {template.name}</h2>
      <label>Print-afbeelding (bv. de UV-print)</label>
      <input type="file" accept="image/*" onChange={(e) => onPrintChosen(e.target.files?.[0] ?? null)} />

      {error && <div className="warning" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {!printFile ? (
          <img src={template.room_image_url} alt="" style={{ maxWidth: "100%", width: 700, display: "block" }} />
        ) : (
          <canvas ref={canvasRef} style={{ maxWidth: "100%", width: 700, display: "block", opacity: rendering ? 0.6 : 1 }} />
        )}
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <button className="btn" onClick={download} disabled={!printFile || rendering}>Downloaden als afbeelding</button>
        <button className="btn secondary" onClick={onBack}>Terug naar templates</button>
      </div>
    </div>
  );
}
