import { Submit } from "@/components/Submit";
import { ConectarMeta } from "@/components/canais/ConectarMeta";
import { ago } from "@/lib/format";
import { obterCanal, tokenDaPlataforma } from "@/lib/channels/store";
import { canaisFixtureAtiva } from "@/lib/channels/fixture";
import { RESULTADO_PADRAO } from "@/lib/channels/types";
import { atualizarCanalAgora, desconectarCanalMeta } from "../canais-actions";

const STATUS: Record<string, { rotulo: string; cls: string }> = {
  pendente: { rotulo: "Aguardando a primeira coleta", cls: "pill-sand" },
  ativo: { rotulo: "Ativo", cls: "pill-ok" },
  erro: { rotulo: "Com erro", cls: "pill-danger" },
  desconectado: { rotulo: "Desconectado", cls: "pill-outline" },
};

/** Aba “Canais” do cliente (administrador). Nunca recebe nem mostra o token: só o hint de 4 caracteres. */
export async function AbaCanais({ client, owner }: { client: Record<string, any>; owner: boolean }) {
  const id = client.id as string;
  const canal = await obterCanal(id);
  const st = canal ? STATUS[canal.status] : null;
  const fixture = canaisFixtureAtiva();
  return (
    <>
      {fixture && <div className="notice" role="note" style={{ marginTop: 12 }}><b>Dados simulados</b> (CHANNELS_FIXTURE, só desenvolvimento): testar e atualizar não chamam a Meta.</div>}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row"><h3>Meta Ads e Instagram</h3>{st && <span className={`pill ${st.cls}`}>{st.rotulo}</span>}</div>
        {!canal ? (
          <p className="muted" style={{ margin: "6px 0 0" }}>Nenhum canal conectado. {client.kind === "marketplace" ? "Este cliente é só de marketplaces: o menu Canais não aparece no Mapa dele." : "Conecte a Meta abaixo para o cliente ver anúncios, Instagram e a evolução no Mapa."}</p>
        ) : (
          <ul className="plist">
            <li><span>Conta de anúncios</span><b>{canal.adAccountId ? `${canal.info.conta_nome ? `${canal.info.conta_nome} · ` : ""}${canal.adAccountId}` : "—"}</b></li>
            <li><span>Campanhas</span><b>{canal.campaignIds.length ? canal.campaignIds.join(", ") : "todas da conta"}</b></li>
            <li><span>Instagram</span><b>{canal.igUserId ? `${canal.info.ig_username ? `@${canal.info.ig_username} · ` : ""}${canal.igUserId}` : "—"}</b></li>
            <li><span>Página</span><b>{canal.pageId ?? "—"}</b></li>
            <li><span>Token</span><b>{canal.temToken ? `do cliente · termina em ${canal.tokenHint ?? "····"}` : canal.usarTokenPlataforma ? `da plataforma (META_ACCESS_TOKEN${tokenDaPlataforma() ? "" : ", ausente neste ambiente"})` : "nenhum"}</b></li>
            <li><span>Última coleta</span><b>{canal.lastSyncAt ? ago(canal.lastSyncAt) : "ainda não coletou"}</b></li>
            {canal.lastError && <li className="late"><span>Último erro</span><b style={{ overflowWrap: "anywhere" }}>{canal.lastError}</b></li>}
          </ul>
        )}
        {owner && canal && canal.status !== "desconectado" && (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <form action={atualizarCanalAgora}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-orange">Atualizar agora</Submit></form>
            <form action={desconectarCanalMeta}><input type="hidden" name="client_id" value={id} /><Submit className="btn btn-sm btn-danger" confirm="Desconectar? O token será apagado. O histórico já coletado continua guardado.">Desconectar</Submit></form>
          </div>
        )}
        {owner && canal && <p className="small muted" style={{ margin: "8px 0 0" }}>“Atualizar agora” coleta e completa até 90 dias de histórico (pode levar alguns segundos). A rotina diária roda sozinha.</p>}
      </div>
      {owner ? (
        <ConectarMeta
          clientId={id}
          plataformaDisponivel={Boolean(tokenDaPlataforma())}
          inicial={{
            adAccountId: canal?.adAccountId?.replace(/^act_/, "") ?? "", campaignIds: canal?.campaignIds.join(", ") ?? "", igUserId: canal?.igUserId ?? "", pageId: canal?.pageId ?? "",
            resultActionType: canal?.resultActionType ?? RESULTADO_PADRAO, usarTokenPlataforma: canal?.usarTokenPlataforma ?? false, temToken: canal?.temToken ?? false, tokenHint: canal?.tokenHint ?? null,
          }}
        />
      ) : (
        <p className="small muted">Somente administradores conectam, testam ou desconectam canais.</p>
      )}
    </>
  );
}
