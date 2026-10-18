import { Quad, drawPrintInQuad, zoneQuad } from "./mockup";
import { ZoneShape } from "./types";

/**
 * Mockup van een lasergravure: het ontwerp (logo, foto en/of tekst) wordt omgezet naar één gravurekleur
 * en met perspectief in de zone van de productfoto gezet -- zelfde regels als de preview in de
 * 3DP Gravure Preview-plugin, zodat de mockup toont wat de klant in de shop ziet.
 */

export type EngraveOptions = {
  color: string; // gravurekleur, bv. #3b2414 (hout) of #f2f2f2 (leisteen)
  shape: ZoneShape; // vorm van de template-zone; ronde zone = cirkel/ovaal binnen de 4 hoekpunten
  imageMode: "auto" | "logo" | "photo"; // logo: donker = graveren; foto op lichte gravure: licht = graveren
  text: string;
  font: string;
  imageScale: number; // 1 = zo groot mogelijk binnen de zone; kleiner/groter naar keuze
  imageOffsetX: number; // verschuiving van de afbeelding t.o.v. het midden, in fractie van de zonebreedte
  imageOffsetY: number; // idem, in fractie van de zonehoogte
  textScale: number; // 1 = zo groot mogelijk binnen de tekstruimte
  textOffsetX: number; // verschuiving van de tekst, in fractie van de zonebreedte
  textOffsetY: number; // idem, in fractie van de zonehoogte
};

/** Zelfde lettertypes als in de plugin. */
export const ENGRAVE_FONTS: Record<string, string> = {
  Montserrat: "Montserrat:wght@600",
  "Playfair Display": "Playfair+Display:wght@700",
  "Roboto Slab": "Roboto+Slab:wght@600",
  "Great Vibes": "Great+Vibes",
  "Dancing Script": "Dancing+Script:wght@700",
  Pacifico: "Pacifico",
};

export const ENGRAVE_COLOR_PRESETS: { label: string; color: string }[] = [
  { label: "Hout", color: "#3b2414" },
  { label: "Leisteen", color: "#f2f2f2" },
  { label: "Geanodiseerd metaal", color: "#e6e6e6" },
  { label: "Leder", color: "#2b1a10" },
];

/** Laadt de lettertypes van de plugin (eenmalig) en wacht tot het gekozen lettertype klaar is. */
export async function loadEngraveFont(font: string): Promise<void> {
  if (typeof document === "undefined") return;
  if (!document.getElementById("engrave-fonts")) {
    const link = document.createElement("link");
    link.id = "engrave-fonts";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${Object.values(ENGRAVE_FONTS).join("&family=")}&display=swap`;
    document.head.appendChild(link);
  }
  try {
    await document.fonts.load(`80px "${font}"`);
  } catch {
    // dan maar met het standaardlettertype
  }
}

function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || "#000000").replace("#", "");
  if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Lichte gravurekleur (leisteen, metaal): de gravure maakt de foto lichter i.p.v. donkerder. */
export function isLightEngraving(color: string): boolean {
  const [r, g, b] = hexToRgb(color);
  return luminance(r, g, b) / 255 > 0.5;
}

/** Logo of foto? Een logo heeft langs de rand (bijna) overal een witte of transparante achtergrond. */
function looksLikeLogo(d: ImageData): boolean {
  const { width: w, height: h, data } = d;
  let bg = 0;
  let n = 0;
  const check = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 32 || luminance(data[i], data[i + 1], data[i + 2]) > 235) bg++;
    n++;
  };
  const step = Math.max(1, Math.round(Math.max(w, h) / 200));
  for (let x = 0; x < w; x += step) { check(x, 0); check(x, h - 1); }
  for (let y = 0; y < h; y += step) { check(0, y); check(w - 1, y); }
  return n > 0 && bg / n >= 0.6;
}

/** Zet een afbeelding om naar een "gravure": overal de gravurekleur, met de dekking volgens het ontwerp. */
function engraveImage(img: HTMLImageElement, opts: EngraveOptions): HTMLCanvasElement {
  const max = 1600;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height);
  const [r, g, b] = hexToRgb(opts.color);
  const photo = opts.imageMode === "photo" || (opts.imageMode === "auto" && !looksLikeLogo(d));
  const positive = photo && isLightEngraving(opts.color);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = luminance(d.data[i], d.data[i + 1], d.data[i + 2]) / 255;
    const a = d.data[i + 3] / 255;
    const alpha = positive ? lum * a : Math.min(1, (1 - lum) * a * (photo ? 1 : 1.2));
    d.data[i] = r;
    d.data[i + 1] = g;
    d.data[i + 2] = b;
    d.data[i + 3] = Math.round(alpha * 255);
  }
  x.putImageData(d, 0, 0);
  return c;
}

// Het omzetten naar gravurekleur is per pixel en dus traag: hergebruiken zolang kleur en soort gelijk blijven,
// zodat verschuiven/vergroten van de afbeelding vlot blijft.
const engraveCache = new WeakMap<HTMLImageElement, { key: string; canvas: HTMLCanvasElement }>();

function engraveImageCached(img: HTMLImageElement, opts: EngraveOptions): HTMLCanvasElement {
  const key = `${opts.color}|${opts.imageMode}`;
  const hit = engraveCache.get(img);
  if (hit && hit.key === key) return hit.canvas;
  const canvas = engraveImage(img, opts);
  engraveCache.set(img, { key, canvas });
  return canvas;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Bouwt het ontwerp (afbeelding en/of tekst) als gravure op een vlak met dezelfde verhouding als de zone,
 * zodat het na het vervormen niet uitgerekt is. Op 100% past de afbeelding net in de zone; bij een ronde zone
 * zonder tekst vult ze de volledige cirkel (de hoeken vallen weg), met tekst erbij past alles binnen de grootste
 * rechthoek in de cirkel. Wat na vergroten/verschuiven buiten de zone valt, wordt weggesneden.
 */
function buildEngravingLayer(design: HTMLImageElement | null, quad: Quad, opts: EngraveOptions): HTMLCanvasElement {
  const [tl, tr, br, bl] = quad;
  const aspect = (dist(tl, tr) + dist(bl, br)) / Math.max(1, dist(tl, bl) + dist(tr, br));
  const W = 1600;
  const H = Math.max(1, Math.round(W / Math.max(0.05, aspect)));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // Beschikbare ruimte: bij een cirkel de ingeschreven rechthoek, met wat marge.
  const inset = opts.shape === "ellipse" ? (1 - Math.SQRT1_2) / 2 : 0;
  const pad = 0.05;
  const area = { x: W * (inset + pad), y: H * (inset + pad), w: W * (1 - 2 * (inset + pad)), h: H * (1 - 2 * (inset + pad)) };

  const text = opts.text.trim();
  const fullArea = { x: 0, y: 0, w: W, h: H };
  const imageArea = design && text ? { ...area, h: area.h * 0.7 } : opts.shape === "ellipse" ? fullArea : area;
  const textArea = design && text ? { ...area, y: area.y + area.h * 0.75, h: area.h * 0.25 } : area;

  if (design) {
    const engraved = engraveImageCached(design, opts);
    const fit = Math.min(imageArea.w / engraved.width, imageArea.h / engraved.height) * (opts.imageScale || 1);
    const w = engraved.width * fit;
    const h = engraved.height * fit;
    const cx = imageArea.x + imageArea.w / 2 + (opts.imageOffsetX || 0) * W;
    const cy = imageArea.y + imageArea.h / 2 + (opts.imageOffsetY || 0) * H;
    ctx.drawImage(engraved, cx - w / 2, cy - h / 2, w, h);
  }

  if (text) {
    let size = textArea.h * 0.85;
    ctx.font = `${size}px "${opts.font}"`;
    const measured = ctx.measureText(text).width;
    if (measured > textArea.w) size = (size * textArea.w) / measured;
    size *= opts.textScale || 1;
    ctx.font = `${size}px "${opts.font}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color;
    ctx.fillText(
      text,
      textArea.x + textArea.w / 2 + (opts.textOffsetX || 0) * W,
      textArea.y + textArea.h / 2 + (opts.textOffsetY || 0) * H
    );
  }

  if (opts.shape === "ellipse") {
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  return c;
}

/**
 * Tekent de gravure op `ctx` (waar de productfoto al op staat). Een lichte gravurekleur licht de foto op
 * ('screen'), een donkere maakt ze donkerder ('multiply'); een smalle rand eronder geeft wat diepte.
 */
export function drawEngravingInQuad(ctx: CanvasRenderingContext2D, design: HTMLImageElement | null, zone: Quad, opts: EngraveOptions) {
  const quad = zoneQuad(zone, opts.shape);
  const layer = buildEngravingLayer(design, quad, opts);
  const warped = document.createElement("canvas");
  warped.width = ctx.canvas.width;
  warped.height = ctx.canvas.height;
  drawPrintInQuad(warped.getContext("2d")!, layer, quad);

  const light = isLightEngraving(opts.color);
  const depth = Math.max(1, Math.round(ctx.canvas.width / 1500));
  const edge = document.createElement("canvas");
  edge.width = warped.width;
  edge.height = warped.height;
  const e = edge.getContext("2d")!;
  e.drawImage(warped, 0, 0);
  e.globalCompositeOperation = "source-in";
  e.fillStyle = light ? "#000000" : "#ffffff";
  e.fillRect(0, 0, edge.width, edge.height);

  ctx.save();
  ctx.globalCompositeOperation = light ? "multiply" : "screen";
  ctx.globalAlpha = light ? 0.35 : 0.25;
  ctx.drawImage(edge, 0, depth);
  ctx.globalCompositeOperation = light ? "screen" : "multiply";
  ctx.globalAlpha = 0.9;
  ctx.filter = "blur(0.5px)"; // laser brandt nooit messcherp
  ctx.drawImage(warped, 0, 0);
  ctx.restore();
}
