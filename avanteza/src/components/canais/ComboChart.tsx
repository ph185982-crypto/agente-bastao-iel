"use client";
// Gráfico combinado em SVG próprio: barras (eixo esquerdo, ex.: investimento em R$) + linha (eixo direito, ex.: conversas).
// Mede o contêiner, dica ao passar o mouse/tocar e navegação por setas. Cores só por classes de token.
import { useEffect, useRef, useState } from "react";
import { brl, compacto, inteiro } from "@/lib/dashboards/format";
import { ddmm } from "@/lib/dashboards/periodo";
import { escalaBonita } from "@/components/dashboards/LineChart";

type Formato = "brl" | "inteiro";
const fmt = (f: Formato, v: number) => (f === "brl" ? brl(v, true) : inteiro(v));
const fmtEixo = (f: Formato, v: number) => (f === "brl" ? `R$ ${compacto(v)}` : compacto(v));

export function ComboChart({ datas, barras, linha, titulo, altura = 230, nomes }: {
  datas: string[];
  barras: { nome: string; valores: number[]; formato: Formato };
  linha: { nome: string; valores: number[]; formato: Formato };
  titulo: string; altura?: number;
  /** Rótulos no lugar de dd/mm (ex.: meses). */
  nomes?: string[];
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(260, Math.round(el.clientWidth)));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = datas.length;
  const lab = (i: number) => nomes?.[i] ?? ddmm(datas[i] ?? "");
  const vazio = n === 0 || (barras.valores.every((v) => v === 0) && linha.valores.every((v) => v === 0));
  if (vazio) return <div className="empty chart-empty" role="status">Sem movimento neste período.</div>;

  const eb = escalaBonita(Math.max(...barras.valores, 0), 0);
  const el = escalaBonita(Math.max(...linha.valores, 0), 0);
  const pad = { l: 52, r: largura < 420 ? 34 : 40, t: 10, b: 26 };
  const W = largura, H = altura, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const passo = iw / n;
  const cx = (i: number) => pad.l + passo * (i + 0.5);
  const yb = (v: number) => pad.t + ih - (v / (eb.max || 1)) * ih;
  const yl = (v: number) => pad.t + ih - (v / (el.max || 1)) * ih;
  const bw = Math.max(2, Math.min(26, passo * 0.62));
  const qtd = W < 420 ? 3 : W < 700 ? 4 : 6;
  const marcas = n <= 1 ? [0] : Array.from({ length: Math.min(qtd, n) }, (_, k) => Math.round((k / (Math.min(qtd, n) - 1)) * (n - 1)));
  const caminho = linha.valores.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${yl(v).toFixed(1)}`).join(" ");

  const mover = (x: number) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return;
    setIdx(Math.max(0, Math.min(n - 1, Math.floor((x - r.left - pad.l) / passo))));
  };
  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setIdx((i) => Math.min(n - 1, (i ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => Math.max(0, (i ?? n) - 1)); }
    else if (e.key === "Escape") setIdx(null);
  };
  const tot = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const resumo = `${barras.nome}: total ${fmt(barras.formato, tot(barras.valores))}. ${linha.nome}: total ${fmt(linha.formato, tot(linha.valores))}.`;
  const tipEsq = idx != null && cx(idx) > W * 0.6;

  return (
    <div className="chart" ref={caixa} tabIndex={0} onPointerMove={(e) => mover(e.clientX)} onPointerDown={(e) => mover(e.clientX)} onPointerLeave={() => setIdx(null)} onBlur={() => setIdx(null)} onKeyDown={teclado} aria-label={`${titulo}. Use as setas para ver cada ponto.`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${titulo}. ${resumo}`}>
        <g className="ch-axis">
          {eb.ticks.map((t) => (
            <g key={t}>
              <line className="ch-grid" x1={pad.l} x2={W - pad.r} y1={yb(t)} y2={yb(t)} />
              <text x={pad.l - 8} y={yb(t) + 4} textAnchor="end">{fmtEixo(barras.formato, t)}</text>
            </g>
          ))}
          {el.ticks.map((t) => <text key={t} x={W - pad.r + 6} y={yl(t) + 4} textAnchor="start">{fmtEixo(linha.formato, t)}</text>)}
          {marcas.map((i, k) => <text key={i} x={cx(i)} y={H - 6} textAnchor={k === 0 && n > 1 ? "start" : k === marcas.length - 1 && n > 1 ? "end" : "middle"}>{lab(i)}</text>)}
        </g>
        <g className="c-orange">
          {barras.valores.map((v, i) => <rect key={i} x={cx(i) - bw / 2} y={yb(v)} width={bw} height={Math.max(0, pad.t + ih - yb(v))} rx={Math.min(3, bw / 2)} fill="currentColor" opacity={idx === i ? 0.75 : 0.42} />)}
        </g>
        <g className="ser c-heading">
          <path className="ln" d={caminho} />
          {idx != null && <circle className="pt" cx={cx(idx)} cy={yl(linha.valores[idx] ?? 0)} r={4} />}
        </g>
      </svg>
      {idx != null && (
        <div className="ch-tip" style={{ left: tipEsq ? undefined : cx(idx) + 12, right: tipEsq ? W - cx(idx) + 12 : undefined, top: 6 }} aria-hidden="true">
          <div className="ch-tip-d">{lab(idx)}</div>
          <div className="ch-tip-r"><span className="sw c-orange" /> {barras.nome}: <b>{fmt(barras.formato, barras.valores[idx] ?? 0)}</b></div>
          <div className="ch-tip-r"><span className="sw c-heading" /> {linha.nome}: <b>{fmt(linha.formato, linha.valores[idx] ?? 0)}</b></div>
        </div>
      )}
      <div className="sr" aria-live="polite">{idx != null ? `${lab(idx)}: ${barras.nome} ${fmt(barras.formato, barras.valores[idx] ?? 0)}, ${linha.nome} ${fmt(linha.formato, linha.valores[idx] ?? 0)}` : ""}</div>
    </div>
  );
}
