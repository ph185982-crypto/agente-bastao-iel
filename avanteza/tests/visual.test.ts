// Interface "vidro": contraste AA no pior caso do fundo, fonte moderna, menu lateral e fallback sem backdrop-filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const read = (p: string) => readFileSync(join(root, p), "utf8");

type RGB = [number, number, number];
const tok = (n: string) => {
  const m = css.match(new RegExp(`--${n}:\\s*([^;]+);`));
  assert.ok(m, `token --${n} ausente`);
  return m![1].trim();
};
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const over = (bg: RGB, fg: RGB, a: number): RGB => bg.map((c, i) => c * (1 - a) + fg[i] * a) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Pior caso do fundo: as orbes ficam em cantos opostos e nunca se sobrepõem, então vale a mais clara das duas no pico;
// por cima, vidro forte + vidro padrão empilhados (cartão com indicador dentro).
const navy = hex(tok("navy"));
const white: RGB = [255, 255, 255];
const peaks = [over(navy, hex(tok("orange")), Number(tok("orb-orange-a"))), over(navy, hex(tok("blue")), Number(tok("orb-blue-a")))];
const base = peaks.sort((x, y) => lum(y) - lum(x))[0];
const surface = over(over(base, white, Number(tok("glass-strong-a"))), white, Number(tok("glass-a")));

test("texto sobre vidro: contraste mínimo AA (4,5:1) no pior caso", () => {
  for (const n of ["text", "muted", "sand", "orange-2", "ok", "danger", "warn"]) {
    const r = ratio(hex(tok(n)), surface);
    assert.ok(r >= 4.5, `--${n} sobre vidro: ${r.toFixed(2)}`);
    const r2 = ratio(hex(tok(n)), base);
    assert.ok(r2 >= 4.5, `--${n} sobre fundo: ${r2.toFixed(2)}`);
  }
});

test("texto marinho sobre laranja e areia (botão principal, item ativo, pílulas)", () => {
  assert.ok(ratio(navy, hex(tok("orange"))) >= 4.5);
  assert.ok(ratio(navy, hex(tok("sand"))) >= 4.5);
  assert.ok(ratio(navy, over(hex(tok("orange")), white, 0.06)) >= 4.5, "hover do laranja");
});

test("pílulas e botão de perigo tingidos sobre o vidro", () => {
  const ok = over(surface, [16, 185, 129], 0.2);
  const bad = over(surface, [239, 68, 68], 0.26);
  assert.ok(ratio(hex(tok("ok")), ok) >= 4.5, "pill-ok");
  assert.ok(ratio(hex(tok("danger")), bad) >= 4.5, "pill/btn-danger");
});

test("campos escuros: texto creme e placeholder legíveis", () => {
  const field = over(base, [7, 15, 30], 0.7);
  assert.ok(ratio(hex(tok("text")), field) >= 4.5);
  assert.ok(ratio(hex("#9AA6B9"), field) >= 4.5, "placeholder");
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
  assert.equal(tok("radius"), "22px");
  assert.equal(tok("radius-md"), "14px");
  assert.equal(tok("radius-pill"), "999px");
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
