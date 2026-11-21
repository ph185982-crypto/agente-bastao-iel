// Dois formatos de carrossel de topo de funil (audiência geral), sem passar pela pesquisa de fatos:
//
//  1. "dialogo" (diálogo ilustrado): UMA cena repetida em todas as telas; só os balões mudam. O personagem A diz o
//     pensamento padrão, o B mostra a estratégia escondida por trás. Última tela: fechamento + "Comenta PALAVRA".
//  2. "papel_de_parede": capa + uma frase curta por tela sobre uma foto bonita, com assinatura pequena. Feito para salvar.
//
// O mecanismo vem de carrosséis que funcionaram muito bem para outros perfis; a arte e o texto são sempre do Pedro.
// Cada função cria o conteúdo, desenha as telas, guarda tudo no armazém e o carrossel aparece em "Carrosséis para
// validar" como qualquer outro (e, aprovado, publica pelo fluxo de sempre: o publicador redesenha cada tela a partir
// da versão aprovada com arte.renderizarSlide).
//
// Uso pela fábrica (sem rota):  const F = require('./formatosCarrossel');
//   await F.criarDialogo({ cena, personagens, falas, fechamento });   await F.criarPapelDeParede({ capa, frases, fundo });
// Tudo é injetável em { deps } (armazem, arte, gerarCena, buscarFoto, carregar, fotoPedro, iscas, sharp).
const M = require('../../static/contentModel');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const D = require('./arteDialogo');

const conta = () => ACCOUNT.ig_id;
const falha = (message, status = 400, code = 'ENTRADA') => Object.assign(new Error(message), { status, code });
const linha = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const palavraChave = (s) => semAcento(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const LIMITE = { fala: 140, personagem: 28, descricao: 300, fechamento: 160, frase: 140, capa: 90, titulo: 120, legenda: 2000 };
const PEXELS_PADRAO = 'calm nature landscape';

function texto(v, max, nome, { obrigatorio = true } = {}) {
  const t = linha(v, max);
  if (!t) { if (obrigatorio) throw falha(`Falta ${nome}.`); return ''; }
  if (t.length > max) throw falha(`${nome[0].toUpperCase()}${nome.slice(1)} passa de ${max} caracteres. Encurte: no celular, menos é mais.`);
  return t;
}
function ancora(p, padrao, nome) {
  if (p == null) return { ...padrao };
  const x = Number(p.x); const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 4 || x > 96 || y < 30 || y > 96) throw falha(`A posição do ${nome} precisa de x entre 4 e 96 e y entre 30 e 96 (em % da tela).`);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}
function hashtags(v) {
  return (Array.isArray(v) ? v : []).map((h) => `#${String(h || '').replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2).slice(0, 3);
}

// ── Validação (puras) ─────────────────────────────────────────────────────────
function validarDialogo(e = {}) {
  const cena = e.cena || {};
  const personagens = { a: texto(e.personagens?.a ?? 'Quem compra', LIMITE.personagem, 'o nome do personagem A'), b: texto(e.personagens?.b ?? 'Quem entende o jogo', LIMITE.personagem, 'o nome do personagem B') };
  if (!Array.isArray(e.falas) || e.falas.length < 3 || e.falas.length > 6) throw falha('Envie de 3 a 6 pares de falas ({a, b}).');
  const falas = e.falas.map((f, i) => ({ a: texto(f?.a, LIMITE.fala, `a fala do personagem A na tela ${i + 1}`), b: texto(f?.b, LIMITE.fala, `a fala do personagem B na tela ${i + 1}`) }));
  const fech = e.fechamento || {};
  const fechamento = { texto: texto(fech.texto, LIMITE.fechamento, 'a frase de fechamento'), cta: texto(fech.cta, LIMITE.fechamento, 'a chamada', { obrigatorio: false }), palavra_chave: fech.palavra_chave ? palavraChave(fech.palavra_chave) : '' };
  if (fech.palavra_chave && fechamento.palavra_chave.length < 3) throw falha('A palavra-chave precisa de pelo menos 3 letras.');
  const ancoras = { a: ancora(e.ancoras?.a ?? cena.ancoras?.a, D.ANCORA_PADRAO.a, 'personagem A'), b: ancora(e.ancoras?.b ?? cena.ancoras?.b, D.ANCORA_PADRAO.b, 'personagem B') };
  const descricao = texto(cena.descricao, LIMITE.descricao, 'a descrição da cena');
  return {
    titulo: texto(e.titulo, LIMITE.titulo, 'o título', { obrigatorio: false }) || `Diálogo: ${personagens.a} × ${personagens.b}`,
    cena: { descricao, imagem: cena.imagem || null },
    personagens, falas, fechamento, ancoras,
    legenda: texto(e.legenda, LIMITE.legenda, 'a legenda', { obrigatorio: false }),
    hashtags: hashtags(e.hashtags),
  };
}

function validarPapel(e = {}) {
  if (!Array.isArray(e.frases) || e.frases.length < 3 || e.frases.length > 8) throw falha('Envie de 3 a 8 frases curtas.');
  const frases = e.frases.map((f, i) => texto(f, LIMITE.frase, `a frase ${i + 1}`));
  let fundo = { tipo: 'pexels', consulta: PEXELS_PADRAO };
  if (e.fundo != null && e.fundo !== '') {
    const f = String(e.fundo).trim();
    if (/^pexels:/i.test(f)) fundo = { tipo: 'pexels', consulta: f.slice(7).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || PEXELS_PADRAO };
    else if (/^https:\/\/\S+$/i.test(f)) fundo = { tipo: 'url', url: f.slice(0, 2000) };
    else if (f === 'gradiente') fundo = { tipo: 'gradiente' };
    else throw falha('O fundo precisa ser "pexels:assunto", um link https de imagem ou "gradiente".');
  }
  const capa = texto(e.capa ?? 'Coloca esses de papel de parede', LIMITE.capa, 'a capa');
  return { titulo: texto(e.titulo, LIMITE.titulo, 'o título', { obrigatorio: false }) || `Papel de parede: ${capa}`, capa, frases, fundo, foto_pedro: e.foto_pedro !== false, legenda: texto(e.legenda, LIMITE.legenda, 'a legenda', { obrigatorio: false }), hashtags: hashtags(e.hashtags) };
}

// ── Imagens ──────────────────────────────────────────────────────────────────
// Aceita Buffer, data URL (PNG/JPG/WebP) ou link https (lido pelo safeFetch, que barra rede interna).
async function carregarImagem(entrada, deps = {}) {
  const sharp = deps.sharp || require('sharp');
  let buf; let origem;
  if (Buffer.isBuffer(entrada)) { buf = entrada; origem = 'Imagem enviada pelo Pedro'; }
  else if (typeof entrada === 'string' && entrada.startsWith('data:')) {
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(entrada);
    if (!m) throw falha('A imagem precisa ser PNG, JPG ou WebP.');
    buf = Buffer.from(m[2], 'base64'); origem = 'Imagem enviada pelo Pedro';
  } else if (typeof entrada === 'string' && /^https:\/\/\S+$/i.test(entrada)) {
    const carregar = deps.carregar || require('./safeFetch').safeFetch;
    let r;
    try { r = await carregar(entrada, { maxBytes: 8 * 1024 * 1024, timeoutMs: 12000, tipos: [/^image\//], binario: true, accept: 'image/jpeg,image/png,image/webp' }); } catch (e) { throw falha(`Não consegui baixar a imagem: ${e.message}`); }
    if (r.status !== 200 || !r.corpo) throw falha('Não consegui baixar a imagem (o endereço não devolveu uma imagem).');
    buf = Buffer.from(r.corpo); origem = r.url_final || entrada;
  } else throw falha('A imagem precisa ser um link https ou um arquivo PNG, JPG ou WebP.');
  if (buf.length > 8 * 1024 * 1024) throw falha('A imagem passa de 8 MB.');
  const meta = await sharp(buf, { limitInputPixels: 40e6 }).metadata().catch(() => null);
  if (!meta || !['png', 'jpeg', 'webp'].includes(meta.format)) throw falha('O arquivo não é uma imagem válida (PNG, JPG ou WebP).');
  if (Math.min(meta.width || 0, meta.height || 0) < 500) throw falha('A imagem é pequena demais (mínimo de 500 px no menor lado).');
  const dados = await sharp(buf, { limitInputPixels: 40e6 }).rotate().resize(1080, 1350, { fit: 'cover', position: 'centre' }).jpeg({ quality: 90 }).toBuffer();
  return { dados, origem };
}

// ── Montagem das telas (puras: a fábrica pode usar sem rota) ──────────────────
const paletaDe = (s) => [...String(s || '')].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % D.PALETAS.length;

function montarSlidesDialogo(e, { imagem_id = null, cta = '' } = {}) {
  const dados = { personagens: e.personagens, ancoras: e.ancoras, paleta: paletaDe(e.cena.descricao) };
  const slides = e.falas.map((f, i) => ({ id: `s${i + 1}`, funcao: i === 0 ? 'capa' : 'explicacao', layout: 'dialogo', tema_visual: 'dialogo', titulo: null, texto: `${f.a}\n${f.b}`, imagem_id, dados, claim_ids: [] }));
  const fecho = [e.fechamento.texto, cta].filter(Boolean).join('\n');
  slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'dialogo_fecho', tema_visual: 'dialogo', titulo: null, texto: fecho, imagem_id, dados: { ...dados, ...(e.fechamento.palavra_chave ? { palavra_chave: e.fechamento.palavra_chave } : {}) }, claim_ids: [] });
  return slides;
}

function montarSlidesPapel(e, { capa_imagem_id = null, imagens = [] } = {}) {
  const slides = [{ id: 's1', funcao: 'capa', layout: 'papel_capa', tema_visual: 'papel_de_parede', titulo: null, texto: e.capa, imagem_id: capa_imagem_id, dados: { paleta: 0 }, claim_ids: [] }];
  e.frases.forEach((f, i) => slides.push({ id: `s${i + 2}`, funcao: 'explicacao', layout: 'papel_frase', tema_visual: 'papel_de_parede', titulo: null, texto: f, imagem_id: imagens[i] || null, dados: { paleta: i + 1 }, claim_ids: [] }));
  return slides;
}

// Chamada final com a palavra-chave. Se a palavra é de uma isca (lead magnet) com link, usa a chamada da isca;
// se não, só "Comenta PALAVRA." quando o texto ainda não pede isso. A DM automática NÃO existe: responder é manual.
async function chamadaDaPalavra(fechamento, deps = {}) {
  const p = fechamento.palavra_chave;
  if (!p) return { cta: fechamento.cta || '', isca: null };
  let iscas = [];
  try { iscas = await (deps.iscas ? deps.iscas() : require('./leadMagnets').ler()); } catch { /* sem iscas: segue sem */ }
  const isca = (iscas || []).find((x) => x.palavra === p) || null;
  const jaPede = new RegExp(`\\b${p}\\b`, 'i').test(semAcento(`${fechamento.texto} ${fechamento.cta}`));
  if (fechamento.cta || jaPede) return { cta: fechamento.cta || '', isca };
  if (isca?.link) return { cta: require('./leadMagnets').chamada(isca).cta, isca };
  return { cta: `Comenta ${p}.`, isca };
}

// ── Gravação comum: versão, telas desenhadas e prévias ─────────────────────────
async function salvarCarrossel(a, c, { slides, legenda, cta, hashtags: tags, rotulo, origem, deps }) {
  const arte = deps.arte || require('./arte');
  const sharp = deps.sharp || require('sharp');
  const versao = M.criarVersao(c, { slides, legenda, legenda_claim_ids: [], cta, hashtags: tags }, { quem: 'sistema', rotulo });
  c.arte = { ...(c.arte || {}), renders: [] };
  const avisos = [];
  for (const [i, s] of versao.slides.entries()) {
    const img = s.imagem_id ? (await a.arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados : null;
    const r = await arte.renderizarSlide(s, { indice: i + 1, total: versao.slides.length, imagem: img ? Buffer.from(img) : null });
    const key = `render:${c.id}:${versao.id}:${s.id}:${M.hashRender(s)}`;
    const previa = await sharp(r.png).flatten({ background: '#18191D' }).jpeg({ quality: 86 }).toBuffer().catch(() => null);
    await a.arquivos.salvar(conta(), key, previa || r.png, previa ? 'image/jpeg' : 'image/png');
    c.arte.renders.push({ slide_id: s.id, versao: versao.id, texto_hash: M.hashRender(s), blob_key: key, indice: i + 1, total: versao.slides.length, metrics: r.metrics, elementos: r.metrics.elementos || [], gerada_em: new Date().toISOString() });
    if (r.metrics.cabe === false) avisos.push(`Tela ${i + 1}: ${(r.metrics.problemas || [])[0] || 'o texto não cabe'}.`);
  }
  c.status = 'em_revisao';
  c.studio = { estado: 'pronto', concluido_em: new Date().toISOString(), origem };
  await a.conteudos.salvar(conta(), c.id, c, 0);
  return { versao, avisos };
}

function exigirBanco(deps) {
  const a = deps.armazem || armazem();
  if (!a?.duravel) throw falha('Criar este carrossel precisa do banco de dados no servidor.', 503, 'SEM_BANCO');
  return a;
}

// ── Diálogo ilustrado ─────────────────────────────────────────────────────────
async function criarDialogo(entrada, { deps = {} } = {}) {
  const e = validarDialogo(entrada);
  const a = exigirBanco(deps);
  const c = M.novoConteudo({ titulo: e.titulo, formato: 'carrossel', origem: { tipo: 'formato', formato: 'dialogo' } });
  c.formato_visual = 'dialogo';
  const avisos = [];
  // 1) A cena: imagem enviada > ilustração por IA (se ligada) > cena desenhada pelo código.
  let imagem_id = null; let cena = { fonte: 'codigo', descricao: e.cena.descricao };
  if (e.cena.imagem) {
    const img = await carregarImagem(e.cena.imagem, deps);
    imagem_id = `cena_${c.id}`;
    await a.arquivos.salvar(conta(), `img:${imagem_id}`, img.dados, 'image/jpeg');
    c.imagens.push({ id: imagem_id, tipo: 'ilustracao_enviada', origem: img.origem, exige_credito: false, descricao: 'Cena do diálogo (enviada)' });
    cena = { ...cena, fonte: 'enviada', origem: img.origem };
  } else {
    const r = await (deps.gerarCena || require('./cenaIA').gerar)(c, { descricao: e.cena.descricao, ancoras: e.ancoras }, { armazem: a, ...(deps.cena || {}) });
    if (r?.buffer) {
      const sharp = deps.sharp || require('sharp');
      const dados = await sharp(r.buffer).resize(1080, 1350, { fit: 'cover', position: 'centre' }).jpeg({ quality: 90 }).toBuffer();
      imagem_id = `cena_${c.id}`;
      await a.arquivos.salvar(conta(), `img:${imagem_id}`, dados, 'image/jpeg');
      c.imagens.push({ id: imagem_id, tipo: 'ilustracao_ia', ia: true, origem: `Ilustração gerada por IA (${r.modelo || 'OpenAI'}); ilustra a ideia, não é registro real`, exige_credito: false, descricao: 'Cena do diálogo (ilustração por IA)' });
      cena = { ...cena, fonte: 'ia', modelo: r.modelo || null, custo_usd: r.custo_usd || 0, tentativas: r.tentativas || 0 };
    } else {
      if (r?.aviso) avisos.push(r.aviso);
      cena = { ...cena, ...(r?.aviso ? { aviso: r.aviso } : {}), ...(r?.custo_usd ? { custo_usd: r.custo_usd } : {}) };
    }
  }
  // 2) Chamada final e legenda.
  const { cta, isca } = await chamadaDaPalavra(e.fechamento, deps);
  const slides = montarSlidesDialogo(e, { imagem_id, cta });
  const legenda = (e.legenda || [`${e.personagens.a} × ${e.personagens.b}.`, e.fechamento.texto, cta].filter(Boolean).join('\n\n')).slice(0, LIMITE.legenda);
  c.dialogo = {
    cena, personagens: e.personagens, ancoras: e.ancoras,
    palavra_chave: e.fechamento.palavra_chave ? { palavra: e.fechamento.palavra_chave, isca_id: isca?.id || null, dm_automatica: false, aviso: 'Quem comentar a palavra recebe a DM à mão: a resposta automática por palavra-chave ainda não existe.' } : null,
  };
  M.registrar(c, 'sistema', 'carrossel_dialogo', `Diálogo ilustrado criado (${e.falas.length} telas de fala + fechamento; cena: ${{ codigo: 'desenhada pelo código', ia: 'ilustração por IA', enviada: 'imagem enviada' }[cena.fonte]}).`);
  const { versao, avisos: av } = await salvarCarrossel(a, c, { slides, legenda, cta, hashtags: e.hashtags, rotulo: 'carrossel diálogo ilustrado', origem: 'dialogo', deps });
  return { id: c.id, titulo: c.titulo, formato: 'dialogo', slides: versao.slides.length, cena: { fonte: cena.fonte, ...(cena.aviso ? { aviso: cena.aviso } : {}), ...(cena.custo_usd ? { custo_usd: cena.custo_usd } : {}) }, avisos: [...avisos, ...av] };
}

// ── Papel de parede ───────────────────────────────────────────────────────────
async function criarPapelDeParede(entrada, { deps = {} } = {}) {
  const e = validarPapel(entrada);
  const a = exigirBanco(deps);
  const c = M.novoConteudo({ titulo: e.titulo, formato: 'carrossel', origem: { tipo: 'formato', formato: 'papel_de_parede' } });
  c.formato_visual = 'papel_de_parede';
  const avisos = []; const creditos = []; const ids = [];
  const guardar = async (id, dados, registro) => { await a.arquivos.salvar(conta(), `img:${id}`, dados, 'image/jpeg'); c.imagens.push({ id, ...registro }); return id; };
  // 1) Capa: a foto do Pedro (rodízio das fotos que ele enviou), quando houver; senão, capa tipográfica.
  let capa_imagem_id = null;
  if (e.foto_pedro) {
    try {
      const f = await (deps.fotoPedro || require('./fotosPedro').proxima)();
      if (f?.dados) {
        const sharp = deps.sharp || require('sharp');
        const dados = await sharp(f.dados).rotate().resize(1080, 1350, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer();
        capa_imagem_id = await guardar(`pc_${c.id}`, dados, { tipo: f.meta?.tipo || 'foto_pedro', origem: f.meta?.origem || 'Acervo do Pedro', licenca: f.meta?.licenca || null, exige_credito: false });
      }
    } catch { /* sem foto: capa tipográfica */ }
  }
  // 2) Fundos das frases.
  const fundo = { ...e.fundo };
  if (e.fundo.tipo === 'url') {
    try {
      const img = await carregarImagem(e.fundo.url, deps);
      const id = await guardar(`pf_${c.id}`, img.dados, { tipo: 'ilustrativa', origem: img.origem, exige_credito: false, descricao: 'Fundo enviado por link' });
      e.frases.forEach(() => ids.push(id));
    } catch (err) { avisos.push(`${err.message} As telas saíram com fundo em degradê.`); fundo.tipo = 'gradiente'; }
  } else if (e.fundo.tipo === 'pexels') {
    const temChave = deps.pexelsKey !== undefined ? !!deps.pexelsKey : !!process.env.PEXELS_API_KEY;
    if (!temChave) { avisos.push('Sem PEXELS_API_KEY no servidor: as telas saíram com fundo em degradê.'); fundo.tipo = 'gradiente'; }
    else {
      const buscar = deps.buscarFoto || require('./fotosStudio').buscarFoto;
      const usadas = []; const achadas = [];
      for (let i = 0; i < e.frases.length; i++) {
        try {
          const f = await buscar(e.fundo.consulta, { excluir: usadas.map((x) => x.meta.id), ...(deps.fetcher ? { fetcher: deps.fetcher } : {}), ...(deps.carregar ? { carregar: deps.carregar } : {}) });
          usadas.push(f);
          const { id: foto_id, ...registro } = f.meta;
          const id = await guardar(`pf_${c.id}_${i}`, f.dados, { ...registro, foto_id, exige_credito: false });
          achadas.push(id); ids.push(id);
          creditos.push({ foto_id: f.meta.id, autor: f.meta.autor || null, pagina: f.meta.origem, licenca: f.meta.licenca, licenca_url: f.meta.licenca_url || null });
        } catch (err) {
          // acabaram as fotos da busca (ou a busca falhou): repete as que já vieram; sem nenhuma, degradê
          if (achadas.length) ids.push(achadas[i % achadas.length]);
          else { ids.push(null); if (!avisos.some((x) => /busca de fotos/.test(x))) avisos.push(`A busca de fotos falhou (${String(err.message).slice(0, 80)}); as telas sem foto saíram com fundo em degradê.`); }
        }
      }
      if (!achadas.length) fundo.tipo = 'gradiente';
    }
  }
  const slides = montarSlidesPapel(e, { capa_imagem_id, imagens: ids });
  const autores = [...new Set(creditos.map((x) => x.autor).filter(Boolean))];
  const legenda = (e.legenda || ['Salva e escolhe o seu papel de parede. Qual deles vai para a sua tela hoje?', autores.length ? `Fotos: ${autores.join(', ')} (Pexels).` : ''].filter(Boolean).join('\n\n')).slice(0, LIMITE.legenda);
  c.papel_de_parede = { fundo, creditos };
  M.registrar(c, 'sistema', 'carrossel_papel_de_parede', `Papel de parede criado (${e.frases.length} frases; fundo: ${fundo.tipo === 'gradiente' ? 'degradê feito pelo código' : fundo.tipo === 'url' ? 'imagem por link' : 'fotos do Pexels'}).`);
  const { versao, avisos: av } = await salvarCarrossel(a, c, { slides, legenda, cta: '', hashtags: e.hashtags, rotulo: 'carrossel papel de parede', origem: 'papel_de_parede', deps });
  return { id: c.id, titulo: c.titulo, formato: 'papel_de_parede', slides: versao.slides.length, fundo: fundo.tipo, creditos, avisos: [...avisos, ...av] };
}


// ── Frase (post de 1 imagem) ───────────────────────────────────────────────────
// Frase famosa (pedido do Pedro, 21/11): fundo preto ou branco, letra grande, palavra-chave em laranja, texto em F, o autor
// e o Pedro Destrava embaixo (arteFrase.js). A frase vem como está na fonte, com a palavra-chave marcada em **…**.
function validarFrase(e = {}) {
  const frase = texto(e.frase, 170, 'a frase');
  if (!/\*\*[^*]+\*\*/.test(frase)) throw falha('Marque a palavra-chave da frase com **asteriscos**.');
  return { frase, autor: texto(e.autor, 60, 'o autor'), fonte: /^https:\/\/\S+$/.test(String(e.fonte || '')) ? String(e.fonte).slice(0, 300) : null, fundo: e.fundo === 'branco' ? 'branco' : 'preto', titulo: texto(e.titulo, LIMITE.titulo, 'o título', { obrigatorio: false }) || `Frase: ${e.autor || ''}`.slice(0, LIMITE.titulo), legenda: texto(e.legenda, LIMITE.legenda, 'a legenda', { obrigatorio: false }), hashtags: hashtags(e.hashtags) };
}

async function criarFrase(entrada, { deps = {}, origem = 'frase' } = {}) {
  const e = validarFrase(entrada);
  const a = exigirBanco(deps);
  const c = M.novoConteudo({ titulo: e.titulo, formato: 'carrossel', origem: { tipo: 'formato', formato: 'frase' } });
  c.formato_visual = 'frase';
  const limpa = e.frase.replace(/\*\*/g, '');
  const slides = [{ id: 's1', funcao: 'capa', layout: 'frase_classica', tema_visual: 'frase', titulo: null, texto: e.frase, imagem_id: null, dados: { fundo: e.fundo, autor: e.autor }, claim_ids: [] }];
  const legenda = (e.legenda || [`“${limpa}” — ${e.autor}`, 'Salva e manda pra quem precisa ler isso hoje. Se fez sentido, reposta nos seus stories.'].join('\n\n')).slice(0, LIMITE.legenda);
  c.frase = { texto: limpa, autor: e.autor, fonte: e.fonte, fundo: e.fundo };
  // A legenda cita a frase entre aspas: a fonte (Wikiquote, seção Verificadas) entra como fonte principal para o portão de
  // citação conferir que o texto é exatamente o da fonte (sem isso o post ficava travado em "Preparar automaticamente").
  c.fonte_principal = { tipo: 'texto', titulo: `Citação de ${e.autor} (Wikiquote, citações verificadas)`, url: e.fonte, veiculo: 'Wikiquote', origem: e.fonte, texto: limpa };
  M.registrar(c, 'sistema', 'post_frase', `Frase de ${e.autor} (fundo ${e.fundo}).`);
  const { versao, avisos } = await salvarCarrossel(a, c, { slides, legenda, cta: '', hashtags: e.hashtags, rotulo: 'post frase', origem, deps });
  return { id: c.id, titulo: c.titulo, formato: 'frase', slides: versao.slides.length, fundo: e.fundo, avisos };
}

module.exports = { criarFrase, validarFrase, criarDialogo, criarPapelDeParede, validarDialogo, validarPapel, montarSlidesDialogo, montarSlidesPapel, chamadaDaPalavra, carregarImagem, LIMITE, PEXELS_PADRAO };
