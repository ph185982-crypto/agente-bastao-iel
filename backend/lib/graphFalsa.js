// Graph API da Meta SIMULADA (servidor HTTP local) para testes e para o teste de navegador.
// Nada daqui fala com a Meta de verdade. Implementa só o que a publicação usa.
const http = require('http');

function graphFalsa(TOKEN_FALSO, ACCOUNT) {
  const est = {
    chamadas: [], containers: {}, publicados: [], statusSeq: ['IN_PROGRESS', 'FINISHED'], publishFalha: null, publishDeixaCair: false,
    username: 'pedro_destrava', id: ACCOUNT.ig_id, quota: { usado: 2, total: 100 }, tokenInvalido: false, midias: [],
  };
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const params = req.method === 'GET' ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(corpo));
      const caminho = u.pathname.replace(/^\/v[\d.]+\//, '');
      est.chamadas.push({ metodo: req.method, caminho, params });
      const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (est.tokenInvalido) return json({ error: { message: 'Error validating access token', code: 190, error_subcode: 463, fbtrace_id: 'abc' } }, 400);
      if (params.access_token !== TOKEN_FALSO && caminho !== 'debug_token') return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
      if (caminho === 'debug_token') return json({ data: { is_valid: true, expires_at: 2000000000, scopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'], type: 'PAGE' } });
      if (caminho === process.env.META_IG_USER_ID && req.method === 'GET') return json({ id: est.id, username: est.username });
      if (caminho.endsWith('/content_publishing_limit')) return json({ data: [{ quota_usage: est.quota.usado, config: { quota_total: est.quota.total, quota_duration: 86400 } }] });
      if (caminho.endsWith('/media') && req.method === 'POST') {
        const id = `cont_${Object.keys(est.containers).length + 1}`;
        est.containers[id] = { ...params, polls: 0 };
        return json({ id });
      }
      if (caminho.endsWith('/media') && req.method === 'GET') return json({ data: est.midias });
      if (caminho.endsWith('/media_publish')) {
        if (est.publishDeixaCair) { est.publishDeixaCair = false; est.publicados.push(params.creation_id); est.midias.push({ id: `media_${est.publicados.length}`, caption: est.containers[params.creation_id]?.caption, permalink: `https://www.instagram.com/p/ABC${est.publicados.length}/`, timestamp: new Date().toISOString() }); req.socket.destroy(); return; }
        if (est.publishFalha) return json({ error: est.publishFalha }, 400);
        est.publicados.push(params.creation_id);
        const m = { id: `media_${est.publicados.length}`, caption: est.containers[params.creation_id]?.caption, permalink: `https://www.instagram.com/p/ABC${est.publicados.length}/`, timestamp: new Date().toISOString() };
        est.midias.push(m);
        return json({ id: m.id });
      }
      if (/^cont_\d+$/.test(caminho)) {
        const c = est.containers[caminho]; c.polls += 1;
        return json({ status_code: est.statusSeq[Math.min(c.polls - 1, est.statusSeq.length - 1)] });
      }
      if (/^media_\d+$/.test(caminho)) { const m = est.midias.find((x) => x.id === caminho); return json({ id: caminho, permalink: m?.permalink }); }
      json({ error: { message: `rota não simulada: ${caminho}`, code: 100 } }, 404);
    });
  });
  return { est, srv };
}

module.exports = { graphFalsa };
