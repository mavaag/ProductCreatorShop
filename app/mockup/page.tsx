"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { MockupTechnique, MockupTemplate } from "@/lib/types";
import { DEFAULT_CORNERS, Quad, drawPrintInQuad, loadImage } from "@/lib/mockup";
import {
  ENGRAVE_COLOR_PRESETS,
  ENGRAVE_FONTS,
  EngraveOptions,
  drawEngravingInQuad,
  loadEngraveFont,
} from "@/lib/engraveMockup";
import { confirmDialog, alertDialog } from "@/components/DialogHost";

type Screen = { kind: "list" } | { kind: "edit-template"; template: MockupTemplate | null } | { kind: "compose"; template: MockupTemplate };

const CORNER_LABELS = ["linksboven", "rechtsboven", "rechtsonder", "linksonder"];

/** Tabbladen bovenaan: één per techniek, elk met zijn eigen templates. */
const TECHNIQUES: { key: MockupTechnique; label: string; intro: string; templateHint: string }[] = [
  {
    key: "uv",
    label: "UV-print",
    intro: "Plaats een print (bv. een UV-print) realistisch in het kader van een kamerfoto, en download het resultaat als één afbeelding.",
    templateHint: "een kamerfoto met de positie van het kader erin ingesteld",
  },
  {
    key: "engrave",
    label: "Lasergravure",
    intro: "Toon hoe een logo, foto of tekst eruitziet als lasergravure op een product (hout, leisteen, metaal, leder), en download het resultaat als één afbeelding.",
    templateHint: "een foto van het product met de zone waar de gravure komt",
  },
];

const TECHNIQUE_STORAGE_KEY = "mockup-technique";

const templateTechnique = (t: MockupTemplate): MockupTechnique => t.technique ?? "uv";

/** Tekent één mockup: de foto van de template met de print of de gravure in de zone. */
function renderMockup(
  ctx: CanvasRenderingContext2D,
  roomImg: HTMLImageElement,
  quad: Quad,
  design: HTMLImageElement | null,
  engrave: EngraveOptions | null
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(roomImg, 0, 0);
  if (engrave) drawEngravingInQuad(ctx, design, quad, engrave);
  else if (design) drawPrintInQuad(ctx, design, quad);
}

function templateQuad(template: MockupTemplate, width: number, height: number): Quad {
  return (template.corners as { x: number; y: number }[]).map((c) => ({ x: c.x * width, y: c.y * height })) as Quad;
}

export default function MockupPage() {
  const ready = useAuthGuard();
  const [templates, setTemplates] = useState<MockupTemplate[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [technique, setTechnique] = useState<MockupTechnique>("uv");

  // Laatst gekozen tabblad onthouden (enkel in deze browser).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TECHNIQUE_STORAGE_KEY);
      if (saved === "uv" || saved === "engrave") setTechnique(saved);
    } catch {
      // geen opslag beschikbaar: dan gewoon UV-print
    }
  }, []);

  function chooseTechnique(next: MockupTechnique) {
    setTechnique(next);
    setScreen({ kind: "list" });
    try {
      localStorage.setItem(TECHNIQUE_STORAGE_KEY, next);
    } catch {
      // niet erg
    }
  }

  async function load() {
    const { data } = await supabase.from("mockup_templates").select("*").order("name");
    setTemplates((data as MockupTemplate[]) ?? []);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function deleteTemplate(t: MockupTemplate) {
    if (!(await confirmDialog(`Template "${t.name}" verwijderen?`, { confirmLabel: "Verwijderen", danger: true }))) return;
    await supabase.from("mockup_templates").delete().eq("id", t.id);
    load();
  }

  if (!ready) return null;

  const tech = TECHNIQUES.find((t) => t.key === technique)!;
  const visibleTemplates = templates.filter((t) => templateTechnique(t) === technique);

  return (
    <div>
      <h1>Mockup generator</h1>

      <div role="tablist" aria-label="Techniek" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
        {TECHNIQUES.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === technique}
            className={t.key === technique ? "btn" : "btn secondary"}
            onClick={() => chooseTechnique(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="sub">{tech.intro}</p>

      {screen.kind === "list" && (
        <>
          <div className="card">
            <h2>Templates -- {tech.label}</h2>
            {visibleTemplates.length === 0 ? (
              <p className="muted">Nog geen templates voor {tech.label.toLowerCase()}. Maak er hieronder één aan: {tech.templateHint}. Die kan je daarna telkens hergebruiken.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                {visibleTemplates.map((t) => (
                  <div key={t.id} className="card" style={{ width: 220, padding: 12 }}>
                    <img src={t.room_image_url} crossOrigin="anonymous" alt={t.name} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 2, display: "block" }} />
                    <div style={{ fontWeight: 700, margin: "10px 0 8px" }}>{t.name}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => setScreen({ kind: "compose", template: t })}>
                        {technique === "engrave" ? "Gravure plaatsen" : "Print plaatsen"}
                      </button>
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
            <button className="btn" onClick={() => setScreen({ kind: "edit-template", template: null })}>
              {technique === "engrave" ? "+ Productfoto opladen" : "+ Kamerfoto opladen"}
            </button>
          </div>
        </>
      )}

      {screen.kind === "edit-template" && (
        <TemplateEditor
          template={screen.template}
          technique={screen.template ? templateTechnique(screen.template) : technique}
          onCancel={() => setScreen({ kind: "list" })}
          onSaved={() => {
            setScreen({ kind: "list" });
            load();
          }}
        />
      )}

      {screen.kind === "compose" && (
        <ComposeView template={screen.template} technique={templateTechnique(screen.template)} onBack={() => setScreen({ kind: "list" })} />
      )}
    </div>
  );
}

// ============================================================
// Template aanmaken/bewerken: kamerfoto opladen + 4 hoekpunten van het kader slepen
// ============================================================

function TemplateEditor({
  template,
  technique,
  onCancel,
  onSaved,
}: {
  template: MockupTemplate | null;
  technique: MockupTechnique;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const engrave = technique === "engrave";
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
    if (!name.trim()) { await alertDialog("Geef de template een naam."); return; }
    if (!previewUrl) { await alertDialog(engrave ? "Kies eerst een productfoto." : "Kies eerst een kamerfoto."); return; }
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
        const { error } = await supabase.from("mockup_templates").insert({ name: name.trim(), room_image_url: roomImageUrl, corners, technique });
        if (error) throw error;
      }
      onSaved();
    } catch (err: any) {
      await alertDialog("Opslaan mislukt: " + (err?.message ?? String(err)));
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={engrave ? "bv. Onderlegger leisteen" : "bv. Gaming room"} />
        </div>
        <div>
          <label>{engrave ? "Productfoto" : "Kamerfoto"}</label>
          <input type="file" accept="image/*" onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)} />
        </div>
      </div>

      {previewUrl && (
        <>
          <p className="muted" style={{ marginTop: 16 }}>
            {engrave
              ? "Sleep de 4 punten naar de hoeken van de zone waar de gravure mag komen. Ligt het product schuin op de foto, volg dan het perspectief. Voor een ronde zone: zet de punten op de hoeken van het vierkant rond de cirkel."
              : "Sleep de 4 punten naar de binnenkant van het kader (waar de print zichtbaar moet worden)."}
          </p>
          <div
            ref={imgWrapRef}
            style={{ position: "relative", display: "inline-block", maxWidth: "100%", userSelect: "none", touchAction: "none" }}
          >
            <img src={previewUrl} crossOrigin="anonymous" alt="" style={{ display: "block", maxWidth: "100%", width: 700 }} draggable={false} />
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

const DEFAULT_ENGRAVE: EngraveOptions = { color: "#3b2414", shape: "rect", imageMode: "auto", text: "", font: "Montserrat" };

function ComposeView({ template, technique, onBack }: { template: MockupTemplate; technique: MockupTechnique; onBack: () => void }) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [engraveOpts, setEngraveOpts] = useState<EngraveOptions>(DEFAULT_ENGRAVE);
  const batchSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const engrave = technique === "engrave" ? engraveOpts : null;

  return (
    <div className="card">
      <h2>{engrave ? "Gravure plaatsen" : "Print plaatsen"} -- {template.name}</h2>

      {engrave && <EngraveSettings value={engraveOpts} onChange={(patch) => setEngraveOpts((prev) => ({ ...prev, ...patch }))} />}

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button className={mode === "single" ? "btn" : "btn secondary"} onClick={() => setMode("single")}>Eén foto</button>
        <button className={mode === "batch" ? "btn" : "btn secondary"} onClick={() => setMode("batch")} disabled={!batchSupported} title={batchSupported ? undefined : "Vereist Chrome, Edge of Brave"}>
          Map (batch)
        </button>
      </div>

      {!batchSupported && mode === "batch" && (
        <div className="warning">Batchverwerking vereist een Chromium-browser (Chrome, Edge of Brave).</div>
      )}

      {mode === "single" ? (
        <SingleCompose template={template} engrave={engrave} />
      ) : (
        batchSupported && <BatchCompose template={template} engrave={engrave} />
      )}

      <div style={{ marginTop: 20 }}>
        <button className="btn secondary" onClick={onBack}>Terug naar templates</button>
      </div>
    </div>
  );
}

/** Instellingen van de gravure: kleur (materiaal), vorm van de zone, soort afbeelding en een tekst. */
function EngraveSettings({ value, onChange }: { value: EngraveOptions; onChange: (patch: Partial<EngraveOptions>) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="row">
        <div>
          <label>Gravurekleur</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#3b2414"}
              onChange={(e) => onChange({ color: e.target.value })}
              style={{ width: 44, padding: 2 }}
            />
            <input value={value.color} onChange={(e) => onChange({ color: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {ENGRAVE_COLOR_PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn secondary" onClick={() => onChange({ color: p.color })}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label>Vorm van de zone</label>
          <select value={value.shape} onChange={(e) => onChange({ shape: e.target.value as EngraveOptions["shape"] })}>
            <option value="rect">Rechthoek / vierkant</option>
            <option value="ellipse">Cirkel</option>
          </select>
        </div>
        <div>
          <label>Afbeelding is</label>
          <select value={value.imageMode} onChange={(e) => onChange({ imageMode: e.target.value as EngraveOptions["imageMode"] })}>
            <option value="auto">Automatisch herkennen</option>
            <option value="logo">Logo (zwart = graveren)</option>
            <option value="photo">Foto</option>
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tekst (optioneel)</label>
          <input value={value.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="bv. Lotte" />
        </div>
        <div>
          <label>Lettertype</label>
          <select value={value.font} onChange={(e) => onChange({ font: e.target.value })} style={{ fontFamily: `"${value.font}"` }}>
            {Object.keys(ENGRAVE_FONTS).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
        Donkere kleur voor hout en leder, lichtgrijs/wit voor leisteen en geanodiseerd metaal. Een logo (zwart op wit of
        transparant) wordt gegraveerd waar het zwart is; bij een foto op een lichte gravure worden de lichte delen
        gegraveerd, zodat ze er niet als negatief uitziet -- net zoals in de preview in de shop.
      </p>
    </div>
  );
}

function SingleCompose({ template, engrave }: { template: MockupTemplate; engrave: EngraveOptions | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [printFile, setPrintFile] = useState<File | null>(null);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bij een gravure mag het ook enkel tekst zijn.
  const hasContent = !!printUrl || !!engrave?.text.trim();
  const engraveKey = engrave ? JSON.stringify(engrave) : "";

  useEffect(() => {
    if (!hasContent) return;
    let cancelled = false;
    setRendering(true);
    setError(null);
    (async () => {
      try {
        const [roomImg, printImg] = await Promise.all([
          loadImage(template.room_image_url),
          printUrl ? loadImage(printUrl) : Promise.resolve(null),
          engrave?.text.trim() ? loadEngraveFont(engrave.font) : Promise.resolve(),
        ]);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = roomImg.naturalWidth;
        canvas.height = roomImg.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        renderMockup(ctx, roomImg, templateQuad(template, canvas.width, canvas.height), printImg, engrave);
      } catch (err: any) {
        if (!cancelled) setError("Afbeelding laden mislukt: " + (err?.message ?? String(err)));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template, printUrl, hasContent, engraveKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div>
      <label>{engrave ? "Logo of foto om te graveren (optioneel als je een tekst opgeeft)" : "Print-afbeelding (bv. de UV-print)"}</label>
      <input type="file" accept="image/*" onChange={(e) => onPrintChosen(e.target.files?.[0] ?? null)} />

      {error && <div className="warning" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {!hasContent ? (
          <img src={template.room_image_url} crossOrigin="anonymous" alt="" style={{ maxWidth: "100%", width: 700, display: "block" }} />
        ) : (
          <canvas ref={canvasRef} style={{ maxWidth: "100%", width: 700, display: "block", opacity: rendering ? 0.6 : 1 }} />
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn" onClick={download} disabled={!hasContent || rendering}>Downloaden als afbeelding</button>
      </div>
    </div>
  );
}

// ============================================================
// Batch: template + een lokale map met foto's -> automatisch voor elke foto
// een mockup genereren en rechtstreeks wegschrijven naar een doelmap.
// Vereist de File System Access API (Chrome/Edge/Brave).
// ============================================================

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|bmp|gif|avif)$/i;

type BatchItem = {
  name: string;
  status: "wachten" | "bezig" | "klaar" | "fout";
  outName?: string;
  message?: string;
};

async function ensureReadWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

async function fileExists(dirHandle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dirHandle.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zoekt een bestandsnaam die nog niet bestaat in `dirHandle`, zodat een nieuwe batch
 * (bv. met een andere template) geen eerder resultaat overschrijft: bij een botsing
 * wordt "-1", "-2", ... aan de bestandsnaam toegevoegd. `claimed` houdt namen bij die
 * binnen deze batch al vergeven zijn (nog niet op schijf zichtbaar tijdens het lopen).
 */
async function getUniqueFileName(dirHandle: FileSystemDirectoryHandle, stem: string, ext: string, claimed: Set<string>): Promise<string> {
  let candidate = `${stem}${ext}`;
  let n = 1;
  while (claimed.has(candidate) || (await fileExists(dirHandle, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n++;
  }
  claimed.add(candidate);
  return candidate;
}

function BatchCompose({ template, engrave }: { template: MockupTemplate; engrave: EngraveOptions | null }) {
  const [sourceHandle, setSourceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [sourceFiles, setSourceFiles] = useState<{ name: string; handle: FileSystemFileHandle }[]>([]);
  const [targetHandle, setTargetHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickSourceFolder() {
    setError(null);
    try {
      const dirHandle = await window.showDirectoryPicker();
      const found: { name: string; handle: FileSystemFileHandle }[] = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === "file" && IMAGE_EXT_RE.test(name)) {
          found.push({ name, handle: handle as FileSystemFileHandle });
        }
      }
      found.sort((a, b) => a.name.localeCompare(b.name));
      setSourceHandle(dirHandle);
      setSourceFiles(found);
      setItems(found.map((f) => ({ name: f.name, status: "wachten" as const })));
    } catch (err: any) {
      if (err?.name !== "AbortError") setError("Bronmap kiezen mislukt: " + (err?.message ?? String(err)));
    }
  }

  async function pickTargetFolder() {
    setError(null);
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!(await ensureReadWritePermission(dirHandle))) {
        setError("Geen schrijfrechten gekregen voor de doelmap.");
        return;
      }
      setTargetHandle(dirHandle);
    } catch (err: any) {
      if (err?.name !== "AbortError") setError("Doelmap kiezen mislukt: " + (err?.message ?? String(err)));
    }
  }

  async function startBatch() {
    if (!sourceHandle || !targetHandle || sourceFiles.length === 0 || processing) return;
    setError(null);
    setProcessing(true);
    try {
      const roomImg = await loadImage(template.room_image_url);
      if (engrave?.text.trim()) await loadEngraveFont(engrave.font);
      const canvas = document.createElement("canvas");
      canvas.width = roomImg.naturalWidth;
      canvas.height = roomImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Kon geen canvas-context aanmaken.");
      const quad = templateQuad(template, canvas.width, canvas.height);
      const claimedNames = new Set<string>();

      for (let i = 0; i < sourceFiles.length; i++) {
        const { name, handle } = sourceFiles[i];
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "bezig" } : it)));
        let objectUrl: string | null = null;
        try {
          const file = await handle.getFile();
          objectUrl = URL.createObjectURL(file);
          const printImg = await loadImage(objectUrl);

          renderMockup(ctx, roomImg, quad, printImg, engrave);

          const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          if (!blob) throw new Error("Afbeelding maken mislukt.");

          const stem = name.replace(/\.[^.]+$/, "");
          const outName = await getUniqueFileName(targetHandle, stem, ".png", claimedNames);
          const outHandle = await targetHandle.getFileHandle(outName, { create: true });
          const writable = await outHandle.createWritable();
          await writable.write(blob);
          await writable.close();

          setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "klaar", outName } : it)));
        } catch (err: any) {
          setItems((prev) =>
            prev.map((it, idx) => (idx === i ? { ...it, status: "fout", message: err?.message ?? String(err) } : it))
          );
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      }
    } catch (err: any) {
      setError("Batch mislukt: " + (err?.message ?? String(err)));
    } finally {
      setProcessing(false);
    }
  }

  const done = items.filter((i) => i.status === "klaar").length;
  const failed = items.filter((i) => i.status === "fout").length;

  return (
    <div>
      <p className="muted">
        Kies een map met {engrave ? "logo's of foto's" : "printfoto's"} en een doelmap: voor elke afbeelding in de bronmap
        wordt automatisch een mockup met deze template{engrave ? " (en de gravure-instellingen hierboven)" : ""} gemaakt en als PNG opgeslagen in de doelmap (zelfde bestandsnaam). Bestaat er al een bestand met die
        naam (bv. van een vorige template op dezelfde foto's), dan wordt er een nummer toegevoegd (foto-1.png,
        foto-2.png, ...) zodat er nooit iets overschreven wordt.
      </p>

      <div className="row">
        <div>
          <label>Bronmap (foto's)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn secondary" onClick={pickSourceFolder} disabled={processing}>Kies bronmap...</button>
            <span className="muted">{sourceHandle ? `${sourceHandle.name} (${sourceFiles.length} foto's)` : "geen map gekozen"}</span>
          </div>
        </div>
        <div>
          <label>Doelmap (resultaat)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn secondary" onClick={pickTargetFolder} disabled={processing}>Kies doelmap...</button>
            <span className="muted">{targetHandle ? targetHandle.name : "geen map gekozen"}</span>
          </div>
        </div>
      </div>

      {error && <div className="warning" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 20 }}>
        <button
          className="btn"
          onClick={startBatch}
          disabled={!sourceHandle || !targetHandle || sourceFiles.length === 0 || processing}
        >
          {processing ? `Bezig... (${done + failed}/${items.length})` : `Start batch (${sourceFiles.length} foto's)`}
        </button>
      </div>

      {items.length > 0 && (
        <div style={{ marginTop: 16, maxHeight: 300, overflowY: "auto" }}>
          {items.map((it) => (
            <div key={it.name} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 14 }}>
              <span style={{ width: 70, flexShrink: 0 }}>
                {it.status === "wachten" && "wachten"}
                {it.status === "bezig" && "bezig..."}
                {it.status === "klaar" && "✓ klaar"}
                {it.status === "fout" && "✗ fout"}
              </span>
              <span className="muted">
                {it.name}
                {it.outName && it.outName !== it.name && ` → ${it.outName}`}
              </span>
              {it.message && <span className="warning">{it.message}</span>}
            </div>
          ))}
        </div>
      )}

      {!processing && items.length > 0 && (done > 0 || failed > 0) && (
        <p className="muted" style={{ marginTop: 12 }}>
          {done} van {items.length} gelukt{failed > 0 ? `, ${failed} mislukt` : ""}.
        </p>
      )}
    </div>
  );
}
