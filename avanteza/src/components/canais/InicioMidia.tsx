// Bloco “Mídia e tráfego” da página Início do Mapa (clientes midia e ambos). Componente de servidor sobre CanaisCliente: cada fonte
// (anúncios e Instagram) tem estado próprio, então anúncios podem estar “Conectando” enquanto o Instagram já mostra números.
// Sem dado, nada é inventado. O detalhe completo continua em Canais.
import Link from "next/link";
import { Kpi } from "@/components/dashboards/Kpi";
import { LineChart, Legenda } from "@/components/dashboards/LineChart";
import { ComboChart } from "./ComboChart";
import { Imagem } from "./Imagem";
import { SeloFonte } from "./Paineis";
import { CartaoGastoCiclo } from "./GastoCiclo";
import { IconeTipoMidia, MarcaRotulo } from "@/components/brand";
import { brl, compacto, inteiro, percentual } from "@/lib/dashboards/format";
import { PERIODOS, ROTULO_PERIODO, ddmm, ddmmaa, variacaoPct, type PeriodoId } from "@/lib/dashboards/periodo";
import { ROTULO_FONTE, ROTULO_FONTE_IG } from "@/lib/channels/types";
import type { CanaisCliente } from "@/lib/channels/cliente";

export function InicioMidia({ d, hrefPeriodo }: { d: CanaisCliente; hrefPeriodo: (p: PeriodoId) => string }) {
  const { atual, anterior: ant } = d.periodo;
  const nomeRes = d.estado.resultado === "conversas" ? { um: "conversa", plural: "Conversas" } : { um: "resultado", plural: "Resultados" };
  const anteriorTxt = `${ddmmaa(ant.de)} a ${ddmmaa(ant.ate)}`;
  const dl = (x: number | null, y: number | null | undefined, inverso = false) => ({ pct: variacaoPct(x, y ?? null), inverso, anterior: anteriorTxt });
  return (
    <section className="midia-bloco" aria-labelledby="mid-t">
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
        <h2 id="mid-t">Mídia e tráfego</h2>
        <Link className="small" href="/mapa/canais">Ver detalhes ›</Link>
      </div>
      <nav className="tabs periodo" aria-label="Período da mídia e tráfego" style={{ marginTop: 8 }}>
        {PERIODOS.map((p) => <Link key={p} href={hrefPeriodo(p)} aria-current={p === d.periodo.id ? "page" : undefined}>{ROTULO_PERIODO[p]}</Link>)}
      </nav>
      <p className="muted small" style={{ margin: "4px 0 0" }}>{ddmm(atual.de)} a {ddmm(atual.ate)} ({atual.dias} {atual.dias === 1 ? "dia" : "dias"}) · variações comparam com o período anterior de mesmo tamanho.</p>
      {d.estado.simulado && <div className="notice" role="note" style={{ margin: "10px 0" }}><b>Dados simulados</b> (CHANNELS_FIXTURE, só desenvolvimento). Nada aqui é real.</div>}
      {d.gastoCiclo && <CartaoGastoCiclo g={d.gastoCiclo} rotulo={nomeRes} id="ini-gasto" />}
      <Anuncios d={d} r={nomeRes} dl={dl} />
      <Instagram d={d} anteriorTxt={anteriorTxt} />
    </section>
  );
}

type Dl = (x: number | null, y: number | null | undefined, inverso?: boolean) => { pct: number | null; inverso: boolean; anterior: string };

function Cabecalho({ marca, titulo, selo }: { marca: "meta" | "instagram"; titulo: string; selo?: React.ReactNode }) {
  return (
    <>
      <div className="row"><h3><MarcaRotulo marca={marca} tamanho={24}>{titulo}</MarcaRotulo></h3></div>
      {selo}
    </>
  );
}

function Anuncios({ d, r, dl }: { d: CanaisCliente; r: { um: string; plural: string }; dl: Dl }) {
  const a = d.anuncios;
  const titulo = "Anúncios (Meta)";
  if (!d.estado.anuncios) return <div className="card midia-fonte"><Cabecalho marca="meta" titulo={titulo} /><p className="muted small midia-vazio">A conta de anúncios ainda não foi ligada.</p></div>;
  if (!d.estado.anunciosConectado || !a) return <div className="card midia-fonte"><Cabecalho marca="meta" titulo="Conectando anúncios (Meta Ads)" /><p className="muted small midia-vazio">Estamos ligando a conta de anúncios. Os números aparecem aqui automaticamente quando a conexão terminar; não é preciso fazer nada agora.</p></div>;
  const selo = <SeloFonte fonte={ROTULO_FONTE[d.estado.fonteAnuncios ?? "meta"]} marca="meta" quando={d.estado.anunciosAtualizadoEm} problema={d.estado.anunciosComProblema} />;
  if (!a.temDadosNoPeriodo) return <div className="card midia-fonte"><Cabecalho marca="meta" titulo={titulo} selo={selo} /><p className="muted small midia-vazio">Sem investimento neste período. Tente um período maior.</p></div>;
  const t = a.atual, p = a.anterior;
  const melhor = a.criativos.ranking[0];
  return (
    <div className="card midia-fonte">
      <Cabecalho marca="meta" titulo={titulo} selo={selo} />
      <div className="grid kpis k5" style={{ marginTop: 12 }}>
        <Kpi label="Investimento" valor={brl(t.gasto, t.gasto < 1000)} delta={dl(t.gasto, p?.gasto)} spark={a.serie.map((s) => s.gasto)} />
        <Kpi label={r.plural} valor={inteiro(t.resultados)} delta={dl(t.resultados, p?.resultados)} spark={a.serie.map((s) => s.resultados)} cor="ok" />
        <Kpi label={`Custo por ${r.um}`} valor={t.custoPorResultado != null ? brl(t.custoPorResultado, true) : "—"} delta={dl(t.custoPorResultado, p?.custoPorResultado, true)} />
        <Kpi label="Alcance" valor={t.alcance > 0 ? compacto(t.alcance) : "—"} delta={t.alcance > 0 ? dl(t.alcance, p?.alcance) : undefined} sub={t.alcance > 0 ? "soma dos dias" : "indisponível"} indisponivel={t.alcance <= 0} />
        <Kpi label="Cliques · CTR" valor={inteiro(t.cliques)} delta={dl(t.cliques, p?.cliques)} sub={`CTR ${percentual(t.ctr, 2)}`} />
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row"><h3>Investimento × {r.plural.toLowerCase()} por dia</h3><Legenda itens={[{ nome: "Investimento", cor: "orange" }, { nome: r.plural, cor: "heading" }]} /></div>
        <ComboChart titulo={`Investimento e ${r.plural.toLowerCase()} por dia`} altura={170} datas={a.serie.map((s) => s.data)} barras={{ nome: "Investimento", valores: a.serie.map((s) => s.gasto), formato: "brl" }} linha={{ nome: r.plural, valores: a.serie.map((s) => s.resultados), formato: "inteiro" }} />
      </div>
      {melhor ? (
        <div className="midia-destaques">
          <article className="card" aria-label={`Melhor criativo: ${melhor.nome}`}>
            <Imagem src={melhor.thumb} alt={`Criativo ${melhor.nome}`} rotulo={melhor.nome.split("|")[0].trim().slice(0, 4) || "Ad"} />
            <div className="dest-txt">
              <span className="dest-lab">Melhor criativo</span>
              <span className="dest-tit"><IconeTipoMidia tipo={melhor.video ? "video" : "imagem"} />{melhor.nome}</span>
              <span className="small muted">{inteiro(melhor.resultados)} {melhor.resultados === 1 ? r.um : r.plural.toLowerCase()} · {melhor.custoPorResultado != null ? `${brl(melhor.custoPorResultado, true)}/${r.um}` : "sem custo por " + r.um} · gasto {brl(melhor.gasto, true)}</span>
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}

function Instagram({ d, anteriorTxt }: { d: CanaisCliente; anteriorTxt: string }) {
  const ig = d.instagram;
  if (!d.estado.instagram) return <div className="card midia-fonte"><Cabecalho marca="instagram" titulo="Instagram" /><p className="muted small midia-vazio">O perfil ainda não foi ligado.</p></div>;
  if (!d.estado.instagramConectado || !ig) return <div className="card midia-fonte"><Cabecalho marca="instagram" titulo="Conectando o Instagram" /><p className="muted small midia-vazio">Estamos ligando o perfil. Os números aparecem aqui automaticamente quando a conexão terminar.</p></div>;
  const selo = <SeloFonte fonte={ROTULO_FONTE_IG[d.estado.fonteInstagram ?? "windsor"]} marca="instagram" quando={d.estado.instagramAtualizadoEm} problema={d.estado.instagramComProblema} />;
  if (!ig.temDados) return <div className="card midia-fonte"><Cabecalho marca="instagram" titulo="Instagram" selo={selo} /><p className="muted small midia-vazio">Conexão feita; os números do perfil chegam na próxima atualização.</p></div>;
  const k = (id: string) => ig.kpis.find((x) => x.id === id)!;
  const seg = ig.seguidores;
  const post = ig.midias[0];
  const kpi = (id: string) => { const x = k(id); return <Kpi label={x.rotulo} valor={x.disponivel && x.atual != null ? compacto(x.atual) : "—"} indisponivel={!x.disponivel || x.atual == null} delta={x.disponivel && x.atual != null ? { pct: x.variacao, anterior: anteriorTxt } : undefined} sub={!x.disponivel ? "indisponível para este perfil" : id === "reach" ? "soma dos dias" : undefined} />; };
  return (
    <div className="card midia-fonte">
      <Cabecalho marca="instagram" titulo="Instagram" selo={selo} />
      <div className="grid kpis k4" style={{ marginTop: 12 }}>
        <Kpi label="Seguidores" valor={seg.atual != null ? inteiro(seg.atual) : "—"} indisponivel={seg.atual == null} sub={seg.ganho != null ? `${seg.ganho >= 0 ? "+" : ""}${inteiro(seg.ganho)} no período` : "variação indisponível"} spark={seg.serie.map((s) => s.valor)} cor="ok" />
        {kpi("reach")}{kpi("views")}{kpi("total_interactions")}
      </div>
      <div className="grid dsplit equal" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>Seguidores</h3>
          {seg.serie.length > 1 ? <LineChart titulo="Seguidores por dia" altura={150} datas={seg.serie.map((s) => s.data)} series={[{ nome: "Seguidores", valores: seg.serie.map((s) => s.valor), cor: "ok" }]} formato="inteiro" /> : <div className="empty chart-empty">Histórico em construção.</div>}
        </div>
        <div className="card">
          <h3>Alcance por dia</h3>
          {k("reach").disponivel && ig.serie.length > 0 ? <LineChart titulo="Alcance por dia" altura={150} datas={ig.serie.map((s) => s.data)} series={[{ nome: "Alcance", valores: ig.serie.map((s) => s.alcance), cor: "orange" }]} formato="inteiro" /> : <div className="empty chart-empty">Alcance indisponível.</div>}
        </div>
      </div>
      {post ? (
        <div className="midia-destaques">
          <article className="card" aria-label="Melhor post">
            <Imagem src={post.thumb} alt={`Mídia de ${ddmm(post.data)}`} rotulo={post.rotulo} />
            <div className="dest-txt">
              <span className="dest-lab">Melhor post</span>
              <span className="dest-tit"><IconeTipoMidia tipo={post.rotulo} />{post.rotulo} · {ddmm(post.data)}</span>
              {post.legenda && <span className="small muted" style={{ overflowWrap: "anywhere" }}>{post.legenda.slice(0, 90)}</span>}
              <span className="small muted">{compacto(post.interacoes)} interações{post.alcance != null ? ` · alcance ${compacto(post.alcance)}` : ""}</span>
              {post.permalink && <a className="small" href={post.permalink} target="_blank" rel="noopener noreferrer">Abrir no Instagram ›</a>}
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}
