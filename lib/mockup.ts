import { ZoneShape } from "./types";

export type Point = { x: number; y: number };

/** Hoekpunten van het kader, volgorde: linksboven, rechtsboven, rechtsonder, linksonder. */
export type Quad = [Point, Point, Point, Point];

export const DEFAULT_CORNERS: Quad = [
  { x: 0.35, y: 0.3 },
  { x: 0.65, y: 0.3 },
  { x: 0.65, y: 0.7 },
  { x: 0.35, y: 0.7 },
];

type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

/**
 * Affiene matrix (canvas-conventie: x'=a*x+c*y+e, y'=b*x+d*y+f) die de 3 bronpunten
 * exact op de 3 doelpunten afbeeldt. Gebruikt om per driehoek de print te warpen.
 */
function solveAffine(src: [Point, Point, Point], dst: [Point, Point, Point]): Affine | null {
  const [p0, p1, p2] = src;
  const m = [
    [p0.x, p0.y, 1],
    [p1.x, p1.y, 1],
    [p2.x, p2.y, 1],
  ];

  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-9) return null;

  const invDet = 1 / det;
  const inv = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * invDet,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invDet,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * invDet,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * invDet,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invDet,
    ],
  ];

  const mulVec = (v: [number, number, number]) =>
    [
      inv[0][0] * v[0] + inv[0][1] * v[1] + inv[0][2] * v[2],
      inv[1][0] * v[0] + inv[1][1] * v[1] + inv[1][2] * v[2],
      inv[2][0] * v[0] + inv[2][1] * v[1] + inv[2][2] * v[2],
    ] as [number, number, number];

  const [a, c, e] = mulVec([dst[0].x, dst[1].x, dst[2].x]);
  const [b, d, f] = mulVec([dst[0].y, dst[1].y, dst[2].y]);

  return { a, b, c, d, e, f };
}

function drawWarpedTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  src: [Point, Point, Point],
  dst: [Point, Point, Point]
) {
  const m = solveAffine(src, dst);
  if (!m) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dst[0].x, dst[0].y);
  ctx.lineTo(dst[1].x, dst[1].y);
  ctx.lineTo(dst[2].x, dst[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Tekent `printImg` vervormd in het vierhoek `quad` (in pixelcoördinaten van de canvas).
 * De vierhoek wordt via de diagonaal linksboven-rechtsonder in 2 driehoeken gesplitst
 * en elke driehoek krijgt zijn eigen affiene transform -- de standaardtruc om een
 * rechthoek met perspectief in canvas 2D te warpen (canvas kent geen projectieve transform).
 */
export function drawPrintInQuad(ctx: CanvasRenderingContext2D, printImg: HTMLImageElement | HTMLCanvasElement, quad: Quad) {
  const w = printImg instanceof HTMLImageElement ? printImg.naturalWidth || printImg.width : printImg.width;
  const h = printImg instanceof HTMLImageElement ? printImg.naturalHeight || printImg.height : printImg.height;
  const [tl, tr, br, bl] = quad;
  const srcTL = { x: 0, y: 0 };
  const srcTR = { x: w, y: 0 };
  const srcBR = { x: w, y: h };
  const srcBL = { x: 0, y: h };

  drawWarpedTriangle(ctx, printImg, [srcTL, srcTR, srcBR], [tl, tr, br]);
  drawWarpedTriangle(ctx, printImg, [srcTL, srcBR, srcBL], [tl, br, bl]);
}

/**
 * Bij een ronde zone mogen de 4 punten van de template ook óp de rand van de cirkel staan (boven, rechts,
 * onder, links) i.p.v. op de hoeken van het vierkant errond. Dat herkennen we aan de zijden die ~45° schuin
 * staan; dan worden de hoeken van het omschreven vierkant berekend (exact, ook met perspectief: de raaklijnen
 * in de 4 punten lopen evenwijdig aan de diameters).
 */
export function zoneQuad(quad: Quad, shape: ZoneShape | undefined): Quad {
  if (shape !== "ellipse") return quad;
  const [p0, p1, p2, p3] = quad;
  const tilt = (a: Point, b: Point) => {
    const deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90;
    return deg > 22.5 && deg < 67.5;
  };
  if (!(tilt(p0, p1) && tilt(p1, p2) && tilt(p2, p3) && tilt(p3, p0))) return quad;
  const c = { x: (p0.x + p1.x + p2.x + p3.x) / 4, y: (p0.y + p1.y + p2.y + p3.y) / 4 };
  const corner = (a: Point, b: Point) => ({ x: a.x + b.x - c.x, y: a.y + b.y - c.y });
  return [corner(p0, p3), corner(p0, p1), corner(p2, p1), corner(p2, p3)];
}

/** Punt (u, v in 0-1) binnen de vierhoek, bilineair -- om de cirkel in de template-editor te tonen. */
export function pointInQuad(quad: Quad, u: number, v: number): Point {
  const [tl, tr, br, bl] = quad;
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

/** Print in de zone van de template: bij een ronde zone wordt ze tot de cirkel binnen de zone bijgesneden. */
export function drawPrintInZone(ctx: CanvasRenderingContext2D, printImg: HTMLImageElement, quad: Quad, shape: ZoneShape | undefined) {
  if (shape !== "ellipse") {
    drawPrintInQuad(ctx, printImg, quad);
    return;
  }
  const c = document.createElement("canvas");
  c.width = printImg.naturalWidth || printImg.width;
  c.height = printImg.naturalHeight || printImg.height;
  const x = c.getContext("2d")!;
  x.drawImage(printImg, 0, 0);
  x.globalCompositeOperation = "destination-in";
  x.beginPath();
  x.ellipse(c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2);
  x.fill();
  drawPrintInQuad(ctx, c, zoneQuad(quad, shape));
}

function loadImageOnce(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("kon de afbeelding niet laden"));
    img.src = src;
  });
}

/**
 * Laadt een afbeelding zodat ze in een canvas bewerkt en gedownload mag worden (CORS). Mislukt dat voor een
 * externe URL, dan nog één keer buiten de browsercache om: de opslag stuurt geen "Vary: Origin" mee, dus
 * een eerder als gewone <img> geladen (en gecachete) versie zonder CORS-header laat het laden mislukken.
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  try {
    return await loadImageOnce(src);
  } catch (err) {
    if (/^(blob|data):/.test(src)) throw new Error("kon het gekozen bestand niet openen (is het wel een JPG, PNG of WebP?)");
    try {
      return await loadImageOnce(`${src}${src.includes("?") ? "&" : "?"}cors=1`);
    } catch {
      throw new Error("kon de foto van de template niet laden");
    }
  }
}
