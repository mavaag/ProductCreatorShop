"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function logIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/products");
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: "60px auto" }}>
      <h1>Inloggen</h1>
      <p className="sub">
        Nog geen account? Maak er eerst één aan in Supabase: Dashboard &gt; Authentication &gt; Users &gt;
        Add user (met "Auto Confirm User" aangevinkt) -- zo wordt er geen e-mail verstuurd.
      </p>
      <form onSubmit={logIn}>
        <label>E-mailadres</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jij@voorbeeld.be" />
        <label>Wachtwoord</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn" type="submit" style={{ marginTop: 16 }}>Inloggen</button>
        {error && <p className="warning">{error}</p>}
      </form>
    </div>
  );
}
