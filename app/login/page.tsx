"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin + "/products" : undefined },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: "60px auto" }}>
      <h1>Inloggen</h1>
      <p className="sub">Je krijgt een inloglink per e-mail (geen wachtwoord nodig).</p>
      {sent ? (
        <p>Check je mailbox -- klik op de link om in te loggen.</p>
      ) : (
        <form onSubmit={sendLink}>
          <label>E-mailadres</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jij@voorbeeld.be" />
          <button className="btn" type="submit" style={{ marginTop: 16 }}>Stuur inloglink</button>
          {error && <p className="warning">{error}</p>}
        </form>
      )}
    </div>
  );
}
