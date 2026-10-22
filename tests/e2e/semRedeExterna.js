// Exclusivo dos testes: nenhuma chamada pode alcançar um serviço real.
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).split(':')[0]) || ['::1', '[::1]'].includes(host);
for (const mod of [require('http'), require('https')]) {
  const original = mod.request;
  mod.request = function (entrada, ...args) {
    const inicial = typeof entrada === 'string' || entrada instanceof URL ? new URL(entrada) : entrada;
    const extra = args[0] && typeof args[0] === 'object' ? args[0] : {};
    const host = extra.hostname || extra.host || inicial.hostname || inicial.host || 'localhost';
    const caminho = extra.path || inicial.path || '';
    // Um proxy local também não pode encaminhar uma URL externa.
    if (!local(host) || (extra.method || inicial.method) === 'CONNECT' || (/^https?:\/\//i.test(caminho) && !local(new URL(caminho).hostname))) throw new Error('Rede externa desativada nos testes.');
    return original.call(this, entrada, ...args);
  };
  mod.get = function (...args) { const req = mod.request(...args); req.end(); return req; };
}
const fetchOriginal = global.fetch;
global.fetch = function (entrada, ...args) {
  if (!local(new URL(typeof entrada === 'string' || entrada instanceof URL ? entrada : entrada.url).hostname)) return Promise.reject(new Error('Rede externa desativada nos testes.'));
  return fetchOriginal(entrada, ...args);
};
