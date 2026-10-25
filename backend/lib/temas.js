// Temas já usados: a ferramenta não repete assunto dentro de N dias (padrão 21), contando
// o que ELA publicou e também os posts antigos do Instagram (lidos pela aba Resultados).
//
// Semelhança de TEMA (não de texto): palavras significativas reduzidas ao radical (5 letras),
// sem palavras vazias; duas frases tratam do mesmo tema quando dividem pelo menos 2 radicais
// e pelo menos 40% do menor conjunto. Frases curtas (1 ou 2 radicais) exigem todos os radicais.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const MAX = 400;
const DIAS_PADRAO = 21;
const VAZIAS = new Set(['para', 'como', 'sobre', 'entre', 'pelo', 'pela', 'pelos', 'pelas', 'esta', 'este', 'essa', 'esse', 'isso', 'aqui', 'mais', 'menos', 'muito', 'muita', 'quando', 'onde', 'porque', 'ainda', 'depois', 'antes', 'hoje', 'agora', 'seus', 'suas', 'seu', 'sua', 'nosso', 'nossa', 'cada', 'todo', 'toda', 'todos', 'todas', 'quem', 'qual', 'quais', 'sera', 'serao', 'tambem', 'segundo', 'governo', 'brasil', 'brasileiro', 'brasileira', 'pode', 'podem', 'vai', 'vao', 'fica', 'ficam', 'nova', 'novo', 'novas', 'novos', 'veja', 'entenda', 'saiba', 'muda', 'mudar', 'mudou', 'aprova', 'aprovou', 'aprovar', 'anuncia', 'anunciou', 'sobe', 'subir', 'subiu', 'caiu', 'chega', 'chegou', 'propoe', 'pede', 'pedir', 'avalia', 'diz', 'quer']);

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function radicais(texto) {
  const out = new Set();
  String(texto || '').replace(/\*\*/g, '').split(/[^\p{L}\p{N}]+/u).forEach((original) => {
    if (!original) return;
    const w = semAcento(original).toLowerCase();
    if (VAZIAS.has(w)) return;
    // Siglas curtas (MEI, PIB, INSS) e escalas como 6x1 identificam o assunto: ficam.
    const sigla = original.length === 3 && original === original.toUpperCase() && /^\p{L}+$/u.test(original);
    const numero = /^\d+x?\d*$/.test(w) && w.length >= 2;
    if (w.length >= 4 || sigla || numero) out.add(w.slice(0, 5));
  });
  return out;
}

function mesmoTema(a, b) {
  const A = radicais(a); const B = radicais(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter += 1; });
  const menor = Math.min(A.size, B.size);
  if (menor <= 2) return inter === menor && menor >= 1;
  return inter >= 2 && inter / menor >= 0.4;
}

// Procura, dentro da janela de dias, um tema já usado que seja o mesmo. Devolve a entrada e há quantos dias.
function repetido(tema, log, { dias = DIAS_PADRAO, agora = Date.now() } = {}) {
  const limite = agora - dias * 86400000;
  for (const e of log || []) {
    const t = Date.parse(e.em);
    if (!Number.isFinite(t) || t < limite) continue;
    if (mesmoTema(tema, e.tema)) return { ...e, ha_dias: Math.max(0, Math.floor((agora - t) / 86400000)) };
  }
  return null;
}

// Primeira frase útil de uma legenda ou título (até 140 caracteres).
const temaDeTexto = (texto) => String(texto || '').replace(/\*\*/g, '').split(/(?<=[.!?])\s|\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 140);

async function ler() {
  const a = armazem();
  if (!a?.duravel) return [];
  const v = (await a.config.obter(ACCOUNT.ig_id)).temas_usados;
  return Array.isArray(v) ? v : [];
}
async function gravar(lista) {
  const a = armazem();
  if (!a?.duravel) return false;
  const ord = [...lista].sort((x, y) => Date.parse(y.em) - Date.parse(x.em)).slice(0, MAX);
  await a.config.salvar(ACCOUNT.ig_id, { temas_usados: ord });
  return true;
}

// Registra um tema (idempotente por id).
async function registrar(tema, { origem = 'ferramenta', id, em = new Date().toISOString() } = {}) {
  const t = temaDeTexto(tema);
  if (t.length < 8) return false;
  const lista = await ler();
  const chave = id || `${origem}:${t}`;
  const sem = lista.filter((e) => e.id !== chave);
  sem.push({ id: chave, tema: t, origem, em });
  return gravar(sem);
}

// Posts antigos do Instagram viram temas usados (idempotente: substitui as entradas ig:).
async function semearDoInstagram(posts) {
  const novos = (posts || []).map((p) => ({ id: `ig:${p.id}`, tema: temaDeTexto(p.legenda), origem: p.da_ferramenta ? 'ferramenta' : 'instagram', em: p.publicado_em })).filter((e) => e.tema.length >= 12 && e.em);
  const lista = (await ler()).filter((e) => !String(e.id).startsWith('ig:'));
  return gravar([...lista, ...novos]);
}

module.exports = { mesmoTema, repetido, temaDeTexto, radicais, ler, registrar, semearDoInstagram, DIAS_PADRAO, MAX };
