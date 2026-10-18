"use client";

import { useEffect, useRef, useState } from "react";
import type { GravureSettings, PersonalizationZone, ZoneRect, ZoneShape } from "@/lib/types";
import { DEFAULT_GRAVURE_SETTINGS, zoneImageIndex, zoneRect, zoneShape } from "@/lib/gravure";

/**
 * Instellingen van de 3DP Gravure Preview-plugin, net zoals je ze in WooCommerce bij het product invult:
 * soort (gravure/UV), verplicht, logo-upload, kleur, max. tekens, textuur, voor- en achterkant met elk een
 * eigen foto en een zone (rechthoek of cirkel) die je op die foto tekent. De meerprijs per kant staat in de
 * kostenblokken eronder (die bestonden al); de printzone-afmetingen in mm delen ze met deze editor.
 */

const checkboxLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  textTransform: "none",
  fontSize: 14,
  letterSpacing: "normal",
  fontWeight: 500,
  margin: "6px 0",
};

export function GravureSettingsEditor({
  settings,
  zones,
  imageUrls,
  managed,
  uploading,
  onChangeSettings,
  onChangeZone,
  onUploadImage,
}: {
  settings: GravureSettings | null | undefined;
  zones: PersonalizationZone[];
  imageUrls: string[]; // productafbeeldingen (zelfde volgorde als in WooCommerce, 0 = hoofdafbeelding)
  managed: boolean; // false = nog niet in de app ingesteld; de sync laat WooCommerce dan ongemoeid
  uploading: boolean;
  onChangeSettings: (patch: Partial<GravureSettings>) => void;
  onChangeZone: (key: string, patch: Partial<PersonalizationZone>) => void;
  onUploadImage: (zoneKey: string, file: File) => void;
}) {
  const g = { ...DEFAULT_GRAVURE_SETTINGS, ...(settings ?? {}) };
  const uv = g.mode === "uv";

  return (
    <div className="card" style={{ background: "var(--panel-2)", marginTop: 12 }}>
      <h3 style={{ marginTop: 0, fontSize: 13 }}>Gravure-preview instellingen</h3>
      {!managed && (
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Deze instellingen worden nog niet vanuit de app beheerd: de sync laat ze in WooCommerce staan zoals ze zijn.
          Pas je hier iets aan en sla je op, dan stuurt de volgende sync alles mee. Staan ze al in WooCommerce? Gebruik
          dan eerst &quot;Metadata uit WooCommerce importeren&quot;.
        </p>
      )}

      <label style={checkboxLabel}>
        <input type="checkbox" style={{ width: "auto" }} checked={g.enabled} onChange={(e) => onChangeSettings({ enabled: e.target.checked })} />
        Personalisatie inschakelen in de shop
      </label>

      <div className="row">
        <div>
          <label>Soort</label>
          <select value={g.mode} onChange={(e) => onChangeSettings({ mode: e.target.value as GravureSettings["mode"] })}>
            <option value="engrave">Lasergravure (één kleur)</option>
            <option value="uv">UV-print (volle kleur)</option>
          </select>
        </div>
        {!uv && (
          <div>
            <label>Gravurekleur (preview)</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(g.color) ? g.color : "#3b2414"}
                onChange={(e) => onChangeSettings({ color: e.target.value })}
                style={{ width: 44, padding: 2 }}
              />
              <input value={g.color} onChange={(e) => onChangeSettings({ color: e.target.value })} placeholder="#3b2414" />
            </div>
          </div>
        )}
        {!uv && (
          <div>
            <label>Max. tekens</label>
            <input
              type="number"
              min={1}
              value={g.max_chars ?? ""}
              onChange={(e) => onChangeSettings({ max_chars: e.target.value === "" ? null : parseInt(e.target.value) || 0 })}
              placeholder="30"
            />
          </div>
        )}
        {uv && (
          <div>
            <label>Materiaaltextuur (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={g.texture ?? ""}
              onChange={(e) => onChangeSettings({ texture: e.target.value === "" ? null : parseFloat(e.target.value) || 0 })}
              placeholder="20"
            />
          </div>
        )}
      </div>
      {!uv && (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Donkerbruin voor hout, lichtgrijs/wit voor geanodiseerd metaal of leisteen.</p>
      )}
      {uv && (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Hoeveel de structuur van hout of metaal door de print heen zichtbaar is in de preview. De printbreedte per kant
          (voor de pixelcontrole bij klantfoto&apos;s) vul je in bij &quot;Printzone breedte&quot; in de blokken hieronder.
        </p>
      )}

      {!uv && (
        <>
          <label style={checkboxLabel}>
            <input type="checkbox" style={{ width: "auto" }} checked={g.required} onChange={(e) => onChangeSettings({ required: e.target.checked })} />
            Verplicht (klant moet tekst of logo opgeven)
          </label>
          <label style={checkboxLabel}>
            <input type="checkbox" style={{ width: "auto" }} checked={g.allow_logo} onChange={(e) => onChangeSettings({ allow_logo: e.target.checked })} />
            Logo-upload toestaan
          </label>
        </>
      )}
      <label style={checkboxLabel}>
        <input type="checkbox" style={{ width: "auto" }} checked={g.back_enabled} onChange={(e) => onChangeSettings({ back_enabled: e.target.checked })} />
        Achterkant graveren (eigen foto en zone)
      </label>

      <div className="row" style={{ marginTop: 8 }}>
        {(["front", "back"] as const)
          .filter((key) => key === "front" || g.back_enabled)
          .map((key) => {
            const zone = zones.find((z) => z.key === key);
            return (
              <ZoneImageEditor
                key={key}
                title={key === "front" ? "Voorkant" : "Achterkant"}
                zoneKey={key}
                rect={zoneRect(zone)}
                shape={zoneShape(zone)}
                printWidthMm={zone?.print_width_mm ?? null}
                printHeightMm={zone?.print_height_mm ?? null}
                imageIndex={zoneImageIndex(zone, key)}
                imageUrls={imageUrls}
                color={uv ? "#ffffff" : g.color}
                sampleText={uv ? "Foto" : "Voorbeeld"}
                uploading={uploading}
                onChangeRect={(rect) => onChangeZone(key, { rect })}
                onChangeShape={(shape, rect) => onChangeZone(key, { shape, rect })}
                onChangeDimensions={(patch) => onChangeZone(key, patch)}
                onChangeImage={(image_index) => onChangeZone(key, { image_index })}
                onUpload={(file) => onUploadImage(key, file)}
              />
            );
          })}
      </div>
    </div>
  );
}

const MIN = 2; // minimale breedte/hoogte in %
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round = (v: number) => Math.round(v * 2) / 2; // stappen van 0,5%
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Cirkel: in pixels even breed als hoog. Alles hieronder rekent in % van de foto, dus de breedte in % is
 * hoogte% / aspect (aspect = fotobreedte / fotohoogte).
 */
function circleFromCenter(cx: number, cy: number, size: number, aspect: number): ZoneRect {
  // size = diameter in % van de fotohoogte
  const maxSize = Math.min(2 * cx * aspect, 2 * (100 - cx) * aspect, 2 * cy, 2 * (100 - cy));
  const h = round2(Math.max(MIN, Math.min(size, maxSize)));
  const w = round2(h / aspect);
  return { x: round2(clamp(cx - w / 2, 0, 100 - w)), y: round2(clamp(cy - h / 2, 0, 100 - h)), w, h };
}

type Action = { type: "move"; dx: number; dy: number } | { type: "resize" | "draw"; ax: number; ay: number };

function ZoneImageEditor({
  title,
  zoneKey,
  rect,
  shape,
  printWidthMm,
  printHeightMm,
  imageIndex,
  imageUrls,
  color,
  sampleText,
  uploading,
  onChangeRect,
  onChangeShape,
  onChangeDimensions,
  onChangeImage,
  onUpload,
}: {
  title: string;
  zoneKey: string;
  rect: ZoneRect;
  shape: ZoneShape;
  printWidthMm: number | null;
  printHeightMm: number | null;
  imageIndex: number;
  imageUrls: string[];
  color: string;
  sampleText: string;
  uploading: boolean;
  onChangeRect: (rect: ZoneRect) => void;
  onChangeShape: (shape: ZoneShape, rect: ZoneRect) => void;
  onChangeDimensions: (patch: { print_width_mm?: number | null; print_height_mm?: number | null }) => void;
  onChangeImage: (index: number) => void;
  onUpload: (file: File) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const action = useRef<Action | null>(null);
  const [r, setR] = useState<ZoneRect>(rect);
  const [loaded, setLoaded] = useState(false);
  const [aspect, setAspect] = useState(1); // breedte / hoogte van de foto
  const [rectHeightPx, setRectHeightPx] = useState(0);
  const src = imageUrls[imageIndex] ?? "";
  const circle = shape === "ellipse";

  /** Hoogte in mm volgens de verhoudingen van de getekende zone op de foto. */
  const heightFromWidth = (widthMm: number, z: ZoneRect) => Math.round((widthMm * z.h) / (z.w * aspect));
  const dimsKey = useRef<string | null>(null);

  // De zone op de foto bepaalt de verhouding breedte/hoogte: past de zone of de breedte (mm) aan, dan wordt
  // de hoogte (mm) mee aangepast -- ook als je de breedte in het kostenblok hieronder invult. Bij het laden
  // blijft een bestaande hoogte staan (die kan bewust anders ingevuld zijn); enkel een lege wordt aangevuld.
  useEffect(() => {
    if (!loaded || !printWidthMm || printWidthMm <= 0 || rect.w <= 0) return;
    const key = `${rect.w}|${rect.h}|${aspect}|${printWidthMm}`;
    const first = dimsKey.current === null;
    if (dimsKey.current === key) return;
    dimsKey.current = key;
    if (first && printHeightMm) return;
    const h = heightFromWidth(printWidthMm, rect);
    if (h !== printHeightMm) onChangeDimensions({ print_height_mm: h });
  }, [loaded, rect.w, rect.h, aspect, printWidthMm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Waarden van buitenaf (bv. typen in de %-velden, of na laden) volgen, behalve tijdens het slepen.
  useEffect(() => {
    if (!action.current) setR(rect);
  }, [rect.x, rect.y, rect.w, rect.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setLoaded(false), [src]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage) setRectHeightPx((stage.getBoundingClientRect().height * r.h) / 100);
  }, [r.h, loaded]);

  function point(e: React.PointerEvent) {
    const b = stageRef.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - b.left) / b.width) * 100, 0, 100), y: clamp(((e.clientY - b.top) / b.height) * 100, 0, 100) };
  }

  function fromCorners(ax: number, ay: number, bx: number, by: number): ZoneRect {
    if (circle) {
      // Vanuit het vaste punt een vierkant (in pixels) trekken, in de richting van de muis.
      const sx = bx >= ax ? 1 : -1, sy = by >= ay ? 1 : -1;
      const room = Math.min((sx > 0 ? 100 - ax : ax) * aspect, sy > 0 ? 100 - ay : ay);
      const h = Math.max(MIN, Math.min(Math.max(Math.abs(bx - ax) * aspect, Math.abs(by - ay)), room));
      const w = h / aspect;
      return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
    }
    const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx);
    const y1 = Math.min(ay, by), y2 = Math.max(ay, by);
    const next = { x: x1, y: y1, w: Math.max(MIN, x2 - x1), h: Math.max(MIN, y2 - y1) };
    next.w = Math.min(next.w, 100 - next.x);
    next.h = Math.min(next.h, 100 - next.y);
    return next;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = point(e);
    const target = e.target as HTMLElement;
    const handle = target.getAttribute("data-h");
    if (handle) {
      // vaste hoek = de tegenoverliggende hoek
      action.current = { type: "resize", ax: handle.includes("w") ? r.x + r.w : r.x, ay: handle.includes("n") ? r.y + r.h : r.y };
    } else if (target.closest("[data-zone-rect]")) {
      action.current = { type: "move", dx: p.x - r.x, dy: p.y - r.y };
    } else {
      action.current = { type: "draw", ax: p.x, ay: p.y };
      setR({ x: p.x, y: p.y, w: MIN, h: MIN });
    }
    stageRef.current!.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = action.current;
    if (!a) return;
    const p = point(e);
    if (a.type === "move") {
      setR((prev) => ({ ...prev, x: clamp(p.x - a.dx, 0, 100 - prev.w), y: clamp(p.y - a.dy, 0, 100 - prev.h) }));
    } else {
      setR(fromCorners(a.ax, a.ay, p.x, p.y));
    }
  }

  function stop() {
    if (!action.current) return;
    action.current = null;
    const next = circle
      ? { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.w * aspect) }
      : { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
    setR(next);
    onChangeRect(next);
  }

  function setField(k: keyof ZoneRect, value: string) {
    const v = parseFloat(value);
    if (Number.isNaN(v)) return;
    const next = { ...r, [k]: clamp(v, 0, 100) };
    // Cirkel: breedte en hoogte gaan samen.
    if (circle && k === "w") next.h = round2(next.w * aspect);
    if (circle && k === "h") next.w = round2(next.h / aspect);
    onChangeRect(next);
  }

  function setShape(next: ZoneShape) {
    if (next === shape) return;
    // Naar cirkel: zelfde middelpunt, diameter = kleinste zijde van de huidige rechthoek.
    const z = next === "ellipse" ? circleFromCenter(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w * aspect, r.h), aspect) : r;
    setR(z);
    onChangeShape(next, z);
  }

  const handle = (h: string, style: React.CSSProperties) => (
    <i
      data-h={h}
      style={{ position: "absolute", width: 12, height: 12, background: "#fff", border: "2px solid var(--cyan)", boxSizing: "border-box", ...style }}
    />
  );

  return (
    <div style={{ minWidth: 260 }}>
      <label>{title} -- foto</label>
      <select value={imageIndex} onChange={(e) => onChangeImage(parseInt(e.target.value))}>
        {imageUrls.map((_, i) => (
          <option key={i} value={i}>
            Productafbeelding {i + 1}
            {i === 0 ? " (hoofdafbeelding)" : ""}
          </option>
        ))}
        {imageIndex >= imageUrls.length && <option value={imageIndex}>Productafbeelding {imageIndex + 1} (ontbreekt)</option>}
      </select>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        {uploading && <span className="muted">Opladen...</span>}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
        {zoneKey === "front"
          ? "Gebruik liefst een foto recht van voren. Een nieuwe foto wordt achteraan bij de productafbeeldingen gezet."
          : "Gebruik liefst een foto recht van achteren, in hetzelfde formaat als de voorkant."}
      </p>

      <label>Vorm van de zone</label>
      <div style={{ display: "flex", gap: 16, marginBottom: 6 }}>
        {(
          [
            ["rect", "Rechthoek / vierkant"],
            ["ellipse", "Cirkel"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} style={checkboxLabel}>
            <input type="radio" style={{ width: "auto" }} name={`shape-${zoneKey}`} checked={shape === value} onChange={() => setShape(value)} />
            {label}
          </label>
        ))}
      </div>

      {src ? (
        <>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
            {circle
              ? "Teken een cirkel op de foto waar de gravure mag komen. Versleep hem of trek aan de hoeken om hem groter of kleiner te maken."
              : "Teken een rechthoek op de foto waar de gravure mag komen. Versleep hem of trek aan de hoeken om hem aan te passen."}
          </p>
          <div
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerCancel={stop}
            style={{ position: "relative", display: "inline-block", width: "100%", maxWidth: 480, cursor: "crosshair", touchAction: "none", userSelect: "none", background: "var(--void)" }}
          >
            <img
              src={src}
              alt=""
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
                setLoaded(true);
              }}
              style={{ display: "block", width: "100%", height: "auto", pointerEvents: "none" }}
            />
            {loaded && (
              <div
                data-zone-rect
                style={{
                  position: "absolute",
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "move",
                }}
              >
                {/* Rand apart, zodat de hoekgrepen bij een cirkel niet mee weggeknipt worden. */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    border: "2px dashed var(--cyan)",
                    borderRadius: circle ? "50%" : 0,
                    background: "rgba(0, 240, 255, 0.12)",
                    pointerEvents: "none",
                  }}
                />
                <span style={{ color, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", opacity: 0.85, pointerEvents: "none", fontSize: Math.max(10, rectHeightPx * 0.45) }}>
                  {sampleText}
                </span>
                {handle("nw", { left: -2, top: -2, cursor: "nwse-resize" })}
                {handle("ne", { right: -2, top: -2, cursor: "nesw-resize" })}
                {handle("sw", { left: -2, bottom: -2, cursor: "nesw-resize" })}
                {handle("se", { right: -2, bottom: -2, cursor: "nwse-resize" })}
              </div>
            )}
          </div>
        </>
      ) : (
        <p style={{ fontSize: 12, color: "var(--rust)" }}>
          {imageUrls.length === 0
            ? "Voeg eerst een productafbeelding toe (hierboven bij de WooCommerce-gegevens) of laad hier een foto op."
            : `Productafbeelding ${imageIndex + 1} bestaat niet -- kies een andere of laad een foto op.`}
        </p>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        {(
          [
            ["x", "Links (%)"],
            ["y", "Boven (%)"],
            ["w", "Breedte (%)"],
            ["h", "Hoogte (%)"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} style={{ minWidth: 70 }}>
            <label>{label}</label>
            <input type="number" step={0.5} min={0} max={100} value={r[k]} onChange={(e) => setField(k, e.target.value)} />
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <div style={{ minWidth: 120 }}>
          <label>{circle ? "Diameter in het echt (mm)" : "Breedte in het echt (mm)"}</label>
          <input
            type="number"
            step="1"
            min={0}
            value={printWidthMm ?? ""}
            onChange={(e) => {
              const w = e.target.value === "" ? null : parseFloat(e.target.value) || 0;
              onChangeDimensions({ print_width_mm: w, ...(w && loaded ? { print_height_mm: heightFromWidth(w, r) } : {}) });
            }}
            placeholder="bv. 80"
          />
        </div>
        <div style={{ minWidth: 120 }}>
          <label>Hoogte in het echt (mm)</label>
          <input
            type="number"
            step="1"
            min={0}
            value={printHeightMm ?? ""}
            onChange={(e) => onChangeDimensions({ print_height_mm: e.target.value === "" ? null : parseFloat(e.target.value) || 0 })}
            placeholder={loaded ? "volgt uit de breedte" : "bv. 60"}
          />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
        Meet op het product hoe breed de zone in het echt is. De hoogte wordt dan berekend uit de verhouding van je
        selectie op de foto. De breedte is ook de printbreedte die de plugin gebruikt.
      </p>
    </div>
  );
}
