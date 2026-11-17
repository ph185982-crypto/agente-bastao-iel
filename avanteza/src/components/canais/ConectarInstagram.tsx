"use client";
// Seção “Mídias (Instagram)” (só administradores). Fonte padrão: Windsor.ai. A chave do Windsor (opcional por canal) vive só neste estado
// do navegador de quem digita; depois de salvar, o servidor a guarda cifrada e nunca a devolve. Sem chave no canal, vale WINDSOR_API_KEY.
import { useActionState, useState } from "react";
import { salvarInstagramCanal, testarConexaoMeta, testarConexaoWindsorAcao, type EstadoTeste, type EstadoTesteWindsor } from "@/app/(painel)/clientes/canais-actions";
import { Botao, ResultadoTesteMeta } from "./ConectarMeta";

export interface InstagramForm {
  igSource: "windsor" | "meta" | "none"; windsorAccountName: string; temChave: boolean; chaveHint: string | null; igUserId: string; pageId: string;
}

export function ConectarInstagram({ clientId, inicial, chavePlataformaDisponivel }: { clientId: string; inicial: InstagramForm; chavePlataformaDisponivel: boolean }) {
  const [v, setV] = useState({ ...inicial, chave: "" });
  const [estadoW, testarW] = useActionState<EstadoTesteWindsor, FormData>(testarConexaoWindsorAcao, null);
  const [estadoM, testarM] = useActionState<EstadoTeste, FormData>(testarConexaoMeta, null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const w = estadoW?.resultado;

  return (
    <form action={salvarInstagramCanal} className="card stack" autoComplete="off" style={{ marginTop: 12 }} aria-label="Configurar Instagram">
      <h3>Configurar Instagram</h3>
      <p className="small muted" style={{ margin: 0 }}>Somente leitura. O Instagram é uma fonte <b>independente</b> dos anúncios: tem a própria conexão, teste e coleta, e os números nunca são somados aos da Meta Ads.</p>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="escopo" value="instagram" />
      <div className="field">
        <label htmlFor="ci-fonte">Fonte do Instagram</label>
        <select id="ci-fonte" name="ig_source" value={v.igSource} onChange={set("igSource")}>
          <option value="windsor">Windsor.ai (recomendado)</option>
          <option value="meta">Meta Graph (ID do Instagram + token da Meta)</option>
          <option value="none">Sem Instagram</option>
        </select>
      </div>

      {v.igSource === "windsor" && (
        <>
          <div className="grid two">
            <div className="field">
              <label htmlFor="ci-conta">Nome da conta (account_name)</label>
              <input id="ci-conta" name="windsor_account_name" value={v.windsorAccountName} onChange={set("windsorAccountName")} placeholder="showmanbarbearia" spellCheck={false} />
              <div className="small muted" style={{ marginTop: 4 }}>Opcional se há uma só conta no Windsor.ai. Com várias contas, é obrigatório para não misturar dados.</div>
            </div>
            <div className="field">
              <label htmlFor="ci-chave">Chave do Windsor.ai (opcional)</label>
              <input id="ci-chave" name="windsor_key" type="password" value={v.chave} onChange={set("chave")} autoComplete="new-password" spellCheck={false}
                placeholder={inicial.temChave ? `Chave salva (termina em ${inicial.chaveHint ?? "····"}). Deixe em branco para manter.` : chavePlataformaDisponivel ? "Em branco = chave da plataforma" : "Cole a chave do Windsor.ai"} />
              <div className="small muted" style={{ marginTop: 4 }}>{chavePlataformaDisponivel ? "Sem chave aqui, vale WINDSOR_API_KEY da plataforma. " : "WINDSOR_API_KEY não está configurada neste ambiente. "}Guardada criptografada; nunca mais aparece na tela.</div>
            </div>
          </div>
          <div className="btn-row">
            <Botao className="btn btn-ghost" formAction={testarW}>Testar conexão (Windsor.ai)</Botao>
            <Botao className="btn btn-orange">Salvar Instagram</Botao>
          </div>
          {estadoW?.erro && <div className="notice danger" role="alert">{estadoW.erro}</div>}
          {w && (
            <div className={`notice ${w.ok ? "ok" : "danger"}`} role="status" aria-live="polite">
              <strong>{w.ok ? "Windsor.ai respondendo" : "Há pendências na conexão com o Windsor.ai"}</strong>
              <div className="small muted">Chave usada: {w.origemChave === "canal" ? "do canal" : w.origemChave === "plataforma" ? "da plataforma (WINDSOR_API_KEY)" : "nenhuma"}</div>
              <ul className="list" style={{ marginTop: 8 }}>
                {w.verificacoes.map((x) => (
                  <li key={x.id}>
                    <div className="row"><strong>{x.rotulo}</strong><span className={`pill ${x.ok === true ? "pill-ok" : x.ok === false ? "pill-danger" : "pill-outline"}`}>{x.ok === true ? "OK" : x.ok === false ? "Falhou" : "Aviso"}</span></div>
                    <div className="small" style={{ overflowWrap: "anywhere" }}>{x.detalhe}</div>
                  </li>
                ))}
              </ul>
              {(w.info.dias > 0 || w.info.midias > 0) && (
                <p className="small" style={{ margin: "8px 0 0" }}>Lido: <b>{w.info.dias}</b> dia(s) do perfil · <b>{w.info.midias}</b> mídia(s){w.info.seguidores != null ? <> · <b>{w.info.seguidores}</b> seguidores</> : null}.</p>
              )}
              {w.info.contas.length === 1 && v.windsorAccountName.trim() === "" && (
                <p className="small" style={{ margin: "4px 0 0" }}>Conta encontrada: <b>{w.info.contas[0]}</b> — copie para “Nome da conta” se quiser fixá-la.</p>
              )}
            </div>
          )}
        </>
      )}

      {v.igSource === "meta" && (
        <>
          <div className="grid two">
            <div className="field"><label htmlFor="ci-ig">ID do Instagram</label><input id="ci-ig" name="ig_user_id" value={v.igUserId} onChange={set("igUserId")} inputMode="numeric" /></div>
            <div className="field"><label htmlFor="ci-pg">ID da Página (opcional)</label><input id="ci-pg" name="page_id" value={v.pageId} onChange={set("pageId")} inputMode="numeric" /></div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Usa o token da Meta configurado em “Tráfego (anúncios)”, que precisa também de instagram_basic, instagram_manage_insights e pages_read_engagement.</p>
          <div className="btn-row">
            <Botao className="btn btn-ghost" formAction={testarM}>Testar conexão (Meta)</Botao>
            <Botao className="btn btn-orange">Salvar Instagram</Botao>
          </div>
          <ResultadoTesteMeta estado={estadoM} />
        </>
      )}

      {v.igSource === "none" && (
        <div className="btn-row"><Botao className="btn btn-orange">Salvar Instagram</Botao></div>
      )}
    </form>
  );
}
