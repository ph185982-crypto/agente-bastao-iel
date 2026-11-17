// Canais dos clientes no bloco Marketing da Central. NÃO altera os números da Meta da agência (nem o CAC): aparece como um
// subtotal separado. Regra anti-duplicidade: uma conta de anúncios que já está nas contas lidas com META_ACCESS_TOKEN
// ("jaNaAgencia") fica listada mas NÃO entra no subtotal; se a Meta da agência estiver fora do ar não dá para saber, e a conta
// também fica fora ("incerto"). Dentro dos canais, o mesmo (conta, campanha, dia) nunca é somado duas vezes.
import { rawQuery } from "../db/client";
import type { Fonte } from "../dashboards";
import type { MetaResultado } from "../dashboards/meta";
import type { Intervalo } from "../dashboards/periodo";

// Fontes de anúncios: Meta (token) e Windsor.ai (conector facebook). As duas gravam a MESMA conta de anúncios; por isso a conta é
// comparada sem o prefixo act_ (o Windsor devolve só os dígitos) e cada canal só lê os snapshots da fonte que está configurada nele.
export interface LinhaCanalCliente { cliente: string; conta: string; fonte: "meta" | "windsor"; gasto: number; resultados: number; semDados: boolean; situacao: "somada" | "ja-na-agencia" | "incerto" }
export interface CanaisClientesDash { linhas: LinhaCanalCliente[]; gastoSomado: number; resultadosSomados: number }

/** Conta de anúncios sem o prefixo act_ (Meta usa act_123; o Windsor, 123). */
export const contaNormalizada = (conta: string) => conta.trim().replace(/^act_/i, "");

export function classificar(conta: string, meta: Fonte<MetaResultado>): LinhaCanalCliente["situacao"] {
  if (meta.estado === "nao-configurado") return "somada";
  if (meta.estado !== "ok") return "incerto";
  const alvo = contaNormalizada(conta);
  return meta.dados.contas.some((c) => contaNormalizada(c.id) === alvo && c.ok) ? "ja-na-agencia" : "somada";
}

export async function carregarCanaisClientes(periodo: Intervalo, meta: Fonte<MetaResultado>): Promise<CanaisClientesDash> {
  // Dedup: (conta normalizada, campanha, dia) uma vez só, mesmo que a conta esteja em dois clientes ou com fontes diferentes;
  // cada canal lê apenas os snapshots da própria fonte (trocar Meta ↔ Windsor nunca soma as duas).
  const rows = await rawQuery<{ cliente: string; conta: string; fonte: "meta" | "windsor"; gasto: number; resultados: number; dias: number }>(
    `with canais as (
       select ch.client_id, cl.name as cliente, ch.ad_account_id as conta, ch.ads_source as fonte,
              regexp_replace(trim(ch.ad_account_id), '^act_', '', 'i') as conta_n
         from avanteza.client_channels ch
         join avanteza.clients cl on cl.id = ch.client_id
        where ch.provider = 'meta' and ch.ads_source in ('meta','windsor') and ch.ad_account_id is not null
          and ch.status <> 'desconectado' and cl.active
     ), s as (
       select distinct on (c.conta_n, x.key, x.date) c.client_id, x.date, x.metrics
         from avanteza.channel_snapshots x join canais c on c.client_id = x.client_id and x.source = c.fonte
        where x.kind = 'campaign_daily' and x.date between $1::date and $2::date
        order by c.conta_n, x.key, x.date, x.updated_at desc
     )
     select c.cliente, c.conta, c.fonte,
            coalesce(sum((s.metrics->>'spend')::numeric), 0) as gasto,
            coalesce(sum((s.metrics->>'results')::numeric), 0) as resultados, count(s.date)::int as dias
       from canais c left join s on s.client_id = c.client_id
      group by c.cliente, c.conta, c.fonte
      order by gasto desc, cliente`,
    [periodo.de, periodo.ate],
  );
  const linhas: LinhaCanalCliente[] = rows.map((r) => ({ cliente: r.cliente, conta: r.conta, fonte: r.fonte, gasto: Number(r.gasto), resultados: Number(r.resultados), semDados: r.dias === 0, situacao: classificar(r.conta, meta) }));
  const somadas = linhas.filter((l) => l.situacao === "somada");
  return { linhas, gastoSomado: somadas.reduce((t, l) => t + l.gasto, 0), resultadosSomados: somadas.reduce((t, l) => t + l.resultados, 0) };
}

// ─── Canais por cliente (Marketing → Canais) ─────────────────────────────────────────────────────────────────────────────
// Resumo de conexão por cliente, sem números: de onde vêm os anúncios e o Instagram (Meta ou Windsor) e se a última coleta de
// cada fonte deu certo. Nunca lê token, chave, hint, ID de conta/Página/Instagram nem o texto do erro (detalhe fica na aba
// Canais do cliente, só para o administrador).
export type EstadoFonte = "sem-fonte" | "conectando" | "conectado" | "erro" | "desconectado";
export interface FonteResumo { fonte: "meta" | "windsor" | null; estado: EstadoFonte; atualizadoEm: string | null }
export interface CanalPorCliente { clientId: string; cliente: string; tipo: string; anuncios: FonteResumo; instagram: FonteResumo }

/** Estado de UMA fonte (anúncios ou Instagram), independente da outra. */
export function estadoFonte(fonte: string | null | undefined, statusCanal: string | null, ultimaColeta: string | null, temErro: boolean): FonteResumo {
  const f = fonte === "meta" || fonte === "windsor" ? fonte : null;
  if (!statusCanal || !f) return { fonte: null, estado: statusCanal === "desconectado" ? "desconectado" : "sem-fonte", atualizadoEm: null };
  if (statusCanal === "desconectado") return { fonte: f, estado: "desconectado", atualizadoEm: ultimaColeta };
  if (temErro) return { fonte: f, estado: "erro", atualizadoEm: ultimaColeta };
  return { fonte: f, estado: ultimaColeta ? "conectado" : "conectando", atualizadoEm: ultimaColeta };
}

/** Clientes ativos de mídia (ou com canal cadastrado), com o estado de cada fonte. Problemas primeiro. */
export async function canaisPorCliente(): Promise<CanalPorCliente[]> {
  const rows = await rawQuery<{
    id: string; name: string; kind: string; status: string | null; ads_source: string | null; ig_source: string | null;
    last_sync_at: string | null; ads_erro: boolean; ig_last_sync_at: string | null; ig_erro: boolean;
  }>(
    `select cl.id, cl.name, cl.kind, ch.status, ch.ads_source, ch.ig_source, ch.last_sync_at, (ch.last_error is not null) as ads_erro,
            ch.ig_last_sync_at, (ch.ig_last_error is not null) as ig_erro
       from avanteza.clients cl
       left join avanteza.client_channels ch on ch.client_id = cl.id and ch.provider = 'meta'
      where cl.active and (ch.id is not null or cl.kind in ('midia','ambos'))
      order by cl.name`,
  );
  const peso: Record<EstadoFonte, number> = { erro: 0, desconectado: 1, conectando: 2, "sem-fonte": 3, conectado: 4 };
  return rows
    .map((r) => ({
      clientId: r.id, cliente: r.name, tipo: r.kind,
      anuncios: estadoFonte(r.ads_source, r.status, r.last_sync_at, r.ads_erro),
      instagram: estadoFonte(r.ig_source, r.status, r.ig_last_sync_at, r.ig_erro),
    }))
    .sort((a, b) => Math.min(peso[a.anuncios.estado], peso[a.instagram.estado]) - Math.min(peso[b.anuncios.estado], peso[b.instagram.estado]) || a.cliente.localeCompare(b.cliente, "pt-BR"));
}
