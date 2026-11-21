// Laboratório de Crescimento: experimentos com UMA variável principal, grupos A e B formados por posts REAIS que o Pedro marca,
// indicador principal e secundários, amostra mínima e registro de decisões. O veredito nunca diz "vencedor": com amostra abaixo
// do mínimo é "amostra insuficiente"; com diferença menor que 20% é "inconclusivo"; acima disso é "indício" (com o número).
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const C = require('./crescimento');
const MI = require('./meuInstagram');

const TIPO = 'experimento';
const VARIAVEIS = { rosto_inicio: 'Rosto nos primeiros segundos', gancho: 'Gancho', capa: 'Capa', duracao: 'Duração', formato: 'Formato', cta: 'CTA', tema: 'Tema', narrativa: 'Narrativa', imagens_reais: 'Imagens reais', graficos: 'Gráficos', texto_tela: 'Texto na tela', velocidade: 'Velocidade de edição', outra: 'Outra' };
const INDICADORES = {
  seguidores_mil: 'Seguidores ganhos por mil alcançados', envios_mil: 'Compartilhamentos por mil alcançados', salvos_mil: 'Salvamentos por mil alcançados',
  curtidas_mil: 'Curtidas por mil alcançados', visitas_mil: 'Visitas ao perfil por mil alcançados', alcance: 'Alcance', tempo_medio_s: 'Tempo médio assistido (s)', retencao_pct: 'Retenção (%)',
};
const STATUS = ['planejado', 'rodando', 'concluido', 'cancelado'];
const RAZAO_INDICIO = 1.2;
const conta = () => ACCOUNT.ig_id;
const limpo = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const erro = (m, status = 400) => Object.assign(new Error(m), { status, code: 'LAB' });
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('O laboratório precisa do banco de dados no servidor.', 503); return a; };
const arred = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).replace(/[^\w]/g, '').slice(0, 40)).filter(Boolean))].slice(0, 60);

function validar(e, parcial = false) {
  const o = {};
  if (!parcial || 'nome' in e) { o.nome = limpo(e.nome, 80); if (o.nome.length < 3) throw erro('Dê um nome ao experimento.'); }
  if (!parcial || 'hipotese' in e) { o.hipotese = limpo(e.hipotese, 300); if (o.hipotese.length < 10) throw erro('Escreva a hipótese (o que você espera e por quê).'); }
  if (!parcial || 'variavel' in e) { if (!VARIAVEIS[e.variavel]) throw erro('Escolha a variável que muda entre os grupos.'); o.variavel = e.variavel; }
  if (!parcial || 'indicador' in e) { if (!INDICADORES[e.indicador]) throw erro('Escolha o indicador principal.'); o.indicador = e.indicador; }
  if ('secundarios' in e) o.secundarios = (Array.isArray(e.secundarios) ? e.secundarios : []).filter((x) => INDICADORES[x] && x !== (o.indicador || e.indicador)).slice(0, 4);
  for (const g of ['grupo_a', 'grupo_b']) if (!parcial || g in e) o[g] = { descricao: limpo(e[g]?.descricao, 160), posts: ids(e[g]?.posts) };
  if (!parcial || 'amostra_minima' in e) { const n = Number(e.amostra_minima ?? 5); if (!Number.isInteger(n) || n < 3 || n > 30) throw erro('Amostra mínima: de 3 a 30 posts por grupo.'); o.amostra_minima = n; }
  if ('periodo' in e) o.periodo = { de: limpo(e.periodo?.de, 10) || null, ate: limpo(e.periodo?.ate, 10) || null };
  if ('status' in e) { if (!STATUS.includes(e.status)) throw erro('Status inválido.'); o.status = e.status; }
  if ('conclusao' in e) o.conclusao = limpo(e.conclusao, 400);
  if ('proxima_acao' in e) o.proxima_acao = limpo(e.proxima_acao, 300);
  if (o.grupo_a && o.grupo_b && o.grupo_a.posts.some((p) => o.grupo_b.posts.includes(p))) throw erro('Um post não pode estar nos dois grupos.');
  return o;
}

const valor = (p, ind) => {
  if (ind === 'alcance') return p.alcance ?? null;
  if (ind === 'tempo_medio_s') return p.tempo_medio_s ?? null;
  if (ind === 'retencao_pct') return p.assistido_pct ?? null;
  const m = C.medidas(p); return m[ind] ?? null;
};
function grupo(posts, lista, ind) {
  const ps = posts.filter((p) => lista.includes(String(p.id)) && p.maduro);
  const vs = ps.map((p) => valor(p, ind)).filter((v) => v != null && Number.isFinite(v));
  return { n: vs.length, marcados: lista.length, mediana: arred(MI.mediana(vs)), formatos: [...new Set(ps.map((p) => p.tipo))] };
}
// Pura: o resultado de um experimento com os posts lidos da Meta.
function avaliar(exp, posts) {
  const A = grupo(posts, exp.grupo_a?.posts || [], exp.indicador); const B = grupo(posts, exp.grupo_b?.posts || [], exp.indicador);
  const sec = (exp.secundarios || []).map((k) => ({ indicador: k, rotulo: INDICADORES[k], a: grupo(posts, exp.grupo_a.posts, k).mediana, b: grupo(posts, exp.grupo_b.posts, k).mediana }));
  const min = exp.amostra_minima || 5; const nome = INDICADORES[exp.indicador];
  const avisos = [];
  if (A.formatos.length && B.formatos.length && A.formatos.join() !== B.formatos.join() && exp.variavel !== 'formato') avisos.push('Os grupos misturam formatos diferentes: a comparação mistura duas variáveis.');
  let veredito; let texto;
  if (A.n < min || B.n < min) { veredito = 'amostra_insuficiente'; texto = `Amostra insuficiente: ${A.n} posts medidos no grupo A e ${B.n} no grupo B (mínimo ${min} em cada). Nenhuma conclusão ainda.`; }
  else if (!A.mediana || !B.mediana) { veredito = 'inconclusivo'; texto = `Sem ${nome.toLowerCase()} medido em um dos grupos.`; }
  else {
    const r = Math.max(A.mediana, B.mediana) / Math.min(A.mediana, B.mediana);
    const desc = `Nos ${A.n} posts do grupo A (${exp.grupo_a.descricao || 'A'}), a mediana de ${nome.toLowerCase()} foi ${A.mediana}. Nos ${B.n} posts comparáveis do grupo B (${exp.grupo_b.descricao || 'B'}), foi ${B.mediana}.`;
    if (r < RAZAO_INDICIO) { veredito = 'inconclusivo'; texto = `${desc} Diferença menor que 20%: inconclusivo.`; }
    else { veredito = A.mediana > B.mediana ? 'indicio_a' : 'indicio_b'; texto = `${desc} Indício a favor do grupo ${A.mediana > B.mediana ? 'A' : 'B'} (${arred(r, 2)}×). É um indício: confirme com mais posts antes de mudar a estratégia.`; }
  }
  return { a: A, b: B, secundarios: sec, veredito, texto, avisos };
}

async function listar() { const a = armazem(); if (!a?.duravel) return []; return (await a.radar.listar(conta(), TIPO, { limite: 100 })).map((r) => r.doc).sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em))); }
async function obter(id) { const r = await db().radar.obter(conta(), TIPO, String(id)); if (!r) throw erro('Experimento não encontrado.', 404); return r.doc; }
async function criar(e) { const doc = { id: `ex_${crypto.randomBytes(6).toString('hex')}`, status: 'planejado', secundarios: [], decisoes: [], ...validar(e), criado_em: new Date().toISOString() }; await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc; }
async function editar(id, e) {
  const atual = await obter(id); const v = validar({ ...e, grupo_a: e.grupo_a ?? atual.grupo_a, grupo_b: e.grupo_b ?? atual.grupo_b }, true);
  const doc = { ...atual, ...v, editado_em: new Date().toISOString() }; await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc;
}
async function registrarDecisao(id, texto) {
  const t = limpo(texto, 300); if (t.length < 5) throw erro('Escreva a decisão.');
  const atual = await obter(id); const doc = { ...atual, decisoes: [...(atual.decisoes || []), { em: new Date().toISOString(), texto: t }].slice(-30) };
  await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc;
}
async function apagar(id) { await obter(id); await db().radar.apagar(conta(), TIPO, String(id)); return { id, apagado: true }; }

module.exports = { TIPO, VARIAVEIS, INDICADORES, STATUS, validar, avaliar, listar, obter, criar, editar, registrarDecisao, apagar };
