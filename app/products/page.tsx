"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { Product, ProductVariation, PROCESS_TYPE_LABELS } from "@/lib/types";

type ProductWithVariations = Product & { product_variations: ProductVariation[] };

export default function ProductsPage() {
  const ready = useAuthGuard();
  const [products, setProducts] = useState<ProductWithVariations[]>([]);

  async function load() {
    const { data } = await supabase
      .from("products")
      .select("*, product_variations(*)")
      .order("name");
    setProducts((data as ProductWithVariations[]) ?? []);
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function deleteProduct(id: string) {
    if (!confirm("Dit product (en al zijn varianten) verwijderen?")) return;
    await supabase.from("products").delete().eq("id", id);
    load();
  }

  if (!ready) return null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>Producten</h1>
          <p className="sub">Prijsberekening blijft hier bewaard per product -- de export naar WooCommerce bevat enkel de velden die WooCommerce nodig heeft.</p>
        </div>
        <div>
          <a className="btn secondary" href="/api/export" style={{ marginRight: 8 }}>Exporteer WooCommerce CSV</a>
          <Link className="btn" href="/products/new">+ Nieuw product</Link>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Naam</th><th>Techniek</th><th>SKU</th><th>Attributen</th><th>Varianten</th><th>Prijsrange</th><th>Gepubliceerd</th><th></th></tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const prices = p.product_variations.map((v) => v.sale_price).filter((x): x is number => x != null);
            const priceLabel = prices.length
              ? prices.length > 1 && Math.min(...prices) !== Math.max(...prices)
                ? `€${Math.min(...prices).toFixed(2)} - €${Math.max(...prices).toFixed(2)}`
                : `€${prices[0].toFixed(2)}`
              : "-- nog niet berekend --";
            return (
              <tr key={p.id}>
                <td><Link href={`/products/${p.id}`}>{p.name}</Link></td>
                <td><span className="pill">{PROCESS_TYPE_LABELS[p.process_type]}</span></td>
                <td>{p.sku}</td>
                <td>{p.attribute_names.join(", ")}</td>
                <td>{p.product_variations.length}</td>
                <td>{priceLabel}</td>
                <td>{p.published ? "Ja" : "Nee"}</td>
                <td>
                  <Link className="btn secondary" href={`/products/${p.id}`} style={{ marginRight: 6 }}>Bewerken</Link>
                  <button className="btn danger" onClick={() => deleteProduct(p.id)}>Verwijder</button>
                </td>
              </tr>
            );
          })}
          {products.length === 0 && (
            <tr><td colSpan={8} className="muted">Nog geen producten -- klik op "+ Nieuw product" om te starten.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
