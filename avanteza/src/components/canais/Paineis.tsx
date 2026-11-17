// Painéis do Mapa → Canais (componentes de servidor). Só mostram o que veio dos snapshots; sem dado, estado vazio honesto.
import Link from "next/link";
import { Kpi } from "@/components/dashboards/Kpi";
import { LineChart, Legenda } from "@/components/dashboards/LineChart";
import { ComboChart } from "./ComboChart";
import { Imagem } from "./Imagem";
import { IconeTipoMidia, LogoMarca, MarcaRotulo, type Marca } from "@/components/brand";
import { brl, compacto, inteiro, percentual } from "@/lib/dashboards/format";
import { ddmm, ddmmaa, variacaoPct } from "@/lib/dashboards/periodo";
import { ago } from "@/lib/format";
import { ROTULO_FONTE, ROTULO_FONTE_IG } from "@/lib/channels/types";
import type { CanaisCliente } from "@/lib/channels/cliente";
import type { Criativo, FatiaAudiencia, Marco, MidiaIg, RelAudiencia } from "@/lib/channels/report";

type Rotulo = { um: string; plural: string };
const rotuloDe = (c: CanaisCliente): Rotulo => (c.estado.resultado === "conversas" ? { um: "conversa", plural: "Conversas" } : { um: "resultado", plural: "Resultados" });

export function Vazio({ titulo, texto, children }: { titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{titulo}</h3>
      <p className="muted" style={{ margin: "6px 0 0" }}>{texto}</p>
      {children}
    </div>
  );
}

/** Selo discreto de origem: cada painel mostra de onde vieram os números e quando foram atualizados. Nada é misturado entre fontes. */
export function SeloFonte({ fonte, quando, problema, marca }: { fonte: string; quando: string | null; problema?: boolean; marca?: Marca }) {
  return (
    <p className="fonte-selo" aria-label={`Fonte dos dados: ${fonte}`}>
      {marca ? <LogoMarca marca={marca} tamanho={16} /> : <span className="fonte-dot" aria-hidden="true" />}Fonte: {fonte}{quando ? <> · atualizado {ago(quando)}</> : null}
      {problema && <span className="muted"> · última atualização com problema; mostrando os últimos dados guardados</span>}
    </p>
  );
}

export function FontesAguardando({ anuncios = true, instagram = true }: { anuncios?: boolean; instagram?: boolean }) {
  return (
    <Vazio titulo="Conectando fontes de dados" texto="Estamos ligando suas contas de anúncios e redes. Quando a conexão terminar, os números aparecem aqui automaticamente. Não é preciso fazer nada agora.">
      <ul className="list" style={{ marginTop: 12 }}>
        {anuncios && <li><div className="row"><MarcaRotulo marca="meta"><strong>Anúncios (Meta Ads)</strong></MarcaRotulo><span className="pill pill-outline">Aguardando conexão</span></div></li>}
        {instagram && <li><div className="row"><MarcaRotulo marca="instagram"><strong>Instagram</strong></MarcaRotulo><span className="pill pill-outline">Aguardando conexão</span></div></li>}
      </ul>
    </Vazio>
  );
}

// ─── Anúncios ────────────────────────────────────────────────────────────────

function CartaoCriativo({ c, pos, r }: { c: Criativo; pos: number; r: Rotulo }) {
  const codigo = c.nome.split("|")[0].trim().slice(0, 4) || "Ad";
  return (
    <article className="card" aria-label={c.nome}>
      <div className="cr-top">
        <span className="cr-rank">#{pos}</span>
        <span className="row" style={{ gap: 6 }}>
          {c.selo === "melhor" && <span className="pill pill-ok">Melhor desempenho</span>}
          {c.selo === "pior" && <span className="pill pill-danger">Pior desempenho</span>}
          {!c.ativo && <span className="pill pill-outline">Pausado</span>}
        </span>
      </div>
      <Imagem src={c.thumb} alt={`Criativo ${c.nome}`} rotulo={codigo} />
      <div className="cr-name"><IconeTipoMidia tipo={c.video ? "video" : "imagem"} />{c.nome}{c.video && <span className="small muted"> · vídeo</span>}</div>
      <ul className="cr-stats">
        <li className="destaque"><span>{r.plural}</span><b>{inteiro(c.resultados)}</b></li>
        <li className="destaque"><span>Custo/{r.um}</span><b>{c.custoPorResultado != null ? brl(c.custoPorResultado, true) : "—"}</b></li>
        <li><span>Gasto</span><b>{brl(c.gasto, true)}</b></li>
        <li><span>CTR</span><b>{percentual(c.ctr, 2)}</b></li>
        <li><span>CPC</span><b>{c.cpc != null ? brl(c.cpc, true) : "—"}</b></li>
        <li><span>Impressões</span><b>{inteiro(c.impressoes)}</b></li>
      </ul>
    </article>
  );
}

export function PainelAnuncios({ d }: { d: CanaisCliente }) {
  const a = d.anuncios;
  const r = rotuloDe(d);
  const { atual: per, anterior: ant } = d.periodo;
  if (!d.estado.anuncios) return <Vazio titulo="Anúncios não conectados" texto="A conta de anúncios ainda não foi ligada. Assim que for, o investimento, as conversas e os criativos aparecem aqui." />;
  if (!d.estado.anunciosConectado || !a) return <Vazio titulo="Conectando anúncios (Meta Ads)" texto="Estamos ligando a conta de anúncios. Quando a conexão terminar, o investimento, as conversas e os criativos aparecem aqui automaticamente. Não é preciso fazer nada agora." />;
  const selo = <SeloFonte fonte={ROTULO_FONTE[d.estado.fonteAnuncios ?? "meta"]} marca="meta" quando={d.estado.anunciosAtualizadoEm} problema={d.estado.anunciosComProblema} />;
  if (!a.temDadosNoPeriodo) {
    return <>{selo}<Vazio titulo="Sem entrega de anúncios neste período" texto={`Não houve investimento entre ${ddmmaa(per.de)} e ${ddmmaa(per.ate)}. ${a.temHistorico ? "Tente um período maior." : "Os primeiros dados aparecem após a próxima atualização."}`} /></>;
  }
  const t = a.atual, p = a.anterior;
  const dl = (x: number | null, y: number | null | undefined, inverso = false) => ({ pct: variacaoPct(x, y ?? null), inverso, anterior: `${ddmmaa(ant.de)} a ${ddmmaa(ant.ate)}` });
  const c = a.criativos;
  return (
    <>
      <h2 style={{ marginTop: 14 }}><MarcaRotulo marca="meta" tamanho={24}>Anúncios (Meta)</MarcaRotulo></h2>
      {selo}
      <div className="grid kpis k3" style={{ marginTop: 12 }}>
        <Kpi label="Investimento" valor={brl(t.gasto, t.gasto < 1000)} delta={dl(t.gasto, p?.gasto)} spark={a.serie.map((s) => s.gasto)} />
        <Kpi label={r.plural} valor={inteiro(t.resultados)} delta={dl(t.resultados, p?.resultados)} spark={a.serie.map((s) => s.resultados)} cor="ok" />
        <Kpi label={`Custo por ${r.um}`} valor={t.custoPorResultado != null ? brl(t.custoPorResultado, true) : "—"} delta={dl(t.custoPorResultado, p?.custoPorResultado, true)} />
        <Kpi label="Impressões" valor={compacto(t.impressoes)} delta={dl(t.impressoes, p?.impressoes)} />
        <Kpi label="Cliques" valor={inteiro(t.cliques)} delta={dl(t.cliques, p?.cliques)} sub={`CPC ${t.cpc != null ? brl(t.cpc, true) : "—"}`} />
        <Kpi label="CTR" valor={percentual(t.ctr, 2)} delta={dl(t.ctr, p?.ctr)} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row"><h3>Investimento × {r.plural.toLowerCase()} por dia</h3><Legenda itens={[{ nome: "Investimento", cor: "orange" }, { nome: r.plural, cor: "heading" }]} /></div>
        <ComboChart titulo={`Investimento e ${r.plural.toLowerCase()} por dia`} datas={a.serie.map((s) => s.data)} barras={{ nome: "Investimento", valores: a.serie.map((s) => s.gasto), formato: "brl" }} linha={{ nome: r.plural, valores: a.serie.map((s) => s.resultados), formato: "inteiro" }} />
      </div>

      <h2>Campanhas</h2>
      <div className="card table-wrap">
        <table className="t">
          <thead><tr><th>Campanha</th><th>Investimento</th><th>{r.plural}</th><th>Custo/{r.um}</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>CPC</th></tr></thead>
          <tbody>
            {a.campanhas.map((x) => (
              <tr key={x.id}>
                <td className="ctitle">{x.nome}</td>
                <td className="num">{brl(x.gasto, true)}</td><td className="num">{inteiro(x.resultados)}</td><td className="num">{x.custoPorResultado != null ? brl(x.custoPorResultado, true) : "—"}</td>
                <td className="num">{inteiro(x.impressoes)}</td><td className="num">{inteiro(x.cliques)}</td><td className="num">{percentual(x.ctr, 2)}</td><td className="num">{x.cpc != null ? brl(x.cpc, true) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Criativos que mais performam</h2>
      <p className="muted small" style={{ margin: "-4px 0 0" }}>
        Entram no ranking os anúncios que gastaram pelo menos <b>{brl(c.minGasto)}</b> no período (abaixo disso há pouco dado para comparar com justiça).
        A ordem é por {r.plural.toLowerCase()} e, em caso de empate, pelo menor custo por {r.um}. Os selos aparecem quando há pelo menos dois anúncios comparáveis.
        {c.foraDoRanking > 0 && <> {c.foraDoRanking} anúncio(s) ficaram de fora por gasto abaixo do mínimo.</>}
      </p>
      {c.ranking.length === 0 ? (
        <Vazio titulo="Ainda sem criativos comparáveis" texto={`Nenhum anúncio atingiu ${brl(c.minGasto)} de gasto neste período. Escolha um período maior.`} />
      ) : (
        <div className="cr-grid">{c.ranking.map((x, i) => <CartaoCriativo key={x.id} c={x} pos={i + 1} r={r} />)}</div>
      )}
    </>
  );
}

// ─── Instagram ───────────────────────────────────────────────────────────────

function CartaoMidia({ m }: { m: MidiaIg }) {
  const Conteudo = (
    <>
      <Imagem src={m.thumb} alt={`Mídia de ${ddmm(m.data)}`} rotulo={m.rotulo} />
      <div className="cr-top"><span className="pill pill-sand"><IconeTipoMidia tipo={m.rotulo} />{m.rotulo}</span><span className="small muted">{ddmm(m.data)}</span></div>
      {m.legenda && <div className="md-cap">{m.legenda}</div>}
      <ul className="cr-stats">
        <li><span>Alcance</span><b>{m.alcance != null ? compacto(m.alcance) : "—"}</b></li>
        <li><span>Interações</span><b>{compacto(m.interacoes)}</b></li>
        <li><span>Curtidas</span><b>{m.likes != null ? compacto(m.likes) : "—"}</b></li>
        <li><span>Coment.</span><b>{m.comentarios != null ? compacto(m.comentarios) : "—"}</b></li>
        <li><span>Salvos</span><b>{m.salvos != null ? compacto(m.salvos) : "—"}</b></li>
        <li><span>{m.views != null ? "Plays" : "Compart."}</span><b>{m.views != null ? compacto(m.views) : m.compartilhamentos != null ? compacto(m.compartilhamentos) : "—"}</b></li>
      </ul>
    </>
  );
  return <article className="card">{m.permalink ? <a href={m.permalink} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", display: "contents" }} aria-label="Abrir no Instagram">{Conteudo}</a> : Conteudo}</article>;
}

function Barras({ titulo, itens }: { titulo: string; itens: FatiaAudiencia[] }) {
  if (!itens.length) return null;
  const max = Math.max(...itens.map((i) => i.pct), 1);
  return (
    <div className="card">
      <h3>{titulo}</h3>
      <ul className="aud-list">
        {itens.map((i) => (
          <li key={i.rotulo}>
            <span className="aud-r">{i.rotulo}</span>
            <span className="aud-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (i.pct / max) * 100)}%` }} /></span>
            <b>{i.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
function Audiencia({ a }: { a: RelAudiencia }) {
  return (
    <>
      <h2>Quem acompanha</h2>
      <div className="grid dsplit three">
        <Barras titulo="Idade" itens={a.idade} />
        <Barras titulo="Gênero" itens={a.genero} />
        <Barras titulo="Principais cidades" itens={a.cidades} />
      </div>
    </>
  );
}

export function PainelInstagram({ d }: { d: CanaisCliente }) {
  const ig = d.instagram;
  const { anterior: ant } = d.periodo;
  if (!d.estado.instagram) return <Vazio titulo="Instagram não conectado" texto="O perfil ainda não foi ligado. Quando for, seguidores, alcance e as mídias mais fortes aparecem aqui." />;
  if (!d.estado.instagramConectado || !ig) return <Vazio titulo="Conectando o Instagram" texto="Estamos ligando o perfil. Quando a conexão terminar, seguidores, alcance e as mídias mais fortes aparecem aqui automaticamente. Não é preciso fazer nada agora." />;
  const selo = <SeloFonte fonte={ROTULO_FONTE_IG[d.estado.fonteInstagram ?? "windsor"]} marca="instagram" quando={d.estado.instagramAtualizadoEm} problema={d.estado.instagramComProblema} />;
  if (!ig.temDados) return <>{selo}<Vazio titulo="Coletando dados do Instagram" texto="A conexão está feita, mas ainda não chegaram números do perfil. Eles aparecem após a próxima atualização." /></>;
  const rot = (id: string) => ig.kpis.find((k) => k.id === id)!;
  const anteriorTxt = `${ddmmaa(ant.de)} a ${ddmmaa(ant.ate)}`;
  const seg = ig.seguidores;
  return (
    <>
      <h2 style={{ marginTop: 14 }}><MarcaRotulo marca="instagram" tamanho={24}>Instagram</MarcaRotulo></h2>
      {selo}
      <div className="grid kpis k3" style={{ marginTop: 12 }}>
        <Kpi label="Seguidores" valor={seg.atual != null ? inteiro(seg.atual) : "—"} indisponivel={seg.atual == null}
          sub={seg.ganho != null ? `${seg.ganho >= 0 ? "+" : ""}${inteiro(seg.ganho)} no período` : "variação indisponível"} spark={seg.serie.map((s) => s.valor)} cor="ok" />
        {(["reach", "views", "profile_views", "accounts_engaged", "total_interactions"] as const).map((id) => {
          const k = rot(id);
          return (
            <Kpi key={id} label={k.rotulo} valor={k.disponivel && k.atual != null ? compacto(k.atual) : "—"} indisponivel={!k.disponivel || k.atual == null}
              delta={k.disponivel && k.atual != null ? { pct: k.variacao, anterior: anteriorTxt } : undefined}
              sub={!k.disponivel ? "indisponível para este perfil" : id === "reach" || id === "accounts_engaged" ? "soma dos dias" : undefined} />
          );
        })}
      </div>
      <div className="grid dsplit equal" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Seguidores</h3>
          {seg.serie.length > 1 ? <LineChart titulo="Seguidores por dia" datas={seg.serie.map((s) => s.data)} series={[{ nome: "Seguidores", valores: seg.serie.map((s) => s.valor), cor: "ok" }]} formato="inteiro" /> : <div className="empty chart-empty">Histórico de seguidores em construção.</div>}
          {seg.estimado && seg.serie.length > 1 && <p className="small muted" style={{ margin: "6px 0 0" }}>Histórico estimado: reconstruído para trás a partir dos seguidores atuais e do saldo diário de novos seguidores.</p>}
        </div>
        <div className="card">
          <h3>Alcance por dia</h3>
          {rot("reach").disponivel ? <LineChart titulo="Alcance por dia" datas={ig.serie.map((s) => s.data)} series={[{ nome: "Alcance", valores: ig.serie.map((s) => s.alcance), cor: "orange" }]} formato="inteiro" /> : <div className="empty chart-empty">Alcance indisponível para este perfil.</div>}
        </div>
      </div>
      {ig.audiencia && <Audiencia a={ig.audiencia} />}
      <h2>Mídias mais fortes</h2>
      <p className="muted small" style={{ margin: "-4px 0 0" }}>Posts e Reels dos últimos 90 dias, ordenados por interações (curtidas, comentários, salvamentos e compartilhamentos).</p>
      {ig.midias.length === 0 ? <Vazio titulo="Sem mídias recentes" texto="Nenhuma mídia dos últimos 90 dias chegou até aqui ainda." /> : <div className="md-grid">{ig.midias.map((m) => <CartaoMidia key={m.id} m={m} />)}</div>}
      {ig.indisponiveis.length > 0 && <p className="small muted">Métricas que o Instagram não liberou para este perfil: {ig.indisponiveis.join(", ")}.</p>}
    </>
  );
}

// ─── Evolução ────────────────────────────────────────────────────────────────

const sinal = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${inteiro(v)}`);

function DeltaTxt({ atual, ant, inverso }: { atual: number | null | undefined; ant: number | null | undefined; inverso?: boolean }) {
  const p = variacaoPct(atual ?? null, ant ?? null);
  if (p == null || p === 0) return <span className="delta muted">{p === 0 ? "= igual" : "sem base"}</span>;
  const bom = inverso ? p < 0 : p > 0;
  return <span className={`delta ${bom ? "up" : "down"}`}><span aria-hidden="true">{p > 0 ? "▲" : "▼"}</span> {percentual(Math.abs(p))}<span className="sr"> {p > 0 ? "acima" : "abaixo"}</span></span>;
}

export function PainelEvolucao({ d, agrup, hrefAgrup }: { d: CanaisCliente; agrup: "mes" | "semana"; hrefAgrup: (a: "mes" | "semana") => string }) {
  const r = rotuloDe(d);
  const marcos: Marco[] = d.evolucao?.[agrup] ?? [];
  const toggle = (
    <nav className="tabs subtabs" aria-label="Agrupamento">
      <Link href={hrefAgrup("mes")} aria-current={agrup === "mes" ? "page" : undefined}>Por mês</Link>
      <Link href={hrefAgrup("semana")} aria-current={agrup === "semana" ? "page" : undefined}>Por semana</Link>
    </nav>
  );
  if (!marcos.length) return <>{toggle}<Vazio titulo="A evolução começa a aparecer em breve" texto="Guardamos os números todos os dias. Assim que houver histórico, você vê aqui mês a mês e semana a semana." /></>;
  const datas = marcos.map((m) => m.de), nomes = marcos.map((m) => m.rotulo);
  const temIg = marcos.some((m) => m.alcanceIg != null), temSeg = marcos.some((m) => m.seguidoresFim != null);
  const temAds = marcos.some((m) => m.gasto > 0);
  const rev = [...marcos].reverse();
  /** Pontos só dos períodos que têm o dado (nunca um zero falso no lugar de “sem dado”). */
  const pontos = (f: (m: Marco) => number | null) => { const ms = marcos.filter((m) => f(m) != null); return { datas: ms.map((m) => m.de), nomes: ms.map((m) => m.rotulo), valores: ms.map((m) => f(m) as number) }; };
  const pCpr = pontos((m) => m.custoPorResultado), pSeg = pontos((m) => m.seguidoresFim), pAlc = pontos((m) => m.alcanceIg);
  return (
    <>
      {toggle}
      {marcos.length < 2 && <div className="notice" role="note" style={{ marginTop: 10 }}>Só há um {agrup === "mes" ? "mês" : "semana"} de histórico até agora. A comparação aparece conforme os dados se acumulam.</div>}
      <div className="grid dsplit equal" style={{ marginTop: 12 }}>
        {temAds && (
          <div className="card">
            <h3>Investimento × {r.plural.toLowerCase()}</h3>
            <ComboChart titulo={`Investimento e ${r.plural.toLowerCase()} ${agrup === "mes" ? "por mês" : "por semana"}`} datas={datas} nomes={nomes} altura={220}
              barras={{ nome: "Investimento", valores: marcos.map((m) => m.gasto), formato: "brl" }} linha={{ nome: r.plural, valores: marcos.map((m) => m.resultados), formato: "inteiro" }} />
          </div>
        )}
        {temAds && (
          <div className="card">
            <h3>Custo por {r.um}</h3>
            <LineChart titulo={`Custo por ${r.um}`} datas={pCpr.datas} nomes={pCpr.nomes} altura={220} formato="brl2" series={[{ nome: `Custo por ${r.um}`, valores: pCpr.valores, cor: "orange" }]} />
          </div>
        )}
        {temSeg && (
          <div className="card">
            <h3>Seguidores</h3>
            <LineChart titulo="Seguidores" datas={pSeg.datas} nomes={pSeg.nomes} altura={220} formato="inteiro" series={[{ nome: "Seguidores", valores: pSeg.valores, cor: "ok" }]} />
          </div>
        )}
        {temIg && (
          <div className="card">
            <h3>Alcance do Instagram</h3>
            <LineChart titulo="Alcance do Instagram" datas={pAlc.datas} nomes={pAlc.nomes} altura={220} formato="inteiro" series={[{ nome: "Alcance", valores: pAlc.valores, cor: "heading" }]} />
          </div>
        )}
      </div>

      <h2>Comparação {agrup === "mes" ? "mês a mês" : "semana a semana"}</h2>
      <div className="card table-wrap">
        <table className="t">
          <thead><tr><th>{agrup === "mes" ? "Mês" : "Semana"}</th>{temAds && <><th>Investimento</th><th>{r.plural}</th><th>Custo/{r.um}</th></>}{temSeg && <th>Seguidores</th>}{temIg && <th>Alcance</th>}</tr></thead>
          <tbody>
            {rev.map((m) => (
              <tr key={m.id}>
                <td><b>{m.rotulo}</b>{m.parcial && <span className="small muted"> · em andamento</span>}{m.inicioParcial && <span className="small muted"> · dados parciais</span>}</td>
                {temAds && <>
                  <td className="num">{brl(m.gasto, true)}{m.anterior && <DeltaTxt atual={m.gasto} ant={m.anterior.gasto} />}</td>
                  <td className="num">{inteiro(m.resultados)}{m.anterior && <DeltaTxt atual={m.resultados} ant={m.anterior.resultados} />}</td>
                  <td className="num">{m.custoPorResultado != null ? brl(m.custoPorResultado, true) : "—"}{m.anterior && <DeltaTxt atual={m.custoPorResultado} ant={m.anterior.custoPorResultado} inverso />}</td>
                </>}
                {temSeg && <td className="num">{m.seguidoresFim != null ? inteiro(m.seguidoresFim) : "—"}{m.seguidoresGanho != null && <span className="delta muted">{sinal(m.seguidoresGanho)}</span>}</td>}
                {temIg && <td className="num">{m.alcanceIg != null ? compacto(m.alcanceIg) : "—"}{m.anterior && <DeltaTxt atual={m.alcanceIg} ant={m.anterior.alcanceIg} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">As variações comparam com o período anterior; no {agrup === "mes" ? "mês" : "período"} em andamento, com o mesmo número de dias do anterior. O alcance do Instagram é a soma dos dias.</p>

      <h2>Linha do tempo</h2>
      <ol className="tl">
        {rev.map((m) => (
          <li key={m.id}>
            <div className="tl-h">{m.rotulo}{m.parcial && <span className="pill pill-outline">em andamento</span>}{m.inicioParcial && <span className="pill pill-outline">dados parciais</span>}</div>
            <div className="tl-m">
              {temAds && <><div><span>Investiu</span> <b>{brl(m.gasto, true)}</b></div><div><span>{r.plural}</span> <b>{inteiro(m.resultados)}</b></div><div><span>Custo/{r.um}</span> <b>{m.custoPorResultado != null ? brl(m.custoPorResultado, true) : "—"}</b></div></>}
              {m.seguidoresFim != null && <div><span>Seguidores</span> <b>{inteiro(m.seguidoresFim)}{m.seguidoresGanho != null ? ` (${sinal(m.seguidoresGanho)})` : ""}</b></div>}
              {m.alcanceIg != null && <div><span>Alcance</span> <b>{compacto(m.alcanceIg)}</b></div>}
            </div>
            {m.anterior && m.anterior.resultados !== m.resultados && <div className="small muted" style={{ marginTop: 4 }}>{r.plural} {m.resultados > m.anterior.resultados ? "subiram" : "caíram"} de {inteiro(m.anterior.resultados)} para {inteiro(m.resultados)} vs. {m.anterior.rotulo}.</div>}
          </li>
        ))}
      </ol>
    </>
  );
}
