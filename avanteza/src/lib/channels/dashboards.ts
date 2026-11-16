// Canais dos clientes no bloco Marketing da Central. NÃO altera os números da Meta da agência (nem o CAC): aparece como um
// subtotal separado. Regra anti-duplicidade: uma conta de anúncios que já está nas contas lidas com META_ACCESS_TOKEN
// ("jaNaAgencia") fica listada mas NÃO entra no subtotal; se a Meta da agência estiver fora do ar não dá para saber, e a conta
// também fica fora ("incerto"). Dentro dos canais, o mesmo (conta, campanha, dia) nunca é somado duas vezes.
import { rawQuery } from "../db/client";
import type { Fonte } from "../dashboards";
import type { MetaResultado } from "../dashboards/meta";
import type { Intervalo } from "../dashboards/periodo";

export interface LinhaCanalCliente { cliente: string; conta: string; gasto: number; resultados: number; semDados: boolean; situacao: "somada" | "ja-na-agencia" | "incerto" }
export interface CanaisClientesDash { linhas: LinhaCanalCliente[]; gastoSomado: number; resultadosSomados: number }

export function classificar(conta: string, meta: Fonte<MetaResultado>): LinhaCanalCliente["situacao"] {
  if (meta.estado === "nao-configurado") return "somada";
  if (meta.estado !== "ok") return "incerto";
  return meta.dados.contas.some((c) => c.id === conta && c.ok) ? "ja-na-agencia" : "somada";
}

export async function carregarCanaisClientes(periodo: Intervalo, meta: Fonte<MetaResultado>): Promise<CanaisClientesDash> {
  const rows = await rawQuery<{ cliente: string; conta: string; gasto: number; resultados: number; dias: number }>(
    `select cl.name as cliente, ch.ad_account_id as conta,
            coalesce(sum((s.metrics->>'spend')::numeric), 0) as gasto,
            coalesce(sum((s.metrics->>'results')::numeric), 0) as resultados, count(s.date)::int as dias
       from avanteza.client_channels ch
       join avanteza.clients cl on cl.id = ch.client_id
       left join (
         select distinct on (c2.ad_account_id, x.key, x.date) c2.client_id, x.date, x.metrics
           from avanteza.channel_snapshots x join avanteza.client_channels c2 on c2.client_id = x.client_id and c2.provider = 'meta'
          where x.kind = 'campaign_daily' and x.source = 'meta' and x.date between $1::date and $2::date
          order by c2.ad_account_id, x.key, x.date, x.updated_at desc
       ) s on s.client_id = ch.client_id
      where ch.provider = 'meta' and ch.ads_source = 'meta' and ch.ad_account_id is not null and ch.status <> 'desconectado' and cl.active
      group by cl.name, ch.ad_account_id
      order by gasto desc, cliente`,
    [periodo.de, periodo.ate],
  );
  const linhas: LinhaCanalCliente[] = rows.map((r) => ({ cliente: r.cliente, conta: r.conta, gasto: Number(r.gasto), resultados: Number(r.resultados), semDados: r.dias === 0, situacao: classificar(r.conta, meta) }));
  const somadas = linhas.filter((l) => l.situacao === "somada");
  return { linhas, gastoSomado: somadas.reduce((t, l) => t + l.gasto, 0), resultadosSomados: somadas.reduce((t, l) => t + l.resultados, 0) };
}
