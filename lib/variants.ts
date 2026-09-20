/** Splitst "S, M, L" (of met puntkomma/nieuwe regel) op in unieke, niet-lege waarden. */
export function parseValueList(input: string): string[] {
  return Array.from(new Set(input.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)));
}

/**
 * Alle combinaties van waarden per attribuut, bv. Grootte [S,M] × Kleur [Rood,Blauw] geeft
 * 4 combinaties. Attributen zonder waarden worden overgeslagen.
 */
export function cartesian(attributeNames: string[], valuesPerAttribute: Record<string, string[]>): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const name of attributeNames) {
    const values = valuesPerAttribute[name] ?? [];
    if (values.length === 0) continue;
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [name]: value })));
  }
  return combos.length === 1 && Object.keys(combos[0]).length === 0 ? [] : combos;
}

/** Sleutel om twee attribuutcombinaties te vergelijken (hoofdletterongevoelig). */
export function comboKey(attributeNames: string[], values: Record<string, string>): string {
  return attributeNames.map((n) => (values[n] ?? "").trim().toLowerCase()).join("|");
}
