// Gera o carrossel completo de uma oportunidade, em etapas que gravam o progresso (retomável):
//   copy → imagens → render (8 PNGs 1080×1350) → pacote (legenda, ficha de fontes, ZIP).
// O carrossel NUNCA é publicado por aqui: ele fica "aguardando_aprovacao" na fila do Radar.
const sharp = require('sharp');
const crypto = require('crypto');
const store = require('./store');
const Copy = require('./copy');
const Arte = require('./arte');
const Imagens = require('./imagens');
const Pacote = require('./pacote');
const C = require('./config');
const U = require('./util');

const idDe = (opId, versao) => `cr_${opId.replace(/^op_/, '')}_v${versao}`;
const chaveSlide = (id, n) => `carrossel:${id}:slide-${String(n).padStart(2, '0')}.png`;
const chaveZip = (id) => `carrossel:${id}:pacote.zip`;

async function carregarOp(opId) { const r = await store.obter('oportunidade', opId); if (!r) throw U.erro('Oportunidade não encontrada.', 'NAO_ENCONTRADA', 404); return r.doc; }

function exigirVerificada(op, { permitirBaixa = false } = {}) {
  const v = op.verificacao;
  if (!v || v.estado !== 'verificada') throw U.erro('Esta oportunidade ainda não foi verificada (fonte oficial ou duas fontes independentes). Sem isso o carrossel não é gerado.', 'NAO_VERIFICADA', 422);
  if (!(v.numeros_usaveis || []).length) throw U.erro('Não há número confirmado para a tela de prova. Sem número verificado o carrossel não é gerado.', 'SEM_PROVA', 422);
  if (!permitirBaixa && (op.pontuacao ?? 0) < C.LIMIAR_CARROSSEL) throw U.erro(`A pontuação é ${op.pontuacao}, abaixo de ${C.LIMIAR_CARROSSEL}. Use “Gerar carrossel” mesmo assim para abrir uma exceção.`, 'ABAIXO_DO_LIMIAR', 422);
}

async function fotosDoCarrossel(op, deps) {
  const imagens = []; const fotos = {}; const avisos = [];
  let achada = null;
  if (op.imagem?.arquivo) { const a = await store.arquivoObter(op.imagem.arquivo); if (a) achada = { buf: a.dados, imagem: op.imagem }; }
  if (!achada) { const b = await Imagens.buscar(op, { papel: 'negocio', deps }); if (b.ok) { const reg = await Imagens.guardar(store, op.id, b); achada = { buf: b.buf, imagem: reg }; } else avisos.push(`Sem fotografia real do negócio: ${b.motivo}`); }
  if (achada) {
    const telas = [];
    for (const n of [1, 3]) { const r = Imagens.relacionada(achada.imagem, op, { slide: n }); if (r.ok) telas.push(n); else avisos.push(`Tela ${n} sem foto: ${r.motivo}`); }
    if (telas.length) {
      const f = { buf: achada.buf, tipo: achada.imagem.tipo, credito: achada.imagem.tipo === 'banco_de_imagens' ? 'Imagem ilustrativa' : `Foto: ${achada.imagem.origem?.dominio || 'site oficial'}` };
      if (telas.includes(1)) fotos.negocio = f;
      if (telas.includes(3)) fotos.produto = f;
      imagens.push({ telas, tipo: achada.imagem.tipo, descricao: achada.imagem.descricao, origem: achada.imagem.origem, licenca: achada.imagem.licenca, credito: achada.imagem.credito, arquivo: achada.imagem.arquivo });
    }
  }
  return { imagens, fotos, avisos };
}

// opId → carrossel pronto para a fila. `versao` > 1 é uma nova geração (a anterior continua guardada).
async function gerar(opId, { deps = {}, versao = null, permitirBaixa = false, origem = 'manual', agora = Date.now(), reiniciar = false } = {}) {
  const op = await carregarOp(opId);
  exigirVerificada(op, { permitirBaixa });
  let v = versao || ((op.carrosseis || []).length + 1);
  let existente = await store.obter('carrossel', idDe(opId, v));
  // Versão que esgotou as tentativas de copy: com "nova versão" o carrossel recomeça do zero na versão seguinte.
  while (reiniciar && existente && existente.doc.estado === 'erro' && (existente.doc.copia_tentativas || 0) >= 9) { await store.salvar('carrossel', existente.doc.id, { ...existente.doc, estado: 'substituido' }, existente.rev).catch(() => {}); v += 1; existente = await store.obter('carrossel', idDe(opId, v)); }
  const id = idDe(opId, v);
  if (existente?.doc.estado === 'aguardando_aprovacao' || existente?.doc.estado === 'aprovado' || existente?.doc.estado === 'publicado') return existente.doc;   // retomada: já está pronto
  let doc = existente?.doc || { id, op_id: opId, versao: v, origem, criado_em: new Date(agora).toISOString(), estado: 'gerando', etapa: 'copy', historico: [], excecao_limiar: permitirBaixa && (op.pontuacao ?? 0) < C.LIMIAR_CARROSSEL };
  let rev = existente ? existente.rev : 0;
  const salvar = async () => { doc.atualizado_em = new Date().toISOString(); const r = await store.salvar('carrossel', id, doc, rev); rev = r.rev; };
  await salvar();
  if (v > 1) { const antes = await store.obter('carrossel', idDe(opId, v - 1)); if (antes && antes.doc.estado === 'erro') await store.salvar('carrossel', antes.doc.id, { ...antes.doc, estado: 'substituido' }, antes.rev).catch(() => {}); }
  try {
    // 1) copy
    if (!doc.copia) {
      // A IA gratuita às vezes erra a contagem de palavras: o que ela errou e quantas tentativas já foram ficam gravados, e uma nova chamada continua dali.
      if ((doc.copia_tentativas || 0) >= 9) throw U.erro(`A copy não passou nas regras depois de ${doc.copia_tentativas} tentativas: ${(doc.feedback_copia || '').split('\n').slice(0, 3).join('; ')}`, 'COPY_INVALIDA', 422, { erros: (doc.feedback_copia || '').split('\n- ') });
      const aoFalhar = async (info) => { doc.copia_tentativas = (doc.copia_tentativas || 0) + 1; doc.feedback_copia = info.feedback; await salvar(); };
      const c = await Copy.gerarCopia(op, { deps: { ...deps, aoFalhar }, feedback: doc.feedback_copia || '' });
      doc.copia = { slides: c.slides, legenda: c.legenda, hashtags: c.hashtags, partes_legenda: c.partes_legenda, tentativas: c.tentativas, llm: c.llm };
      doc.etapa = 'imagens'; await salvar();
    }
    // 2) imagens
    if (!doc.imagens_prontas) {
      const f = await fotosDoCarrossel(op, deps);
      doc.imagens = f.imagens; doc.avisos = f.avisos; doc.imagens_prontas = true; doc.etapa = 'render'; await salvar();
    }
    // 3) render (se uma tela não cabe, a copy é refeita uma vez com o motivo)
    const fotos = {};
    for (const im of doc.imagens || []) { const a = await store.arquivoObter(im.arquivo); if (a) { const f = { buf: a.dados, tipo: im.tipo, credito: im.tipo === 'banco_de_imagens' ? 'Imagem ilustrativa' : `Foto: ${im.origem?.dominio || 'site oficial'}` }; if (im.telas.includes(1)) fotos.negocio = f; if (im.telas.includes(3)) fotos.produto = f; } }
    let telas = await Arte.renderizarCarrossel(doc.copia.slides, { nome: op.nome, pais: op.pais, categoria: op.categoria, fotos });
    let naoCabem = telas.map((t, i) => (t.metrics.cabe ? null : `Tela ${i + 1} não cabe na arte (${t.metrics.problemas.join('; ')}): encurte o texto`)).filter(Boolean);
    if (naoCabem.length) {
      doc.historico.push({ em: new Date().toISOString(), evento: 'texto_nao_coube', detalhe: naoCabem });
      const c = await Copy.gerarCopia(op, { deps, feedback: naoCabem.join('\n- ') });
      doc.copia = { slides: c.slides, legenda: c.legenda, hashtags: c.hashtags, partes_legenda: c.partes_legenda, tentativas: c.tentativas, llm: c.llm };
      telas = await Arte.renderizarCarrossel(doc.copia.slides, { nome: op.nome, pais: op.pais, categoria: op.categoria, fotos });
      naoCabem = telas.map((t, i) => (t.metrics.cabe ? null : `Tela ${i + 1}: ${t.metrics.problemas.join('; ')}`)).filter(Boolean);
      if (naoCabem.length) throw U.erro(`O texto não cabe na arte: ${naoCabem.join(' | ')}`, 'TEXTO_NAO_CABE', 422);
    }
    for (let i = 0; i < telas.length; i++) {
      const meta = await sharp(telas[i].png).metadata();
      if (meta.width !== 1080 || meta.height !== 1350) throw U.erro(`A tela ${i + 1} saiu com ${meta.width}×${meta.height} (esperado 1080×1350).`, 'DIMENSAO', 500);
      await store.arquivoSalvar(chaveSlide(id, i + 1), telas[i].png, 'image/png');
    }
    doc.render = telas.map((t, i) => ({ n: i + 1, arquivo: chaveSlide(id, i + 1), sha256: crypto.createHash('sha256').update(t.png).digest('hex'), bytes: t.png.length, metricas: t.metrics }));
    doc.etapa = 'pacote'; await salvar();
    // 4) pacote
    const legenda = doc.copia.legenda;
    const ficha = Pacote.fichaDeFontes(op, doc);
    const arquivos = [
      ...telas.map((t, i) => ({ nome: `slide-${String(i + 1).padStart(2, '0')}.png`, dados: t.png })),
      { nome: 'legenda.txt', dados: legenda }, { nome: 'ficha-de-fontes.md', dados: ficha.markdown },
      { nome: 'ficha-de-fontes.json', dados: JSON.stringify(ficha.json, null, 2) }, { nome: 'imagens-origem.json', dados: JSON.stringify(doc.imagens || [], null, 2) },
      { nome: 'LEIA-ME.txt', dados: `Carrossel “${op.nome}” — série ${C.SERIE}\n8 imagens 1080×1350. Nada foi publicado automaticamente.\nConfira a ficha de fontes e os direitos das imagens antes de postar. Tela 7 é hipótese, não promessa.\n` },
    ];
    const zip = Pacote.montarZip(arquivos);
    if (Pacote.lerZip(zip).length !== arquivos.length) throw U.erro('O ZIP gerado não passou na conferência.', 'ZIP', 500);
    await store.arquivoSalvar(chaveZip(id), zip, 'application/zip');
    doc.pacote = { arquivo: chaveZip(id), bytes: zip.length, arquivos: arquivos.map((a) => a.nome), nome_download: `${Pacote.nomeArquivo(op.nome)}-${U.diaBRT(agora)}.zip` };
    doc.ficha_markdown = ficha.markdown;
    doc.estado = 'aguardando_aprovacao'; doc.etapa = 'pronto'; doc.pronto_em = new Date().toISOString();
    doc.versoes = [{ v, em: doc.pronto_em, hash: crypto.createHash('sha256').update(doc.render.map((r) => r.sha256).join('')).digest('hex').slice(0, 16), legenda }];
    await salvar();
    await store.atualizar('oportunidade', opId, (o) => { o.carrossel_id = id; o.carrosseis = [...new Set([...(o.carrosseis || []), id])]; o.status = 'carrossel_gerado'; (o.decisoes ||= []).push({ em: doc.pronto_em, acao: 'carrossel_gerado', por: origem, carrossel_id: id }); return o; });
    return doc;
  } catch (e) {
    doc.estado = 'erro'; doc.erro = { mensagem: U.limita(e.message, 300), codigo: e.code || null, erros: e.erros || null, em: new Date().toISOString() }; doc.etapa = doc.etapa || 'copy';
    try { await salvar(); } catch { /* banco indisponível: o chamador recebe o erro original */ }
    throw e;
  }
}

module.exports = { gerar, exigirVerificada, fotosDoCarrossel, idDe, chaveSlide, chaveZip };
