// Um vídeo pronto vira carrossel: as mesmas ideias, em páginas de texto no nosso formato (fundo preto, @ embaixo), com a
// mesma legenda do vídeo. Sem IA e sem custo: as páginas saem da transcrição (já conferida com o roteiro). Só acontece
// quando o Pedro toca no botão do vídeo; o carrossel entra em "Para aprovar" como qualquer outro (e, aprovado, vai para o
// Instagram e para o LinkedIn pelo fluxo de sempre).
const M = require('../../../static/contentModel');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');

const conta = () => ACCOUNT.ig_id;
const falha = (message, status = 400, code = 'CARROSSEL') => Object.assign(new Error(message), { status, code });
const MAX_PAGINAS = 8;       // capa + até 6 de conteúdo + chamada final
const PALAVRAS_PAGINA = 34;  // cabe no celular sem apertar (os portões pedem até 38)
const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
// chamada falada no fim ("salva esse vídeo…") não vira página de conteúdo: a última página já chama para seguir
const CHAMADA = /\b(salva|salve|comenta|comente|compartilha|manda (esse|este)|me segue|siga)\b/i;

// Frases (texto) → páginas: capa com o título, páginas de conteúdo (1ª frase em negrito) e a chamada final.
function paginasDoVideo({ titulo, frases }) {
  const fr = (frases || []).map((f) => String(f || '').replace(/\s+/g, ' ').trim()).filter((f) => palavras(f).length >= 3 && !CHAMADA.test(f));
  const corpo = []; let atual = [];
  for (const f of fr) {
    const n = atual.reduce((s, x) => s + palavras(x).length, 0);
    if (atual.length && n + palavras(f).length > PALAVRAS_PAGINA) { corpo.push(atual); atual = []; }
    atual.push(f);
  }
  if (atual.length) corpo.push(atual);
  const paginas = [[{ texto: String(titulo || fr[0] || '').trim(), negrito: true }]];
  for (const pg of corpo.slice(0, MAX_PAGINAS - 2)) paginas.push(pg.map((t, i) => ({ texto: t, negrito: i === 0 })));
  paginas.push([{ texto: `Siga ${ACCOUNT.handle}`, negrito: true }, { texto: 'para mais conteúdos como este.', negrito: false }]);
  return paginas;
}

async function carrosselDoVideo(id, { deps = {} } = {}) {
  const a = deps.armazem || armazem();
  if (!a?.duravel) throw falha('O carrossel precisa do banco de dados no servidor.', 503, 'SEM_BANCO');
  const reg = await a.conteudos.obter(conta(), String(id || '').slice(0, 80));
  const v = reg?.doc;
  if (!v?.video) throw falha('Vídeo não encontrado.', 404, 'NAO_ENCONTRADO');
  if (v.video.estado !== 'pronto') throw falha('O vídeo ainda não está pronto.', 409, 'NAO_PRONTO');
  // um carrossel por vídeo: tocar de novo devolve o mesmo
  if (v.video.carrossel_id) {
    const ja = await a.conteudos.obter(conta(), v.video.carrossel_id);
    if (ja?.doc && ja.doc.status !== 'arquivado') return { id: ja.doc.id, titulo: ja.doc.titulo, ja_existia: true };
  }
  const frases = (v.video.transcricao?.frases || []).map((f) => f.texto);
  if (palavras(frases.join(' ')).length < 15) throw falha('O vídeo tem pouca fala para virar carrossel.', 422, 'POUCO_TEXTO');
  // capa: o gancho do plano visual (curto e forte) quando existe; senão o título do vídeo
  const paginas = paginasDoVideo({ titulo: v.video.plano?.gancho || v.titulo, frases });
  const TT = deps.trocaTexto || require('../reciclagem/trocaTexto');
  const arte = deps.arte || require('../arte');
  const sharp = deps.sharp || require('sharp');

  const c = M.novoConteudo({ titulo: `Carrossel: ${String(v.titulo || 'vídeo').slice(0, 120)}`, formato: 'carrossel', origem: { tipo: 'video', video_id: v.id } });
  const slides = [];
  c.imagens = [];
  for (const [i, pg] of paginas.entries()) {
    const pid = `vc_${c.id}_${i}`;
    await a.arquivos.salvar(conta(), `img:${pid}`, await TT.paginaTexto(pg, { assinatura: ACCOUNT.handle, fundo: 'preto', ...(i === 0 ? { tamanhoMax: 120 } : {}) }), 'image/jpeg');
    c.imagens.push({ id: pid, tipo: 'tipografica', origem: `vídeo ${v.id}`, exige_credito: false });
    slides.push({ id: `s${i + 1}`, funcao: i === 0 ? 'capa' : i === paginas.length - 1 ? 'cta' : 'explicacao', layout: 'foto_inteira', tema_visual: 'foto', titulo: null, texto: '', imagem_id: pid, claim_ids: [] });
  }
  const leg = v.video.legenda_ig || {};
  const legenda = [leg.texto, `Siga ${ACCOUNT.handle} para mais conteúdos como este.`].filter(Boolean).join('\n\n').slice(0, 2200);
  const versao = M.criarVersao(c, { slides, legenda, legenda_claim_ids: [], cta: '', hashtags: leg.hashtags || [] }, { quem: 'sistema', rotulo: 'carrossel do vídeo' });
  c.arte = { renders: [] };
  for (const [i, s] of versao.slides.entries()) {
    const img = (await a.arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados;
    const r = await arte.renderizarSlide(s, { indice: i + 1, total: versao.slides.length, imagem: img ? Buffer.from(img) : null });
    const key = `render:${c.id}:${versao.id}:${s.id}:${M.hashRender(s)}`;
    const previa = await sharp(r.png).flatten({ background: '#0B0B0C' }).jpeg({ quality: 86 }).toBuffer().catch(() => null);
    await a.arquivos.salvar(conta(), key, previa || r.png, previa ? 'image/jpeg' : 'image/png');
    c.arte.renders.push({ slide_id: s.id, versao: versao.id, texto_hash: M.hashRender(s), blob_key: key, indice: i + 1, metrics: r.metrics });
  }
  c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: new Date().toISOString(), origem: 'video' };
  M.registrar(c, 'sistema', 'carrossel_do_video', `Carrossel feito a partir do vídeo "${v.titulo || v.id}" (mesmas ideias, sem IA).`);
  await a.conteudos.salvar(conta(), c.id, c, 0);
  try { v.video.carrossel_id = c.id; v.updated_at = new Date().toISOString(); await a.conteudos.salvar(conta(), v.id, v, reg.rev); } catch { /* conflito: o carrossel já existe; o vínculo é só para não repetir */ }
  return { id: c.id, titulo: c.titulo, paginas: paginas.length };
}

module.exports = { paginasDoVideo, carrosselDoVideo, MAX_PAGINAS, PALAVRAS_PAGINA };
