// Série "Negócios que você não viu": estrutura das telas, textos editáveis e validação.
// A validação separa dois grupos, de propósito:
//   BLOQUEIOS  → falhas objetivas (fato sem sustento, contradição, handle errado, texto cortado, arquivo inválido…). Impedem "pronto".
//   SUGESTÕES  → julgamento editorial (capa genérica, explicação longa, repetição…). Aparecem para o Pedro decidir; nunca bloqueiam,
//                e nunca viram "nota de viralização": ninguém consegue prever isso, e uma nota alta não pode esconder falha factual.
const Copy = require('./copy');
const C = require('./config');
const N = require('./numeros');
const U = require('./util');
const { ACCOUNT } = require('../account');

const HANDLE = ACCOUNT.handle;

// Função de cada tela (estrutura de raciocínio, não títulos fixos) → composição padrão e as alternativas permitidas.
const FUNCOES = Object.freeze({
  descoberta: { rotulo: 'Descoberta', layout: 'manchete_produto', variante: 'meia_lua', permitidos: ['manchete_produto', 'foto_documental', 'quebra_azul'], imagem: 'produto ou estabelecimento em destaque' },
  tensao: { rotulo: 'Tensão', layout: 'contraste', permitidos: ['contraste', 'manchete_produto', 'quebra_azul'], imagem: 'o problema ou a perda, em situação real' },
  revelacao: { rotulo: 'Revelação', layout: 'foto_documental', permitidos: ['foto_documental', 'manchete_produto'], imagem: 'a solução funcionando na prática' },
  dinheiro: { rotulo: 'Dinheiro', layout: 'foto_documental', estilo: { cor: 'azul', marca: 'circulo', barra: false }, permitidos: ['foto_documental', 'contraste', 'quebra_azul'], imagem: 'quem paga e como recebe (cliente, caixa, tela do app)' },
  evidencia: { rotulo: 'Evidência', layout: 'evidencia', permitidos: ['evidencia', 'foto_documental'], imagem: 'uso real, print verdadeiro do app ou documento' },
  estrategia: { rotulo: 'Estratégia e dificuldade', layout: 'quebra_azul', permitidos: ['quebra_azul', 'contraste', 'foto_documental'], imagem: 'a operação por trás do modelo' },
  licao: { rotulo: 'Lição prática', layout: 'manchete_produto', variante: 'canto', permitidos: ['manchete_produto', 'quebra_azul', 'foto_documental'], imagem: 'o ponto de partida para um teste pequeno' },
  pedro: { rotulo: 'Pedro e continuidade', layout: 'encerramento_pedro', permitidos: ['encerramento_pedro'], imagem: 'foto aprovada do Pedro' },
});
const ORDEM = ['descoberta', 'tensao', 'revelacao', 'dinheiro', 'evidencia', 'estrategia', 'licao', 'pedro'];
const OMITIVEIS = ['tensao', 'estrategia'];                   // o que dá para tirar quando a história fica melhor com 7 telas
const LIMITES = Object.freeze({ rotulo: 56, titulo: 130, linha2: 70, apoio: 170, nota: 110, palavra: 14, legenda: 70, corpo: 600 });
const CAMPOS = Object.freeze(Object.keys(LIMITES));
const ANGULOS = Object.freeze({
  contradicao: 'Contradição: algo que parece não fazer sentido, mas é o negócio',
  situacao: 'Situação concreta: uma cena do dia a dia que o leitor reconhece',
  descoberta: 'Descoberta: o que a empresa fez que quase ninguém percebeu',
});
const ABERTURAS_PROIBIDAS = ['conheca a empresa', 'conheca o ', 'voce sabia que', 'no mundo dos negocios', 'uma solucao inovadora', 'descubra o poder'];
const JARGAO = ['marketplace', 'saas', 'mvp', 'b2b', 'b2c', 'churn', 'onboarding', 'growth', 'unicornio', 'ticket medio', 'startup', 'fintech', 'escalavel', 'monetizacao'];
const HIPOTESE = /\b(hipotese|hipoteses|testar|teste|poderia|talvez|pode ser|primeiro|simular)\b/;
const PARECIDOS = /\b(incrivel|revolucion|inovador|surpreendente|fantastic|extraordinari|poderos)/;

const sem = (s) => U.semAcento(s).toLowerCase().replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const limpaTxt = (x, max) => U.limita(String(x ?? '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim(), max);

// Texto de todos os campos informativos de uma tela (a palavra gigante é só decoração: repete algo que já está no texto).
function textoDaTela(t, ctx = {}) {
  const x = t.textos || {}; const partes = [x.rotulo, x.titulo, x.linha2, x.apoio, x.nota, x.legenda];
  const cl = ctx.claims?.[x.claim_id]; if (cl) { partes.push(cl.valor_exibicao); if (cl.atribuicao) partes.push(cl.atribuicao); }
  return partes.filter(Boolean).join(' ').replace(/\*\*/g, '');
}
const palavrasDaTela = (t, ctx) => U.contaPalavras(textoDaTela(t, ctx));
const claimsPorId = (op) => Object.fromEntries(Copy.claimsUsaveis(op).map((c) => [c.id, c]));

// Telas padrão a partir de um mapa { funcao: textos }.
function telaPadrao(funcao, textos = {}, { id = null, foto = null } = {}) {
  const f = FUNCOES[funcao]; if (!f) throw U.erro(`Função de tela desconhecida: ${funcao}`, 'ENTRADA');
  const limpos = {}; for (const k of CAMPOS) if (textos[k] != null && String(textos[k]).trim()) limpos[k] = limpaTxt(textos[k], LIMITES[k] + 40);
  if (textos.claim_id) limpos.claim_id = String(textos.claim_id);
  return { id: id || `t_${funcao}`, funcao, layout: f.layout, ...(f.variante ? { variante: f.variante } : {}), ...(f.estilo ? { estilo: { ...f.estilo } } : {}), textos: limpos, foto: foto || { imagem_id: null, enq: 'auto', forma: null }, notas_imagem: f.imagem, bloqueada: false };
}

// ── Capa: três opções com ângulos diferentes ──────────────────────────────────
function normalizarCapas(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 3).map((c, i) => ({
    id: `capa_${i + 1}`, angulo: ANGULOS[c?.angulo] ? c.angulo : Object.keys(ANGULOS)[i],
    titulo: limpaTxt(c?.titulo, LIMITES.titulo + 40), apoio: limpaTxt(c?.apoio, LIMITES.apoio + 40), rotulo: limpaTxt(c?.rotulo || C.SERIE_NOVA, LIMITES.rotulo),
  }));
}

// ── Legenda ───────────────────────────────────────────────────────────────────
const ENCERRAMENTO = (v) => `Segue ${HANDLE} para descobrir negócios que já funcionam no mundo.${v ? '' : ''}`;
function montarLegenda({ partes = {}, hashtags = [] }, op) {
  const usaveis = Copy.claimsUsaveis(op); const erros = [];
  const l = (k, max) => { const v = Copy.repararAtribuicao(String(partes[k] ?? '').replace(/\s+/g, ' ').trim(), usaveis); if (!v) erros.push(`Legenda: faltou “${k}”`); if (v.length > max) erros.push(`Legenda: “${k}” tem ${v.length} caracteres (máximo ${max})`); return v; };
  const primeira = l('primeira_linha', 120); const historia = l('historia', 220); const dinheiro = l('como_ganha', 200); const brasil = l('brasil', 200);
  const tags = [...new Set((Array.isArray(hashtags) ? hashtags : []).map((h) => `#${String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => /^#[\p{L}\p{N}_]{3,30}$/u.test(h)))].slice(0, 3);
  const aviso = 'Isso é um modelo de negócio, não uma promessa de lucro: teste pequeno antes de investir.';
  const texto = [primeira, '', `${historia} ${dinheiro}`.trim(), brasil, '', aviso, '', ENCERRAMENTO(), '', tags.join(' ')].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texto, tags, erros, partes: { primeira_linha: primeira, historia, como_ganha: dinheiro, brasil } };
}

// ── Validação ─────────────────────────────────────────────────────────────────
function B(codigo, mensagem, tela = null) { return { codigo, mensagem, tela }; }
// doc: { telas, capa_escolhida, legenda, imagens, render }. op: oportunidade (com verificacao.claims).
const semAviso = (t) => String(t || '').replace(/n[ãa]o\s+(é|e|uma)\s+(uma\s+)?promessa\s+de\s+lucro\.?/gi, ' ').replace(/n[ãa]o\s+[ée]\s+(uma\s+)?promessa\s+de\s+lucro\.?/gi, ' ');
function validar(doc, op, { renders = null } = {}) {
  const bloqueios = []; const sugestoes = []; const usaveis = Copy.claimsUsaveis(op); const claims = claimsPorId(op);
  const telas = doc.telas || []; const n = telas.length; const ctx = { claims };
  const rot = (i) => `Tela ${i + 1}`;
  if (![7, 8].includes(n)) bloqueios.push(B('QTD_TELAS', `O carrossel tem ${n} telas; o padrão é 8 (ou 7, quando a história fica melhor).`));
  telas.forEach((t, i) => {
    const txtCompleto = textoDaTela(t, ctx); const txt = semAviso(txtCompleto); const nome = rot(i);
    // fatos
    const semProva = Copy.numerosNaoComprovados(txt, usaveis, { permitirContagem: t.funcao === 'licao' });
    if (semProva.length) bloqueios.push(B('NUMERO_SEM_FONTE', `${nome}: número sem comprovação (${semProva.join(', ')}). Só números de afirmações verificadas podem aparecer.`, i + 1));
    const falta = Copy.atribuicaoFaltando(txt, usaveis); if (falta.length) bloqueios.push(B('SEM_ATRIBUICAO', `${nome}: o número vem de “${falta[0]}”; escreva a atribuição na própria tela.`, i + 1));
    Copy.dinheiroNaCapa(txt, usaveis).forEach((e) => bloqueios.push(B('VALOR_SEM_DADO', `${nome}: ${e}`, i + 1)));
    if (/\blucr(o|a|ativ)/i.test(U.semAcento(txt)) && !usaveis.some((c) => c.tipo === 'lucro') ) bloqueios.push(B('LUCRO_SEM_DADO', `${nome}: fala em lucro, mas nenhum dado de lucro foi confirmado. Chame de “modelo de negócio”.`, i + 1));
    const s = sem(txt);
    for (const f of C.ABSOLUTOS_NAO_PROVAVEIS) if (s.includes(f)) bloqueios.push(B('AFIRMACAO_IMPROVAVEL', `${nome}: “${f}” não dá para provar.`, i + 1));
    if (/\bninguem\b[^.]*\bbrasil\b/.test(s)) bloqueios.push(B('AFIRMACAO_IMPROVAVEL', `${nome}: não afirme que ninguém faz isso no Brasil sem pesquisa suficiente.`, i + 1));
    for (const h of (String(txt).match(/@[\w.]+/g) || [])) if (h.toLowerCase() !== HANDLE.toLowerCase()) bloqueios.push(B('HANDLE_ERRADO', `${nome}: o @ “${h}” não é ${HANDLE}.`, i + 1));
    // composição
    if (t.layout === 'evidencia') { const cl = claims[t.textos?.claim_id]; if (!cl || cl.numero === null || !cl.valor_exibicao) bloqueios.push(B('EVIDENCIA_SEM_DADO', `${nome}: a tela de evidência precisa apontar para um dado verificado com número.`, i + 1)); }
    if (t.layout === 'encerramento_pedro' && i !== n - 1) bloqueios.push(B('PEDRO_FORA_DO_FIM', `${nome}: a foto do Pedro só pode aparecer no encerramento.`, i + 1));
    if (i === n - 1 && t.layout !== 'encerramento_pedro') bloqueios.push(B('SEM_ENCERRAMENTO', `${nome}: a última tela precisa ser o encerramento do Pedro.`, i + 1));
    if (t.funcao === 'licao' && /\bbrasil|brasileir/.test(s) && !HIPOTESE.test(s)) bloqueios.push(B('BRASIL_SEM_HIPOTESE', `${nome}: adaptação ao Brasil precisa estar identificada como hipótese para testar.`, i + 1));
    // render
    const m = doc.render?.[i]?.metricas || renders?.[i]?.metrics;
    if (m && m.cabe === false) (m.problemas || ['texto não cabe']).forEach((p) => bloqueios.push(B('TEXTO_NAO_CABE', `${nome}: ${p}`, i + 1)));
    // sugestões
    const pal = palavrasDaTela(t, ctx);
    if (!['evidencia', 'encerramento_pedro'].includes(t.layout) && pal > 45) sugestoes.push(B('EXPLICACAO_LONGA', `${nome}: ${pal} palavras. Telas de 15 a 40 palavras leem melhor no celular.`, i + 1));
    if (!['evidencia', 'encerramento_pedro'].includes(t.layout) && pal < 10) sugestoes.push(B('POUCO_CONTEUDO', `${nome}: só ${pal} palavras. Falta acrescentar algo novo nesta tela.`, i + 1));
    for (const f of C.FRASES_PROIBIDAS) if (s.includes(f)) sugestoes.push(B('FRASE_GASTA', `${nome}: a frase “${f.trim()}” soa genérica.`, i + 1));
    for (const j of JARGAO) if (new RegExp(`\\b${j}\\b`).test(s)) sugestoes.push(B('JARGAO', `${nome}: “${j}” é termo técnico. Explique em palavras simples (ex.: “um aplicativo que conecta quem vende a quem quer comprar”).`, i + 1));
    if (doc.imagens && t.foto?.imagem_id) { const im = doc.imagens.find((x) => x.id === t.foto.imagem_id); if (im && im.permissao !== 'confirmada') sugestoes.push(B('PERMISSAO_IMAGEM', `${nome}: confirme o direito de uso da imagem (${im.credito || im.origem?.dominio || 'origem'}) antes de postar.`, i + 1)); }
    if (!t.foto?.imagem_id && ['foto_documental', 'quebra_azul', 'evidencia', 'manchete_produto', 'contraste'].includes(t.layout) && doc.render?.[i]?.metricas?.sem_imagem) sugestoes.push(B('SEM_IMAGEM', `${nome}: sem imagem adequada (${FUNCOES[t.funcao]?.imagem || 'imagem real'}). Envie ou troque a foto; a tela não usa imagem genérica para disfarçar a falta.`, i + 1));
  });
  // imagens: origem e falsificação
  (doc.imagens || []).forEach((im) => {
    if (['print', 'documento'].includes(im.papel) && !im.origem?.url_pagina && !im.origem?.declaracao) bloqueios.push(B('PRINT_SEM_ORIGEM', `A imagem “${im.descricao || im.id}” está como ${im.papel}, mas não tem origem. Print precisa ser verdadeiro e rastreável.`));
    if (im.tipo === 'ia') bloqueios.push(B('IMAGEM_GERADA', `A imagem “${im.descricao || im.id}” foi gerada por IA e não pode ser usada como foto, print ou documento.`));
    if (!im.origem?.url_imagem && !im.origem?.declaracao && im.tipo !== 'pedro') bloqueios.push(B('IMAGEM_SEM_ORIGEM', `A imagem “${im.descricao || im.id}” não tem origem registrada.`));
  });
  // a tela de dinheiro precisa de modelo de cobrança sustentado
  const iDin = telas.findIndex((t) => t.funcao === 'dinheiro');
  if (iDin >= 0 && !usaveis.some((c) => ['modelo_receita', 'preco'].includes(c.tipo))) bloqueios.push(B('MODELO_SEM_FONTE', `Tela ${iDin + 1}: nenhuma fonte verificada diz como a empresa cobra (modelo de receita ou preço). Sem isso a tela de dinheiro seria opinião.`, iDin + 1));
  // contradição capa × legenda × telas: os mesmos testes valem para a legenda
  const leg = semAviso(doc.legenda?.texto ?? doc.legenda ?? '').replace(/Isso é um modelo de negócio, não uma promessa de lucro[^.]*\./i, ' ');
  if (leg) {
    const sp = Copy.numerosNaoComprovados(leg, usaveis); if (sp.length) bloqueios.push(B('NUMERO_SEM_FONTE', `Legenda: número sem comprovação (${sp.join(', ')}).`));
    const f = Copy.atribuicaoFaltando(leg, usaveis); if (f.length) bloqueios.push(B('SEM_ATRIBUICAO', `Legenda: o número vem de “${f[0]}”; escreva a atribuição.`));
    Copy.dinheiroNaCapa(leg, usaveis).forEach((e) => bloqueios.push(B('VALOR_SEM_DADO', `Legenda: ${e}`)));
    for (const h of (String(leg).match(/@[\w.]+/g) || [])) if (h.toLowerCase() !== HANDLE.toLowerCase()) bloqueios.push(B('HANDLE_ERRADO', `Legenda: o @ “${h}” não é ${HANDLE}.`));
    for (const f2 of C.ABSOLUTOS_NAO_PROVAVEIS) if (sem(leg).includes(f2)) bloqueios.push(B('AFIRMACAO_IMPROVAVEL', `Legenda: “${f2}” não dá para provar.`));
    if (String(leg).length > 700) sugestoes.push(B('LEGENDA_LONGA', `A legenda tem ${String(leg).length} caracteres. Até 700 funciona melhor.`));
    if (((String(leg).match(/#[\p{L}\p{N}_]+/gu)) || []).length > 3) sugestoes.push(B('HASHTAGS', 'Use no máximo 3 hashtags.'));
    const comum = (a, b) => { const A1 = new Set(sem(a).split(/\W+/).filter((w) => w.length > 4)); const B1 = sem(b).split(/\W+/).filter((w) => w.length > 4); return B1.length ? B1.filter((w) => A1.has(w)).length / B1.length : 0; };
    const todas = telas.map((t) => textoDaTela(t, ctx)).join(' '); if (comum(todas, leg) > 0.75) sugestoes.push(B('LEGENDA_REPETE', 'A legenda repete quase tudo o que está nas telas. Ela deve complementar.'));
  }
  // editorial: capa, repetição, variedade, encerramento
  const capa = telas[0]; if (capa) {
    const sc = sem(textoDaTela(capa, ctx)); const palc = palavrasDaTela(capa, ctx);
    if (ABERTURAS_PROIBIDAS.some((a) => sc.startsWith(a)) || PARECIDOS.test(sc)) sugestoes.push(B('CAPA_GENERICA', 'A capa começa com fórmula pronta ou adjetivo vazio. Abra com uma situação concreta ou uma contradição.', 1));
    else if (palc < 7) sugestoes.push(B('CAPA_GENERICA', 'A capa tem pouca informação. Mostre a situação concreta que desperta curiosidade.', 1));
    if (!/[?!]/.test(capa.textos?.titulo || '') && !/(com|sem|em vez de|mesmo|ganha|vende|cobra|paga|transform|virou|vira|faz)\b/.test(sc)) sugestoes.push(B('FALTA_SURPRESA', 'A capa não mostra uma contradição ou virada. Pergunte: “o que faz alguém parar de rolar?”', 1));
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = telas[i]; const b = telas[j]; if (['encerramento_pedro'].includes(a.layout) || ['encerramento_pedro'].includes(b.layout)) continue;
    const wa = new Set(sem(a.textos?.titulo || '').split(/\W+/).filter((w) => w.length > 3)); const wb = sem(b.textos?.titulo || '').split(/\W+/).filter((w) => w.length > 3);
    if (wb.length >= 3 && wb.filter((w) => wa.has(w)).length / wb.length >= 0.7) sugestoes.push(B('REPETICAO', `As telas ${i + 1} e ${j + 1} repetem a mesma ideia. Cada tela deve acrescentar algo.`, j + 1));
  }
  const layouts = telas.map((t) => t.layout);
  if (new Set(layouts).size < 4 && n >= 7) sugestoes.push(B('POUCA_VARIEDADE', `Só ${new Set(layouts).size} composições diferentes em ${n} telas. Varie conforme a função de cada tela.`));
  for (let i = 2; i < n; i++) if (layouts[i] === layouts[i - 1] && layouts[i] === layouts[i - 2]) { sugestoes.push(B('POUCA_VARIEDADE', `Três telas seguidas com a mesma composição (a partir da ${i - 1}).`, i + 1)); break; }
  const usoImg = {}; telas.forEach((t) => { if (t.foto?.imagem_id) usoImg[t.foto.imagem_id] = (usoImg[t.foto.imagem_id] || 0) + 1; });
  Object.entries(usoImg).forEach(([id, k]) => { if (k > 2) sugestoes.push(B('IMAGEM_REPETIDA', `A mesma imagem aparece ${k} vezes. Troque para que cada foto acrescente informação.`)); });
  const ult = telas[n - 1]; if (ult && ult.layout === 'encerramento_pedro') { const su = sem(`${ult.textos?.titulo || ''} ${ult.textos?.apoio || ''}`); if (!/(negocio|ideia)/.test(su) || !/(funcion|mundo|descobr|proxim)/.test(su)) sugestoes.push(B('CTA_SEM_RAZAO', `Diga por que seguir: “Segue ${HANDLE} para descobrir negócios que já funcionam no mundo.”`, n)); }
  const texto = telas.map((t) => textoDaTela(t, ctx)).join(' ');
  if ((texto.match(/(curta|salve|comente|compartilhe)/gi) || []).length >= 3) sugestoes.push(B('CTA_EXCESSIVO', 'Muitos pedidos (curtir, salvar, comentar, compartilhar). Peça uma coisa só: seguir.'));
  const unicos = (arr) => { const v = new Set(); return arr.filter((x) => { const k = `${x.codigo}|${x.tela}|${x.mensagem}`; if (v.has(k)) return false; v.add(k); return true; }); };
  const bl = unicos(bloqueios); const sg = unicos(sugestoes);
  return { ok: bl.length === 0, bloqueios: bl, sugestoes: sg, resumo: { bloqueios: bl.length, sugestoes: sg.length, palavras_por_tela: telas.map((t) => palavrasDaTela(t, ctx)), composicoes: [...new Set(layouts)].length } };
}

module.exports = { FUNCOES, ORDEM, OMITIVEIS, LIMITES, CAMPOS, ANGULOS, HANDLE, ENCERRAMENTO, telaPadrao, normalizarCapas, montarLegenda, textoDaTela, palavrasDaTela, claimsPorId, validar, limpaTxt };
