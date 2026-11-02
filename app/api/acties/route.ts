import { NextResponse } from "next/server";
import { HttpError, requireUser, wooRequest } from "@/lib/wooServer";

// Acties in de shop (plugin "3DP Acties"): GET = lijst + categorieën, POST { acties: [...] } = hele lijst bewaren.
// De plugin bewaart ze in WordPress en rekent ze toe in het mandje; de beheertool is enkel het invulscherm.
export const dynamic = "force-dynamic";

async function handle(request: Request, method: "GET" | "POST") {
  try {
    await requireUser(request);
    const body = method === "POST" ? await request.json().catch(() => ({})) : undefined;
    return NextResponse.json(await wooRequest("tdp-acties", method, body));
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = status === 404 ? "De plugin 3DP Acties is niet geïnstalleerd in de shop." : e.message;
    return NextResponse.json({ error: msg }, { status });
  }
}

export const GET = (request: Request) => handle(request, "GET");
export const POST = (request: Request) => handle(request, "POST");
