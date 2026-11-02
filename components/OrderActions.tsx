"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { authHeader } from "@/lib/productionFiles";

// Knoppen om de status van een bestelling in WooCommerce te wijzigen (API /api/orders/[id]). Elke actie vraagt
// eerst een bevestiging in de knoppenbalk zelf (geen pop-up).

type Action = "completed" | "processing" | "on-hold" | "cancelled" | "trash";

const LABELS: Record<Action, string> = {
  completed: "Verzonden / voltooid",
  processing: "Terug in verwerking",
  "on-hold": "In de wacht",
  cancelled: "Annuleren",
  trash: "Verwijderen (test)",
};

const CONFIRM: Record<Action, string> = {
  completed: "De klant krijgt de mail dat de bestelling verzonden is.",
  processing: "De bestelling komt terug in de productielijst.",
  "on-hold": "De bestelling blijft open, met status 'in de wacht'. De klant krijgt daar een mail over.",
  cancelled: "De bestelling wordt geannuleerd en materialen/voorraad komen terug. Er wordt GEEN geld teruggestort: doe dat zelf in WooCommerce (Terugbetalen).",
  trash: "De bestelling gaat naar de prullenbak in WooCommerce en telt niet meer mee in je cijfers. Enkel voor testbestellingen.",
};

/** Welke knoppen zinvol zijn bij een status. */
function actionsFor(status: string): Action[] {
  switch (status) {
    case "processing": return ["completed", "on-hold", "cancelled", "trash"];
    case "on-hold": return ["completed", "processing", "cancelled", "trash"];
    case "pending": return ["processing", "cancelled", "trash"];
    case "completed": return ["processing", "trash"];
    case "cancelled": case "failed": case "refunded": return ["trash"];
    default: return [];
  }
}

export default function OrderActions({ wcOrderId, status, onChanged }: { wcOrderId: number; status: string; onChanged: (status: string) => void }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actions = actionsFor(status);
  if (actions.length === 0) return null;

  async function run(action: Action) {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/orders/${wcOrderId}`, {
        method: "POST",
        headers: { ...(await authHeader(supabase)), "Content-Type": "application/json" },
        body: JSON.stringify({ action, tracking: action === "completed" ? tracking : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setPending(null); setTracking("");
      onChanged(body.status);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="order-actions">
      {pending ? (
        <div className="order-confirm">
          <span><b>{LABELS[pending]}?</b> {CONFIRM[pending]}</span>
          {pending === "completed" && (
            <input className="mono" placeholder="bpost-volgnummer (optioneel)" value={tracking} onChange={(e) => setTracking(e.target.value)} style={{ maxWidth: 260 }} />
          )}
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className={`btn${pending === "cancelled" || pending === "trash" ? " danger" : ""}`} disabled={busy} onClick={() => run(pending)}>{busy ? "Bezig..." : "Ja, doen"}</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => { setPending(null); setError(""); }}>Nee</button>
          </span>
        </div>
      ) : (
        actions.map((a) => (
          <button key={a} type="button" className={`btn ${a === "completed" ? "" : "secondary"}`} onClick={() => setPending(a)}>{LABELS[a]}</button>
        ))
      )}
      {error && <span className="warning" style={{ margin: 0 }}>{error}</span>}
    </div>
  );
}
