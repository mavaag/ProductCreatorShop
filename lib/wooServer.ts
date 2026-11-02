import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Gedeelde server-helpers voor API-routes die iets in WooCommerce doen. De sleutels blijven op de server.

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Controleert de Supabase-sessie uit de Authorization-header en geeft een client terug die als die gebruiker werkt. */
export async function requireUser(request: Request): Promise<SupabaseClient> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Niet ingelogd.");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Ongeldige sessie.");
  return supabase;
}

/** Roept de WooCommerce REST API aan (`wc/v3/<path>`) en geeft de JSON terug; gooit HttpError bij een fout. */
export async function wooRequest(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown): Promise<any> {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!base || !key || !secret) throw new HttpError(501, "WooCommerce is niet gekoppeld.");
  const res = await fetch(`${base}/wp-json/wc/v3/${path}`, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* geen JSON */ }
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : res.status, data?.message ?? `Shop gaf ${res.status}: ${text.slice(0, 200)}`);
  return data;
}
