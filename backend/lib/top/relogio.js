// Relógio próprio do piloto: ao fim de cada rodada, a fila da Vercel agenda a próxima (o agendador do GitHub atrasa
// horas e às vezes nem roda). Com produção em andamento, próxima em ~1 min; parado, a cada 10 min (agenda e janelas).
// O horário-alvo é arredondado para o múltiplo do intervalo e vira a chave de idempotência: correntes que chegam ao mesmo
// horário (GitHub, app aberto, a própria fila) viram uma mensagem só; a trava da rodada recusa a que chegar no meio de outra.
let cliente;
const fila = () => (cliente ||= new (require('@vercel/queue').QueueClient)({ region: process.env.VERCEL_REGION || 'iad1' }));
const TOPICO = 'pedro-piloto';
const ATIVO_S = 60; const PARADO_S = 600;

function proximo(rodada, agora = Date.now()) {
  const ativo = (rodada?.avancados || []).some((x) => x.estado === 'em_andamento') || !!rodada?.criado;
  const passo = (ativo ? ATIVO_S : PARADO_S) * 1000;
  const alvo = Math.ceil((agora + passo / 2) / passo) * passo;
  return { alvo, chave: `piloto:${alvo / 1000}`, atrasoS: Math.max(1, Math.ceil((alvo - agora) / 1000)) };
}

async function agendarProxima(rodada, { agora = Date.now(), enviar } = {}) {
  if (!enviar && !process.env.VERCEL) return null;
  const p = proximo(rodada, agora);
  try {
    await (enviar || ((m, o) => fila().send(TOPICO, m, o)))({ alvo: p.alvo }, { idempotencyKey: p.chave, retentionSeconds: 3600, delaySeconds: p.atrasoS });
    return p;
  } catch (e) { console.error('[piloto] relógio sem fila:', String(e.message).slice(0, 120)); return null; }
}

module.exports = { proximo, agendarProxima, fila, TOPICO };
