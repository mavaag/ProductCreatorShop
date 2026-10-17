import { EMPTY_COST_INPUTS } from "@/lib/types";
import type { GravureSettings, Personalization, PersonalizationZone, ZoneRect } from "@/lib/types";

/**
 * Alles rond de instellingen van de 3DP Gravure Preview-plugin (zone, soort, kleur, ...), gedeeld door
 * de productpagina, de WooCommerce-sync (app -> shop) en de metadata-import (shop -> app).
 *
 * De plugin bewaart alles als post-meta op het product:
 *   _tdp_enabled, _tdp_mode, _tdp_required, _tdp_allow_logo, _tdp_color, _tdp_max_chars, _tdp_texture,
 *   _tdp_image, _tdp_x, _tdp_y, _tdp_w, _tdp_h, _tdp_print_w, _tdp_fee                        (voorkant)
 *   _tdp_back_enabled, _tdp_back_image, _tdp_back_x, ..., _tdp_back_print_w, _tdp_back_fee    (achterkant)
 * De meerprijzen (_tdp_fee / _tdp_back_fee) worden apart behandeld in de sync (buildPersonalizationMetaData).
 */

/** Zelfde standaardwaarden als de plugin gebruikt als een veld leeg is. */
export const DEFAULT_ZONE_RECT: ZoneRect = { x: 20, y: 40, w: 60, h: 20 };

export const DEFAULT_GRAVURE_SETTINGS: GravureSettings = {
  enabled: true,
  mode: "engrave",
  required: true,
  allow_logo: true,
  color: "#3b2414",
  max_chars: 30,
  texture: 20,
  back_enabled: false,
};

/** Standaard achtergrond per zone: voorkant = hoofdafbeelding, achterkant = tweede productafbeelding. */
export function defaultImageIndex(zoneKey: string): number {
  return zoneKey === "back" ? 1 : 0;
}

export function zoneRect(zone: PersonalizationZone | undefined): ZoneRect {
  return { ...DEFAULT_ZONE_RECT, ...(zone?.rect ?? {}) };
}

export function zoneImageIndex(zone: PersonalizationZone | undefined, zoneKey: string): number {
  const i = zone?.image_index;
  return i != null && i >= 0 ? i : defaultImageIndex(zoneKey);
}

/** Splitst het image_url-veld (komma-gescheiden) in losse URL's. */
export function splitImageUrls(imageUrl: string | null | undefined): string[] {
  return String(imageUrl ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/** Post-meta prefix per zone: voorkant = _tdp_, achterkant = _tdp_back_. */
function prefix(zoneKey: string): string {
  return zoneKey === "front" ? "_tdp_" : `_tdp_${zoneKey}_`;
}

function num(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "" : String(Math.round(v * 100) / 100);
}

const yesNo = (b: boolean) => (b ? "yes" : "no");

/**
 * Post-meta voor alle plugin-instellingen BEHALVE de afbeeldingen en de meerprijs.
 * Geeft een lege lijst als de gravure-instellingen niet in de app beheerd worden (personalization.gravure
 * ontbreekt) -- dan blijven de instellingen in WooCommerce onaangeroerd.
 */
export function gravureSettingsMeta(personalization: Personalization | null | undefined): { key: string; value: string }[] {
  if (personalization?.plugin !== "gravure_uv" || !personalization.gravure) return [];
  const g = { ...DEFAULT_GRAVURE_SETTINGS, ...personalization.gravure };
  const meta: { key: string; value: string }[] = [
    { key: "_tdp_enabled", value: yesNo(g.enabled) },
    { key: "_tdp_mode", value: g.mode === "uv" ? "uv" : "engrave" },
    { key: "_tdp_required", value: yesNo(g.required) },
    { key: "_tdp_allow_logo", value: yesNo(g.allow_logo) },
    { key: "_tdp_color", value: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(g.color) ? g.color : "" },
    { key: "_tdp_max_chars", value: num(g.max_chars) },
    { key: "_tdp_texture", value: num(g.texture) },
    { key: "_tdp_back_enabled", value: yesNo(g.back_enabled) },
  ];
  for (const zoneKey of ["front", "back"]) {
    const zone = personalization.zones.find((z) => z.key === zoneKey);
    const r = zoneRect(zone);
    const p = prefix(zoneKey);
    meta.push(
      { key: `${p}x`, value: num(r.x) },
      { key: `${p}y`, value: num(r.y) },
      { key: `${p}w`, value: num(r.w) },
      { key: `${p}h`, value: num(r.h) },
      { key: `${p}print_w`, value: num(zone?.print_width_mm ?? null) }
    );
  }
  return meta;
}

/**
 * Post-meta voor de preview-afbeeldingen (_tdp_image / _tdp_back_image), op basis van de afbeeldingen
 * zoals WooCommerce ze NA het opslaan van het product teruggeeft (dus met de URL's van de eigen site --
 * nodig omdat de preview in de browser van de klant de foto in een canvas tekent, wat enkel werkt met
 * afbeeldingen van hetzelfde domein).
 * Voorkant met de hoofdafbeelding -> leeg veld, dan neemt de plugin zelf de uitgelichte afbeelding.
 */
export function gravureImageMeta(
  personalization: Personalization | null | undefined,
  wcImageSrcs: string[]
): { meta: { key: string; value: string }[]; warnings: string[] } {
  if (personalization?.plugin !== "gravure_uv" || !personalization.gravure) return { meta: [], warnings: [] };
  const warnings: string[] = [];
  const front = personalization.zones.find((z) => z.key === "front");
  const back = personalization.zones.find((z) => z.key === "back");

  const frontIdx = zoneImageIndex(front, "front");
  let frontSrc = "";
  if (frontIdx > 0) {
    frontSrc = wcImageSrcs[frontIdx] ?? "";
    if (!frontSrc) warnings.push(`preview-afbeelding voorkant (afbeelding ${frontIdx + 1}) bestaat niet in WooCommerce -- hoofdafbeelding gebruikt`);
  }

  let backSrc = "";
  if (personalization.gravure.back_enabled) {
    const backIdx = zoneImageIndex(back, "back");
    backSrc = wcImageSrcs[backIdx] ?? "";
    if (!backSrc) warnings.push(`foto achterkant (afbeelding ${backIdx + 1}) bestaat niet in WooCommerce -- de achterkant is in de shop niet beschikbaar`);
  }

  return {
    meta: [
      { key: "_tdp_image", value: frontSrc },
      { key: "_tdp_back_image", value: backSrc },
    ],
    warnings,
  };
}

/** Koppelt de nieuwe meta aan bestaande meta-rijen (zelfde id), zodat WooCommerce ze bijwerkt i.p.v. dupliceert. */
export function withExistingMetaIds(
  existing: { id: number; key: string; value: unknown }[],
  meta: { key: string; value: string }[]
): { id?: number; key: string; value: string }[] {
  return meta.map((m) => {
    const found = existing.find((e) => e.key === m.key);
    return found ? { id: found.id, ...m } : m;
  });
}

/** True als alle meta al exact zo in WooCommerce staat (dan is een extra update overbodig). */
export function metaUpToDate(existing: { key: string; value: unknown }[], meta: { key: string; value: string }[]): boolean {
  return meta.every((m) => {
    const found = existing.find((e) => e.key === m.key);
    return found ? String(found.value ?? "") === m.value : m.value === "";
  });
}

/** Vergelijkt afbeeldings-URL's los van de formaat-suffix die WordPress toevoegt (bv. foto-1024x768.jpg = foto.jpg). */
function sameImage(a: string, b: string): boolean {
  const norm = (u: string) => u.split("?")[0].replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1").replace(/-scaled(\.[a-z0-9]+)$/i, "$1").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Omgekeerde richting (WooCommerce -> app, voor de metadata-import): leest de _tdp_*-meta van een
 * WooCommerce-product en vult daarmee de gravure-instellingen, zones en afbeeldingskeuze aan. Kosten
 * en meerprijs blijven zoals ze lokaal zijn (de app blijft daarvoor de bron van waarheid).
 * Geeft null als het product in WooCommerce geen gravure-instellingen heeft.
 */
export function personalizationFromWooMeta(
  current: Personalization,
  meta: { key: string; value: unknown }[],
  wcImageSrcs: string[]
): Personalization | null {
  const get = (key: string): string | null => {
    const m = meta.find((x) => x.key === key);
    return m == null || m.value == null ? null : String(m.value);
  };
  // De plugin bewaart _tdp_enabled = "no" bij ELK product dat je in WooCommerce opslaat, dus enkel
  // overnemen als de personalisatie daar effectief aan staat, of als het product hier al de gravure-plugin heeft.
  if (get("_tdp_enabled") == null) return null;
  if (current.plugin === "none" && get("_tdp_enabled") !== "yes") return null;
  if (current.plugin !== "none" && current.plugin !== "gravure_uv") return null;

  const n = (key: string, fallback: number | null): number | null => {
    const v = get(key);
    if (v == null || v === "") return fallback;
    const f = parseFloat(v);
    return Number.isNaN(f) ? fallback : f;
  };
  const d = DEFAULT_GRAVURE_SETTINGS;
  const gravure: GravureSettings = {
    enabled: get("_tdp_enabled") === "yes",
    mode: get("_tdp_mode") === "uv" ? "uv" : "engrave",
    required: (get("_tdp_required") || "yes") === "yes",
    allow_logo: (get("_tdp_allow_logo") || "yes") === "yes",
    color: get("_tdp_color") || d.color,
    max_chars: n("_tdp_max_chars", d.max_chars),
    texture: n("_tdp_texture", d.texture),
    back_enabled: get("_tdp_back_enabled") === "yes",
  };

  const imageIndex = (key: string, zoneKey: string): number => {
    const src = get(key) || "";
    if (!src) return zoneKey === "front" ? 0 : defaultImageIndex(zoneKey);
    const idx = wcImageSrcs.findIndex((u) => sameImage(u, src));
    return idx >= 0 ? idx : defaultImageIndex(zoneKey);
  };

  const zones = ["front", "back"].map((zoneKey) => {
    const p = prefix(zoneKey);
    const existing = current.zones.find((z) => z.key === zoneKey);
    const printW = n(`${p}print_w`, null);
    return {
      key: zoneKey,
      print_width_mm: printW && printW > 0 ? printW : existing?.print_width_mm ?? null,
      print_height_mm: existing?.print_height_mm ?? null,
      cost_inputs: existing?.cost_inputs ?? EMPTY_COST_INPUTS,
      fee: existing?.fee ?? null,
      rect: {
        x: n(`${p}x`, DEFAULT_ZONE_RECT.x) as number,
        y: n(`${p}y`, DEFAULT_ZONE_RECT.y) as number,
        w: n(`${p}w`, DEFAULT_ZONE_RECT.w) as number,
        h: n(`${p}h`, DEFAULT_ZONE_RECT.h) as number,
      },
      image_index: imageIndex(`${p}image`, zoneKey),
    } satisfies PersonalizationZone;
  });

  return { plugin: "gravure_uv", zones, gravure };
}

/** JSON.stringify met gesorteerde sleutels -- Postgres (jsonb) bewaart sleutels in een andere volgorde. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .filter((k) => (v as any)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
