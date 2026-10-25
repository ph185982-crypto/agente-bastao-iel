/* Motor do template editorial (Reels 9:16). Renderiza quadro a quadro: window.seek(t) desenha o quadro t.
 *
 * Componentes reutilizaveis:
 *   KineticText      texto que entra palavra a palavra (scale-in, deslize, carimbo), desgaste, sublinhado
 *   PaperReveal      papel rasgado que se revela (mascara de rasgo)
 *   ArchivePhoto     foto/documento com entrada, paralaxe, zoom lento e borrao de movimento
 *   DocumentParallax pilha de camadas de documento em profundidade
 *   ImpactTransition flash, folha, rasgo, chicote + impacto de camera
 *   DynamicCaptions  legenda 2-5 palavras, sincronizada, palavra destacada
 *   EndCard          chamada final (pilula do perfil + seta que cresce)
 *   Scene / MODELOS  receitas de cena que combinam os componentes a partir do reel.json
 *   MotionReel       orquestra cenas, transicoes, camera, granulacao e legendas
 * Tempos chegam resolvidos (segundos absolutos) pelo render.py, a partir das palavras da narracao.
 */
const D = /*__DADOS__*/null;
const S = D.spec;
const W = S.w, H = S.h;
const ZS = S.zona_segura;
const cv = document.getElementById('c'); cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
ctx.imageSmoothingQuality = 'high';

// ---------------------------------------------------------------- utilidades
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const E = {
  out3: x => 1 - Math.pow(1 - clamp(x), 3),
  out5: x => 1 - Math.pow(1 - clamp(x), 5),
  outExpo: x => (x = clamp(x)) >= 1 ? 1 : 1 - Math.pow(2, -10 * x),
  in3: x => Math.pow(clamp(x), 3),
  inOut3: x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
  outBack: x => { x = clamp(x); const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
const pr = (t, t0, d) => clamp((t - t0) / d);
const COR = c => (S.cores[c] || c);
function rnd(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
const LOG = { caixas: [] };
function registrar(nome, x, y, w, h, alfa = 1) { if (alfa > 0.05) LOG.caixas.push({ nome, x, y, w, h }); }

// ---------------------------------------------------------------- recursos
const IMG = {};
const TINT = {};
function img(n) { return IMG[n]; }
function tingida(n, modo) {   // versoes coloridas em cache (duotone azul, quente, escura)
  const k = n + '|' + modo;
  if (TINT[k]) return TINT[k];
  const s = IMG[n], c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
  const g = c.getContext('2d');
  g.drawImage(s, 0, 0);
  if (modo === 'azul') { g.globalCompositeOperation = 'color'; g.fillStyle = '#1b4fc4'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(40,80,190,.35)'; g.fillRect(0, 0, c.width, c.height); }
  if (modo === 'escura') { g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(30,30,40,.55)'; g.fillRect(0, 0, c.width, c.height); }
  if (modo === 'pb') { g.globalCompositeOperation = 'saturation'; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
  g.globalCompositeOperation = 'destination-in'; g.drawImage(s, 0, 0);   // preserva o alfa (bordas rasgadas)
  TINT[k] = c; return c;
}

// ---------------------------------------------------------------- formas de papel rasgado
const RASGOS = {};
function rasgo(id, w, h, amp = 14, passo = 16, lados = 'tblr') {   // poligono (cache por id)
  if (RASGOS[id]) return RASGOS[id];
  const r = rnd(id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const pts = [], lin = (x0, y0, x1, y1, nx, ny, on) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / passo));
    for (let i = 0; i < n; i++) { const u = i / n, j = on ? (r() * amp) : 0; pts.push([x0 + (x1 - x0) * u + nx * j, y0 + (y1 - y0) * u + ny * j]); }
  };
  lin(0, 0, w, 0, 0, 1, lados.includes('t')); lin(w, 0, w, h, -1, 0, lados.includes('r'));
  lin(w, h, 0, h, 0, -1, lados.includes('b')); lin(0, h, 0, 0, 1, 0, lados.includes('l'));
  return (RASGOS[id] = pts);
}
function caminho(pts, dx = 0, dy = 0) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0] + dx, p[1] + dy) : ctx.moveTo(p[0] + dx, p[1] + dy)); ctx.closePath(); }
function textura(nome, x, y, w, h, dx = 0, dy = 0) {   // preenche com textura em tile, deslocada (paralaxe)
  const t = img(nome); if (!t) return;
  const ox = ((dx % t.width) + t.width) % t.width, oy = ((dy % t.height) + t.height) % t.height;
  for (let yy = y - oy; yy < y + h; yy += t.height) for (let xx = x - ox; xx < x + w; xx += t.width) ctx.drawImage(t, xx, yy);
}

// ================================================================ PaperReveal
const PaperReveal = {
  /* papel rasgado (textura ou cor) revelado de um lado; op: id,x,y,w,h,t0,dur,lado,fill|textura,rot,sombra,amp */
  draw(t, op) {
    const p = op.t0 === undefined ? 1 : E.out5(pr(t, op.t0, op.dur || .45));
    if (p <= 0) return;
    const pts = rasgo(op.id, op.w, op.h, op.amp || 16, op.passo || 18, op.lados || 'tblr');
    ctx.save();
    ctx.translate(op.x + op.w / 2, op.y + op.h / 2); ctx.rotate((op.rot || 0) * Math.PI / 180); ctx.translate(-op.w / 2, -op.h / 2);
    // revelacao: recorte retangular que cresce a partir do lado
    const lado = op.lado || 'baixo';
    ctx.beginPath();
    if (lado === 'baixo') ctx.rect(-40, op.h * (1 - p) - 40, op.w + 80, op.h * p + 80);
    else if (lado === 'cima') ctx.rect(-40, -40, op.w + 80, op.h * p + 80);
    else if (lado === 'esquerda') ctx.rect(-40, -40, op.w * p + 80, op.h + 80);
    else ctx.rect(op.w * (1 - p) - 40, -40, op.w * p + 80, op.h + 80);
    ctx.clip();
    if (op.sombra !== false) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; caminho(pts); ctx.fillStyle = op.fill || '#000'; ctx.fill(); ctx.restore(); }
    caminho(pts); ctx.save(); ctx.clip();
    if (op.textura) textura(op.textura, 0, 0, op.w, op.h, (op.tdx || 0), (op.tdy || 0)); else { ctx.fillStyle = op.fill; ctx.fillRect(0, 0, op.w, op.h); }
    ctx.restore();
    if (op.borda) { caminho(pts); ctx.lineWidth = 3; ctx.strokeStyle = op.borda; ctx.stroke(); }
    ctx.restore();
  },
};

// ================================================================ ArchivePhoto
const ArchivePhoto = {
  /* op: nome, x,y (canto sup. esq. final), w, t0 (entrada), entra (subir|descer|esquerda|direita|zoom|nada), dist,
         dur, deriva [vx,vy] px/s, zoom [z0,z1] na cena (cena:[ini,fim]), origem [ox,oy] do zoom, tom, alfa, rot */
  draw(t, op) {
    const fonte = op.tom ? tingida(op.nome, op.tom) : img(op.nome);
    if (!fonte) return;
    const w = op.w || fonte.width, h = w * fonte.height / fonte.width;
    let x = op.x, y = op.y, a = op.alfa === undefined ? 1 : op.alfa, s = 1;
    let vel = [0, 0];
    if (op.t0 !== undefined) {
      if (t < op.t0) return;
      const d = op.dur || .4, p = E.out5(pr(t, op.t0, d)), dist = op.dist || 160;
      const m = { subir: [0, 1], descer: [0, -1], esquerda: [-1, 0], direita: [1, 0] }[op.entra] || [0, 0];
      x += m[0] * dist * (1 - p); y += m[1] * dist * (1 - p);
      vel = [-m[0] * dist * (1 - p), -m[1] * dist * (1 - p)];
      if (op.entra === 'zoom') s = 1.25 - .25 * p;
      a *= clamp(pr(t, op.t0, d * .4));
    }
    if (op.deriva && op.cena) { const L = t - op.cena[0]; x += op.deriva[0] * L; y += op.deriva[1] * L; }
    if (op.zoom && op.cena) {
      const u = E.inOut3(pr(t, op.cena[0], op.cena[1] - op.cena[0]));
      s *= op.zoom[0] + (op.zoom[1] - op.zoom[0]) * u;
    }
    const ox = op.origem ? op.origem[0] : w / 2, oy = op.origem ? op.origem[1] : h / 2;
    const desenha = (dx, dy, alfa) => {
      ctx.save(); ctx.globalAlpha = alfa;
      ctx.translate(x + ox + dx, y + oy + dy); ctx.rotate((op.rot || 0) * Math.PI / 180); ctx.scale(s, s);
      if (op.sombra) { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 12; }
      ctx.drawImage(fonte, -ox, -oy, w, h); ctx.restore();
    };
    const v = Math.hypot(vel[0], vel[1]);
    if (v > 25) for (let k = 3; k >= 1; k--) desenha(-vel[0] * k * .07, -vel[1] * k * .07, a * .18);   // borrao de movimento
    desenha(0, 0, a);
  },
};

// ================================================================ DocumentParallax
const DocumentParallax = {
  /* camadas: [{op ArchivePhoto/PaperReveal, prof}] — a profundidade multiplica a deriva comum da cena */
  draw(t, camadas, deriva, cena) {
    for (const c of camadas) {
      const L = t - cena[0];
      const dx = deriva[0] * L * c.prof, dy = deriva[1] * L * c.prof;
      ctx.save(); ctx.translate(dx, dy);
      if (c.papel) PaperReveal.draw(t, c.papel); else ArchivePhoto.draw(t, c.foto);
      ctx.restore();
    }
  },
};

// ================================================================ KineticText
const FONTE_T = 'Anton';
function fonte(px) { return `${px}px ${FONTE_T}`; }
function medir(txt, px) { ctx.font = fonte(px); return ctx.measureText(txt); }
function caber(txt, px, maxW) { const w = medir(txt, px).width; return w > maxW ? px * maxW / w : px; }
const DESG = {};
function comDesgaste(txt, px, cor) {   // texto com desgaste (respingos vazados), em cache
  const k = txt + px + cor;
  if (DESG[k]) return DESG[k];
  const m = medir(txt, px), c = document.createElement('canvas');
  c.width = Math.ceil(m.width + 20); c.height = Math.ceil(px * 1.25);
  const g = c.getContext('2d'); g.font = fonte(px); g.fillStyle = cor; g.textBaseline = 'alphabetic';
  g.fillText(txt, 10, px * 1.02);
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = .9;
  const d = img('desgaste'); if (d) g.drawImage(d, 0, 0, c.width, c.width * d.height / d.width);
  return (DESG[k] = { c, base: px * 1.02, w: m.width });
}
const KineticText = {
  /* Linha com palavras animadas. op: txt, x, y (linha de base), px, cor, alinhar (centro|esquerda), t (entrada da linha),
     ts (tempos por palavra), modo (scale|deslize|carimbo|subir), dir [dx,dy], palavra_cor {}, fixa (palavra parada),
     deriva (px de vai-e-vem das outras), desgaste, sombra, etiqueta (cor de fundo rasgado), nome (log) */
  draw(t, op) {
    const palavras = op.txt.split(' ');
    ctx.font = fonte(op.px);
    const esp = ctx.measureText(' ').width * .9;
    const larg = palavras.map(p => ctx.measureText(p).width);
    const total = larg.reduce((a, b) => a + b, 0) + esp * (palavras.length - 1);
    let x = op.alinhar === 'esquerda' ? op.x : op.x - total / 2;
    const x0linha = x;
    const asc = op.px * .86;
    let visivel = 0, xmin = 1e9, xmax = -1e9;
    if (op.etiqueta) {   // faixa rasgada atras da linha (ex.: ESCONDEM?)
      const tE = op.ts ? op.ts[0] : op.t;
      if (t >= tE - .05) PaperReveal.draw(t, { id: 'et' + op.txt, x: x - 26, y: op.y - asc - 22, w: total + 52, h: asc + 44 + op.px * .06,
        fill: COR(op.etiqueta), t0: tE - .05, dur: .25, lado: 'esquerda', amp: 10, passo: 14, rot: -1.2 });
    }
    palavras.forEach((p, i) => {
      const tw = op.ts ? op.ts[Math.min(i, op.ts.length - 1)] : op.t;
      const xi = x; x += larg[i] + esp;
      if (tw === undefined || t < tw) return;
      const d = op.modo === 'carimbo' ? .13 : .28, u = pr(t, tw, d);
      let s = 1, dx = 0, dy = 0, rot = 0, a = clamp((t - tw) / .1);
      const dir = op.dir || [0, 60];
      if (op.modo === 'scale') {   // scale-in de 105% a 122%, sem passar da zona segura
        const sMax = Math.max(1.05, Math.min(1.22, SAFE_W / total));
        s = sMax - (sMax - 1) * E.out5(u); dx += (xi + larg[i] / 2 - (x0linha + total / 2)) * (s - 1); }
      else if (op.modo === 'carimbo') { s = u < 1 ? 1.75 - .75 * E.in3(u) : 1; rot = -3 * (1 - u) - 1.2; }
      else { dx = dir[0] * (1 - E.out5(u)); dy = dir[1] * (1 - E.out5(u)); }
      if (op.fixa && p.replace(/[.,!?]/g, '') !== op.fixa && op.deriva && t > tw + .4) {   // as outras palavras respiram
        dx += Math.sin((t - tw) * 1.7 + i) * op.deriva; dy += Math.cos((t - tw) * 1.3 + i * 2) * op.deriva * .4;
      }
      const cor = COR((op.palavra_cor && op.palavra_cor[p]) || op.cor);
      const desenha = (ox, oy, alfa) => {
        ctx.save(); ctx.globalAlpha = alfa;
        ctx.translate(xi + larg[i] / 2 + dx + ox, op.y - asc / 2 + dy + oy); ctx.rotate(rot * Math.PI / 180); ctx.scale(s, s);
        if (op.sombra) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8; }
        if (op.desgaste) { const g = comDesgaste(p, op.px, cor); ctx.drawImage(g.c, -larg[i] / 2 - 10, asc / 2 - g.base); }
        else { ctx.font = fonte(op.px); ctx.fillStyle = cor; ctx.textBaseline = 'alphabetic'; ctx.fillText(p, -larg[i] / 2, asc / 2); }
        ctx.restore();
      };
      if (u < .5 && op.modo !== 'carimbo') {   // borrao de movimento na entrada rapida
        for (let k = 3; k >= 1; k--) desenha(-dx * k * .25 * (op.modo === 'scale' ? 0 : 1), -dy * k * .25, a * .16 * (1 - u * 2));
        if (op.modo === 'scale') for (let k = 1; k <= 2; k++) { ctx.save(); s *= 1 + .05 * k * (1 - u); desenha(0, 0, a * .12 * (1 - u * 2)); s /= 1 + .05 * k * (1 - u); ctx.restore(); }
      }
      desenha(0, 0, a);
      visivel++; xmin = Math.min(xmin, xi + dx); xmax = Math.max(xmax, xi + larg[i] + dx);
    });
    if (visivel) registrar(op.nome || ('texto:' + op.txt), xmin, op.y - asc, xmax - xmin, asc + op.px * .08);
    return { x0: op.alinhar === 'esquerda' ? op.x : op.x - total / 2, w: total, asc, larg, esp };
  },
  sublinhar(t, op) {   // linha de tinta desenhada (op: x0,x1,y,t0,dur,cor,esp)
    const p = E.out3(pr(t, op.t0, op.dur || .35));
    if (p <= 0) return;
    ctx.save(); ctx.strokeStyle = COR(op.cor || 'orange'); ctx.lineWidth = op.esp || 14; ctx.lineCap = 'round';
    ctx.beginPath();
    const n = 24;
    for (let i = 0; i <= n * p; i++) { const u = i / n, x = op.x0 + (op.x1 - op.x0) * u, y = op.y + Math.sin(u * 6.2) * 3 - u * 4;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.restore();
  },
};
function blocoTexto(linhas, base, maxW) {   // tamanhos que cabem na zona segura
  return linhas.map(l => caber(l.linha, base * (l.escala || 1), maxW));
}

// ================================================================ ImpactTransition
const ImpactTransition = {
  camera(t) {   // impacto de camera: 2 a 4 quadros de tranco + leve zoom
    let ox = 0, oy = 0, z = 1;
    for (const im of S.impactos) {
      const d = t - im.t;
      if (d < 0 || d > .13) continue;
      const k = 1 - d / .13, r = rnd(Math.floor(t * S.fps) + 3);
      ox += (r() - .5) * 26 * im.forca * k; oy += (r() - .5) * 22 * im.forca * k; z += .035 * im.forca * k;
    }
    return { ox, oy, z };
  },
  draw(t) {
    for (const tr of S.transicoes) {
      const d = t - tr.t;
      if (tr.tipo === 'flash' && d >= -.03 && d < .1) { ctx.fillStyle = `rgba(247,243,234,${.85 * (1 - clamp(d / .1))})`; ctx.fillRect(0, 0, W, H); }
      if (tr.tipo === 'folha' && d > -.32 && d < .3) {   // folha de papel cobre a camera e passa
        const u = E.inOut3((d + .32) / .62), y = H + 60 - u * (H * 2 + 400);
        PaperReveal.draw(t, { id: 'folha' + tr.t, x: -60, y, w: W + 120, h: H + 260, textura: 'papel_marfim', amp: 26, passo: 22, rot: -3, sombra: true, fill: '#d9d2c3' });
      }
      if (tr.tipo === 'rasgo' && d > -.24 && d < .24) {   // faixa rasgada carvao atravessa na diagonal
        const u = E.inOut3((d + .24) / .48), x = -W * 1.6 + u * W * 3.2;
        PaperReveal.draw(t, { id: 'rasgo' + tr.t, x, y: -300, w: W * 1.4, h: H + 600, fill: COR('charcoal'), amp: 30, passo: 26, rot: 14, sombra: true });
        PaperReveal.draw(t, { id: 'rasgoL' + tr.t, x: x + W * 1.25, y: -300, w: 70, h: H + 600, fill: COR('orange'), amp: 14, passo: 20, rot: 14, sombra: false });
      }
      if (tr.tipo === 'whip' && d > -.14 && d < .14) {   // chicote: listras de velocidade cobrindo o corte
        const k = 1 - Math.abs(d) / .14, r = rnd(Math.floor(t * S.fps));
        for (let i = 0; i < 26; i++) { ctx.fillStyle = i % 3 ? `rgba(20,87,217,${.85 * k})` : `rgba(244,122,31,${.9 * k})`;
          ctx.fillRect(0, r() * H, W, 30 + r() * 120); }
      }
    }
  },
};

// ================================================================ DynamicCaptions
const DynamicCaptions = {
  draw(t) {
    const c = S.legendas.find(l => t >= l.t0 && t < l.t1);
    if (!c) return;
    const px = S.legenda_px, y = S.legenda_y;
    ctx.font = `${px}px ${FONTE_T}`;
    const esp = ctx.measureText(' ').width;
    const larg = c.palavras.map(p => ctx.measureText(p.txt).width);
    let total = larg.reduce((a, b) => a + b, 0) + esp * (larg.length - 1);
    let s = Math.min(1, (W - 2 * ZS.lados - 40) / total);
    const e = E.outBack(pr(t, c.t0, .16)), a = clamp((t - c.t0) / .06);
    ctx.save(); ctx.translate(W / 2, y); ctx.scale(s * (.94 + .06 * e), s * (.94 + .06 * e)); ctx.globalAlpha = a;
    if (c.fundo) { ctx.fillStyle = 'rgba(23,23,23,.72)'; ctx.beginPath(); ctx.roundRect(-total / 2 - 24, -px * .78, total + 48, px * 1.12, 12); ctx.fill(); }
    let x = -total / 2;
    c.palavras.forEach((p, i) => {
      const dita = t >= p.t - .02;
      ctx.globalAlpha = a * (dita ? 1 : .55);
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.fillStyle = p.destaque ? COR(p.destaque) : COR('ivory');
      ctx.textBaseline = 'alphabetic'; ctx.fillText(p.txt, x, px * .3);
      x += larg[i] + esp;
    });
    ctx.restore();
    registrar('legenda', W / 2 - total * s / 2 - 24, y - px * .78 * s, total * s + 48, px * 1.12 * s, a);
  },
};

// ================================================================ EndCard
const EndCard = {
  seta(t, op) {   // seta de papel laranja que cresce ate o canto superior direito
    const pts = op.pontos, p = E.out3(pr(t, op.t0, op.dur));
    if (p <= 0) return;
    let comp = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); comp += l; }
    let resta = comp * p; const vis = [pts[0]]; let ang = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (resta >= seg[i - 1]) { vis.push(b); resta -= seg[i - 1]; } else { const u = resta / seg[i - 1]; vis.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); break; }
    }
    ctx.save(); ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    ctx.strokeStyle = COR('ivory'); ctx.lineWidth = op.esp + 18; ctx.beginPath(); vis.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = COR('orange'); ctx.lineWidth = op.esp; ctx.stroke();
    const f = vis[vis.length - 1], cab = op.esp * 1.5 * clamp(p * 3 - .2);
    ctx.translate(f[0], f[1]); ctx.rotate(ang);
    ctx.fillStyle = COR('ivory'); ctx.beginPath(); ctx.moveTo(cab + 14, 0); ctx.lineTo(-cab * .6, -cab - 12); ctx.lineTo(-cab * .6, cab + 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COR('orange'); ctx.beginPath(); ctx.moveTo(cab, 0); ctx.lineTo(-cab * .6 + 4, -cab); ctx.lineTo(-cab * .6 + 4, cab); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  pilula(t, op) {   // SEGUE @PERFIL: sobe pela parte de baixo e pulsa uma vez
    if (t < op.t0) return;
    const p = E.out5(pr(t, op.t0, .45)), pulso = 1 + .07 * Math.sin(Math.PI * clamp((t - op.t0 - .7) / .45));
    const y = op.y + (1 - p) * 220;
    ctx.font = fonte(op.px); const w1 = ctx.measureText(op.texto + ' ').width, w2 = ctx.measureText(op.perfil).width;
    const w = w1 + w2 + 70, h = op.px * 1.35;
    ctx.save(); ctx.globalAlpha = clamp((t - op.t0) / .15); ctx.translate(W / 2, y); ctx.scale(pulso, pulso);
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
    ctx.fillStyle = COR('orange'); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 26); ctx.fill(); ctx.shadowBlur = 0;
    ctx.textBaseline = 'middle'; ctx.fillStyle = COR('ivory'); ctx.fillText(op.texto, -w / 2 + 35, 4);
    ctx.fillStyle = COR('charcoal'); ctx.fillText(op.perfil, -w / 2 + 35 + w1, 4);
    if (t > op.t0 + .7) {   // tracinhos de destaque
      ctx.strokeStyle = COR('orange'); ctx.lineWidth = 7; ctx.lineCap = 'round';
      const k = E.out3(pr(t, op.t0 + .7, .3));
      for (const [ax, ay, bx, by] of [[-1, -.6, -1.25, -.95], [-1.08, 0, -1.4, 0], [-1, .6, -1.25, .95], [1, -.6, 1.25, -.95], [1.08, 0, 1.4, 0], [1, .6, 1.25, .95]]) {
        ctx.beginPath(); ctx.moveTo(ax * w / 2, ay * h); ctx.lineTo((ax + (bx - ax) * k) * w / 2, (ay + (by - ay) * k) * h); ctx.stroke(); }
    }
    ctx.restore();
    registrar('cta', W / 2 - w / 2 * pulso, y - h / 2 * pulso, w * pulso, h * pulso);
  },
};

// ================================================================ fundos e enfeites comuns
function riscosVelocidade(t, cena, n, cores) {   // riscos radiais (cena 1)
  const r = rnd(99), L = t - cena.inicio;
  ctx.save(); ctx.translate(W / 2, H * .38);
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, vel = 600 + r() * 900, fase = r();
    const d0 = ((L * vel / 1000 + fase) % 1) * 1400 + 80, comp = 120 + r() * 340;
    ctx.rotate(0); ctx.strokeStyle = cores[i % cores.length]; ctx.globalAlpha = .55 + r() * .4; ctx.lineWidth = 3 + r() * 16;
    ctx.beginPath(); ctx.moveTo(Math.cos(ang) * d0, Math.sin(ang) * d0); ctx.lineTo(Math.cos(ang) * (d0 + comp), Math.sin(ang) * (d0 + comp)); ctx.stroke();
  }
  ctx.restore();
}
function borrao(t, x, y, w, h, cor, id, rot = 0, alfa = 1) {   // mancha de tinta/papel colorido rasgado
  PaperReveal.draw(t, { id, x, y, w, h, fill: cor, amp: 22, passo: 18, rot, sombra: false });
}
function vinheta(forca = .5) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * .25, W / 2, H / 2, H * .75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${forca})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function etiqueta(txt, x, y, t, t0) {   // "ilustracao": aviso honesto, pequeno
  if (t < t0) return;
  ctx.save(); ctx.globalAlpha = .85 * clamp((t - t0) / .3); ctx.font = '600 22px Mont';
  const w = ctx.measureText(txt).width + 24;
  ctx.fillStyle = 'rgba(23,23,23,.75)'; ctx.beginPath(); ctx.roundRect(x, y, w, 34, 8); ctx.fill();
  ctx.fillStyle = COR('ivory'); ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 12, y + 18); ctx.restore();
  registrar('etiqueta', x, y, w, 34);
}

// ---- fundo e selo dos modelos "dado"
const FUNDOS = { carvao: 'papel_carvao', azul: 'papel_azul', marfim: 'papel_marfim' };
function selo(t, c) {   // etiqueta da serie, no topo (dentro da zona segura)
  if (!c.selo) return;
  ctx.save(); ctx.globalAlpha = clamp((t - c.inicio) / .3); ctx.font = '800 40px Mont';
  const w = ctx.measureText(c.selo).width + 56, x = ZS.lados, y = ZS.topo + 6;
  ctx.fillStyle = COR('orange'); ctx.beginPath(); ctx.roundRect(x, y, w, 72, 12); ctx.fill();
  ctx.fillStyle = COR('ivory'); ctx.textBaseline = 'middle'; ctx.fillText(c.selo, x + 28, y + 38); ctx.restore();
  registrar('etiqueta', x, y, w, 72);
}
function fundoDado(t, c) {
  const L = t - c.inicio, k = c.ritmo || 1;
  textura(FUNDOS[c.fundo || 'carvao'], 0, 0, W, H, L * 4, L * 2);
  const escuro = c.fundo === 'marfim';
  PaperReveal.draw(t, { id: 'fx' + c.id, x: -60, y: 1290, w: W + 120, h: 100, fill: COR(escuro ? 'blue' : 'orange'), amp: 18, passo: 20, rot: -2.2, sombra: false, t0: c.inicio, dur: .35 * k, lado: 'esquerda' });
  PaperReveal.draw(t, { id: 'fy' + c.id, x: -60, y: 140, w: W + 120, h: 40, fill: COR('blue'), amp: 10, passo: 16, rot: 1.2, sombra: false, t0: c.inicio + .05, dur: .3 * k, lado: 'direita' });
  selo(t, c);
}

// ================================================================ MODELOS de cena (Scene)
const SAFE_W = W - 2 * ZS.lados;
const MODELOS = {
  // ---- 1. documento avanca, fragmentos, texto em tres tempos com impacto
  impacto_documento(t, c) {
    const L = t - c.inicio;
    textura('papel_carvao', 0, 0, W, H);
    riscosVelocidade(t, c, 46, [COR('orange'), '#000', '#3a2a1c', COR('orange')]);
    const k = c.ritmo || 1;
    const avanca = E.outExpo(pr(t, c.inicio, 1.4 * k));
    const doc = img(c.imagens.documento);
    if (doc) {   // o documento vem rapido em direcao a camera
      const s = .55 + .85 * avanca + .05 * L, w = 900 * s, h = w * doc.height / doc.width;
      const v = (1 - avanca);
      for (let k = 4; k >= 0; k--) { ctx.save(); ctx.globalAlpha = k ? .14 * v : .92; const sk = 1 - k * .05 * v;
        ctx.drawImage(doc, W / 2 - w * sk / 2, 600 - h * sk / 2, w * sk, h * sk); ctx.restore(); }
    }
    ctx.fillStyle = 'rgba(10,8,6,.42)'; ctx.fillRect(0, 0, W, H);
    // fragmentos atravessando
    const r = rnd(5);
    c.imagens.fragmentos.forEach((n, i) => {
      const f = img(n); if (!f) return;
      const t0 = c.inicio + .05 + i * .1, u = E.out3(pr(t, t0, 1.1 * k));
      const alvo = [[870, 300], [150, 1500], [930, 1520]][i], ini = [W / 2, 640];
      const x = ini[0] + (alvo[0] - ini[0]) * u + Math.sin(L * 1.2 + i) * 10, y = ini[1] + (alvo[1] - ini[1]) * u;
      const s = .35 + .75 * u;
      ctx.save(); ctx.translate(x, y); ctx.rotate((i - 1) * .3 + (1 - u) * 1.4 + L * .04 * (i - 1)); ctx.scale(s, s);
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30; ctx.drawImage(f, -f.width / 2, -f.height / 2); ctx.restore();
    });
    for (let i = 0; i < 9; i++) {   // papeis soltos (segunda leva no impacto)
      const ondaT = i < 5 ? c.inicio + .1 : (c.texto[2].t || c.inicio + 3);
      const u = pr(t, ondaT + r() * .3, 1.0 + r() * .6), ang = r() * 6.28, dist = 300 + r() * 900;
      if (u <= 0 || u >= 1) { r(); r(); continue; }
      const x = W / 2 + Math.cos(ang) * dist * E.out3(u), y = H * .4 + Math.sin(ang) * dist * E.out3(u), sz = 50 + r() * 90;
      ctx.save(); ctx.globalAlpha = 1 - u; ctx.translate(x, y); ctx.rotate(u * 5 * (r() - .5));
      PaperReveal.draw(t, { id: 'frag' + i, x: -sz / 2, y: -sz / 2, w: sz, h: sz * .7, textura: 'papel_marfim', amp: 8, passo: 10, sombra: false });
      ctx.restore();
    }
    vinheta(.55);
    const tam = blocoTexto(c.texto, 150, SAFE_W / 1.06);
    let y = 860;
    c.texto.forEach((l, i) => {
      y += tam[i] * .98;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, modo: i === 2 ? 'scale' : 'scale', sombra: true, desgaste: l.desgaste, nome: 'titulo' });
    });
  },

  // ---- 2. numeros rolam e travam; documento sobe; frase em duas etapas; sublinhado
  numero_trava(t, c) {
    const L = t - c.inicio;
    textura('papel_marfim', 0, 0, W, H, L * 6, 0);
    borrao(t, 760, 150, 420, 160, COR('blue'), 'n2a', -4);
    borrao(t, 820, 1420, 360, 260, COR('orange'), 'n2b', 6);
    ArchivePhoto.draw(t, { nome: c.imagens.topo, x: 300, y: 180, w: 780, t0: c.inicio + .05, entra: 'descer', dist: 90, deriva: [-6, 0], cena: [c.inicio, c.fim], tom: 'pb' });
    // 1988: cada digito rola e trava em sequencia
    const n = c.numero, dig = n.valor.split(''), px = caber(n.valor, 430, SAFE_W);
    ctx.font = fonte(px);
    const totalW = ctx.measureText(n.valor).width;
    let x = W / 2 - totalW / 2;
    const yb = 1010, r = rnd(Math.floor(t * 30));
    dig.forEach((d, i) => {
      const w = ctx.measureText(d).width, trava = n.t + i * .13;
      const ini = c.inicio + .15 + i * .05;
      if (t >= ini) {
        let ch = d, dy = 0, a = clamp((t - ini) / .1);
        if (t < trava) { ch = String(Math.floor(r() * 10)); dy = (r() - .5) * 30; }
        const pop = t >= trava ? 1 + .08 * (1 - E.out3(pr(t, trava, .25))) : 1;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(x + w / 2, yb + dy); ctx.scale(pop, pop);
        const g = comDesgaste(ch, px, COR(n.cor)); ctx.drawImage(g.c, -w / 2 - 10, -g.base); ctx.restore();
      }
      x += w;
    });
    registrar('numero', W / 2 - totalW / 2, yb - px * .86, totalW, px * .9);
    // o livro sobe por baixo
    const lv = c.texto.find(l => l.documento_sobe);
    ArchivePhoto.draw(t, { nome: c.imagens.documento, x: 0, y: 1395, w: 1080, t0: (lv ? lv.t : c.inicio + 2) - .3, entra: 'subir', dist: 520, dur: .5, deriva: [0, -5], cena: [c.inicio, c.fim], sombra: true });
    const tam = blocoTexto(c.texto, 130, SAFE_W);
    let y = 1050;
    c.texto.forEach((l, i) => {
      y += tam[i] * 1.0;
      const info = KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, modo: 'subir', dir: [0, 70], nome: 'titulo' });
      if (l.sublinhar && l.sub_t) {
        const idx = l.linha.split(' ').indexOf(l.sublinhar);
        let x0 = info.x0; for (let k = 0; k < idx; k++) x0 += info.larg[k] + info.esp;
        KineticText.sublinhar(t, { x0: info.x0 - 10, x1: x0 + info.larg[idx] + 10, y: y + 26, t0: l.sub_t, dur: .4 });
      }
    });
  },

  // ---- 3. suspense: papel rasgado, MAS gigante, palavras uma a uma, reticencias pulsando, botoes
  suspense_papel(t, c) {
    const L = t - c.inicio;
    textura('papel_azul', 0, 0, W, H);
    ctx.fillStyle = 'rgba(8,16,40,.35)'; ctx.fillRect(0, 0, W, H);
    ArchivePhoto.draw(t, { nome: c.imagens.topo, x: 0, y: 160, w: 1080, tom: 'azul', deriva: [-4, 0], cena: [c.inicio, c.fim] });
    ArchivePhoto.draw(t, { nome: c.imagens.base, x: 0, y: 1195, w: 1080, zoom: [1, 1.13], origem: [400, 430], cena: [c.inicio, c.fim] });
    if (c.botao) for (const tc of c.botao.ts || []) {   // botao pressionado: brilho laranja
      const k = Math.sin(Math.PI * clamp((t - tc) / .35));
      if (k > 0) { ctx.save(); ctx.globalAlpha = .55 * k; ctx.fillStyle = COR('orange'); ctx.shadowColor = COR('orange'); ctx.shadowBlur = 50;
        ctx.fillRect(c.botao.x, 1195 + c.botao.y, c.botao.w, c.botao.h); ctx.restore(); }
    }
    borrao(t, -40, 420, 150, 520, COR('orange'), 's3a', 2);
    borrao(t, 960, 880, 160, 340, COR('orange'), 's3b', -3);
    PaperReveal.draw(t, { id: 'papel3', x: 80, y: 250, w: 920, h: 900, textura: 'papel_marfim', amp: 30, passo: 22, rot: -1.5, sombra: true, fill: '#cfc7b6' });
    // texto: MAS gigante, depois palavra a palavra
    const [l0, l1, l2] = c.texto;
    const px0 = caber(l0.linha, 300, 720);
    KineticText.draw(t, { txt: l0.linha, x: W / 2, y: 600, px: px0, cor: l0.cor, t: l0.t, modo: 'scale', desgaste: true, nome: 'titulo' });
    const px1 = caber('NA HORA', 175, 760);
    KineticText.draw(t, { txt: l1.linha, x: W / 2, y: 820, px: px1, cor: l1.cor, ts: l1.ts, modo: 'subir', dir: [0, 50], nome: 'titulo' });
    const info = KineticText.draw(t, { txt: l2.linha, x: W / 2 - 40, y: 1010, px: px1, cor: l2.cor, ts: l2.ts, modo: 'subir', dir: [0, 50], nome: 'titulo' });
    if (l2.ret_t && t >= l2.ret_t) {   // reticencias pulsando em laranja
      const x0 = info.x0 + info.w + 14;
      for (let k = 0; k < 3; k++) { const a = .35 + .65 * (0.5 + 0.5 * Math.sin((t - l2.ret_t) * 6 - k * 1.1));
        ctx.save(); ctx.globalAlpha = a * clamp((t - l2.ret_t - k * .08) / .1); ctx.fillStyle = COR('orange'); ctx.fillRect(x0 + k * 34, 990, 24, 24); ctx.restore(); }
      registrar('titulo', x0, 990, 92, 24);
    }
    vinheta(.35);
  },

  // ---- 4. retrato sobe; titulo em blocos; carimbo; documento separado com X desenhado
  retrato_carimbo(t, c) {
    const L = t - c.inicio;
    textura('papel_azul', 0, 0, W, H, 0, L * 4);
    borrao(t, 640, 160, 520, 120, COR('orange'), 's4a', -8);
    borrao(t, -60, 1180, 330, 120, COR('orange'), 's4b', 10);
    ArchivePhoto.draw(t, { nome: c.imagens.lateral, x: 0, y: 690, w: 500, t0: c.inicio + .1, entra: 'esquerda', dist: 120, deriva: [-3, -2], cena: [c.inicio, c.fim], tom: 'azul' });
    // documento constitucional em camada separada + X desenhado
    const dx = 520, dy = 650, dw = 520, dh = 600;
    const tDoc = c.documento.t;
    if (t >= tDoc) {
      const p = E.out5(pr(t, tDoc, .5));
      ctx.save(); ctx.translate((1 - p) * 220 + Math.sin(L * .7) * 4, -L * 3); ctx.globalAlpha = clamp((t - tDoc) / .15);
      PaperReveal.draw(t, { id: 'doc4', x: dx, y: dy, w: dw, h: dh, textura: 'papel_marfim', amp: 12, passo: 16, rot: 3, sombra: true, fill: '#cfc7b6' });
      ctx.save(); ctx.translate(dx + dw / 2, dy + dh / 2); ctx.rotate(3 * Math.PI / 180);
      const cab = img(c.imagens.documento); if (cab) ctx.drawImage(cab, -dw / 2 + 40, -dh / 2 + 20, dw - 60, (dw - 60) * cab.height / cab.width);
      ctx.fillStyle = 'rgba(40,40,40,.35)';
      for (let k = 0; k < 9; k++) ctx.fillRect(-dw / 2 + 60, -dh / 2 + 330 + k * 26, dw - 130 - (k % 3) * 40, 8);
      if (c.documento.x_t) {   // X laranja em dois tracos rapidos
        ctx.strokeStyle = COR('orange'); ctx.lineCap = 'round'; ctx.lineWidth = 34;
        const tr = [[-170, -40, 170, 250], [170, -40, -170, 250]];
        tr.forEach(([ax, ay, bx, by], k) => { const u = E.out3(pr(t, c.documento.x_t + k * .16, .16)); if (u <= 0) return;
          ctx.globalAlpha = .95; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * u, ay + (by - ay) * u); ctx.stroke(); });
      }
      ctx.restore(); ctx.restore();
    }
    // retrato sobe por baixo
    ArchivePhoto.draw(t, { nome: c.imagens.retrato, x: 0, y: H - 1047, w: 1080, t0: c.retrato.t - .15, entra: 'subir', dist: 700, dur: .7, deriva: [0, -4], cena: [c.inicio, c.fim] });
    if (c.retrato.etiqueta) etiqueta(c.retrato.etiqueta, 96, 1585, t, c.retrato.t + .4);
    // bloco de titulo em fundo carvao rasgado
    PaperReveal.draw(t, { id: 'box4', x: 60, y: 205, w: 960, h: 455, fill: COR('charcoal'), t0: c.inicio, dur: .35, lado: 'esquerda', amp: 14, passo: 18, rot: -1 });
    const tam = blocoTexto(c.texto, 132, 880);
    let y = 222;
    c.texto.forEach((l, i) => {
      y += tam[i] * 1.0;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, modo: l.carimbo ? 'carimbo' : 'deslize', dir: [-70, 0], nome: 'titulo' });
    });
  },

  // ---- 5. caneta toca o papel, assinatura escrita, titulo com movimento lateral, camera controlada
  assinatura(t, c) {
    const L = t - c.inicio;
    textura('papel_marfim', 0, 0, W, H, L * 4, 0);
    borrao(t, 880, 690, 260, 120, COR('orange'), 's5a', 4);
    borrao(t, -30, 720, 300, 110, COR('blue'), 's5b', -5);
    ArchivePhoto.draw(t, { nome: c.imagens.topo, x: 720, y: 185, w: 360, t0: c.inicio + .2, entra: 'descer', dist: 80, deriva: [-4, 0], cena: [c.inicio, c.fim] });
    // documento + caneta: comeca no detalhe da ponta e abre com calma
    const doc = img(c.imagens.documento);
    if (doc) {
      const k = c.ritmo || 1;
      const u = E.inOut3(pr(t, c.inicio, 2.2 * k)), z = 1.75 - .75 * u, px0 = c.caneta.x, py0 = 760 + c.caneta.y;
      const abre = .94 + .06 * u;
      ctx.save(); ctx.translate(px0, py0); ctx.scale(z * abre, z); ctx.translate(-px0, -py0);
      ctx.drawImage(doc, 0, 760, 1080, 1080 * doc.height / doc.width);
      // assinatura sendo escrita a partir da ponta da caneta
      const p = E.inOut3(pr(t, c.inicio + .35 * k, 2.0 * k));
      if (p > 0) {
        ctx.strokeStyle = '#1d3fb8'; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const n = 140; ctx.beginPath();
        for (let i = 0; i <= n * p; i++) { const s = i / n, x = px0 - 190 + s * 520,
          y = py0 + 12 + Math.sin(s * 22) * 22 * (1 - s * .5) - Math.sin(s * 3.1) * 14 + (s > .55 ? (s - .55) * 30 : 0);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(247,243,234,.0)';
    const tam = blocoTexto(c.texto, 132, 900);
    let y = 230;
    c.texto.forEach((l, i) => {
      y += tam[i] * 1.0;
      const info = KineticText.draw(t, { txt: l.linha, x: ZS.lados + 10, y, px: tam[i], cor: l.cor, palavra_cor: l.palavra_cor, alinhar: 'esquerda', t: l.t,
        modo: l.lateral ? 'deslize' : 'subir', dir: l.lateral ? [100, 0] : [0, 55], nome: 'titulo' });
      if (l.sublinhar && t > l.t + .3) KineticText.sublinhar(t, { x0: info.x0, x1: info.x0 + info.larg[0], y: y + 22, t0: l.t + .35, dur: .4 });
    });
  },

  // ---- 6. registro esquematico: scanner, lupa, marca-texto, titulo com impacto
  documento_scanner(t, c) {
    const L = t - c.inicio;
    textura('papel_carvao', 0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(20,87,217,.25)'); g.addColorStop(1, 'rgba(20,87,217,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ArchivePhoto.draw(t, { nome: c.imagens.base, x: 0, y: H - 358, w: 1080, deriva: [-4, 0], cena: [c.inicio, c.fim], tom: 'azul' });
    const k = c.ritmo || 1;
    const zoom = 1 + .05 * E.out3(pr(t, c.inicio + 2.7 * k, .2)) - .03 * E.out3(pr(t, c.inicio + 3.0 * k, 1.0));
    ctx.save(); ctx.translate(540, 640); ctx.scale(zoom, zoom); ctx.translate(-540, -640);
    // documento esquematico (sem nomes, sem partidos): faixas borradas + coluna de voto
    const dx = 70, dy = 190, dw = 940, dh = 900, linhas = c.documento.linhas, alvo = c.documento.alvo;
    const desenhaDoc = () => {
      PaperReveal.draw(t, { id: 'doc6', x: dx, y: dy, w: dw, h: dh, textura: 'papel_marfim', amp: 10, passo: 18, rot: -1.5, sombra: true, fill: '#cfc7b6', t0: c.inicio, dur: .4, lado: 'baixo' });
      ctx.save(); ctx.translate(dx + dw / 2, dy + dh / 2); ctx.rotate(-1.5 * Math.PI / 180); ctx.translate(-dw / 2, -dh / 2);
      ctx.fillStyle = 'rgba(30,30,30,.75)'; ctx.fillRect(40, 40, dw - 80, 6); ctx.fillRect(40, 110, dw - 80, 3);
      ctx.fillRect(dw - 260, 40, 3, dh - 80);
      ctx.font = '40px Anton'; ctx.fillStyle = 'rgba(30,30,30,.85)'; ctx.fillText('VOTO', dw - 220, 95);
      for (let k = 0; k < linhas; k++) {
        const yy = 160 + k * 66;
        ctx.fillStyle = 'rgba(40,40,40,.28)'; ctx.fillRect(60, yy + 4, 360 + ((k * 37) % 180), 22); ctx.fillRect(470, yy + 4, 120 + ((k * 53) % 70), 22);
        ctx.fillStyle = 'rgba(30,30,30,.85)'; ctx.font = '38px Anton';
        ctx.fillText(k === alvo ? 'NÃO' : (k % 5 === 3 ? 'ABST.' : 'SIM'), dw - 210, yy + 30);
        ctx.fillStyle = 'rgba(30,30,30,.18)'; ctx.fillRect(40, yy + 46, dw - 80, 2);
      }
      const tm = c.inicio + 2.55 * k;   // marca-texto laranja na linha encontrada
      if (t >= tm) { const p = E.out3(pr(t, tm, .3)); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = COR('orange');
        ctx.fillRect(40, 160 + alvo * 66 - 6, (dw - 80) * p, 50); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
    };
    desenhaDoc();
    // scanner de cima para baixo
    const ps = pr(t, c.inicio + .35 * k, 1.7 * k);
    if (ps > 0 && ps < 1) { const ys = dy + 30 + ps * (dh - 60);
      const gs = ctx.createLinearGradient(0, ys - 90, 0, ys); gs.addColorStop(0, 'rgba(244,122,31,0)'); gs.addColorStop(1, 'rgba(244,122,31,.28)');
      ctx.fillStyle = gs; ctx.fillRect(dx, ys - 90, dw, 90);
      ctx.save(); ctx.shadowColor = COR('orange'); ctx.shadowBlur = 30; ctx.fillStyle = '#fff3e6'; ctx.fillRect(dx - 20, ys - 3, dw + 40, 6); ctx.restore(); }
    // lupa vai ate a linha destacada
    const pl = E.inOut3(pr(t, c.inicio + 1.8 * k, .8 * k));
    if (t >= c.inicio + 1.6 * k) {
      const lx = 1100 + (dx + dw - 160 - 1100) * pl, ly = 1250 + (dy + 160 + alvo * 66 + 20 - 1250) * pl, R = 150;
      ctx.save(); ctx.globalAlpha = clamp((t - c.inicio - 1.6 * k) / .15);
      ctx.beginPath(); ctx.arc(lx, ly, R, 0, 7); ctx.save(); ctx.clip();
      ctx.translate(lx, ly); ctx.scale(1.6, 1.6); ctx.translate(-lx, -ly); desenhaDoc(); ctx.restore();
      ctx.lineWidth = 18; ctx.strokeStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(lx, ly, R, 0, 7); ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(lx - 10, ly - 10, R - 20, 3.6, 4.6); ctx.stroke();
      ctx.lineWidth = 34; ctx.lineCap = 'round'; ctx.strokeStyle = '#141414'; ctx.beginPath();
      ctx.moveTo(lx + R * .72, ly + R * .72); ctx.lineTo(lx + R * 1.5, ly + R * 1.5); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    etiqueta(c.documento.etiqueta, 96, 205, t, c.inicio + .4);
    vinheta(.4);
    const tam = blocoTexto(c.texto, 150, SAFE_W / 1.06);
    let y = 1170;
    c.texto.forEach((l, i) => {
      y += tam[i] * .98;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, modo: i ? 'scale' : 'subir', dir: [0, 60], sombra: true, desgaste: l.desgaste, nome: 'titulo' });
    });
  },

  // ---- 7. tela dividida que se aproxima; MEMORIA fixa; NARRATIVA por ultimo
  tela_dividida(t, c) {
    const L = t - c.inicio, u = E.inOut3(pr(t, c.inicio, 2.6 * (c.ritmo || 1)));
    ctx.fillStyle = COR('charcoal'); ctx.fillRect(0, 0, W, H);
    const off = 70 * (1 - u);
    ArchivePhoto.draw(t, { nome: c.imagens.esquerda, x: -off - 12 + L * 1.5, y: 0, w: 552 });
    ArchivePhoto.draw(t, { nome: c.imagens.direita, x: 540 + off - L * 1.5, y: 0, w: 552 });
    PaperReveal.draw(t, { id: 'costura7', x: 520 - L * .3, y: -40, w: 40, h: H + 80, fill: COR('orange'), amp: 10, passo: 14, sombra: true });
    PaperReveal.draw(t, { id: 'faixa7', x: -40, y: 760, w: W + 80, h: 520, fill: COR('charcoal'), amp: 20, passo: 18, rot: -1.5, sombra: true, t0: c.inicio - .05, dur: .3, lado: 'esquerda' });
    const tam = blocoTexto(c.texto, 118, SAFE_W - 100);   // folga para o deslize lateral das palavras
    let y = 820;
    c.texto.forEach((l, i) => {
      y += tam[i] * 1.03;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, palavra_cor: l.palavra_cor, ts: l.ts, modo: 'deslize',
        dir: [i % 2 ? 60 : -60, 0], fixa: l.fixa || '__nenhuma__', deriva: l.fixa ? 5 : 3, nome: 'titulo' });
    });
    vinheta(.45);
  },

  // ---- 8. chamada: pergunta em tres tempos, faixa CTA sobe, seta cresce, pulso
  chamada_final(t, c) {
    const L = t - c.inicio;
    textura('papel_azul', 0, 0, W, H, L * 3, L * 2);
    ArchivePhoto.draw(t, { nome: c.imagens.silhueta, x: -60, y: 1300, w: 640, tom: 'azul', deriva: [3, 0], cena: [c.inicio, c.fim], alfa: .85 });
    ArchivePhoto.draw(t, { nome: c.imagens.base, x: 0, y: H - 250, w: 1080, tom: 'azul', deriva: [0, -2], cena: [c.inicio, c.fim] });
    EndCard.seta(t, { pontos: [[60, 1560], [330, 1420], [470, 1470], [760, 1240], [700, 1235], [960, 1080]], t0: c.inicio + .3 * (c.ritmo || 1), dur: 1.1 * (c.ritmo || 1), esp: 66 });
    const tam = blocoTexto(c.texto, 140, SAFE_W);
    let y = 240;
    c.texto.forEach((l, i) => {
      y += tam[i] * 1.02;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, modo: i === 2 ? 'carimbo' : 'subir', dir: [0, 60],
        etiqueta: l.etiqueta_cor, sombra: !l.etiqueta_cor, nome: 'titulo' });
    });
    EndCard.pilula(t, { t0: c.cta.t, y: y + 150, px: 64, texto: c.cta.texto, perfil: c.cta.perfil });
    // fim: movimento diminui junto com a musica
    const f = pr(t, S.total - .6, .6);
    if (f > 0) { ctx.fillStyle = `rgba(10,20,60,${.0 * f})`; ctx.fillRect(0, 0, W, H); }
  },
  // ================================================================ modelos "dado": graficos puros, sem foto
  // ---- fundo comum: papel + selo da serie + faixas rasgadas
  // (definido fora do objeto, ver fundoDado)
  dado_texto(t, c) {
    fundoDado(t, c);
    const k = c.ritmo || 1, escuro = c.fundo === 'marfim';
    if (c.deco === 'riscos') riscosVelocidade(t, c, 40, [COR('orange'), escuro ? COR('blue') : '#000', COR('orange')]);
    const tam = blocoTexto(c.texto, c.base || 185, SAFE_W / 1.04);
    const alt = tam.reduce((a, b) => a + b * 1.02, 0);
    let y = (c.centro || 830) - alt / 2;
    c.texto.forEach((l, i) => {
      y += tam[i] * 1.02;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, ts: l.ts, modo: l.modo || (i ? 'scale' : 'subir'), dir: [0, 60],
        etiqueta: l.etiqueta_cor, sombra: !l.etiqueta_cor && !escuro, desgaste: l.desgaste, palavra_cor: l.palavra_cor, nome: 'titulo' });
    });
    if (c.sublinhar) {
      const l = c.texto[c.sublinhar.linha], yy = (c.centro || 830) - alt / 2 + tam.slice(0, c.sublinhar.linha + 1).reduce((a, b) => a + b * 1.02, 0) + 14;
      const m = medir(l.linha, tam[c.sublinhar.linha]).width;
      KineticText.sublinhar(t, { x0: W / 2 - m / 2, x1: W / 2 + m / 2, y: yy, t0: l.t + .35, cor: c.sublinhar.cor || 'orange', esp: 14 });
    }
    vinheta(escuro ? .12 : .4);
  },

  dado_numero(t, c) {
    fundoDado(t, c);
    const k = c.ritmo || 1, n = c.numero, escuro = c.fundo === 'marfim';
    const cima = c.texto.filter(l => l.cima), baixo = c.texto.filter(l => !l.cima);
    let y = 330;
    const tc = blocoTexto(cima, 96, SAFE_W / 1.1);
    cima.forEach((l, i) => { y += tc[i] * 1.05;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tc[i], cor: l.cor, t: l.t, modo: 'subir', dir: [0, 50], sombra: !escuro, nome: 'titulo' }); });
    // numero grande: conta ate o valor e trava com um tranco
    const dur = .95 * k, u = pr(t, n.t, dur);
    if (t >= n.t) {
      let s = n.valor;
      if (n.contar && u < 1) {
        const v = n.contar.de + (n.contar.ate - n.contar.de) * E.out3(u), cs = n.contar.casas || 0;
        s = (n.contar.prefixo || '') + v.toLocaleString('pt-BR', { minimumFractionDigits: cs, maximumFractionDigits: cs }) + (n.contar.sufixo || '');
      }
      const px = Math.min(n.px || 330, caber(n.valor, n.px || 330, SAFE_W / 1.14));
      const pop = u < 1 ? 1 : 1 + .09 * Math.max(0, 1 - (t - n.t - dur) / .22);
      ctx.save(); ctx.translate(W / 2, n.y || 830); ctx.scale(pop, pop); ctx.globalAlpha = clamp((t - n.t) / .08);
      ctx.font = fonte(px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (!escuro) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12; }
      ctx.fillStyle = COR(n.cor || 'orange'); ctx.fillText(s, 0, 0); ctx.restore();
      const m = medir(n.valor, px).width;
      registrar('numero', W / 2 - m * pop / 2, (n.y || 830) - px * .45, m * pop, px * .9);
      KineticText.sublinhar(t, { x0: W / 2 - m / 2, x1: W / 2 + m / 2, y: (n.y || 830) + px * .5, t0: n.t + dur, cor: n.sublinha || 'ivory', esp: 12 });
    }
    y = (n.y || 830) + (Math.min(n.px || 330, 330)) * .5 + 90;
    const tb = blocoTexto(baixo, 112, SAFE_W / 1.1);
    baixo.forEach((l, i) => { y += tb[i] * 1.03;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tb[i], cor: l.cor, t: l.t, modo: i ? 'scale' : 'subir', dir: [0, 50], sombra: !escuro, nome: 'titulo' }); });
    vinheta(escuro ? .1 : .4);
  },

  dado_barras(t, c) {
    fundoDado(t, c);
    const escuro = c.fundo === 'marfim', max = Math.max(...c.barras.map(b => b.valor));
    let y = 300;
    const tc = blocoTexto(c.texto, 108, SAFE_W / 1.1);
    c.texto.forEach((l, i) => { y += tc[i] * 1.03;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tc[i], cor: l.cor, t: l.t, modo: i ? 'scale' : 'subir', dir: [0, 50], sombra: !escuro, nome: 'titulo' }); });
    let yb = Math.max(y + 130, 640);
    c.barras.forEach((b, i) => {
      const larg = (SAFE_W) * b.valor / max, alt = 150, ub = pr(t, b.t, .55);
      if (t < b.t) { yb += 300; return; }
      ctx.save(); ctx.globalAlpha = clamp((t - b.t) / .12);
      ctx.font = fonte(64); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = escuro ? COR('charcoal') : COR('ivory');
      ctx.fillText(b.rotulo, ZS.lados, yb); ctx.restore();
      registrar('titulo', ZS.lados, yb - 56, medir(b.rotulo, 64).width, 70);
      PaperReveal.draw(t, { id: 'barra' + c.id + i, x: ZS.lados, y: yb + 20, w: larg, h: alt, fill: COR(b.cor), t0: b.t, dur: .55, lado: 'esquerda', amp: 12, passo: 16, sombra: !escuro });
      if (ub > .6) { ctx.save(); ctx.globalAlpha = clamp((ub - .6) / .4); ctx.font = fonte(104); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = b.cor_valor ? COR(b.cor_valor) : COR('ivory'); ctx.fillText(b.texto, ZS.lados + larg - 28, yb + 20 + alt / 2 + 6); ctx.restore();
        registrar('numero', ZS.lados + larg - 28 - medir(b.texto, 104).width, yb + 20 + alt / 2 - 52, medir(b.texto, 104).width, 104); }
      yb += 300;
    });
    if (c.nota) { ctx.save(); ctx.font = '600 28px Mont'; ctx.fillStyle = escuro ? COR('charcoal') : 'rgba(247,243,234,.8)'; ctx.textAlign = 'left';
      ctx.fillText(c.nota, ZS.lados, yb + 10); ctx.restore(); registrar('etiqueta', ZS.lados, yb - 20, medir(c.nota, 28).width, 40); }
    vinheta(escuro ? .1 : .4);
  },

  dado_grade(t, c) {
    fundoDado(t, c);
    const g = c.grade, escuro = c.fundo === 'marfim';
    let y = 300;
    const tc = blocoTexto(c.texto.filter(l => l.cima), 110, SAFE_W / 1.1);
    c.texto.filter(l => l.cima).forEach((l, i) => { y += tc[i] * 1.03;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tc[i], cor: l.cor, t: l.t, modo: 'subir', dir: [0, 50], sombra: !escuro, nome: 'titulo' }); });
    const tam = 150, esp = 42, x0 = (W - (5 * tam + 4 * esp)) / 2, y0 = 560;
    for (let i = 0; i < g.total; i++) {
      const col = i % 5, lin = Math.floor(i / 5), cx = x0 + col * (tam + esp) + tam / 2, cy = y0 + lin * (tam + 70) + tam / 2;
      const tf = g.t + i * (g.passo || .09) * (c.ritmo || 1), cheio = i < g.preenchidos, ent = E.outBack(pr(t, c.inicio + .15 + i * .03, .3));
      ctx.save(); ctx.translate(cx, cy); const sc = ent * (cheio && t >= tf ? 1 + .22 * Math.max(0, 1 - (t - tf) / .25) : 1); ctx.scale(sc, sc);
      ctx.fillStyle = cheio && t >= tf ? COR(g.cor) : (escuro ? 'rgba(23,23,23,.18)' : 'rgba(247,243,234,.2)');
      ctx.beginPath(); ctx.arc(0, -tam * .27, tam * .2, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-tam * .34, -tam * .02, tam * .68, tam * .5, [tam * .3, tam * .3, tam * .06, tam * .06]); ctx.fill();
      ctx.restore();
    }
    y = y0 + 2 * (tam + 70) + 40;
    const tb = blocoTexto(c.texto.filter(l => !l.cima), 120, SAFE_W / 1.1);
    c.texto.filter(l => !l.cima).forEach((l, i) => { y += tb[i] * 1.03;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tb[i], cor: l.cor, t: l.t, modo: i ? 'scale' : 'subir', dir: [0, 50], sombra: !escuro, nome: 'titulo' }); });
    vinheta(escuro ? .1 : .4);
  },

  dado_linha(t, c) {
    fundoDado(t, c);
    const escuro = c.fundo === 'marfim';
    let y = 300;
    const tc = blocoTexto(c.texto, 108, SAFE_W / 1.1);
    c.texto.forEach((l, i) => { y += tc[i] * 1.03;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tc[i], cor: l.cor, t: l.t, modo: i ? 'scale' : 'subir', dir: [0, 50], sombra: !escuro, nome: 'titulo' }); });
    const y0 = Math.max(y + 110, 620), passo = 330, xl = 170;
    const ult = c.marcos[c.marcos.length - 1], yfim = y0 + passo * (c.marcos.length - 1);
    const ph = E.out3(pr(t, c.marcos[0].t - .1, (ult.t - c.marcos[0].t) + .5));
    ctx.save(); ctx.strokeStyle = escuro ? COR('charcoal') : COR('ivory'); ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(xl, y0); ctx.lineTo(xl, y0 + (yfim - y0) * ph); ctx.stroke(); ctx.restore();
    c.marcos.forEach((m, i) => {
      if (t < m.t) return;
      const yy = y0 + i * passo, u = E.out5(pr(t, m.t, .4));
      ctx.save(); ctx.globalAlpha = u; ctx.translate(0, (1 - u) * 40);
      ctx.fillStyle = COR(m.cor || 'orange'); ctx.beginPath(); ctx.arc(xl, yy, 34, 0, 7); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = fonte(m.px_ano || 120); ctx.fillStyle = COR(m.cor || 'orange'); ctx.fillText(m.ano, xl + 70, yy + 20);
      ctx.font = fonte(m.px || 62); ctx.fillStyle = escuro ? COR('charcoal') : COR('ivory');
      const px = Math.min(m.px || 62, caber(m.rotulo, m.px || 62, W - ZS.lados - (xl + 70)));
      ctx.font = fonte(px); ctx.fillText(m.rotulo, xl + 70, yy + 100); ctx.restore();
      registrar('titulo', xl + 70, yy - 80, Math.max(medir(m.ano, m.px_ano || 120).width, medir(m.rotulo, px).width), 190);
    });
    vinheta(escuro ? .1 : .4);
  },

  cta_simples(t, c) {
    const L = t - c.inicio;
    textura('papel_azul', 0, 0, W, H, L * 3, L * 2);
    selo(t, c);
    EndCard.seta(t, { pontos: [[60, 1560], [330, 1420], [470, 1470], [760, 1240], [700, 1235], [960, 1080]], t0: c.inicio + .3 * (c.ritmo || 1), dur: 1.1 * (c.ritmo || 1), esp: 66 });
    const tam = blocoTexto(c.texto, 140, SAFE_W / 1.1);
    let y = 300;
    c.texto.forEach((l, i) => { y += tam[i] * 1.02;
      KineticText.draw(t, { txt: l.linha, x: W / 2, y, px: tam[i], cor: l.cor, t: l.t, modo: i === c.texto.length - 1 ? 'carimbo' : 'subir', dir: [0, 60],
        etiqueta: l.etiqueta_cor, sombra: !l.etiqueta_cor, nome: 'titulo' }); });
    EndCard.pilula(t, { t0: c.cta.t, y: y + 170, px: 64, texto: c.cta.texto, perfil: c.cta.perfil });
    vinheta(.3);
  },

};

// ================================================================ MotionReel
const Scene = { atual(t) { return S.cenas.find(c => t >= c.inicio && t < c.fim) || S.cenas[S.cenas.length - 1]; } };
const MotionReel = {
  seek(t) {
    LOG.caixas = [];
    const c = Scene.atual(t);
    const cam = ImpactTransition.camera(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const empurra = 1 + (S.empurrao || 0) * E.inOut3(pr(t, c.inicio, c.fim - c.inicio));   // a camera nunca para
    ctx.save(); ctx.translate(W / 2 + cam.ox, H / 2 + cam.oy); ctx.scale(cam.z * empurra, cam.z * empurra); ctx.translate(-W / 2, -H / 2);
    MODELOS[c.modelo](t, c);
    ctx.restore();
    ImpactTransition.draw(t);
    DynamicCaptions.draw(t);
    const gr = img('grao_' + (Math.floor(t * S.fps) % 4));   // granulacao sutil
    if (gr) { ctx.save(); ctx.globalAlpha = .07; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(gr, 0, 0, W, H); ctx.restore(); }
    return { t, cena: c.id, caixas: LOG.caixas };
  },
};
window.seek = t => MotionReel.seek(t);

(async () => {
  const fs = [new FontFace('Anton', `url(${D.fontes.titulo})`), new FontFace('Mont', `url(${D.fontes.apoio})`, { weight: '100 900' })];
  await Promise.all(fs.map(f => f.load())); fs.forEach(f => document.fonts.add(f));
  await Promise.all(Object.entries(D.imagens).map(([n, u]) => new Promise(ok => { const i = new Image(); i.onload = () => { IMG[n] = i; ok(); }; i.onerror = () => ok(); i.src = u; })));
  window.pronto = true;
})();
