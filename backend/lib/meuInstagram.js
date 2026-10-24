// "Meu Instagram": lê as métricas REAIS de cada post pela Graph API (a mesma conexão usada
// para publicar) e resume sem inventar nada.
//
// Regras desta camada (todas vêm de erros que já aconteceram):
//  - Métrica ausente é null, nunca zero ("a API devolve vazio, não 0").
//  - Seguidor por post só existe para posts de feed (não para Reels): o painel mostra isso.
//  - Posts com menos de 72 h ainda acumulam números (e a Meta pode atrasar até 48 h): ficam
//    fora das comparações.
//  - Mediana, não média: dois posts virais distorcem qualquer média.
//  - Nenhum "vencedor" com amostra pequena: grupo com menos de 5 posts vira "amostra pequena".
//  - Curtidas e comentários não entram: a conexão atual nem sempre os devolve.
//
// Documentação conferida (referência de Instagram Media Insights, Meta, out/2026):
//  reach, saved, shares, total_interactions, views: feed e Reels; follows, profile_visits:
//  só feed e Stories; exige instagram_manage_insights; dados podem atrasar até 48 h; sem
//  dado a API devolve vazio em vez de 0; mídias dentro de um álbum não têm insights próprios.
const meta = require('./meta');

const FEED = ['reach', 'saved', 'shares', 'total_interactions', 'views', 'follows', 'profile_visits'];
const REEL = ['reach', 'saved', 'shares', 'total_interactions', 'views'];
const BASICAS = ['reach', 'saved', 'shares', 'total_interactions', 'views'];
const JANELA_MADURA_H = 72;
const MIN_POR_GRUPO = 5;
const ROTULO_TIPO = { carrossel: 'Carrossel', imagem: 'Imagem', reel: 'Reel', video: 'Vídeo' };

const mediana = (arr) => {
  const v = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const arred = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const porMil = (parte, reach, d = 1) => (parte == null || !reach ? null : arred((parte / reach) * 1000, d));

function tipoDe(m) {
  if (m.media_product_type === 'STORY') return null;
  if (m.media_product_type === 'REELS' || m.media_type === 'REELS') return 'reel';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'carrossel';
  if (m.media_type === 'IMAGE') return 'imagem';
  if (m.media_type === 'VIDEO') return 'video';
  return null;
}

// { data: [{ name, values: [{ value }] | total_value: { value } }] } → { reach: 123, ... }
function lerValores(resp) {
  const out = {};
  for (const d of resp?.data || []) {
    const v = d.values?.[0]?.value ?? d.total_value?.value;
    out[d.name] = typeof v === 'number' ? v : null;
  }
  return out;
}

// Busca as métricas de uma mídia. Se a Meta recusar alguma (conta, tipo ou versão), tenta
// o conjunto básico e depois só o alcance, e registra o que ficou de fora.
async function insightsDe(m, grafo) {
  const tipo = m.tipo;
  const desejadas = tipo === 'reel' || tipo === 'video' ? REEL : FEED;
  const tentativas = [desejadas, BASICAS, ['reach']];
  let ultimoErro = null;
  for (const lista of tentativas) {
    try {
      const valores = lerValores(await grafo('GET', `${m.id}/insights`, { metric: lista.join(',') }));
      const faltando = desejadas.filter((k) => valores[k] === undefined || valores[k] === null);
      return { valores, indisponiveis: faltando, erro: null };
    } catch (e) {
      ultimoErro = e.meta || { amigavel: e.message };
      if (ultimoErro.tipo === 'token' || ultimoErro.tipo === 'permissao') break; // não adianta tentar menos métricas
    }
  }
  return { valores: {}, indisponiveis: desejadas, erro: ultimoErro };
}

async function paraCadaUm(itens, limite, fn) {
  const resultado = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; resultado[k] = await fn(itens[k], k); }
  }));
  return resultado;
}

// Lê a conta, os posts dos últimos `dias` e as métricas de cada um.
async function atualizar({ grafo = meta.graph, igId = meta.config().igId, agora = Date.now(), limite = 60, dias = 90, orcamentoMs = 45000, daFerramenta = new Map() } = {}) {
  const t0 = Date.now();
  const avisos = [];
  const desde = agora - dias * 86400000;
  const conta = await grafo('GET', igId, { fields: 'username,followers_count,media_count' });

  const midias = [];
  let depois = null;
  for (let pag = 0; pag < 6 && midias.length < limite; pag++) {
    const r = await grafo('GET', `${igId}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,timestamp', limit: 50, ...(depois ? { after: depois } : {}) });
    let fim = false;
    for (const m of r.data || []) {
      if (Date.parse(m.timestamp) < desde) { fim = true; break; }
      const tipo = tipoDe(m);
      if (tipo) midias.push({ ...m, tipo });
    }
    depois = r.paging?.cursors?.after;
    if (fim || !r.paging?.next || !depois) break;
  }
  const alvo = midias.slice(0, limite);
  let parcial = false;
  const posts = await paraCadaUm(alvo, 5, async (m) => {
    if (Date.now() - t0 > orcamentoMs) { parcial = true; return { m, ins: null }; }
    return { m, ins: await insightsDe(m, grafo) };
  }).then((lista) => lista.map(({ m, ins }) => {
    const v = ins?.valores || {};
    const idadeH = Math.max(0, (agora - Date.parse(m.timestamp)) / 3600000);
    return {
      id: m.id, tipo: m.tipo, permalink: m.permalink || null, publicado_em: m.timestamp,
      legenda: String(m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      idade_h: Math.round(idadeH), maduro: idadeH >= JANELA_MADURA_H,
      alcance: v.reach ?? null, visualizacoes: v.views ?? null, salvamentos: v.saved ?? null, compartilhamentos: v.shares ?? null,
      interacoes: v.total_interactions ?? null, seguidores_ganhos: v.follows ?? null, visitas_ao_perfil: v.profile_visits ?? null,
      sem_dados: ins ? ins.indisponiveis : ['todas'], erro_meta: ins?.erro ? (ins.erro.amigavel || null) : null,
      da_ferramenta: daFerramenta.has(m.id), content_id: daFerramenta.get(m.id) || null,
    };
  }));
  if (parcial) avisos.push('A leitura foi interrompida por tempo. Atualize de novo para completar.');
  const comErroDePermissao = posts.filter((p) => p.erro_meta).length;
  if (comErroDePermissao && comErroDePermissao === posts.length) avisos.push(`A Meta recusou as métricas: ${posts[0].erro_meta} Confira se o token tem a permissão instagram_manage_insights.`);

  // Alcance diário e seguidores novos por dia (últimos 30 dias); se a Meta recusar, o painel diz que não está disponível.
  let serie = null;
  try {
    const ate = Math.floor(agora / 1000); const de = ate - 29 * 86400;
    const r = await grafo('GET', `${igId}/insights`, { metric: 'reach,follower_count', period: 'day', since: de, until: ate });
    serie = {};
    for (const d of r.data || []) serie[d.name] = (d.values || []).map((x) => ({ fim: x.end_time, valor: typeof x.value === 'number' ? x.value : null }));
  } catch (e) { avisos.push(`Série diária da conta indisponível: ${(e.meta?.amigavel || e.message || '').slice(0, 160)}`); }

  return {
    gerado_em: new Date(agora).toISOString(), janela_dias: dias, parcial, avisos,
    conta: { usuario: conta.username || null, seguidores: conta.followers_count ?? null, midias: conta.media_count ?? null },
    serie_conta: serie, posts,
  };
}

// ── Análise (pura: recebe posts e devolve o resumo; roda igual em teste e em produção) ──
function medidas(p) {
  return {
    compartilhamentos_por_mil: porMil(p.compartilhamentos, p.alcance),
    salvamentos_por_mil: porMil(p.salvamentos, p.alcance),
    visitas_por_mil: porMil(p.visitas_ao_perfil, p.alcance),
    seguidores_por_mil: porMil(p.seguidores_ganhos, p.alcance, 2),
    interacoes_por_mil: porMil(p.interacoes, p.alcance),
  };
}

function resumoGrupo(posts, minPorGrupo) {
  const ps = posts.filter((p) => p.alcance);
  const ms = ps.map(medidas);
  const comSeg = ps.filter((p) => p.seguidores_ganhos != null);
  return {
    n: ps.length,
    amostra: ps.length >= minPorGrupo ? 'suficiente' : 'pequena',
    alcance_mediana: arred(mediana(ps.map((p) => p.alcance)), 0),
    compartilhamentos_por_mil_mediana: arred(mediana(ms.map((m) => m.compartilhamentos_por_mil))),
    salvamentos_por_mil_mediana: arred(mediana(ms.map((m) => m.salvamentos_por_mil))),
    visitas_por_mil_mediana: arred(mediana(ms.map((m) => m.visitas_por_mil))),
    seguidores_ganhos_total: comSeg.length ? comSeg.reduce((s, p) => s + p.seguidores_ganhos, 0) : null,
    n_com_seguidores: comSeg.length,
  };
}

function analisar(posts, { minPorGrupo = MIN_POR_GRUPO, seguidoresDaConta = null } = {}) {
  const todos = posts.map((p) => ({ ...p, medidas: medidas(p) }));
  const maduros = todos.filter((p) => p.maduro && p.alcance);
  const imaturos = todos.filter((p) => !p.maduro).length;
  const semDados = todos.filter((p) => p.maduro && !p.alcance).length;

  const porTipo = {};
  for (const t of Object.keys(ROTULO_TIPO)) {
    const g = maduros.filter((p) => p.tipo === t);
    if (g.length) porTipo[t] = { rotulo: ROTULO_TIPO[t], ...resumoGrupo(g, minPorGrupo) };
  }
  const porOrigem = {};
  for (const [id, rotulo, fn] of [['ferramenta', 'Publicados pela ferramenta', (p) => p.da_ferramenta], ['fora', 'Publicados fora da ferramenta', (p) => !p.da_ferramenta]]) {
    const g = maduros.filter(fn);
    if (g.length) porOrigem[id] = { rotulo, ...resumoGrupo(g, minPorGrupo) };
  }

  // Comparação entre formatos: só com os dois lados suficientes; o texto fala em indício, nunca em vencedor.
  const comparacoes = [];
  const tipos = Object.keys(porTipo);
  for (let i = 0; i < tipos.length; i++) {
    for (let j = i + 1; j < tipos.length; j++) {
      const a = porTipo[tipos[i]]; const b = porTipo[tipos[j]];
      const base = { a: tipos[i], b: tipos[j], metrica: 'compartilhamentos_por_mil_mediana', n_a: a.n, n_b: b.n };
      if (a.amostra !== 'suficiente' || b.amostra !== 'suficiente') { comparacoes.push({ ...base, leitura: `Sem comparação: ${a.amostra !== 'suficiente' ? a.n : b.n} posts não bastam (mínimo ${minPorGrupo} por grupo).` }); continue; }
      const x = a.compartilhamentos_por_mil_mediana; const y = b.compartilhamentos_por_mil_mediana;
      if (!x || !y) { comparacoes.push({ ...base, leitura: 'Sem comparação: faltam envios medidos em um dos grupos.' }); continue; }
      const razao = arred(Math.max(x, y) / Math.min(x, y), 2);
      comparacoes.push({ ...base, razao, leitura: razao >= 1.5 ? `Indício: ${ROTULO_TIPO[x > y ? tipos[i] : tipos[j]]} tem mediana ${razao}× maior em envios por mil. É um indício; formato, tema e horário se misturam.` : 'Sem diferença clara entre os formatos.' });
    }
  }

  // Concentração: quem entrega o crescimento.
  const comSeg = todos.filter((p) => p.seguidores_ganhos != null);
  const totalSeg = comSeg.reduce((s, p) => s + p.seguidores_ganhos, 0);
  const topSeg = [...comSeg].sort((a, b) => b.seguidores_ganhos - a.seguidores_ganhos).slice(0, 2);
  const concentracao = comSeg.length ? { total: totalSeg, n_posts: comSeg.length, top2: topSeg.map((p) => ({ id: p.id, permalink: p.permalink, seguidores: p.seguidores_ganhos })), pct_top2: totalSeg ? arred((topSeg.reduce((s, p) => s + p.seguidores_ganhos, 0) / totalSeg) * 100, 0) : null, posts_sem_seguidor: comSeg.filter((p) => !p.seguidores_ganhos).length } : null;

  // Fora da curva: alcance muito acima da mediana (não representa o "normal" da conta).
  const medAlc = mediana(maduros.map((p) => p.alcance));
  const foraDaCurva = medAlc ? maduros.filter((p) => p.alcance >= medAlc * 5).map((p) => ({ id: p.id, permalink: p.permalink, alcance: p.alcance, vezes_a_mediana: arred(p.alcance / medAlc, 1) })) : [];

  // Rankings descritivos (não dizem a causa).
  const ord = (campo, dir) => [...maduros].filter((p) => p.medidas[campo] != null).sort((a, b) => dir * (b.medidas[campo] - a.medidas[campo])).slice(0, 5).map((p) => ({ id: p.id, tipo: p.tipo, permalink: p.permalink, legenda: p.legenda, alcance: p.alcance, compartilhamentos_por_mil: p.medidas.compartilhamentos_por_mil, salvamentos_por_mil: p.medidas.salvamentos_por_mil, seguidores_ganhos: p.seguidores_ganhos, da_ferramenta: p.da_ferramenta }));

  const observacoes = [];
  if (concentracao?.pct_top2 != null && concentracao.n_posts >= 5) observacoes.push(`${concentracao.top2.length} post(s) trouxeram ${concentracao.pct_top2}% dos ${concentracao.total} seguidores atribuídos a posts de feed; ${concentracao.posts_sem_seguidor} de ${concentracao.n_posts} posts não trouxeram nenhum.`);
  if (foraDaCurva.length) observacoes.push(`${foraDaCurva.length} post(s) tiveram alcance 5× acima da mediana (${arred(medAlc, 0)}): os números médios enganam, use a mediana.`);
  if (porTipo.reel) observacoes.push('Reels não informam seguidores ganhos por post (limite da Meta): o efeito deles no crescimento não aparece aqui.');
  if (imaturos) observacoes.push(`${imaturos} post(s) com menos de ${JANELA_MADURA_H} h ficaram fora das comparações: os números ainda estão subindo.`);
  if (semDados) observacoes.push(`${semDados} post(s) maduros sem métricas devolvidas pela Meta: não são tratados como zero.`);

  return {
    min_por_grupo: minPorGrupo, n_posts: todos.length, n_comparaveis: maduros.length, n_imaturos: imaturos, n_sem_dados: semDados,
    alcance_mediana: arred(medAlc, 0), seguidores_da_conta: seguidoresDaConta,
    por_tipo: porTipo, por_origem: porOrigem, comparacoes, concentracao_seguidores: concentracao, fora_da_curva: foraDaCurva,
    melhores_por_envios: ord('compartilhamentos_por_mil', 1), menores_por_envios: ord('compartilhamentos_por_mil', -1),
    observacoes,
    limitacoes: [
      'Os números vêm da Meta e podem atrasar até 48 horas; métrica sem dado aparece como "—", nunca como zero.',
      'Seguidores ganhos por post existem só para feed (imagem e carrossel), não para Reels.',
      'Envios, salvamentos e visitas por mil alcançados são comparáveis entre posts; comparar formatos mistura tema, horário e público, então vale como indício.',
    ],
  };
}

module.exports = { atualizar, analisar, medidas, tipoDe, lerValores, insightsDe, mediana, MIN_POR_GRUPO, JANELA_MADURA_H, FEED, REEL };
