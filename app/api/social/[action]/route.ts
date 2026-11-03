import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { shopProxy } from "@/lib/shopProxy";

// Social (plugin "3DP Klanten" 1.7.0): posts voor Facebook/Instagram.
// GET  /api/social/list        -> posts + koppeling (zonder sleutels)
// GET  /api/social/img?url=..  -> productfoto uit de eigen shop doorgeven (zelfde origine, nodig om op canvas te tekenen)
// POST /api/social/action      -> { action: upload|save|schedule|publish_now|cancel|delete|duplicate|connect|refresh_ig|disconnect, ... }
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { action: string } }) {
  if (params.action === "list") return shopProxy(request, "tdp-social", "GET");
  if (params.action === "img") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

    const shopHost = new URL(process.env.WOOCOMMERCE_URL ?? "https://3dprintforyou.be").hostname;
    let url: URL;
    try { url = new URL(new URL(request.url).searchParams.get("url") ?? ""); } catch { return NextResponse.json({ error: "Ongeldige URL." }, { status: 400 }); }
    // enkel afbeeldingen uit de eigen shop (geen open proxy)
    if (url.protocol !== "https:" || url.hostname !== shopHost || !url.pathname.startsWith("/wp-content/uploads/")) {
      return NextResponse.json({ error: "Enkel afbeeldingen uit de shop." }, { status: 400 });
    }
    const res = await fetch(url.toString(), { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return NextResponse.json({ error: `Afbeelding niet gevonden (${res.status}).` }, { status: 404 });
    return new NextResponse(await res.arrayBuffer(), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  }
  return NextResponse.json({ error: "Onbekend." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: { action: string } }) {
  if (params.action !== "action") return NextResponse.json({ error: "Onbekend." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  return shopProxy(request, "tdp-social", "POST", body);
}
