import { Submit } from "@/components/Submit";
import { MarcaRotulo } from "@/components/brand";
import { ConectarMeta } from "@/components/canais/ConectarMeta";
import { ConectarInstagram } from "@/components/canais/ConectarInstagram";
import { ConectarGoogle } from "@/components/canais/ConectarGoogle";
import { ago } from "@/lib/format";
import { obterCanal, tokenDaPlataforma } from "@/lib/channels/store";
import { canaisFixtureAtiva } from "@/lib/channels/fixture";
import { origemChaveWindsor, origemChaveWindsorAds } from "@/lib/channels/servico";
import { gastoDoCiclo, historicoAlertasGasto } from "@/lib/channels/alerta-gasto";
import { CartaoGastoCiclo } from "@/components/canais/GastoCiclo";
import { spDate } from "@/lib/dates";
import { envOptional } from "@/lib/env";
import { chaveWindsorDaPlataforma } from "@/lib/channels/windsor";
import { RESULTADO_PADRAO } from "@/lib/channels/types";
import Link from "next/link";
import { carregarPublico, negocioDoNome } from "@/lib/channels/publico";
import { SecaoPublico } from "@/components/canais/Publico";
import { PERIODOS, ROTULO_PERIODO, ddmm, parsePeriodo, resolverPeriodo } from "@/lib/dashboards/periodo";
import { atualizarAnunciosAgora, atualizarGoogleAgoraAcao, atualizarInstagramAgora, desconectarAnuncios, desconectarGoogleAcao, desconectarInstagram, reiniciarContagemAcao, salvarAlertaGastoAcao } from "../canais-actions";

type Estado = { rotulo: string; cls: string };
const ST: Record<string, Estado> = {
  nenhum: { rotulo: "Não configurado", cls: "pill-outline" },
  pendente: { rotulo: "Aguardando a primeira coleta", cls: "pill-sand" },
  ativo: { rotulo: "Ativo", cls: "pill-ok" },
  erro: { rotulo: "Com erro", cls: "pill-danger" },
};
/** Estado de UMA fonte (anúncios ou Instagram), independente do outro. */
function estadoFonte(configurada: boolean, ultima: string | null, erro: string | null): Estado {
  if (!configurada) return ST.nenhum;
  if (erro) return ST.erro;
  return ultima ? ST.ativo : ST.pendente;
}

/** Aba “Canais” do cliente (administrador): duas fontes independentes, cada uma com conexão, teste, status e coleta próprios. Nunca recebe nem mostra token/chave: só o hint de 4 caracteres. */
export async function AbaCanais({ client, owner, periodo: periodoTxt }: { client: Record<string, any>; owner: boolean; periodo?: string }) {
  const id = client.id as string;
  const canal = await obterCanal(id);
  const fixture = canaisFixtureAtiva();
  const adsCfg = Boolean(canal && (canal.adsSource === "meta" || canal.adsSource === "windsor") && canal.adAccountId);
  const adsWin = canal?.adsSource === "windsor";
  const igCfg = Boolean(canal && canal.igSource !== "none");
  const stAds = estadoFonte(adsCfg, canal?.lastSyncAt ?? null, canal?.lastError ?? null);
  const stIg = estadoFonte(igCfg, canal?.igLastSyncAt ?? null, canal?.igLastError ?? null);
  const gCfg = canal?.gbpSource === "windsor";
  const stG = estadoFonte(gCfg, canal?.gbpLastSyncAt ?? null, canal?.gbpLastError ?? null);
  const ligado = canal && canal.status !== "desconectado";
  const igMeta = canal?.igSource === "meta";
  const hoje = spDate();
  const [gasto, historico] = await Promise.all([gastoDoCiclo(canal, hoje), canal ? historicoAlertasGasto(id) : []]);
  const chaveAds = origemChaveWindsorAds(canal);
  const periodoId = parsePeriodo(periodoTxt);
  const periodo = resolverPeriodo(periodoId, hoje);
  const publico = canal ? await carregarPublico(canal, periodo, hoje, { negocio: negocioDoNome(client.name), tecnico: true }).catch(() => null) : null;
  const rotulo = canal?.resultActionType === RESULTADO_PADRAO || !canal ? { um: "conversa", plural: "Conversas" } : { um: "resultado", plural: "Resultados" };
  return (
    <>
      {fixture && <div className="notice" role="note" style={{ marginTop: 12 }}><b>Dados simulados</b> (CHANNELS_FIXTURE, só desenvolvimento): testar e atualizar não chamam a Meta nem o Windsor.ai.</div>}
      {client.kind === "marketplace" && <div className="notice" role="note" style={{ marginTop: 12 }}>Este cliente é só de marketplaces: o menu Canais não aparece no Mapa dele.</div>}

      <section aria-labelledby="sec-ads">
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><h3 id="sec-ads"><MarcaRotulo marca="meta" tamanho={24}>Tráfego (anúncios) · {adsWin ? "Meta Ads via Windsor.ai" : "Meta Ads"}</MarcaRotulo></h3><span className={`pill ${stAds.cls}`}>{stAds.rotulo}</span></div>
          <p className="small muted" style={{ margin: "2px 0 0" }}>Fonte: {adsWin ? "Windsor.ai (conector Facebook Ads)" : "Meta Ads (token)"}. Aparece no Mapa como “Anúncios”, separado do Instagram.</p>
          {!canal || !adsCfg ? (
            <p className="muted" style={{ margin: "8px 0 0" }}>Anúncios não configurados. Escolha a fonte (Meta com token ou Windsor.ai) e informe a conta de anúncios abaixo.</p>
          ) : (
            <ul className="plist">
              <li><span>Conta de anúncios</span><b>{`${canal.info.conta_nome ? `${canal.info.conta_nome} · ` : ""}${canal.adAccountId}`}</b></li>
              <li><span>Campanhas</span><b>{[canal.campaignIds.length ? `IDs ${canal.campaignIds.join(", ")}` : null, canal.campaignNameFilter ? `nome contém “${canal.campaignNameFilter}”` : null].filter(Boolean).join(" · ") || "todas da conta"}</b></li>
              <li><span>Fonte</span><b>{adsWin ? "Windsor.ai (conector Facebook Ads)" : "Meta Ads com token"}</b></li>
              {adsWin ? <li><span>Chave</span><b>{chaveAds === "anuncios" ? "da agência (WINDSOR_ADS_API_KEY)" : chaveAds === "canal" ? `do canal · termina em ${canal.chaveWindsorHint ?? "····"} (WINDSOR_ADS_API_KEY ausente)` : chaveAds === "plataforma" ? "da plataforma (WINDSOR_API_KEY; WINDSOR_ADS_API_KEY ausente)" : "nenhuma — WINDSOR_ADS_API_KEY ausente neste ambiente"}</b></li> : <li><span>Token</span><b>{canal.temToken ? `do cliente · termina em ${canal.tokenHint ?? "····"}` : canal.usarTokenPlataforma ? `da plataforma (META_ACCESS_TOKEN${tokenDaPlataforma() ? "" : ", ausente neste ambiente"})` : "nenhum — pendente"}</b></li>}
              <li><span>Última coleta</span><b>{canal.lastSyncAt ? ago(canal.lastSyncAt) : "ainda não coletou"}</b></li>
              {canal.lastError && <li className="late"><span>Último erro</span><b style={{ overflowWrap: "anywhere" }}>{canal.lastError}</b></li>}
            </ul>
          )}
          {owner && ligado && adsCfg && (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <form action={atualizarAnunciosAgora}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-orange">Atualizar anúncios agora</Submit></form>
              <form action={desconectarAnuncios}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-danger" confirm="Desconectar os anúncios? O token da Meta será apagado. O histórico já coletado continua guardado e o Instagram não é afetado.">Desconectar anúncios</Submit></form>
            </div>
          )}
          {owner && ligado && adsCfg && <p className="small muted" style={{ margin: "8px 0 0" }}>“Atualizar” coleta e completa até 90 dias de histórico (pode levar alguns segundos). A rotina diária roda sozinha.</p>}
        </div>
        {owner ? (
          <ConectarMeta
            clientId={id}
            plataformaDisponivel={Boolean(tokenDaPlataforma())}
            inicial={{
              adsSource: canal?.adsSource === "windsor" ? "windsor" : canal?.adsSource === "meta" || !canal ? "meta" : "none", adAccountId: canal?.adAccountId?.replace(/^act_/, "") ?? "", campaignIds: canal?.campaignIds.join(", ") ?? "", campaignNameFilter: canal?.campaignNameFilter ?? "",
              resultActionType: canal?.resultActionType ?? RESULTADO_PADRAO, usarTokenPlataforma: canal?.usarTokenPlataforma ?? false, temToken: canal?.temToken ?? false, tokenHint: canal?.tokenHint ?? null,
            }}
          />
        ) : null}
      </section>

      <AlertaRecarga clientId={id} owner={owner} adsCfg={adsCfg} canal={canal} gasto={gasto} historico={historico} />

      {adsCfg && canal?.lastSyncAt && (
        <div style={{ marginTop: 18 }}>
          <nav className="tabs periodo" aria-label="Período do público">
            {PERIODOS.map((p) => <Link key={p} href={`/clientes/${id}?aba=canais${p !== "30" ? `&periodo=${p}` : ""}#sec-publico`} aria-current={p === periodoId ? "page" : undefined}>{ROTULO_PERIODO[p]}</Link>)}
          </nav>
          <p className="small muted" style={{ margin: "4px 0 0" }}>{ddmm(periodo.atual.de)} a {ddmm(periodo.atual.ate)} · o cliente vê a mesma seção no Mapa → Canais → Anúncios (sem o bloco técnico).</p>
          <SecaoPublico p={publico} r={rotulo} admin />
        </div>
      )}

      <section aria-labelledby="sec-ig" style={{ marginTop: 18 }}>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><h3 id="sec-ig"><MarcaRotulo marca="instagram" tamanho={24}>Mídias (Instagram) · {igMeta ? "Meta Graph" : "Windsor.ai"}</MarcaRotulo></h3><span className={`pill ${stIg.cls}`}>{stIg.rotulo}</span></div>
          <p className="small muted" style={{ margin: "2px 0 0" }}>Fonte: {igMeta ? "Meta (Instagram Graph)" : "Windsor.ai"}. Independente dos anúncios: se uma falha, a outra continua.</p>
          {!canal || !igCfg ? (
            <p className="muted" style={{ margin: "8px 0 0" }}>Instagram não configurado. Escolha a fonte e salve abaixo (recomendado: Windsor.ai).</p>
          ) : (
            <ul className="plist">
              <li><span>Fonte</span><b>{igMeta ? "Meta Graph" : "Windsor.ai"}</b></li>
              <li><span>Conta</span><b>{igMeta ? `${canal.info.ig_username ? `@${canal.info.ig_username} · ` : ""}${canal.igUserId}` : `${canal.windsorAccountName ? `account_name “${canal.windsorAccountName}”` : "única conta do Windsor.ai"}${canal.info.ig_username ? ` · @${canal.info.ig_username}` : ""}`}</b></li>
              {!igMeta && <li><span>Chave</span><b>{origemChaveWindsor(canal) === "canal" ? `do canal · termina em ${canal.chaveWindsorHint ?? "····"}` : origemChaveWindsor(canal) === "plataforma" ? "da plataforma (WINDSOR_API_KEY)" : "nenhuma — WINDSOR_API_KEY ausente neste ambiente"}</b></li>}
              <li><span>Última coleta</span><b>{canal.igLastSyncAt ? ago(canal.igLastSyncAt) : "ainda não coletou"}</b></li>
              {canal.igLastError && <li className="late"><span>Último erro</span><b style={{ overflowWrap: "anywhere" }}>{canal.igLastError}</b></li>}
            </ul>
          )}
          {owner && ligado && igCfg && (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <form action={atualizarInstagramAgora}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-orange">Atualizar Instagram agora</Submit></form>
              <form action={desconectarInstagram}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-danger" confirm="Desconectar o Instagram? A chave do canal será apagada. O histórico já coletado continua guardado e os anúncios não são afetados.">Desconectar Instagram</Submit></form>
            </div>
          )}
        </div>
        {owner ? (
          <ConectarInstagram
            clientId={id}
            chavePlataformaDisponivel={Boolean(chaveWindsorDaPlataforma())}
            inicial={{
              igSource: !canal || canal.igSource === "none" ? "windsor" : canal.igSource, windsorAccountName: canal?.windsorAccountName ?? "", temChave: canal?.temChaveWindsor ?? false,
              chaveHint: canal?.chaveWindsorHint ?? null, igUserId: canal?.igUserId ?? "", pageId: canal?.pageId ?? "",
            }}
          />
        ) : (
          <p className="small muted">Somente administradores conectam, testam ou desconectam canais.</p>
        )}
      </section>

      <section aria-labelledby="sec-google" style={{ marginTop: 18 }}>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><h3 id="sec-google"><MarcaRotulo marca="google" tamanho={24}>Google · Perfil da Empresa</MarcaRotulo></h3><span className={`pill ${stG.cls}`}>{stG.rotulo}</span></div>
          <p className="small muted" style={{ margin: "2px 0 0" }}>Fonte: Windsor.ai (conector Google My Business), com a mesma chave do Instagram. Aparece no Mapa como a aba “Google”; independente dos anúncios e do Instagram.</p>
          {!canal || !gCfg ? (
            <p className="muted" style={{ margin: "8px 0 0" }}>Google não configurado. Escolha Windsor.ai e informe o nome do local abaixo.</p>
          ) : (
            <ul className="plist">
              <li><span>Local</span><b>{canal.gbpLocationName ? `“${canal.gbpLocationName}”` : "único local do Windsor.ai"}{canal.info.gbp_local && canal.info.gbp_local !== canal.gbpLocationName ? ` · ${canal.info.gbp_local}` : ""}</b></li>
              <li><span>Chave</span><b>{origemChaveWindsor(canal) === "canal" ? `do canal · termina em ${canal.chaveWindsorHint ?? "····"}` : origemChaveWindsor(canal) === "plataforma" ? "da plataforma (WINDSOR_API_KEY)" : "nenhuma — WINDSOR_API_KEY ausente neste ambiente"}</b></li>
              <li><span>Última coleta</span><b>{canal.gbpLastSyncAt ? ago(canal.gbpLastSyncAt) : "ainda não coletou"}</b></li>
              {canal.gbpLastError && <li className="late"><span>Último erro</span><b style={{ overflowWrap: "anywhere" }}>{canal.gbpLastError}</b></li>}
            </ul>
          )}
          {owner && ligado && gCfg && (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <form action={atualizarGoogleAgoraAcao}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-orange">Atualizar Google agora</Submit></form>
              <form action={desconectarGoogleAcao}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-danger" confirm="Desconectar o Google? O histórico já coletado (inclusive as avaliações) continua guardado; anúncios e Instagram não são afetados.">Desconectar Google</Submit></form>
            </div>
          )}
          {owner && ligado && gCfg && <p className="small muted" style={{ margin: "8px 0 0" }}>“Atualizar” traz os últimos 90 dias (visualizações, rotas, ligações, avaliações e buscas). O Windsor só devolve as avaliações escritas no período pedido: cada uma fica guardada e o histórico acumula. A rotina diária roda sozinha.</p>}
        </div>
        {owner && <ConectarGoogle clientId={id} inicial={{ gbpSource: "windsor", local: canal?.gbpLocationName ?? "" }} />}
      </section>
    </>
  );
}

const NIVEL = { aviso: "Saldo acabando", limite: "Faça a recarga" } as const;
const EMAIL: Record<string, { rotulo: string; cls: string }> = {
  enviado: { rotulo: "E-mail enviado", cls: "pill-ok" },
  coberto: { rotulo: "Coberto pelo aviso de 100%", cls: "pill-outline" },
  sem_configuracao: { rotulo: "Pendente: e-mail não configurado", cls: "pill-danger" },
  sem_destinatario: { rotulo: "Pendente: sem destinatário", cls: "pill-danger" },
  falhou: { rotulo: "Envio falhou", cls: "pill-danger" },
};
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Alerta de recarga (só administradores configuram): limite, % do aviso, data inicial do ciclo, e-mails, reinício e histórico. */
function AlertaRecarga({ clientId, owner, adsCfg, canal, gasto, historico }: {
  clientId: string; owner: boolean; adsCfg: boolean; canal: Awaited<ReturnType<typeof obterCanal>>;
  gasto: Awaited<ReturnType<typeof gastoDoCiclo>>; historico: Awaited<ReturnType<typeof historicoAlertasGasto>>;
}) {
  const cfg = canal?.alertaGasto ?? null;
  const copia = envOptional("ALERT_EMAIL_TO");
  const emailOk = Boolean(envOptional("RESEND_API_KEY") && envOptional("ALERT_EMAIL_FROM"));
  return (
    <section aria-labelledby="sec-alerta" style={{ marginTop: 18 }}>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row"><h3 id="sec-alerta">Alerta de recarga dos anúncios</h3><span className={`pill ${cfg ? "pill-ok" : "pill-outline"}`}>{cfg ? "Ligado" : "Desligado"}</span></div>
        <p className="small muted" style={{ margin: "2px 0 0" }}>
          Soma o gasto das campanhas filtradas deste cliente desde a data inicial. Avisa por e-mail aos destinatários (com cópia ao dono{copia ? "" : ", ALERT_EMAIL_TO ausente"}), no sino e no Mapa: uma vez ao chegar no percentual de aviso e uma vez ao atingir o limite, em cada ciclo.
        </p>
        {!emailOk && <div className="notice" role="note" style={{ marginTop: 8 }}>O envio de e-mail não está configurado neste ambiente (RESEND_API_KEY / ALERT_EMAIL_FROM): os avisos ficam registrados como pendência e aparecem no sino.</div>}
        {!adsCfg && <p className="muted" style={{ margin: "8px 0 0" }}>Configure os anúncios acima antes de ligar o alerta.</p>}
        {gasto && <CartaoGastoCiclo g={gasto} compacto id="adm-gasto" />}
        {owner && adsCfg && (
          <form action={salvarAlertaGastoAcao} className="stack" style={{ marginTop: 12 }} aria-label="Configurar alerta de recarga">
            <input type="hidden" name="client_id" value={clientId} />
            <div className="grid two">
              <div className="field"><label htmlFor="al-limite">Limite (R$)</label><input id="al-limite" name="limite" inputMode="decimal" defaultValue={cfg ? String(cfg.limite).replace(".", ",") : ""} placeholder="400" required /></div>
              <div className="field"><label htmlFor="al-pct">Avisar ao chegar em (%)</label><input id="al-pct" name="aviso_pct" type="number" min={1} max={99} step={1} defaultValue={cfg?.avisoPct ?? 80} /></div>
              <div className="field"><label htmlFor="al-desde">Contar a partir de</label><input id="al-desde" name="desde" type="date" defaultValue={cfg?.desde ?? spDate()} required /></div>
              <div className="field"><label htmlFor="al-emails">E-mails do cliente</label><input id="al-emails" name="emails" defaultValue={cfg?.emails.join(", ") ?? ""} placeholder="contato@cliente.com.br, outro@cliente.com.br" /><div className="small muted">Separados por vírgula. O dono recebe cópia.</div></div>
            </div>
            <div className="btn-row"><Submit className="btn btn-orange">Salvar alerta</Submit></div>
          </form>
        )}
        {owner && cfg && (
          <div className="btn-row" style={{ marginTop: 12, alignItems: "center" }}>
            <form action={reiniciarContagemAcao}>
              <input type="hidden" name="client_id" value={clientId} />
              <Submit className="btn btn-sm btn-orange" confirm={`Confirmar que a recarga foi feita? A contagem recomeça hoje (${dmy(spDate())}) e os avisos de ${cfg.avisoPct}% e 100% voltam a valer.`}>Recarga feita — reiniciar contagem</Submit>
            </form>
            <form action={salvarAlertaGastoAcao}>
              <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="desligar" value="1" />
              <Submit className="btn btn-sm btn-ghost" confirm="Desligar o alerta de recarga deste cliente?">Desligar alerta</Submit>
            </form>
            <span className="small muted">Ciclo atual desde {dmy(cfg.desde)}.</span>
          </div>
        )}
        <h4 style={{ margin: "16px 0 6px" }}>Alertas enviados</h4>
        {historico.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nenhum alerta enviado ainda.</p> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Quando</th><th>Nível</th><th>Gasto / limite</th><th>Conversas</th><th>Ciclo desde</th><th>E-mail</th></tr></thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id}>
                    <td>{ago(h.criado_em)}</td>
                    <td>{NIVEL[h.nivel]}</td>
                    <td>{h.gasto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / {h.limite.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                    <td>{h.conversas}</td>
                    <td>{dmy(h.ciclo)}</td>
                    <td><span className={`pill ${EMAIL[h.email_status ?? ""]?.cls ?? "pill-outline"}`}>{EMAIL[h.email_status ?? ""]?.rotulo ?? "Registrando…"}</span>{h.destinatarios.length ? <div className="small muted" style={{ overflowWrap: "anywhere" }}>{h.destinatarios.join(", ")}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
