require('../backend/fontSetup');
const { fila } = require('../backend/lib/top/relogio');
const Piloto = require('../backend/lib/top/piloto');
const Relogio = require('../backend/lib/top/relogio');

// Tique do relógio do piloto. A fila entrega a mensagem para a MESMA versão (deployment) que a enviou; por isso, em
// produção, o tique chama a rodada no endereço público: quem roda é sempre a versão atual (código e variáveis novos), e
// é ela que agenda o próximo tique. Assim a corrente migra sozinha a cada deploy. Se a chamada falhar, roda aqui mesmo.
async function pelaVersaoAtual() {
  const segredo = process.env.CRON_SECRET; const base = (process.env.PUBLIC_BASE_URL || 'https://agente-bastao-iel.vercel.app').replace(/\/$/, '');
  if (!segredo || process.env.VERCEL_ENV !== 'production') return false;
  try {
    const r = await fetch(`${base}/api/top/piloto/rodada`, { method: 'POST', headers: { Authorization: `Bearer ${segredo}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(57000) });
    return r.ok;
  } catch (e) { console.error('[piloto] versão atual não respondeu:', String(e.message).slice(0, 120)); return false; }
}

module.exports = fila().handleNodeCallback(async () => {
  if (await pelaVersaoAtual()) return;
  let r = null;
  try { r = await Piloto.rodada({ orcamentoMs: 45000 }); } catch (e) { console.error('[piloto] rodada falhou:', String(e.message).slice(0, 160)); }
  await Relogio.agendarProxima(r);
}, { visibilityTimeoutSeconds: 90, retry: () => ({ afterSeconds: 60 }) });
