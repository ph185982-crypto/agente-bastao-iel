"use client";
import { useActionState } from "react";
import { changeMyPassword } from "@/app/mapa/actions";

export function PasswordForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(changeMyPassword, null);
  return (
    <form action={action} className="card stack">
      <h3>Trocar senha</h3>
      <div className="field"><label htmlFor="cp">Senha atual</label><input id="cp" name="current_password" type="password" autoComplete="current-password" required disabled={disabled} /></div>
      <div className="field"><label htmlFor="np">Nova senha (mínimo 10 caracteres)</label><input id="np" name="new_password" type="password" autoComplete="new-password" minLength={10} required disabled={disabled} /></div>
      <div className="field"><label htmlFor="cf">Repita a nova senha</label><input id="cf" name="confirm_password" type="password" autoComplete="new-password" minLength={10} required disabled={disabled} /></div>
      {state?.erro && <div className="notice danger small" role="alert">{state.erro}</div>}
      {state?.ok && <div className="notice ok small" role="status">{state.ok}</div>}
      {disabled && <div className="small muted">Indisponível na visualização da equipe.</div>}
      <button className="btn btn-orange" disabled={pending || disabled}>{pending ? "Salvando…" : "Salvar nova senha"}</button>
    </form>
  );
}
