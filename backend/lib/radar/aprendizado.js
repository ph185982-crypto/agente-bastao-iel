// Aprendizado: depois que um carrossel é marcado como publicado, o Pedro informa (ou o app lê) os números do post.
// O Radar descobre quais CATEGORIAS geram mais alcance, retenção, compartilhamentos e seguidores.
// Curtida não é seguidor: cada métrica é guardada e comparada separadamente, e "seguidores ganhos" só conta quando foi informado.
const store = require('./store');
const C = require('./config');
const U = require('./util');

const CAMPOS = ['visualizacoes', 'alcance', 'curtidas', 'comentarios', 'compartilhamentos', 'salvamentos', 'visitas_perfil', 'seguidores_ganhos', 'retencao_pct'];
const MIN_AMOSTRA = 3;

function validarMetricas(m = {}) {
  const out = {};
  for (const k of CAMPOS) {
    if (m[k] === undefined || m[k] === null || m[k] === '') continue;           // ausente continua ausente: nunca vira zero
    const n = Number(m[k]);
    if (!Number.isFinite(n) || n < 0) throw U.erro(`Valor inválido em “${k}”.`, 'ENTRADA');
    if (k === 'retencao_pct' && n > 100) throw U.erro('A retenção é uma porcentagem de 0 a 100.', 'ENTRADA');
    out[k] = n;
  }
  if (out.seguidores_ganhos !== undefined && out.curtidas !== undefined && out.seguidores_ganhos === out.curtidas && out.curtidas > 50) out.aviso = 'Seguidores ganhos igual ao número de curtidas: confira, são métricas diferentes.';
  return out;
}

// Marca como publicado e guarda data, horário e (opcionalmente) as métricas.
async function marcarPublicado(carrosselId, { publicado_em, link = null, metricas = {} } = {}, { agora = Date.now() } = {}) {
  const quando = publicado_em ? new Date(publicado_em) : new Date(agora);
  if (Number.isNaN(quando.getTime())) throw U.erro('Data de publicação inválida.', 'ENTRADA');
  if (link && !/^https:\/\/(www\.)?instagram\.com\//i.test(link)) throw U.erro('O link deve ser de um post do Instagram (https://www.instagram.com/...).', 'ENTRADA');
  const m = validarMetricas(metricas);
  const { doc } = await store.atualizar('carrossel', carrosselId, (c) => {
    if (c.estado === 'erro' || c.estado === 'gerando') throw U.erro('Este carrossel ainda não está pronto.', 'ESTADO', 409);
    c.estado = 'publicado';
    c.publicacao = { publicado_em: quando.toISOString(), dia_semana: quando.getUTCDay(), hora_brt: new Date(quando.getTime() - 3 * 3600000).getUTCHours(), link, marcado_em: new Date(agora).toISOString() };
    c.metricas = { ...(c.metricas || {}), ...m, atualizadas_em: new Date(agora).toISOString() };
    (c.historico ||= []).push({ em: new Date(agora).toISOString(), evento: 'publicado', detalhe: { link } });
    return c;
  });
  await store.atualizar('oportunidade', doc.op_id, (o) => { o.status = 'usada'; (o.decisoes ||= []).push({ em: new Date(agora).toISOString(), acao: 'publicada', carrossel_id: carrosselId }); return o; }).catch(() => {});
  return doc;
}

async function registrarMetricas(carrosselId, metricas, { agora = Date.now() } = {}) {
  const m = validarMetricas(metricas);
  const { doc } = await store.atualizar('carrossel', carrosselId, (c) => {
    if (c.estado !== 'publicado') throw U.erro('Marque o carrossel como publicado antes de informar os números.', 'ESTADO', 409);
    c.metricas = { ...(c.metricas || {}), ...m, atualizadas_em: new Date(agora).toISOString() };
    return c;
  });
  return doc;
}

const mediana = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const porMil = (n, alcance) => (Number.isFinite(n) && alcance > 0 ? (n / alcance) * 1000 : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Agrupa por categoria. Só entra quem tem alcance (ou visualizações) informado; sem isso não há como comparar.
function resumir(itens) {
  const grupos = new Map();
  for (const { carrossel, op } of itens) {
    const m = carrossel.metricas || {};
    const base = m.alcance ?? m.visualizacoes;
    if (!Number.isFinite(base) || !op) continue;
    const g = grupos.get(op.categoria) || { categoria: op.categoria, rotulo: C.CATEGORIAS[op.categoria] || op.categoria, posts: [] };
    g.posts.push({ carrossel_id: carrossel.id, nome: op.nome, base, m });
    grupos.set(op.categoria, g);
  }
  const lista = [...grupos.values()].map((g) => {
    const n = g.posts.length;
    const comSeg = g.posts.filter((p) => Number.isFinite(p.m.seguidores_ganhos));
    return {
      categoria: g.categoria, rotulo: g.rotulo, n, amostra: n < MIN_AMOSTRA ? 'pequena' : 'ok',
      alcance_mediana: mediana(g.posts.map((p) => p.base)),
      retencao_mediana_pct: mediana(g.posts.map((p) => p.m.retencao_pct)),
      compartilhamentos_por_mil: r1(mediana(g.posts.map((p) => porMil(p.m.compartilhamentos, p.base)))),
      salvamentos_por_mil: r1(mediana(g.posts.map((p) => porMil(p.m.salvamentos, p.base)))),
      seguidores_ganhos_total: comSeg.length ? comSeg.reduce((s, p) => s + p.m.seguidores_ganhos, 0) : null,
      seguidores_por_mil_alcancados: r1(mediana(comSeg.map((p) => porMil(p.m.seguidores_ganhos, p.base)))),
      posts_com_seguidores: comSeg.length,
    };
  });
  const lider = (campo) => { const v = lista.filter((x) => x[campo] != null).sort((a, b) => b[campo] - a[campo])[0]; return v ? { categoria: v.categoria, rotulo: v.rotulo, valor: v[campo], n: v.n, amostra: v.amostra } : null; };
  return {
    categorias: lista.sort((a, b) => (b.alcance_mediana || 0) - (a.alcance_mediana || 0)),
    lideres: { maior_alcance: lider('alcance_mediana'), maior_retencao: lider('retencao_mediana_pct'), mais_compartilhamentos: lider('compartilhamentos_por_mil'), mais_seguidores: lider('seguidores_por_mil_alcancados') },
    aviso: 'Curtidas não entram em nenhum dos rankings: elas não são seguidores. “Seguidores” só considera posts em que você informou os seguidores ganhos. Com menos de 3 posts por categoria, a amostra é pequena e não prova nada.',
    posts_medidos: lista.reduce((s, x) => s + x.n, 0),
  };
}

async function painel() {
  if (!store.disponivel()) return { categorias: [], lideres: {}, posts_medidos: 0, aviso: 'Sem banco de dados no servidor.' };
  const [carrosseis, ops] = await Promise.all([store.listar('carrossel', 300), store.listar('oportunidade', 800)]);
  const porId = new Map(ops.map((o) => [o.id, o]));
  const itens = carrosseis.filter((c) => c.estado === 'publicado' && c.metricas).map((c) => ({ carrossel: c, op: porId.get(c.op_id) }));
  return resumir(itens);
}

// Pontos de desempate por categoria para a seleção diária (só desempata; nunca altera a pontuação).
async function pesos() {
  try { const p = await painel(); const out = {}; (p.categorias || []).filter((c) => c.amostra === 'ok').forEach((c, i) => { out[c.categoria] = { pontos: (p.categorias.length - i) / p.categorias.length }; }); return out; } catch { return null; }
}

module.exports = { validarMetricas, marcarPublicado, registrarMetricas, resumir, painel, pesos, CAMPOS, MIN_AMOSTRA };
