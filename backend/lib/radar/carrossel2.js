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
const ArteMin = require('./arteMinimalista');
const ArteMinLegado = require('./arteMinimalistaLegado');
const FotoPedro = require('./fotoPedro');
const Padrao = require('../padraoCarrossel');
const Metodo = require('./metodo');
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
function atribuirImagens(telas, imagens, { minimalista: min = false } = {}) {
  const uso = {};
  telas.forEach((t) => {
    if (['encerramento_pedro', 'min_encerramento', 'min_texto'].includes(t.layout) || t.foto?.imagem_id || t.foto?.manual) return;
    const pref = PREFERE[t.funcao] || ['produto', 'local'];
    const ilustra = ['tensao', 'licao'].includes(t.funcao);
    let cand = imagens.filter((i) => (uso[i.id] || 0) < 2 && (['evidencia', 'dinheiro', 'conta', 'aplicacao'].includes(t.funcao) ? ['foto', 'print', 'documento'].includes(i.papel) : i.papel === 'foto' || (i.papel === 'ilustracao')));
    cand = cand.filter((i) => ilustra || i.relacao === 'negocio');
    // no minimalista, banner de divulgação do site (texto sobreposto) não entra sozinho: a tela fica sem foto e avisa
    if (min) cand = cand.filter((i) => i.tipo !== 'oficial_pagina');
    const nota = (i) => {
      const tags = classificar(i); let r = tags.length ? Math.min(...tags.map((k) => (pref.includes(k) ? pref.indexOf(k) : (k === 'pessoa' ? 99 : 5)))) : 6;
      if (['evidencia', 'dinheiro', 'conta'].includes(t.funcao) && ['print', 'documento'].includes(i.papel)) r = t.funcao === 'evidencia' || t.funcao === 'conta' ? -2 : -1;
      // no minimalista, banner de divulgação com texto sobreposto perde para foto de operação ou produto
      if (min && i.tipo === 'oficial_pagina') r += 4;
      if (ilustra && i.relacao === 'ilustrativa') r -= 1;
      return r + 10 * (uso[i.id] || 0);
    };
    const ordem = cand.map((i) => ({ i, n: nota(i) })).filter((x) => x.n < 90).sort((a, b) => a.n - b.n);
    const im = ordem[0]?.i || null; if (im) uso[im.id] = (uso[im.id] || 0) + 1;
    t.foto = { enq: 'auto', forma: im && ['print', 'documento'].includes(im.papel) ? 'print' : (t.foto?.forma || null), imagem_id: im ? im.id : null };
  });
}
// Padrão v1: escolha entre VÁRIOS candidatos (não o primeiro resultado), pela ordem de importância das telas, sem repetir foto.
// Cada candidato é conferido: entidade certa (imagem da empresa ou ilustração rotulada), tipo pedido pelo briefing visual da tela,
// resolução (sem ampliação agressiva), banner com texto sobreposto, imagem gerada por IA fora da tela de teste. A tela guarda os
// candidatos avaliados e o motivo de cada recusa; sem candidato aceitável a tela fica sem foto e avisa.
const PRIORIDADE_V1 = ['gancho', 'conta', 'mecanismo_1', 'aplicacao', 'mecanismo_2', 'problema'];
function avaliarCandidato(i, t, usados) {
  const motivos = []; let nota = 0; const tags = classificar(i);
  if (usados.has(i.id)) return { id: i.id, aceita: false, nota: -99, motivos: ['já usada em outra tela'] };
  if (i.tipo === 'oficial_pagina') return { id: i.id, aceita: false, nota: -99, motivos: ['banner do site com texto de divulgação sobreposto'] };
  if (i.tipo === 'ia_ilustracao' && t.funcao !== 'aplicacao') return { id: i.id, aceita: false, nota: -99, motivos: ['imagem gerada por IA só ilustra a tela de teste'] };
  if (i.relacao !== 'negocio' && t.funcao !== 'aplicacao') return { id: i.id, aceita: false, nota: -99, motivos: ['não é da empresa (ilustrativa): só cabe na tela de teste'] };
  const larg = i.largura || i.origem?.largura || 0;
  if (larg && larg < 600) return { id: i.id, aceita: false, nota: -99, motivos: [`pequena demais (${larg} px de largura)`] };
  if (larg && larg < 900) { nota -= 2; motivos.push(`resolução baixa (${larg} px)`); } else if (larg) { nota += 1; motivos.push(`resolução boa (${larg} px)`); }
  const prova = ['conta'].includes(t.funcao); const mec = ['mecanismo_1', 'mecanismo_2'].includes(t.funcao);
  if (prova && ['print', 'documento'].includes(i.papel)) { nota += 4; motivos.push('print/documento verdadeiro sustenta o dado'); }
  if (mec && (i.papel === 'print' || tags.includes('app'))) { nota += 3; motivos.push('mostra o funcionamento (app/print)'); }
  if (t.funcao === 'gancho' && (tags.includes('produto') || tags.includes('local'))) { nota += 3; motivos.push('mostra o produto ou o lugar real'); }
  if (t.funcao === 'gancho' && i.papel === 'print') { nota -= 1; motivos.push('print abre pior que foto'); }
  if (tags.includes('pessoa') && !['mecanismo_1', 'mecanismo_2'].includes(t.funcao)) { nota -= 3; motivos.push('retrato de pessoa fora da tela de operação'); }
  if (i.tipo === 'enviada') { nota += 2; motivos.push('enviada pelo Pedro (primeira na hierarquia de fontes)'); }
  if (/presskit|press|kit de imprensa|media kit/i.test(`${i.descricao} ${i.origem?.url_pagina || ''}`)) { nota += 1; motivos.push('kit de imprensa'); }
  if (i.relacao === 'ilustrativa') { nota -= 1; motivos.push('ilustrativa: rotulada como tal'); }
  return { id: i.id, aceita: nota > -3, nota, motivos };
}
function atribuirImagensV1(telas, imagens) {
  const usados = new Set(telas.filter((t) => t.foto?.imagem_id && (t.foto.manual || t.travas?.imagem)).map((t) => t.foto.imagem_id));
  const ordem = [...telas].filter((t) => FUNCOES_MIN_V1[t.funcao]?.foto || ['min_foto', 'min_produto'].includes(t.layout)).sort((a, b) => PRIORIDADE_V1.indexOf(a.funcao) - PRIORIDADE_V1.indexOf(b.funcao));
  for (const t of ordem) {
    if (t.layout === 'min_encerramento' || t.foto?.manual || t.travas?.imagem) continue;
    const av = imagens.map((i) => avaliarCandidato(i, t, usados)).sort((a, b) => b.nota - a.nota);
    const escolhida = av.find((x) => x.aceita) || null;
    if (escolhida) usados.add(escolhida.id);
    const im = escolhida ? imagens.find((i) => i.id === escolhida.id) : null;
    t.foto = { ...(t.foto || {}), enq: t.foto?.enq || 'auto', imagem_id: im ? im.id : null, forma: im && ['print', 'documento'].includes(im.papel) ? 'print' : null, candidatos: av.slice(0, 6), pendente: im ? null : 'Nenhuma imagem pertinente foi encontrada para esta tela. Envie uma (o modelo não usa imagem genérica).' };
    if (im?.recorte_transparente && t.layout === 'min_foto') t.layout = 'min_produto';
  }
}
const FUNCOES_MIN_V1 = Metodo.FUNCOES_MIN;

async function bufferesDaTela(doc, tela) {
  const id = tela.foto?.imagem_id; if (!id) return null; const im = (doc.imagens || []).find((x) => x.id === id); if (!im) return null;
  const a = await store.arquivoObter(im.arquivo); return a ? { buf: a.dados, credito: im.credito || null, tipo: im.tipo, papel: im.papel, id } : null;
}
const claimsDoc = (op) => Serie.claimsPorId(op);
// Template: 'editorial' (série azul e laranja, 8 telas) ou 'minimalista' (estratégia por trás, 7 telas). O método de copy é o mesmo.
const minimalista = (doc) => doc?.template === 'minimalista' || Padrao.ehV1(doc?.template);
const funcoesDe = (doc) => (minimalista(doc) ? Metodo.FUNCOES_MIN : Serie.FUNCOES);
const validarDoc = (doc, op) => (minimalista(doc) ? Metodo.validarDocMin(doc, op) : Serie.validar(doc, op));

// ── Render incremental ─────────────────────────────────────────────────────────
// Renderiza só as telas cuja entrada mudou. Devolve a lista `render` completa (a mesma ordem das telas).
async function renderizar(doc, op) {
  const n = doc.telas.length; const claims = claimsDoc(op); const anterior = doc.render || []; const novo = []; const imagens = {};
  const v1 = Padrao.ehV1(doc.template); const pedro = v1 ? await FotoPedro.obter() : null; const hPedro = pedro ? sha256(pedro.buf).slice(0, 16) + JSON.stringify(pedro.recorte || null) : null;
  for (let i = 0; i < n; i++) {
    const t = doc.telas[i];
    const im = await bufferesDaTela(doc, t); if (im) imagens[im.id] = im;
    const ent = { t: { layout: t.layout, variante: t.variante || null, estilo: t.estilo || null, textos: t.textos, foto: { ...t.foto, manual: undefined } }, n: i + 1, total: n, im: im ? sha256(im.buf) : null, credito: im?.credito || null, claim: claims[t.textos?.claim_id] ? { v: claims[t.textos.claim_id].valor_exibicao, a: claims[t.textos.claim_id].atribuicao, u: claims[t.textos.claim_id].veiculo, d: claims[t.textos.claim_id].data_publicacao || claims[t.textos.claim_id].consultado_em } : null, v: v1 ? 'v1' : 3, ...(v1 ? { pedro: t.layout === 'min_encerramento' ? hPedro : null, foto: { imagem_id: t.foto?.imagem_id || null, foco: t.foto?.foco || null, enq: t.foto?.enq || null }, imp: im?.papel || null } : {}) };
    if (v1) { delete ent.t.foto; delete ent.n; delete ent.total; }
    const h = sha1(ent); const antes = anterior.find((r) => r.tela_id === t.id && r.entrada_hash === h);
    const arquivo = chaveSlide(doc.id, i + 1);
    if (antes && antes.n === i + 1) { novo.push(antes); continue; }
    if (antes) { const a = await store.arquivoObter(antes.arquivo); if (a) { await store.arquivoSalvar(arquivo, a.dados, 'image/png'); novo.push({ ...antes, n: i + 1, arquivo }); continue; } }
    const r = v1 ? await ArteMin.renderizarTela(t, { n: i + 1, total: n, imagens, fotoPedro: pedro }) : minimalista(doc) ? await ArteMinLegado.renderizarTela(t, { n: i + 1, total: n, imagens }) : await Arte.renderizarTela(t, { n: i + 1, total: n, imagens, claims });
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
  if (Padrao.ehV1(doc.template)) {
    const x = extrasV1(doc, op, { agora });
    arquivos.push({ nome: 'legenda.txt', dados: x.legenda }, { nome: 'fontes-e-creditos.md', dados: x.fontes }, { nome: 'carrossel.json', dados: JSON.stringify(x.objeto, null, 2) }, { nome: 'ficha-de-fontes.json', dados: JSON.stringify(ficha.json, null, 2) },
      { nome: 'LEIA-ME.txt', dados: `Carrossel “${op.nome}” — ${Padrao.NOME}\n${doc.render.length} imagens PNG 1080×1350 (slide-01.png … slide-${String(doc.render.length).padStart(2, '0')}.png), na ordem de postagem.\nlegenda.txt: legenda editável (até 3 hashtags) com créditos das imagens. fontes-e-creditos.md: fontes, datas, trechos e créditos. carrossel.json: objeto estruturado completo (briefing, ganchos, telas, fotos e recortes, revisão, aprovação).\nNada foi publicado automaticamente.\n` });
    const zip = Pacote.montarZip(arquivos, { agora: new Date(agora) });
    const lidos = Pacote.lerZip(zip);
    if (lidos.length !== arquivos.length || lidos.some((l, i) => l.nome !== arquivos[i].nome)) throw U.erro('O ZIP gerado não passou na conferência (quantidade ou ordem dos arquivos).', 'ZIP', 500);
    return { zip, arquivos: arquivos.map((a) => a.nome), ficha };
  }
  arquivos.push({ nome: 'legenda.txt', dados: doc.legenda?.texto || '' }, { nome: 'ficha-de-fontes.md', dados: ficha.markdown }, { nome: 'ficha-de-fontes.json', dados: JSON.stringify(ficha.json, null, 2) },
    { nome: 'imagens-origem.json', dados: JSON.stringify(ficha.json.imagens, null, 2) },
    { nome: 'LEIA-ME.txt', dados: `Carrossel “${op.nome}” — série ${C.SERIE_NOVA}\n${doc.render.length} imagens 1080×1350, numeradas na ordem de postagem. Nada foi publicado automaticamente.\nConfira a ficha de fontes e o direito de uso das imagens antes de postar. A tela de lição é hipótese para testar, não promessa.\n` });
  const zip = Pacote.montarZip(arquivos, { agora: new Date(agora) });
  if (Pacote.lerZip(zip).length !== arquivos.length) throw U.erro('O ZIP gerado não passou na conferência.', 'ZIP', 500);
  return { zip, arquivos: arquivos.map((a) => a.nome), ficha };
}
// Exportação do padrão v1: legenda com créditos, folha de fontes e créditos, e o objeto estruturado completo.
function creditosDe(doc) {
  const usadas = (doc.imagens || []).filter((im) => (doc.telas || []).some((t) => t.foto?.imagem_id === im.id));
  return usadas.map((im) => ({ id: im.id, telas: doc.telas.map((t, i) => (t.foto?.imagem_id === im.id ? i + 1 : null)).filter(Boolean), credito: im.credito || null, licenca: im.licenca, origem: im.origem?.url_pagina || im.origem?.url_imagem || im.origem?.declaracao || null, tipo: im.tipo, ilustrativa: im.relacao === 'ilustrativa' || im.tipo === 'ia_ilustracao' }));
}
function extrasV1(doc, op, { agora = Date.now() } = {}) {
  const cred = creditosDe(doc);
  const linhaCred = cred.filter((c) => c.credito).map((c) => `${c.credito.replace(/^Foto:\s*/i, '')}${/cc[- ]?by/i.test(c.licenca || '') ? ` (${c.licenca.split(/[.;]/)[0]})` : ''}`);
  const legenda = `${doc.legenda?.texto || ''}${linhaCred.length ? `\n\nImagens: ${[...new Set(linhaCred)].join('; ')}.` : ''}`;
  const usaveis = (op.verificacao?.claims || []).filter((c) => c.usavel);
  const L = [`# Fontes e créditos — ${op.nome}`, '', `Modelo: ${Padrao.NOME} (${Padrao.ID}) · versão do conteúdo ${doc.hash_atual || ''} · exportado em ${new Date(agora).toISOString()}`, '', '## Fontes consultadas', ''];
  (op.verificacao?.fontes || []).forEach((f) => L.push(`- ${f.titulo || f.veiculo} — ${f.veiculo} · ${f.url} · publicada em ${Pacote.dataBR(f.publicada_em)} · consultada em ${Pacote.dataBR(f.acessada_em || f.consultado_em)}${f.classe ? ` · ${f.classe}` : ''}`));
  L.push('', '## Afirmações usadas (com trecho)', '');
  usaveis.forEach((c) => L.push(`- [${c.id}] ${c.texto} (${c.tipo}${c.valor_exibicao ? `, ${c.valor_exibicao}` : ''}${c.atribuicao ? `, ${c.atribuicao}` : ''}) — ${c.veiculo}, ${c.url}\n  Trecho: “${U.limita(c.trecho, 300)}”\n  Situação: ${c.estado || 'verificada'}${c.limitacao ? ` · Limitação: ${c.limitacao}` : ''}`));
  if ((doc.briefing?.duvidas_abertas || []).length) { L.push('', '## Dúvidas em aberto (não afirmadas nas telas)', ''); doc.briefing.duvidas_abertas.forEach((d) => L.push(`- ${d}`)); }
  if ((op.verificacao?.limitacoes || []).length) { L.push('', '## Limitações da pesquisa', ''); op.verificacao.limitacoes.forEach((d) => L.push(`- ${d}`)); }
  L.push('', '## Imagens', ''); if (!cred.length) L.push('Nenhuma imagem do assunto foi usada.');
  cred.forEach((c) => L.push(`- Tela(s) ${c.telas.join(', ')}: ${c.credito || 'sem crédito informado'} · licença/permissão: ${c.licenca || '—'} · origem: ${c.origem || '—'}${c.ilustrativa ? ' · ILUSTRATIVA' : ''}`));
  const telas = doc.telas.map((t, i) => ({ n: i + 1, funcao: t.funcao, funcao_narrativa: Metodo.FUNCOES_MIN[t.funcao]?.rotulo, tipo: t.tipo, layout: t.layout, titulo: t.textos?.titulo, corpo: t.textos?.corpo ?? t.textos?.apoio, informacao_nova: t.informacao_nova || null, relacao_anterior: t.relacao_anterior || null, fatos_usados: t.fatos_usados || t.base || [], evidencias: t.evidencias || [], briefing_visual: t.briefing_visual || null, foto: t.foto ? { imagem_id: t.foto.imagem_id, foco: t.foto.foco || null, enq: t.foto.enq || 'auto', manual: !!t.foto.manual, candidatos: t.foto.candidatos || [], pendente: t.foto.pendente || null } : null, travas: t.travas || null, png: doc.render?.[i] ? { arquivo: `slide-${String(i + 1).padStart(2, '0')}.png`, sha256: doc.render[i].sha256, medidas: doc.render[i].metricas?.medidas || null } : null }));
  const objeto = { template: Padrao.ID, template_nome: Padrao.NOME, id: doc.id, versao: doc.versao, hash: doc.hash_atual, estado: doc.estado, empresa: op.nome, briefing: doc.briefing, fontes: op.verificacao?.fontes || [], afirmacoes: usaveis.map(({ id, tipo, texto, valor_exibicao, atribuicao, veiculo, url, trecho, data_publicacao }) => ({ id, tipo, texto, valor_exibicao, atribuicao, veiculo, url, trecho, data_publicacao })), ganchos: doc.ganchos || doc.capas, gancho_escolhido: doc.capa_escolhida, telas, telas_omitidas: doc.telas_omitidas || [], imagens: (doc.imagens || []).map(({ id, tipo, papel, relacao, descricao, origem, licenca, credito, permissao, largura, altura, transformacoes, sha256_original, sha256_trabalho }) => ({ id, tipo, papel, relacao, descricao, origem, licenca, credito, permissao, largura, altura, transformacoes, sha256_original, sha256_trabalho })), legenda: { texto: legenda, hashtags: doc.legenda?.hashtags || [] }, revisao: doc.revisao || null, validacao: doc.validacao, aprovacao: doc.aprovacao || null, versoes: (doc.versoes || []).map(({ v, em, hash, motivo }) => ({ v, em, hash, motivo })), historico: doc.historico || [], exportado_em: new Date(agora).toISOString() };
  return { legenda, fontes: `${L.join('\n')}\n`, objeto };
}
const hashDaVersao = (doc) => sha1(doc.render.map((r) => r.sha256).join('|')).slice(0, 16);

// ── Fechamento: valida e atualiza estado ──────────────────────────────────────
function sincronizarCompat(doc) {
  doc.copia = { slides: doc.telas.map((t, i) => { const tx = Serie.textoDaTela(t, { claims: doc.__claims || {} }); return { n: i + 1, funcao: t.funcao, texto: tx, palavras: U.contaPalavras(tx) }; }), legenda: doc.legenda?.texto || '', hashtags: doc.legenda?.hashtags || [] };
}
async function fechar(doc, op, { agora = Date.now(), motivoVersao = null } = {}) {
  doc.__claims = claimsDoc(op);
  doc.validacao = validarDoc(doc, op);
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
async function gerar(opId, { deps = {}, versao = null, permitirBaixa = false, origem = 'manual', agora = Date.now(), reiniciar = false, rascunho = null, orcamentoMs = 45000, template = Padrao.atual() || 'editorial', convertidoDe = null } = {}) {
  const t0 = Date.now(); const op = await carregarOp(opId); exigirVerificada(op, { permitirBaixa });
  let v = versao || ((op.carrosseis || []).length + 1);
  let existente = await store.obter('carrossel', idDe(opId, v));
  // nunca reaproveita o número de uma versão de outra série; numa versão nova, a anterior com erro vira "substituida"
  while (existente && (existente.doc.serie !== 'negocios' || (reiniciar && ['erro', 'rascunho'].includes(existente.doc.estado)))) {
    if (existente.doc.estado === 'erro') await store.salvar('carrossel', existente.doc.id || idDe(opId, v), { ...existente.doc, estado: 'substituido' }, existente.rev).catch(() => {});
    v += 1; existente = await store.obter('carrossel', idDe(opId, v));
  }
  const id = idDe(opId, v);
  if (existente && ['aguardando_aprovacao', 'aprovado', 'publicado', 'rascunho'].includes(existente.doc.estado) && existente.doc.etapa === 'pronto') return existente.doc;
  let doc = existente?.doc || { id, op_id: opId, versao: v, serie: 'negocios', template: Padrao.ehV1(template) ? Padrao.ID : template === 'minimalista' ? 'minimalista' : 'editorial', ...(Padrao.ehV1(template) ? { modelo_nome: Padrao.NOME } : {}), ...(convertidoDe ? { convertido_de: convertidoDe } : {}), origem, criado_em: new Date(agora).toISOString(), estado: 'gerando', etapa: 'copy', historico: [], excecao_limiar: permitirBaixa && (op.pontuacao ?? 0) < C.LIMIAR_CARROSSEL };
  if (doc.estado === 'erro') { doc.estado = 'gerando'; delete doc.erro; }
  let rev = existente ? existente.rev : 0;
  const salvar = async () => { doc.atualizado_em = new Date().toISOString(); const r = await store.salvar('carrossel', id, doc, rev); rev = r.rev; };
  await salvar();
  const restante = () => orcamentoMs - (Date.now() - t0);
  try {
    // 1) história + copy
    if (!doc.telas) {
      const aoFalhar = async (info) => { doc.copia_tentativas = (doc.copia_tentativas || 0) + 1; doc.feedback_copia = info.feedback; await salvar(); };
      let r;
      if (minimalista(doc)) {
        // Modelo minimalista: briefing → ganchos → sete telas. Validação por código e revisão por IA (quando há chave).
        const v1 = Padrao.ehV1(doc.template);
        const m = rascunho ? { ...Metodo.montarDoc(rascunho, op, { agora, v1 }), tentativas: 0, llm: null, manual: true } : await Metodo.gerarMinimalista(op, { deps: { ...deps, aoFalhar }, feedback: doc.feedback_copia || '', agora, template: doc.template });
        if (rascunho && v1 && m.erros?.length && !m.sem_pauta) throw U.erro(`O rascunho tem problemas de estrutura: ${m.erros.slice(0, 4).join('; ')}`, 'RASCUNHO', 422, { erros: m.erros });
        if (!m.sem_pauta && (!m.telas || m.telas.length < 5 || (m.capas || []).length < 3)) throw U.erro(`A copy não passou nas regras: ${(m.erros || m.validacao?.bloqueios?.map((x) => x.mensagem) || []).slice(0, 3).join('; ') || 'resposta incompleta da IA'}`, 'COPY_INVALIDA', 422, { erros: m.erros || [] });
        if (m.sem_pauta) throw U.erro(`Esta história não rendeu uma pauta específica: ${m.sem_pauta}. Aprofunde a pesquisa ou descarte a pauta.`, 'SEM_PAUTA', 422);
        doc.telas = m.telas; doc.capas = m.capas; doc.capa_escolhida = m.capa_escolhida; doc.ficha = m.ficha || Metodo.fichaDoBriefing(op, m.briefing);
        doc.briefing = m.briefing; if (m.omitidas?.length) doc.telas_omitidas = m.omitidas; if (m.ganchos) doc.ganchos = m.ganchos; doc.revisao = m.revisao || { executada: false, motivo: 'sem chave de IA neste ambiente: só a revisão técnica por código rodou' };
        doc.legenda = { texto: m.legenda, partes: m.partes_legenda, hashtags: m.hashtags }; doc.ilustracao = null; doc.llm = m.llm || null; doc.tentativas_copia = m.tentativas;
        doc.copia_com_problemas = !!m.com_problemas; doc.etapa = 'imagens'; await salvar();
        r = null;
      } else if (rascunho) r = { ...Historia.montarDoRascunho(rascunho, op, { origem: 'manual', agora }), tentativas: 0, llm: null, manual: true };
      else if (!minimalista(doc)) r = await Historia.gerarRascunho(op, { deps: { ...deps, aoFalhar }, feedback: doc.feedback_copia || '', agora });
      if (r && !rascunho && (!r.telas || r.telas.length < 7 || (r.capas || []).length < 3)) throw U.erro(`A copy não passou nas regras: ${(r.erros || []).slice(0, 3).join('; ') || 'resposta incompleta da IA'}`, 'COPY_INVALIDA', 422, { erros: r.erros || [] });
      if (r?.erros?.length && rascunho && !minimalista(doc)) throw U.erro(`O rascunho tem problemas de estrutura: ${r.erros.slice(0, 4).join('; ')}`, 'RASCUNHO', 422, { erros: r.erros });
      if (r) {
        doc.telas = r.telas; doc.capas = r.capas; doc.capa_escolhida = r.capa_escolhida; doc.ficha = r.ficha;
        doc.legenda = { texto: r.legenda, partes: r.partes_legenda, hashtags: r.hashtags }; doc.ilustracao = r.ilustracao || null; doc.llm = r.llm || null; doc.tentativas_copia = r.tentativas;
        doc.copia_com_problemas = !!r.com_problemas; doc.etapa = 'imagens'; await salvar();
      }
    }
    // 2) imagens (origem registrada; o que não for achado vira aviso, não imagem genérica)
    if (!doc.imagens_prontas) {
      if (restante() < 6000) { doc.etapa = 'imagens'; await salvar(); return doc; }
      const r = await Fotos.reunir(op, { deps, agora, ilustracao: doc.ilustracao });
      doc.imagens = []; let k = 0; for (const a of r.imagens.slice(0, 8)) doc.imagens.push(await Fotos.guardar(store, id, a, `im${++k}`));
      doc.avisos = [...new Set(r.avisos)]; doc.imagens_prontas = true;
      if (Padrao.ehV1(doc.template)) atribuirImagensV1(doc.telas, doc.imagens); else atribuirImagens(doc.telas, doc.imagens, { minimalista: minimalista(doc) });
      doc.etapa = 'render'; await salvar();
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
    const i = indiceDaTela(doc, n); const t = doc.telas[i]; const f = funcoesDe(doc)[t.funcao];
    if ('bloqueada' in patch) t.bloqueada = patch.bloqueada === true;
    if (patch.travas && typeof patch.travas === 'object') t.travas = { texto: patch.travas.texto === true || (patch.travas.texto === undefined && !!t.travas?.texto), imagem: patch.travas.imagem === true || (patch.travas.imagem === undefined && !!t.travas?.imagem) };
    if (Object.keys(patch).some((k) => !['bloqueada', 'travas'].includes(k))) naoBloqueada(t);
    if (patch.textos && t.travas?.texto) throw U.erro('O texto desta tela está travado. Destrave para editar.', 'TRAVADA', 409);
    if (patch.foto && t.travas?.imagem && ('imagem_id' in patch.foto || 'foco' in patch.foto || 'enq' in patch.foto)) throw U.erro('A imagem e o enquadramento desta tela estão travados. Destrave para trocar.', 'TRAVADA', 409);
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
      if (['auto', 'centro', 'topo', 'baixo', 'esquerda', 'direita'].includes(patch.foto.enq)) { t.foto = { ...(t.foto || {}), enq: patch.foto.enq }; if (patch.foto.enq === 'auto') delete t.foto.foco; }
      if (patch.foto.foco && Number.isFinite(Number(patch.foto.foco.x)) && Number.isFinite(Number(patch.foto.foco.y))) t.foto = { ...(t.foto || {}), foco: { x: Math.min(1, Math.max(0, Number(patch.foto.foco.x))), y: Math.min(1, Math.max(0, Number(patch.foto.foco.y))) } };
      if ('forma' in patch.foto && [null, 'retangulo', 'arco', 'circulo', 'inclinado', 'print'].includes(patch.foto.forma)) t.foto = { ...(t.foto || {}), forma: patch.foto.forma };
    }
    if (patch.meta && typeof patch.meta === 'object') for (const k of ['informacao_nova', 'relacao_anterior']) if (typeof patch.meta[k] === 'string') { if (t.travas?.texto) throw U.erro('O texto desta tela está travado.', 'TRAVADA', 409); t[k] = U.limita(patch.meta[k], 240); }
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
    if (Padrao.ehV1(doc.template)) {
      if (doc.telas.length <= 5) throw U.erro('O padrão precisa de pelo menos 5 telas.', 'ENTRADA', 400);
      if (!Metodo.FUNCOES_MIN[t.funcao]?.opcional) throw U.erro('Só dá para tirar a tela de problema ou a do segundo mecanismo; as outras sustentam o argumento.', 'ENTRADA', 400);
    } else {
      if (doc.telas.length <= 7) throw U.erro('O carrossel precisa de pelo menos 7 telas.', 'ENTRADA', 400);
      if (!Serie.OMITIVEIS.includes(t.funcao)) throw U.erro('Só dá para tirar a tela de tensão ou a de estratégia; as outras sustentam a história.', 'ENTRADA', 400);
    }
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
  if (reg.doc.telas[i].travas?.texto) throw U.erro('O texto desta tela está travado: destrave para regenerar.', 'TRAVADA', 409);
  const r = minimalista(reg.doc) ? await Metodo.regenerarTelaMin(op, reg.doc, i, { instrucao, campo, deps }) : await Historia.regenerarTela(op, reg.doc, i, { instrucao, campo, deps });
  const out = await editarTela(id, n, { textos: r.textos });
  return { ...out, regeneracao: { tentativas: r.tentativas, com_problemas: !!r.com_problemas, erros: r.erros || [] } };
}
async function adicionarImagem(id, dados) {
  const reg = await store.obter('carrossel', id); if (!reg) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const achado = await Fotos.deUsuario(dados);
  return mutar(id, async (doc) => { const novoId = `im${(doc.imagens || []).reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0) + 1}`; const reg2 = await Fotos.guardar(store, id, achado, novoId); (doc.imagens ||= []).push(reg2); if (dados.tela) { const i = indiceDaTela(doc, dados.tela); naoBloqueada(doc.telas[i]); if (doc.telas[i].travas?.imagem) throw U.erro('A imagem desta tela está travada.', 'TRAVADA', 409); doc.telas[i].foto = { ...(doc.telas[i].foto || {}), imagem_id: novoId, manual: true, forma: dados.papel === 'print' ? 'print' : (doc.telas[i].foto?.forma || null) }; } }, { motivo: 'imagem enviada' });
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

// Converte um carrossel antigo (editorial, minimalista anterior ou série antiga) em uma NOVA versão no padrão v1.
// O antigo não muda: fica no histórico, legível e exportável. A nova versão refaz briefing, ganchos e telas a partir da
// mesma pesquisa verificada (a conversão não copia texto antigo para não herdar o formato).
async function converterParaPadrao(id, { deps = {}, agora = Date.now(), rascunho = null } = {}) {
  const reg = await store.obter('carrossel', id); if (!reg) throw U.erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  if (Padrao.ehV1(reg.doc.template)) throw U.erro('Este carrossel já está no padrão novo.', 'ENTRADA', 409);
  const op = await carregarOp(reg.doc.op_id);
  let v = Math.max(reg.doc.versao || 1, ...(op.carrosseis || []).map((c) => Number(String(c).split('_v').pop()) || 0)) + 1;
  while (await store.obter('carrossel', idDe(op.id, v))) v += 1;
  const novo = await gerar(op.id, { deps, agora, versao: v, permitirBaixa: true, origem: 'conversao', template: Padrao.ID, convertidoDe: id, rascunho });
  try { await store.atualizar('carrossel', id, (d) => { (d.historico ||= []).push({ em: new Date(agora).toISOString(), evento: 'convertido', detalhe: { para: novo.id, padrao: Padrao.ID } }); d.convertido_para = novo.id; return d; }); } catch { /* o antigo continua igual se não der para anotar */ }
  return novo;
}

module.exports = { converterParaPadrao, atribuirImagensV1, avaliarCandidato, extrasV1, creditosDe, gerar, editarTela, escolherCapa, editarCapa, reordenar, remover, editarLegenda, regenerarTela, adicionarImagem, confirmarPermissao, restaurarVersao, exportar, renderizar, montarPacote, fichaDaSerie, atribuirImagens, exigirVerificada, hashDaVersao, idDe, chaveSlide, chaveZip, fechar };
