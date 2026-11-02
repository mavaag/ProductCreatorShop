import { NextResponse } from "next/server";
import { shopProxy } from "@/lib/shopProxy";

// /api/customers/settings  GET/POST -> instellingen automatische codes (verjaardag, 10e bestelling) en standaard voor met de hand
// /api/customers/send      POST { emails, config, remember } -> persoonlijke code maken en mailen (enkel klanten met toestemming)
// /api/customers/test      POST { to, kind, config } -> voorbeeldmail (code VOORBEELD-CODE, geen echte code)
export const dynamic = "force-dynamic";

const ROUTES: Record<string, string> = { settings: "tdp-promo-settings", send: "tdp-send-code", test: "tdp-test-mail" };

export async function GET(request: Request, { params }: { params: { action: string } }) {
  if (params.action !== "settings") return NextResponse.json({ error: "Onbekend." }, { status: 404 });
  return shopProxy(request, ROUTES.settings, "GET");
}

export async function POST(request: Request, { params }: { params: { action: string } }) {
  const path = ROUTES[params.action];
  if (!path) return NextResponse.json({ error: "Onbekend." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  return shopProxy(request, path, "POST", body);
}
