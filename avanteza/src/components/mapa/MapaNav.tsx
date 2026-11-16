"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MapaNav({ items, bottom = false }: { items: { href: string; label: string }[]; bottom?: boolean }) {
  const path = usePathname() ?? "";
  const isCur = (href: string) => (href === "/mapa" ? path === "/mapa" : path === href || path.startsWith(href + "/"));
  return (
    <nav className={bottom ? "mapa-bottom" : "mapa-nav"} aria-label="Mapa">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={isCur(i.href) ? "page" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
