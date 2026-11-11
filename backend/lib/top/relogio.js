// Relógio próprio do piloto: ao fim de cada rodada, a fila da Vercel agenda a próxima (o agendador do GitHub atrasa
// horas e às vezes nem roda). Com produção em andamento, próxima em ~1 min. Parado, acorda só no PRÓXIMO COMPROMISSO que a
// rodada informou (`proxima_em`: post agendado, janela de aprovação, volta da cota de IA, início da produção), com teto de
// 45 min. Cada chamada acorda o Postgres gratuito (Neon) por ~5 min e a cota é de tempo ligado: acordar de 10 em 10 min
// mantinha o banco ligado metade do dia sem nada para fazer.
// O horário-alvo é arredondado para o múltiplo do intervalo e vira a chave de idempotência: correntes que chegam ao mesmo
// horário (GitHub, app aberto, a própria fila) viram uma mensagem só; a trava da rodada recusa a que chegar no meio de outra.
let cliente;
const fila = () => (cliente ||= new (require('@vercel/queue').QueueClient)({ region: process.env.VERCEL_REGION || 'iad1' }));
const TOPICO = 'pedro-piloto';
const ATIVO_S = 60; const PARADO_MIN_S = 300; const PARADO_MAX_S = 2700; // a fila guarda a mensagem por 1 h: o atraso fica abaixo disso

function proximo(rodada, agora = Date.now()) {
  const ativo = (rodada?.avancados || []).some((x) => x.estado === 'em_andamento') || !!rodada?.criado;
  if (ativo) {
    const passo = ATIVO_S * 1000; const alvo = Math.ceil((agora + passo / 2) / passo) * passo;
    return { alvo, chave: `piloto:${alvo / 1000}`, atrasoS: Math.max(1, Math.ceil((alvo - agora) / 1000)) };
  }
  // Parado: o compromisso informado pela rodada, entre 5 e 45 min, arredondado para o minuto (correntes paralelas que
  // miram o mesmo compromisso viram uma mensagem só). Sem compromisso informado: o teto, na grade de 45 min.
  const teto = Math.ceil((agora + PARADO_MAX_S * 500) / (PARADO_MAX_S * 1000)) * PARADO_MAX_S * 1000;
  const pedido = Number(rodada?.proxima_em) > 0 ? Math.ceil(Number(rodada.proxima_em) / 60000) * 60000 : teto;
  const alvo = Math.max(Math.ceil((agora + PARADO_MIN_S * 1000) / 60000) * 60000, Math.min(pedido, teto, agora + PARADO_MAX_S * 1000));
  return { alvo, chave: `piloto:${alvo / 1000}`, atrasoS: Math.max(1, Math.ceil((alvo - agora) / 1000)) };
}

// Compromisso novo no meio do caminho (o Pedro agendou um post para daqui a pouco): garante um tique naquele horário.
async function agendarEm(quando, { agora = Date.now(), enviar } = {}) {
  if (!enviar && !process.env.VERCEL) return null;
  const alvo = Math.ceil(Number(quando) / 60000) * 60000;
  if (!(alvo > agora) || alvo - agora > PARADO_MAX_S * 1000) return null; // longe: o tique normal chega antes
  try {
    await (enviar || ((m, o) => fila().send(TOPICO, m, o)))({ alvo }, { idempotencyKey: `piloto:${alvo / 1000}`, retentionSeconds: 3600, delaySeconds: Math.max(1, Math.ceil((alvo - agora) / 1000)) });
    return { alvo };
  } catch (e) { console.error('[piloto] relógio sem fila:', String(e.message).slice(0, 120)); return null; }
}

async function agendarProxima(rodada, { agora = Date.now(), enviar } = {}) {
  if (!enviar && !process.env.VERCEL) return null;
  const p = proximo(rodada, agora);
  try {
    await (enviar || ((m, o) => fila().send(TOPICO, m, o)))({ alvo: p.alvo }, { idempotencyKey: p.chave, retentionSeconds: 3600, delaySeconds: p.atrasoS });
    return p;
  } catch (e) { console.error('[piloto] relógio sem fila:', String(e.message).slice(0, 120)); return null; }
}

module.exports = { proximo, agendarProxima, agendarEm, fila, TOPICO, PARADO_MAX_S };
