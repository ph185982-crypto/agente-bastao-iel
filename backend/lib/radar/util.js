// Funções pequenas compartilhadas pelo Radar.
const crypto = require('crypto');

const sha = (s, n = 10) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n);
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9$%., ]+/g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (s) => String(s || '').replace(/\*\*/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const contaPalavras = (s) => palavras(s).length;
const agoraISO = (agora = Date.now()) => new Date(agora).toISOString();

// Dia civil de Brasília (UTC-3 o ano todo: o Brasil não usa horário de verão desde 2019).
const diaBRT = (agora = Date.now()) => new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
// Próximo 07:00 de Brasília (= 10:00 UTC) depois de `agora`.
function proximaExecucao(agora = Date.now()) {
  const d = new Date(agora);
  let alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 0, 0);
  if (alvo <= agora) alvo += 86400000;
  return new Date(alvo).toISOString();
}

// Domínio "registrável" (agora.uol.com.br → uol.com.br).
function dominio(url) { return require('../evidence').dominioRegistravel(url); }
function host(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }

const limita = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const erro = (msg, code = 'RADAR', status = 400, extra) => Object.assign(new Error(msg), { code, status, ...(extra || {}) });

// Promessa com prazo: o que não responde a tempo vira erro de timeout explícito (a etapa registra e segue).
function comTimeout(promessa, ms, rotulo = 'operação') {
  let t;
  const prazo = new Promise((_, rej) => { t = setTimeout(() => rej(erro(`${rotulo} demorou mais de ${Math.round(ms / 1000)} s.`, 'TIMEOUT', 504)), ms); });
  return Promise.race([Promise.resolve(promessa), prazo]).finally(() => clearTimeout(t));
}

// Executa tarefas com no máximo `n` ao mesmo tempo, preservando a ordem do resultado.
async function emParalelo(itens, n, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); }
  }));
  return out;
}

// Só nos testes de navegador (TESTE_RADAR=1, nunca em produção): fontes, páginas e IA simuladas.
const depsDeTeste = () => (process.env.TESTE_RADAR === '1' && !process.env.VERCEL && global.__RADAR_DEPS__ ? global.__RADAR_DEPS__ : {});

module.exports = { depsDeTeste, sha, semAcento, norm, palavras, contaPalavras, agoraISO, diaBRT, proximaExecucao, dominio, host, limita, erro, comTimeout, emParalelo };
