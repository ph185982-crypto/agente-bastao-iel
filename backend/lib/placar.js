// Placar real: liga cada post publicado PELA FERRAMENTA aos atributos de como ele foi feito (linha editorial, formato, quem
// escreveu, tipo de gancho, notas do júri e do painel) e mede pelo que importa para crescer: ENVIOS e SALVOS por mil
// alcançados, alcance e seguidores ganhos. Antes a ferramenta lia as métricas só quando o Pedro apertava "Atualizar",
// sobrescrevia o histórico e comparava o painel com curtidas; nada disso voltava para a produção.
//
//  - coletar(): lê os insights (uma vez por dia, pelo piloto, ou pelo botão), guarda a foto do dia, uma série curta por post
//    (a curva das primeiras duas semanas) e o placar compacto em config.meu_placar.
//  - calcular(): função pura. Poucos posts = indício, nunca "vencedor": cada grupo traz n e a amostra mínima.
//  - pesos(): o que o placar manda de volta para a produção (formato e redator), sempre com 20% de exploração para o que
//    ainda tem pouco dado. Sem dado suficiente, não decide nada (a produção segue no rodízio).
const MI = require('./meuInstagram');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const TIPO_SERIE = 'metrica';
const MIN_GRUPO = 3;          // menos que isso num grupo: não entra em decisão
const MIN_CALIBRAR = 10;      // pares (nota × resultado) para dizer se júri ou painel acertam
const EXPLORACAO = 0.2;
const DIAS_SERIE = 14; const PONTOS_SERIE = 16;
const conta = () => ACCOUNT.ig_id;
const arred = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const porMil = (parte, alcance) => (parte == null || !alcance ? null : (parte / alcance) * 1000);
const med = (xs) => MI.mediana(xs.filter((x) => x != null && Number.isFinite(x)));

// Como o conteúdo foi feito. Lido do documento na hora do placar (nada novo é gravado na produção).
function fichaDe(c) {
  if (!c) return null;
  const top = c.top || null; const v = top?.versoes?.[top?.escolha?.versao];
  const capa = v?.capas?.[top?.escolha?.capas?.[0] ?? 0];
  const mec = String(capa?.mecanismo || '');
  return {
    content_id: c.id, titulo: String(c.titulo || '').slice(0, 90),
    linha: c.video ? 'video' : top ? (['opiniao', 'historia', 'como_fazer', 'caso'].includes(top.entrada?.modo) ? top.entrada.modo : 'noticia') : 'outro',
    origem: top?.origem || c.reciclagem?.origem || c.origem?.tipo || null,
    formato: c.video ? 'reel' : top?.formato || c.formato || null,
    redator: top?.mentes?.roteiro || v?.mente || c.video?.mente || null,
    capa_de: mec.startsWith('mente:') ? mec.slice(6) : (mec ? 'juri' : null),
    gancho: mec && !mec.startsWith('mente:') ? mec.slice(0, 30) : null,
    estilo_video: c.video?.estilo || null,
    nota_juri: Number.isFinite(top?.escolha?.nota) ? top.escolha.nota : null,
    nota_painel: Number.isFinite(top?.painel?.nota) ? top.painel.nota : null,
  };
}

function resumo(posts) {
  const ps = posts.filter((p) => p.alcance);
  const seg = ps.filter((p) => p.seguidores_ganhos != null);
  return {
    n: ps.length,
    alcance: arred(med(ps.map((p) => p.alcance)), 0),
    envios_mil: arred(med(ps.map((p) => porMil(p.compartilhamentos, p.alcance)))),
    salvos_mil: arred(med(ps.map((p) => porMil(p.salvamentos, p.alcance)))),
    seguidores: seg.length ? seg.reduce((s, p) => s + p.seguidores_ganhos, 0) : null,
  };
}

const ranks = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
function spearman(a, b) {
  if (a.length < 3) return null;
  const ra = ranks(a); const rb = ranks(b); const n = a.length; const ma = ra.reduce((s, x) => s + x, 0) / n; const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0; let da = 0; let db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}
// A nota prevê o resultado? Resultado = envios + salvos por mil alcançados.
function calibrar(pares) {
  const ok = pares.filter((p) => p.nota != null && p.resultado != null);
  const r = spearman(ok.map((p) => p.nota), ok.map((p) => p.resultado));
  const n = ok.length;
  return {
    n, correlacao: r == null ? null : arred(r, 2), amostra: n >= MIN_CALIBRAR ? 'suficiente' : 'pequena',
    acerta: n >= MIN_CALIBRAR && r != null ? r >= 0.3 : null,
    leitura: n < MIN_CALIBRAR ? `Ainda poucos posts com nota e resultado (${n}); preciso de ${MIN_CALIBRAR} para dizer se a nota acerta.`
      : r >= 0.3 ? 'A nota acompanha o resultado real: quem tira nota alta costuma ser mais enviado e salvo.'
        : 'A nota NÃO acompanha o resultado real: nota alta não tem trazido mais envios nem salvos.',
  };
}

// Pura. `posts`: os posts da foto mais recente (meuInstagram.atualizar). `fichas`: Map content_id → fichaDe(doc).
function calcular(posts = [], fichas = new Map()) {
  const maduros = posts.filter((p) => p.maduro && p.alcance);
  const meus = maduros.filter((p) => !p.da_ferramenta);
  const dela = maduros.filter((p) => p.da_ferramenta).map((p) => ({ ...p, ficha: fichas.get(p.content_id) || null }));
  const base = resumo(meus);
  const grupo = (campo) => {
    const m = new Map();
    for (const p of dela) { const k = p.ficha?.[campo]; if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    return [...m.entries()].map(([valor, ps]) => {
      const r = resumo(ps);
      return { valor, ...r, amostra: r.n >= MIN_GRUPO ? 'suficiente' : 'pequena', contra_os_seus: base.envios_mil && r.envios_mil != null ? arred(r.envios_mil / base.envios_mil, 2) : null };
    }).sort((a, b) => (b.envios_mil ?? -1) - (a.envios_mil ?? -1) || b.n - a.n);
  };
  const resultado = (p) => { const e = porMil(p.compartilhamentos, p.alcance); const s = porMil(p.salvamentos, p.alcance); return e == null && s == null ? null : (e || 0) + (s || 0); };
  const dims = { linha: grupo('linha'), formato: grupo('formato'), redator: grupo('redator'), capa_de: grupo('capa_de'), gancho: grupo('gancho'), origem: grupo('origem'), estilo_video: grupo('estilo_video') };
  return {
    seus: base, ferramenta: resumo(dela), sem_ficha: dela.filter((p) => !p.ficha).length,
    por: dims,
    calibracao: {
      juri: calibrar(dela.map((p) => ({ nota: p.ficha?.nota_juri ?? null, resultado: resultado(p) }))),
      painel: calibrar(dela.map((p) => ({ nota: p.ficha?.nota_painel ?? null, resultado: resultado(p) }))),
    },
    pesos: { formato: pesos(dims.formato), redator: pesos(dims.redator) },
    regras: { min_grupo: MIN_GRUPO, min_calibrar: MIN_CALIBRAR, exploracao: EXPLORACAO, medida: 'envios e salvos por mil alcançados; só posts com mais de 48 h' },
  };
}

// Pesos para a produção: proporcional aos envios por mil dos grupos com amostra suficiente. Precisa de pelo menos 2 grupos
// medidos; senão devolve null e a produção segue no rodízio. (A exploração é aplicada em `sortear`.)
function pesos(grupos) {
  const ok = (grupos || []).filter((g) => g.n >= MIN_GRUPO && g.envios_mil != null);
  if (ok.length < 2) return null;
  const total = ok.reduce((s, g) => s + Math.max(0.05, g.envios_mil), 0);
  return Object.fromEntries(ok.map((g) => [g.valor, arred(Math.max(0.05, g.envios_mil) / total, 3)]));
}

// Escolhe uma opção: 80% pelo peso medido, 20% repartido por igual entre TODAS as opções (o que tem pouco dado continua
// sendo testado). `u` é um número em [0,1) (determinístico em quem chama). Sem pesos: null (quem chama usa o rodízio).
function sortear(opcoes, pesosDim, u) {
  if (!pesosDim || !opcoes?.length) return null;
  const medidos = opcoes.filter((o) => pesosDim[o] > 0); if (medidos.length < 2) return null;
  const soma = medidos.reduce((s, o) => s + pesosDim[o], 0);
  const p = opcoes.map((o) => (1 - EXPLORACAO) * ((pesosDim[o] || 0) / soma) + EXPLORACAO / opcoes.length);
  let acc = 0; const x = Math.min(0.999999, Math.max(0, Number(u) || 0));
  for (let i = 0; i < opcoes.length; i++) { acc += p[i]; if (x < acc) return opcoes[i]; }
  return opcoes[opcoes.length - 1];
}

// ── Coleta ──────────────────────────────────────────────────────────────────
async function fichasDosPosts(posts, a) {
  const m = new Map();
  for (const id of [...new Set(posts.filter((p) => p.da_ferramenta && p.content_id).map((p) => p.content_id))].slice(0, 80)) {
    try { const r = await a.conteudos.obter(conta(), id); if (r?.doc) m.set(id, fichaDe(r.doc)); } catch { /* conteúdo apagado: fica sem ficha */ }
  }
  return m;
}

// Série curta por post: um ponto por dia nas duas primeiras semanas (depois disso o post já deu o que tinha de dar).
async function guardarSerie(posts, a, agora) {
  if (!a?.radar) return 0; let n = 0;
  for (const p of posts) {
    if (!p.alcance || agora - Date.parse(p.publicado_em) > DIAS_SERIE * 86400000) continue;
    try {
      const atual = (await a.radar.obter(conta(), TIPO_SERIE, String(p.id)))?.doc || { id: String(p.id), content_id: p.content_id || null, da_ferramenta: !!p.da_ferramenta, tipo: p.tipo, publicado_em: p.publicado_em, pontos: [] };
      const ult = atual.pontos[atual.pontos.length - 1];
      if (ult && agora - Date.parse(ult.em) < 20 * 3600000) continue;
      atual.pontos = [...atual.pontos, { em: new Date(agora).toISOString(), idade_h: p.idade_h, alcance: p.alcance, envios: p.compartilhamentos ?? null, salvos: p.salvamentos ?? null, seguidores: p.seguidores_ganhos ?? null }].slice(-PONTOS_SERIE);
      await a.radar.salvar(conta(), TIPO_SERIE, atual.id, atual); n++;
    } catch { /* um post sem série não derruba a coleta */ }
  }
  return n;
}

// Lê os insights, guarda a foto, a série e o placar. Usada pelo botão "Atualizar" e pela coleta diária do piloto.
async function coletar({ agora = Date.now(), orcamentoMs = 45000, deps = {} } = {}) {
  const a = deps.armazem || armazem();
  const daFerramenta = new Map();
  try { (await (deps.listarPublicacoes || (() => require('./publicador').listarPublicacoes()))()).filter((p) => p.estado === 'publicada' && p.ig_media_id).forEach((p) => daFerramenta.set(String(p.ig_media_id), p.content_id)); } catch { /* sem banco: nenhum marcado */ }
  const snapshot = await (deps.atualizar || MI.atualizar)({ daFerramenta, agora, orcamentoMs });
  let placar = null; let pontos = 0;
  if (a?.duravel) {
    placar = { ...calcular(snapshot.posts, await fichasDosPosts(snapshot.posts, a)), gerado_em: snapshot.gerado_em, parcial: !!snapshot.parcial };
    // Leitura parcial (tempo esgotado) não substitui um placar completo de hoje.
    await a.config.salvar(conta(), { meu_instagram: snapshot, ...(snapshot.parcial ? {} : { meu_placar: placar }) });
    pontos = await guardarSerie(snapshot.posts, a, agora);
  }
  return { snapshot, placar, pontos_gravados: pontos };
}

async function ler() {
  const a = armazem(); if (!a?.duravel) return null;
  return (await a.config.obter(conta())).meu_placar || null;
}

module.exports = { fichaDe, calcular, calibrar, pesos, sortear, coletar, ler, spearman, guardarSerie, TIPO_SERIE, MIN_GRUPO, MIN_CALIBRAR, EXPLORACAO };
