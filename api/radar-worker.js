require('../backend/fontSetup');
const { fila } = require('../backend/lib/radar/fila');
const pipeline = require('../backend/lib/radar/pipeline');
const store = require('../backend/lib/radar/store');

// Continuação do Radar: cada mensagem avança a execução até esgotar o orçamento de tempo e reenfileira se faltar.
module.exports = fila().handleNodeCallback(async ({ id }) => {
  if (typeof id !== 'string' || !/^(rd|pt|lt)_[\w]{3,60}$/.test(id)) return;
  // pauta (pt_) e lote (lt_) do padrão "Pedro Destrava — Minimalista"
  if (id.startsWith('pt_') || id.startsWith('lt_')) {
    const Pauta = require('../backend/lib/radar/pauta');
    const r = id.startsWith('pt_') ? await Pauta.avancar(id, { orcamentoMs: 44000 }) : await Pauta.avancarLote(id, { orcamentoMs: 44000 });
    if (r.concluida || r.concluido) return;
    throw Object.assign(new Error('Pauta em andamento.'), { afterSeconds: r.ocupado ? 20 : (r.esperar_s || 3) });
  }
  const reg = await store.obter('execucao', id);
  if (!reg || reg.doc.estado !== 'em_andamento') return;
  const r = await pipeline.avancar(id, { orcamentoMs: 44000 });
  if (r.concluida) return;
  if (r.ocupado) throw Object.assign(new Error('Outra etapa ainda está em processamento.'), { afterSeconds: 20 });
  throw Object.assign(new Error('Execução em andamento.'), { afterSeconds: r.esperar_s || 3 });
}, { visibilityTimeoutSeconds: 90, retry: (error, metadata) => ({ afterSeconds: error.afterSeconds || Math.min(120, 10 * metadata.deliveryCount) }) });
