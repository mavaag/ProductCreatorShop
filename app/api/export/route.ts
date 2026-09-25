import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Deze route draait server-side. De aanvrager stuurt zijn Supabase-sessietoken mee
// (Authorization: Bearer ...), zodat de Row Level Security van de database gewoon geldt.
// Enkel de WooCommerce-relevante velden verlaten deze functie -- cost_inputs, cost_price
// en sale_price (excl. btw) van de varianten worden bewust NOOIT in de CSV opgenomen.
// "Regular price" = suggested_price: de afgeronde ,95-verkoopprijs incl. btw.
//
// Parameters (allemaal optioneel):
//   type=3d_print|uv_print|laser_engraving|laser_cutting|sublimation  enkel die techniek
//   changed=1  enkel producten die nieuw/gewijzigd zijn sinds de vorige (gemarkeerde) export
//   mark=1     na het genereren de geëxporteerde producten/prijzen als "geëxporteerd" markeren
const PROCESS_TYPES = ["3d_print", "uv_print", "laser_engraving", "laser_cutting", "sublimation"];

type Variation = {
  id: string;
  sku: string;
  attribute_values: Record<string, string>;
  suggested_price: number | null;
  exported_price: number | null;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const changedOnly = params.get("changed") === "1";
  const mark = params.get("mark") === "1";

  if (type && !PROCESS_TYPES.includes(type)) {
    return NextResponse.json({ error: `Onbekende techniek: ${type}` }, { status: 400 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );

  let query = supabase
    .from("products")
    .select(
      "id, sku, name, published, attribute_names, description, categories, image_url, weight_kg, shipping_class, updated_at, last_exported_at, product_variations(id, sku, attribute_values, suggested_price, exported_price)"
    )
    .order("name");
  if (type) query = query.eq("process_type", type);
  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let products = (data ?? []) as any[];
  if (changedOnly) products = products.filter(isChanged);

  const csv = buildFullCsv(products);

  if (mark) await markExported(supabase, products);

  const suffix = [type, changedOnly ? "gewijzigd" : null].filter(Boolean).join("-");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="woocommerce-export${suffix ? "-" + suffix : ""}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Exported-Products": String(products.length),
    },
  });
}

/** Een product zonder attributen is een simpel product (WooCommerce type "simple"). */
function isSimple(p: any): boolean {
  return (p.attribute_names?.length ?? 0) === 0;
}

function isChanged(p: any): boolean {
  if (!p.last_exported_at || p.updated_at > p.last_exported_at) return true;
  return (p.product_variations as Variation[]).some(
    (v) => v.suggested_price != null && Number(v.suggested_price) !== Number(v.exported_price)
  );
}

function buildFullCsv(products: any[]): string {
  // Bepaal het maximum aantal attributen over alle producten heen, zodat er
  // genoeg "Attribute N ..." kolomgroepen in de header staan voor elk product.
  const maxAttrs = Math.max(1, ...products.map((p) => p.attribute_names?.length ?? 0));

  const headers = ["Type", "SKU", "Name", "Published", "Regular price", "Description", "Categories", "Images", "Weight (kg)", "Shipping class"];
  for (let i = 1; i <= maxAttrs; i++) {
    headers.push(`Attribute ${i} name`, `Attribute ${i} value(s)`, `Attribute ${i} visible`, `Attribute ${i} global`);
  }
  headers.push("Parent");

  const rows: string[][] = [headers];

  for (const p of products) {
    const attrNames: string[] = p.attribute_names ?? [];
    const variations = p.product_variations as Variation[];

    if (isSimple(p)) {
      // Simpel product: één rij, met de prijs van zijn (enige) prijsberekening.
      const price = variations[0]?.suggested_price;
      rows.push([
        "simple",
        p.sku,
        p.name,
        p.published ? "1" : "0",
        price != null ? Number(price).toFixed(2) : "",
        p.description ?? "",
        p.categories ?? "",
        p.image_url ?? "",
        p.weight_kg != null ? String(p.weight_kg) : "",
        p.shipping_class ?? "",
        ...Array.from({ length: maxAttrs * 4 }, () => ""),
        "",
      ]);
      continue;
    }

    const parentAttrCols: string[] = [];
    for (let i = 0; i < maxAttrs; i++) {
      const name = attrNames[i];
      if (!name) {
        parentAttrCols.push("", "", "", "");
        continue;
      }
      const allValues = Array.from(new Set(variations.map((v) => v.attribute_values?.[name]).filter(Boolean))).join(" | ");
      parentAttrCols.push(name, allValues, "1", "0");
    }
    rows.push([
      "variable",
      p.sku,
      p.name,
      p.published ? "1" : "0",
      "",
      p.description ?? "",
      p.categories ?? "",
      p.image_url ?? "",
      p.weight_kg != null ? String(p.weight_kg) : "",
      p.shipping_class ?? "",
      ...parentAttrCols,
      "",
    ]);

    for (const v of variations) {
      const variantName = attrNames.map((n) => v.attribute_values?.[n]).filter(Boolean).join(", ");
      const attrCols: string[] = [];
      for (let i = 0; i < maxAttrs; i++) {
        const name = attrNames[i];
        if (!name) {
          attrCols.push("", "", "", "");
          continue;
        }
        attrCols.push(name, v.attribute_values?.[name] ?? "", "1", "0");
      }
      rows.push([
        "variation",
        v.sku,
        `${p.name}${variantName ? " - " + variantName : ""}`,
        p.published ? "1" : "0",
        v.suggested_price != null ? Number(v.suggested_price).toFixed(2) : "",
        "",
        "",
        "",
        "",
        "",
        ...attrCols,
        p.sku,
      ]);
    }
  }

  return toCsv(rows);
}

async function markExported(supabase: SupabaseClient, products: any[]) {
  const now = new Date().toISOString();
  for (const p of products) {
    await supabase.from("products").update({ last_exported_at: now }).eq("id", p.id);
    await Promise.all(
      (p.product_variations as Variation[])
        .filter((v) => v.suggested_price != null)
        .map((v) => supabase.from("product_variations").update({ exported_price: v.suggested_price }).eq("id", v.id))
    );
  }
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

function escapeCsvField(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
