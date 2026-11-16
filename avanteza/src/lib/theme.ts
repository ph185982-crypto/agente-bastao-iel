// Tema claro/escuro: chave de armazenamento e script que roda no <head> (fica fora do componente cliente para o
// layout, que é servidor, conseguir usar a string).
export const THEME_KEY = "avanteza-tema";
export type Theme = "light" | "dark";
export const THEME_COLORS: Record<Theme, string> = { dark: "#0B1B33", light: "#F5F0E6" };

/** Roda no <head>, antes da pintura: lembrado (localStorage > cookie) ou preferência do sistema; padrão escuro. */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}
if(t!=="light"&&t!=="dark"){t=null;try{var m=document.cookie.match(/(?:^|; )${THEME_KEY}=(light|dark)/);if(m)t=m[1]}catch(e){}}
if(!t){try{t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){t="dark"}}
d.setAttribute("data-theme",t)})();`;

