"use client";
// Seção “Tráfego (anúncios) · Meta Ads” (só administradores). Os campos são controlados para o teste de conexão não limpar o token digitado.
// O token vive só neste estado do navegador de quem digita; depois de salvo, o servidor o guarda cifrado e nunca o devolve.
// O Instagram NÃO é configurado aqui: tem seção e fonte próprias (ConectarInstagram).
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { salvarAnunciosMeta, testarConexaoMeta, testarConexaoWindsorAdsAcao, type EstadoTeste, type EstadoTesteWindsorAds } from "@/app/(painel)/clientes/canais-actions";

export interface CanalForm {
  adsSource: "meta" | "windsor" | "none"; adAccountId: string; campaignIds: string; resultActionType: string; usarTokenPlataforma: boolean; temToken: boolean; tokenHint: string | null;
}

export function Botao({ children, className = "btn", formAction }: { children: React.ReactNode; className?: string; formAction?: (fd: FormData) => void }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} formAction={formAction}>{pending ? "Aguarde…" : children}</button>;
}

export function ResultadoTesteMeta({ estado }: { estado: EstadoTeste }) {
  const r = estado?.resultado;
  return (
    <>
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
        </div>
      )}
    </>
  );
}

export function ResultadoTesteWindsorAdsView({ estado }: { estado: EstadoTesteWindsorAds }) {
  const w = estado?.resultado;
  return (
    <>
      {estado?.erro && <div className="notice danger" role="alert">{estado.erro}</div>}
      {w && (
        <div className={`notice ${w.ok ? "ok" : "danger"}`} role="status" aria-live="polite">
          <strong>{w.ok ? "Windsor.ai lendo os anúncios" : w.semConector ? "Conecte o Facebook Ads nesta conta do Windsor" : "Há pendências na conexão com o Windsor.ai"}</strong>
          <div className="small muted">Chave usada: {w.origemChave === "canal" ? "do canal" : w.origemChave === "plataforma" ? "da plataforma (WINDSOR_API_KEY)" : "nenhuma"}</div>
          <ul className="list" style={{ marginTop: 8 }}>
            {w.verificacoes.map((x) => (
              <li key={x.id}>
                <div className="row"><strong>{x.rotulo}</strong><span className={`pill ${x.ok === true ? "pill-ok" : x.ok === false ? "pill-danger" : "pill-outline"}`}>{x.ok === true ? "OK" : x.ok === false ? "Falhou" : "Aviso"}</span></div>
                <div className="small" style={{ overflowWrap: "anywhere" }}>{x.detalhe}</div>
              </li>
            ))}
          </ul>
          {w.semConector && <p className="small" style={{ margin: "8px 0 0" }}>Abra <a href="https://onboard.windsor.ai?datasource=facebook" target="_blank" rel="noopener noreferrer">onboard.windsor.ai</a>, conecte o Facebook Ads com o perfil dono da conta de anúncios e escolha a conta do cliente. O cliente continua vendo “Conectando anúncios”.</p>}
          {w.info.contas.length > 0 && <p className="small" style={{ margin: "8px 0 0" }}>Conta(s): <b>{w.info.contas.map((c) => `${c.nome ? `${c.nome} · ` : ""}${c.id}`).join(", ")}</b>{w.info.campanhas.length ? <> · <b>{w.info.campanhas.length}</b> campanha(s)</> : null}{w.info.anuncios ? <> · <b>{w.info.anuncios}</b> anúncio(s)</> : null}.</p>}
        </div>
      )}
    </>
  );
}

export function ConectarMeta({ clientId, inicial, plataformaDisponivel }: { clientId: string; inicial: CanalForm; plataformaDisponivel: boolean }) {
  const [v, setV] = useState({ ...inicial, token: "" });
  const [estado, testar] = useActionState<EstadoTeste, FormData>(testarConexaoMeta, null);
  const [estadoW, testarW] = useActionState<EstadoTesteWindsorAds, FormData>(testarConexaoWindsorAdsAcao, null);
  const windsor = v.adsSource === "windsor";
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  return (
    <form action={salvarAnunciosMeta} className="card stack" autoComplete="off" style={{ marginTop: 12 }} aria-label="Configurar anúncios (Meta Ads)">
      <h3>Configurar anúncios · Meta Ads</h3>
      <p className="small muted" style={{ margin: 0 }}>Somente leitura: a Avanteza só consulta (GET) a conta de anúncios. Nada é alterado na Meta. {windsor ? <>Pelo Windsor.ai não é preciso token da Meta: vale a chave do Windsor (WINDSOR_API_KEY ou a chave do canal, na seção do Instagram) com o <b>Facebook Ads</b> conectado.</> : <>Permissões do token: <b>ads_read</b> e <b>read_insights</b>.</>}</p>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="escopo" value="ads" />
      <div className="grid two">
        <div className="field">
          <label htmlFor="cm-fonte">Fonte dos anúncios</label>
          <select id="cm-fonte" name="ads_source" value={v.adsSource} onChange={set("adsSource")}>
            <option value="meta">Meta Ads (token do cliente)</option>
            <option value="windsor">Windsor.ai (conector Facebook Ads)</option>
            <option value="none">Sem anúncios</option>
          </select>
        </div>
        <div className="field"><label htmlFor="cm-conta">Conta de anúncios</label><input id="cm-conta" name="ad_account_id" value={v.adAccountId} onChange={set("adAccountId")} placeholder="605261696580859" inputMode="numeric" /></div>
        <div className="field"><label htmlFor="cm-camp">Campanhas</label><input id="cm-camp" name="campaign_ids" value={v.campaignIds} onChange={set("campaignIds")} placeholder="em branco = todas; ou IDs separados por vírgula" /></div>
      </div>
      {!windsor && <div className="field">
        <label htmlFor="cm-token">Token da Meta</label>
        <input id="cm-token" name="token" type="password" value={v.token} onChange={set("token")} autoComplete="new-password" spellCheck={false}
          placeholder={inicial.temToken ? `Token salvo (termina em ${inicial.tokenHint ?? "····"}). Deixe em branco para manter.` : "Cole aqui o token de acesso do cliente"} />
        <div className="small muted" style={{ marginTop: 4 }}>Guardado criptografado; nunca mais aparece na tela. Não tire print desta tela com o token.</div>
      </div>}
      <details>
        <summary className="small">Opções avançadas</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="field"><label htmlFor="cm-res">Tipo de resultado (action_type)</label><input id="cm-res" name="result_action_type" value={v.resultActionType} onChange={set("resultActionType")} /><div className="small muted">Padrão: conversas iniciadas no WhatsApp em 7 dias.</div></div>
          {!windsor && <label className="check small"><input type="checkbox" name="use_platform_token" checked={v.usarTokenPlataforma} onChange={set("usarTokenPlataforma")} /> Se o cliente não tiver token, usar o token da plataforma (META_ACCESS_TOKEN){plataformaDisponivel ? "" : " — não está configurado neste ambiente"}</label>}
        </div>
      </details>
      <div className="btn-row">
        {windsor
          ? <Botao className="btn btn-ghost" formAction={testarW}>Testar conexão (Windsor.ai)</Botao>
          : <Botao className="btn btn-ghost" formAction={testar}>Testar conexão (Meta Ads)</Botao>}
        <Botao className="btn btn-orange">Salvar anúncios</Botao>
      </div>
      {windsor ? <ResultadoTesteWindsorAdsView estado={estadoW} /> : <ResultadoTesteMeta estado={estado} />}
    </form>
  );
}
