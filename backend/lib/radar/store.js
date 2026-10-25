// Persistência do Radar. Tudo no armazém do servidor (Postgres/Neon em produção): nada depende do navegador.
//   oportunidade → uma por negócio encontrado (com fontes, afirmações, pontuação e decisões do Pedro)
//   execucao     → uma por rodada (cron ou manual), com o ponto de retomada
//   coleta       → itens lidos dos feeds numa execução (para retomar sem ler tudo de novo)
//   carrossel    → o carrossel gerado, suas versões, imagens, legenda, ficha de fontes e métricas
//   reels        → roteiro de Reels de uma oportunidade
//   config       → ajustes do Radar
// Arquivos (PNG dos slides, ZIP, imagens originais) ficam em `arquivos` com chave `radar:`.
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const { erro } = require('./util');

const conta = () => ACCOUNT.ig_id;
const TIPOS = ['oportunidade', 'execucao', 'coleta', 'carrossel', 'reels', 'config', 'pauta', 'lote'];

function db() {
  const a = armazem();
  if (!a?.duravel || !a.radar) throw erro('O Radar precisa do banco de dados no servidor (Cópia no servidor). Sem ele não há onde guardar as pesquisas.', 'SEM_BANCO', 503);
  return a;
}
const disponivel = () => { const a = armazem(); return !!(a?.duravel && a.radar); };

async function obter(tipo, id) { return (await db().radar.obter(conta(), tipo, id)); }
async function salvar(tipo, id, doc, baseRev) {
  if (!TIPOS.includes(tipo)) throw erro(`Tipo desconhecido: ${tipo}`, 'ENTRADA', 500);
  return db().radar.salvar(conta(), tipo, id, { ...doc, id }, baseRev);
}
async function listar(tipo, limite = 500) { return (await db().radar.listar(conta(), tipo, { limite })).map((r) => ({ ...r.doc, _rev: r.rev, _atualizado_em: r.atualizado_em })); }
async function apagar(tipo, id) { return db().radar.apagar(conta(), tipo, id); }

// Atualiza um documento com leitura + gravação condicional (tenta de novo se outro processo gravou no meio).
async function atualizar(tipo, id, fn, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    const reg = await obter(tipo, id);
    if (!reg) throw erro('Registro não encontrado.', 'NAO_ENCONTRADO', 404);
    const doc = fn(reg.doc) || reg.doc;
    try { const r = await salvar(tipo, id, doc, reg.rev); return { doc, rev: r.rev }; } catch (e) { if (e.code !== 'CONFLITO' || i === tentativas - 1) throw e; }
  }
  return null;
}

async function arquivoSalvar(chave, dados, tipo) { return db().arquivos.salvar(conta(), `radar:${chave}`, dados, tipo); }
async function arquivoObter(chave) { const r = await db().arquivos.obter(conta(), `radar:${chave}`); return r ? { dados: Buffer.from(r.dados), tipo: r.tipo, sha256: r.sha256 } : null; }

const CONFIG_PADRAO = { ativo: true, limiar: 75, max_manuais_dia: 4, dias_sem_repetir: 120 };
async function config() { const reg = disponivel() ? await obter('config', 'radar') : null; return { ...CONFIG_PADRAO, ...(reg?.doc || {}) }; }
async function salvarConfig(patch) {
  const atual = await config();
  const novo = { ...atual };
  if ('ativo' in patch) novo.ativo = patch.ativo === true;
  if ('max_manuais_dia' in patch) { const n = Number(patch.max_manuais_dia); if (!Number.isInteger(n) || n < 1 || n > 20) throw erro('max_manuais_dia deve ser de 1 a 20.'); novo.max_manuais_dia = n; }
  if ('dias_sem_repetir' in patch) { const n = Number(patch.dias_sem_repetir); if (!Number.isInteger(n) || n < 7 || n > 365) throw erro('dias_sem_repetir deve ser de 7 a 365.'); novo.dias_sem_repetir = n; }
  if ('foto_pedro' in patch && patch.foto_pedro && typeof patch.foto_pedro === 'object') novo.foto_pedro = patch.foto_pedro;
  const reg = await obter('config', 'radar');
  await salvar('config', 'radar', novo, reg ? reg.rev : 0);
  return novo;
}

module.exports = { disponivel, obter, salvar, listar, apagar, atualizar, arquivoSalvar, arquivoObter, config, salvarConfig, conta, TIPOS };
