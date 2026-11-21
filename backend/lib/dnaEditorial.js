// DNA Editorial do @pedro_destrava: o posicionamento, a promessa, a personalidade, as regras de linguagem, os pilares em teste, as
// séries e o banco de personalidade. Editável (Ajustes → DNA Editorial), guardado no servidor e lido por quem gera conteúdo
// (hoje o motor de roteiros de Reel). Os percentuais dos pilares são HIPÓTESES de transição, não metas: o painel de crescimento
// mostra o que os dados reais dizem sobre cada um.
//
// Pessoa e fatos: o banco de personalidade só guarda o que o Pedro escreve. A IA nunca inventa opinião nem experiência dele.
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const POSICIONAMENTO = 'Pedro Destrava é o cara que mostra a estratégia escondida por trás das coisas: política, economia, empresas, tecnologia, consumo e empreendedorismo.';
const PROMESSA = 'Eu mostro quem ganha, quem paga e qual é o jogo por trás das coisas que mexem no seu bolso e nos negócios.';
const PERSONALIDADE = ['Direto', 'Curioso', 'Questionador', 'Inteligente', 'Humano', 'Informal', 'Opinativo', 'Simples', 'Não acadêmico', 'Não artificial'];
const REGRAS_LINGUAGEM = [
  'Evite linguagem corporativa e frases genéricas de IA.',
  'Sem introdução longa: o assunto e a promessa estão na primeira frase.',
  'Evite excesso de adjetivos e de emojis. Nem todo conteúdo vira lista.',
  'Título que não cumpre a promessa é proibido (nada de clickbait vazio).',
  'Nunca invente opinião do Pedro nem experiência pessoal: só use o que está no banco de personalidade ou na pauta.',
];
// Expressões que o texto não pode ter (o fiscal do código confere, ver roteiros/index.js).
const EXPRESSOES_PROIBIDAS = ['você sabia', 'nos dias de hoje', 'em um mundo cada vez mais', 'isso nos mostra que'];
// Percentuais de TESTE na transição. O sistema não os trata como verdade: compara com o resultado medido.
const PILARES = [
  { id: 'curiosidade_cotidiano', nome: 'Curiosidades e estratégias escondidas no cotidiano', pct: 45 },
  { id: 'dinheiro_consumo', nome: 'Dinheiro, economia e comportamento de consumo', pct: 25 },
  { id: 'marketplace_empreender', nome: 'Marketplace e empreendedorismo', pct: 15 },
  { id: 'historias_pedro', nome: 'Histórias e experiências do Pedro', pct: 10 },
  { id: 'opiniao_fiscalizacao', nome: 'Opinião e fiscalização', pct: 5 },
];
const SERIES = [
  { id: 'por_tras_do_preco', nome: 'Por trás do preço', objetivo: 'Mostrar como empresas, lojas, aplicativos e negócios ganham dinheiro.', publico: 'Geral, curioso por dinheiro', formatos: ['reel', 'carrossel'] },
  { id: 'do_outro_lado_do_balcao', nome: 'Do outro lado do balcão', objetivo: 'O que empresários percebem e consumidores não.', publico: 'Consumidor e dono de negócio', formatos: ['reel', 'carrossel'] },
  { id: 'a_conta_que_ninguem_faz', nome: 'A conta que ninguém faz', objetivo: 'Custos, taxas, impostos, margens e decisões financeiras.', publico: 'Dono de pequeno negócio e quem vende online', formatos: ['reel', 'carrossel'] },
  { id: 'pedro_explica', nome: 'Pedro explica', objetivo: 'Uma interpretação pessoal do Pedro sobre um fato.', publico: 'Quem já acompanha', formatos: ['reel'] },
  { id: 'conta_aberta', nome: 'Conta aberta', objetivo: 'Bastidores e provas de experiências reais, com autorização.', publico: 'Quem considera contratar', formatos: ['reel', 'carrossel', 'stories'] },
];
const TIPOS_BANCO = { experiencia: 'Experiência', opiniao: 'Opinião', aprendizado: 'Aprendizado', erro: 'Erro', conquista: 'Conquista', frase: 'Frase', video: 'Vídeo', audio: 'Áudio', analise: 'Análise' };
const MAX_BANCO = 200; const MAX_TEXTO = 1200;

const PADRAO = {
  posicionamento: POSICIONAMENTO, promessa: PROMESSA, personalidade: PERSONALIDADE, regras_linguagem: REGRAS_LINGUAGEM,
  expressoes_proibidas: EXPRESSOES_PROIBIDAS, pilares: PILARES, series: SERIES,
  transicao: { inicio_b: null, inicio_c: null },   // datas escolhidas pelo Pedro; o sistema não as inventa
  banco: [],
};

const erro = (m) => Object.assign(new Error(m), { status: 400, code: 'DNA' });
const limpo = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, n);
const lista = (v, max, n) => (Array.isArray(v) ? v : []).map((x) => limpo(x, n)).filter(Boolean).slice(0, max);
const dataIso = (v, rotulo) => { if (v == null || v === '') return null; const t = Date.parse(String(v)); if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw erro(`${rotulo}: use a data no formato AAAA-MM-DD.`); return String(v).slice(0, 10); };

function validar(e) {
  const out = {};
  if ('posicionamento' in e) { out.posicionamento = limpo(e.posicionamento, 400); if (out.posicionamento.length < 20) throw erro('O posicionamento precisa de pelo menos 20 caracteres.'); }
  if ('promessa' in e) { out.promessa = limpo(e.promessa, 300); if (out.promessa.length < 20) throw erro('A promessa precisa de pelo menos 20 caracteres.'); }
  if ('personalidade' in e) out.personalidade = lista(e.personalidade, 14, 30);
  if ('regras_linguagem' in e) out.regras_linguagem = lista(e.regras_linguagem, 20, 200);
  if ('expressoes_proibidas' in e) out.expressoes_proibidas = lista(e.expressoes_proibidas, 40, 60).map((x) => x.toLowerCase());
  if ('pilares' in e) {
    const p = (Array.isArray(e.pilares) ? e.pilares : []).slice(0, 8).map((x) => ({ id: limpo(x?.id, 40).toLowerCase().replace(/[^a-z0-9_]/g, ''), nome: limpo(x?.nome, 100), pct: Number(x?.pct) }));
    if (!p.length || p.some((x) => !x.id || !x.nome || !Number.isFinite(x.pct) || x.pct < 0 || x.pct > 100)) throw erro('Cada pilar precisa de nome e de um percentual entre 0 e 100.');
    if (Math.abs(p.reduce((s, x) => s + x.pct, 0) - 100) > 0.5) throw erro('Os percentuais dos pilares precisam somar 100.');
    out.pilares = p;
  }
  if ('series' in e) {
    const s = (Array.isArray(e.series) ? e.series : []).slice(0, 10).map((x) => ({ id: limpo(x?.id, 40).toLowerCase().replace(/[^a-z0-9_]/g, ''), nome: limpo(x?.nome, 60), objetivo: limpo(x?.objetivo, 200), publico: limpo(x?.publico, 100), formatos: lista(x?.formatos, 5, 20) }));
    if (s.some((x) => !x.id || !x.nome)) throw erro('Cada série precisa de id e nome.');
    out.series = s;
  }
  if ('transicao' in e) {
    const t = e.transicao || {}; const b = dataIso(t.inicio_b, 'Início da transição'); const c = dataIso(t.inicio_c, 'Início do posicionamento atual');
    if (b && c && c <= b) throw erro('O posicionamento atual precisa começar depois do início da transição.');
    out.transicao = { inicio_b: b, inicio_c: c };
  }
  return out;
}

async function ler() {
  const a = armazem();
  const g = a?.duravel ? ((await a.config.obter(ACCOUNT.ig_id)).dna_editorial || {}) : {};
  return { ...PADRAO, ...g, transicao: { ...PADRAO.transicao, ...(g.transicao || {}) }, banco: Array.isArray(g.banco) ? g.banco : [], guardada: !!a?.duravel };
}
async function gravar(doc) {
  const a = armazem(); const { guardada, ...limpa } = doc;
  if (a?.duravel) await a.config.salvar(ACCOUNT.ig_id, { dna_editorial: limpa });
  return { ...limpa, guardada: !!a?.duravel };
}
async function salvar(patch) { return gravar({ ...(await ler()), ...validar(patch || {}) }); }

async function adicionarAoBanco({ tipo, texto, fonte = '' }, { agora = Date.now() } = {}) {
  if (!TIPOS_BANCO[tipo]) throw erro(`Escolha o tipo: ${Object.values(TIPOS_BANCO).join(', ')}.`);
  const t = limpo(texto, MAX_TEXTO); if (t.length < 20) throw erro('Escreva pelo menos 20 caracteres: a IA só usa o que você escrever.');
  const atual = await ler();
  if (atual.banco.length >= MAX_BANCO) throw erro(`O banco de personalidade tem o limite de ${MAX_BANCO} itens. Apague os antigos.`);
  const item = { id: `dn_${crypto.randomBytes(6).toString('hex')}`, tipo, texto: t, fonte: limpo(fonte, 120), criado_em: new Date(agora).toISOString() };
  return { item, ...(await gravar({ ...atual, banco: [item, ...atual.banco] })) };
}
async function apagarDoBanco(id) {
  const atual = await ler(); if (!atual.banco.some((x) => x.id === id)) throw Object.assign(erro('Item não encontrado.'), { status: 404 });
  return gravar({ ...atual, banco: atual.banco.filter((x) => x.id !== id) });
}

// Texto que entra nos prompts de geração. O banco entra como REFERÊNCIA do que o Pedro realmente disse/viveu.
function blocoParaPrompt(dna, { maxBanco = 6 } = {}) {
  const d = dna || PADRAO;
  const banco = (d.banco || []).slice(0, maxBanco);
  return `DNA EDITORIAL DO PEDRO (siga):
POSICIONAMENTO: ${d.posicionamento}
PROMESSA: ${d.promessa}
PERSONALIDADE: ${(d.personalidade || []).join(', ')}.
LINGUAGEM: ${(d.regras_linguagem || []).join(' ')} Nunca escreva: ${(d.expressoes_proibidas || []).map((x) => `"${x}"`).join(', ')}.
PILARES (hipótese de transição; o dado real decide): ${(d.pilares || []).map((p) => `${p.nome} ${p.pct}%`).join('; ')}.
ESTRATÉGIA: a curiosidade é a porta de entrada; a conversa vai de curiosidade → identificação → dinheiro → estratégia → negócios. O público antigo é generalista: explique simples, sem pressupor que seja empresário.
${banco.length ? `REFERÊNCIA DO QUE O PEDRO REALMENTE DISSE OU VIVEU (use só como inspiração de voz e só se combinar com a pauta; não invente além disso):\n${banco.map((b) => `- ${TIPOS_BANCO[b.tipo] || b.tipo}: ${b.texto.slice(0, 220)}`).join('\n')}` : 'BANCO DE PERSONALIDADE: vazio. Não invente opinião nem experiência pessoal do Pedro; use só fatos da pauta.'}`;
}

// Quem confere o texto: as expressões do DNA (as do padrão e as que o Pedro acrescentar).
const regexProibidas = (dna) => {
  const xs = (dna?.expressoes_proibidas || EXPRESSOES_PROIBIDAS).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return xs.length ? new RegExp(`(^|[^\\p{L}])(${xs.join('|')})(?![\\p{L}])`, 'iu') : null;
};

module.exports = { PADRAO, TIPOS_BANCO, MAX_BANCO, validar, ler, salvar, adicionarAoBanco, apagarDoBanco, blocoParaPrompt, regexProibidas };
