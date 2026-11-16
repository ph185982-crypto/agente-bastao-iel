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


// Menu lateral recolhido (só telas largas): lembrado em localStorage e, se não houver, em cookie. O script roda no <head>,
// antes da pintura, e põe data-sidebar="collapsed" no <html>; o CSS faz o resto (sem flash e sem esperar a hidratação).
export const SIDEBAR_KEY = "avanteza-menu";
export type SidebarState = "expanded" | "collapsed";
export const SIDEBAR_INIT_SCRIPT = `(function(){var d=document.documentElement,v=null;try{v=localStorage.getItem("${SIDEBAR_KEY}")}catch(e){}
if(v!=="collapsed"&&v!=="expanded"){v=null;try{var m=document.cookie.match(/(?:^|; )${SIDEBAR_KEY}=(collapsed|expanded)/);if(m)v=m[1]}catch(e){}}
if(v==="collapsed")d.setAttribute("data-sidebar","collapsed")})();`;
