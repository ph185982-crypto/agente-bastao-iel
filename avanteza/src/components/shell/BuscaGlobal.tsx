"use client";
// Busca global da equipe: paleta de comandos (Ctrl/Cmd+K ou a lupa). Páginas do menu e ações rápidas filtram aqui mesmo;
// clientes, ações do Motor, aprovações e o Comercial vêm de /api/busca (debounce, mínimo 2 caracteres, limite por grupo).
// Teclado: ↑/↓ (e Home/End) percorrem, Enter abre, Esc volta/fecha. Acessível: diálogo modal com combobox + listbox.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { filtrarLocal } from "@/lib/busca/texto";
import { MIN_CARACTERES, ROTULO_GRUPO, type AvisoBusca, type GrupoBusca, type ItemBusca, type RespostaBusca } from "@/lib/busca/tipos";
import "./busca.css";

const DEBOUNCE_MS = 220;

export function BuscaGlobal({ paginas, rapidas, className = "" }: { paginas: ItemBusca[]; rapidas: ItemBusca[]; className?: string }) {
  const router = useRouter();
  const uid = useId().replace(/:/g, "");
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [modo, setModo] = useState<ItemBusca | null>(null); // ação rápida que pede um cliente
  const [remotos, setRemotos] = useState<GrupoBusca[]>([]);
  const [avisos, setAvisos] = useState<AvisoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const abrir = useCallback(() => { setAberto(true); setQ(""); setModo(null); setRemotos([]); setAvisos([]); setAtivo(0); }, []);
  const fechar = useCallback(() => { setAberto(false); setModo(null); requestAnimationFrame(() => botao.current?.focus()); }, []);

  // Atalho global. Há duas instâncias (sidebar e barra do celular): só a visível responde.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        if (raiz.current?.offsetParent === null) return;
        e.preventDefault();
        if (aberto) fechar(); else abrir();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto, abrir, fechar]);

  useEffect(() => {
    if (!aberto) return;
    campo.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [aberto]);

  // Busca no servidor (debounce + cancela a anterior).
  const termo = q.trim();
  useEffect(() => {
    if (!aberto || termo.length < MIN_CARACTERES) { setRemotos([]); setAvisos([]); setCarregando(false); return; }
    const ctl = new AbortController();
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ q: termo });
        if (modo) sp.set("grupos", "clientes");
        const r = await fetch(`/api/busca?${sp}`, { cache: "no-store", signal: ctl.signal });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as RespostaBusca;
        setRemotos(j.grupos); setAvisos(j.avisos);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setRemotos([]); setAvisos([{ grupo: "local", texto: "Não foi possível buscar agora. Páginas e ações rápidas continuam disponíveis." }]);
      } finally {
        if (!ctl.signal.aborted) setCarregando(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [termo, aberto, modo]);

  const grupos: GrupoBusca[] = useMemo(() => {
    if (modo) return remotos.filter((g) => g.id === "clientes");
    if (termo.length < MIN_CARACTERES) return rapidas.length ? [{ id: "acoes-rapidas", rotulo: ROTULO_GRUPO["acoes-rapidas"], itens: rapidas }] : [];
    const locais: GrupoBusca[] = [
      { id: "acoes-rapidas", rotulo: ROTULO_GRUPO["acoes-rapidas"], itens: filtrarLocal(rapidas, termo, 3) },
      { id: "paginas", rotulo: ROTULO_GRUPO.paginas, itens: filtrarLocal(paginas, termo) },
    ];
    return [...remotos, ...locais].filter((g) => g.itens.length > 0);
  }, [modo, remotos, termo, rapidas, paginas]);
  const planos = useMemo(() => grupos.flatMap((g) => g.itens.map((i) => ({ g: g.id, i }))), [grupos]);

  useEffect(() => setAtivo(0), [grupos]);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`#${uid}-op-${ativo}`)?.scrollIntoView({ block: "nearest" });
  }, [ativo, uid]);

  const escolher = (item: ItemBusca) => {
    if (item.pedeCliente) { setModo(item); setQ(""); setRemotos([]); campo.current?.focus(); return; }
    const href = modo ? modo.href.replace("{cliente}", encodeURIComponent(item.id)) : item.href;
    setAberto(false); setModo(null);
    if (item.ext) window.location.assign(href); else router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = planos.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) setAtivo((a) => (a + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) setAtivo((a) => (a - 1 + n) % n); }
    else if (e.key === "Home" && n && !q) { e.preventDefault(); setAtivo(0); }
    else if (e.key === "End" && n && !q) { e.preventDefault(); setAtivo(n - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const p = planos[ativo]; if (p) escolher(p.i); }
    else if (e.key === "Escape") { e.preventDefault(); if (modo) { setModo(null); setQ(""); } else fechar(); }
    else if (e.key === "Backspace" && !q && modo) { e.preventDefault(); setModo(null); }
    else if (e.key === "Tab") e.preventDefault(); // foco preso no campo (o resto é pela lista)
  };

  const curto = termo.length > 0 && termo.length < MIN_CARACTERES;
  const semResultado = termo.length >= MIN_CARACTERES && !carregando && planos.length === 0;
  const status = carregando ? "Buscando…" : curto ? `Digite ao menos ${MIN_CARACTERES} caracteres.` : semResultado ? `Nada encontrado para “${termo}”.` : termo.length >= MIN_CARACTERES ? `${planos.length} resultado(s).` : "";
  let k = -1;

  return (
    <div className={`busca ${className}`} ref={raiz}>
      <button
        ref={botao} type="button" className="icon-btn busca-btn" aria-haspopup="dialog" aria-expanded={aberto}
        aria-label="Buscar (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K" title="Buscar (Ctrl+K)" onClick={abrir}
      >
        <Icon name="search" />
      </button>
      {aberto && createPortal(
        <div className="busca-camada">
          <button type="button" className="busca-fundo" aria-label="Fechar busca" tabIndex={-1} onClick={fechar} />
          <div className="busca-painel" role="dialog" aria-modal="true" aria-label="Busca global">
            <div className="busca-topo">
              <Icon name="search" />
              {modo && <span className="pill pill-orange busca-modo">{modo.titulo}</span>}
              <input
                ref={campo} type="text" className="busca-campo" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder={modo ? "Para qual cliente?" : "Buscar clientes, ações, oportunidades, contratos, páginas…"}
                role="combobox" aria-expanded={planos.length > 0} aria-controls={`${uid}-lista`} aria-autocomplete="list"
                aria-activedescendant={planos.length ? `${uid}-op-${ativo}` : undefined} aria-label={modo ? `Cliente para: ${modo.titulo}` : "Buscar"}
                autoComplete="off" spellCheck={false} maxLength={80}
              />
              <kbd className="busca-kbd" aria-hidden="true">Esc</kbd>
            </div>
            <p className="busca-sr" role="status" aria-live="polite">{status}</p>
            <div className="busca-lista" id={`${uid}-lista`} role="listbox" aria-label="Resultados" ref={lista}>
              {grupos.map((g) => (
                <div key={g.id} role="group" aria-labelledby={`${uid}-g-${g.id}`} className="busca-grupo">
                  <div className="busca-grupo-tit" id={`${uid}-g-${g.id}`} role="presentation">{g.rotulo}</div>
                  {g.itens.map((i) => {
                    k++;
                    const idx = k;
                    return (
                      <div
                        key={`${g.id}:${i.id}`} id={`${uid}-op-${idx}`} role="option" aria-selected={idx === ativo}
                        className={`busca-op${idx === ativo ? " ativo" : ""}`}
                        onMouseMove={() => idx !== ativo && setAtivo(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(i)}
                      >
                        <span className="busca-ico" aria-hidden="true"><Icon name={i.icon ?? "doc"} /></span>
                        <span className="busca-txt">
                          <span className="busca-tit">{i.titulo}</span>
                          {i.detalhe && <span className="busca-det">{i.detalhe}</span>}
                        </span>
                        {(i.ext || i.pedeCliente) && <span className="busca-tag">{i.pedeCliente ? "escolher cliente" : "Comercial"}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
              {status && !planos.length && <p className="busca-vazio">{status}</p>}
              {!termo && <p className="busca-vazio">{modo ? "Digite o nome do cliente." : "Digite para buscar em clientes, ações do Motor, aprovações, Comercial e páginas."}</p>}
            </div>
            {avisos.length > 0 && <div className="busca-avisos">{avisos.map((a) => <p key={a.grupo} className="small">{a.texto}</p>)}</div>}
            <div className="busca-pe" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> {modo ? "voltar" : "fechar"}</span></div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
