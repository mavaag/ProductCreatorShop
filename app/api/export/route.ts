import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Deze route draait server-side en gebruikt dezelfde public/anon Supabase-config.
// Enkel de WooCommerce-relevante velden verlaten deze functie -- cost_inputs en
// cost_price van de varianten worden bewust NOOIT in de CSV opgenomen.
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  );

  const { data: products, error } = await supabase
    .from("products")
    .select("id, sku, name, published, attribute_name, product_variations(sku, attribute_value, sale_price)")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const headers = [
    "Type", "SKU", "Name", "Published", "Regular price",
    "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global",
    "Parent",
  ];
  const rows: string[][] = [headers];

  for (const p of products ?? []) {
    const variations = (p as any).product_variations as { sku: string; attribute_value: string; sale_price: number | null }[];
    const allValues = variations.map((v) => v.attribute_value).filter(Boolean).join(" | ");

    rows.push([
      "variable",
      p.sku,
      p.name,
      p.published ? "1" : "0",
      "",
      p.attribute_name,
      allValues,
      "1",
      "0",
      "",
    ]);

    for (const v of variations) {
      rows.push([
        "variation",
        v.sku,
        `${p.name} - ${v.attribute_value}`,
        p.published ? "1" : "0",
        v.sale_price != null ? v.sale_price.toFixed(2) : "",
        p.attribute_name,
        v.attribute_value,
        "1",
        "0",
        p.sku,
      ]);
    }
  }

  const csv = rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="woocommerce-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function escapeCsvField(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
