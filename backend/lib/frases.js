// Frases do Pedro (posts de 1 imagem para curtir e repostar nos stories). Produção do piloto, em lote:
// 1) a IA escreve um lote no tom do Pedro (dinheiro, trabalho, vender, disciplina, empreender), com nota própria;
// 2) o fiscal em código barra clichê de coach, cara de IA, tamanho fora do padrão e frase parecida com as já feitas;
// 3) cada frase aprovada vira um post (formatosCarrossel.criarFrase) que vai para a fila de aprovação.
// Histórico das frases (para não repetir) em config.frases_historico (últimas 400).
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const conta = () => ACCOUNT.ig_id;

const TEMAS = ['dinheiro', 'trabalho', 'vender', 'disciplina', 'empreender', 'consistência', 'coragem', 'foco', 'família e propósito', 'começar do zero'];
// Clichê de coach e de frase pronta da internet: o público já rolou mil vezes.
const CLICHES = [/\bsai(r|a) da (sua )?zona de conforto\b/i, /\bacredite (em você|nos seus sonhos)\b/i, /\bnunca desista\b/i, /\bfoco,? for[cç]a e f[eé]\b/i, /\bo universo\b/i, /\bgratid[aã]o\b/i, /\bvibra[cç][aã]o\b/i, /\bseja a sua melhor vers[aã]o\b/i, /\bmelhor vers[aã]o de (si|voc[eê])\b/i, /\bo sucesso [eé] a soma\b/i, /\bsonhe grande\b/i, /\bmindset\b/i, /\bgrind\b/i, /\bvoc[eê] [eé] capaz\b/i, /\btudo acontece no tempo certo\b/i, /\bo c[eé]u [eé] o limite\b/i];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const PARADAS = new Set('a o e de da do das dos que um uma para pra com sem no na nos nas em se voce seu sua mais mas por quem nao e eh ja so ou ao aos as os isso esse essa este esta como'.split(' '));
const palavras = (s) => [...new Set(norm(s).split(' ').filter((p) => p.length > 2 && !PARADAS.has(p)))];
function parecida(a, b) {
  const x = palavras(a); const y = new Set(palavras(b)); if (!x.length || !y.size) return false;
  const comum = x.filter((p) => y.has(p)).length;
  return comum / Math.min(x.length, y.size) >= 0.6 || norm(a) === norm(b);
}

// Fiscal em código: devolve { ok: [...], barradas: [{ frase, motivo }] }.
function fiscal(lote, historico = [], { notaMin = 8.5 } = {}) {
  const AI = require('./mentes/antiIA');
  const ok = []; const barradas = [];
  for (const it of lote || []) {
    const f = String(it?.frase || '').replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
    const n = f.split(' ').length;
    const motivo = !f ? 'vazia'
      : f.length < 25 || n < 5 ? 'curta demais'
      : f.length > 140 || n > 24 ? 'longa demais para ler num story'
      : /#|@|https?:|\p{Extended_Pictographic}/u.test(f) ? 'tem hashtag, @, link ou emoji'
      : /["“”«»]/.test(f) ? 'tem aspas'
      : /\b\d+\s?h\b|\b(acordei|acordar|hoje eu|ontem)\b/i.test(f) ? 'relato do dia, não verdade geral'
      : CLICHES.some((re) => re.test(f)) ? 'clichê de coach'
      : AI.vicios(f).length ? `cara de IA (${AI.vicios(f)[0].nome})`
      : Number(it?.nota) < notaMin ? `nota ${it?.nota} abaixo de ${notaMin}`
      : [...historico, ...ok.map((x) => x.frase)].some((h) => parecida(f, h)) ? 'parecida com uma frase já feita'
      : null;
    if (motivo) barradas.push({ frase: f, motivo }); else ok.push({ frase: f, tema: String(it.tema || '').slice(0, 40), fundo: String(it.fundo || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().slice(0, 60) });
  }
  return { ok, barradas };
}

const SISTEMA = `Você escreve as frases do @pedro_destrava: consultor que ajuda pequeno negócio a vender, veio de baixo, fala como brasileiro comum. As frases viram um post de 1 imagem que a pessoa curte e REPOSTA nos stories porque se viu nela.
Regras:
- Uma ideia por frase, de 8 a 22 palavras. Português do Brasil falado, direto, sem rima e sem palavra difícil.
- Verdade dura e específica sobre dinheiro, trabalho, vender, disciplina e começar do zero. Cena concreta do dia a dia (boleto, cliente, segunda-feira, primeiro emprego, loja vazia, família) vale mais que abstração.
- Proibido: clichê de coach (zona de conforto, acredite nos seus sonhos, nunca desista, melhor versão, mindset, universo, gratidão), a fórmula "não é X, é Y", travessão, emoji, hashtag e aspas.
- A frase precisa valer para QUALQUER pessoa que trabalha: uma verdade que ela lê e pensa "é isso". Relato do dia do Pedro ("acordei às 5h e fechei a planilha"), lista de tarefas e frase com número solto não servem.
- Padrão bom: "Cliente some quando você some." / "Preço baixo atrai quem vai embora pelo próximo centavo." / "Ninguém vê o seu esforço até o dia em que o resultado aparece na conta." / "Quem não anota o que vende trabalha no escuro."
- Varie o formato: afirmação curta, contraste do antes e depois, conselho em segunda pessoa.
- "nota" de 0 a 10: quanto alguém comum mandaria para um amigo ou repostaria. Seja duro.
- "fundo": 2 a 4 palavras em INGLÊS para uma foto de fundo calma e bonita que combine (ex.: "city night lights", "empty road sunrise", "coffee desk morning"). Sem pessoas em close.
Responda só JSON: {"frases":[{"frase":"","tema":"","nota":0,"fundo":""}]}`;

async function historico(a) { return a?.duravel ? ((await a.config.obter(conta())).frases_historico || []) : []; }

// Escreve, fiscaliza e cria até `n` posts de frase. Devolve { criados: [{id, frase}], barradas, chamadas }.
async function produzir(n, { deps = {}, agora = Date.now() } = {}) {
  const a = deps.armazem || armazem();
  const hist = await historico(a);
  const temas = [...TEMAS].sort(() => (deps.sortear || Math.random)() - 0.5).slice(0, 4);
  const pedir = deps.ia || ((args) => require('./llmJson').pedirJson(args));
  const r = await pedir({ sistema: SISTEMA, usuario: `Escreva ${Math.min(12, n * 2)} frases novas. Temas de hoje: ${temas.join(', ')}.\nNÃO repita nem parafraseie estas já usadas:\n${hist.slice(-60).map((h) => `- ${h}`).join('\n') || '(nenhuma)'}`, maxTokens: 2200, temperatura: 0.85, etapa: 'frases' });
  const { ok, barradas } = fiscal(r?.dados?.frases, hist);
  const criados = []; const fotos = [];
  const criar = deps.criarFrase || require('./formatosCarrossel').criarFrase;
  for (const f of ok.slice(0, n)) {
    try {
      const c = await criar({ frase: f.frase, tema: f.tema, fundo: f.fundo ? `pexels:${f.fundo}` : 'gradiente' }, { deps: { ...(deps.formato || {}), excluirFotos: fotos }, origem: 'piloto_frase' });
      if (c.foto_id) fotos.push(c.foto_id);
      criados.push({ id: c.id, frase: f.frase, tema: f.tema });
    } catch (e) { barradas.push({ frase: f.frase, motivo: `não gerou o post (${String(e.message).slice(0, 80)})` }); }
  }
  if (criados.length && a?.duravel) await a.config.salvar(conta(), { frases_historico: [...hist, ...criados.map((x) => x.frase)].slice(-400) });
  return { criados, barradas, modelo: r?.llm?.model || null, em: new Date(agora).toISOString() };
}

module.exports = { produzir, fiscal, parecida, CLICHES, SISTEMA, TEMAS };
