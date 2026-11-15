// Apoio dos testes: requisição/resposta falsas e emissor de tokens do Avanteza ID (par P-256 gerado na hora).
const crypto = require('node:crypto');

function respostaFalsa() {
  const res = {
    statusCode: 200, cabecalhos: {}, corpo: '', encerrada: false,
    setHeader(n, v) { this.cabecalhos[n.toLowerCase()] = v; return this; },
    getHeader(n) { return this.cabecalhos[n.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.setHeader('Content-Type', 'application/json'); this.corpo = JSON.stringify(o); this.encerrada = true; return this; },
    end(t) { if (t) this.corpo = String(t); this.encerrada = true; return this; },
  };
  return res;
}

function requisicao({ method = 'GET', headers = {}, query = {}, body, url = '/' } = {}) {
  return { method, headers, query, body, url };
}

function novoEmissor(kid = 'teste-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  function emitir(claims = {}, { alg = 'ES256' } = {}) {
    const agora = Math.floor(Date.now() / 1000);
    const corpo = { iss: 'avanteza-id', aud: 'contratos', sub: 'Pedro@Avanteza.com.br', name: 'Pedro', role: 'admin', ret: '/', iat: agora, exp: agora + 60, jti: crypto.randomUUID(), ...claims };
    const base = `${b64({ alg, typ: 'JWT', kid })}.${b64(corpo)}`;
    const assinatura = crypto.sign('sha256', Buffer.from(base), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${base}.${assinatura}`;
  }
  return { keys: [jwk], emitir };
}

module.exports = { respostaFalsa, requisicao, novoEmissor };
