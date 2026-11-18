// Mapa → Canais → Google (Perfil da Empresa) e o resumo do Início. Componentes de servidor sobre RelGoogle: só o que veio dos
// snapshots; nunca ids de avaliação nem nome completo de quem avaliou (o relatório já entrega só o primeiro nome).
import Link from "next/link";
import { Kpi } from "@/components/dashboards/Kpi";
import { Legenda } from "@/components/dashboards/LineChart";
import { ComboChart } from "./ComboChart";
import { EstrelasGoogle, MarcaRotulo, PinoMaps } from "@/components/brand";
import { compacto, decimal, inteiro } from "@/lib/dashboards/format";
import { ddmmaa } from "@/lib/dashboards/periodo";
import type { CanaisCliente } from "@/lib/channels/cliente";
import type { KpiGoogle, RelGoogle } from "@/lib/channels/gbp-report";
import { SeloFonte, Vazio } from "./Paineis";

export const FONTE_GOOGLE = "Windsor.ai · Perfil da Empresa";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesTxt = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const nota = (v: number | null) => (v == null ? "—" : decimal(v, 1));

function kpiG(label: string, k: KpiGoogle, anterior: string, extra: { sub?: string; spark?: number[]; cor?: "ok" } = {}) {
  return <Kpi label={label} valor={k.atual != null ? inteiro(k.atual) : "—"} indisponivel={k.atual == null} delta={k.atual != null ? { pct: k.variacao, anterior } : undefined} sub={extra.sub} spark={extra.spark} cor={extra.cor} />;
}

/** Linha do local: pino, nome, categoria e bairro, com o link para o Google Maps (só https de google.com/maps.app.goo.gl/g.page). */
function Local({ g }: { g: RelGoogle }) {
  const l = g.local;
  if (!l) return null;
  const onde = [l.categoria, [l.bairro, l.cidade].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return (
    <div className="gbp-local">
      <PinoMaps tamanho={24} />
      <div className="gbp-local-t">
        <b>{l.titulo ?? "Seu perfil no Google"}</b>
        {onde && <span className="small muted">{onde}</span>}
      </div>
      {l.mapsUrl && <a className="small gbp-link" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">Ver no Google Maps ›</a>}
    </div>
  );
}

function NotaResumo({ g, compacta = false }: { g: RelGoogle; compacta?: boolean }) {
  const n = g.nota;
  return (
    <div className={`gbp-nota${compacta ? " compacta" : ""}`}>
      <div className="gbp-nota-v"><b>{nota(n.media)}</b><EstrelasGoogle nota={n.media} tamanho={compacta ? 16 : 20} /></div>
      <span className="small muted">{n.total != null ? `${inteiro(n.total)} avaliações no Google` : "total de avaliações indisponível"}</span>
    </div>
  );
}

export function PainelGoogle({ d }: { d: CanaisCliente }) {
  const g = d.google;
  const { anterior: ant } = d.periodo;
  if (!d.estado.google) return <Vazio titulo="Google não conectado" texto="O seu Perfil da Empresa no Google ainda não foi ligado. Quando for, visualizações no Maps e na Pesquisa, rotas, ligações e avaliações aparecem aqui." />;
  if (!d.estado.googleConectado || !g) return <Vazio titulo="Conectando o Google" texto="Estamos ligando o seu Perfil da Empresa no Google. Quando a conexão terminar, os números aparecem aqui automaticamente. Não é preciso fazer nada agora." />;
  const selo = <SeloFonte fonte={FONTE_GOOGLE} marca="google" quando={d.estado.googleAtualizadoEm} problema={d.estado.googleComProblema} />;
  if (!g.temDados) return <>{selo}<Vazio titulo="Coletando dados do Google" texto="A conexão está feita, mas ainda não chegaram números do perfil. Eles aparecem após a próxima atualização." /></>;
  const anteriorTxt = `${ddmmaa(ant.de)} a ${ddmmaa(ant.ate)}`;
  const maxSup = Math.max(...g.superficies.map((s) => s.valor), 1);
  const maxEst = Math.max(...g.nota.porEstrela, 1);
  return (
    <>
      <h2 style={{ marginTop: 14 }}><MarcaRotulo marca="google" tamanho={24}>Google · Perfil da Empresa</MarcaRotulo></h2>
      {selo}
      <div className="card gbp-topo" style={{ marginTop: 12 }}>
        <Local g={g} />
        <NotaResumo g={g} />
      </div>
      <div className="grid kpis k3" style={{ marginTop: 12 }}>
        {kpiG("Visualizações do perfil", g.visualizacoes, anteriorTxt, { sub: `Maps ${inteiro(g.maps.atual ?? 0)} · Pesquisa ${inteiro(g.pesquisa.atual ?? 0)}`, spark: g.serie.map((s) => s.visualizacoes) })}
        {kpiG("Pedidos de rota", g.rotas, anteriorTxt, { sub: "quem pediu o caminho até a barbearia", cor: "ok" })}
        {kpiG("Ligações", g.ligacoes, anteriorTxt, { sub: "toques em “Ligar”" })}
        {kpiG("Cliques no site", g.site, anteriorTxt)}
        {g.conversas && kpiG("Conversas", g.conversas, anteriorTxt)}
        {g.reservas && kpiG("Reservas", g.reservas, anteriorTxt)}
        <Kpi label="Avaliações no período" valor={inteiro(g.nota.noPeriodo)} sub={g.nota.mediaNoPeriodo != null ? `nota média ${nota(g.nota.mediaNoPeriodo)} no período` : "nenhuma avaliação no período"} />
      </div>

      <div className="grid dsplit equal" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="row"><h3>Visualizações × ações por dia</h3><Legenda itens={[{ nome: "Visualizações", cor: "orange" }, { nome: "Rotas + ligações + site", cor: "heading" }]} /></div>
          <ComboChart titulo="Visualizações do perfil e ações por dia" datas={g.serie.map((s) => s.data)} barras={{ nome: "Visualizações", valores: g.serie.map((s) => s.visualizacoes), formato: "inteiro" }} linha={{ nome: "Ações", valores: g.serie.map((s) => s.acoes), formato: "inteiro" }} />
        </div>
        <div className="card">
          <h3>Onde viram o seu perfil</h3>
          <ul className="aud-list gbp-sup">
            {g.superficies.map((s) => (
              <li key={s.id}>
                <span className="aud-r">{s.rotulo}</span>
                <span className="aud-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (s.valor / maxSup) * 100)}%` }} /></span>
                <b>{inteiro(s.valor)} <span className="small muted">({decimal(s.pct, 0)}%)</span></b>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: "10px 0 0" }}>Visualizações únicas por dia em cada superfície do Google (Maps e Pesquisa, no celular e no computador).</p>
        </div>
      </div>

      <h2>Avaliações</h2>
      <div className="grid dsplit equal">
        <div className="card">
          <h3>Nota no Google</h3>
          <NotaResumo g={g} />
          <ul className="aud-list" style={{ marginTop: 12 }} aria-label="Avaliações do período por estrelas">
            {[5, 4, 3, 2, 1].map((e) => (
              <li key={e}>
                <span className="aud-r">{e} {e === 1 ? "estrela" : "estrelas"}</span>
                <span className="aud-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (g.nota.porEstrela[e - 1] / maxEst) * 100)}%` }} /></span>
                <b>{inteiro(g.nota.porEstrela[e - 1])}</b>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: "10px 0 0" }}>
            {inteiro(g.nota.noPeriodo)} {g.nota.noPeriodo === 1 ? "avaliação" : "avaliações"} no período
            {g.nota.semResposta > 0 ? <> · <b className="gbp-sem">{inteiro(g.nota.semResposta)} sem resposta</b></> : g.nota.noPeriodo ? " · todas respondidas" : ""}.
          </p>
          {g.local?.avaliarUrl && <a className="small gbp-link" href={g.local.avaliarUrl} target="_blank" rel="noopener noreferrer">Link para pedir avaliação aos clientes ›</a>}
        </div>
        <div className="card">
          <h3>Buscas que levaram ao perfil</h3>
          {g.buscas.itens.length === 0 ? <div className="empty chart-empty">O Google ainda não liberou os termos de busca deste período.</div> : (
            <ul className="gbp-buscas">
              {g.buscas.itens.map((b) => (
                <li key={b.termo}>
                  <span>{b.termo}</span>
                  <span className="gbp-bv">{b.valor != null ? <b>{inteiro(b.valor)}</b> : <span className="small muted">poucas buscas</span>}{b.valor != null && b.anterior != null && g.buscas.mesAnterior && <span className="small muted"> · {inteiro(b.anterior)} em {mesTxt(g.buscas.mesAnterior)}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {g.buscas.mes && <p className="small muted" style={{ margin: "10px 0 0" }}>Buscas de {mesTxt(g.buscas.mes)}{g.buscas.parcial ? " (mês em andamento)" : ""}: o Google só informa o total do mês. Termos com poucas buscas aparecem sem número, porque o Google não divulga.</p>}
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>Avaliações recentes</h3>
      {g.avaliacoes.length === 0 ? <Vazio titulo="Ainda sem avaliações guardadas" texto="As avaliações novas aparecem aqui a partir da próxima atualização." /> : (
        <div className="rev-grid">
          {g.avaliacoes.map((r) => (
            <article key={r.id} className={`card rev${r.resposta ? "" : " sem-resp"}`} aria-label={`Avaliação de ${r.autor}`}>
              <div className="rev-top">
                <span className="rev-autor"><span className="rev-ini" aria-hidden="true">{r.autor.slice(0, 1).toUpperCase()}</span><b>{r.autor}</b></span>
                <span className="small muted">{ddmmaa(r.data)}</span>
              </div>
              <EstrelasGoogle nota={r.estrelas} />
              {r.comentario ? <p className="rev-txt">{r.comentario}</p> : <p className="rev-txt muted small">Deixou só a nota, sem comentário.</p>}
              {r.resposta ? (
                <div className="rev-resp"><span className="dest-lab">Resposta da empresa</span><p>{r.resposta}</p></div>
              ) : <span className="pill pill-danger" style={{ alignSelf: "flex-start" }}>Sem resposta</span>}
            </article>
          ))}
        </div>
      )}
      <p className="small muted">Quem avaliou aparece só pelo primeiro nome. Responder as avaliações (principalmente as sem resposta) ajuda o perfil a aparecer mais no Google.</p>
    </>
  );
}

/** Bloco do Google na página Início (Mídia e tráfego). */
export function InicioGoogle({ d, anteriorTxt }: { d: CanaisCliente; anteriorTxt: string }) {
  const g = d.google;
  const cab = (titulo: string, selo?: React.ReactNode) => <><div className="row"><h3><MarcaRotulo marca="google" tamanho={24}>{titulo}</MarcaRotulo></h3></div>{selo}</>;
  if (!d.estado.google) return null;
  if (!d.estado.googleConectado || !g) return <div className="card midia-fonte">{cab("Conectando o Google")}<p className="muted small midia-vazio">Estamos ligando o seu Perfil da Empresa. Os números aparecem aqui automaticamente quando a conexão terminar.</p></div>;
  const selo = <SeloFonte fonte={FONTE_GOOGLE} marca="google" quando={d.estado.googleAtualizadoEm} problema={d.estado.googleComProblema} />;
  if (!g.temDados) return <div className="card midia-fonte">{cab("Google · Perfil da Empresa", selo)}<p className="muted small midia-vazio">Conexão feita; os números chegam na próxima atualização.</p></div>;
  return (
    <div className="card midia-fonte">
      {cab("Google · Perfil da Empresa", selo)}
      <div className="grid kpis k4" style={{ marginTop: 12 }}>
        {kpiG("Visualizações", g.visualizacoes, anteriorTxt, { sub: `Maps ${compacto(g.maps.atual ?? 0)} · Pesquisa ${compacto(g.pesquisa.atual ?? 0)}`, spark: g.serie.map((s) => s.visualizacoes) })}
        {kpiG("Rotas", g.rotas, anteriorTxt, { cor: "ok" })}
        {kpiG("Ligações", g.ligacoes, anteriorTxt)}
        <Kpi label="Nota no Google" valor={nota(g.nota.media)} indisponivel={g.nota.media == null} sub={`${g.nota.total != null ? `${inteiro(g.nota.total)} avaliações` : "total indisponível"}${g.nota.noPeriodo ? ` · ${inteiro(g.nota.noPeriodo)} no período` : ""}`} />
      </div>
      {g.nota.semResposta > 0 && <p className="small" style={{ margin: "10px 0 0" }}><span className="pill pill-danger">{inteiro(g.nota.semResposta)} {g.nota.semResposta === 1 ? "avaliação sem resposta" : "avaliações sem resposta"}</span> <Link className="gbp-link" href="/mapa/canais?aba=google">ver avaliações ›</Link></p>}
    </div>
  );
}
