// Google Cloud Tasks: a fila que substitui a da Vercel quando o app roda no Cloud Run (K_SERVICE definido).
// Cada tarefa é uma chamada HTTP agendada para o próprio app, autenticada com o CRON_SECRET. Enquanto a rota trabalha,
// o Cloud Run mantém a CPU ligada e cobra só esse tempo (desligado quando parado). Cota gratuita: 1 milhão de operações/mês.
// O nome da tarefa é a chave de idempotência (o mesmo nome não entra duas vezes na fila, como o idempotencyKey da Vercel).
const naNuvem = () => !!process.env.K_SERVICE;
const comFila = () => !!(process.env.VERCEL || process.env.K_SERVICE);

let cacheToken = null;
async function token(f = fetch) {
  if (cacheToken && cacheToken.ate > Date.now() + 60000) return cacheToken.valor;
  const r = await f('http://metadata.google.internal/computeMetadata/v1/instance/service-account/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`metadata ${r.status}`);
  const j = await r.json(); cacheToken = { valor: j.access_token, ate: Date.now() + j.expires_in * 1000 };
  return cacheToken.valor;
}

const nomeSeguro = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 450);

// criar({ caminho: '/api/nuvem/studio', corpo: {...}, atrasoS: 0, chave: 'algo-unico' })
async function criar({ caminho, corpo = {}, atrasoS = 0, chave = null }, { f = fetch } = {}) {
  const projeto = process.env.GCP_PROJETO; const regiao = process.env.GCP_REGIAO || 'southamerica-east1';
  const fila = process.env.GCP_FILA || 'pedro'; const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!projeto || !base || !process.env.CRON_SECRET) throw new Error('Cloud Tasks sem GCP_PROJETO, PUBLIC_BASE_URL ou CRON_SECRET');
  const pai = `projects/${projeto}/locations/${regiao}/queues/${fila}`;
  const task = {
    dispatchDeadline: '1800s',
    httpRequest: {
      httpMethod: 'POST', url: `${base}${caminho}`,
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(corpo)).toString('base64'),
    },
  };
  if (atrasoS > 0) task.scheduleTime = new Date(Date.now() + Math.ceil(atrasoS) * 1000).toISOString();
  if (chave) task.name = `${pai}/tasks/${nomeSeguro(chave)}`;
  const r = await f(`https://cloudtasks.googleapis.com/v2/${pai}/tasks`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token(f)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ task }),
  });
  if (r.status === 409) return { duplicada: true }; // mesma chave já na fila (ou executada há pouco)
  if (!r.ok) throw new Error(`Cloud Tasks ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

module.exports = { criar, naNuvem, comFila, nomeSeguro };
