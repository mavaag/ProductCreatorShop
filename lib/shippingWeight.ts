// Standaard verzendgewicht (kg, inclusief verpakking) per soort product. De verzending in de shop (Flexible Shipping)
// rekent op het gewicht van het mandje: tot 0,25 kg brievenbus (€ 3,95), tot 10 kg pakje (€ 6,99), daarboven groot.
// Een product zonder gewicht zou als 0 kg tellen en dus altijd aan het brievenbustarief verstuurd worden; daarom krijgt
// een nieuw product (uit de Catalogus) dit gewicht, en valt de sync erop terug als het veld leeg is.

/** Sleutelhangers die te dik zijn voor de brievenbus: pakje-gewicht. */
const THICK_KEYCHAINS = ["mini-tank", "dragon egg", "pill box", "shotgun shell"];

export function defaultWeightKg(categories: string | string[] | null | undefined, name: string | null | undefined): number {
  const c = (Array.isArray(categories) ? categories.join(" | ") : categories ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (c.includes("keychain")) return THICK_KEYCHAINS.some((t) => n.includes(t)) ? 0.3 : 0.03;
  if (n.includes("onderlegger") || n.includes("coaster")) return 0.2;
  if (c.includes("t-shirt")) return 0.2;
  if (c.includes("moks") || n.includes("mug")) return 0.45;
  if (c.includes("wall decor") || c.includes("clocks")) return 0.7;
  if (c.includes("lamps")) return 0.8;
  if (c.includes("laser cutting > decoration") || c.includes("vehicules")) return 0.6;
  if (c.includes("vases") || c.includes("desk organizers")) return 0.4;
  if (c.includes("3d printing > decoration")) return 0.35;
  return 0.3; // al de rest (dieren, figuren, console-accessoires, ...): pakje
}
