"use client";
import { useActionState } from "react";
import { login } from "@/app/actions";
import { Logo } from "@/components/Logo";

export default function Login() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <div className="login-wrap">
      <div className="login-box">
        <Logo sub size={36} />
        <p style={{ color: "var(--sand)", marginTop: 16 }}>
          Gestão de contas de marketplace com <span className="serif" style={{ color: "var(--orange)", fontSize: 18 }}>precisão</span>.
        </p>
        <form action={action} className="card stack">
          <div className="field"><label htmlFor="e">E-mail</label><input id="e" name="email" type="email" autoComplete="email" defaultValue={state?.email ?? ""} key={state?.email ?? "vazio"} required /></div>
          <div className="field"><label htmlFor="p">Senha</label><input id="p" name="password" type="password" autoComplete="current-password" required /></div>
          {state?.error && <div className="notice danger small">{state.error}</div>}
          <button className="btn btn-orange" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}
