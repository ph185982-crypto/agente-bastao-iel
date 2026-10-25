// Carrossel da série "Negócios que você não viu": do negócio verificado até o ZIP, e a edição tela a tela.
// O documento guarda CAMADAS, não só PNG: copy de cada tela, composição, imagem escolhida (com origem), capas, ficha da história,
// legenda e versões. Cada PNG é derivado desse estado de forma determinística (mesma entrada, mesmo arquivo). Editar uma tela
// re-renderiza só as telas cujo conteúdo mudou (a numeração do rodapé conta como conteúdo).
// O carrossel NUNCA é publicado por aqui: fica "aguardando_aprovacao" na fila do Radar.
const sharp = require('sharp');
const crypto = require('crypto');
const store = require('./store');
const Serie = require('./serie');
const Historia = require('./historia');
const Fotos = require('./fotos');
const Arte = require('./arte2');
const Pacote = require('./pacote');
const Copy = require('./copy');
const C = require('./config');
const U = require('./util');

const idDe = (opId, versao) => `cr_${opId.replace(/^op_/, '')}_v${versao}`;
const chaveSlide = (id, n) => `carrossel:${id}:slide-${String(n).padStart(2, '0')}.png`;
const chaveZip = (id) => `carrossel:${id}:pacote.zip`;
const sha1 = (x) => crypto.createHash('sha1').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function carregarOp(opId) { const r = await store.obter('oportunidade', opId); if (!r) throw U.erro('Oportunidade não encontrada.', 'NAO_ENCONTRADA', 404); return r.doc; }
function exigirVerificada(op, { permitirBaixa = false } = {}) {
  const v = op.verificacao;
  if (!v || v.estado !== 'verificada') throw U.erro('Esta história ainda não foi verificada (fonte oficial ou duas fontes independentes). Sem isso o carrossel não é gerado.', 'NAO_VERIFICADA', 422);
  if (!(v.numeros_usaveis || []).length) throw U.erro('Não há número confirmado para a tela de evidência. Sem número verificado o carrossel não é gerado.', 'SEM_PROVA', 422);
  if (!permitirBaixa && op.origem !== 'manual' && (op.pontuacao ?? 0) < C.LIMIAR_CARROSSEL) throw U.erro(`A pontuação é ${op.pontuacao}, abaixo de ${C.LIMIAR_CARROSSEL}. Use “Gerar carrossel” mesmo assim para abrir uma exceção.`, 'ABAIXO_DO_LIMIAR', 422);
}

// ── Imagens ────────────────────────────────────────────────────────────────────
// Escolha automática (o Pedro troca no editor). O código não "enxerga" a foto: usa a descrição e o nome do arquivo para saber se ela mostra
// produto, o local, um app ou uma pessoa, e só então encaixa na função da tela. Retrato de pessoa só entra na tela de estratégia (onde a
// história é sobre quem toca o negócio). Foto ilustrativa (que não é da empresa) só entra em tensão e lição. Cada imagem aparece no máximo
// duas vezes; sem imagem adequada a tela fica sem foto e avisa, em vez de pegar uma qualquer.
const TAGS = { pessoa: /\b(founder|ceo|portrait|retrato|speaker|interview|fundador|fundadora|team|equipe)\b/i, produto: /(bag|sacola|surprise|food|bread|p[aã]o|croissant|packag|product|produto|pastry|meal|pizza|fruit|vegetable)/i, local: /(store|shop|loja|restaurant|bakery|padaria|collection point|window|caf[eé]|market|mercado|station|camp|farm|fazenda|tent)/i, app: /(\bapp\b|screenshot|screen|\btela\b|phone|smartphone|iphone|android)/i };
const classificar = (im) => { const t = `${String(im.descricao || '').slice(0, 140)} ${im.origem?.arquivo || ''}`; return Object.keys(TAGS).filter((k) => TAGS[k].test(t)); };
const PREFERE = { descoberta: ['produto', 'local', 'app'], revelacao: ['local', 'produto', 'app'], dinheiro: ['app', 'local', 'produto'], evidencia: ['produto', 'local', 'app'], estrategia: ['pessoa', 'local', 'produto'], tensao: ['produto', 'local'], licao: ['local', 'produto'] };
function atribuirImagens(telas, imagens) {
  const uso = {};
  telas.forEach((t) => {
    if (t.layout === 'encerramento_pedro' || t.foto?.imagem_id || t.foto?.manual) return;
    const pref = PREFERE[t.funcao] || ['produto', 'local'];
    const ilustra = ['tensao', 'licao'].includes(t.funcao);
    let cand = imagens.filter((i) => (uso[i.id] || 0) < 2 && (['evidencia', 'dinheiro'].includes(t.funcao) ? ['foto', 'print', 'documento'].includes(i.papel) : i.papel === 'foto' || (i.papel === 'ilustracao')));
    cand = cand.filter((i) => ilustra || i.relacao === 'negocio');
    const nota = (i) => {
      const tags = classificar(i); let r = tags.length ? Math.min(...tags.map((k) => (pref.includes(k) ? pref.indexOf(k) : (k === 'pessoa' ? 99 : 5)))) : 6;
      if (['evidencia', 'dinheiro'].includes(t.funcao) && ['print', 'documento'].includes(i.papel)) r = t.funcao === 'evidencia' ? -2 : -1;
      if (ilustra && i.relacao === 'ilustrativa') r -= 1;
      return r + 10 * (uso[i.id] || 0);
    };
    const ordem = cand.map((i) => ({ i, n: nota(i) })).filter((x) => x.n < 90).sort((a, b) => a.n - b.n);
    const im = ordem[0]?.i || null; if (im) uso[im.id] = (uso[im.id] || 0) + 1;
    t.foto = { enq: 'auto', forma: im && ['print', 'documento'].includes(im.papel) ? 'print' : (t.foto?.forma || null), imagem_id: im ? im.id : null };
  });
}
async function bufferesDaTela(doc, tela) {
  const id = tela.foto?.imagem_id; if (!id) return null; const im = (doc.imagens || []).find((x) => x.id === id); if (!im) return null;
  const a = await store.arquivoObter(im.arquivo); return a ? { buf: a.dados, credito: im.credito || null, tipo: im.tipo, papel: im.papel, id } : null;
}
const claimsDoc = (op) => Serie.claimsPorId(op);

// ── Render incremental ─────────────────────────────────────────────────────────
// Renderiza só as telas cuja entrada mudou. Devolve a lista `render` completa (a mesma ordem das telas).
async function renderizar(doc, op) {
  const n = doc.telas.length; const claims = claimsDoc(op); const anterior = doc.render || []; const novo = []; const imagens = {};
  for (let i = 0; i < n; i++) {
    const t = doc.telas[i];
    const im = await bufferesDaTela(doc, t); if (im) imagens[im.id] = im;
    const ent = { t: { layout: t.layout, variante: t.variante || null, estilo: t.estilo || null, textos: t.textos, foto: { ...t.foto, manual: undefined } }, n: i + 1, total: n, im: im ? sha256(im.buf) : null, credito: im?.credito || null, claim: claims[t.textos?.claim_id] ? { v: claims[t.textos.claim_id].valor_exibicao, a: claims[t.textos.claim_id].atribuicao, u: claims[t.textos.claim_id].veiculo, d: claims[t.textos.claim_id].data_publicacao || claims[t.textos.claim_id].consultado_em } : null, v: 3 };
    const h = sha1(ent); const antes = anterior.find((r) => r.tela_id === t.id && r.entrada_hash === h);
    const arquivo = chaveSlide(doc.id, i + 1);
    if (antes && antes.n === i + 1) { novo.push(antes); continue; }
    if (antes) { const a = await store.arquivoObter(antes.arquivo); if (a) { await store.arquivoSalvar(arquivo, a.dados, 'image/png'); novo.push({ ...antes, n: i + 1, arquivo }); continue; } }
    const r = await Arte.renderizarTela(t, { n: i + 1, total: n, imagens, claims });
    const meta = await sharp(r.png).metadata();
    if (meta.width !== 1080 || meta.height !== 1350) throw U.erro(`A tela ${i + 1} saiu com ${meta.width}×${meta.height} (esperado 1080×1350).`, 'DIMENSAO', 500);
    await store.arquivoSalvar(arquivo, r.png, 'image/png');
    novo.push({ n: i + 1, tela_id: t.id, arquivo, sha256: sha256(r.png), bytes: r.png.length, metricas: r.metrics, entrada_hash: h });
  }
  return novo;
}

// ── Pacote ─────────────────────────────────────────────────────────────────────
function fichaDaSerie(op, doc) {
  const base = Pacote.fichaDeFontes(op, { ...doc, imagens: [] });
  const f = doc.ficha || {}; const L = [];
  L.push('', '## Pesquisa da história', '', `- Empresa: ${f.empresa || op.nome}${f.pais ? ` (${f.pais})` : ''}${f.site_oficial ? ` · ${f.site_oficial}` : ''}`, `- Problema que resolve: ${f.problema || '—'}`, `- Quem compra e por quê: ${[f.quem_compra, f.por_que_compra].filter(Boolean).join(' — ') || '—'}`, `- Como cobra: ${f.como_cobra || '—'}`, `- O que surpreende: ${f.surpresa || '—'}`);
  (f.evidencia || []).forEach((e) => L.push(`- Evidência ${e.claim_id}: ${e.valor || ''} ${e.afirmacao}${e.atribuicao ? ` (${e.atribuicao})` : ''} — ${e.veiculo}, ${e.url}`));
  (f.dificuldades || []).forEach((d) => L.push(`- Dificuldade: ${d.texto || d}${d.url ? ` — ${d.veiculo}, ${d.url}${d.fonte_unica ? ' (fonte única: a tela atribui ao veículo)' : ''}` : ''}`));
  L.push(`- Para um teste no Brasil (hipótese, não afirmação sobre o mercado): ${f.inspiracao_brasil || '—'}`);
  (f.lacunas || []).forEach((d) => L.push(`- LACUNA: ${d}`));
  L.push('', '## Imagens usadas', '');
  const usadas = (doc.telas || []).map((t, i) => ({ t, i })).filter((x) => x.t.foto?.imagem_id);
  if (!usadas.length) L.push('Nenhuma fotografia foi usada.');
  (doc.imagens || []).forEach((im) => { const telas = usadas.filter((x) => x.t.foto.imagem_id === im.id).map((x) => x.i + 1); if (!telas.length) return; L.push(`- Telas ${telas.join(', ')}: ${im.descricao} · ${im.relacao === 'ilustrativa' ? 'ILUSTRATIVA (não é da empresa) · ' : ''}origem: ${im.origem?.url_imagem || im.origem?.declaracao || '—'}${im.origem?.url_pagina ? ` (página ${im.origem.url_pagina})` : ''} · consultada em ${Pacote.dataBR(im.origem?.consultado_em)} · licença/permissão: ${im.licenca} · permissão ${im.permissao === 'confirmada' ? 'confirmada' : 'A CONFIRMAR antes de postar'}`); });
  L.push('', '## Validação', '', ...(doc.validacao?.bloqueios?.length ? doc.validacao.bloqueios.map((b) => `- BLOQUEIO: ${b.mensagem}`) : ['- Nenhum bloqueio.']), ...(doc.validacao?.sugestoes || []).map((s) => `- Sugestão: ${s.mensagem}`));
  return { markdown: `${base.markdown}${L.join('\n')}\n`, json: { ...base.json, historia: f, imagens: (doc.imagens || []).map(({ id, tipo, papel, relacao, descricao, origem, licenca, credito, permissao }) => ({ id, tipo, papel, relacao, descricao, origem, licenca, credito, permissao })), validacao: doc.validacao } };
}

// Lê os PNGs guardados, confere dimensão, integridade e que são os da versão atual; devolve o ZIP.
async function montarPacote(doc, op, { agora = Date.now() } = {}) {
  const arquivos = [];
  for (let i = 0; i < doc.render.length; i++) {
    const r = doc.render[i]; const a = await store.arquivoObter(r.arquivo);
    if (!a) throw U.erro(`O arquivo da tela ${i + 1} não foi encontrado.`, 'ARQUIVO', 500);
    if (sha256(a.dados) !== r.sha256) throw U.erro(`A tela ${i + 1} guardada não é a versão aprovada (conferência de integridade falhou).`, 'VERSAO_DIFERENTE', 409);
    let meta; try { meta = await sharp(a.dados).metadata(); } catch { throw U.erro(`O arquivo da tela ${i + 1} está corrompido.`, 'ARQUIVO_CORROMPIDO', 500); }
    if (meta.format !== 'png' || meta.width !== 1080 || meta.height !== 1350) throw U.erro(`A tela ${i + 1} tem ${meta.width}×${meta.height} (esperado PNG 1080×1350).`, 'DIMENSAO', 500);
    arquivos.push({ nome: `slide-${String(i + 1).padStart(2, '0')}.png`, dados: a.dados });
  }
  const ficha = fichaDaSerie(op, doc);
  arquivos.push({ nome: 'legenda.txt', dados: doc.legenda?.texto || '' }, { nome: 'ficha-de-fontes.md', dados: ficha.markdown }, { nome: 'ficha-de-fontes.json', dados: JSON.stringify(ficha.json, null, 2) },
    { nome: 'imagens-origem.json', dados: JSON.stringify(ficha.json.imagens, null, 2) },
    { nome: 'LEIA-ME.txt', dados: `Carrossel “${op.nome}” — série ${C.SERIE_NOVA}\n${doc.render.length} imagens 1080×1350, numeradas na ordem de postagem. Nada foi publicado automaticamente.\nConfira a ficha de fontes e o direito de uso das imagens antes de postar. A tela de lição é hipótese para testar, não promessa.\n` });
  const zip = Pacote.montarZip(arquivos, { agora: new Date(agora) });
  if (Pacote.lerZip(zip).length !== arquivos.length) throw U.erro('O ZIP gerado não passou na conferência.', 'ZIP', 500);
  return { zip, arquivos: arquivos.map((a) => a.nome), ficha };
}
const hashDaVersao = (doc) => sha1(doc.render.map((r) => r.sha256).join('|')).slice(0, 16);

// ── Fechamento: valida e atualiza estado ──────────────────────────────────────
function sincronizarCompat(doc) {
  doc.copia = { slides: doc.telas.map((t, i) => { const tx = Serie.textoDaTela(t, { claims: doc.__claims || {} }); return { n: i + 1, funcao: t.funcao, texto: tx, palavras: U.contaPalavras(tx) }; }), legenda: doc.legenda?.texto || '', hashtags: doc.legenda?.hashtags || [] };
}
async function fechar(doc, op, { agora = Date.now(), motivoVersao = null } = {}) {
  doc.__claims = claimsDoc(op);
  doc.validacao = Serie.validar(doc, op);
  sincronizarCompat(doc); delete doc.__claims;
  const h = hashDaVersao(doc);
  (doc.versoes ||= []); const ult = doc.versoes[doc.versoes.length - 1];
  if (!ult || ult.hash !== h) { doc.versoes.push({ v: (ult?.v || 0) + 1, em: new Date(agora).toISOString(), hash: h, motivo: motivoVersao || 'edição', snapshot: { telas: doc.telas, legenda: doc.legenda, capa_escolhida: doc.capa_escolhida } }); if (doc.versoes.length > 25) doc.versoes = doc.versoes.slice(-25); }
  doc.hash_atual = h;
  if (doc.estado === 'aprovado' && doc.aprovacao?.hash !== h) { doc.estado = 'aguardando_aprovacao'; doc.decisao = null; doc.aprovacao = null; (doc.historico ||= []).push({ em: new Date(agora).toISOString(), evento: 'edicao_apos_aprovacao', detalhe: 'A aprovação anterior foi desfeita porque o conteúdo mudou.' }); }
  doc.pronto = doc.validacao.ok;
  if (['rascunho', 'aguardando_aprovacao', 'gerando'].includes(doc.estado)) doc.estado = doc.validacao.ok ? 'aguardando_aprovacao' : 'rascunho';
  return doc;
}

// ── Geração ────────────────────────────────────────────────────────────────────
// opId → carrossel. `rascunho`: texto escrito por uma pessoa (mesmo formato da IA, mesmas conferências).
async function gerar(opId, { deps = {}, versao = null, permitirBaixa = false, origem = 'manual', agora = Date.now(), reiniciar = false, rascunho = null, orcamentoMs = 45000 } = {}) {
  const t0 = Date.now(); const op = await carregarOp(opId); exigirVerificada(op, { permitirBaixa });
  let v = versao || ((op.carrosseis || []).length + 1);
  let existente = await store.obter('carrossel', idDe(opId, v));
  while (reiniciar && existente && ['erro', 'rascunho'].includes(existente.doc.estado) && existente.doc.serie === 'negocios') { v += 1; existente = await store.obter('carrossel', idDe(opId, v)); }
  const id = idDe(opId, v);
  if (existente && ['aguardando_aprovacao', 'aprovado', 'publicado', 'rascunho'].includes(existente.doc.estado) && existente.doc.etapa === 'pronto') return existente.doc;
  let doc = existente?.doc || { id, op_id: opId, versao: v, serie: 'negocios', origem, criado_em: new Date(agora).toISOString(), estado: 'gerando', etapa: 'copy', historico: [], excecao_limiar: permitirBaixa && (op.pontuacao ?? 0) < C.LIMIAR_CARROSSEL };
  let rev = existente ? existente.rev : 0;
  const salvar = async () => { doc.atualizado_em = new Date().toISOString(); const r = await store.salvar('carrossel', id, doc, rev); rev = r.rev; };
  await salvar();
  const restante = () => orcamentoMs - (Date.now() - t0);
  try {
    // 1) história + copy
    if (!doc.telas) {
      const aoFalhar = async (info) => { doc.copia_tentativas = (doc.copia_tentativas || 0) + 1; doc.feedback_copia = info.feedback; await salvar(); };
      let r;
      if (rascunho) r = { ...Historia.montarDoRascunho(rascunho, op, { origem: 'manual', agora }), tentativas: 0, llm: null, manual: true };
      else r = await Historia.gerarRascunho(op, { deps: { ...deps, aoFalhar }, feedback: doc.feedback_copia || '', agora });
      if (r.erros?.length && rascunho) throw U.erro(`O rascunho tem problemas de estrutura: ${r.erros.slice(0, 4).join('; ')}`, 'RASCUNHO', 422, { erros: r.erros });
      doc.telas = r.telas; doc.capas = r.capas; doc.capa_escolhida = r.capa_escolhida; doc.ficha = r.ficha;
      doc.legenda = { texto: r.legenda, partes: r.partes_legenda, hashtags: r.hashtags }; doc.ilustracao = r.ilustracao || null; doc.llm = r.llm || null; doc.tentativas_copia = r.tentativas;
      doc.copia_com_problemas = !!r.com_problemas; doc.etapa = 'imagens'; await salvar();
    }
    // 2) imagens (origem registrada; o que não for achado vira aviso, não imagem genérica)
    if (!doc.imagens_prontas) {
      if (restante() < 6000) { doc.etapa = 'imagens'; await salvar(); return doc; }
      const r = await Fotos.reunir(op, { deps, agora, ilustracao: doc.ilustracao });
      doc.imagens = []; let k = 0; for (const a of r.imagens.slice(0, 8)) doc.imagens.push(await Fotos.guardar(store, id, a, `im${++k}`));
      doc.avisos = r.avisos; doc.imagens_prontas = true; atribuirImagens(doc.telas, doc.imagens); doc.etapa = 'render'; await salvar();
    }
    // 3) render + validação + pacote
    if (restante() < 12000 && doc.render?.length !== doc.telas.length) { await salvar(); return doc; }
    doc.render = await renderizar(doc, op);
    await fechar(doc, op, { agora, motivoVersao: 'geração' });
    const p = await montarPacote(doc, op, { agora });   // o ZIP não é guardado (passa do limite de arquivo do banco): é montado, conferido e entregue sob demanda
    doc.pacote = { bytes: p.zip.length, arquivos: p.arquivos, nome_download: `${Pacote.nomeArquivo(op.nome)}-negocios-${U.diaBRT(agora)}.zip`, hash: doc.hash_atual };
    doc.ficha_markdown = p.ficha.markdown; doc.etapa = 'pronto'; doc.pronto_em = new Date().toISOString(); await salvar();
    await store.atualizar('oportunidade', opId, (o) => { o.carrossel_id = id; o.carrosseis = [...new Set([...(o.carrosseis || []), id])]; o.status = 'carrossel_gerado'; (o.decisoes ||= []).push({ em: doc.pronto_em, acao: 'carrossel_gerado', por: origem, carrossel_id: id, serie: 'negocios' }); return o; });
    return doc;
  } catch (e) {
    doc.estado = 'erro'; doc.erro = { mensagem: U.limita(e.message, 300), codigo: e.code || null, erros: e.erros || null, em: new Date().toISOString() };
    try { await salvar(); } catch { /* banco indisponível: o chamador recebe o erro original */ }
    throw e;
  }
}

// ── Edição: toda operação lê o documento, muda a cópia, re-renderiza só o que mudou e grava com conferência de versão ────────────
async function mutar(id, fn, { motivo = 'edição', agora = Date.now(), tentativas = 3 } = {}) {
  for (let k = 0; k < tentativas; k++) {
    const reg = await store.obter('carrossel', id); if (!reg) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
    const doc = JSON.parse(JSON.stringify(reg.doc)); if (doc.serie !== 'negocios') throw U.erro('Este carrossel é de outra série e não usa o editor de telas.', 'SERIE', 409);
    if (['publicado'].includes(doc.estado)) throw U.erro('Carrossel já publicado: gere uma nova versão para editar.', 'ESTADO', 409);
    const op = await carregarOp(doc.op_id); await fn(doc, op);
    doc.render = await renderizar(doc, op); await fechar(doc, op, { agora, motivoVersao: motivo });
    const p = await montarPacote(doc, op, { agora });
    doc.pacote = { ...(doc.pacote || {}), bytes: p.zip.length, arquivos: p.arquivos, hash: doc.hash_atual, nome_download: doc.pacote?.nome_download || `${Pacote.nomeArquivo(op.nome)}-negocios-${U.diaBRT(agora)}.zip` };
    doc.ficha_markdown = p.ficha.markdown; doc.atualizado_em = new Date().toISOString();
    try { await store.salvar('carrossel', id, doc, reg.rev); return { doc, op }; } catch (e) { if (e.code !== 'CONFLITO' || k === tentativas - 1) throw e; }
  }
  return null;
}
const indiceDaTela = (doc, n) => { const i = Number(n) - 1; if (!Number.isInteger(i) || i < 0 || i >= doc.telas.length) throw U.erro('Tela inválida.', 'ENTRADA', 400); return i; };
const naoBloqueada = (t) => { if (t.bloqueada) throw U.erro('Esta tela está bloqueada (aprovada por você). Desbloqueie para editar.', 'BLOQUEADA', 409); };

// patch: { textos: {campo: valor}, layout, variante, estilo, foto: {imagem_id, enq, forma}, bloqueada }
async function editarTela(id, n, patch = {}) {
  return mutar(id, (doc, op) => {
    const i = indiceDaTela(doc, n); const t = doc.telas[i]; const f = Serie.FUNCOES[t.funcao];
    if ('bloqueada' in patch) t.bloqueada = patch.bloqueada === true;
    if (Object.keys(patch).some((k) => k !== 'bloqueada')) naoBloqueada(t);
    if (patch.textos && typeof patch.textos === 'object') for (const k of [...Serie.CAMPOS, 'claim_id']) if (k in patch.textos) {
      const v = patch.textos[k]; if (v === null || String(v).trim() === '') delete t.textos[k];
      else if (k === 'claim_id') { if (!Serie.claimsPorId(op)[String(v)]) throw U.erro('Esse dado não está entre os verificados.', 'ENTRADA', 400); t.textos[k] = String(v); }
      else t.textos[k] = Serie.limpaTxt(v, Serie.LIMITES[k] + 60);
    }
    if (patch.layout) { if (!f.permitidos.includes(patch.layout)) throw U.erro(`A tela de ${f.rotulo.toLowerCase()} aceita as composições: ${f.permitidos.join(', ')}.`, 'ENTRADA', 400); t.layout = patch.layout; if (patch.layout !== 'manchete_produto') delete t.variante; else t.variante = patch.variante || (f.variante || 'meia_lua'); }
    else if (patch.variante && t.layout === 'manchete_produto' && ['meia_lua', 'canto'].includes(patch.variante)) t.variante = patch.variante;
    if (patch.estilo && typeof patch.estilo === 'object') t.estilo = { ...(t.estilo || {}), ...Object.fromEntries(Object.entries(patch.estilo).filter(([k, v]) => ({ cor: ['preto', 'azul'], destaque: ['laranja', 'azul'], marca: ['nenhuma', 'circulo', 'sublinhado'], barra: [true, false] }[k] || []).includes(v))) };
    if (patch.foto && typeof patch.foto === 'object') {
      if ('imagem_id' in patch.foto) { if (patch.foto.imagem_id && !(doc.imagens || []).some((x) => x.id === patch.foto.imagem_id)) throw U.erro('Imagem desconhecida.', 'ENTRADA', 400); t.foto = { ...(t.foto || {}), imagem_id: patch.foto.imagem_id || null, manual: true }; }
      if (['auto', 'centro', 'topo', 'baixo', 'esquerda', 'direita'].includes(patch.foto.enq)) t.foto = { ...(t.foto || {}), enq: patch.foto.enq };
      if ('forma' in patch.foto && [null, 'retangulo', 'arco', 'circulo', 'inclinado', 'print'].includes(patch.foto.forma)) t.foto = { ...(t.foto || {}), forma: patch.foto.forma };
    }
    (doc.historico ||= []).push({ em: new Date().toISOString(), evento: 'editar_tela', detalhe: { tela: i + 1, campos: Object.keys(patch) } });
  }, { motivo: `tela ${n}` });
}

async function escolherCapa(id, capaId) {
  return mutar(id, (doc) => {
    const c = (doc.capas || []).find((x) => x.id === capaId); if (!c) throw U.erro('Capa desconhecida.', 'ENTRADA', 400);
    const t = doc.telas[0]; naoBloqueada(t);
    t.textos = { ...t.textos, rotulo: c.rotulo, titulo: c.titulo, ...(c.apoio ? { apoio: c.apoio } : {}) }; if (!c.apoio) delete t.textos.apoio;
    doc.capa_escolhida = c.id; (doc.historico ||= []).push({ em: new Date().toISOString(), evento: 'escolher_capa', detalhe: { capa: c.id } });
  }, { motivo: `capa ${capaId}` });
}
async function editarCapa(id, capaId, patch) {
  return mutar(id, (doc) => {
    const c = (doc.capas || []).find((x) => x.id === capaId); if (!c) throw U.erro('Capa desconhecida.', 'ENTRADA', 400);
    for (const k of ['titulo', 'apoio']) if (typeof patch[k] === 'string') c[k] = Serie.limpaTxt(patch[k], Serie.LIMITES[k] + 40);
    if (doc.capa_escolhida === capaId) { const t = doc.telas[0]; naoBloqueada(t); t.textos = { ...t.textos, titulo: c.titulo }; if (c.apoio) t.textos.apoio = c.apoio; else delete t.textos.apoio; }
  }, { motivo: `edição da ${capaId}` });
}
// ordem: lista de números atuais (1..n) na nova ordem. A última tela continua sendo o encerramento.
async function reordenar(id, ordem) {
  return mutar(id, (doc) => {
    const n = doc.telas.length; const o = (Array.isArray(ordem) ? ordem : []).map(Number);
    if (o.length !== n || new Set(o).size !== n || o.some((x) => !Number.isInteger(x) || x < 1 || x > n)) throw U.erro('Ordem inválida: informe cada número de 1 a ' + n + ' uma vez.', 'ENTRADA', 400);
    doc.telas = o.map((x) => doc.telas[x - 1]); (doc.historico ||= []).push({ em: new Date().toISOString(), evento: 'reordenar', detalhe: { ordem: o } });
  }, { motivo: 'ordem das telas' });
}
async function remover(id, n) {
  return mutar(id, (doc) => {
    const i = indiceDaTela(doc, n); const t = doc.telas[i];
    if (doc.telas.length <= 7) throw U.erro('O carrossel precisa de pelo menos 7 telas.', 'ENTRADA', 400);
    if (!Serie.OMITIVEIS.includes(t.funcao)) throw U.erro('Só dá para tirar a tela de tensão ou a de estratégia; as outras sustentam a história.', 'ENTRADA', 400);
    doc.telas.splice(i, 1); (doc.historico ||= []).push({ em: new Date().toISOString(), evento: 'remover_tela', detalhe: { funcao: t.funcao } });
  }, { motivo: 'tela removida' });
}
async function editarLegenda(id, texto) {
  return mutar(id, (doc) => {
    const t = String(texto ?? '').replace(/\r/g, '').trim(); if (t.length < 20) throw U.erro('A legenda é curta demais.', 'ENTRADA', 400); if (t.length > 1200) throw U.erro('A legenda passa de 1200 caracteres.', 'ENTRADA', 400);
    doc.legenda = { ...(doc.legenda || {}), texto: t, hashtags: (t.match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 3) };
  }, { motivo: 'legenda' });
}
async function regenerarTela(id, n, { instrucao = '', campo = null, deps = {} } = {}) {
  const reg = await store.obter('carrossel', id); if (!reg) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const op = await carregarOp(reg.doc.op_id); const i = indiceDaTela(reg.doc, n); naoBloqueada(reg.doc.telas[i]);
  const r = await Historia.regenerarTela(op, reg.doc, i, { instrucao, campo, deps });
  const out = await editarTela(id, n, { textos: r.textos });
  return { ...out, regeneracao: { tentativas: r.tentativas, com_problemas: !!r.com_problemas, erros: r.erros || [] } };
}
async function adicionarImagem(id, dados) {
  const reg = await store.obter('carrossel', id); if (!reg) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const achado = await Fotos.deUsuario(dados);
  return mutar(id, async (doc) => { const novoId = `im${(doc.imagens || []).reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0) + 1}`; const reg2 = await Fotos.guardar(store, id, achado, novoId); (doc.imagens ||= []).push(reg2); if (dados.tela) { const i = indiceDaTela(doc, dados.tela); naoBloqueada(doc.telas[i]); doc.telas[i].foto = { ...(doc.telas[i].foto || {}), imagem_id: novoId, manual: true, forma: dados.papel === 'print' ? 'print' : (doc.telas[i].foto?.forma || null) }; } }, { motivo: 'imagem enviada' });
}
async function confirmarPermissao(id, imagemId, confirmada = true) {
  return mutar(id, (doc) => { const im = (doc.imagens || []).find((x) => x.id === imagemId); if (!im) throw U.erro('Imagem desconhecida.', 'ENTRADA', 400); im.permissao = confirmada ? 'confirmada' : 'verificar'; im.permissao_confirmada_em = confirmada ? new Date().toISOString() : null; }, { motivo: 'permissão de imagem' });
}
async function restaurarVersao(id, v) {
  return mutar(id, (doc) => { const s = (doc.versoes || []).find((x) => x.v === Number(v)); if (!s?.snapshot) throw U.erro('Versão não encontrada.', 'ENTRADA', 404); doc.telas = JSON.parse(JSON.stringify(s.snapshot.telas)); doc.legenda = JSON.parse(JSON.stringify(s.snapshot.legenda)); doc.capa_escolhida = s.snapshot.capa_escolhida; }, { motivo: `restaurada a versão ${v}` });
}
// Exportação: reconfere arquivos e versão aprovada antes de entregar o ZIP.
async function exportar(id, { agora = Date.now() } = {}) {
  const reg = await store.obter('carrossel', id); if (!reg) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404); const doc = reg.doc;
  if (doc.serie !== 'negocios') { const a = await store.arquivoObter(chaveZip(id)); return a ? { zip: a.dados, nome: doc.pacote?.nome_download || 'carrossel.zip' } : null; }
  const op = await carregarOp(doc.op_id);
  if (doc.estado === 'aprovado' && doc.aprovacao?.hash !== hashDaVersao(doc)) throw U.erro('A versão que seria exportada é diferente da aprovada.', 'VERSAO_DIFERENTE', 409);
  if (doc.validacao?.bloqueios?.length) throw U.erro(`Não dá para exportar: ${doc.validacao.bloqueios.length} bloqueio(s) a corrigir. ${doc.validacao.bloqueios[0].mensagem}`, 'BLOQUEADO', 409);
  const p = await montarPacote(doc, op, { agora }); return { zip: p.zip, nome: doc.pacote?.nome_download || 'carrossel.zip' };
}

module.exports = { gerar, editarTela, escolherCapa, editarCapa, reordenar, remover, editarLegenda, regenerarTela, adicionarImagem, confirmarPermissao, restaurarVersao, exportar, renderizar, montarPacote, fichaDaSerie, atribuirImagens, exigirVerificada, hashDaVersao, idDe, chaveSlide, chaveZip, fechar };
