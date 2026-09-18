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
    .select("id, sku, name, published, attribute_names, product_variations(sku, attribute_values, sale_price)")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Bepaal het maximum aantal attributen over alle producten heen, zodat er
  // genoeg "Attribute N ..." kolomgroepen in de header staan voor elk product.
  const maxAttrs = Math.max(1, ...(products ?? []).map((p) => (p.attribute_names?.length ?? 0)));

  const headers = ["Type", "SKU", "Name", "Published", "Regular price"];
  for (let i = 1; i <= maxAttrs; i++) {
    headers.push(`Attribute ${i} name`, `Attribute ${i} value(s)`, `Attribute ${i} visible`, `Attribute ${i} global`);
  }
  headers.push("Parent");

  const rows: string[][] = [headers];

  for (const p of products ?? []) {
    const attrNames: string[] = p.attribute_names ?? [];
    const variations = (p as any).product_variations as {
      sku: string;
      attribute_values: Record<string, string>;
      sale_price: number | null;
    }[];

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
    rows.push(["variable", p.sku, p.name, p.published ? "1" : "0", "", ...parentAttrCols, ""]);

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
        v.sale_price != null ? v.sale_price.toFixed(2) : "",
        ...attrCols,
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
