import { NextResponse } from "next/server";
import { shopProxy } from "@/lib/shopProxy";

// Campagnes (plugin "3DP Klanten" 1.5.0): reclamemails aan klanten met toestemming.
// GET  /api/campaigns/list            -> campagnes, aantallen ontvangers, categorieën, acties, instellingen
// POST /api/campaigns/action          -> { action: save|test|schedule|send_now|cancel|delete|duplicate|count|settings, campaign?, id?, to? }
// POST /api/campaigns/preview         -> { campaign } -> { subject, html } (voorbeeld met "Voornaam")
// GET  /api/campaigns/products?q=..   -> producten zoeken (of ?ids=1,2,3)
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { action: string } }) {
  if (params.action === "list") return shopProxy(request, "tdp-campaigns", "GET");
  if (params.action === "products") {
    const u = new URL(request.url);
    const qs = new URLSearchParams();
    if (u.searchParams.get("q")) qs.set("q", u.searchParams.get("q") as string);
    if (u.searchParams.get("ids")) qs.set("ids", u.searchParams.get("ids") as string);
    return shopProxy(request, `tdp-campaign-products?${qs.toString()}`, "GET");
  }
  return NextResponse.json({ error: "Onbekend." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: { action: string } }) {
  const path = params.action === "action" ? "tdp-campaigns" : params.action === "preview" ? "tdp-campaign-preview" : null;
  if (!path) return NextResponse.json({ error: "Onbekend." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  return shopProxy(request, path, "POST", body);
}
