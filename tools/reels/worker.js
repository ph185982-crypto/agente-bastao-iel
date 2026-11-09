#!/usr/bin/env node
// Worker de edição de vídeo (roda no GitHub Actions, ver .github/workflows/video-worker.yml).
// Pega até 3 jobs na fila do app, baixa o vídeo bruto, roda tools/reels/editar.py, sobe final.mp4 e poster.jpg no
// Vercel Blob com um CLIENT TOKEN curto (o token de leitura/escrita nunca sai do servidor) e devolve o resultado.
// Dependências: Node 20 (fetch nativo) e @vercel/blob. Nada é publicado no Instagram daqui: o vídeo vai para aprovação.
// Ambiente: APP_URL (ex.: https://agente-bastao-iel.vercel.app); CRON_SECRET é opcional (no GitHub Actions o worker usa o token OIDC do runner);
// PEXELS_API_KEY é opcional (sem ela o b-roll vem pelo app, que guarda a chave).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const EDITAR = path.join(__dirname, 'editar.py');
const MAX_JOBS = 3;
const TEMPO_MAX_EDICAO_MS = 24 * 60 * 1000; // o workflow tem 30 min; sobra margem para subir o arquivo

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

function urlRun() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null;
}

/** Mensagem de erro sem nenhum segredo (token, chave) que possa ter vazado para o texto. */
function limparErro(e) {
  const txt = String(e && e.stack ? e.stack : e).slice(0, 1500);
  return txt.replace(/vercel_blob_client_[A-Za-z0-9_-]+/g, '[token]').replace(/Bearer\s+\S+/g, 'Bearer [oculto]');
}

/** Caminhos no Blob dos arquivos do vídeo `id` (a rota exige o prefixo videos/<id>/). */
function pathnames(id) {
  return { final: `videos/${id}/final.mp4`, poster: `videos/${id}/poster.jpg` };
}

/** Corpo do POST resultado: o resultado.json do editar.py + as URLs do Blob. */
function montarResultado(resultadoJson, upFinal, upPoster, tamanhoFinal) {
  const { transcricao, avisos = [], tempos_s: tempos = {}, ...resto } = resultadoJson;
  return {
    resultado: {
      ...resto, url: upFinal.url, pathname: upFinal.pathname, poster_url: upPoster.url, poster_pathname: upPoster.pathname,
      tamanho: tamanhoFinal, editado_em: new Date().toISOString(), avisos, tempos_s: tempos,
    },
    transcricao,
  };
}

class Api {
  constructor(base, segredo) {
    this.base = base.replace(/\/+$/, '');
    this.segredo = segredo;
  }
  // Credencial: CRON_SECRET, se existir; senão um token OIDC novo do GitHub Actions (vale poucos minutos, por isso é pedido a cada chamada).
  async credencial() {
    if (this.segredo) return this.segredo;
    const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL; const tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !tok) throw new Error('Sem CRON_SECRET e sem OIDC do GitHub Actions (falta "permissions: id-token: write" no workflow).');
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}audience=agente-bastao-iel`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`OIDC do GitHub recusou (${r.status})`);
    return (await r.json()).value;
  }
  async chamar(metodo, rota, corpo) {
    const r = await fetch(`${this.base}${rota}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${await this.credencial()}`, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (r.status === 204) return null;
    const texto = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${rota} → HTTP ${r.status}: ${texto.slice(0, 300)}`);
    try { return texto ? JSON.parse(texto) : {}; } catch { throw new Error(`${metodo} ${rota} devolveu algo que não é JSON`); }
  }
  proximo() { return this.chamar('GET', '/api/videos/worker/proximo'); }
  // Sinal de fila no Blob (sem banco): devolve o texto do arquivo, ou null se ainda não existe ou não dá para ler.
  async sinal() {
    try {
      if (this.urlSinal === undefined) this.urlSinal = (await this.chamar('GET', '/api/videos/worker/sinal')).url || null;
      if (!this.urlSinal) return null;
      const r = await fetch(`${this.urlSinal}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      return r.ok ? (await r.text()).slice(0, 200) : null;
    } catch { return null; }
  }
  token(id, pathname, contentType) { return this.chamar('POST', '/api/videos/worker/token', { id, pathname, contentType }); }
  resultado(corpo) { return this.chamar('POST', '/api/videos/worker/resultado', corpo); }
  erro(corpo) { return this.chamar('POST', '/api/videos/worker/erro', corpo); }
}

async function baixar(url, destino) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download da origem falhou: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destino));
  return fs.statSync(destino).size;
}

/** Roda o editar.py mostrando o log dele; resolve com o conteúdo de resultado.json. */
function editar(entrada, saida, job, logJob) {
  return new Promise((resolve, reject) => {
    const args = [EDITAR, entrada, saida, '--estilo', job.estilo || 'hormozi', '--opcoes', JSON.stringify(job.opcoes || {})];
    const roteiro = path.join(saida, 'roteiro.txt');
    if (job.roteiro_texto && String(job.roteiro_texto).trim()) {
      fs.writeFileSync(roteiro, String(job.roteiro_texto));
      args.push('--roteiro', roteiro);
    }
    const p = spawn('python3', args, { cwd: RAIZ, env: { ...process.env, BROLL_URL: `${(process.env.APP_URL || '').replace(/\/+$/, '')}/api/videos/worker/pexels` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const resto = { stderr: '' };
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('editar.py passou do tempo máximo')); }, TEMPO_MAX_EDICAO_MS);
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => {
      const linhas = String(d).split('\n').filter(Boolean);
      for (const l of linhas) { console.log(`    ${l}`); if (/^\[editar\]/.test(l)) logJob(l.replace(/^\[editar\]\s*/, '')); }
      resto.stderr = (resto.stderr + d).slice(-4000);
    });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`editar.py saiu com código ${code}: ${resto.stderr.slice(-800)}`));
      const arq = path.join(saida, 'resultado.json');
      if (!fs.existsSync(arq)) return reject(new Error('editar.py terminou sem resultado.json'));
      resolve(JSON.parse(fs.readFileSync(arq, 'utf8')));
    });
  });
}

async function subir(api, id, arquivo, pathname, contentType) {
  const { put } = require('@vercel/blob/client');
  const { clientToken } = await api.token(id, pathname, contentType);
  if (!clientToken) throw new Error('o servidor não devolveu clientToken');
  const r = await put(pathname, fs.createReadStream(arquivo), { access: 'public', token: clientToken, contentType, multipart: true });
  return { url: r.url, pathname: r.pathname };
}

async function processar(api, job) {
  const id = job.id;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), `reel-${id}-`));
  const logs = [];
  const logJob = msg => logs.push({ em: new Date().toISOString(), msg: String(msg).slice(0, 300) });
  const t0 = Date.now();
  try {
    if (!job.origem || !job.origem.url) throw new Error('job sem origem.url');
    log(`job ${id}: estilo ${job.estilo || 'hormozi'}, opções ${JSON.stringify(job.opcoes || {})}`);
    logJob(`worker iniciou (${urlRun() || 'local'})`);
    const entrada = path.join(pasta, 'entrada' + (path.extname(new URL(job.origem.url).pathname) || '.mp4'));
    const bytes = await baixar(job.origem.url, entrada);
    log(`job ${id}: origem baixada (${(bytes / 1e6).toFixed(1)} MB)`);
    logJob(`origem baixada: ${(bytes / 1e6).toFixed(1)} MB`);

    const saida = path.join(pasta, 'saida');
    fs.mkdirSync(saida);
    const resultado = await editar(entrada, saida, job, logJob);
    log(`job ${id}: editado em ${((Date.now() - t0) / 1000).toFixed(0)} s (${resultado.duracao_s}s, ${resultado.cortes} cortes, ${resultado.palavras} palavras)`);

    const nomes = pathnames(id);
    const finalMp4 = path.join(saida, 'final.mp4');
    const upFinal = await subir(api, id, finalMp4, nomes.final, 'video/mp4');
    log(`job ${id}: final.mp4 enviado ao Blob`);
    const upPoster = await subir(api, id, path.join(saida, 'poster.jpg'), nomes.poster, 'image/jpeg');
    log(`job ${id}: poster.jpg enviado ao Blob`);
    logJob('arquivos enviados ao Blob');

    const corpo = montarResultado(resultado, upFinal, upPoster, fs.statSync(finalMp4).size);
    await api.resultado({ id, ...corpo, log: logs, run_url: urlRun() });
    log(`job ${id}: resultado registrado (${((Date.now() - t0) / 1000).toFixed(0)} s no total)`);
    return true;
  } catch (e) {
    const erro = limparErro(e);
    log(`job ${id}: ERRO ${erro.split('\n')[0]}`);
    logJob(`erro: ${erro.split('\n')[0]}`);
    try { await api.erro({ id, erro: erro.slice(0, 800), log: logs, run_url: urlRun() }); } catch (e2) { log(`job ${id}: não consegui registrar o erro: ${limparErro(e2).split('\n')[0]}`); }
    return false;
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

async function main() {
  const APP_URL = process.env.APP_URL;
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!APP_URL) { console.error('Falta APP_URL no ambiente.'); process.exit(1); }
  if (!CRON_SECRET && !process.env.ACTIONS_ID_TOKEN_REQUEST_URL) { console.error('Falta CRON_SECRET (ou OIDC do GitHub Actions).'); process.exit(1); }
  if (!process.env.PEXELS_API_KEY) log('b-roll: sem chave do Pexels aqui; o editor pede os clipes ao app');
  const api = new Api(APP_URL, CRON_SECRET);
  let feitos = 0, falhas = 0;
  // Modo plantão (GitHub Actions): fica consultando a fila a cada INTERVALO_S até WORKER_MINUTOS e pede para ser reiniciado
  // ao terminar (`recorrer=sim`), porque o agendamento do GitHub atrasa muito. Sem WORKER_MINUTOS: uma passada e sai.
  const plantao = Number(process.env.WORKER_MINUTOS || 0) > 0;
  const fim = Date.now() + Number(process.env.WORKER_MINUTOS || 0) * 60000;
  const INTERVALO_S = Number(process.env.WORKER_INTERVALO_S || 30);
  let errosSeguidos = 0; let i = 0;
  // Plantão sem tocar no banco: só consulta a fila (que acorda o Neon) quando o sinal no Blob mudou, depois de um vídeo, ou a cada
  // CHECAGEM_FILA_MIN minutos como rede de segurança. O Neon gratuito tem cota de tempo ligado: consultar a cada 30 s a esgotou.
  const CHECAGEM_FILA_MS = Number(process.env.WORKER_CHECAGEM_FILA_MIN || 20) * 60000;
  let visto = null; let forcar = true; let ultimaFila = 0;
  while (true) {
    if (!plantao && i >= MAX_JOBS) break;
    if (plantao && Date.now() >= fim) break;
    if (plantao && !forcar) {
      const s = await api.sinal();
      const mudou = s !== null && s !== visto;
      if (s !== null) visto = s;
      if (!mudou && Date.now() - ultimaFila < CHECAGEM_FILA_MS) { await new Promise((r) => setTimeout(r, INTERVALO_S * 1000)); continue; }
    }
    if (plantao && forcar) visto = await api.sinal();
    forcar = false;
    let job;
    try { job = await api.proximo(); errosSeguidos = 0; ultimaFila = Date.now(); }
    catch (e) {
      errosSeguidos++; log(`fila indisponível (${errosSeguidos}): ${limparErro(e).split('\n')[0].slice(0, 160)}`);
      if (!plantao || errosSeguidos >= 20) { log('desisto: o app não responde'); saida('recorrer', 'nao'); process.exit(1); }
      await new Promise((r) => setTimeout(r, 30000)); continue;
    }
    if (!job) {
      if (!plantao) { log(i === 0 ? 'fila vazia: nada para editar' : 'fila esvaziou'); break; }
      await new Promise((r) => setTimeout(r, INTERVALO_S * 1000)); continue;
    }
    i++; (await processar(api, job)) ? feitos++ : falhas++; forcar = true;
  }
  log(`fim${plantao ? ' do plantão' : ''}: ${feitos} editado(s), ${falhas} com erro`);
  if (plantao) saida('recorrer', 'sim');
  process.exit(falhas && !feitos && !plantao ? 1 : 0);
}

/** Saída do passo para o workflow (GITHUB_OUTPUT), usada para decidir se a execução se reinicia. */
function saida(nome, valor) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${nome}=${valor}\n`); }

if (require.main === module) {
  main().catch(e => { console.error(limparErro(e)); process.exit(1); });
}

module.exports = { pathnames, montarResultado, limparErro, Api };
