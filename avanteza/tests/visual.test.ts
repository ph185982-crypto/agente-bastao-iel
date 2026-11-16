// Interface "vidro": contraste AA no pior caso do fundo, fonte moderna, menu lateral e fallback sem backdrop-filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_INIT_SCRIPT, THEME_KEY } from "../src/lib/theme";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const read = (p: string) => readFileSync(join(root, p), "utf8");

type RGB = [number, number, number];
const block = (sel: string) => {
  const i = css.indexOf(sel + " {");
  assert.ok(i >= 0, `bloco ${sel} ausente`);
  return css.slice(i, css.indexOf("\n}", i));
};
const darkBlock = block(':root, :root[data-theme="dark"]');
const lightBlock = block(':root[data-theme="light"]');
/** Token do tema: o bloco do tema vale mais; o que ele não redefine vem do escuro (base). */
const tokIn = (theme: "dark" | "light") => (n: string) => {
  for (const b of theme === "light" ? [lightBlock, darkBlock] : [darkBlock]) {
    const m = b.match(new RegExp(`--${n}:\\s*([^;]+);`));
    if (m) return m[1].trim();
  }
  assert.fail(`token --${n} ausente (${theme})`);
};
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const rgbTriplet = (v: string): RGB => v.split(/\s+/).map(Number) as RGB;
const over = (bg: RGB, fg: RGB, a: number): RGB => bg.map((c, i) => c * (1 - a) + fg[i] * a) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Pior caso do fundo em cada tema: as orbes ficam em cantos opostos e nunca se sobrepõem. O pior fundo é o que dá MENOS
// contraste com o texto: no escuro, o mais claro (pico da orbe mais clara); no claro, o mais escuro (pico da orbe mais escura).
// Por cima, vidro forte + vidro padrão empilhados (cartão com indicador dentro).
function ambiente(theme: "dark" | "light") {
  const t = tokIn(theme);
  const bg = hex(t("bg"));
  const peaks = [over(bg, hex(t("orange")), Number(t("orb-orange-a"))), over(bg, hex(t("blue")), Number(t("orb-blue-a")))];
  const base = peaks.sort((x, y) => (theme === "dark" ? lum(y) - lum(x) : lum(x) - lum(y)))[0];
  const glass = rgbTriplet(t("glass-rgb"));
  const surface = over(over(base, glass, Number(t("glass-strong-a"))), glass, Number(t("glass-a")));
  return { t, bg, base, surface, navy: hex(t("navy")), white: [255, 255, 255] as RGB };
}

for (const theme of ["dark", "light"] as const) {
  const { t, base, surface, navy, white } = ambiente(theme);

  test(`[${theme}] texto sobre vidro e fundo: contraste mínimo AA (4,5:1) no pior caso`, () => {
    for (const n of ["text", "muted", "heading", "orange-2", "ok", "danger", "warn"]) {
      const r = ratio(hex(t(n)), surface);
      assert.ok(r >= 4.5, `--${n} sobre vidro: ${r.toFixed(2)}`);
      const r2 = ratio(hex(t(n)), base);
      assert.ok(r2 >= 4.5, `--${n} sobre fundo: ${r2.toFixed(2)}`);
    }
  });

  test(`[${theme}] texto marinho sobre laranja e areia (botão principal, item ativo, pílulas)`, () => {
    assert.ok(ratio(navy, hex(t("orange"))) >= 4.5);
    assert.ok(ratio(navy, hex(t("sand"))) >= 4.5);
    assert.ok(ratio(navy, over(hex(t("orange")), white, 0.06)) >= 4.5, "hover do laranja");
    assert.ok(ratio(navy, hex("#FF7A36")) >= 4.5, "hover do botão");
  });

  test(`[${theme}] pílulas e botão de perigo tingidos sobre o vidro`, () => {
    const okBg = over(surface, theme === "dark" ? [16, 185, 129] : [16, 185, 129], theme === "dark" ? 0.2 : 0.15);
    const bad = over(surface, theme === "dark" ? [239, 68, 68] : [220, 38, 38], theme === "dark" ? 0.3 : 0.18); // hover do btn-danger
    assert.ok(ratio(hex(t("ok")), okBg) >= 4.5, "pill-ok");
    assert.ok(ratio(hex(t("danger")), bad) >= 4.5, "pill/btn-danger");
    assert.match(t("ok-bg"), theme === "dark" ? /0\.2\)/ : /0\.15\)/);
  });

  test(`[${theme}] campos: texto e placeholder legíveis (também em foco)`, () => {
    const shade = rgbTriplet(t("shade"));
    const field = over(base, shade, Number(t("field-a")));
    const focus = over(base, shade, Number(t("field-a")) + 0.15);
    for (const f of [field, focus]) {
      assert.ok(ratio(hex(t("text")), f) >= 4.5, "texto");
      assert.ok(ratio(hex(t("placeholder")), f) >= 4.5, "placeholder");
    }
  });

  test(`[${theme}] miniatura sem foto: inicial legível sobre o fallback`, () => {
    const tint = rgbTriplet(t("tint"));
    const ph = over(over(surface, [255, 106, 31], 0.14), tint, 0.04);
    assert.ok(ratio(hex(t("text")), ph) >= 4.5, "inicial");
  });
}

test("tema claro: fundo creme, texto marinho; escuro continua o padrão", () => {
  assert.equal(tokIn("light")("bg").toUpperCase(), "#F5F0E6");
  assert.equal(tokIn("light")("text").toUpperCase(), "#0B1B33");
  assert.equal(tokIn("dark")("bg").toUpperCase(), "#0B1B33");
  assert.match(css, /:root, :root\[data-theme="dark"\]/);
});

test("sem cores fixas nos componentes: telas e componentes só usam tokens (nada de #hex, rgb(), white)", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) files.push(p);
    }
  };
  walk("src/app"); walk("src/components");
  for (const f of files) {
    const src = read(f).replace(/themeColor: "#[0-9A-Fa-f]{6}"/, "");
    assert.doesNotMatch(src, /#[0-9A-Fa-f]{3,8}\b(?![\w-])/, `${f}: cor fixa`);
    assert.doesNotMatch(src, /\brgba?\(\s*\d/, `${f}: rgb() fixo`);
    assert.doesNotMatch(src, /color:\s*"?(white|black)\b/i, `${f}: white/black fixo`);
    assert.doesNotMatch(src, /var\(--(cream|sand|navy|white)\)/, `${f}: token de marca fixo em vez de token de tema`);
  }
});

test("CSS: só tokens de marca fixos nos pontos com texto marinho sobre laranja; o resto usa tokens do tema", () => {
  const body = css.slice(css.indexOf("*, *::before")).replace(/background: var\(--navy\); color: var\(--cream\)/g, "");
  assert.doesNotMatch(body, /rgba\(255, 255, 255/, "vidro/realces claros devem vir de --tint/--glass-rgb");
  assert.doesNotMatch(body, /rgba\(7, 15, 30/, "superfícies afundadas devem vir de --shade");
  assert.doesNotMatch(body, /color:\s*var\(--(cream|sand)\)/, "texto usa --text/--heading, que mudam com o tema");
});

test("seletor de tema: botão acessível em todas as telas com AppShell e no login, aplicado antes da hidratação", () => {
  const toggle = read("src/components/ThemeToggle.tsx");
  assert.match(toggle, /aria-label=\{label\}/);
  assert.match(toggle, /Mudar para o tema (claro|escuro)/);
  assert.match(toggle, /localStorage\.setItem/);
  assert.match(toggle, /document\.cookie/);
  assert.match(read("src/lib/theme.ts"), /prefers-color-scheme: light/);
  assert.match(toggle, /try \{ localStorage\.setItem/);
  assert.match(read("src/app/layout.tsx"), /THEME_INIT_SCRIPT/);
  assert.match(read("src/app/layout.tsx"), /suppressHydrationWarning/);
  assert.match(read("src/components/shell/AppShell.tsx"), /<ThemeToggle/);
  assert.match(read("src/app/login/LoginForm.tsx"), /<ThemeToggle/);
});

test("script de tema: escolha lembrada vence; sem escolha segue o sistema; falhas de storage não quebram", () => {
  const run = (store: Record<string, string> | "throw", cookie: string, light: boolean) => {
    const attrs: Record<string, string> = {};
    const g: any = {
      document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, cookie },
      window: { matchMedia: () => ({ matches: light }) },
      localStorage: store === "throw" ? { getItem() { throw new Error("bloqueado"); } } : { getItem: (k: string) => store[k] ?? null },
    };
    new Function("document", "window", "localStorage", THEME_INIT_SCRIPT)(g.document, g.window, g.localStorage);
    return attrs["data-theme"];
  };
  assert.equal(run({ [THEME_KEY]: "light" }, "", false), "light");
  assert.equal(run({}, `${THEME_KEY}=light`, false), "light", "cookie quando não há localStorage");
  assert.equal(run("throw", `x=1; ${THEME_KEY}=dark`, true), "dark", "localStorage bloqueado → cookie");
  assert.equal(run({}, "", true), "light", "primeira visita: prefers-color-scheme");
  assert.equal(run({}, "", false), "dark");
  assert.equal(run({ [THEME_KEY]: "lixo" }, "", true), "light", "valor inválido é ignorado");
});

test("fonte moderna única via next/font, sem Instrument Serif", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /Plus_Jakarta_Sans/);
  assert.match(layout, /weight:\s*\["400", "500", "600", "700", "800"\]/);
  assert.doesNotMatch(layout + css, /Instrument/i);
  assert.doesNotMatch(layout, /fonts\.googleapis/);
  assert.doesNotMatch(css, /Manrope/);
});

test("formas: cartões 22px, inputs 14px, botões e pílulas totalmente redondos", () => {
  const t = tokIn("dark");
  assert.equal(t("radius"), "22px");
  assert.equal(t("radius-md"), "14px");
  assert.equal(t("radius-pill"), "999px");
  assert.match(css, /\.btn \{[^}]*border-radius: var\(--radius-pill\)/);
  assert.match(css, /\.pill \{[^}]*border-radius: var\(--radius-pill\)/);
});

test("vidro com fallback e animações respeitam prefers-reduced-motion", () => {
  assert.match(css, /backdrop-filter: blur/);
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /[^-]filter:\s*blur/, "sem blur de filtro pesado nas orbes");
});

test("menu lateral: AppShell com sidebar e gaveta, usado por painel, Mapa, Central e Usuários", () => {
  const shell = read("src/components/shell/AppShell.tsx");
  assert.match(shell, /className="sidebar"/);
  assert.match(shell, /aria-label="Abrir menu"/);
  assert.match(css, /\.sidebar \{[^}]*position: fixed/);
  assert.match(css, /\.sb-link\[aria-current="page"\] \{[^}]*background: var\(--orange\)/);
  for (const f of ["src/components/Shell.tsx", "src/app/mapa/layout.tsx", "src/app/central/page.tsx", "src/app/usuarios/page.tsx"]) {
    assert.match(read(f), /AppShell/, f);
  }
  assert.match(read("src/app/mapa/layout.tsx"), /top=\{[^}]*CompanySwitch/, "seletor de empresa no topo da sidebar");
  assert.match(read("src/app/mapa/layout.tsx"), /Visualizando como/);
});
