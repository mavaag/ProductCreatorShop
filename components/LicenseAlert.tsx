"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { License, licenseState } from "@/lib/licenses";

/** Balk bovenaan elke pagina zolang een licentie binnen 30 dagen vervalt of al vervallen is. */
export function LicenseAlert() {
  const path = usePathname();
  const [due, setDue] = useState<{ id: string; artist: string; label: string; expired: boolean }[]>([]);

  useEffect(() => {
    if (path === "/login") return;
    let stale = false;
    supabase.from("licenses").select("id, artist, valid_until").then(({ data, error }) => {
      if (stale || error || !data) return;   // geen sessie of migratie 041 nog niet uitgevoerd: niets tonen
      setDue((data as Pick<License, "id" | "artist" | "valid_until">[])
        .map((l) => ({ l, s: licenseState(l) }))
        .filter(({ s }) => s.kind === "soon" || s.kind === "expired")
        .map(({ l, s }) => ({ id: l.id, artist: l.artist, label: s.label.toLowerCase(), expired: s.kind === "expired" })));
    });
    return () => { stale = true; };
  }, [path]);

  if (due.length === 0 || path === "/login") return null;
  const expired = due.some((d) => d.expired);
  return (
    <div className="warning" role="status" style={{ margin: "0 auto", borderLeft: `3px solid ${expired ? "var(--rust)" : "var(--yellow)"}` }}>
      Licentie{due.length === 1 ? "" : "s"}:{" "}
      {due.map((d, i) => (
        <span key={d.id}>{i > 0 && " · "}<Link href="/licenses"><b>{d.artist}</b></Link> {d.label}</span>
      ))}
      {" "}— vernieuwen en daarna op <Link href="/licenses">Licenties</Link> op "Verlengd" klikken.
    </div>
  );
}
