import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { zipEntries } from "@/lib/zipStore";

// Productiebestanden op de NAS (MakerProducts, alleen-lezen gemount in de container op MAKER_ROOT, standaard /maker).
//   GET /api/files?path=<rel>                  -> inhoud van een map: { dirs: [...], files: [{ name, size }] }
//   GET /api/files?path=<rel>&download=1       -> één bestand downloaden
//   GET /api/files?path=<rel>&download=zip     -> een map (met submappen) als zip (zonder compressie)
// <rel> is relatief t.o.v. MakerProducts (bv. "_Shop/3DPrinting/Figurines/Kirby"); alles daarbuiten wordt geweigerd.
// Vereist een ingelogde sessie (Supabase-token in de Authorization-header).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROOT = path.resolve(process.env.MAKER_ROOT || "/maker");
const ZIP_MAX_BYTES = 2 * 1024 ** 3;   // 2 GB per zip
const HIDDEN = /^(\.|@eaDir$|#Recycle$|desktop\.ini$|thumbs\.db$)/i;

function resolveSafe(rel: string): string | null {
  const full = path.resolve(ROOT, rel.replace(/^[/\\]+/, ""));
  return full === ROOT || full.startsWith(ROOT + path.sep) ? full : null;
}

function listFiles(dir: string, base = ""): { rel: string; full: string }[] {
  const out: { rel: string; full: string }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.test(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(full, rel));
    else if (e.isFile()) out.push({ rel, full });
  }
  return out;
}

function zipStore(files: { rel: string; full: string }[]): Buffer {
  return zipEntries(files.map((f) => ({ name: f.rel, data: fs.readFileSync(f.full) })));
}

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

  if (!fs.existsSync(ROOT)) {
    return NextResponse.json({ error: `De bibliotheek is niet gekoppeld aan de beheertool (${ROOT} ontbreekt in de container).` }, { status: 501 });
  }
  const params = new URL(request.url).searchParams;
  const full = resolveSafe(params.get("path") ?? "");
  if (!full) return NextResponse.json({ error: "Ongeldig pad." }, { status: 400 });
  if (!fs.existsSync(full)) return NextResponse.json({ error: "Niet gevonden." }, { status: 404 });
  const stat = fs.statSync(full);
  const download = params.get("download");

  if (download === "zip" && stat.isDirectory()) {
    const files = listFiles(full);
    const total = files.reduce((n, f) => n + fs.statSync(f.full).size, 0);
    if (total > ZIP_MAX_BYTES) return NextResponse.json({ error: "Map te groot om als zip te downloaden; download de bestanden apart." }, { status: 413 });
    const zip = zipStore(files);
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}.zip`,
      },
    });
  }
  if (download && stat.isFile()) {
    return new NextResponse(new Uint8Array(fs.readFileSync(full)), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`,
        "Content-Length": String(stat.size),
      },
    });
  }
  if (!stat.isDirectory()) return NextResponse.json({ error: "Geen map." }, { status: 400 });
  const entries = fs.readdirSync(full, { withFileTypes: true }).filter((e) => !HIDDEN.test(e.name));
  return NextResponse.json({
    dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(),
    files: entries.filter((e) => e.isFile()).map((e) => ({ name: e.name, size: fs.statSync(path.join(full, e.name)).size }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
