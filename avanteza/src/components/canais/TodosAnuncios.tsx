"use client";
// Mapa → Canais → Anúncios: "Todos os anúncios" do período, um por anúncio, com criativo (título, texto, chamada), público em
// linguagem simples, métricas e o "Por que" (regras transparentes, calculadas no servidor). Ordenar e filtrar acontecem aqui, sem ids:
// os dados já chegam sem nenhum identificador externo e os links já vêm sanitizados (só https da Meta).
import { useMemo, useState } from "react";
import { Imagem } from "./Imagem";
import { IconeTipoMidia } from "@/components/brand";
import { brl, inteiro, percentual } from "@/lib/dashboards/format";
import type { Criativo } from "@/lib/channels/report";

type Ordem = "gasto" | "conversas" | "custo";
const TODOS = "__todos";

export function TodosAnuncios({ anuncios, r }: { anuncios: Criativo[]; r: { um: string; plural: string } }) {
  const [ordem, setOrdem] = useState<Ordem>("gasto");
  const [campanha, setCampanha] = useState(TODOS);
  const [publico, setPublico] = useState(TODOS);
  const campanhas = useMemo(() => [...new Set(anuncios.map((a) => a.campanha).filter((x): x is string => Boolean(x)))].sort(), [anuncios]);
  const publicos = useMemo(() => [...new Set(anuncios.map((a) => a.publico ?? a.conjunto).filter((x): x is string => Boolean(x)))].sort(), [anuncios]);
  const lista = useMemo(() => {
    const l = anuncios.filter((a) => (campanha === TODOS || a.campanha === campanha) && (publico === TODOS || (a.publico ?? a.conjunto) === publico));
    const custo = (a: Criativo) => a.custoPorResultado ?? Infinity;
    return [...l].sort((x, y) => (ordem === "gasto" ? y.gasto - x.gasto : ordem === "conversas" ? y.resultados - x.resultados || custo(x) - custo(y) : custo(x) - custo(y) || y.resultados - x.resultados));
  }, [anuncios, ordem, campanha, publico]);
  if (!anuncios.length) return null;
  return (
    <section aria-labelledby="sec-todos" id="todos-anuncios">
      <h2 id="sec-todos">Todos os anúncios</h2>
      <p className="muted small" style={{ margin: "-4px 0 0" }}>Cada anúncio do período com o texto, o público e as métricas. O “Por que” compara com a média da campanha e do conjunto.</p>
      <div className="ta-filtros" role="group" aria-label="Ordenar e filtrar anúncios">
        <div className="field"><label htmlFor="ta-ordem">Ordenar por</label>
          <select id="ta-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
            <option value="gasto">Maior gasto</option><option value="conversas">Mais {r.plural.toLowerCase()}</option><option value="custo">Menor custo por {r.um}</option>
          </select>
        </div>
        {campanhas.length > 1 && <div className="field"><label htmlFor="ta-camp">Campanha</label>
          <select id="ta-camp" value={campanha} onChange={(e) => setCampanha(e.target.value)}><option value={TODOS}>Todas</option>{campanhas.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>}
        {publicos.length > 1 && <div className="field"><label htmlFor="ta-pub">Público</label>
          <select id="ta-pub" value={publico} onChange={(e) => setPublico(e.target.value)}><option value={TODOS}>Todos</option>{publicos.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>}
      </div>
      <p className="small muted" aria-live="polite" style={{ margin: "6px 0 0" }}>{lista.length} {lista.length === 1 ? "anúncio" : "anúncios"}</p>
      <div className="ta-lista">
        {lista.map((a) => <Anuncio key={a.id} a={a} r={r} />)}
      </div>
    </section>
  );
}

function Anuncio({ a, r }: { a: Criativo; r: { um: string; plural: string } }) {
  const codigo = a.nome.split("|")[0].trim().slice(0, 4) || "Ad";
  const plano = a.texto ? a.texto.replace(/\s+/g, " ").trim() : "";
  const curto = a.texto && plano.length > 140 ? `${plano.slice(0, 140).trimEnd()}… ler tudo` : null;
  return (
    <article className="card ta-item" aria-label={a.nome}>
      <Imagem src={a.thumb} alt={`Criativo ${a.nome}`} rotulo={codigo} className="ta-art" />
      <div className="ta-corpo">
        <div className="ta-top">
          <span className="cr-name"><IconeTipoMidia tipo={a.video ? "video" : "imagem"} />{a.nome}</span>
          <span className={`pill ${a.ativo ? "pill-ok" : "pill-outline"}`}>{a.ativo ? "Ativo" : "Pausado"}</span>
        </div>
        <div className="small muted">{[a.campanha, a.publico ?? a.conjunto].filter(Boolean).join(" · ")}</div>
        {a.titulo && <div className="ta-titulo">{a.titulo}</div>}
        {a.texto && (curto ? (
          <details className="ta-texto"><summary>{curto}</summary><p>{a.texto}</p></details>
        ) : <p className="ta-texto-p">{a.texto}</p>)}
        <div className="ta-acoes small">
          {a.cta && <span className="pill pill-sand">{a.cta}</span>}
          {a.previa && <a href={a.previa} target="_blank" rel="noopener noreferrer">ver prévia</a>}
          {a.instagram && <a href={a.instagram} target="_blank" rel="noopener noreferrer">ver no Instagram</a>}
        </div>
        <ul className="ta-met">
          <li><span>Gasto</span><b>{brl(a.gasto, true)}</b></li>
          <li><span>{r.plural}</span><b>{inteiro(a.resultados)}</b></li>
          <li><span>Custo/{r.um}</span><b>{a.custoPorResultado != null ? brl(a.custoPorResultado, true) : "—"}</b></li>
          <li><span>Impressões</span><b>{inteiro(a.impressoes)}</b></li>
          <li><span>Alcance</span><b>{a.alcance ? inteiro(a.alcance) : "—"}</b></li>
          <li><span>Cliques</span><b>{inteiro(a.cliques)}</b></li>
          <li><span>CTR</span><b>{percentual(a.ctr, 2)}</b></li>
          <li><span>CPC</span><b>{a.cpc != null ? brl(a.cpc, true) : "—"}</b></li>
        </ul>
        {a.porque.length > 0 && <p className="small ta-porque"><b>Por que:</b> {a.porque.join("; ")}.</p>}
      </div>
    </article>
  );
}
