import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET /api/customers -> klantenoverzicht uit de shop (plugin "3DP Klanten": wc/v3/tdp-customers):
// per e-mailadres bestellingen, besteed bedrag, toestemming voor reclame-mails, verjaardag, afmeldlink.
// Vereist een ingelogde sessie (Supabase-token in de Authorization-header); de Woo-sleutels blijven op de server.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!base || !key || !secret) return NextResponse.json({ error: "WooCommerce is niet gekoppeld." }, { status: 501 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

  const res = await fetch(`${base}/wp-json/wc/v3/tdp-customers`, {
    headers: { Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64") },
    cache: "no-store",
  });
  if (res.status === 404) return NextResponse.json({ error: "De plugin 3DP Klanten is nog niet geïnstalleerd in de shop." }, { status: 404 });
  if (!res.ok) return NextResponse.json({ error: `Shop gaf ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
  return NextResponse.json(await res.json());
}
