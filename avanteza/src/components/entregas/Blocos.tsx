// Blocos de leitura do Funil de Entrega (servidor): aviso de fonte, lista de clientes, renovações, modelos e gatilhos.
import Link from "next/link";
import type { ReactNode } from "react";
import { GlassCard } from "@/components/shell/GlassCard";
import type { Fonte } from "@/lib/entregas";
import { ROTULO_PILAR, ROTULO_STATUS, type EntregaResumo, type Gatilhos, type Modelo, type Pilar, type Renovacao, type StatusEntrega } from "@/lib/entregas/crm";
import { fmtDia, moeda } from "@/lib/entregas/forms";
import type { ClienteMapa } from "@/lib/entregas/mapa";
import { entregasForm } from "@/app/(equipe)/operacoes/entregas/actions";

export function FonteAviso({ f }: { f: Fonte<unknown> }) {
  if (f.estado === "ok") return null;
  return (
    <div className="notice danger" role="status" style={{ marginTop: 12 }}>
      <b>{f.estado === "nao-configurado" ? "Funil de Entrega não configurado" : "CRM indisponível"}</b>
      <p className="small muted" style={{ margin: "4px 0 0" }}>{f.motivo} Os dados voltam quando a conexão normalizar; nada foi perdido.</p>
    </div>
  );
}

export const SaudeChip = ({ r, nota }: { r: "SAUDAVEL" | "ATENCAO" | "EM_RISCO"; nota: number }) => (
  <span className={`ent-saude ${r}`}>{r === "SAUDAVEL" ? "Saudável" : r === "ATENCAO" ? "Atenção" : "Em risco"} · {nota}</span>
);

export function LinkMapa({ c }: { c?: ClienteMapa }) {
  if (!c) return null;
  return <Link href={`/clientes/${c.id}?aba=plano`} className="small">Abrir no Mapa ›</Link>;
}

export function Clientes({ entregas, mapa }: { entregas: EntregaResumo[]; mapa: Map<string, ClienteMapa> }) {
  if (entregas.length === 0) return <GlassCard className="empty" style={{ marginTop: 12 }}>Nenhuma entrega neste filtro. A entrega abre sozinha quando uma oportunidade é ganha no CRM.</GlassCard>;
  return (
    <div className="ent-lista">
      {entregas.map((e) => (
        <GlassCard key={e.id} className="ent-cli">
          <div className="topo">
            <div style={{ minWidth: 0 }}>
              <h3><Link href={`/operacoes/entregas/${encodeURIComponent(e.id)}`} style={{ color: "inherit", textDecoration: "none" }}>{e.contato.nome}</Link></h3>
              <div className="sub">{e.nome}</div>
            </div>
            <SaudeChip r={e.saude.rotulo} nota={e.saude.nota} />
          </div>
          <div className="prog"><div className="progress thin" role="progressbar" aria-valuenow={e.saude.progresso} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da entrega"><span style={{ width: `${e.saude.progresso}%` }} /></div><span>{e.saude.concluidos}/{e.saude.total}</span></div>
          <div className="meta">
            {e.valorMensal > 0 && <span>{moeda(e.valorMensal)}/mês</span>}
            {e.saude.atrasados > 0 && <span className="ent-late">{e.saude.atrasados} atrasado(s)</span>}
            {e.saude.esperandoCliente > 0 && <span>{e.saude.esperandoCliente} esperando o cliente</span>}
            {e.renovacaoEm && (e.saude.renovacaoProxima ? <span className="ent-ren">Renova em {Math.max(0, e.saude.diasParaRenovar ?? 0)} dia(s)</span> : <span>Renova em {fmtDia(e.renovacaoEm)}</span>)}
          </div>
          <div className="btn-row" style={{ alignItems: "center" }}>
            <Link className="btn btn-ghost btn-sm" href={`/operacoes/entregas/${encodeURIComponent(e.id)}`}>Abrir entrega</Link>
            <Link className="btn btn-ghost btn-sm" href={`/operacoes/entregas?q=${encodeURIComponent(e.contato.nome)}`}>Ver no quadro</Link>
            <LinkMapa c={mapa.get(e.contato.id)} />
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

export function Renovacoes({ itens, crmUrl, mapa }: { itens: Renovacao[]; crmUrl: string; mapa: Map<string, ClienteMapa> }) {
  if (itens.length === 0) return <GlassCard className="empty" style={{ marginTop: 12 }}>Nenhuma renovação nos próximos 60 dias.</GlassCard>;
  return (
    <GlassCard className="ent-scroll" style={{ marginTop: 12 }}>
      <table className="ent-tab">
        <thead><tr><th>Cliente</th><th>Renova em</th><th className="num">Prazo</th><th className="num">Mensal</th><th>Renovação no CRM</th></tr></thead>
        <tbody>
          {itens.map((r) => (
            <tr key={r.entregaId}>
              <td><Link href={`/operacoes/entregas/${encodeURIComponent(r.entregaId)}`}><b>{r.contato.nome}</b></Link><div className="small muted">{r.nome}</div><LinkMapa c={mapa.get(r.contato.id)} /></td>
              <td>{fmtDia(r.renovacaoEm)}</td>
              <td className="num">{r.diasParaRenovar < 0 ? <span className="ent-late">venceu há {-r.diasParaRenovar} d</span> : r.diasParaRenovar <= 30 ? <span className="ent-ren">{r.diasParaRenovar} dias</span> : `${r.diasParaRenovar} dias`}</td>
              <td className="num">{moeda(r.valorMensal)}</td>
              <td>{r.renovacaoOportunidadeId ? <a href={`${crmUrl}/oportunidades?abrir=${encodeURIComponent(r.renovacaoOportunidadeId)}`} target="_blank" rel="noreferrer" className="pill pill-ok">Oportunidade aberta ›</a> : <span className="pill pill-outline">Abre 60 dias antes</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  );
}

function Acao({ op, campos, rotulo, voltar, perigo }: { op: string; campos: Record<string, string>; rotulo: string; voltar: string; perigo?: boolean }) {
  return (
    <form action={entregasForm}>
      <input type="hidden" name="op" value={op} /><input type="hidden" name="voltar" value={voltar} />
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={`btn btn-sm ${perigo ? "btn-danger" : "btn-ghost"}`} type="submit">{rotulo}</button>
    </form>
  );
}

export function ModelosEGatilhos({ modelos, gatilhos, podeEscrever, voltar }: { modelos: Fonte<Modelo[]>; gatilhos: Fonte<Gatilhos>; podeEscrever: boolean; voltar: string }) {
  return (
    <>
      <div className="ent-bloco">
        <h2>Modelos de entrega</h2>
        <p className="small muted" style={{ margin: "0 0 8px" }}>O modelo padrão vira os cartões da entrega quando uma oportunidade é ganha no CRM. Os itens são editados no CRM (Configuração).</p>
        <FonteAviso f={modelos} />
        {modelos.estado === "ok" && modelos.dados.length === 0 && <GlassCard className="empty">Nenhum modelo cadastrado.</GlassCard>}
        {modelos.estado === "ok" && modelos.dados.map((m) => (
          <GlassCard key={m.id} style={{ marginTop: 10 }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0 }}>{m.nome} {m.padrao && <span className="pill pill-orange">Padrão</span>} {!m.ativo && <span className="pill pill-outline">Inativo</span>}</h3>
                {m.descricao && <p className="small muted" style={{ margin: "4px 0 0" }}>{m.descricao}</p>}
              </div>
              {podeEscrever && (
                <div className="btn-row">
                  {!m.padrao && m.ativo && <Acao op="modelo.padrao" campos={{ modeloId: m.id }} rotulo="Tornar padrão" voltar={voltar} />}
                  {m.ativo && <Acao op="modelo.desativar" campos={{ modeloId: m.id }} rotulo="Desativar" voltar={voltar} perigo />}
                </div>
              )}
            </div>
            <ul className="ent-itens">
              {m.itens.map((i) => (
                <li key={i.id}><span className="pill pill-outline">{ROTULO_PILAR[i.pilar as Pilar] ?? i.pilar}</span><span>{i.titulo}</span>{i.prazoDias !== null && <span className="muted small">em {i.prazoDias} d</span>}{i.cliente && <span className="pill pill-sand">Do cliente</span>}</li>
              ))}
            </ul>
          </GlassCard>
        ))}
      </div>
      <div className="ent-bloco">
        <div className="row"><h2>Gatilhos da entrega</h2>
          {podeEscrever && <Acao op="rotina.executar" campos={{}} rotulo="Executar rotina agora" voltar={voltar} />}
        </div>
        <p className="small muted" style={{ margin: "0 0 8px" }}>Automações do CRM ligadas a eventos da entrega (cartão atrasado, cliente parado, renovação chegando…). A rotina diária distribui responsáveis, planeja a semana, conclui entregas e abre a renovação 60 dias antes.</p>
        <FonteAviso f={gatilhos} />
        {gatilhos.estado === "ok" && gatilhos.dados.automacoes.length === 0 && <GlassCard className="empty">Nenhuma automação de entrega cadastrada.</GlassCard>}
        {gatilhos.estado === "ok" && gatilhos.dados.automacoes.length > 0 && (
          <GlassCard className="ent-scroll">
            <table className="ent-tab">
              <thead><tr><th>Automação</th><th>Gatilho</th><th>Situação</th><th className="num">Últimos 30 dias</th></tr></thead>
              <tbody>
                {gatilhos.dados.automacoes.map((a) => {
                  const total = Object.values(a.execucoes30d).reduce((s, v) => s + v, 0);
                  return (
                    <tr key={a.id}>
                      <td><b>{a.nome}</b></td><td>{a.rotuloGatilho}</td>
                      <td>{a.ativo ? <span className="pill pill-ok">Ativa</span> : <span className="pill pill-outline">Pausada</span>}</td>
                      <td className="num">{total ? `${a.execucoes30d.EXECUTADA ?? 0} executadas de ${total}` : "nenhuma"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>
        )}
      </div>
    </>
  );
}

export const rotuloStatus = (s: string) => ROTULO_STATUS[s as StatusEntrega] ?? s;
export const Linha = ({ children }: { children: ReactNode }) => <div className="ent-linha">{children}</div>;
