import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { downloadImage, findSupplierImage, isPublicHttpUrl } from "@/lib/supplierImage";

// Foto van een materiaal ophalen van de leverancierslink (of van een rechtstreekse afbeeldingslink) en
// bewaren in de opslag (product-images/materials/...), zodat ze niet verdwijnt als de winkel haar link wijzigt.
//   POST /api/materials/image { url, materialId? } -> { image_url }
//   Met materialId wordt materials.image_url meteen bijgewerkt.
// Vereist een ingelogde sessie.

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Ongeldige sessie." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const materialId = typeof body.materialId === "string" ? body.materialId : null;
  if (!isPublicHttpUrl(url)) return NextResponse.json({ error: "Geen geldige link." }, { status: 400 });

  try {
    const found = await findSupplierImage(url);
    if (!found || !isPublicHttpUrl(found)) {
      return NextResponse.json({ error: "Geen productfoto gevonden op deze pagina -- laad zelf een foto op." }, { status: 404 });
    }
    const img = await downloadImage(found);
    const path = `materials/${crypto.randomUUID()}.${img.ext}`;
    const { error: upErr } = await supabase.storage.from("product-images").upload(path, img.data, { contentType: img.type, upsert: true });
    if (upErr) throw new Error(`opslaan mislukt: ${upErr.message}`);
    const imageUrl = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    if (materialId) {
      const { error } = await supabase.from("materials").update({ image_url: imageUrl }).eq("id", materialId);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ image_url: imageUrl });
  } catch (e: any) {
    return NextResponse.json({ error: `Foto ophalen mislukt: ${e?.message ?? e}` }, { status: 502 });
  }
}
