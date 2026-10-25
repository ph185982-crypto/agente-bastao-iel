require('../backend/fontSetup');
const { fila } = require('../backend/lib/radar/fila');
const pipeline = require('../backend/lib/radar/pipeline');
const store = require('../backend/lib/radar/store');

// Continuação do Radar: cada mensagem avança a execução até esgotar o orçamento de tempo e reenfileira se faltar.
module.exports = fila().handleNodeCallback(async ({ id }) => {
  if (typeof id !== 'string' || !/^rd_[\w]{3,60}$/.test(id)) return;
  const reg = await store.obter('execucao', id);
  if (!reg || reg.doc.estado !== 'em_andamento') return;
  const r = await pipeline.avancar(id, { orcamentoMs: 44000 });
  if (r.concluida) return;
  if (r.ocupado) throw Object.assign(new Error('Outra etapa ainda está em processamento.'), { afterSeconds: 20 });
  throw Object.assign(new Error('Execução em andamento.'), { afterSeconds: r.esperar_s || 3 });
}, { visibilityTimeoutSeconds: 90, retry: (error, metadata) => ({ afterSeconds: error.afterSeconds || Math.min(120, 10 * metadata.deliveryCount) }) });
