"use client";
// Casca única do app: sidebar de vidro (desktop) / barra superior + gaveta (celular).
// Admin e cliente (Mapa) usam a mesma. Itens e grupos vêm do servidor como dados simples.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "../Logo";
import { Icon } from "./Icons";
import { ThemeToggle } from "../ThemeToggle";
import { SIDEBAR_KEY, type SidebarState } from "@/lib/theme";

function lembrarMenu(v: SidebarState) {
  try { localStorage.setItem(SIDEBAR_KEY, v); } catch { /* navegação privada: vale só nesta aba */ }
  try { document.cookie = `${SIDEBAR_KEY}=${v}; path=/; max-age=31536000; samesite=lax`; } catch { /* sem cookie */ }
}

/** `ext`: abre outro aplicativo (login único); usa <a> comum, sem pré-carregar a rota de redirecionamento. */
export type NavItem = { href: string; label: string; icon: string; badge?: number; exact?: boolean; ext?: boolean };
/** `href`: o rótulo do grupo vira link para a página de entrada do departamento. */
export type NavGroup = { label?: string; href?: string; items: NavItem[] };

export function AppShell({
  groups,
  tag,
  homeHref = "/",
  top,
  bottom,
  banner,
  acoesSidebar,
  acoesBarra,
  children,
}: {
  groups: NavGroup[];
  /** Etiqueta ao lado da marca (ex.: "Mapa"). */
  tag?: string;
  homeHref?: string;
  /** Topo da sidebar, abaixo da marca (ex.: seletor de empresa). */
  top?: React.ReactNode;
  /** Rodapé da sidebar (ex.: usuário e sair). */
  bottom?: React.ReactNode;
  /** Faixas acima do conteúdo (ex.: "Visualizando como …"). */
  banner?: React.ReactNode;
  /** Botões ao lado do seletor de tema (ex.: sino de notificações da equipe), na sidebar e na barra do celular. */
  acoesSidebar?: React.ReactNode;
  acoesBarra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  // O visual do menu recolhido vem do atributo data-sidebar no <html>, posto por um script antes da pintura (sem flash).
  // Aqui só espelhamos o estado para o botão, o aria-pressed e os rótulos de dica.
  const [recolhido, setRecolhido] = useState(false);
  useEffect(() => setRecolhido(document.documentElement.getAttribute("data-sidebar") === "collapsed"), []);
  const alternarMenu = () => {
    const prox: SidebarState = recolhido ? "expanded" : "collapsed";
    if (prox === "collapsed") document.documentElement.setAttribute("data-sidebar", "collapsed");
    else document.documentElement.removeAttribute("data-sidebar");
    lembrarMenu(prox);
    setRecolhido(prox === "collapsed");
  };
  const current = (i: NavItem) => (i.ext ? false : i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  // Em vários itens com prefixo comum, vale o mais específico.
  const all = groups.flatMap((g) => g.items);
  const best = all.filter(current).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => setOpen(false), [path]);
  // O menu por departamentos é comprido: deixa o item da página atual à vista dentro da lista rolável.
  useEffect(() => {
    document.querySelector<HTMLElement>('.sb-nav [aria-current="page"].sb-link')?.scrollIntoView({ block: "nearest" });
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className={`shell${open ? " open" : ""}`}>
      <button type="button" className="scrim" aria-label="Fechar menu" tabIndex={-1} onClick={() => setOpen(false)} />
      <aside className="sidebar" id="menu-lateral" aria-label="Menu lateral">
        <div className="sb-brand">
          <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
            <Link href={homeHref} style={{ textDecoration: "none" }} aria-label="Início">
              <Logo />
            </Link>
            {tag && <span className="pill pill-orange">{tag}</span>}
          </div>
          <Link href={homeHref} className="sb-mark" aria-label="Início"><span aria-hidden="true">a<i /></span></Link>
          {acoesSidebar}
          <ThemeToggle className="sb-theme" />
          <button type="button" className="icon-btn sb-close" aria-label="Fechar menu" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {top && <div className="sb-top">{top}</div>}
        <nav className="sb-nav" aria-label="Principal">
          {groups.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.label}>
              {g.label && (
                <div className="sb-label">
                  {g.href ? <Link href={g.href} aria-current={path === g.href ? "page" : undefined}>{g.label}</Link> : g.label}
                </div>
              )}
              {g.items.map((i) => {
                const conteudo = (
                  <>
                    <Icon name={i.icon} />
                    <span className="sb-text">{i.label}</span>
                    {i.badge ? <span className="sb-badge" aria-label={`${i.badge} pendentes`}>{i.badge}</span> : null}
                  </>
                );
                return i.ext ? (
                  <a key={i.href} href={i.href} className="sb-link" title={recolhido ? i.label : undefined}>{conteudo}</a>
                ) : (
                  <Link key={i.href} href={i.href} className="sb-link" title={recolhido ? i.label : undefined} aria-current={i.href === best ? "page" : undefined}>{conteudo}</Link>
                );
              })}
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="sb-collapse"
          onClick={alternarMenu}
          aria-pressed={recolhido}
          aria-controls="menu-lateral"
          title={recolhido ? "Expandir menu" : "Recolher menu"}
        >
          <Icon name={recolhido ? "chevrons-right" : "chevrons-left"} />
          <span className="sb-text">{recolhido ? "Expandir menu" : "Recolher menu"}</span>
        </button>
        {bottom && <div className="sb-foot">{bottom}</div>}
      </aside>
      <div className="shell-body">
        <header className="mobilebar">
          <div className="mb-left">
            <button type="button" className="icon-btn" aria-label="Abrir menu" aria-expanded={open} aria-controls="menu-lateral" onClick={() => setOpen(true)}>
              <Icon name="menu" />
            </button>
            <Link href={homeHref} style={{ textDecoration: "none" }} aria-label="Início"><Logo size={20} /></Link>
          </div>
          <div className="mb-left">
            {tag && <span className="pill pill-orange">{tag}</span>}
            {acoesBarra}
            <ThemeToggle />
          </div>
        </header>
        {banner}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
