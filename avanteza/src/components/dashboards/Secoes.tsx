// Seções do painel Dashboards (servidor). Cada seção lida com o estado da própria fonte: ok, sem dados, indisponível ou não configurada.
import type { Dashboards } from "@/lib/dashboards";
import type { BlocoVendedoria, MetricasVendedoria } from "@/lib/dashboards/vendedoria";
import { custoPorLead, resultados, roas, type MetaResultado } from "@/lib/dashboards/meta";
import { ddmm, ddmmaa, variacaoPct } from "@/lib/dashboards/periodo";
import { brl, brlCompacto, compacto, hora, inteiro, percentual, vezes } from "@/lib/dashboards/format";
import { Kpi, type DeltaProps } from "./Kpi";
import { LineChart, Legenda } from "./LineChart";
import { HBars, type ItemBarra } from "./HBars";
import type { CanaisClientesDash } from "@/lib/channels/dashboards";

const dlt = (atual: number | null | undefined, ant: number | null | undefined, rotuloAnt: string, inverso = false): DeltaProps => ({
  pct: variacaoPct(atual, ant), inverso, anterior: rotuloAnt,
});

function Aviso({ titulo, texto, tipo = "danger" }: { titulo: string; texto: string; tipo?: "danger" | "" }) {
  return (
    <div className={`notice ${tipo}`} role="status">
      <b>{titulo}</b>
      <p className="small muted" style={{ margin: "4px 0 0" }}>{texto}</p>
    </div>
  );
}

const SEC = (props: { titulo: string; sub?: string; children: React.ReactNode }) => (
  <section className="dsec" aria-label={props.titulo}>
    <h2>{props.titulo}</h2>
    {props.sub && <p className="small muted dsub">{props.sub}</p>}
    {props.children}
  </section>
);

// ─── Status das fontes ───────────────────────────────────────────────────────
export function StatusFontes({ d }: { d: Dashboards }) {
  const v = d.vendas, m = d.meta;
  const pill = (nome: string, f: Dashboards["vendas"] | Dashboards["meta"], vazio = false) => {
    if (f.estado === "ok") return <span className={`pill ${f.desatualizado || vazio ? "pill-outline" : "pill-ok"}`}>{nome}: {f.desatualizado ? "desatualizado" : vazio ? "sem dados" : "ok"} · {hora(f.geradoEm)}</span>;
    return <span className="pill pill-danger">{nome}: {f.estado === "nao-configurado" ? "não configurado" : "indisponível"}</span>;
  };
  return (
    <div className="fontes" aria-label="Estado das fontes de dados">
      {pill("Vendedor IA", v)}
      {pill("Meta Ads", m, m.estado === "ok" && m.dados.semDados)}
    </div>
  );
}

// ─── Comercial ───────────────────────────────────────────────────────────────
const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const serie = (b: BlocoVendedoria, k: "leadsNovos" | "ganhos" | "vendas" | "receitas" | "despesas") => b.series.map((p) => p[k]);

function ComercialOk({ d, v }: { d: Dashboards; v: MetricasVendedoria }) {
  const a = v.atual, p = v.anterior;
  const ra = `Anterior: ${ddmm(p.periodo.from)} a ${ddmm(p.periodo.to)}`;
  const etapas: ItemBarra[] = a.leads.porEtapa.map((e) => ({
    rotulo: e.etapa, valor: e.quantidade, texto: inteiro(e.quantidade),
    cor: e.tipo === "GANHO" ? "ok" : ["LOST", "DESCARTADO", "JUNK"].includes(e.tipo) ? "danger" : "orange",
  }));
  const datas = a.series.map((x) => x.data);
  return (
    <>
      <div className="grid kpis auto">
        <Kpi label="Vendas" valor={inteiro(a.vendas.quantidade)} delta={dlt(a.vendas.quantidade, p.vendas.quantidade, ra)}
          sub={a.vendas.quantidade ? `${brl(a.vendas.valor)} · ticket ${brl(a.vendas.ticketMedio)}` : "negócios fechados"} spark={serie(a, "ganhos")} />
        <Kpi label="Leads novos" valor={inteiro(a.leads.novos)} delta={dlt(a.leads.novos, p.leads.novos, ra)} sub={`${inteiro(a.leads.perdidos)} perdidos no período`} spark={serie(a, "leadsNovos")} />
        <Kpi label="Conversão lead → cliente" valor={percentual(a.conversao.taxaPct)}
          delta={dlt(a.conversao.taxaPct, p.conversao.taxaPct, ra)} sub={`${inteiro(a.conversao.viraramCliente)} de ${inteiro(a.conversao.leadsDaCoorte)} leads do período`} />
        <Kpi label="CAC" valor={d.cac.valor != null ? brl(d.cac.valor, true) : "—"} indisponivel={d.cac.valor == null}
          delta={d.cac.valor != null ? dlt(d.cac.valor, d.cac.anterior, ra, true) : undefined}
          sub={d.cac.valor != null ? "investimento Meta ÷ novos clientes" : d.cac.motivo} />
      </div>
      <div className="grid dsplit">
        <div className="card">
          <div className="row"><h3>Leads e vendas por dia</h3><Legenda itens={[{ nome: "Leads novos", cor: "orange" }, { nome: "Negócios fechados", cor: "ok" }, { nome: "Leads (período anterior)", cor: "muted", tracejado: true }]} /></div>
          <LineChart titulo="Leads novos e negócios fechados por dia" datas={datas} formato="inteiro"
            series={[
              { nome: "Leads novos", valores: serie(a, "leadsNovos"), cor: "orange" },
              { nome: "Negócios fechados", valores: serie(a, "ganhos"), cor: "ok", area: false },
              { nome: "Leads (anterior)", valores: alinhar(serie(p, "leadsNovos"), datas.length), cor: "muted", tracejado: true, area: false },
            ]} />
        </div>
        <div className="card">
          <h3>Leads por etapa do funil</h3>
          <p className="small muted dsub">Onde estão hoje os {inteiro(a.leads.novos)} leads criados no período.</p>
          <HBars itens={etapas} vazio="Nenhum lead novo no período." />
        </div>
      </div>
    </>
  );
}

/** Série do período anterior alinhada ao tamanho do atual (mesmo nº de dias; corta/completa por segurança). */
function alinhar(v: number[], n: number): number[] {
  return Array.from({ length: n }, (_, i) => v[i] ?? 0);
}

export function SecaoComercial({ d }: { d: Dashboards }) {
  return (
    <SEC titulo="Comercial" sub="Vendas, leads e conversão — fonte: Vendedor IA.">
      {d.vendas.estado === "ok" ? <ComercialOk d={d} v={d.vendas.dados} /> : <FonteVendasIndisponivel f={d.vendas} />}
    </SEC>
  );
}

function FonteVendasIndisponivel({ f }: { f: Dashboards["vendas"] }) {
  if (f.estado === "ok") return null;
  return (
    <Aviso
      titulo={f.estado === "nao-configurado" ? "Vendedor IA não configurado" : "Vendedor IA indisponível"}
      texto={`${f.motivo} Vendas, leads, conversão, CAC e todo o financeiro voltam quando a conexão normalizar; o marketing abaixo segue funcionando.`}
    />
  );
}

// ─── Financeiro ──────────────────────────────────────────────────────────────
export function SecaoFinanceiro({ d }: { d: Dashboards }) {
  if (d.vendas.estado !== "ok") {
    return <SEC titulo="Financeiro" sub="Faturamento, receitas, despesas e resultado — escopo Avanteza."><FonteVendasIndisponivel f={d.vendas} /></SEC>;
  }
  const v = d.vendas.dados, a = v.atual, p = v.anterior;
  const ra = `Anterior: ${ddmm(p.periodo.from)} a ${ddmm(p.periodo.to)}`;
  const datas = a.series.map((x) => x.data);
  const cats: ItemBarra[] = a.financeiro.despesasPorCategoria.map((c) => ({ rotulo: c.categoria, valor: c.valor, texto: brl(c.valor), cor: "danger" }));
  const rec: ItemBarra[] = a.financeiro.receitasPorCategoria.map((c) => ({ rotulo: c.categoria, valor: c.valor, texto: brl(c.valor), cor: "ok" }));
  return (
    <SEC titulo="Financeiro" sub={`Escopo: empresa Avanteza (nunca o pessoal). ${v.escopo.observacao.startsWith("Dados simulados") ? v.escopo.observacao : ""}`.trim()}>
      <div className="grid kpis auto">
        <Kpi label="Faturamento" valor={brlCompacto(a.faturamento.vendido)} delta={dlt(a.faturamento.vendido, p.faturamento.vendido, ra)}
          sub={a.faturamento.contratosRecorrentesNovos ? `${inteiro(a.faturamento.contratosRecorrentesNovos)} contratos recorrentes novos (${brl(a.faturamento.valorMensalRecorrenteNovo)}/mês)` : "valor dos negócios fechados"} spark={serie(a, "vendas")} />
        <Kpi label="Receitas" valor={brlCompacto(a.financeiro.receitas)} delta={dlt(a.financeiro.receitas, p.financeiro.receitas, ra)} sub="recebidas no período" spark={serie(a, "receitas")} cor="ok" />
        <Kpi label="Despesas" valor={brlCompacto(a.financeiro.despesas)} delta={dlt(a.financeiro.despesas, p.financeiro.despesas, ra, true)} sub="pagas no período" spark={serie(a, "despesas")} cor="danger" />
        <Kpi label="Resultado" valor={brlCompacto(a.financeiro.resultado)} delta={dlt(a.financeiro.resultado, p.financeiro.resultado, ra)} sub="receitas − despesas" />
      </div>
      <div className="grid dsplit">
        <div className="card">
          <div className="row"><h3>Receitas e despesas por dia</h3><Legenda itens={[{ nome: "Receitas", cor: "ok" }, { nome: "Despesas", cor: "danger" }]} /></div>
          <LineChart titulo="Receitas e despesas por dia" datas={datas} formato="brl"
            series={[{ nome: "Receitas", valores: serie(a, "receitas"), cor: "ok" }, { nome: "Despesas", valores: serie(a, "despesas"), cor: "danger", area: false }]} />
        </div>
        <div className="card">
          <h3>Despesas por categoria</h3>
          <HBars itens={cats} vazio="Sem despesas no período." />
          {rec.length > 0 && <><h3 style={{ marginTop: 18 }}>Receitas por categoria</h3><HBars itens={rec} /></>}
        </div>
      </div>
    </SEC>
  );
}

// ─── Previstos e contratos ───────────────────────────────────────────────────
function LinhasPrazo({ x }: { x: { proximos30: number; proximos60: number; proximos90: number; atrasado: { total: number; quantidade: number } } }) {
  return (
    <ul className="plist">
      <li><span>Próximos 30 dias</span><b>{brl(x.proximos30)}</b></li>
      <li><span>Próximos 60 dias</span><b>{brl(x.proximos60)}</b></li>
      <li><span>Próximos 90 dias</span><b>{brl(x.proximos90)}</b></li>
      <li className={x.atrasado.total > 0 ? "late" : ""}><span>Em atraso ({inteiro(x.atrasado.quantidade)})</span><b>{brl(x.atrasado.total)}</b></li>
    </ul>
  );
}

export function SecaoPrevistos({ d }: { d: Dashboards }) {
  if (d.vendas.estado !== "ok") {
    return <SEC titulo="Previstos e contratos" sub="Contas a receber e a pagar, projeção e contratos ativos."><FonteVendasIndisponivel f={d.vendas} /></SEC>;
  }
  const { previstos: pv, contratos: c } = d.vendas.dados;
  return (
    <SEC titulo="Previstos e contratos" sub="Retrato de hoje, não depende do período escolhido. Parcelas de contratos existem até 12 meses à frente.">
      <div className="grid quad">
        <div className="card">
          <div className="label dlabel">A receber</div>
          <div className="dbig">{brlCompacto(pv.aReceber.total)}</div>
          <div className="small muted">{inteiro(pv.aReceber.quantidade)} lançamentos · {brl(pv.aReceber.deContratos.total)} de contratos</div>
          <LinhasPrazo x={pv.aReceber} />
        </div>
        <div className="card">
          <div className="label dlabel">A pagar</div>
          <div className="dbig">{brlCompacto(pv.aPagar.total)}</div>
          <div className="small muted">{inteiro(pv.aPagar.quantidade)} contas</div>
          <LinhasPrazo x={pv.aPagar} />
        </div>
        <div className="card">
          <div className="label dlabel">Projeção (a receber − a pagar)</div>
          <div className={`dbig ${pv.saldoProjetado30 < 0 ? "down" : ""}`}>{brlCompacto(pv.saldoProjetado30)}</div>
          <div className="small muted">em 30 dias</div>
          <ul className="plist">
            <li><span>Em 90 dias</span><b className={pv.saldoProjetado90 < 0 ? "down" : ""}>{brl(pv.saldoProjetado90)}</b></li>
          </ul>
          <HBars itens={[
            { rotulo: "A receber (90 dias)", valor: pv.aReceber.proximos90, texto: brlCompacto(pv.aReceber.proximos90), cor: "ok" },
            { rotulo: "A pagar (90 dias)", valor: pv.aPagar.proximos90, texto: brlCompacto(pv.aPagar.proximos90), cor: "danger" },
          ]} vazio="Nada previsto." />
        </div>
        <div className="card">
          <div className="label dlabel">Contratos ativos</div>
          <div className="dbig">{inteiro(c.ativos)}</div>
          <div className="small muted">{inteiro(c.recorrentes)} recorrentes · {inteiro(c.parcelados)} parcelados</div>
          <ul className="plist">
            <li><span>Recorrente por mês</span><b>{brl(c.valorMensalRecorrente)}</b></li>
            <li><span>Parcelados a receber</span><b>{brl(c.saldoAReceberParcelados)}</b></li>
          </ul>
        </div>
      </div>
    </SEC>
  );
}

// ─── Marketing (Meta) ────────────────────────────────────────────────────────
function MarketingOk({ m }: { m: MetaResultado }) {
  const a = m.atual, p = m.anterior;
  const ra = "Período anterior";
  const datas = m.serie.map((x) => x.data);
  const cpl = custoPorLead(a), cplAnt = custoPorLead(p);
  const rs = roas(a), rsAnt = roas(p);
  const maxGasto = Math.max(...m.campanhas.map((c) => c.gasto), 1);
  return (
    <>
      {m.avisos.length > 0 && (
        <ul className="avisos" aria-label="Avisos da Meta">{m.avisos.map((t) => <li key={t} className="small muted">⚠ {t}</li>)}</ul>
      )}
      {a && (
        <div className="grid kpis auto">
          <Kpi label="Investimento" valor={brl(a.gasto, a.gasto < 1000)} delta={dlt(a.gasto, p?.gasto, ra)} spark={m.serie.map((s) => s.gasto)} sub={m.moeda !== "BRL" ? m.moeda : undefined} />
          <Kpi label="Impressões" valor={compacto(a.impressoes)} delta={dlt(a.impressoes, p?.impressoes, ra)} />
          <Kpi label="Alcance" valor={compacto(a.alcance)} delta={dlt(a.alcance, p?.alcance, ra)} sub={m.contas.filter((c) => c.somada).length > 1 ? "soma entre contas" : undefined} />
          <Kpi label="Cliques" valor={compacto(a.cliques)} delta={dlt(a.cliques, p?.cliques, ra)} spark={m.serie.map((s) => s.cliques)} />
          <Kpi label="CTR" valor={percentual(a.ctr, 2)} delta={dlt(a.ctr, p?.ctr, ra)} sub="cliques ÷ impressões" />
          <Kpi label="CPC" valor={a.cpc != null ? brl(a.cpc, true) : "—"} delta={dlt(a.cpc, p?.cpc, ra, true)} sub="custo por clique" />
          <Kpi label="Leads e conversas" valor={inteiro(resultados(a))} delta={dlt(resultados(a), p ? resultados(p) : null, ra)} sub={`${inteiro(a.leads)} formulários · ${inteiro(a.conversas)} conversas`} spark={m.serie.map((s) => s.resultados)} />
          <Kpi label="Custo por lead" valor={cpl != null ? brl(cpl, true) : "—"} delta={dlt(cpl, cplAnt, ra, true)} indisponivel={cpl == null} sub={cpl == null ? "sem leads no período" : undefined} />
          <Kpi label="ROAS" valor={rs != null ? vezes(rs) : "—"} delta={rs != null ? dlt(rs, rsAnt, ra) : undefined} indisponivel={rs == null}
            sub={rs != null ? `${brl(a.valorCompras)} em compras (${inteiro(a.compras)})` : "sem valor de conversão"} />
        </div>
      )}
      <div className="grid dsplit equal">
        <div className="card">
          <div className="row"><h3>Investimento por dia</h3><Legenda itens={[{ nome: "Investimento", cor: "orange" }]} /></div>
          <LineChart titulo="Investimento da Meta por dia" datas={datas} formato="brl" series={[{ nome: "Investimento", valores: m.serie.map((s) => s.gasto), cor: "orange" }]} />
        </div>
        <div className="card">
          <div className="row"><h3>Leads e conversas por dia</h3><Legenda itens={[{ nome: "Leads e conversas", cor: "ok" }]} /></div>
          <LineChart titulo="Leads e conversas da Meta por dia" datas={datas} formato="inteiro" series={[{ nome: "Leads e conversas", valores: m.serie.map((s) => s.resultados), cor: "ok" }]} />
        </div>
      </div>
      <div className="card">
        <h3>Ranking de campanhas</h3>
        <p className="small muted dsub">Por investimento no período.</p>
        {m.campanhas.length === 0 ? <div className="empty" role="status">Nenhuma campanha com entrega no período.</div> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Campanha</th><th className="num">Investimento</th><th className="num">Impressões</th><th className="num">Cliques</th><th className="num">CTR</th><th className="num">Leads</th><th className="num">CPL</th></tr></thead>
              <tbody>
                {m.campanhas.map((c) => (
                  <tr key={`${c.conta}${c.id}`}>
                    <td>
                      <div className="ctitle">{c.nome}</div>
                      {m.contas.length > 1 && <div className="small muted">{c.conta}</div>}
                      <div className="rank-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, (c.gasto / maxGasto) * 100)}%` }} /></div>
                    </td>
                    <td className="num">{brl(c.gasto, true)}</td><td className="num">{compacto(c.impressoes)}</td><td className="num">{inteiro(c.cliques)}</td>
                    <td className="num">{percentual(c.ctr, 2)}</td><td className="num">{inteiro(c.resultados)}</td><td className="num">{c.custoPorResultado != null ? brl(c.custoPorResultado, true) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {m.contas.length > 1 && (
        <div className="card">
          <h3>Por conta de anúncio</h3>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Conta</th><th>Situação</th><th className="num">Investimento</th><th className="num">Leads</th><th className="num">CPL</th><th className="num">CTR</th></tr></thead>
              <tbody>
                {m.contas.map((c) => (
                  <tr key={c.id}>
                    <td><div className="ctitle">{c.nome}</div><div className="small muted mono">{c.id}</div></td>
                    <td>{!c.ok ? <span className="pill pill-danger" title={c.erro}>Erro</span> : c.semDados ? <span className="pill pill-outline">Sem dados</span> : c.status === 1 ? <span className="pill pill-ok">Ativa</span> : <span className="pill pill-outline">{c.statusRotulo}</span>}{!c.ok && <div className="small muted">{c.erro}</div>}{c.ok && !c.somada && <div className="small muted">fora dos totais (moeda {c.moeda})</div>}</td>
                    <td className="num">{c.atual ? brl(c.atual.gasto, true) : "—"}</td>
                    <td className="num">{c.atual ? inteiro(resultados(c.atual)) : "—"}</td>
                    <td className="num">{c.atual && custoPorLead(c.atual) != null ? brl(custoPorLead(c.atual), true) : "—"}</td>
                    <td className="num">{c.atual ? percentual(c.atual.ctr, 2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export function SecaoMarketing({ d }: { d: Dashboards }) {
  const m = d.meta;
  return (
    <SEC titulo="Marketing" sub="Meta Ads (Marketing API, somente leitura) — dados em cache por cerca de 15 minutos.">
      {m.estado === "nao-configurado" ? (
        <Aviso titulo="Meta sem dados" texto={`${m.motivo} Configure META_ACCESS_TOKEN no ambiente para ver investimento, alcance, cliques, leads e campanhas.`} />
      ) : m.estado === "indisponivel" ? (
        <Aviso titulo="Meta indisponível" texto={`${m.motivo} O restante do painel não depende da Meta, exceto o CAC.`} />
      ) : m.dados.semDados ? (
        <>
          <Aviso titulo="Meta sem dados no período" tipo="" texto={`Nenhuma conta de anúncios teve entrega entre ${ddmmaa(d.periodo.atual.de)} e ${ddmmaa(d.periodo.atual.ate)}. ${m.dados.contas.length ? `Contas consultadas: ${m.dados.contas.map((c) => `${c.nome} (${c.statusRotulo.toLowerCase()})`).join(", ")}.` : "Nenhuma conta de anúncios encontrada para o token."}`} />
          {m.dados.avisos.length > 0 && <ul className="avisos">{m.dados.avisos.map((t) => <li key={t} className="small muted">⚠ {t}</li>)}</ul>}
        </>
      ) : (
        <>
          {m.desatualizado && <Aviso titulo="Mostrando o último dado guardado" tipo="" texto={`A Meta não respondeu agora; estes números são de ${hora(m.geradoEm)}.`} />}
          <MarketingOk m={m.dados} />
        </>
      )}
    </SEC>
  );
}


/** Canais dos clientes (Meta somente leitura). Subtotal separado: contas já lidas pela Meta da agência não são somadas de novo. */
export function SecaoCanaisClientes({ c }: { c: CanaisClientesDash | null }) {
  if (!c || c.linhas.length === 0) return null;
  const rot = { somada: "Somada ao subtotal", "ja-na-agencia": "Já está na Meta da agência (não somada)", incerto: "Meta da agência indisponível (não somada)" } as const;
  return (
    <SEC titulo="Canais dos clientes" sub="Contas de anúncios conectadas na aba Canais de cada cliente. Conta que já aparece na Meta da agência acima não é somada de novo.">
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Cliente</th><th className="num">Investimento</th><th className="num">Resultados</th><th>Situação</th></tr></thead>
            <tbody>
              {c.linhas.map((l) => (
                <tr key={`${l.cliente}${l.conta}`}>
                  <td className="ctitle">{l.cliente}</td>
                  <td className="num">{l.semDados ? "—" : brl(l.gasto, true)}</td>
                  <td className="num">{l.semDados ? "—" : inteiro(l.resultados)}</td>
                  <td><span className={`pill ${l.situacao === "somada" ? "pill-ok" : "pill-outline"}`}>{rot[l.situacao]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>Subtotal fora da agência: <b>{brl(c.gastoSomado, true)}</b> de investimento e <b>{inteiro(c.resultadosSomados)}</b> resultados.</p>
      </div>
    </SEC>
  );
}
