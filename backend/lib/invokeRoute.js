// Chama uma rota de um express.Router dentro do mesmo processo, sem HTTP.
// Serve pra fila reaproveitar carrossel, content-finder e trending sem
// duplicar lógica e sem a função da Vercel chamar a si mesma pela rede.
function invokeRoute(router, method, url, body = {}, { timeoutMs = 55000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      const e = new Error('A etapa demorou demais e foi interrompida.');
      e.status = 504;
      finish(reject, e);
    }, timeoutMs);

    const [path, qs = ''] = url.split('?');
    const req = {
      method, url, originalUrl: url, path, body,
      query: Object.fromEntries(new URLSearchParams(qs)),
      headers: { 'content-type': 'application/json' },
      get(name) { return this.headers[String(name).toLowerCase()]; },
      header(name) { return this.get(name); },
    };
    const headers = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      status(c) { this.statusCode = c; return this; },
      set(k, v) { if (typeof k === 'object') Object.assign(headers, k); else headers[k] = v; return this; },
      setHeader(k, v) { headers[k] = v; },
      getHeader(k) { return headers[k]; },
      json(data) {
        this.headersSent = true;
        if (this.statusCode >= 400) {
          const e = new Error(data?.error || `Erro ${this.statusCode}`);
          e.status = this.statusCode;
          e.body = data;
          return finish(reject, e);
        }
        finish(resolve, data);
      },
      send(data) { return this.json(data); },
      end(data) { return this.json(data); },
    };
    try {
      router.handle(req, res, (err) => {
        if (err) return finish(reject, err);
        const e = new Error(`Rota não encontrada: ${method} ${url}`);
        e.status = 404;
        finish(reject, e);
      });
    } catch (err) {
      finish(reject, err);
    }
  });
}

module.exports = { invokeRoute };
