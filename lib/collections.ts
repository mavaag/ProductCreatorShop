import type { Collection } from "./types";

/** Hoofdcategorie in WooCommerce waaronder alle collecties staan. */
export const COLLECTIONS_PARENT = "Collecties";

/** Categoriepad in WooCommerce voor een collectie, bv. "Collecties > Kerst". */
export function collectionCategoryPath(name: string): string {
  return `${COLLECTIONS_PARENT} > ${name.trim()}`;
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidMmDd(v: string | null | undefined): boolean {
  return !!v && MMDD.test(v);
}

/** Valt datum d (standaard vandaag) binnen het seizoen? Een seizoen mag over nieuwjaar lopen (bv. 12-01 tot 01-06). */
export function inSeason(c: Pick<Collection, "season_start" | "season_end">, d: Date = new Date()): boolean {
  if (!isValidMmDd(c.season_start) || !isValidMmDd(c.season_end)) return false;
  const today = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const a = c.season_start as string;
  const b = c.season_end as string;
  return a <= b ? today >= a && today <= b : today >= a || today <= b;
}

/** Wordt de collectie nu uitgelicht op de homepage? */
export function isHighlighted(c: Pick<Collection, "highlight" | "season_start" | "season_end">, d: Date = new Date()): boolean {
  if (c.highlight === "always") return true;
  if (c.highlight === "never") return false;
  return inSeason(c, d);
}

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "15 nov – 26 dec" of "" als er geen (geldig) seizoen is. */
export function formatSeason(c: Pick<Collection, "season_start" | "season_end">): string {
  if (!isValidMmDd(c.season_start) || !isValidMmDd(c.season_end)) return "";
  const f = (v: string) => `${Number(v.slice(3))} ${MONTHS[Number(v.slice(0, 2)) - 1]}`;
  return `${f(c.season_start as string)} – ${f(c.season_end as string)}`;
}

/**
 * Onzichtbare markering in de beschrijving van de WooCommerce-categorie, zodat de shop (homepage) weet wanneer de
 * collectie uitgelicht moet worden, ook als er een tijd niet gesynct wordt. Bv. <!-- tdp-collection highlight=season season=11-15..12-26 -->
 */
export function collectionMarker(
  c: Pick<Collection, "highlight" | "season_start" | "season_end" | "sort_order"> & Partial<Pick<Collection, "background" | "background_url" | "background_color">>
): string {
  const season = isValidMmDd(c.season_start) && isValidMmDd(c.season_end) ? ` season=${c.season_start}..${c.season_end}` : "";
  let bg = "";
  const theme = c.background && /^[a-z]+$/.test(c.background) ? c.background : "none";
  if (theme === "custom") {
    // Spaties en "--" mogen niet in een HTML-commentaar: URL coderen.
    const url = c.background_url ? encodeURI(c.background_url.trim()).replace(/--/g, "-%2D") : "";
    bg = url ? ` bg=custom bgimg=${url}` : "";
  } else if (theme !== "none") {
    bg = ` bg=${theme}`;
  }
  if (bg && c.background_color && /^#[0-9a-fA-F]{6}$/.test(c.background_color)) bg += ` bgcolor=${c.background_color}`;
  return `<!-- tdp-collection highlight=${c.highlight}${season} order=${c.sort_order}${bg} -->`;
}
