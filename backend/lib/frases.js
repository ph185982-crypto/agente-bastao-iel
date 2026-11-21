// Frases (posts de 1 imagem para curtir e repostar nos stories). Versão 2 (pedido do Pedro, 21/11): frases motivacionais
// FAMOSAS, copiadas como são, com o autor. Fonte: banco data/citacoes.json, montado da seção "Verificadas" do pt.wikiquote
// (citação com fonte conferida; frase "atribuída" fica de fora porque costuma ser de outra pessoa).
// 1) sorteia candidatas ainda não usadas; 2) a IA escolhe as que o público do Pedro mais repostaria e marca a palavra-chave
//    (o texto não muda: o código confere letra por letra); 3) cada escolhida vira um post (formatosCarrossel.criarFrase),
//    alternando fundo preto e branco. Histórico em config.frases_historico (texto das já usadas, últimas 1000).
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const conta = () => ACCOUNT.ig_id;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
// Tema fora do perfil (religião, política, guerra, amor romântico, morte): o post é de trabalho, dinheiro e disciplina.
const FORA = /\b(deus|jesus|igreja|reza|ora[çc][aã]o|pecado|guerra|soldad|ex[eé]rcito|pol[ií]tic|partido|elei[çc]|naz|morte|morrer|amor|amante|beijo|casamento|mulher(es)? s[aã]o|homens s[aã]o)\b/i;

// Marca a palavra-chave no texto original sem mudar nada (só insere **…**). Devolve null se o trecho não existe.
function marcar(texto, destaque) {
  const d = String(destaque || '').trim(); if (!d || d.length > 40 || d.split(/\s+/).length > 3) return null;
  const i = texto.toLowerCase().indexOf(d.toLowerCase()); if (i < 0) return null;
  const antes = texto[i - 1]; const depois = texto[i + d.length];
  if ((antes && /\p{L}/u.test(antes)) || (depois && /\p{L}/u.test(depois))) return null; // pedaço de palavra
  // pontuação colada vai junto (senão o ponto cai sozinho na linha de baixo)
  const fim = i + d.length + ((/^[.,;:!?…]+/.exec(texto.slice(i + d.length)) || [''])[0].length);
  return `${texto.slice(0, i)}**${texto.slice(i, fim)}**${texto.slice(fim)}`;
}
// Sem IA: destaca a palavra mais longa (substantivo ou verbo forte, quase sempre).
function destaquePadrao(texto) {
  const ps = (texto.match(/\p{L}{6,}/gu) || []).sort((a, b) => b.length - a.length);
  return ps[0] || null;
}

const SISTEMA = `Você escolhe frases famosas para o perfil @pedro_destrava (público geral brasileiro que trabalha, quer ganhar dinheiro, vender e ter disciplina). Cada frase vira um post de 1 imagem que a pessoa curte e reposta nos stories.
Para cada frase da lista dê:
- "nota" de 0 a 10: quanto alguém comum que trabalha repostaria (curta, forte, sobre esforço, coragem, dinheiro, trabalho, começar, persistir, foco, tempo). Frase confusa, datada, de contexto histórico, sobre religião, política, guerra ou amor: nota baixa.
- "destaque": a palavra (ou até 3 palavras seguidas) que carrega a ideia, copiada EXATAMENTE como está na frase.
Responda só JSON: {"itens":[{"i":0,"nota":0,"destaque":""}]}`;

async function autoresRecentes(a) { return a?.duravel ? ((await a.config.obter(conta())).frases_autores || []).slice(-15) : []; }
async function historico(a) { return a?.duravel ? ((await a.config.obter(conta())).frases_historico || []) : []; }

async function produzir(n, { deps = {}, agora = Date.now() } = {}) {
  const a = deps.armazem || armazem();
  const hist = await historico(a); const usadas = new Set(hist.map(norm));
  const sortear = deps.sortear || Math.random;
  // o banco cresce aos poucos: com poucas frases livres, lê mais autores do Wikiquote nesta rodada
  let todas = deps.banco || await require('./citacoes').todas();
  const livres = () => todas.filter((q) => !usadas.has(norm(q.texto))).length;
  // banco cresce até ter folga (21/11: 85 livres, quase todas literárias)
  if (!deps.banco && livres() < 200 && (process.env.VERCEL || process.env.K_SERVICE)) { try { await require('./citacoes').crescer({ max: 6 }); todas = await require('./citacoes').todas(); } catch { /* segue com o que tem */ } }
  const lista = todas.filter((q) => !usadas.has(norm(q.texto)) && !FORA.test(q.texto) && q.texto.length <= 150);
  const cands = [...lista].sort(() => sortear() - 0.5).slice(0, 40);
  const barradas = []; let escolhidas = [];
  if (!cands.length) return { criados: [], barradas: [{ motivo: 'banco de frases esgotado' }], modelo: null };
  try {
    const pedir = deps.ia || ((args) => require('./llmJson').pedirJson(args));
    const r = await pedir({ sistema: SISTEMA, usuario: cands.map((q, i) => `${i}. ${q.texto} (${q.autor})`).join('\n'), maxTokens: 1800, temperatura: 0.2, etapa: 'frases' });
    escolhidas = (r?.dados?.itens || []).filter((it) => cands[it.i] && Number(it.nota) >= 7).sort((x, y) => y.nota - x.nota)
      .map((it) => ({ ...cands[it.i], marcado: marcar(cands[it.i].texto, it.destaque) || marcar(cands[it.i].texto, destaquePadrao(cands[it.i].texto)) }));
  } catch (e) {
    barradas.push({ motivo: `IA indisponível (${String(e.message).slice(0, 60)}): escolha por sorteio` });
    escolhidas = cands.map((q) => ({ ...q, marcado: marcar(q.texto, destaquePadrao(q.texto)) }));
  }
  const criados = [];
  const criar = deps.criarFrase || require('./formatosCarrossel').criarFrase;
  let fundo = hist.length % 2 ? 'branco' : 'preto';
  // Variedade (21/11: vieram 5 do Walt Disney no mesmo dia): um autor por lote e nenhum autor usado nas últimas 15 frases.
  const recentes = new Set((deps.autoresRecentes || (await autoresRecentes(a))).map((x) => x.toLowerCase()));
  const vistos = new Set();
  escolhidas = escolhidas.filter((q) => { const k = String(q.autor || '').toLowerCase(); if (recentes.has(k) || vistos.has(k)) return false; vistos.add(k); return true; });
  for (const q of escolhidas.filter((x) => x.marcado).slice(0, n)) {
    try {
      const c = await criar({ frase: q.marcado, autor: q.autor, fonte: q.fonte, fundo }, { deps: deps.formato || {}, origem: 'piloto_frase' });
      criados.push({ id: c.id, frase: q.texto, autor: q.autor });
      fundo = fundo === 'preto' ? 'branco' : 'preto';
    } catch (e) { barradas.push({ frase: q.texto, motivo: `não gerou o post (${String(e.message).slice(0, 80)})` }); }
  }
  if (criados.length && a?.duravel) {
    const ant = (await a.config.obter(conta())).frases_autores || [];
    await a.config.salvar(conta(), { frases_historico: [...hist, ...criados.map((x) => x.frase)].slice(-1000), frases_autores: [...ant, ...criados.map((x) => x.autor)].slice(-50) });
  }
  return { criados, barradas, restantes: lista.length - criados.length, em: new Date(agora).toISOString() };
}

module.exports = { produzir, marcar, destaquePadrao, FORA, SISTEMA };
