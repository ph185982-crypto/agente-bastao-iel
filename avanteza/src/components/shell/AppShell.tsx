"use client";
// Casca única do app: sidebar de vidro (desktop) / barra superior + gaveta (celular).
// Admin e cliente (Mapa) usam a mesma. Itens e grupos vêm do servidor como dados simples.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "../Logo";
import { Icon } from "./Icons";

export type NavItem = { href: string; label: string; icon: string; badge?: number; exact?: boolean };
export type NavGroup = { label?: string; items: NavItem[] };

export function AppShell({
  groups,
  tag,
  homeHref = "/",
  top,
  bottom,
  banner,
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
  children: React.ReactNode;
}) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const current = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  // Em vários itens com prefixo comum, vale o mais específico.
  const all = groups.flatMap((g) => g.items);
  const best = all.filter(current).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => setOpen(false), [path]);
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
          <button type="button" className="icon-btn sb-close" aria-label="Fechar menu" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {top && <div className="sb-top">{top}</div>}
        <nav className="sb-nav" aria-label="Principal">
          {groups.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.label}>
              {g.label && <div className="sb-label">{g.label}</div>}
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="sb-link" aria-current={i.href === best ? "page" : undefined}>
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                  {i.badge ? <span className="sb-badge" aria-label={`${i.badge} pendentes`}>{i.badge}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
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
          {tag && <span className="pill pill-orange">{tag}</span>}
        </header>
        {banner}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
