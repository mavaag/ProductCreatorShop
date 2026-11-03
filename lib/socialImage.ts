// Social-afbeeldingen (Facebook/Instagram) tekenen in de browser: vierkant (1080x1080, feed) en staand
// (1080x1920, Stories). Productfoto's komen via /api/social/img (zelfde origine, anders "besmet" het canvas).
// Instagram aanvaardt enkel JPEG, dus we exporteren als JPEG.

export type SocialTheme = { key: string; label: string; bg: string; card: string; text: string; muted: string; accent: string; accentText: string };

export const SOCIAL_THEMES: SocialTheme[] = [
  { key: "warm", label: "Warm", bg: "#f6efe6", card: "#ffffff", text: "#2b2118", muted: "#7a6a5a", accent: "#e8692c", accentText: "#ffffff" },
  { key: "donker", label: "Donker", bg: "#1f2328", card: "#2c3238", text: "#ffffff", muted: "#b8c0c8", accent: "#f2a33a", accentText: "#1f2328" },
  { key: "kerst", label: "Kerst", bg: "#123d2c", card: "#fdf8f0", text: "#ffffff", muted: "#d9e6dc", accent: "#c8302c", accentText: "#ffffff" },
  { key: "zacht", label: "Zacht", bg: "#f7e9ee", card: "#ffffff", text: "#3a2230", muted: "#8a6676", accent: "#c94f7c", accentText: "#ffffff" },
  { key: "fris", label: "Fris", bg: "#e7f3f5", card: "#ffffff", text: "#12343b", muted: "#557a82", accent: "#1f8a9e", accentText: "#ffffff" },
];

export type SocialDesign = {
  title: string;
  subtitle: string;
  badge: string; // bv. "-10%" of "Nieuw" (leeg = geen)
  theme: string;
  showPrices: boolean;
  products: { name: string; price: number; image: string }[]; // image = URL in de shop (groot formaat)
  image?: string; // eigen afbeelding (bv. logo) in plaats van de producten
  logo?: string; // klein logo links onderaan, vóór de merknaam (leeg = geen)
};

export type SocialFormat = "feed" | "story";

const FONT = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;

function money(n: number) {
  return "€ " + n.toFixed(2).replace(".", ",");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Tekst over meerdere regels, verkleint tot hij past (max. regels). Geeft de gebruikte hoogte terug. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, maxLines: number, weight = 800, minSize = 36): number {
  for (let s = size; s >= minSize; s -= 4) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + word : word;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) {
      const lh = Math.round(s * 1.12);
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
      return lines.length * lh;
    }
  }
  ctx.font = `${weight} ${minSize}px ${FONT}`;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  ctx.fillText(t + (t === text ? "" : "…"), x, y);
  return Math.round(minSize * 1.12);
}

/** Foto binnen een vak (contain, gecentreerd). */
function drawContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const r = Math.min(w / img.width, h / img.height);
  const dw = img.width * r, dh = img.height * r;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export type ImageLoader = (url: string) => Promise<ImageBitmap | null>;

export async function renderSocial(design: SocialDesign, format: SocialFormat, load: ImageLoader): Promise<HTMLCanvasElement> {
  const W = 1080, H = format === "feed" ? 1080 : 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const th = SOCIAL_THEMES.find((t) => t.key === design.theme) ?? SOCIAL_THEMES[0];
  const pad = 64;

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";

  // titel + ondertitel
  let y = format === "feed" ? 56 : 170;
  ctx.fillStyle = th.text;
  const titleW = W - pad * 2 - (design.badge ? 200 : 0);
  y += fitText(ctx, design.title || "3D Print For You", pad, y, titleW, format === "feed" ? 76 : 92, 2);
  if (design.subtitle) {
    y += 10;
    ctx.fillStyle = th.muted;
    y += fitText(ctx, design.subtitle, pad, y, titleW, format === "feed" ? 38 : 46, 2, 500, 28);
  }
  y += format === "feed" ? 34 : 60;

  // badge (rond, rechtsboven)
  if (design.badge) {
    const r = 92, cx = W - pad - r + 8, cy = (format === "feed" ? 56 : 170) + r - 14;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.12);
    ctx.fillStyle = th.accent;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = th.accentText;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let s = 64;
    do { ctx.font = `900 ${s}px ${FONT}`; s -= 4; } while (ctx.measureText(design.badge).width > r * 1.6 && s > 22);
    ctx.fillText(design.badge, 0, 2);
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "top";
  }

  // productvakken
  const footerH = format === "feed" ? 110 : 230;
  const areaY = y, areaH = H - footerH - areaY - (format === "feed" ? 10 : 40);
  // eigen afbeelding (logo/foto): één groot vak, geen producten
  if (design.image) {
    const img = await load(design.image);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = th.card;
    roundRect(ctx, pad, areaY, W - pad * 2, areaH, 28); ctx.fill();
    ctx.restore();
    if (img) drawContain(ctx, img, pad + 40, areaY + 40, W - pad * 2 - 80, areaH - 80);
  } else if (!design.products.length) {
    // niets gekozen: merknaam groot in het midden
    ctx.fillStyle = th.accent;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `900 ${format === "feed" ? 120 : 140}px ${FONT}`;
    ctx.fillText("3D Print", W / 2, areaY + areaH / 2 - 70);
    ctx.fillText("For You", W / 2, areaY + areaH / 2 + 70);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
  }
  const prods = design.image ? [] : design.products.slice(0, 4);
  const imgs = await Promise.all(prods.map((p) => (p.image ? load(p.image) : Promise.resolve(null))));
  const n = Math.max(prods.length, 1);
  const cols = n === 1 ? 1 : 2;
  const rows = n <= 2 && format === "feed" ? 1 : Math.ceil(n / cols);
  const gap = 28;
  const useCols = n === 2 && format === "story" ? 1 : cols;
  const useRows = n === 2 && format === "story" ? 2 : rows;
  const cw = (W - pad * 2 - gap * (useCols - 1)) / useCols;
  const ch = (areaH - gap * (useRows - 1)) / useRows;
  const labelH = design.showPrices || prods.length > 1 ? Math.min(92, ch * 0.2) : 0;
  prods.forEach((p, i) => {
    const col = i % useCols, row = Math.floor(i / useCols);
    // laatste rij met één product: centreren
    const inRow = Math.min(useCols, prods.length - row * useCols);
    const offset = inRow < useCols ? (cw + gap) / 2 : 0;
    const x = pad + col * (cw + gap) + offset, yy = areaY + row * (ch + gap);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = th.card;
    roundRect(ctx, x, yy, cw, ch, 28); ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, yy, cw, ch, 28); ctx.clip();
    const img = imgs[i];
    if (img) drawContain(ctx, img, x + 18, yy + 18, cw - 36, ch - 36 - labelH);
    if (labelH) {
      const ly = yy + ch - labelH;
      ctx.fillStyle = th.card === "#ffffff" || th.card === "#fdf8f0" ? "#2b2118" : th.text;
      const name = p.name.replace(/\s+[–-]\s+.*$/, "");
      ctx.font = `600 ${Math.round(labelH * 0.34)}px ${FONT}`;
      let t = name;
      const maxW = cw - 40 - (design.showPrices && p.price > 0 ? ctx.measureText(money(p.price)).width + 24 : 0);
      while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      ctx.fillText(t === name ? name : t + "…", x + 20, ly + labelH * 0.3);
      if (design.showPrices && p.price > 0) {
        ctx.font = `800 ${Math.round(labelH * 0.36)}px ${FONT}`;
        ctx.fillStyle = th.accent;
        ctx.textAlign = "right";
        ctx.fillText(money(p.price), x + cw - 20, ly + labelH * 0.28);
        ctx.textAlign = "left";
      }
    }
    ctx.restore();
  });

  // voettekst
  const fy = H - footerH + (format === "feed" ? 24 : 60);
  // webadres-knop rechts
  const url = "3dprintforyou.be";
  ctx.font = `800 ${format === "feed" ? 34 : 40}px ${FONT}`;
  const uw = ctx.measureText(url).width + 48;
  const uh = format === "feed" ? 64 : 76;
  const ux = W - pad - uw;
  ctx.fillStyle = th.accent;
  roundRect(ctx, ux, fy + 4, uw, uh, uh / 2); ctx.fill();
  ctx.fillStyle = th.accentText;
  ctx.textBaseline = "middle";
  ctx.fillText(url, ux + 24, fy + 4 + uh / 2 + 1);
  ctx.textBaseline = "top";
  // logo + merknaam links, krimpt tot hij naast de knop past
  let tx = pad;
  const logoImg = design.logo ? await load(design.logo) : null;
  if (logoImg) {
    const ls = format === "feed" ? 104 : 124;
    drawContain(ctx, logoImg, pad, fy - 14, ls, ls);
    tx = pad + ls + 18;
  }
  const maxW = ux - tx - 24;
  const fitFont = (text: string, weight: number, size: number) => {
    let sz = size;
    do { ctx.font = `${weight} ${sz}px ${FONT}`; sz -= 2; } while (ctx.measureText(text).width > maxW && sz > 16);
  };
  ctx.fillStyle = th.text;
  fitFont("3D Print For You", 800, format === "feed" ? 40 : 48);
  ctx.fillText("3D Print For You", tx, fy);
  ctx.fillStyle = th.muted;
  fitFont("Gepersonaliseerd · gemaakt in België", 500, format === "feed" ? 28 : 34);
  ctx.fillText("Gepersonaliseerd · gemaakt in België", tx, fy + (format === "feed" ? 50 : 60));
  return c;
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.88): string {
  return c.toDataURL("image/jpeg", quality);
}

/**
 * Carrouselslide (1080x1080): één product groot (met naam en prijs) of een eigen foto, in de kleuren van het
 * ontwerp, met "3/7" rechtsboven en het webadres onderaan.
 */
export async function renderSlide(
  slide: { kind: "product"; name: string; price: number; image: string } | { kind: "photo"; image: string },
  design: Pick<SocialDesign, "theme" | "showPrices" | "logo">,
  index: number,
  total: number,
  load: ImageLoader,
): Promise<HTMLCanvasElement> {
  const W = 1080, H = 1080, pad = 56;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const th = SOCIAL_THEMES.find((t) => t.key === design.theme) ?? SOCIAL_THEMES[0];
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";

  const img = slide.image ? await load(slide.image) : null;
  const footer = 96;
  const labelH = slide.kind === "product" ? 150 : 0;
  const cardY = pad, cardH = H - pad - footer - cardY;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = th.card;
  roundRect(ctx, pad, cardY, W - pad * 2, cardH, 32); ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, pad, cardY, W - pad * 2, cardH, 32); ctx.clip();
  if (img) drawContain(ctx, img, pad + 30, cardY + 30, W - pad * 2 - 60, cardH - 60 - labelH);
  if (slide.kind === "product") {
    const ly = cardY + cardH - labelH;
    const light = th.card === "#ffffff" || th.card === "#fdf8f0";
    ctx.fillStyle = light ? "#2b2118" : th.text;
    const name = slide.name.replace(/\s+[–-]\s+.*$/, "");
    const priceW = design.showPrices && slide.price > 0 ? 260 : 0;
    fitText(ctx, name, pad + 36, ly + 22, W - pad * 2 - 72 - priceW, 48, 2, 700, 30);
    if (priceW) {
      ctx.font = `900 60px ${FONT}`;
      ctx.fillStyle = th.accent;
      ctx.textAlign = "right";
      ctx.fillText(money(slide.price), W - pad - 36, ly + 30);
      ctx.textAlign = "left";
    }
  }
  ctx.restore();

  // teller rechtsboven
  const tag = `${index + 1}/${total}`;
  ctx.font = `800 34px ${FONT}`;
  const tw = ctx.measureText(tag).width + 36;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, W - pad - 24 - tw, cardY + 24, tw, 54, 27); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(tag, W - pad - 24 - tw + 18, cardY + 24 + 28);

  // voettekst
  let tx = pad;
  const logoImg = design.logo ? await load(design.logo) : null;
  if (logoImg) {
    drawContain(ctx, logoImg, pad, H - footer / 2 - 44, 88, 88);
    tx = pad + 88 + 14;
  }
  ctx.fillStyle = th.text;
  ctx.font = `800 38px ${FONT}`;
  ctx.fillText("3D Print For You", tx, H - footer / 2);
  ctx.fillStyle = th.accent;
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("3dprintforyou.be", W - pad, H - footer / 2);
  ctx.textAlign = "left";
  return c;
}
