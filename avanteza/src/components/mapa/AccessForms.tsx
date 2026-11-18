"use client";
import { useActionState } from "react";
import { criarAcesso, redefinirAcesso, enviarBoasVindasAcesso, type AccessState } from "@/app/(painel)/clientes/mapa-actions";
import { CopyButton } from "../CopyButton";

function Secret({ state }: { state: AccessState }) {
  if (!state) return null;
  if (state.erro) return <div className="notice danger small" role="alert">{state.erro}</div>;
  if (!state.password) return null;
  return (
    <div className="secret-box" role="status">
      <div className="small"><strong>Senha gerada para {state.email}</strong>. Ela aparece só desta vez: copie e envie ao cliente agora.</div>
      <div className="pw" style={{ margin: "8px 0" }}>{state.password}</div>
      <CopyButton text={state.password} label="Copiar senha" />
    </div>
  );
}

export function CreateAccess({ clientId, hasGroup, defaultEmail }: { clientId: string; hasGroup: boolean; defaultEmail: string }) {
  const [state, action, pending] = useActionState(criarAcesso, null);
  return (
    <form action={action} className="card stack">
      <h3>Criar acesso do cliente</h3>
      <input type="hidden" name="client_id" value={clientId} />
      <div className="field"><label htmlFor="ae">E-mail de login</label><input id="ae" name="email" type="email" defaultValue={defaultEmail} required /></div>
      <div className="field"><label htmlFor="an">Nome</label><input id="an" name="name" /></div>
      {hasGroup && <label className="check small"><input type="checkbox" name="include_group" defaultChecked /> Dar acesso também às outras empresas do mesmo grupo</label>}
      <button className="btn btn-orange" disabled={pending}>{pending ? "Criando…" : "Criar e gerar senha"}</button>
      <Secret state={state} />
    </form>
  );
}

export function ResetAccess({ clientId, email }: { clientId: string; email: string }) {
  const [state, action, pending] = useActionState(redefinirAcesso, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="email" value={email} />
      <button className="btn btn-sm btn-ghost" disabled={pending}>{pending ? "Gerando…" : "Redefinir senha"}</button>
      <Secret state={state} />
    </form>
  );
}

export function WelcomeEmail({ clientId, email }: { clientId: string; email: string }) {
  const [state, action, pending] = useActionState(enviarBoasVindasAcesso, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="email" value={email} />
      <button className="btn btn-sm btn-ghost" disabled={pending}>{pending ? "Enviando…" : "Enviar e-mail de boas-vindas"}</button>
      {state?.ok && <div className="notice small" role="status">{state.ok}</div>}
      {state?.erro && <div className="notice danger small" role="alert">{state.erro}</div>}
      <span className="small muted">Link, login e passo a passo. A senha não vai no e-mail.</span>
    </form>
  );
}
