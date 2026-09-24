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
export function drawPrintInQuad(ctx: CanvasRenderingContext2D, printImg: HTMLImageElement, quad: Quad) {
  const w = printImg.naturalWidth || printImg.width;
  const h = printImg.naturalHeight || printImg.height;
  const [tl, tr, br, bl] = quad;
  const srcTL = { x: 0, y: 0 };
  const srcTR = { x: w, y: 0 };
  const srcBR = { x: w, y: h };
  const srcBL = { x: 0, y: h };

  drawWarpedTriangle(ctx, printImg, [srcTL, srcTR, srcBR], [tl, tr, br]);
  drawWarpedTriangle(ctx, printImg, [srcTL, srcBR, srcBL], [tl, br, bl]);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
