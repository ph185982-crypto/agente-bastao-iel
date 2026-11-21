// Creative Intelligence: antes de produzir, uma estratégia criativa por pauta. Uma chamada de IA GRATUITA devolve contexto,
// audiência, cinco ângulos, a avaliação dos formatos e pelo menos dez ganchos de tipos diferentes, com notas por critério.
// O código calcula o SCORE CRIATIVO (0–100, pesos do pedido), elimina gancho que viola regra, marca o ângulo de opinião do Pedro
// quando não há opinião dele no banco (a IA não inventa) e monta as 3 melhores opções. O score é comparativo entre as opções
// desta pauta: não é previsão de viralização.
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const TIPO = 'estrategia_criativa';
const ANGULOS = { curiosidade: 'Curiosidade', contradicao: 'Contradição', bolso: 'Bolso', estrategia: 'Estratégia', interpretacao_pedro: 'Interpretação do Pedro' };
const FORMATOS = { reel: 'Reel', carrossel: 'Carrossel', post_unico: 'Post único', stories: 'Stories', linkedin: 'LinkedIn' };
const TIPOS_GANCHO = ['curiosidade', 'contradicao', 'pergunta', 'historia', 'numero', 'confissao', 'problema', 'surpresa', 'oportunidade', 'opiniao'];
const PESOS = { curiosidade: 20, identificacao: 15, compartilhamento: 15, originalidade: 15, clareza: 10, gancho: 10, identidade: 10, conversao: 5 };
const OBJETIVOS = ['descoberta', 'identidade', 'autoridade', 'conversao'];
const conta = () => ACCOUNT.ig_id;
const limpo = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const nota = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null; };
const erro = (m, status = 400) => Object.assign(new Error(m), { status, code: 'CRIATIVO' });
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('A estratégia criativa precisa do banco de dados no servidor.', 503); return a; };

function prompt({ dna, evitar = [] }) {
  const Dna = require('./dnaEditorial');
  return `Você é o estrategista criativo do @pedro_destrava. Antes de qualquer roteiro, você pensa a pauta. NÃO escreva o conteúdo.
${dna ? Dna.blocoParaPrompt(dna, { maxBanco: 6 }) : ''}

ETAPA 1, CONTEXTO: o_que (o que aconteceu), por_que_importa, quem_afetado, tensao, impacto, surpresa. Só fatos da PAUTA; o que a pauta não diz, escreva "não informado".
ETAPA 2, AUDIÊNCIA: principal, secundario, conhecimento (baixo|medio|alto), motivacao, problema, interesse.
ETAPA 3, CINCO ÂNGULOS, um de cada: ${Object.keys(ANGULOS).join(', ')}. Cada um: {"tipo","titulo" (até 8 palavras),"ideia" (1 frase),"usa_opiniao_do_pedro": true se depende de uma opinião dele}. O ângulo interpretacao_pedro SÓ pode usar opinião que está no banco de personalidade acima; se não houver, escreva a ideia como pergunta para o Pedro responder e marque usa_opiniao_do_pedro=true.
ETAPA 4, FORMATOS: avalie ${Object.keys(FORMATOS).join(', ')} de 0 a 10 para ESTA pauta, com o motivo em 1 frase.
ETAPA 5, GANCHOS: pelo menos 10, cada um de um tipo diferente entre ${TIPOS_GANCHO.join(', ')}, ligados a um ângulo. Não são variações de palavras: cada um abre a pauta de um jeito. Até 12 palavras. Número e confissão só com fato da pauta. Proibido: saudação, "você sabia", nome de político ou partido no gancho.
ETAPA 6, NOTAS de 0 a 10 para cada ângulo: curiosidade, identificacao, compartilhamento, originalidade, clareza, gancho, identidade (soa como o Pedro), conversao (aproxima de negócios sem forçar). Seja rigoroso: 8+ só para o excepcional.
Diga também o objetivo de cada ângulo: ${OBJETIVOS.join(' | ')}.
${evitar.length ? `NÃO repita estes ângulos já propostos: ${evitar.join('; ')}.\n` : ''}Responda APENAS JSON:
{"contexto":{"o_que":"","por_que_importa":"","quem_afetado":"","tensao":"","impacto":"","surpresa":""},"audiencia":{"principal":"","secundario":"","conhecimento":"medio","motivacao":"","problema":"","interesse":""},"angulos":[{"tipo":"curiosidade","titulo":"","ideia":"","usa_opiniao_do_pedro":false,"objetivo":"descoberta","notas":{"curiosidade":0,"identificacao":0,"compartilhamento":0,"originalidade":0,"clareza":0,"gancho":0,"identidade":0,"conversao":0}}],"formatos":[{"formato":"reel","nota":0,"motivo":""}],"ganchos":[{"tipo":"pergunta","angulo":"curiosidade","texto":""}]}`;
}

const score = (n) => { let s = 0; let falta = 0; for (const [k, p] of Object.entries(PESOS)) { const v = nota(n?.[k]); if (v == null) falta++; else s += (v / 10) * p; } return falta > 3 ? null : Math.round(s); };

function normalizar(d, { dna = null, regras = null, pauta = '' } = {}) {
  const temOpiniao = (dna?.banco || []).some((b) => b.tipo === 'opiniao' || b.tipo === 'analise');
  const angulos = (Array.isArray(d?.angulos) ? d.angulos : []).filter((a) => ANGULOS[a?.tipo]).slice(0, 5).map((a) => {
    const notas = Object.fromEntries(Object.keys(PESOS).map((k) => [k, nota(a.notas?.[k])]));
    const precisa = a.tipo === 'interpretacao_pedro' && (a.usa_opiniao_do_pedro === true || !temOpiniao);
    return { tipo: a.tipo, rotulo: ANGULOS[a.tipo], titulo: limpo(a.titulo, 90), ideia: limpo(a.ideia, 300), objetivo: OBJETIVOS.includes(a.objetivo) ? a.objetivo : 'descoberta', notas, score: score(notas), precisa_opiniao_do_pedro: precisa };
  }).filter((a) => a.titulo || a.ideia);
  const formatos = (Array.isArray(d?.formatos) ? d.formatos : []).filter((f) => FORMATOS[f?.formato]).map((f) => ({ formato: f.formato, rotulo: FORMATOS[f.formato], nota: nota(f.nota), motivo: limpo(f.motivo, 200) })).sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
  const permitidos = regras ? regras.numerosDe(pauta) : null;
  const eliminados = [];
  const ganchos = (Array.isArray(d?.ganchos) ? d.ganchos : []).map((g) => ({ tipo: TIPOS_GANCHO.includes(g?.tipo) ? g.tipo : null, angulo: ANGULOS[g?.angulo] ? g.angulo : null, texto: limpo(g?.texto, 160) })).filter((g) => g.texto).filter((g) => {
    const fora = (m) => { eliminados.push(`${m}: "${g.texto}"`); return false; };
    if (g.texto.split(/\s+/).length > 14) return fora('mais de 12 palavras');
    if (regras?.abertura.test(g.texto)) return fora('abertura proibida');
    if (regras?.politico.test(g.texto)) return fora('político ou partido');
    if (regras?.vicio(g.texto)) return fora('vício de IA ou expressão proibida');
    const nums = (g.texto.match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/[.,]/g, ''));
    if (permitidos && nums.some((k) => !permitidos.has(k) && !(Number(k) >= 1 && Number(k) <= 10 && k.length <= 2))) return fora('número fora da pauta');
    return true;
  });
  const tiposGancho = new Set(ganchos.map((g) => g.tipo).filter(Boolean));
  // Opções: ângulo × seu melhor gancho × melhor formato; as 3 de maior score.
  const melhorFormato = formatos[0] || null;
  const opcoes = angulos.filter((a) => a.score != null).sort((a, b) => b.score - a.score).slice(0, 3).map((a, i) => ({
    n: i + 1, angulo: a.tipo, titulo: a.titulo, ideia: a.ideia, objetivo: a.objetivo, score: a.score, precisa_opiniao_do_pedro: a.precisa_opiniao_do_pedro,
    gancho: (ganchos.find((g) => g.angulo === a.tipo) || ganchos[i] || null)?.texto || null, formato: melhorFormato?.formato || 'reel',
  }));
  const ctx = d?.contexto || {}; const au = d?.audiencia || {};
  return {
    contexto: Object.fromEntries(['o_que', 'por_que_importa', 'quem_afetado', 'tensao', 'impacto', 'surpresa'].map((k) => [k, limpo(ctx[k], 300)])),
    audiencia: Object.fromEntries(['principal', 'secundario', 'conhecimento', 'motivacao', 'problema', 'interesse'].map((k) => [k, limpo(au[k], 200)])),
    angulos, formatos, ganchos, opcoes, eliminados,
    avisos: [ganchos.length < 10 ? `Só ${ganchos.length} ganchos aproveitáveis (o pedido é 10 ou mais): gere novas opções.` : null, tiposGancho.size < Math.min(8, ganchos.length) ? 'Ganchos com tipos repetidos: pouca variedade.' : null, angulos.some((a) => a.precisa_opiniao_do_pedro) ? 'O ângulo "Interpretação do Pedro" precisa de uma opinião sua: escreva no banco de personalidade (Ajustes → DNA Editorial) ou edite a opção antes de aprovar.' : null].filter(Boolean),
    regras: { score: `Pesos: ${Object.entries(PESOS).map(([k, v]) => `${k} ${v}`).join(', ')}. Comparativo entre as opções desta pauta; não prevê viralização.` },
  };
}

async function gerar({ pauta, origem = null, deps = {} } = {}) {
  const texto = limpo(pauta, 3000); if (texto.length < 20) throw erro('Escreva a pauta com pelo menos 20 caracteres (o fato, a notícia ou a ideia).');
  const Dna = require('./dnaEditorial'); const R = require('./roteiros');
  const dna = await (deps.dna ? deps.dna() : Dna.ler()).catch(() => null);
  const llmJson = require('./llmJson'); const pedir = deps.pedirJson || llmJson.pedirJson;
  const evitar = deps.evitar || [];
  const { dados, llm } = await pedir({ sistema: prompt({ dna, evitar }), usuario: `PAUTA (única fonte de fatos):\n${texto}`, maxTokens: 2600, temperatura: 0.8, pago: 'nunca', etapa: 'estrategia_criativa', preferirMelhor: true });
  const resultado = normalizar(dados, { dna, regras: R.REGRAS_GANCHO ? { ...R.REGRAS_GANCHO, vicio: (t) => R.REGRAS_GANCHO.vicio(t) || !!Dna.regexProibidas(dna)?.test(t) } : null, pauta: texto });
  if (!resultado.angulos.length) throw erro('A IA não devolveu ângulos utilizáveis. Tente de novo.', 502);
  const doc = { id: `ec_${crypto.randomBytes(6).toString('hex')}`, pauta: texto, origem, resultado, estado: 'aberta', ia: llm?.provider || null, criado_em: new Date().toISOString(), historico: [] };
  if (!deps.semGravar) await db().radar.salvar(conta(), TIPO, doc.id, doc);
  return doc;
}

async function listar() { const a = armazem(); if (!a?.duravel) return []; return (await a.radar.listar(conta(), TIPO, { limite: 100 })).map((r) => r.doc).sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em))); }
async function obter(id) { const r = await db().radar.obter(conta(), TIPO, String(id)); if (!r) throw erro('Estratégia não encontrada.', 404); return r.doc; }
async function gravar(doc) { await db().radar.salvar(conta(), TIPO, doc.id, doc); return doc; }

// Aprovar: vira pauta do motor de roteiros com ângulo e gancho já escolhidos (Reel) ou fica registrada para o Criar (outros formatos).
async function acao(id, { acao: ac, opcao = 1, edicao = {}, combinar = [], serie = null, deps = {} } = {}) {
  const e = await obter(id); const hist = [...(e.historico || []), { em: new Date().toISOString(), acao: ac }];
  if (ac === 'descartar') return gravar({ ...e, estado: 'descartada', historico: hist });
  if (ac === 'combinar') {
    const [a1, a2] = combinar.map((t) => e.resultado.angulos.find((x) => x.tipo === t)).filter(Boolean);
    if (!a1 || !a2) throw erro('Escolha dois ângulos para combinar.');
    const nova = { n: e.resultado.opcoes.length + 1, angulo: `${a1.tipo}+${a2.tipo}`, titulo: limpo(`${a1.titulo} + ${a2.titulo}`, 120), ideia: limpo(`${a1.ideia} ${a2.ideia}`, 400), objetivo: a1.objetivo, score: Math.round(((a1.score ?? 0) + (a2.score ?? 0)) / 2), precisa_opiniao_do_pedro: a1.precisa_opiniao_do_pedro || a2.precisa_opiniao_do_pedro, gancho: (e.resultado.ganchos.find((g) => g.angulo === a1.tipo) || {}).texto || null, formato: e.resultado.opcoes[0]?.formato || 'reel', combinada: true };
    return gravar({ ...e, resultado: { ...e.resultado, opcoes: [...e.resultado.opcoes, nova] }, historico: hist });
  }
  if (ac === 'novas') {
    const evitar = e.resultado.angulos.map((a) => a.titulo);
    const n = await gerar({ pauta: e.pauta, origem: { tipo: 'estrategia', id: e.id }, deps: { ...deps, evitar } });
    await gravar({ ...e, estado: 'substituida', substituida_por: n.id, historico: hist });
    return n;
  }
  if (ac === 'aprovar') {
    const op = e.resultado.opcoes.find((o) => o.n === Number(opcao)); if (!op) throw erro('Opção não encontrada.');
    const final = { ...op, titulo: limpo(edicao.titulo ?? op.titulo, 120), ideia: limpo(edicao.ideia ?? op.ideia, 400), gancho: limpo(edicao.gancho ?? op.gancho, 160), formato: FORMATOS[edicao.formato] ? edicao.formato : op.formato, objetivo: OBJETIVOS.includes(edicao.objetivo) ? edicao.objetivo : op.objetivo };
    if (final.precisa_opiniao_do_pedro && !limpo(edicao.opiniao, 400)) throw erro('Este ângulo depende de uma opinião sua: escreva a sua opinião no campo antes de aprovar (a IA não inventa).');
    const Com = require('./comunidade');
    const pauta = await (deps.criarPauta || Com.criarPauta)({ texto: [e.pauta, `ÂNGULO APROVADO PELO PEDRO: ${final.titulo}. ${final.ideia}`, edicao.opiniao ? `OPINIÃO DO PEDRO (palavras dele): ${limpo(edicao.opiniao, 400)}` : ''].filter(Boolean).join('\n'), tema: null, origem: { tipo: 'estrategia_criativa', id: e.id, formato: final.formato, objetivo: final.objetivo, serie: serie || null }, ideia: final.gancho || '' });
    return gravar({ ...e, estado: 'aprovada', escolha: { ...final, serie: serie || null, opiniao: limpo(edicao.opiniao, 400) || null }, pauta_id: pauta.id, historico: hist });
  }
  throw erro('Ação desconhecida.');
}

module.exports = { TIPO, ANGULOS, FORMATOS, TIPOS_GANCHO, PESOS, OBJETIVOS, prompt, normalizar, score, gerar, listar, obter, acao };
