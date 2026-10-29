require('../backend/fontSetup');
const { fila } = require('../backend/lib/top/relogio');
const Piloto = require('../backend/lib/top/piloto');
const Relogio = require('../backend/lib/top/relogio');

// Tique do relógio do piloto: roda uma rodada e agenda a próxima. Erro na rodada não derruba a corrente.
module.exports = fila().handleNodeCallback(async () => {
  let r = null;
  try { r = await Piloto.rodada({ orcamentoMs: 45000 }); } catch (e) { console.error('[piloto] rodada falhou:', String(e.message).slice(0, 160)); }
  await Relogio.agendarProxima(r);
}, { visibilityTimeoutSeconds: 90, retry: () => ({ afterSeconds: 60 }) });
