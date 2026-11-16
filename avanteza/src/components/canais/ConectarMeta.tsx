"use client";
// Formulário “Conectar Meta” (só administradores). Os campos são controlados para o teste de conexão não limpar o token digitado.
// O token vive só neste estado do navegador de quem digita; depois de salvo, o servidor o guarda cifrado e nunca o devolve.
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { salvarCanalMeta, testarConexaoMeta, type EstadoTeste } from "@/app/(painel)/clientes/canais-actions";

export interface CanalForm {
  adAccountId: string; campaignIds: string; igUserId: string; pageId: string; resultActionType: string; usarTokenPlataforma: boolean; temToken: boolean; tokenHint: string | null;
}

function Botao({ children, className = "btn", formAction }: { children: React.ReactNode; className?: string; formAction?: (fd: FormData) => void }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} formAction={formAction}>{pending ? "Aguarde…" : children}</button>;
}

export function ConectarMeta({ clientId, inicial, plataformaDisponivel }: { clientId: string; inicial: CanalForm; plataformaDisponivel: boolean }) {
  const [v, setV] = useState({ ...inicial, token: "" });
  const [estado, testar] = useActionState<EstadoTeste, FormData>(testarConexaoMeta, null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const r = estado?.resultado;

  return (
    <form action={salvarCanalMeta} className="card stack" autoComplete="off" style={{ marginTop: 12 }}>
      <h3>Conectar Meta</h3>
      <p className="small muted" style={{ margin: 0 }}>Somente leitura: a Avanteza só consulta (GET) a conta de anúncios e o Instagram. Nada é alterado na Meta.</p>
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid two">
        <div className="field"><label htmlFor="cm-conta">Conta de anúncios</label><input id="cm-conta" name="ad_account_id" value={v.adAccountId} onChange={set("adAccountId")} placeholder="605261696580859" inputMode="numeric" /></div>
        <div className="field"><label htmlFor="cm-camp">Campanhas</label><input id="cm-camp" name="campaign_ids" value={v.campaignIds} onChange={set("campaignIds")} placeholder="em branco = todas; ou IDs separados por vírgula" /></div>
        <div className="field"><label htmlFor="cm-ig">ID do Instagram</label><input id="cm-ig" name="ig_user_id" value={v.igUserId} onChange={set("igUserId")} inputMode="numeric" /></div>
        <div className="field"><label htmlFor="cm-pg">ID da Página</label><input id="cm-pg" name="page_id" value={v.pageId} onChange={set("pageId")} inputMode="numeric" /></div>
      </div>
      <div className="field">
        <label htmlFor="cm-token">Token</label>
        <input id="cm-token" name="token" type="password" value={v.token} onChange={set("token")} autoComplete="new-password" spellCheck={false}
          placeholder={inicial.temToken ? `Token salvo (termina em ${inicial.tokenHint ?? "····"}). Deixe em branco para manter.` : "Cole aqui o token de acesso do cliente"} />
        <div className="small muted" style={{ marginTop: 4 }}>Guardado criptografado; nunca mais aparece na tela. Não tire print desta tela com o token.</div>
      </div>
      <details>
        <summary className="small">Opções avançadas</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="field"><label htmlFor="cm-res">Tipo de resultado (action_type)</label><input id="cm-res" name="result_action_type" value={v.resultActionType} onChange={set("resultActionType")} /><div className="small muted">Padrão: conversas iniciadas no WhatsApp em 7 dias.</div></div>
          <label className="check small"><input type="checkbox" name="use_platform_token" checked={v.usarTokenPlataforma} onChange={set("usarTokenPlataforma")} /> Se o cliente não tiver token, usar o token da plataforma (META_ACCESS_TOKEN){plataformaDisponivel ? "" : " — não está configurado neste ambiente"}</label>
        </div>
      </details>
      <div className="btn-row">
        <Botao className="btn btn-ghost" formAction={testar}>Testar conexão</Botao>
        <Botao className="btn btn-orange">Salvar</Botao>
      </div>

      {estado?.erro && <div className="notice danger" role="alert">{estado.erro}</div>}
      {r && (
        <div className={`notice ${r.ok ? "ok" : "danger"}`} role="status" aria-live="polite">
          <strong>{r.ok ? "Conexão funcionando" : "Há pendências na conexão"}</strong>
          <div className="small muted">Token usado: {r.origemToken === "cliente" ? "do cliente" : r.origemToken === "plataforma" ? "da plataforma (META_ACCESS_TOKEN)" : "nenhum"}</div>
          <ul className="list" style={{ marginTop: 8 }}>
            {r.verificacoes.map((x) => (
              <li key={x.id}>
                <div className="row"><strong>{x.rotulo}</strong><span className={`pill ${x.ok === true ? "pill-ok" : x.ok === false ? "pill-danger" : "pill-outline"}`}>{x.ok === true ? "OK" : x.ok === false ? "Falhou" : "Pulado"}</span></div>
                <div className="small" style={{ overflowWrap: "anywhere" }}>{x.detalhe}</div>
              </li>
            ))}
          </ul>
          {r.faltando.length > 0 && <p className="small" style={{ margin: "8px 0 0" }}>Permissões que faltam: <b>{r.faltando.join(", ")}</b></p>}
          {r.concedidas.length > 0 && <p className="small muted" style={{ margin: "4px 0 0" }}>Concedidas: {r.concedidas.join(", ")}</p>}
          {r.info.ig_sugerido && !v.igUserId && <p className="small" style={{ margin: "8px 0 0" }}>Instagram vinculado à Página: <b>{r.info.ig_sugerido}</b> — copie para “ID do Instagram”.</p>}
        </div>
      )}
    </form>
  );
}
