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
  // Monitor de notícias em alta: DESLIGADO até você ligar em Ajustes. Cada rodada gasta chamadas de IA.
  monitor: { ativo: false, min_veiculos: 3, janela_horas: 12, limiar_prioridade: 50, max_roteiros_dia: 3, max_alertas_por_rodada: 3, intervalo_min: 30 },
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
  if ('monitor' in entrada) {
    const m = entrada.monitor;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw Object.assign(new Error('monitor deve ser um objeto.'), { status: 400 });
    const faixa = (k, min, max) => { if (!(k in m)) return; const n = Number(m[k]); if (!Number.isInteger(n) || n < min || n > max) throw Object.assign(new Error(`monitor.${k} deve ser um inteiro de ${min} a ${max}.`), { status: 400 }); out.monitor[k] = n; };
    out.monitor = {};
    if ('ativo' in m) { if (typeof m.ativo !== 'boolean') throw Object.assign(new Error('monitor.ativo deve ser verdadeiro ou falso.'), { status: 400 }); out.monitor.ativo = m.ativo; }
    faixa('min_veiculos', 2, 10); faixa('janela_horas', 1, 72); faixa('limiar_prioridade', 0, 100); faixa('max_roteiros_dia', 0, 10); faixa('max_alertas_por_rodada', 1, 5); faixa('intervalo_min', 15, 720);
  }
  return out;
}

async function ler() {
  const a = armazem();
  const guardada = a?.duravel ? ((await a.config.obter(ACCOUNT.ig_id)).estrategia || {}) : {};
  return { ...PADRAO, ...guardada, monitor: { ...PADRAO.monitor, ...(guardada.monitor || {}) } };
}
async function salvar(patch) {
  const v = validar(patch);
  const atual = await ler();
  const novo = { ...atual, ...v, ...(v.monitor ? { monitor: { ...atual.monitor, ...v.monitor } } : {}) };
  const a = armazem();
  if (a?.duravel) await a.config.salvar(ACCOUNT.ig_id, { estrategia: novo });
  return { ...novo, guardada: !!a?.duravel };
}

module.exports = { PADRAO, validar, ler, salvar };
