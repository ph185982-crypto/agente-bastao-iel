// Leitura de URLs informadas pelo usuário, protegida contra acesso a rede
// interna (SSRF). Vale pra qualquer coisa que o servidor busque a pedido de
// um link: artigos, imagens, documentos.
//
// Proteções:
//  - só http/https, portas 80/443, sem usuário/senha na URL;
//  - o endereço IP é validado no momento da CONEXÃO (função lookup), então um
//    DNS que muda entre a checagem e o uso (rebinding) também é barrado;
//  - redirecionamentos são seguidos à mão, no máximo 4, cada um revalidado;
//  - limite de bytes e de tempo; só tipos de conteúdo esperados;
//  - não envia cookies nem credenciais; não contorna paywall nem login;
//  - o conteúdo volta como DADO: quem usa nunca o trata como instrução.
const dns = require('dns');
const net = require('net');
const http = require('http');
const zlib = require('zlib');
const https = require('https');
const { URL } = require('url');

const MAX_BYTES_PADRAO = 2 * 1024 * 1024;
const TIMEOUT_MS_PADRAO = 12000;
const UA = 'Mozilla/5.0 (compatible; PedroDestravaBot/1.0; leitura de fonte para checagem editorial)';

// IPv4 privado/reservado ou IPv6 interno.
function ipProibido(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)        // CGNAT
      || (a === 169 && b === 254)                   // link-local e metadados de nuvem
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (Number(ip.split('.')[2]) === 0 || Number(ip.split('.')[2]) === 2))  // só 192.0.0.0/24 e 192.0.2.0/24 (o resto de 192.0.x é público)
      || (a === 198 && b === 51 && Number(ip.split('.')[2]) === 100)
      || (a === 203 && b === 0 && Number(ip.split('.')[2]) === 113)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;                                  // multicast e reservados
  }
  if (net.isIPv6(ip)) {
    const v = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (/^fe[89ab]/.test(v) || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('ff')) return true;
    // URL normaliza IPv4 mapeado para hexadecimal (::ffff:a00:1).
    const m = v.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
    if (m) {
      const alto = parseInt(m[1], 16); const baixo = parseInt(m[2], 16);
      return ipProibido([alto >> 8, alto & 255, baixo >> 8, baixo & 255].join('.'));
    }
    return false;
  }
  return true;
}

class ErroUrl extends Error {
  constructor(msg, codigo) { super(msg); this.code = codigo; this.isUrlError = true; }
}

function validaUrl(texto) {
  let u;
  try { u = new URL(String(texto).trim()); } catch { throw new ErroUrl('Isso não parece um link válido.', 'URL_INVALIDA'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ErroUrl('Só links http ou https são aceitos.', 'PROTOCOLO');
  if (u.username || u.password) throw new ErroUrl('Links com usuário e senha não são aceitos.', 'CREDENCIAIS');
  const porta = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (!['80', '443'].includes(porta)) throw new ErroUrl('Só as portas 80 e 443 são aceitas.', 'PORTA');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new ErroUrl('Endereços internos não são aceitos.', 'HOST_INTERNO');
  }
  if (net.isIP(host) && ipProibido(host)) throw new ErroUrl('Endereços internos não são aceitos.', 'IP_INTERNO');
  return u;
}

// lookup usado na conexão: resolve e REJEITA se qualquer resposta for interna.
function lookupSeguro(resolver) {
  const resolve = resolver || ((host, opts, cb) => dns.lookup(host, { ...opts, all: true, verbatim: true }, cb));
  return (host, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    const options = typeof opts === 'function' ? {} : opts || {};
    resolve(host, options, (err, addrs) => {
      if (err) return done(err);
      const lista = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIPv6(addrs) ? 6 : 4 }];
      if (!lista.length) return done(new ErroUrl('O endereço não resolveu.', 'DNS'));
      const ruim = lista.find((a) => ipProibido(a.address));
      if (ruim) return done(new ErroUrl('Esse endereço aponta para a rede interna e foi bloqueado.', 'IP_INTERNO'));
      if (options.all) return done(null, lista);
      return done(null, lista[0].address, lista[0].family);
    });
  };
}

const TIPOS_PADRAO = [/^text\/html/, /^application\/xhtml\+xml/, /^text\/plain/, /^application\/json/, /^application\/(rss|atom)?\+?xml/, /^text\/xml/];

function umaRequisicao(url, { timeoutMs, maxBytes, tipos, resolver, accept, binario }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Accept-Encoding': 'gzip, deflate' },
      lookup: lookupSeguro(resolver),
      // Um agente próprio garante que a resolução segura não seja substituída
      // pelo agente global (inclusive quando ele usa proxy de ambiente).
      agent: new mod.Agent({ lookup: lookupSeguro(resolver) }),
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).toString(), status });
      }
      const tipo = String(res.headers['content-type'] || '').toLowerCase();
      if (status >= 400) { res.resume(); return resolve({ status, tipo, corpo: '', bloqueado: [401, 402, 403, 451].includes(status) }); }
      if (tipo && !tipos.some((r) => r.test(tipo))) {
        res.resume();
        return reject(new ErroUrl(`Tipo de conteúdo não aceito (${tipo.split(';')[0]}).`, 'TIPO'));
      }
      const partes = [];
      let total = 0;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      // O limite vale pro tamanho DESCOMPRIMIDO (protege de bomba de compressão).
      const fonte = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      fonte.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) { req.destroy(new ErroUrl('A página é grande demais para ler.', 'TAMANHO')); return; }
        partes.push(c);
      });
      fonte.on('end', () => {const dados=Buffer.concat(partes);resolve({ status, tipo, corpo: binario ? dados : dados.toString('utf8'), url: url.toString() });});
      fonte.on('error', () => reject(new ErroUrl('Não consegui ler a resposta da página.', 'DECODIFICACAO')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new ErroUrl('A página demorou demais para responder.', 'TIMEOUT')));
    req.on('error', (e) => reject(e.isUrlError ? e : new ErroUrl(e.code === 'ENOTFOUND' ? 'Não encontrei esse endereço.' : `Falha ao abrir a página (${e.code || e.message}).`, e.code || 'REDE')));
    req.end();
  });
}

// Devolve { url_final, status, tipo, corpo, redirecionamentos, acessado_em }.
// Quando a página exige login/pagamento (401/402/403) devolve acesso_negado:true
// e corpo vazio: o chamador registra "fonte indisponível" e procura outra.
async function safeFetch(texto, opts = {}) {
  const { timeoutMs = TIMEOUT_MS_PADRAO, maxBytes = MAX_BYTES_PADRAO, tipos = TIPOS_PADRAO, resolver, accept, binario = false } = opts;
  let url = validaUrl(texto);
  const salto = [];
  for (let i = 0; i <= 4; i++) {
    const r = await umaRequisicao(url, { timeoutMs, maxBytes, tipos, resolver, accept, binario });
    if (r.redirect) {
      url = validaUrl(r.redirect);
      salto.push(url.toString());
      continue;
    }
    return {
      url_final: r.url || url.toString(), status: r.status, tipo: r.tipo, corpo: r.corpo,
      acesso_negado: !!r.bloqueado, redirecionamentos: salto, acessado_em: new Date().toISOString(),
    };
  }
  throw new ErroUrl('Redirecionamentos demais.', 'REDIRECTS');
}

module.exports = { safeFetch, validaUrl, ipProibido, lookupSeguro, ErroUrl };
