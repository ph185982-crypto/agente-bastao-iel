"use client";
// Sino de notificações da equipe (contrato assinado, cliente novo, acesso ao Mapa, captura registrada, evento com falha).
// Busca a contagem ao montar (só a instância visível: sidebar no computador, barra superior no celular) e a lista ao abrir.
// A senha inicial do cliente aparece UMA vez (só para administrador) e some do servidor depois de exibida.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import "./sino.css";

type Item = { id: string; tipo: string; titulo: string; corpo: string | null; link: string | null; criado_em: string; lida: boolean; temSegredo: boolean };

const quando = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export function NotificacoesSino({ className = "" }: { className?: string }) {
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [segredos, setSegredos] = useState<Record<string, string>>({});
  const raiz = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/notificacoes", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { itens: Item[]; naoLidas: number };
      setItens(j.itens); setNaoLidas(j.naoLidas); setErro(null);
    } catch {
      setErro("Não foi possível carregar as notificações.");
    }
  }, []);

  useEffect(() => {
    if (raiz.current?.offsetParent === null) return; // instância escondida (outro tamanho de tela)
    carregar();
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(); }, 120_000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { const t = e.target as Node; if (!raiz.current?.contains(t) && !painel.current?.contains(t)) setAberto(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  const post = async (corpo: Record<string, string>) => {
    const r = await fetch("/api/notificacoes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    return { ok: r.ok, json: (await r.json().catch(() => ({}))) as { segredo?: string; error?: string } };
  };
  const ler = async (id: string) => {
    setItens((xs) => xs?.map((x) => (x.id === id ? { ...x, lida: true } : x)) ?? null);
    setNaoLidas((n) => Math.max(0, n - (itens?.find((x) => x.id === id && !x.lida) ? 1 : 0)));
    await post({ acao: "lida", id });
  };
  const lerTodas = async () => {
    setItens((xs) => xs?.map((x) => ({ ...x, lida: true })) ?? null);
    setNaoLidas(0);
    await post({ acao: "todas" });
  };
  const revelar = async (id: string) => {
    const r = await post({ acao: "revelar", id });
    setSegredos((s) => ({ ...s, [id]: r.json.segredo ?? `!${r.json.error ?? "Indisponível."}` }));
    setItens((xs) => xs?.map((x) => (x.id === id ? { ...x, temSegredo: false, lida: true } : x)) ?? null);
  };

  return (
    <div className={`sino ${className}`} ref={raiz}>
      <button
        type="button" className="icon-btn sino-btn" aria-haspopup="dialog" aria-expanded={aberto}
        aria-label={naoLidas ? `Notificações: ${naoLidas} não lida(s)` : "Notificações"}
        onClick={() => { setAberto((v) => !v); if (!aberto) carregar(); }}
      >
        <Icon name="bell" />
        {naoLidas > 0 && <span className="sino-n" aria-hidden="true">{naoLidas > 99 ? "99+" : naoLidas}</span>}
      </button>
      {/* O painel vai para o <body>: a sidebar de vidro (backdrop-filter) prenderia um position: fixed dentro dela. */}
      {aberto && createPortal(
        <div className="sino-painel" role="dialog" aria-label="Notificações" ref={painel}>
          <div className="sino-topo">
            <strong>Notificações</strong>
            {naoLidas > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={lerTodas}>Marcar todas como lidas</button>}
          </div>
          {erro && <p className="small muted" role="alert">{erro}</p>}
          {itens && !itens.length && <p className="small muted sino-vazio">Nada por aqui ainda.</p>}
          <ul className="sino-lista">
            {itens?.map((n) => (
              <li key={n.id} className={n.lida ? "lida" : "nova"}>
                <div className="sino-tit">
                  {!n.lida && <span className="sino-ponto" aria-label="não lida" />}
                  {n.link ? <Link href={n.link} onClick={() => { ler(n.id); setAberto(false); }}>{n.titulo}</Link> : <span>{n.titulo}</span>}
                </div>
                {n.corpo && <p className="sino-corpo">{n.corpo}</p>}
                {segredos[n.id] && (
                  segredos[n.id].startsWith("!")
                    ? <p className="small muted">{segredos[n.id].slice(1)}</p>
                    : <div className="sino-segredo"><span className="small muted">Senha inicial (não aparece de novo):</span><code>{segredos[n.id]}</code></div>
                )}
                <div className="sino-pe">
                  <span className="small muted">{quando(n.criado_em)}</span>
                  <span className="btn-row">
                    {n.temSegredo && <button type="button" className="btn btn-sm btn-orange" onClick={() => revelar(n.id)}>Mostrar senha (uma vez)</button>}
                    {!n.lida && !n.temSegredo && <button type="button" className="btn btn-sm btn-ghost" onClick={() => ler(n.id)}>Marcar como lida</button>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
