"use client";
import { useActionState } from "react";
import { login } from "@/app/actions";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <div className="login-wrap">
      <ThemeToggle className="theme-float" />
      <div className="login-box">
        <Logo sub size={36} />
        <p className="muted" style={{ marginTop: 16 }}>
          Um acesso para todas as ferramentas, com <span className="accent">precisão</span>.
        </p>
        <form action={action} className="card stack">
          <input type="hidden" name="next" value={next} />
          <div className="field"><label htmlFor="e">E-mail</label><input id="e" name="email" type="email" autoComplete="email" defaultValue={state?.email ?? ""} key={state?.email ?? "vazio"} required /></div>
          <div className="field"><label htmlFor="p">Senha</label><input id="p" name="password" type="password" autoComplete="current-password" required /></div>
          {state?.error && <div className="notice danger small">{state.error}</div>}
          <button className="btn btn-orange" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}
