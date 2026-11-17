"use client";
// Alternador de tema claro/escuro. O tema inicial é aplicado antes da hidratação por THEME_INIT_SCRIPT (layout.tsx);
// aqui só alternamos e lembramos a escolha (localStorage + cookie, ambos com try/catch).
import { useEffect, useState } from "react";
import { THEME_KEY, THEME_COLORS, type Theme } from "@/lib/theme";

function remember(t: Theme) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* navegação privada: segue só nesta aba */ }
  try { document.cookie = `${THEME_KEY}=${t}; path=/; max-age=31536000; samesite=lax`; } catch { /* sem cookie */ }
}

function apply(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[t]);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    setTheme(t);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[t]);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Mudar para o tema claro" : "Mudar para o tema escuro";
  return (
    <button
      type="button"
      className={`icon-btn theme-toggle ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={() => { setTheme(next); apply(next); remember(next); }}
    >
      <svg className="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      <svg className="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
    </button>
  );
}
