// Mapa → Canais → Anúncios: seção "Público e localização" (componente de servidor). Também usada na aba Canais do administrador,
// que recebe além disso o bloco recolhível com a segmentação técnica. Para o cliente, só linguagem simples: sem ids, sem nome de
// arquivo de público, sem JSON. Conversas que a fonte não entrega num corte aparecem como "indisponível neste corte".
import { LogoMarca, MarcaRotulo, type Marca } from "@/components/brand";
import { brl, compacto, inteiro, percentual } from "@/lib/dashboards/format";
import type { FaixaIdade, LocalAlvo, Metrica, PublicoConfigurado, RelIdadeGenero, RelPosicionamento, RelPublico, RelRegioes, SegmentoPublico } from "@/lib/channels/publico";

type Rotulo = { um: string; plural: string };
const custo = (m: Metrica | null | undefined) => (m?.custoPorConversa != null ? brl(m.custoPorConversa, true) : "—");
const conv = (m: Metrica | null | undefined) => (m == null ? "—" : m.conversas == null ? "indisponível" : inteiro(m.conversas));
const marcaDe = (p: string): Marca | null => (p === "Facebook" ? "facebook" : p === "Instagram" ? "instagram" : null);

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return <div className="card pub-vazio"><h3>{titulo}</h3><p className="muted small" style={{ margin: "6px 0 0" }}>{texto}</p></div>;
}

// ─── (1) Quem estamos atingindo ──────────────────────────────────────────────

function Lado({ m, max, lado, r }: { m: Metrica | null; max: number; lado: "h" | "m"; r: Rotulo }) {
  if (!m || m.gasto <= 0) return <span className={`pir-lado pir-${lado}`}><span className="pir-val muted">—</span></span>;
  const pct = Math.max(3, (m.gasto / max) * 100);
  const desc = `${brl(m.gasto, true)}${m.conversas != null ? ` · ${inteiro(m.conversas)} ${m.conversas === 1 ? r.um : r.plural.toLowerCase()}` : ""}`;
  return (
    <span className={`pir-lado pir-${lado}`}>
      <span className="pir-barra" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      <span className="pir-val" title={desc}><span className="pir-l">{desc}</span><span className="pir-s" aria-hidden="true">{brl(m.gasto, m.gasto < 100)}{m.conversas != null ? ` · ${inteiro(m.conversas)}` : ""}</span></span>
    </span>
  );
}

function Piramide({ faixas, r }: { faixas: FaixaIdade[]; r: Rotulo }) {
  const max = Math.max(1, ...faixas.flatMap((f) => [f.homens?.gasto ?? 0, f.mulheres?.gasto ?? 0]));
  return (
    <div className="pir" role="table" aria-label="Investimento por idade e gênero">
      <div className="pir-row pir-head" role="row">
        <span role="columnheader" className="pir-h-t"><i className="pir-dot pir-dot-h" aria-hidden="true" />Homens</span>
        <span role="columnheader">Idade</span>
        <span role="columnheader" className="pir-m-t"><i className="pir-dot pir-dot-m" aria-hidden="true" />Mulheres</span>
      </div>
      {faixas.filter((f) => f.homens || f.mulheres).map((f) => (
        <div className="pir-row" role="row" key={f.faixa}>
          <span role="cell"><Lado m={f.homens} max={max} lado="h" r={r} /></span>
          <span role="rowheader" className="pir-faixa">{f.rotulo}</span>
          <span role="cell"><Lado m={f.mulheres} max={max} lado="m" r={r} /></span>
        </div>
      ))}
    </div>
  );
}

function Destaque({ s, tipo, r }: { s: SegmentoPublico; tipo: "melhor" | "caro"; r: Rotulo }) {
  return (
    <div className={`pub-destaque ${tipo === "melhor" ? "ok" : "caro"}`}>
      <span className={`pill ${tipo === "melhor" ? "pill-ok" : "pill-danger"}`}>{tipo === "melhor" ? "Melhor público" : "Público mais caro"}</span>
      <b>{s.rotulo}</b>
      <span className="small muted">
        {tipo === "caro" && (s.conversas ?? 0) === 0
          ? `${brl(s.gasto, true)} investidos sem nenhuma ${r.um} no período.`
          : `${custo(s)} por ${r.um} · ${inteiro(s.conversas)} ${r.plural.toLowerCase()} com ${brl(s.gasto, true)}.`}
      </span>
    </div>
  );
}

function QuemAtingimos({ ig, r }: { ig: RelIdadeGenero | null; r: Rotulo }) {
  if (!ig) return <Vazio titulo="Quem estamos atingindo" texto="Ainda não chegaram os números por idade e gênero deste período. Eles aparecem após a próxima atualização." />;
  const outros = ig.porGenero.find((g) => g.genero === "outros");
  return (
    <div className="card">
      <h3>Quem estamos atingindo</h3>
      <p className="muted small" style={{ margin: "4px 0 10px" }}>Investimento por idade e gênero{ig.conversasDisponiveis ? `, com as ${r.plural.toLowerCase()} de cada público` : ""}.</p>
      <Piramide faixas={ig.faixas} r={r} />
      {outros && outros.gasto > 0 && <p className="small muted" style={{ margin: "8px 0 0" }}>Gênero não informado pela Meta: {brl(outros.gasto, true)} ({percentual(outros.participacao)} do investimento).</p>}
      {(ig.melhor || ig.maisCaro) && (
        <div className="pub-destaques">
          {ig.melhor && <Destaque s={ig.melhor} tipo="melhor" r={r} />}
          {ig.maisCaro && <Destaque s={ig.maisCaro} tipo="caro" r={r} />}
        </div>
      )}
      {!ig.conversasDisponiveis && <p className="small muted" style={{ margin: "8px 0 0" }}>{r.plural} por público: indisponível neste corte.</p>}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="t">
          <thead><tr><th>Público</th><th>Investimento</th><th>Participação</th><th>Impressões</th><th>{r.plural}</th><th>Custo/{r.um}</th></tr></thead>
          <tbody>
            {ig.segmentos.map((s) => (
              <tr key={`${s.faixa}-${s.genero}`}>
                <td>{s.rotulo}{ig.melhor === s && <span className="pill pill-ok" style={{ marginLeft: 6 }}>melhor</span>}{ig.maisCaro === s && <span className="pill pill-danger" style={{ marginLeft: 6 }}>mais caro</span>}</td>
                <td className="num">{brl(s.gasto, true)}</td><td className="num">{percentual(s.participacao)}</td><td className="num">{inteiro(s.impressoes)}</td>
                <td className="num">{conv(s)}</td><td className="num">{custo(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── (2) Onde ────────────────────────────────────────────────────────────────

function Local({ l }: { l: LocalAlvo }) {
  return <>{l.texto}{l.mapa && <> · <a href={l.mapa} target="_blank" rel="noopener noreferrer">ver no mapa</a></>}</>;
}

function Onde({ rg, locais, r }: { rg: RelRegioes | null; locais: LocalAlvo[]; r: Rotulo }) {
  const max = Math.max(1, ...(rg?.itens.map((i) => i.gasto) ?? [1]));
  return (
    <div className="card">
      <h3>Onde</h3>
      {locais.length > 0 && (
        <>
          <p className="small muted" style={{ margin: "4px 0 6px" }}>Área escolhida para mostrar os anúncios:</p>
          <ul className="pub-locais">{locais.map((l, i) => <li key={i}><Local l={l} /></li>)}</ul>
        </>
      )}
      {rg ? (
        <>
          <p className="small muted" style={{ margin: locais.length ? "12px 0 0" : "4px 0 0" }}>Onde estavam as pessoas que viram os anúncios, por estado:</p>
          <ul className="aud-list">
            {rg.itens.slice(0, 8).map((i) => (
              <li key={i.regiao}>
                <span className="aud-r">{i.regiao}</span>
                <span className="aud-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (i.gasto / max) * 100)}%` }} /></span>
                <b>{brl(i.gasto, true)} · {percentual(i.participacao)}</b>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            {rg.itens.length === 1 ? `Todas as impressões do período (${inteiro(rg.itens[0].impressoes)}) foram em ${rg.itens[0].regiao}.` : `${inteiro(rg.itens.reduce((t, i) => t + i.impressoes, 0))} impressões no período.`}
            {!rg.conversasDisponiveis && <> {r.plural} por região: <b>indisponível neste corte</b> (a Meta não informa {r.plural.toLowerCase()} separadas por região aqui).</>}
          </p>
        </>
      ) : <p className="small muted" style={{ margin: "8px 0 0" }}>A divisão por região deste período ainda não chegou.</p>}
    </div>
  );
}

// ─── (3) Público configurado ─────────────────────────────────────────────────

function Conjunto({ c }: { c: PublicoConfigurado }) {
  return (
    <article className="card pub-conj" aria-label={c.conjunto}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div><h4 style={{ margin: 0 }}>{c.conjunto}</h4>{c.campanha && <div className="small muted">{c.campanha}</div>}</div>
        {c.ativo === false && <span className="pill pill-outline">Pausado</span>}
      </div>
      {!c.legivel ? <p className="small muted" style={{ margin: "8px 0 0" }}>Não foi possível ler a configuração deste conjunto. A equipe já pode conferir.</p> : (
        <ul className="plist">
          <li><span>Idade</span><b>{c.idade ?? "Todas as idades"}</b></li>
          <li><span>Gênero</span><b>{c.genero}</b></li>
          <li><span>Onde</span><b>{c.locais.length ? c.locais.map((l, i) => <span key={i} className="pub-item"><Local l={l} /></span>) : "Sem restrição de local"}</b></li>
          {c.locaisExcluidos.length > 0 && <li><span>Fora da área</span><b>{c.locaisExcluidos.join(" · ")}</b></li>}
          {c.publicos.length > 0 && <li><span>Mostra para</span><b>{c.publicos.join(" · ")}</b></li>}
          {c.publicosExcluidos.length > 0 && <li><span>Não mostra para</span><b>{c.publicosExcluidos.join(" · ")}</b></li>}
          {c.interesses.length > 0 && <li><span>Interesses</span><b>{c.interesses.join(" · ")}</b></li>}
          {c.interessesExcluidos.length > 0 && <li><span>Sem interesse em</span><b>{c.interessesExcluidos.join(" · ")}</b></li>}
          <li><span>Onde aparece</span><b>{c.posicionamentos ?? "Automático (a Meta escolhe)"}</b></li>
        </ul>
      )}
      {c.notas.map((n, i) => <p key={i} className="small muted" style={{ margin: "8px 0 0" }}>{n}</p>)}
    </article>
  );
}

// ─── (4) Onde os anúncios aparecem ───────────────────────────────────────────

/** Rosca SVG própria: participação de cada plataforma no investimento. */
function Rosca({ fatias }: { fatias: Array<{ nome: string; pct: number; cls: string }> }) {
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg className="pub-rosca" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`Investimento por plataforma: ${fatias.map((f) => `${f.nome} ${f.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`).join(", ")}`}>
      <circle cx="60" cy="60" r={R} className="pub-rosca-fundo" />
      {fatias.map((f) => {
        const len = (f.pct / 100) * C;
        const el = <circle key={f.nome} cx="60" cy="60" r={R} className={f.cls} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />;
        acc += len;
        return el;
      })}
    </svg>
  );
}

function OndeAparecem({ p, r }: { p: RelPosicionamento | null; r: Rotulo }) {
  if (!p) return <Vazio titulo="Onde os anúncios aparecem" texto="A divisão por Feed, Reels e Stories deste período ainda não chegou." />;
  const plats = p.plataformas.map((x) => x.plataforma);
  const principais: string[] = plats.filter((x) => x === "Facebook" || x === "Instagram");
  const colunas = [...principais, ...(plats.some((x) => !principais.includes(x)) ? ["Outras"] : [])];
  const valor = (por: Record<string, number>, col: string) => (col === "Outras" ? Object.entries(por).filter(([k]) => !principais.includes(k)).reduce((t, [, v]) => t + v, 0) : por[col] ?? 0);
  const cls = (nome: string, i: number) => (nome === "Instagram" ? "pub-f-ig" : nome === "Facebook" ? "pub-f-fb" : i % 2 ? "pub-f-a" : "pub-f-b");
  return (
    <div className="card">
      <h3>Onde os anúncios aparecem</h3>
      <div className="pub-plat">
        <Rosca fatias={p.plataformas.map((x, i) => ({ nome: x.plataforma, pct: x.participacao, cls: cls(x.plataforma, i) }))} />
        <ul className="pub-plat-l">
          {p.plataformas.map((x, i) => {
            const m = marcaDe(x.plataforma);
            return <li key={x.plataforma}><i className={`pub-sw ${cls(x.plataforma, i)}`} aria-hidden="true" />{m ? <MarcaRotulo marca={m} tamanho={16}>{x.plataforma}</MarcaRotulo> : x.plataforma}<b>{percentual(x.participacao)}</b><span className="small muted">{brl(x.gasto, true)}</span></li>;
          })}
        </ul>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="t">
          <thead><tr><th>Formato</th>{colunas.map((c) => <th key={c}>{marcaDe(c) ? <span className="row" style={{ gap: 6, justifyContent: "flex-start" }}><LogoMarca marca={marcaDe(c)!} tamanho={16} />{c}</span> : c}</th>)}<th>Total</th><th>Participação</th>{p.conversasDisponiveis && <><th>{r.plural}</th><th>Custo/{r.um}</th></>}</tr></thead>
          <tbody>
            {p.grupos.map((g) => (
              <tr key={g.grupo}>
                <td><b>{g.grupo}</b></td>
                {colunas.map((c) => <td key={c} className="num">{valor(g.porPlataforma, c) > 0 ? brl(valor(g.porPlataforma, c), true) : "—"}</td>)}
                <td className="num">{brl(g.total.gasto, true)}</td><td className="num">{percentual(g.total.participacao)}</td>
                {p.conversasDisponiveis && <><td className="num">{conv(g.total)}</td><td className="num">{custo(g.total)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small">Ver cada posição</summary>
        <ul className="plist">
          {p.itens.map((i) => <li key={`${i.plataforma}-${i.posicao}`}><span>{i.plataforma} · {i.posicao}</span><b>{brl(i.gasto, true)} · {percentual(i.participacao)}{i.impressoes ? ` · ${compacto(i.impressoes)} impressões` : ""}</b></li>)}
        </ul>
      </details>
    </div>
  );
}

// ─── Seção ───────────────────────────────────────────────────────────────────

export function SecaoPublico({ p, r, admin = false }: { p: RelPublico | null; r: Rotulo; admin?: boolean }) {
  return (
    <section aria-labelledby="sec-publico" className="pub">
      <h2 id="sec-publico">Público e localização</h2>
      {!p || !p.temDados ? (
        <Vazio titulo="Ainda sem dados de público" texto="Quem vê os anúncios (idade, gênero e região), onde eles aparecem e o público configurado em cada conjunto chegam na próxima atualização dos anúncios." />
      ) : (
        <>
          <p className="muted small" style={{ margin: "-4px 0 0" }}>Quem viu os anúncios no período escolhido, onde estavam, em que formato os anúncios apareceram e para quem cada conjunto foi configurado.</p>
          <div style={{ marginTop: 12 }}><QuemAtingimos ig={p.idadeGenero} r={r} /></div>
          <div className="grid dsplit equal" style={{ marginTop: 14 }}>
            <Onde rg={p.regioes} locais={p.locaisConfigurados} r={r} />
            <OndeAparecem p={p.posicionamento} r={r} />
          </div>
          <h3 style={{ margin: "18px 0 8px" }}>Público configurado</h3>
          {p.conjuntos.length === 0 ? <Vazio titulo="Configuração dos conjuntos ainda não chegou" texto="Assim que a próxima atualização trouxer a configuração, mostramos aqui para quem cada conjunto de anúncios está direcionado." /> : (
            <div className="pub-conjs">{p.conjuntos.map((c, i) => <Conjunto key={i} c={c} />)}</div>
          )}
          {admin && p.tecnico && p.tecnico.length > 0 && (
            <details className="card" style={{ marginTop: 14 }}>
              <summary>Segmentação técnica (só equipe)</summary>
              <p className="small muted" style={{ margin: "6px 0 0" }}>Exatamente como veio da fonte. O cliente nunca vê este bloco.</p>
              {p.tecnico.map((t, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <b>{t.conjunto}</b>{t.campanha && <span className="small muted"> · {t.campanha}</span>}
                  {t.naoInterpretados.length > 0 && <div className="small muted">Campos não traduzidos para o cliente: {t.naoInterpretados.join(", ")}</div>}
                  <pre className="pub-json">{t.json}</pre>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
