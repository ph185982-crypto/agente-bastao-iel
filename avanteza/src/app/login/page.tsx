"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserDb } from "@/lib/supabase/browser";
import { Logo } from "@/components/Logo";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await browserDb().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setErr("E-mail ou senha inválidos.");
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <Logo sub size={36} />
        <p style={{ color: "var(--sand)", marginTop: 16 }}>
          Gestão de contas de marketplace com <span className="serif" style={{ color: "var(--orange)", fontSize: 18 }}>precisão</span>.
        </p>
        <form onSubmit={submit} className="card stack">
          <div className="field"><label htmlFor="e">E-mail</label><input id="e" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="p">Senha</label><input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {err && <div className="notice danger small">{err}</div>}
          <button className="btn btn-orange" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}
