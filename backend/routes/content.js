// Mesa de trabalho: descoberta de pautas, leitura de fonte, afirmações,
// pesquisa, briefing, copy e arte. Cada rota é uma etapa curta (cabe nos 60 s
// da Vercel) e sem estado: o navegador guarda o trabalho e manda o que a
// etapa precisa. Nada aqui publica no Instagram.
const express = require('express');
const crypto = require('crypto');
const { limita, unica } = require('../lib/access');
const { armazem } = require('../lib/armazem');
const feeds = require('../lib/feeds');
const { pedirJson, dado, REGRAS_DADOS, hasLlmKey, comConsumo } = require('../lib/llmJson');
const Editorial = require('../../static/editorial');
const Pautas = require('../lib/pautas');
const Temas = require('../lib/temas');
const Estrategia = require('../lib/estrategia');

const router = express.Router();
const porMinuto = (max, nome) => limita({ max, janelaMs: 60000, nome });

const erroJson = (res, e, status) => {
  const code = e.code || (e.isUrlError ? 'URL' : 'ERRO');
  const http = status || (e.isUrlError ? 400 : e.code === 'SEM_IA' ? 503 : e.code === 'LIMITE' ? 429 : ['ENTRADA', 'IMAGEM', 'FONTE_ILEGIVEL', 'SEM_AFIRMACOES'].includes(e.code) ? 400 : 500);
  res.status(http).json({ error: e.message, code });
};

// ── A. Encontre uma pauta ───────────────────────────────────────────────────
// Notícias recentes dos feeds dos próprios veículos, agrupadas por
// acontecimento. A IA só ESCREVE a justificativa; os links, datas e veículos
// vêm do feed e não passam por ela.
router.post('/discover', porMinuto(6, 'descoberta'), async (req, res) => {
  try {
    res.json(await require('../lib/descoberta').descobrir({ pilares: req.body?.pilares, dias: req.body?.dias, recentes: req.body?.recentes }));
  } catch (e) {
    erroJson(res, e);
  }
});

// Estratégia de pautas editável (modo político, temas bloqueados, dias sem repetir).
router.get('/estrategia', async (req, res) => { try { res.json({ ...(await Estrategia.ler()), guardada: !!armazem()?.duravel }); } catch (e) { erroJson(res, e); } });
router.put('/estrategia', porMinuto(20, 'estrategia'), async (req, res) => { try { res.json(await Estrategia.salvar(req.body || {})); } catch (e) { erroJson(res, e, e.status); } });

// ── B. Quero falar sobre isso: fonte → afirmações → verificação → briefing → copy → arte ──
const research = require('../lib/research');
const redacao = require('../lib/redacao');
const connectors = require('../lib/connectors');
const arte = require('../lib/arte');

const exigeIA = () => {
  if (!hasLlmKey()) throw Object.assign(new Error('Nenhuma chave de IA configurada no servidor.'), { code: 'SEM_IA' });
};
const txt = (v, max) => String(v == null ? '' : v).slice(0, max);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
// Etapas sem estado: se o mesmo request_id chegar de novo (duplo clique, reenvio
// após queda de conexão), devolve o resultado da primeira chamada.
//
// Com armazenamento no servidor, o resultado também é gravado como tarefa:
// se a aba fechar no meio, o navegador recupera o resultado pelo request_id
// sem refazer (nem pagar) a pesquisa ou a redação. Sem armazenamento, só vale
// a proteção em memória desta instância.
const DURAVEIS = new Set(['claims', 'verify', 'briefing', 'copy', 'conferir', 'auditar', 'ganchos']);
const etapa = (nome, max, fn) => router.post(`/${nome}`, porMinuto(max, nome), async (req, res) => {
  try {
    const rid = req.body?.request_id ? `${nome}:${txt(req.body.request_id, 80)}` : null;
    const arm = DURAVEIS.has(nome) && rid ? armazem() : null;
    if (arm) {
      const j = await arm.jobs.obter(rid).catch(() => null);
      if (j?.estado === 'concluido') return res.json({ ...j.resultado, reaproveitado: true });
      if (j?.estado === 'rodando' && Date.now() - new Date(j.criado_em).getTime() < 75000) return res.status(202).json({ em_andamento: true, rid });
      await arm.jobs.iniciar(rid, nome, txt(req.body.conteudo_id, 80)).catch(() => {});
    }
    const corpo = await unica(rid, async () => {
      const { resultado, consumo } = await comConsumo(() => fn(req.body || {}));
      return { ...resultado, consumo: { etapa: nome, ...consumo } };
    }).catch(async (e) => { if (arm) await arm.jobs.falhar(rid, e.message).catch(() => {}); throw e; });
    if (arm) await arm.jobs.concluir(rid, corpo).catch(() => {});
    res.json(corpo);
  } catch (e) { if (!res.headersSent) erroJson(res, e); }
});

const fonteDoCorpo = (f) => {
  if (!f || typeof f !== 'object') throw Object.assign(new Error('Falta a fonte.'), { code: 'ENTRADA' });
  return { ...f, texto: txt(f.texto, 30000), titulo: txt(f.titulo, 300), veiculo: txt(f.veiculo, 120) };
};
const claimsDoCorpo = (c) => arr(c, 12).filter((x) => x && x.id && x.texto).map((x) => ({ ...x, texto: txt(x.texto, 500) }));
const evidsDoCorpo = (e) => arr(e, 80).filter((x) => x && x.id);

// "A Conta Aberta": prova com números reais informados pelo Pedro. Sem IA; as contas são feitas em código.
etapa('conta-aberta', 20, async (b) => {
  const Leads = require('../lib/leadMagnets');
  return require('../lib/contaAberta').criar(b.entrada && typeof b.entrada === 'object' ? b.entrada : {}, { iscas: await Leads.ler() });
});
router.get('/iscas', async (req, res) => { try { res.json({ iscas: await require('../lib/leadMagnets').ler(), dms: await require('../lib/leadMagnets').lerDms(), guardada: !!armazem()?.duravel }); } catch (e) { erroJson(res, e); } });
router.put('/iscas', porMinuto(20, 'iscas'), async (req, res) => { try { res.json(await require('../lib/leadMagnets').salvar(req.body?.iscas)); } catch (e) { erroJson(res, e, e.status); } });
router.post('/dms', porMinuto(30, 'dms'), async (req, res) => { try { res.json(await require('../lib/leadMagnets').registrarDms(req.body || {})); } catch (e) { erroJson(res, e, e.status); } });

// Mais ganchos para a capa: 10 candidatos filtrados pelo código (não copia, não inventa número).
etapa('ganchos', 6, async (b) => {
  exigeIA();
  const claims = claimsDoCorpo(b.claims).filter((c) => c.estado === 'sustentada');
  // Além do que o navegador mandou, usa os posts lidos do Instagram (aba Resultados): é o que o perfil realmente publicou.
  let doPerfil = [];
  try { const a = armazem(); if (a?.duravel) doPerfil = ((await a.config.obter(require('../lib/account').ACCOUNT.ig_id)).meu_instagram?.posts || []).slice(0, 20).map((p) => p.legenda).filter(Boolean); } catch { /* sem banco */ }
  return require('../lib/ganchos').gerarGanchos({ assunto: txt(b.assunto, 200), angulo: txt(b.angulo, 200), claims, recentes: [...arr(b.recentes, 8).map((r) => txt(r, 300)), ...doPerfil].slice(0, 24) });
});

etapa('ingest', 10, async (b) => {
  if (!b.url && !b.texto) throw Object.assign(new Error('Envie um link ou o texto.'), { code: 'ENTRADA' });
  const fonte = await research.lerFonte({ url: b.url ? txt(b.url, 2000) : undefined, texto: b.texto ? txt(b.texto, 60000) : undefined });
  return { fonte };
});

etapa('claims', 6, async (b) => {
  exigeIA();
  const r = await research.levantarAfirmacoes(fonteDoCorpo(b.fonte));
  return r;
});

etapa('verify', 12, async (b) => {
  exigeIA();
  const claim = claimsDoCorpo([b.claim])[0];
  if (!claim) throw Object.assign(new Error('Falta a afirmação.'), { code: 'ENTRADA' });
  return research.verificarAfirmacao(claim, fonteDoCorpo(b.fonte), evidsDoCorpo(b.evidencias), undefined, { links: arr(b.links, 3).map((u) => txt(u, 2000)) });
});

// Afirmação escrita ou corrigida pelo Pedro: confere no que já foi acessado.
etapa('conferir', 12, async (b) => {
  exigeIA();
  const claim = claimsDoCorpo([b.claim])[0];
  if (!claim) throw Object.assign(new Error('Falta a afirmação.'), { code: 'ENTRADA' });
  return research.conferirAfirmacao({ claim, fonte: fonteDoCorpo(b.fonte), evidencias: evidsDoCorpo(b.evidencias) });
});

etapa('briefing', 8, async (b) => {
  exigeIA();
  return redacao.gerarBriefing({
    fonte: fonteDoCorpo(b.fonte), claims: claimsDoCorpo(b.claims), evidencias: evidsDoCorpo(b.evidencias),
    recentes: arr(b.recentes, 10).map((r) => txt(r, 140)), objetivo: txt(b.objetivo, 40), formato: txt(b.formato, 40), voz: txt(b.voz, 1500),
  });
});

etapa('copy', 6, async (b) => {
  exigeIA();
  if (!b.briefing || typeof b.briefing !== 'object') throw Object.assign(new Error('Falta o briefing.'), { code: 'ENTRADA' });
  return redacao.gerarCopia({
    briefing: b.briefing, fonte: fonteDoCorpo(b.fonte), claims: claimsDoCorpo(b.claims), evidencias: evidsDoCorpo(b.evidencias),
    recentes: arr(b.recentes, 10).map((r) => txt(r, 140)), formato: b.formato === 'estatico' ? 'estatico' : 'carrossel', instrucoes: txt(b.instrucoes, 600), voz: txt(b.voz, 1500),
  });
});

// Opiniões: separa premissas factuais e liga às afirmações conferidas.
etapa('auditar', 12, async (b) => {
  exigeIA();
  return redacao.auditarOpinioes({ slides: arr(b.slides, 12).map((x) => ({ id: txt(x?.id, 20), titulo: txt(x?.titulo, 120), texto: txt(x?.texto, 900) })), claims: claimsDoCorpo(b.claims) });
});

// Cálculo de correção pelo IPCA com fórmula e entradas guardadas.
etapa('calculo-ipca', 20, async (b) => {
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1e12) throw Object.assign(new Error('Valor inválido.'), { code: 'ENTRADA' });
  if (!/^\d{4}-\d{2}$/.test(String(b.de)) || !/^\d{4}-\d{2}$/.test(String(b.ate))) throw Object.assign(new Error('Informe os meses no formato AAAA-MM.'), { code: 'ENTRADA' });
  return connectors.corrigirPorIpca({ valor, de: b.de, ate: b.ate });
});

// ── Arte: um slide por chamada (PNG em base64 + métricas reais) ──────────────
const decodificaImagem = async (dataUrl, nome) => {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw Object.assign(new Error(`${nome}: use PNG, JPG ou WebP.`), { code: 'IMAGEM' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw Object.assign(new Error(`${nome}: arquivo maior que 8 MB.`), { code: 'IMAGEM' });
  const sharp = require('sharp');
  const meta = await sharp(buf, { limitInputPixels: 40e6 }).metadata().catch(() => null);
  if (!meta || !['png', 'jpeg', 'webp'].includes(meta.format)) throw Object.assign(new Error(`${nome}: o arquivo não é uma imagem válida.`), { code: 'IMAGEM' });
  return buf;
};

etapa('render-slide', 40, async (b) => {
  const s = b.slide;
  if (!s || typeof s !== 'object') throw Object.assign(new Error('Falta o slide.'), { code: 'ENTRADA' });
  // Sem corte silencioso: o texto inteiro vai para a arte (teto alto só contra abuso) e, se não couber, a arte marca cabe:false e a revisão bloqueia.
  const slide = { ...s, texto: txt(s.texto, 6000), titulo: s.titulo ? txt(s.titulo, 200) : null, rotulo: s.rotulo ? txt(s.rotulo, 40) : null };
  const imagem = await decodificaImagem(b.imagem, 'Imagem do slide');
  const arquivoEncerramento = await decodificaImagem(b.encerramento, 'Arquivo de encerramento');
  const r = await arte.renderizarSlide(slide, { indice: Number(b.indice) || 1, total: Number(b.total) || 1, imagem, arquivoEncerramento });
  return { png: `data:image/png;base64,${r.png.toString('base64')}`, metrics: r.metrics };
});


module.exports = router;
module.exports._util = { erroJson, porMinuto, unica };
