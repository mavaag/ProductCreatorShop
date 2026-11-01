"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { alertDialog } from "@/components/DialogHost";

/**
 * "Uitgelicht" = het sterretje in WooCommerce. Uitgelichte producten verschijnen op de homepage in
 * "Populair in de shop". WooCommerce is de enige bron (niets in Supabase), zodat een ster die in wp-admin
 * gezet wordt hier ook klopt en nooit door een sync overschreven wordt.
 */

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` };
}

/** Set van SKU's die in WooCommerce uitgelicht zijn. `null` = nog aan het laden of WooCommerce onbereikbaar. */
export function useFeaturedSkus(enabled = true) {
  const [skus, setSkus] = useState<Set<string> | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/woocommerce/featured", { headers: await authHeaders() });
      if (!res.ok) return;
      const body = await res.json();
      setSkus(new Set((body.products ?? []).map((p: { sku: string }) => p.sku).filter(Boolean)));
    } catch {
      // Stil falen: zonder WooCommerce tonen we gewoon geen sterren.
    }
  }, []);

  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  const setFeatured = useCallback((sku: string, featured: boolean) => {
    setSkus((prev) => {
      const next = new Set(prev ?? []);
      if (featured) next.add(sku); else next.delete(sku);
      return next;
    });
  }, []);

  return { skus, reload, setFeatured };
}

export default function FeaturedStar({
  sku,
  featured,
  onChange,
  size = 16,
}: {
  sku: string;
  featured: boolean | undefined; // undefined = onbekend (aan het laden)
  onChange: (sku: string, featured: boolean) => void;
  size?: number;
}) {
  const [busy, setBusy] = useState(false);
  if (featured === undefined) return null;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !featured;
    setBusy(true);
    onChange(sku, next); // optimistisch
    try {
      const res = await fetch("/api/woocommerce/featured", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ sku, featured: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Fout ${res.status}`);
      onChange(sku, !!body.featured);
    } catch (err: any) {
      onChange(sku, !next); // terugdraaien
      await alertDialog(`Uitlichten mislukt: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const label = featured ? "Uitgelicht op de homepage -- klik om weg te halen" : "Uitlichten op de homepage (Populair in de shop)";
  return (
    <button
      type="button"
      className={`featured-star${featured ? " on" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={featured}
      disabled={busy}
      onClick={toggle}
      style={{ width: size + 8, height: size + 8 }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
      </svg>
    </button>
  );
}
