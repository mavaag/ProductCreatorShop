"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";

/**
 * Landingspagina van de bladwijzer "Modellen ophalen" op MakerWorld (?handle=...&uid=...): zoekt de licentie van die
 * artiest en opent ze met het plakvak open. Bestaat er nog geen licentie, dan zeg je dat eerst.
 */
export default function LicenseImportPage() {
  const ready = useAuthGuard();
  const router = useRouter();
  const [msg, setMsg] = useState("Licentie zoeken...");
  const [handle, setHandle] = useState("");

  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search);
    const h = (q.get("handle") ?? "").toLowerCase();
    const uid = q.get("uid") ?? "";
    setHandle(h);
    (async () => {
      const { data, error } = await supabase.from("licenses").select("id, handle, platform_user_id, profile_url");
      if (error) { setMsg(error.message); return; }
      const hit = (data ?? []).find((l) => (uid && l.platform_user_id === uid) || (h && (l.handle ?? "").toLowerCase() === h)
        || (h && (l.profile_url ?? "").toLowerCase().includes("@" + h)));
      if (hit) router.replace(`/licenses/${hit.id}?paste=1`);
      else setMsg("");
    })();
  }, [ready, router]);

  if (!ready) return null;
  return (
    <div>
      <h1>Modellen importeren</h1>
      {msg ? <p className="muted">{msg}</p> : (
        <p>
          Er is nog geen licentie voor <b>@{handle || "deze artiest"}</b>. Voeg ze eerst toe bij <Link href="/licenses">Licenties</Link> (met de
          link naar het profiel op MakerWorld) en klik daarna opnieuw op de bladwijzer. De lijst staat nog op je klembord.
        </p>
      )}
    </div>
  );
}
