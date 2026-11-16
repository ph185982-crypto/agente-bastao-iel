"use client";
// Gráfico de linhas/área em SVG próprio (sem biblioteca). Mede a largura real do contêiner (os textos ficam no tamanho certo
// no celular), tem cursor com dica ao passar o mouse/tocar e navegação por setas no teclado. Cores só por classes de token.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { brl, compacto, inteiro } from "@/lib/dashboards/format";
import { ddmm } from "@/lib/dashboards/periodo";

export interface Serie {
  nome: string;
  valores: number[];
  cor: "orange" | "ok" | "danger" | "muted" | "heading";
  tracejado?: boolean;
  /** Preenchimento em degradê sob a linha (padrão: só na primeira série). */
  area?: boolean;
}
export type FormatoValor = "brl" | "inteiro";

const fmt = (f: FormatoValor, v: number) => (f === "brl" ? brl(v, Math.abs(v) < 100) : inteiro(v));

function escalaBonita(max: number, min: number): { min: number; max: number; ticks: number[] } {
  const topo = Math.max(max, 0), base = Math.min(min, 0);
  const alvo = (topo - base) / 4 || 1;
  const mag = 10 ** Math.floor(Math.log10(alvo));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= alvo) ?? 10 * mag;
  const lo = Math.floor(base / passo) * passo, hi = Math.max(Math.ceil(topo / passo) * passo, lo + passo);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + passo / 1e6; v += passo) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: lo, max: hi, ticks };
}

export function LineChart({ datas, series, formato, titulo, altura = 210 }: {
  datas: string[]; series: Serie[]; formato: FormatoValor; titulo: string; altura?: number;
}) {
  const id = useId().replace(/:/g, "");
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  const [idx, setIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(240, Math.round(el.clientWidth)));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = datas.length;
  const todos = series.flatMap((s) => s.valores);
  const vazio = n === 0 || todos.length === 0 || todos.every((v) => v === 0);
  const esc = useMemo(() => escalaBonita(Math.max(...todos, 0), Math.min(...todos, 0)), [todos]);
  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const W = largura, H = altura;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - esc.min) / (esc.max - esc.min || 1)) * ih;

  const caminho = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const qtdRotulos = W < 420 ? 3 : W < 700 ? 4 : 6;
  const rotulos = n <= 1 ? [0] : Array.from({ length: Math.min(qtdRotulos, n) }, (_, k) => Math.round((k / (Math.min(qtdRotulos, n) - 1)) * (n - 1)));

  const resumo = series.map((s) => {
    const total = s.valores.reduce((a, b) => a + b, 0);
    const pico = Math.max(...s.valores);
    return `${s.nome}: total ${fmt(formato, total)}, máximo ${fmt(formato, pico)} em ${ddmm(datas[s.valores.indexOf(pico)] ?? datas[0] ?? "")}`;
  }).join(". ");

  const mover = (clientX: number) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const px = clientX - r.left - pad.l;
    setIdx(Math.max(0, Math.min(n - 1, Math.round((px / (iw || 1)) * (n - 1)))));
  };
  const teclado = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === "ArrowRight") { e.preventDefault(); setIdx((i) => Math.min(n - 1, (i ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => Math.max(0, (i ?? n) - 1)); }
    else if (e.key === "Home") setIdx(0);
    else if (e.key === "End") setIdx(n - 1);
    else if (e.key === "Escape") setIdx(null);
  };

  if (vazio) return <div className="empty chart-empty" role="status">Sem movimento neste período.</div>;

  const tipEsq = idx != null && x(idx) > W * 0.62;
  return (
    <div
      className="chart"
      ref={caixa}
      tabIndex={0}
      onPointerMove={(e) => mover(e.clientX)}
      onPointerDown={(e) => mover(e.clientX)}
      onPointerLeave={() => setIdx(null)}
      onBlur={() => setIdx(null)}
      onKeyDown={teclado}
      aria-label={`${titulo}. Use as setas para ver cada dia.`}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${titulo}. ${resumo}`}>
        <g className="ch-axis">
          {esc.ticks.map((t) => (
            <g key={t}>
              <line className="ch-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{compacto(t)}</text>
            </g>
          ))}
          {rotulos.map((i, k) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={k === 0 && n > 1 ? "start" : k === rotulos.length - 1 && n > 1 ? "end" : "middle"}>{ddmm(datas[i])}</text>
          ))}
        </g>
        {series.map((s, si) => {
          const comArea = s.area ?? si === 0;
          const gid = `${id}g${si}`;
          return (
            <g key={s.nome} className={`ser c-${s.cor}`}>
              {comArea && (
                <>
                  <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={`${caminho(s.valores)} L${x(n - 1).toFixed(1)} ${y(Math.max(esc.min, 0)).toFixed(1)} L${x(0).toFixed(1)} ${y(Math.max(esc.min, 0)).toFixed(1)} Z`} fill={`url(#${gid})`} />
                </>
              )}
              <path className="ln" d={caminho(s.valores)} strokeDasharray={s.tracejado ? "5 4" : undefined} />
              {idx != null && <circle className="pt" cx={x(idx)} cy={y(s.valores[idx] ?? 0)} r={4} />}
            </g>
          );
        })}
        {idx != null && <line className="ch-cursor" x1={x(idx)} x2={x(idx)} y1={pad.t} y2={H - pad.b} />}
      </svg>
      {idx != null && (
        <div className="ch-tip" style={{ left: tipEsq ? undefined : x(idx) + 12, right: tipEsq ? W - x(idx) + 12 : undefined, top: 6 }} aria-hidden="true">
          <div className="ch-tip-d">{ddmm(datas[idx])}</div>
          {series.map((s) => (
            <div key={s.nome} className="ch-tip-r"><span className={`sw c-${s.cor}`} /> {s.nome}: <b>{fmt(formato, s.valores[idx] ?? 0)}</b></div>
          ))}
        </div>
      )}
      <div className="sr" aria-live="polite">{idx != null ? `${ddmm(datas[idx])}: ${series.map((s) => `${s.nome} ${fmt(formato, s.valores[idx] ?? 0)}`).join(", ")}` : ""}</div>
    </div>
  );
}

export function Legenda({ itens }: { itens: Array<{ nome: string; cor: Serie["cor"]; tracejado?: boolean }> }) {
  return (
    <ul className="legend" aria-label="Legenda">
      {itens.map((i) => (
        <li key={i.nome}><span className={`sw c-${i.cor}${i.tracejado ? " dash" : ""}`} aria-hidden="true" /> {i.nome}</li>
      ))}
    </ul>
  );
}
