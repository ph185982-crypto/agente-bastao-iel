// Continuação do pipeline fora da requisição (cron e botão): fila gerenciada da Vercel (a mesma usada pelo estúdio).
// Localmente, e se a fila falhar, a continuação roda no próprio processo. Quem não conseguir enfileirar não perde nada:
// o ponto de retomada está gravado, e o app aberto, o cron seguinte ou /api/radar/estado retomam a execução.
const pipeline = require('./pipeline');
const U = require('./util');

let cliente;
const fila = () => (cliente ||= new (require('@vercel/queue').QueueClient)({ region: process.env.VERCEL_REGION || 'iad1' }));

async function enfileirar(runId, { atrasoS = 0, carimbo = Date.now() } = {}) {
  return fila().send('pedro-radar', { id: runId }, { idempotencyKey: `${runId}:${Math.floor(carimbo / 20000)}`, retentionSeconds: 86400, delaySeconds: Math.max(0, Math.ceil(atrasoS)) });
}

const emAndamento = new Set();
function localmente(runId, atrasoS = 0) {
  if (emAndamento.has(runId)) return;
  emAndamento.add(runId);
  setTimeout(() => { pipeline.executarTudo(runId).catch((e) => console.error('[radar]', e.message)).finally(() => emAndamento.delete(runId)); }, Math.max(50, atrasoS * 1000));
}

async function continuar(runId, { atrasoS = 0 } = {}) {
  if (!process.env.VERCEL) return localmente(runId, atrasoS);
  try { await enfileirar(runId, { atrasoS }); } catch (e) { console.error('[radar] fila indisponível:', U.limita(e.message, 100)); }
}

module.exports = { continuar, enfileirar, fila };
