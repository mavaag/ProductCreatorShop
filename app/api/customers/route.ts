import { shopProxy } from "@/lib/shopProxy";

// GET /api/customers -> klantenoverzicht uit de shop (plugin "3DP Klanten": wc/v3/tdp-customers):
// per e-mailadres bestellingen, besteed bedrag, toestemming, verjaardag, afmeldlink en verstuurde kortingscodes.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return shopProxy(request, "tdp-customers", "GET");
}
