import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Doorgeefluik naar de eigen REST-routes van de plugin "3DP Klanten" (wc/v3/tdp-...). De WooCommerce-sleutels
// blijven op de server; de aanvrager moet ingelogd zijn (Supabase-token in de Authorization-header).
export async function shopProxy(request: Request, path: string, method: "GET" | "POST", body?: unknown): Promise<NextResponse> {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!base || !key || !secret) return NextResponse.json({ error: "WooCommerce is niet gekoppeld." }, { status: 501 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

  const res = await fetch(`${base}/wp-json/wc/v3/${path}`, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 404) return NextResponse.json({ error: "De plugin 3DP Klanten (1.2.0 of nieuwer) is niet geïnstalleerd in de shop." }, { status: 404 });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* geen JSON */ }
  if (!res.ok) return NextResponse.json({ error: data?.message ?? `Shop gaf ${res.status}: ${text.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : res.status });
  return NextResponse.json(data);
}
