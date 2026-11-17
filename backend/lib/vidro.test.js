// Visual "vidro" (kit Avanteza) no Conteúdo: tokens do kit copiados sem mudança, tema e menu aplicados antes da pintura,
// fonte própria com licença, menu lateral no desenho da Central e contraste AA (4,5:1) no PIOR caso do fundo, nos dois temas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const kit = ler('packages/avanteza-kit/tokens.css');
const copia = ler('static/avanteza-tokens.css');
const vidro = ler('static/vidro.css');
const html = ler('static/index.html');
const mesa = ler('static/mesa.js');

// ── cores ──
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const sobre = (fundo, cor, a) => fundo.map((c, i) => c * (1 - a) + cor[i] * a);
const lum = ([r, g, b]) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── tokens por tema: o bloco do tema vale mais; o que ele não redefine vem do escuro (base) ──
const bloco = (css, sel) => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, `bloco ${sel} ausente`); return css.slice(i, css.indexOf('\n}', i)); };
const blocos = (tema) => [
  ...(tema === 'light' ? [bloco(vidro, ':root[data-theme="light"]'), bloco(copia, ':root[data-theme="light"]')] : []),
  bloco(vidro, ':root, :root[data-theme="dark"]'), bloco(copia, ':root, :root[data-theme="dark"]'),
];
function tok(tema) {
  const bs = blocos(tema);
  const bruto = (n) => { for (const b of bs) { const m = b.match(new RegExp(`--${n}:\\s*([^;]+);`)); if (m) return m[1].trim(); } assert.fail(`token --${n} ausente (${tema})`); };
  // Resolve var(--x) e rgb(var(--trio) / var(--alfa)) até virar [r,g,b,alfa].
  const cor = (n) => {
    let v = bruto(n);
    for (let i = 0; i < 5 && /var\(--/.test(v); i++) v = v.replace(/var\(--([a-z0-9-]+)\)/g, (_, k) => bruto(k));
    let m = v.match(/^#([0-9A-Fa-f]{6})$/); if (m) return [...hex(m[1]), 1];
    m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/); if (m) return [+m[1], +m[2], +m[3], +m[4]];
    m = v.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/); if (m) return [+m[1], +m[2], +m[3], +m[4]];
    assert.fail(`não sei ler --${n}: ${v}`);
  };
  return { bruto, cor };
}
const camada = (fundo, [r, g, b, a]) => sobre(fundo, [r, g, b], a);

function ambiente(tema) {
  const t = tok(tema);
  const bg = hex(t.bruto('avz-bg'));
  const picos = [sobre(bg, hex(t.bruto('avz-orange')), Number(t.bruto('avz-orb-orange-a'))), sobre(bg, hex(t.bruto('avz-blue')), Number(t.bruto('avz-orb-blue-a')))];
  // Pior caso: no escuro, o fundo mais claro (texto claro); no claro, o mais escuro (texto escuro).
  const base = picos.sort((x, y) => (tema === 'dark' ? lum(y) - lum(x) : lum(x) - lum(y)))[0];
  const cartao = camada(base, t.cor('cz-surface'));
  return {
    t, base,
    fundos: {
      'página': base, 'cartão': cartao, 'cartão dentro de cartão': camada(cartao, t.cor('cz-surface')),
      'pílula no cartão': camada(cartao, t.cor('cz-chip')), 'bloco no cartão': camada(cartao, t.cor('cz-sunken')),
      'menu/barra (vidro forte)': cartao, 'gaveta': camada(base, t.cor('avz-drawer-bg')), 'aviso/diálogo': camada(base, t.cor('avz-solid-2')),
    },
  };
}

for (const tema of ['dark', 'light']) {
  const { t, base, fundos } = ambiente(tema);
  const c = (n) => t.cor(n).slice(0, 3);

  test(`[${tema}] texto do tema sobre fundo e vidro: AA no pior caso (orbe no pico + vidro empilhado)`, () => {
    for (const n of ['avz-text', 'avz-muted', 'avz-heading', 'avz-accent-text', 'avz-ok', 'avz-danger', 'avz-warn']) {
      for (const [onde, f] of Object.entries(fundos)) {
        const r = razao(c(n), f);
        assert.ok(r >= 4.5, `--${n} sobre ${onde}: ${r.toFixed(2)}`);
      }
    }
  });

  test(`[${tema}] preenchimento escuro (--cz-ink): creme, areia e textos claros antigos legíveis`, () => {
    const ink = hex(t.bruto('cz-ink'));
    const ink2 = hex(t.bruto('cz-ink-2'));
    for (const [nome, cor] of [['creme', hex('#F5F0E6')], ['areia', hex('#EAD9C2')], ['branco', hex('#FFFFFF')], ['laranja', hex('#FF6A1F')]]) {
      for (const f of [ink, ink2]) assert.ok(razao(cor, f) >= 4.5, `${nome} sobre ink: ${razao(cor, f).toFixed(2)}`);
    }
    if (tema === 'dark') assert.ok(razao(ink, hex(t.bruto('avz-bg'))) >= 1.25, 'destaque escuro se distingue do fundo marinho');
  });

  test(`[${tema}] laranja só como preenchimento, com texto marinho (botão principal, item ativo, contador)`, () => {
    const navy = hex(t.bruto('avz-navy'));
    assert.ok(razao(navy, hex(t.bruto('avz-orange'))) >= 4.5);
    assert.ok(razao(navy, hex(t.bruto('avz-orange-hover'))) >= 4.5);
    assert.ok(razao(hex(t.bruto('avz-cream')), navy) >= 4.5, 'contador no item ativo (creme sobre marinho)');
  });

  test(`[${tema}] pílulas tingidas (ok, perigo, aviso, destaque) sobre o vidro`, () => {
    const cartao = fundos['cartão'];
    for (const [txt, fundo] of [['avz-ok', 'avz-ok-bg'], ['avz-danger', 'avz-danger-bg'], ['avz-danger', 'avz-danger-bg-hover'], ['avz-warn', 'cz-warn-bg'], ['avz-accent-text', 'cz-accent-bg']]) {
      const f = camada(cartao, t.cor(fundo));
      assert.ok(razao(c(txt), f) >= 4.5, `--${txt} sobre --${fundo}: ${razao(c(txt), f).toFixed(2)}`);
    }
  });

  test(`[${tema}] campos: texto e placeholder legíveis (também em foco)`, () => {
    const shade = t.bruto('avz-shade').split(/\s+/).map(Number);
    for (const a of [Number(t.bruto('avz-field-a')), Number(t.bruto('avz-field-a')) + 0.15]) {
      for (const f of [sobre(base, shade, a), sobre(fundos['cartão'], shade, a)]) {
        assert.ok(razao(c('avz-text'), f) >= 4.5, 'texto');
        assert.ok(razao(hex(t.bruto('avz-placeholder')), f) >= 4.5, 'placeholder');
      }
    }
  });
}

test('tokens: cópia fiel do kit (só o cabeçalho a mais), carregada antes das demais folhas; vidro.css por último', () => {
  const [cabecalho, ...resto] = copia.split('\n');
  assert.match(cabecalho, /cópia do kit \(packages\/avanteza-kit\/tokens\.css\), não editar aqui/);
  assert.equal(resto.join('\n'), kit, 'static/avanteza-tokens.css difere do kit: copie de novo');
  const folhas = [...html.matchAll(/<link rel="stylesheet" href="\.\/([\w-]+\.css)">/g)].map((m) => m[1]);
  assert.equal(folhas[0], 'avanteza-tokens.css');
  assert.equal(folhas[folhas.length - 1], 'vidro.css');
  assert.ok(folhas.indexOf('avanteza.css') === folhas.length - 2);
  for (const f of folhas) assert.ok(fs.existsSync(path.join(RAIZ, 'static', f)), f);
  // As folhas do app não redefinem os tokens do kit (só aliases próprios).
  const nomesKit = new Set([...kit.matchAll(/(--avz-[a-z0-9-]+):/g)].map((m) => m[1]));
  for (const f of folhas.filter((x) => x !== 'avanteza-tokens.css')) {
    for (const m of ler(`static/${f}`).matchAll(/(--avz-[a-z0-9-]+)\s*:/g)) assert.ok(!nomesKit.has(m[1]), `${f} redefine ${m[1]} do kit`);
  }
  for (const n of ['--avz-bg', '--avz-text', '--avz-muted', '--avz-orange', '--avz-glass-border', '--avz-shadow', '--avz-radius', '--avz-sidebar-w', '--avz-font']) {
    assert.ok(nomesKit.has(n), `kit sem ${n}`);
  }
});

test('tema e menu antes da pintura: chaves avanteza-tema e avanteza-menu (localStorage > cookie > sistema)', () => {
  const i = html.indexOf('avanteza-tema');
  assert.ok(i > 0 && i < html.indexOf('<link rel="stylesheet"'), 'script do tema vem antes das folhas');
  assert.match(html, /localStorage\.getItem\("avanteza-tema"\)/);
  assert.match(html, /avanteza-tema=\(light\|dark\)/);
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(html, /setAttribute\("data-theme",t\)/);
  assert.match(html, /localStorage\.getItem\("avanteza-menu"\)/);
  assert.match(html, /setAttribute\("data-sidebar","collapsed"\)/);
  // O botão grava nas mesmas chaves (localStorage + cookie) e usa os rótulos da Central.
  assert.match(mesa, /TEMA_KEY = 'avanteza-tema', MENU_KEY = 'avanteza-menu'/);
  assert.match(mesa, /localStorage\.setItem\(k, v\)/);
  assert.match(mesa, /document\.cookie = `\$\{k\}=\$\{v\}; path=\/; max-age=31536000; samesite=lax`/);
  assert.match(mesa, /Mudar para o tema \$\{prox\}/);
  assert.match(vidro, /:root\[data-theme="light"\] #esteira \.theme-toggle \.i-sun \{ display: block; \}/);
});

test('fonte Plus Jakarta Sans servida pelo app, com licença OFL; nenhuma fonte nova de CDN', () => {
  const woff = fs.readFileSync(path.join(RAIZ, 'static/PlusJakartaSans-Variavel.woff2'));
  assert.equal(woff.slice(0, 4).toString('latin1'), 'wOF2');
  assert.match(ler('static/PlusJakartaSans-OFL.txt'), /SIL Open Font License, Version 1\.1/);
  assert.match(ler('static/avanteza.css'), /font-family: 'Plus Jakarta Sans';[^}]*url\('\.\/PlusJakartaSans-Variavel\.woff2'\)/);
  assert.match(ler('static/avanteza.css'), /--font-jakarta: "Plus Jakarta Sans";/);
  assert.match(vidro, /body, body \* \{ font-family: var\(--avz-font\) !important; \}/);
  for (const f of fs.readdirSync(path.join(RAIZ, 'static')).filter((x) => x.endsWith('.css'))) {
    assert.doesNotMatch(ler(`static/${f}`), /@import\s+url\(['"]?https?:/, `${f}: @import externo`);
  }
});

test('fundo com orbes, vidro com fallback sem backdrop-filter, raios e sombras do kit', () => {
  assert.match(vidro, /body::before \{[^}]*radial-gradient\(closest-side, rgba\(255, 106, 31, var\(--avz-orb-orange-a\)\)/);
  assert.match(vidro, /body::after \{[^}]*radial-gradient\(closest-side, rgba\(59, 130, 246, var\(--avz-orb-blue-a\)\)/);
  assert.match(vidro, /html \{ background: var\(--avz-bg\) !important;/);
  assert.match(vidro, /backdrop-filter: blur\(var\(--avz-blur\)\) saturate\(1\.25\)/);
  const fallbacks = [...vidro.matchAll(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(fallbacks, /--cz-surface: var\(--avz-solid\)/);
  assert.match(fallbacks, /\.es-nav\.sb, #esteira \.cz-barra \{ background: var\(--avz-solid\); \}/);
  for (const n of ['--avz-radius)', '--avz-radius-lg)', '--avz-radius-md)', '--avz-radius-pill)', '--avz-shadow)', '--avz-shadow-sm)', '--avz-glow)']) assert.ok(vidro.includes(`var(${n}`), n);
});

test('cores fixas antigas viraram tokens de tema nas telas (fora teleprompter e artes)', () => {
  const folhas = ['esteira', 'mesa', 'interface', 'mobileStudio', 'meuInstagram', 'marca', 'radar', 'videos', 'reciclagem', 'historias', 'avanteza'];
  for (const f of folhas) {
    const css = ler(`static/${f}.css`);
    for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(); const corpo = m[2];
      if (/\.tp[\w-]*|\.vd-estilo i|#pico-login|@font-face/.test(sel)) continue;
      assert.doesNotMatch(corpo, /background(-color)?\s*:\s*(#fff\b|#ffffff\b|white\b|#F5F0E6\b|#EAD9C2\b)/i, `${f}.css ${sel}: fundo claro fixo`);
      // Sobre o laranja o texto é sempre marinho (fixo nos dois temas); fora dele, só tokens de tema.
      if (/background[^;]*(#FF6A1F|--avz-orange|--avz-accent)/i.test(corpo)) continue;
      assert.doesNotMatch(corpo, /(^|;)\s*color\s*:\s*(#0B1B33|#55637A)\b/i, `${f}.css ${sel}: texto marinho/cinza fixo (use --avz-text/--avz-muted)`);
      assert.doesNotMatch(corpo, /(^|;)\s*color\s*:\s*var\(--avz-navy\)/, `${f}.css ${sel}: marinho fixo fora do laranja`);
    }
  }
});

test('menu lateral no desenho da Central: grupos, ativo laranja, recolhível, gaveta no celular e atalho Central', () => {
  assert.match(mesa, /<nav class="es-nav sb" id="menu-lateral" aria-label="Navegação principal">/);
  assert.match(mesa, /\['Produção', \[\['central', 'Aprovar'\], \['mesa', 'Criar'\], \['videos', 'Vídeos'\], \['reciclagem', 'Reciclar'\]\]\]/);
  assert.match(mesa, /class="sb-grupo" role="group" aria-label="\$\{g\}"><div class="sb-label">/);
  assert.match(mesa, /<a class="sb-link sb-central" href="\/api\/sso\/central"/);
  assert.match(mesa, /<a class="studio-central" href="\/api\/sso\/central"/);
  assert.match(mesa, /data-action="menu-recolher" aria-pressed="\$\{recolhido\}" aria-controls="menu-lateral"/);
  assert.match(mesa, /data-action="menu-abrir" aria-label="Abrir menu" aria-expanded=/);
  assert.match(mesa, /ev\.key === 'Escape'/);
  assert.match(vidro, /\.es-nav \.sb-link\[aria-current="page"\] \{ background: var\(--avz-orange\); color: var\(--avz-navy\);/);
  assert.match(vidro, /:root\[data-sidebar="collapsed"\] \{ --cz-sidebar-w: var\(--avz-sidebar-w-collapsed\); \}/);
  assert.match(vidro, /\.sb-aberto #esteira \.sb-scrim \{ display: block;/);
  // O redirecionamento da Central fica no servidor (AVANTEZA_HUB_URL, padrão app.avanteza.com.br).
  assert.match(ler('backend/lib/avantezaSso.js'), /https:\/\/app\.avanteza\.com\.br/);
});

test('marca na paleta: o ícone "[P]" deixou o azul e usa marinho, laranja e creme', () => {
  const svg = ler('static/logo-app.svg');
  assert.doesNotMatch(svg, /#2448FF|#FF7043|#F6F5F0/i);
  assert.deepEqual([...new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9A-F]{6})"/gi)].map((m) => m[1].toUpperCase()))].sort(), ['#0B1B33', '#F5F0E6', '#FF6A1F']);
  assert.match(mesa, /src="\/logo-app\.svg"/);
});
