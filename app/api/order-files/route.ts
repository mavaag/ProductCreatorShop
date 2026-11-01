import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { zipEntries } from "@/lib/zipStore";

// POST /api/order-files { name, files: [{ url, name }] } -> zip met de bestanden van de klant bij een bestelregel
// (opgeladen logo/afbeelding en preview van de gravure-plugin). Enkel bestanden uit de uploadmap van de
// gravure-plugin in de eigen shop, zodat deze route geen willekeurige URL's ophaalt.
// Vereist een ingelogde sessie (Supabase-token in de Authorization-header).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 20;
const MAX_BYTES = 200 * 1024 ** 2;

function allowedPrefix(): string | null {
  const base = process.env.WOOCOMMERCE_URL?.replace(/\/+$/, "");
  return base ? `${base}/wp-content/uploads/tdp-gravure/` : null;
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

  const prefix = allowedPrefix();
  if (!prefix) return NextResponse.json({ error: "WOOCOMMERCE_URL is niet ingesteld." }, { status: 501 });

  const body = await request.json().catch(() => ({}));
  const files: { url: string; name: string }[] = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0 || files.length > MAX_FILES) return NextResponse.json({ error: "Geen (of te veel) bestanden." }, { status: 400 });

  const entries: { name: string; data: Buffer }[] = [];
  const used = new Set<string>();
  let total = 0;
  for (const f of files) {
    const url = String(f.url ?? "");
    // exact de eigen uploadmap, zonder ".." in het pad
    if (!url.startsWith(prefix) || url.includes("..")) {
      return NextResponse.json({ error: `Bestand buiten de uploadmap van de gravure-plugin: ${url}` }, { status: 400 });
    }
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `Ophalen mislukt (${res.status}): ${url}` }, { status: 502 });
    const data = Buffer.from(await res.arrayBuffer());
    total += data.length;
    if (total > MAX_BYTES) return NextResponse.json({ error: "Bestanden te groot om samen te downloaden." }, { status: 413 });
    const wanted = String(f.name || url.split("/").pop() || "bestand").replace(/[\\/:*?"<>|]+/g, "_");
    const dot = wanted.lastIndexOf(".");
    const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
    const ext = dot > 0 ? wanted.slice(dot) : "";
    let name = wanted;
    for (let i = 2; used.has(name); i++) name = `${stem}-${i}${ext}`;
    used.add(name);
    entries.push({ name, data });
  }

  const zipName = String(body.name || "klantbestanden").replace(/[^\w.-]+/g, "_");
  return new NextResponse(new Uint8Array(zipEntries(entries)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}.zip"`,
    },
  });
}
