import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

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

// ---------- zip zonder compressie ("store") ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
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
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = fs.readFileSync(f.full);
    const name = Buffer.from(f.rel, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);   // UTF-8 namen
    local.writeUInt16LE(0, 8); local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10); cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cdir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdir, end]);
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
