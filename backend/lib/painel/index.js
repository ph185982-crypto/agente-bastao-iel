// Painel de audiência: 30 vozes que representam 1.000 pessoas avaliam a copy ANTES de virar arte.
//
// O que é e o que não é (importante):
//  - É um painel SIMULADO por IA, calibrado com dados REAIS e AGREGADOS da conta (demografia pela Graph API) e com o TEXTO de
//    comentários (sem nome de usuário). Não são 1.000 pessoas reais, nem 1.000 chamadas de IA: são 30 vozes com pesos que somam 1.000.
//  - A Graph API não entrega a lista de quem mais curte, e perfilar seguidores um a um é invasão de privacidade: não fazemos isso.
//  - Dois grupos: "base" (quem segue hoje, pesos da demografia real) e "alvo" (empreendedores, o público que o Pedro quer alcançar,
//    peso configurável). A diferença entre os dois mostra a distância entre a base atual e o público desejado.
//  - A nota é uma OPINIÃO simulada. Só merece confiança depois de comparar com o resultado real dos posts (calibração).
const meta = require('../meta');
const { ACCOUNT } = require('../account');
const { armazem } = require('../armazem');

const PADRAO = Object.freeze({
  ativo: true,
  alvo_peso: 0.3,            // fatia dos 1.000 que representa o público desejado (empreendedores)
  minimo: 4.5,               // nota mínima (0–10) para seguir; abaixo disso, 1 reescrita e depois descarta
  pesos: { capa: 0.4, interesse: 0.3, envio: 0.3 },
  mix_nota: { base: 0.5, alvo: 0.5 },
});
const FAIXAS = ['18-24', '25-34', '35-44', '45+'];
const ALVO = [ // 14 perfis de quem empreende; as partes são hipóteses de composição do público desejado (normalizadas para somar 1)
  { id: 'a_mei_ini', rotulo: 'MEI iniciante (menos de 1 ano de CNPJ)', parte: 0.07 },
  { id: 'a_mei_est', rotulo: 'MEI / autônomo estabelecido', parte: 0.10 },
  { id: 'a_loja', rotulo: 'Dono de loja física / comércio local', parte: 0.08 },
  { id: 'a_pme_com', rotulo: 'Dono de pequena empresa de comércio com funcionários', parte: 0.09 },
  { id: 'a_pme_serv', rotulo: 'Dono de pequena empresa de serviços com funcionários', parte: 0.08 },
  { id: 'a_pme_ind', rotulo: 'Dono de pequena indústria / alimentos', parte: 0.05 },
  { id: 'a_mkt_ml', rotulo: 'Vendedor de Mercado Livre', parte: 0.10 },
  { id: 'a_mkt_sh', rotulo: 'Vendedor de Shopee', parte: 0.09 },
  { id: 'a_mkt_multi', rotulo: 'Vendedor multicanal (Amazon, Magalu, loja própria)', parte: 0.05 },
  { id: 'a_mkt_ini', rotulo: 'Revendedor iniciante / dropshipping', parte: 0.06 },
  { id: 'a_lib_jur', rotulo: 'Advogado / contador autônomo com CNPJ', parte: 0.06 },
  { id: 'a_lib_saude', rotulo: 'Profissional de saúde autônomo com CNPJ', parte: 0.07 },
  { id: 'a_lib_cri', rotulo: 'Freelancer de marketing, design ou tecnologia com CNPJ', parte: 0.06 },
  { id: 'a_info', rotulo: 'Criador de conteúdo / infoprodutor', parte: 0.04 },
];
const conta = () => ACCOUNT.ig_id;
const limita = (n, a, b) => Math.max(a, Math.min(b, n));

async function config() {
  const a = armazem(); const g = a?.duravel ? ((await a.config.obter(conta())).painel_config || {}) : {};
  return { ...PADRAO, ...g, pesos: { ...PADRAO.pesos, ...(g.pesos || {}) }, mix_nota: { ...PADRAO.mix_nota, ...(g.mix_nota || {}) } };
}
async function salvarConfig(patch = {}) {
  const a = armazem(); if (!a?.duravel) throw Object.assign(new Error('O painel precisa do banco de dados no servidor.'), { status: 503 });
  const atual = await config(); const novo = { ...atual };
  if ('ativo' in patch) novo.ativo = !!patch.ativo;
  if ('alvo_peso' in patch) novo.alvo_peso = limita(Number(patch.alvo_peso) || 0, 0, 0.8);
  if ('minimo' in patch) novo.minimo = limita(Number(patch.minimo) || 0, 0, 9);
  await a.config.salvar(conta(), { painel_config: novo });
  return novo;
}

// ── Coleta (só a própria conta, só agregados e texto de comentário) ─────────────────────────────
const limpaComentario = (t) => String(t || '').replace(/@\w+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
async function coletar({ grafo = meta.graph } = {}) {
  const c = meta.config(); const r = { coletado_em: new Date().toISOString(), seguidores: null, demografia: {}, comentarios: [], melhores: [], piores: [], avisos: [] };
  try { r.seguidores = (await grafo('GET', c.igId, { fields: 'followers_count' })).followers_count ?? null; } catch (e) { r.avisos.push(`seguidores: ${String(e.message).slice(0, 100)}`); }
  for (const breakdown of ['age', 'gender', 'city', 'country']) {
    try {
      const d = await grafo('GET', `${c.igId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown, timeframe: 'last_30_days' });
      r.demografia[breakdown] = (d?.data?.[0]?.total_value?.breakdowns?.[0]?.results || []).map((x) => ({ k: (x.dimension_values || []).join('/'), v: Number(x.value) || 0 }));
    } catch (e) { r.avisos.push(`demografia ${breakdown}: ${String(e.message).slice(0, 100)}`); }
  }
  try {
    const m = (await grafo('GET', `${c.igId}/media`, { fields: 'id,caption,like_count,comments_count,timestamp', limit: 40 })).data || [];
    const eng = (x) => (x.like_count || 0) + 4 * (x.comments_count || 0);
    const ord = [...m].sort((a, b) => eng(b) - eng(a));
    const resumo = (x) => ({ legenda: String(x.caption || '').replace(/\s+/g, ' ').slice(0, 90), curtidas: x.like_count ?? null, comentarios: x.comments_count ?? null });
    r.melhores = ord.slice(0, 5).map(resumo); r.piores = ord.slice(-5).map(resumo);
    const vistos = new Set();
    for (const x of [...m].sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0)).slice(0, 8)) {
      if (!x.comments_count) continue;
      try {
        for (const cm of (await grafo('GET', `${x.id}/comments`, { fields: 'text,like_count', limit: 25 })).data || []) {
          const t = limpaComentario(cm.text); if (t.length < 8 || vistos.has(t)) continue; vistos.add(t); r.comentarios.push({ t, c: cm.like_count || 0 });
        }
      } catch { /* post sem permissão de comentário */ }
    }
    r.comentarios = r.comentarios.sort((a, b) => b.c - a.c).slice(0, 40);
  } catch (e) { r.avisos.push(`posts: ${String(e.message).slice(0, 100)}`); }
  return r;
}

// ── Pesos: quotas reais da demografia, arredondadas para somar 1.000 ───────────────────────────
function arredonda(partes, total) { // maior resto
  const brutos = partes.map((p) => p * total); const base = brutos.map(Math.floor); let falta = total - base.reduce((a, b) => a + b, 0);
  brutos.map((b, i) => [b - Math.floor(b), i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (falta > 0) { base[i]++; falta--; } });
  return base;
}
const SUDESTE = /(são paulo|rio de janeiro|minas gerais|espírito santo|espirito santo)/i;
function quotas(retrato, { alvo_peso = PADRAO.alvo_peso, total = 1000 } = {}) {
  const idade = {}; for (const x of retrato?.demografia?.age || []) { if (x.k === '13-17') continue; const f = ['18-24', '25-34', '35-44'].includes(x.k) ? x.k : '45+'; idade[f] = (idade[f] || 0) + x.v; }
  const gen = { M: 0, F: 0 }; for (const x of retrato?.demografia?.gender || []) if (x.k === 'M' || x.k === 'F') gen[x.k] += x.v;
  const somaI = FAIXAS.reduce((s, f) => s + (idade[f] || 0), 0) || 1; const somaG = gen.M + gen.F || 1;
  const pI = FAIXAS.map((f) => (idade[f] || 0) / somaI); const pG = { M: gen.M / somaG, F: gen.F / somaG };
  // Região: só as cidades que a Graph API devolve (as maiores). Assume idade/gênero independentes da região (aproximação, os dados não cruzam).
  let se = 0; let tot = 0; for (const x of retrato?.demografia?.city || []) { tot += x.v; if (SUDESTE.test(x.k)) se += x.v; }
  const pSE = tot ? se / tot : 0.6; const regioes = [{ r: 'SE', rotulo: 'Sudeste (SP, RJ, MG, ES)', p: pSE }, { r: 'RS', rotulo: 'fora do Sudeste (Sul, Nordeste, Norte ou Centro-Oeste)', p: 1 - pSE }];
  const nBase = Math.round(total * (1 - alvo_peso));
  const celulas = []; FAIXAS.forEach((f, i) => ['M', 'F'].forEach((g) => regioes.forEach((rg) => celulas.push({ f, g, rg, p: pI[i] * pG[g] * rg.p }))));
  const pesosBase = arredonda(celulas.map((c) => c.p), nBase);
  const personas = celulas.map((c, i) => ({ id: `b_${c.f}_${c.g}_${c.rg.r}`, grupo: 'base', rotulo: `${c.g === 'M' ? 'Homem' : 'Mulher'} ${c.f} anos, ${c.rg.rotulo}`, faixa: c.f, genero: c.g, regiao: c.rg.r, membros: pesosBase[i] }));
  const soma = ALVO.reduce((s, a) => s + a.parte, 0); const pesosAlvo = arredonda(ALVO.map((a) => a.parte / soma), total - nBase);
  ALVO.forEach((a, i) => personas.push({ id: a.id, grupo: 'alvo', rotulo: a.rotulo, membros: pesosAlvo[i] }));
  return personas.filter((p) => p.membros > 0);
}

// ── Montar as personas (uma chamada de IA; só descreve, os pesos vêm dos dados) ────────────────
const resumoRetrato = (r) => {
  const pct = (arr, n = 6) => { const t = arr.reduce((s, x) => s + x.v, 0) || 1; return arr.sort((a, b) => b.v - a.v).slice(0, n).map((x) => `${x.k} ${Math.round(100 * x.v / t)}%`).join(', '); };
  return [`Seguidores: ${r.seguidores ?? '?'}`, `Idade: ${pct([...(r.demografia.age || [])])}`, `Gênero: ${pct([...(r.demografia.gender || [])], 3)}`,
    `Cidades: ${pct([...(r.demografia.city || [])].map((x) => ({ k: x.k.split(',')[0], v: x.v })), 5)}`,
    `Posts que mais engajaram: ${(r.melhores || []).map((p) => `"${p.legenda}" (${p.curtidas} curtidas)`).join(' | ')}`,
    `Posts que menos engajaram: ${(r.piores || []).map((p) => `"${p.legenda}" (${p.curtidas})`).join(' | ')}`,
    `Comentários reais (amostra): ${(r.comentarios || []).slice(0, 25).map((c) => `"${c.t}"`).join(' ')}`].join('\n');
};
const SISTEMA_PERSONAS = `Você é pesquisador de audiência do perfil @pedro_destrava (política e economia para quem trabalha e empreende; a base cresceu com vídeos virais e hoje o Pedro quer conquistar também quem empreende).
Receba DADOS REAIS e AGREGADOS da conta e uma lista de PERFIS (id, rótulo, tamanho). Para cada perfil, escreva uma persona CURTA e plausível que represente aquele grupo, ancorada nos dados (idade, cidade, comentários, posts que engajam).
Regras: são HIPÓTESES, não fatos; nunca invente estatística; nunca cite pessoa real; sem preconceito de gênero, idade ou região; para os perfis do grupo "base" NÃO suponha que sejam empreendedores (descubra pelo que os comentários e posts sugerem); os do grupo "alvo" são empreendedores e o que importa é o caixa, o imposto, o crédito, o cliente e o tempo deles.
Para cada perfil: "quem" (1 frase), "dor" (o que tira o sono dessa pessoa, 1 frase), "para_no_feed" (o que a faz parar de rolar, 1 frase), "compartilha_quando" (quando ela manda ou posta nos stories, 1 frase), "ignora_quando" (1 frase). Cada campo até 22 palavras.
Responda APENAS JSON: {"personas":[{"id":"","quem":"","dor":"","para_no_feed":"","compartilha_quando":"","ignora_quando":""}]}`;
async function montar({ ia, retrato, cfg } = {}) {
  const c = cfg || await config(); const r = retrato || await coletar();
  const base = quotas(r, { alvo_peso: c.alvo_peso });
  // Lotes de até 10 perfis, em paralelo: respostas menores cabem no prazo da função e nos limites das IAs gratuitas.
  const lotes = []; for (let i = 0; i < base.length; i += 10) lotes.push(base.slice(i, i + 10));
  const respostas = await Promise.all(lotes.map(async (lote) => {
    try { return (await ia({ sistema: SISTEMA_PERSONAS, usuario: `DADOS REAIS DA CONTA:\n${resumoRetrato(r)}\n\nPERFIS:\n${lote.map((p) => `${p.id} | ${p.grupo} | ${p.rotulo} | ${p.membros} de 1000`).join('\n')}`, maxTokens: 3600, temperatura: 0.4, preferirMelhor: true })).dados; } catch { return null; }
  }));
  if (respostas.every((x) => !x)) throw Object.assign(new Error('Nenhuma IA respondeu para descrever os perfis agora. Tente de novo em alguns minutos.'), { status: 503 });
  const porId = new Map(respostas.flatMap((d) => (Array.isArray(d?.personas) ? d.personas : [])).map((x) => [String(x.id), x]));
  const campo = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 170);
  const personas = base.map((p) => { const x = porId.get(p.id) || {}; return { ...p, quem: campo(x.quem) || p.rotulo, dor: campo(x.dor), para_no_feed: campo(x.para_no_feed), compartilha_quando: campo(x.compartilha_quando), ignora_quando: campo(x.ignora_quando) }; });
  const doc = { criado_em: new Date().toISOString(), total: personas.reduce((s, p) => s + p.membros, 0), alvo_peso: c.alvo_peso, descritas: [...porId.keys()].length, retrato: { seguidores: r.seguidores, coletado_em: r.coletado_em, comentarios: (r.comentarios || []).length, avisos: r.avisos }, personas };
  const a = armazem(); if (a?.duravel) await a.config.salvar(conta(), { painel_personas: doc });
  return doc;
}
async function personasAtuais() { const a = armazem(); return a?.duravel ? ((await a.config.obter(conta())).painel_personas || null) : null; }

// ── Avaliação ─────────────────────────────────────────────────────────────────────────────────
const SISTEMA_AVALIA = `Você simula um painel de vozes que representam 1.000 seguidores e possíveis seguidores do @pedro_destrava vendo um CARROSSEL no feed do Instagram.
Cada VOZ tem um perfil e um peso. Responda COMO CADA PESSOA reagiria de verdade, não como deveria reagir. Seja cético e realista: a maior parte dos posts passa batido; notas altas são raras.
Escala de 0 a 10: 0 = ignora; 3 = olha e rola; 5 = para um segundo; 7 = lê o carrossel inteiro; 9 = lê, salva e MANDA para alguém ou posta nos stories; 10 só quando mexe de verdade com a vida dela.
Para cada voz dê: "capa" (nota da CAPA de cada opção, na ordem dada), "interesse" (o carrossel inteiro), "envio" (chance de MANDAR para alguém ou postar nos stories) e "objecao" (a principal razão de NÃO engajar ou de achar fraco, até 14 palavras, na voz da pessoa; vazio se não tiver).
Responda APENAS JSON: {"vozes":[{"id":"","capa":[0],"interesse":0,"envio":0,"objecao":""}]}`;
async function avaliar({ capas = [], slides = [], legenda = '', tese = '' } = {}, { ia, personas } = {}) {
  const doc = personas || await personasAtuais(); const cfg = await config();
  if (!doc?.personas?.length) return { ok: false, motivo: 'Painel ainda não montado.' };
  const letras = capas.map((_, i) => String.fromCharCode(65 + i));
  const usuario = `VOZES (id | grupo | perfil | peso de 1000 | dor | o que a faz parar | quando manda | quando ignora):\n${doc.personas.map((p) => `${p.id} | ${p.grupo} | ${p.quem} | ${p.membros} | ${p.dor || '-'} | ${p.para_no_feed || '-'} | ${p.compartilha_quando || '-'} | ${p.ignora_quando || '-'}`).join('\n')}\n\nCAPAS (1º slide, em ordem):\n${capas.map((t, i) => `${letras[i]}: ${t}`).join('\n')}\n\nCARROSSEL (slides em sequência):\n${slides.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nLEGENDA: ${String(legenda).slice(0, 400)}\nTESE: ${tese}`;
  let dados; try { ({ dados } = await ia({ sistema: SISTEMA_AVALIA, usuario, maxTokens: 4200, temperatura: 0.35, preferirMelhor: true })); } catch (e) { return { ok: false, motivo: `IA indisponível: ${String(e.message).slice(0, 100)}` }; }
  const num = (v) => limita(Number(v) || 0, 0, 10);
  const vozes = []; for (const p of doc.personas) { const x = (Array.isArray(dados?.vozes) ? dados.vozes : []).find((v) => String(v.id) === p.id); if (!x) continue; vozes.push({ p, capa: capas.map((_, i) => num(Array.isArray(x.capa) ? x.capa[i] : x.capa)), interesse: num(x.interesse), envio: num(x.envio), objecao: String(x.objecao || '').replace(/\s+/g, ' ').trim().slice(0, 110) }); }
  const cobertura = vozes.reduce((s, v) => s + v.p.membros, 0);
  if (cobertura < 0.6 * doc.total) return { ok: false, motivo: `A IA respondeu por poucas vozes (${Math.round(100 * cobertura / doc.total)}% do painel).` };
  const media = (fn, lista = vozes) => { const t = lista.reduce((s, v) => s + v.p.membros, 0) || 1; return lista.reduce((s, v) => s + fn(v) * v.p.membros, 0) / t; };
  const grupo = (g) => vozes.filter((v) => v.p.grupo === g);
  const notaDe = (lista) => (lista.length ? cfg.pesos.capa * Math.max(...capas.map((_, i) => media((v) => v.capa[i], lista))) + cfg.pesos.interesse * media((v) => v.interesse, lista) + cfg.pesos.envio * media((v) => v.envio, lista) : null);
  const nBase = notaDe(grupo('base')); const nAlvo = notaDe(grupo('alvo'));
  const mix = cfg.mix_nota; const partes = [[nBase, mix.base], [nAlvo, mix.alvo]].filter(([n]) => n != null);
  const nota = partes.reduce((s, [n, w]) => s + n * w, 0) / (partes.reduce((s, [, w]) => s + w, 0) || 1);
  const capaNotas = capas.map((_, i) => Math.round(media((v) => v.capa[i]) * 10) / 10);
  const melhor = capaNotas.indexOf(Math.max(...capaNotas));
  const objecoes = [...vozes].filter((v) => v.objecao).sort((a, b) => b.p.membros * (10 - b.interesse) - a.p.membros * (10 - a.interesse)).slice(0, 3).map((v) => ({ grupo: v.p.grupo, quem: v.p.rotulo, texto: v.objecao, membros: v.p.membros }));
  const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
  return { ok: true, membros: doc.total, vozes: vozes.length, cobertura: Math.round(100 * cobertura / doc.total), nota: r1(nota), nota_base: r1(nBase), nota_alvo: r1(nAlvo), capas: capaNotas, melhor_capa: melhor, interesse: r1(media((v) => v.interesse)), envio: r1(media((v) => v.envio)), objecoes, em: new Date().toISOString() };
}

// ── Calibração: a nota do painel prevê o resultado real? ──────────────────────────────────────
const ranks = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
function spearman(a, b) { if (a.length < 3) return null; const ra = ranks(a); const rb = ranks(b); const n = a.length; const ma = ra.reduce((s, x) => s + x, 0) / n; const mb = rb.reduce((s, x) => s + x, 0) / n; let num = 0; let da = 0; let db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return da && db ? num / Math.sqrt(da * db) : null; }
async function calibrar({ grafo = meta.graph } = {}) {
  const a = armazem(); if (!a?.duravel) return { n: 0, motivo: 'Sem banco de dados.' };
  const lista = await a.conteudos.listar(conta()); const pares = [];
  for (const x of lista.slice(0, 120)) {
    if (x.resumo?.status !== 'publicado') continue;
    const c = (await a.conteudos.obter(conta(), x.id))?.doc; const nota = c?.top?.painel?.nota; const id = c?.publicacao?.ig_post_id;
    if (nota == null || !id) continue;
    try { const m = await grafo('GET', id, { fields: 'like_count,comments_count,timestamp' }); if (Date.now() - Date.parse(m.timestamp) < 24 * 3600000) continue; pares.push({ id: x.id, titulo: c.titulo, nota, curtidas: m.like_count || 0, comentarios: m.comments_count || 0 }); } catch { /* post removido */ }
  }
  const eng = pares.map((p) => p.curtidas + 4 * p.comentarios); const r = spearman(pares.map((p) => p.nota), eng);
  return { n: pares.length, correlacao: r == null ? null : Math.round(r * 100) / 100, confiavel: pares.length >= 10 && r != null && r >= 0.3, pares: pares.slice(0, 30), leitura: pares.length < 10 ? `Ainda poucos posts com nota do painel (${pares.length}); preciso de pelo menos 10 para dizer se o painel acerta.` : r >= 0.3 ? 'O painel está acertando a ordem dos posts melhor do que o acaso.' : 'O painel ainda não prevê bem o resultado real: trate a nota como opinião, não como previsão.' };
}

module.exports = { PADRAO, config, salvarConfig, coletar, quotas, montar, personasAtuais, avaliar, calibrar, spearman, resumoRetrato };
