// Mesa de trabalho: descoberta de pautas, leitura de fonte, afirmações,
// pesquisa, briefing, copy e arte. Cada rota é uma etapa curta (cabe nos 60 s
// da Vercel) e sem estado: o navegador guarda o trabalho e manda o que a
// etapa precisa. Nada aqui publica no Instagram.
const express = require('express');
const crypto = require('crypto');
const { limita, unica } = require('../lib/access');
const feeds = require('../lib/feeds');
const { pedirJson, dado, REGRAS_DADOS, hasLlmKey, comConsumo } = require('../lib/llmJson');
const Editorial = require('../../static/editorial');

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
    const pilares = (Array.isArray(req.body?.pilares) && req.body.pilares.length ? req.body.pilares : Editorial.PILARES_PADRAO)
      .slice(0, 8).map((p) => ({ id: String(p.id || p.nome).slice(0, 40), nome: String(p.nome || '').slice(0, 80), palavras: (p.palavras || []).map(String).slice(0, 30) }));
    const dias = Math.min(7, Math.max(1, Number(req.body?.dias) || 3));
    const recentes = (req.body?.recentes || []).map((r) => String(r).slice(0, 140)).slice(0, 10);

    const lidos = await feeds.lerTodos();
    const candidatos = [];
    const vistos = new Set();
    for (const p of pilares) {
      // Páginas de áudio/vídeo do Senado não têm texto para ler: ficam de fora.
      const achados = feeds.filtrar(lidos.itens, { palavras: p.palavras, dias, minimo: 2 }).filter((x) => !/^\s*(Áudio|Vídeo|Foto|Fotos)\s*:/i.test(x.titulo));
      for (const g of feeds.agruparEventos(achados.slice(0, 40)).slice(0, 3)) {
        if (vistos.has(g.principal.url)) continue;
        vistos.add(g.principal.url);
        candidatos.push({ pilar_id: p.id, pilar: p.nome, grupo: g });
      }
    }
    const lista = candidatos.slice(0, 14).map((c, i) => ({
      id: `p_${crypto.createHash('sha1').update(c.grupo.principal.url).digest('hex').slice(0, 8)}`,
      i, pilar_id: c.pilar_id, pilar: c.pilar,
      titulo: c.grupo.principal.titulo,
      resumo: c.grupo.principal.resumo,
      veiculos: c.grupo.veiculos,
      fontes: c.grupo.itens.slice(0, 4).map((x) => ({ titulo: x.titulo, url: x.url, origem: x.origem, publicada_em: x.publicada_em, tipo_fonte: x.tipo_fonte })),
      publicada_em: c.grupo.principal.publicada_em,
    }));

    let ia = { usada: false, erro: null };
    if (lista.length && hasLlmKey()) {
      try {
        const entrada = dado('NOTICIAS', JSON.stringify(lista.map((p) => ({ i: p.i, pilar: p.pilar, titulo: p.titulo, resumo: p.resumo, veiculos: p.veiculos }))), 14000);
        const rec = dado('POSTS_RECENTES_DO_PERFIL', recentes.join('\n'), 2000);
        const { dados, llm } = await pedirJson({
          temperatura: 0.4,
          maxTokens: 3500,
          sistema: `${Editorial.VOZ}\n\n${REGRAS_DADOS}`,
          usuario: `Abaixo, notícias recentes (só título, resumo e veículos). Para cada uma escreva, SEM afirmar nenhum fato que não esteja no título/resumo:
- ligacao_com_perfil: "forte", "media" ou "fraca" (seja honesto: se a conexão com política, economia, empreendedorismo ou o bolso de quem lê é forçada, é "fraca");
- por_que_interessa: 1 frase ligando o assunto ao perfil e à vida prática de quem lê, só com o que o título/resumo permite concluir (sem especular efeitos);
- angulo: uma tese possível OU uma pergunta central, em 1 frase (se o assunto não sustenta posição, proponha explicar o que mudou);
- objetivo_sugerido: "alcance", "autoridade" ou "conversao";
- formato_sugerido: "carrossel", "estatico", "reels" ou "stories";
- risco: "alto" se envolve acusação a pessoa, crime, saúde ou eleição; senão "baixo";
- limitacoes: o que precisa ser confirmado antes de publicar;
- repete_recente: true se o tema é o mesmo de algum post recente listado.
Não dê pontuação. Se a ligação for fraca ou a notícia não render post, omita o item.

${entrada.bloco}
${rec.bloco}

Responda APENAS JSON: {"itens":[{"i":0,"ligacao_com_perfil":"forte","por_que_interessa":"","angulo":"","objetivo_sugerido":"","formato_sugerido":"","risco":"","limitacoes":"","repete_recente":false}]}`,
        });
        const porI = new Map((dados.itens || []).filter((x) => Number.isInteger(x.i)).map((x) => [x.i, x]));
        lista.forEach((p) => {
          const a = porI.get(p.i);
          if (!a) { p.sem_anotacao = true; return; }
          p.ligacao = ['forte', 'media'].includes(a.ligacao_com_perfil) ? a.ligacao_com_perfil : 'fraca';
          p.por_que_interessa = String(a.por_que_interessa || '').slice(0, 280);
          p.angulo = String(a.angulo || '').slice(0, 280);
          p.objetivo_sugerido = Editorial.OBJETIVOS[a.objetivo_sugerido] ? a.objetivo_sugerido : null;
          p.formato_sugerido = Editorial.FORMATOS[a.formato_sugerido] ? a.formato_sugerido : null;
          p.risco = a.risco === 'alto' ? 'alto' : 'baixo';
          p.limitacoes = String(a.limitacoes || '').slice(0, 280);
          p.repete_recente = !!a.repete_recente;
        });
        ia = { usada: true, ...llm };
      } catch (e) {
        ia = { usada: false, erro: e.message };
      }
    }

    res.json({
      gerado_em: new Date().toISOString(),
      janela_dias: dias,
      pautas: lista.filter((p) => !(ia.usada && (p.sem_anotacao || p.ligacao === 'fraca'))).map(({ i, ...p }) => p),
      ia,
      feeds: lidos.status,
      aviso: 'Notícias dos feeds dos próprios veículos, dos últimos dias. Não é uma busca completa nem um ranking de tendências.',
    });
  } catch (e) {
    erroJson(res, e);
  }
});

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
const etapa = (nome, max, fn) => router.post(`/${nome}`, porMinuto(max, nome), async (req, res) => {
  try {
    const rid = req.body?.request_id ? `${nome}:${txt(req.body.request_id, 80)}` : null;
    res.json(await unica(rid, async () => {
      const { resultado, consumo } = await comConsumo(() => fn(req.body || {}));
      return { ...resultado, consumo: { etapa: nome, ...consumo } };
    }));
  } catch (e) { if (!res.headersSent) erroJson(res, e); }
});

const fonteDoCorpo = (f) => {
  if (!f || typeof f !== 'object') throw Object.assign(new Error('Falta a fonte.'), { code: 'ENTRADA' });
  return { ...f, texto: txt(f.texto, 30000), titulo: txt(f.titulo, 300), veiculo: txt(f.veiculo, 120) };
};
const claimsDoCorpo = (c) => arr(c, 12).filter((x) => x && x.id && x.texto).map((x) => ({ ...x, texto: txt(x.texto, 500) }));
const evidsDoCorpo = (e) => arr(e, 80).filter((x) => x && x.id);

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
  return research.verificarAfirmacao(claim, fonteDoCorpo(b.fonte), evidsDoCorpo(b.evidencias));
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
    recentes: arr(b.recentes, 10).map((r) => txt(r, 140)), objetivo: txt(b.objetivo, 40), formato: txt(b.formato, 40),
  });
});

etapa('copy', 6, async (b) => {
  exigeIA();
  if (!b.briefing || typeof b.briefing !== 'object') throw Object.assign(new Error('Falta o briefing.'), { code: 'ENTRADA' });
  return redacao.gerarCopia({
    briefing: b.briefing, fonte: fonteDoCorpo(b.fonte), claims: claimsDoCorpo(b.claims), evidencias: evidsDoCorpo(b.evidencias),
    recentes: arr(b.recentes, 10).map((r) => txt(r, 140)), formato: b.formato === 'estatico' ? 'estatico' : 'carrossel', instrucoes: txt(b.instrucoes, 600),
  });
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
  const slide = { ...s, texto: txt(s.texto, 900), titulo: s.titulo ? txt(s.titulo, 200) : null, rotulo: s.rotulo ? txt(s.rotulo, 40) : null };
  const imagem = await decodificaImagem(b.imagem, 'Imagem do slide');
  const arquivoEncerramento = await decodificaImagem(b.encerramento, 'Arquivo de encerramento');
  const r = await arte.renderizarSlide(slide, { indice: Number(b.indice) || 1, total: Number(b.total) || 1, imagem, arquivoEncerramento });
  return { png: `data:image/png;base64,${r.png.toString('base64')}`, metrics: r.metrics };
});


module.exports = router;
module.exports._util = { erroJson, porMinuto, unica };
