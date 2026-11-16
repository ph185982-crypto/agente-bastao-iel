import { Submit } from "@/components/Submit";
import { ConectarMeta } from "@/components/canais/ConectarMeta";
import { ConectarInstagram } from "@/components/canais/ConectarInstagram";
import { ago } from "@/lib/format";
import { obterCanal, tokenDaPlataforma } from "@/lib/channels/store";
import { canaisFixtureAtiva } from "@/lib/channels/fixture";
import { origemChaveWindsor } from "@/lib/channels/servico";
import { chaveWindsorDaPlataforma } from "@/lib/channels/windsor";
import { RESULTADO_PADRAO } from "@/lib/channels/types";
import { atualizarAnunciosAgora, atualizarInstagramAgora, desconectarAnuncios, desconectarInstagram } from "../canais-actions";

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
export async function AbaCanais({ client, owner }: { client: Record<string, any>; owner: boolean }) {
  const id = client.id as string;
  const canal = await obterCanal(id);
  const fixture = canaisFixtureAtiva();
  const adsCfg = Boolean(canal && canal.adsSource === "meta" && canal.adAccountId);
  const igCfg = Boolean(canal && canal.igSource !== "none");
  const stAds = estadoFonte(adsCfg, canal?.lastSyncAt ?? null, canal?.lastError ?? null);
  const stIg = estadoFonte(igCfg, canal?.igLastSyncAt ?? null, canal?.igLastError ?? null);
  const ligado = canal && canal.status !== "desconectado";
  const igMeta = canal?.igSource === "meta";
  return (
    <>
      {fixture && <div className="notice" role="note" style={{ marginTop: 12 }}><b>Dados simulados</b> (CHANNELS_FIXTURE, só desenvolvimento): testar e atualizar não chamam a Meta nem o Windsor.ai.</div>}
      {client.kind === "marketplace" && <div className="notice" role="note" style={{ marginTop: 12 }}>Este cliente é só de marketplaces: o menu Canais não aparece no Mapa dele.</div>}

      <section aria-labelledby="sec-ads">
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><h3 id="sec-ads">Tráfego (anúncios) · Meta Ads</h3><span className={`pill ${stAds.cls}`}>{stAds.rotulo}</span></div>
          <p className="small muted" style={{ margin: "2px 0 0" }}>Fonte: Meta Ads. Aparece no Mapa como “Anúncios”, separado do Instagram.</p>
          {!canal || !adsCfg ? (
            <p className="muted" style={{ margin: "8px 0 0" }}>Anúncios não configurados. Informe a conta de anúncios e o token da Meta abaixo.</p>
          ) : (
            <ul className="plist">
              <li><span>Conta de anúncios</span><b>{`${canal.info.conta_nome ? `${canal.info.conta_nome} · ` : ""}${canal.adAccountId}`}</b></li>
              <li><span>Campanhas</span><b>{canal.campaignIds.length ? canal.campaignIds.join(", ") : "todas da conta"}</b></li>
              <li><span>Token</span><b>{canal.temToken ? `do cliente · termina em ${canal.tokenHint ?? "····"}` : canal.usarTokenPlataforma ? `da plataforma (META_ACCESS_TOKEN${tokenDaPlataforma() ? "" : ", ausente neste ambiente"})` : "nenhum — pendente"}</b></li>
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
              adsSource: canal?.adsSource === "meta" || !canal ? "meta" : "none", adAccountId: canal?.adAccountId?.replace(/^act_/, "") ?? "", campaignIds: canal?.campaignIds.join(", ") ?? "",
              resultActionType: canal?.resultActionType ?? RESULTADO_PADRAO, usarTokenPlataforma: canal?.usarTokenPlataforma ?? false, temToken: canal?.temToken ?? false, tokenHint: canal?.tokenHint ?? null,
            }}
          />
        ) : null}
      </section>

      <section aria-labelledby="sec-ig" style={{ marginTop: 18 }}>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><h3 id="sec-ig">Mídias (Instagram) · {igMeta ? "Meta Graph" : "Windsor.ai"}</h3><span className={`pill ${stIg.cls}`}>{stIg.rotulo}</span></div>
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
    </>
  );
}
