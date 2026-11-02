import { NextResponse } from "next/server";
import { HttpError, requireUser, wooRequest } from "@/lib/wooServer";

// Status van een WooCommerce-bestelling wijzigen vanuit de beheertool (Bestellingen > Productie / Alle bestellingen).
// Body: { action: "completed" | "processing" | "on-hold" | "cancelled" | "trash", tracking?: string }
// - completed: WooCommerce stuurt de klant de mail "bestelling afgerond"; een bpost-volgnummer komt als meta
//   _tdp_tracking op de bestelling en de plugin 3DP Klanten (1.3.0) zet de volglink in die mail en in Mijn account.
// - cancelled: geen terugbetaling (dat gebeurt in WooCommerce); materialen/voorraad komen terug via orders_sync.py.
// - trash: bestelling naar de prullenbak in WooCommerce; lokaal status "trash" (telt niet meer mee, verbruik terug).
// De lokale kopie (wc_orders) wordt meteen bijgewerkt zodat de beheertool het direct toont.

const ACTIONS = ["completed", "processing", "on-hold", "cancelled", "trash"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = await requireUser(request);
    const wcId = parseInt(params.id, 10);
    if (!Number.isFinite(wcId) || wcId <= 0) throw new HttpError(400, "Ongeldig bestelnummer.");
    const body = await request.json().catch(() => ({}));
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) throw new HttpError(400, "Onbekende actie.");
    const tracking = typeof body.tracking === "string" ? body.tracking.replace(/\s+/g, "").toUpperCase().slice(0, 40) : "";
    if (tracking && !/^[A-Z0-9]+$/.test(tracking)) throw new HttpError(400, "Het volgnummer mag enkel letters en cijfers bevatten.");

    let status: string;
    if (action === "trash") {
      await wooRequest(`orders/${wcId}`, "DELETE");
      status = "trash";
    } else {
      const update: any = { status: action };
      if (action === "completed" && tracking) update.meta_data = [{ key: "_tdp_tracking", value: tracking }];
      const o = await wooRequest(`orders/${wcId}`, "PUT", update);
      status = o.status;
    }
    const { error } = await supabase.from("wc_orders").update({ status }).eq("wc_order_id", wcId);
    if (error) throw new HttpError(500, `In de shop gelukt, maar de lokale kopie niet bijgewerkt: ${error.message}`);
    return NextResponse.json({ status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e instanceof HttpError ? e.status : 500 });
  }
}
