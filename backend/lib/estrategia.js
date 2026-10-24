// Estratégia editável de pautas (nada fixo no código): modo político, temas bloqueados,
// dias sem repetir tema e amostra mínima para comparar grupos. Guardada no servidor.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const PADRAO = {
  // Decisão do Pedro ainda pendente: enquanto 'neutral', pautas partidárias ou eleitorais ficam de fora
  // (economia aplicada, como imposto, juros e preço, continua entrando). 'allowed' libera tudo.
  modo_politico: 'neutral',
  temas_bloqueados: [],
  dias_sem_repetir: 21,
  min_posts_por_grupo: 5,
};

function validar(entrada = {}) {
  const out = {};
  if ('modo_politico' in entrada) {
    if (!['neutral', 'allowed'].includes(entrada.modo_politico)) throw Object.assign(new Error('modo_politico deve ser "neutral" ou "allowed".'), { status: 400 });
    out.modo_politico = entrada.modo_politico;
  }
  if ('temas_bloqueados' in entrada) {
    if (!Array.isArray(entrada.temas_bloqueados)) throw Object.assign(new Error('temas_bloqueados deve ser uma lista.'), { status: 400 });
    out.temas_bloqueados = [...new Set(entrada.temas_bloqueados.map((t) => String(t).trim().toLowerCase().slice(0, 60)).filter((t) => t.length >= 3))].slice(0, 40);
  }
  if ('dias_sem_repetir' in entrada) {
    const n = Number(entrada.dias_sem_repetir);
    if (!Number.isInteger(n) || n < 1 || n > 90) throw Object.assign(new Error('dias_sem_repetir deve ser um número inteiro de 1 a 90.'), { status: 400 });
    out.dias_sem_repetir = n;
  }
  if ('min_posts_por_grupo' in entrada) {
    const n = Number(entrada.min_posts_por_grupo);
    if (!Number.isInteger(n) || n < 3 || n > 20) throw Object.assign(new Error('min_posts_por_grupo deve ser um número inteiro de 3 a 20.'), { status: 400 });
    out.min_posts_por_grupo = n;
  }
  return out;
}

async function ler() {
  const a = armazem();
  const guardada = a?.duravel ? ((await a.config.obter(ACCOUNT.ig_id)).estrategia || {}) : {};
  return { ...PADRAO, ...guardada };
}
async function salvar(patch) {
  const novo = { ...(await ler()), ...validar(patch) };
  const a = armazem();
  if (a?.duravel) await a.config.salvar(ACCOUNT.ig_id, { estrategia: novo });
  return { ...novo, guardada: !!a?.duravel };
}

module.exports = { PADRAO, validar, ler, salvar };
