// Ficha da história e copy da série "Negócios que você não viu".
// Fluxo: história real (ficha com evidência) → três capas com ângulos diferentes → telas → legenda.
// A IA só PROPÕE: o código confere que cada número vem de uma afirmação verificada, que há atribuição quando o dado é da empresa,
// que a hipótese para o Brasil é hipótese e que a estrutura cabe nas composições. O mesmo rascunho pode vir de um humano
// (entrada manual): passa exatamente pelas mesmas conferências.
const llmJson = require('../llmJson');
const Copy = require('./copy');
const Serie = require('./serie');
const C = require('./config');
const U = require('./util');

const claimsUsaveis = (op) => Copy.claimsUsaveis(op);
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : null);

// Registro da pesquisa: o que o Pedro precisa saber ANTES de ler a copy. Cada campo diz se tem sustento nas fontes.
function montarFicha(op, rascunho = {}, { origem = 'ia', agora = Date.now() } = {}) {
  const usaveis = claimsUsaveis(op); const f = rascunho || {};
  const txt = (x, n = 320) => U.limita(x, n);
  const evid = (Array.isArray(f.evidencia) ? f.evidencia : []).map((e) => ({ ...e, c: usaveis.find((c) => c.id === String(e?.claim_id)) })).filter((e) => e.c).map((e) => ({
    claim_id: e.c.id, valor: e.c.valor_exibicao || null, tipo: e.c.tipo, afirmacao: e.c.texto, atribuicao: e.c.atribuicao || null, veiculo: e.c.veiculo, url: e.c.url, data_publicacao: fmtData(e.c.data_publicacao), trecho: e.c.trecho, nota: txt(e.nota, 200),
  }));
  const temModelo = usaveis.some((c) => ['modelo_receita', 'preco'].includes(c.tipo));
  const temProduto = usaveis.some((c) => c.tipo === 'produto');
  const lacunas = [];
  if (!temModelo) lacunas.push('Como cobra: nenhuma fonte verificada confirma o modelo de cobrança. A tela de dinheiro fica bloqueada até haver fonte.');
  if (!evid.length) lacunas.push('Evidência: nenhum dado verificado foi apontado.');
  if (!temProduto) lacunas.push('O que o produto faz: descrito com base no resumo da pesquisa, sem trecho de fonte que o comprove.');
  if (!op.verificacao?.fonte_oficial) lacunas.push('Não há fonte oficial lida: números só valem com duas fontes independentes.');
  return {
    empresa: op.nome, pais: op.pais, categoria: op.categoria, site_oficial: op.verificacao?.fonte_oficial?.url || null,
    problema: txt(f.problema || op.problema), quem_compra: txt(f.quem_compra), por_que_compra: txt(f.por_que_compra), como_cobra: txt(f.como_cobra || op.como_ganha_dinheiro),
    evidencia: evid, surpresa: txt(f.surpresa), dificuldades: (Array.isArray(f.dificuldades) ? f.dificuldades : []).map((x) => {
      // uma dificuldade pode apontar para uma afirmação conferida no texto lido (mesmo a que, sozinha, não libera número): a fonte fica registrada
      if (x && typeof x === 'object') { const c = (op.verificacao?.claims || []).find((k) => k.id === String(x.claim_id)); return { texto: txt(x.texto, 220), ...(c ? { claim_id: c.id, veiculo: c.veiculo, url: c.url, trecho: c.trecho, fonte_unica: !c.usavel } : {}) }; }
      return { texto: txt(x, 220) };
    }).filter((x) => x.texto).slice(0, 4),
    inspiracao_brasil: txt(f.inspiracao_brasil || op.adaptacao_brasil), hipotese_brasil: true,
    imagens_necessarias: (Array.isArray(f.imagens_necessarias) ? f.imagens_necessarias : []).map((i) => ({ funcao: String(i?.funcao || ''), mostrar: txt(i?.mostrar, 160) })).filter((i) => Serie.FUNCOES[i.funcao]).slice(0, 8),
    ilustracao: f.ilustracao?.consulta ? { consulta: txt(f.ilustracao.consulta, 80), descricao: txt(f.ilustracao.descricao, 80) } : null,
    lacunas, fontes: (op.verificacao?.fontes || []).map((x) => ({ veiculo: x.veiculo, url: x.url, classe: x.classe, publicada_em: fmtData(x.publicada_em) })),
    gerada_em: new Date(agora).toISOString(), origem,
  };
}
// Campos de texto da ficha que não podem trazer número sem fonte nem promessa.
function validarFicha(ficha, op) {
  const erros = []; const usaveis = claimsUsaveis(op);
  const campos = { problema: ficha.problema, quem_compra: ficha.quem_compra, por_que_compra: ficha.por_que_compra, como_cobra: ficha.como_cobra, surpresa: ficha.surpresa, inspiracao_brasil: ficha.inspiracao_brasil, dificuldades: ficha.dificuldades.map((d) => d.texto).join(' ') };
  for (const [k, v] of Object.entries(campos)) {
    if (!v) { if (['problema', 'como_cobra', 'surpresa'].includes(k)) erros.push(`Ficha: faltou “${k}”`); continue; }
    const sp = Copy.numerosNaoComprovados(v, usaveis, { permitirContagem: true }); if (sp.length) erros.push(`Ficha (${k}): número sem comprovação (${sp.join(', ')})`);
    erros.push(...Copy.checarTexto(v, `Ficha (${k})`));
  }
  return erros;
}

// ── Pedido à IA ────────────────────────────────────────────────────────────────
const SISTEMA = `Você é redator e diretor de arte editorial do perfil @pedro_destrava e escreve a série “Negócios que você não viu”: carrosséis de Instagram de DESCOBERTA de negócios (aplicativos, SaaS, startups, produtos e modelos de receita que já funcionam no Brasil ou no exterior) para quem ainda NÃO segue o perfil.
O leitor deve pensar: 1) “Como eu nunca ouvi falar disso?”; 2) “Agora entendi como esse negócio ganha dinheiro”; 3) “Quero descobrir o próximo”. Não é apresentação empresarial nem aula: é uma história interessante que ensina sem parecer aula. Nunca prometa viralização, lucro ou que vai funcionar no Brasil.

VOZ: uma pessoa contando uma descoberta a um amigo. Português brasileiro simples e natural, sem termo técnico sem explicar (em vez de “marketplace”: “um aplicativo que conecta quem vende a quem quer comprar”). Frases curtas, mas completas: não vire tudo slogan. NUNCA comece com “Conheça a empresa”, “Você sabia que”, “No mundo dos negócios”, “Uma solução inovadora”, “Descubra o poder”. Sem emoji. Cada tela acrescenta algo novo; nunca repita a manchete com outras palavras.
FATOS: use SOMENTE o que está em DADOS_VERIFICADOS e em negocio. Nunca invente nem arredonde número, nome, citação, preço ou fonte. Receita não é lucro; investimento não é receita; valuation não é caixa; usuários cadastrados não são usuários ativos nem clientes pagantes; downloads não provam demanda; resultado no exterior não garante sucesso no Brasil. Se o dado é da própria empresa, escreva “segundo a empresa” (ou “segundo a [nome]”) na MESMA tela do número. Sem prova de lucro, é “modelo de negócio”, não “negócio lucrativo”. Não diga “ninguém faz isso no Brasil”. Brasil é HIPÓTESE (“poderia começar por…”).
DESTAQUE: em manchetes, marque UMA expressão curta com **assim**.

PRIMEIRO escreva a FICHA (pesquisa): problema que resolve, quem compra e por quê, como cobra (só o que as fontes dizem), evidência (claim_id dos dados verificados), o aspecto surpreendente, dificuldades/limitações reais, e a inspiração para um teste no Brasil (hipótese). Depois três CAPAS de ângulos diferentes: contradicao (algo que parece não fazer sentido), situacao (uma cena concreta do dia a dia) e descoberta (o que a empresa fez que quase ninguém percebeu). Cada capa: titulo (6 a 16 palavras, com **destaque**; sem ? e sem !; dinheiro só com dado verificado) e apoio (3 a 12 palavras que continuam a frase).
DEPOIS as telas, cada uma com cerca de 15 a 40 palavras no total (uma ideia central). Campos por função (texto puro; só os campos listados):
- descoberta: titulo, apoio  (a capa escolhida; use a capa 1 aqui)
- tensao: rotulo (3 a 6 palavras), titulo (1 frase curta), linha2 (frase curta que vira a ideia), apoio (10 a 22 palavras: o problema ou a perda), palavra (UMA palavra que já está no texto, ex.: “Sobrou.”)
- revelacao: rotulo (use **Nome da empresa** em destaque), titulo (com **destaque**), apoio (12 a 25 palavras: quem encontrou a solução e como funciona na prática)
- dinheiro: rotulo (ex.: “Onde está o dinheiro?”), titulo (3 frases curtas: o cliente, a loja/parceiro e o app; destaque em **quem cobra**), apoio (até 18 palavras: pelo que paga e como a empresa recebe; só com fonte)
- evidencia: rotulo, claim_id (id de um dado verificado COM número), legenda (o que o número mede, ex.: “de usuários cadastrados.”), apoio (contexto com atribuição; pode citar outro dado verificado)
- estrategia: rotulo, titulo (a virada, com **destaque**), apoio (a dificuldade real que impede de ser dinheiro fácil)
- licao: rotulo, titulo (com **destaque**), apoio (3 pequenas frases: o que testar primeiro), nota (“Não é promessa de lucro. É uma hipótese para testar.”), palavra (uma palavra de efeito, ex.: “Antes”)
- pedro: titulo (conclusão com personalidade e **destaque**; ex.: “Tem negócio bom escondido em **problema que todo mundo ignora.**”), apoio (convite específico; padrão: “para descobrir negócios que já funcionam no mundo.”, pode variar mantendo a proposta). Não peça curtir, salvar, comentar e compartilhar: só seguir.
Se a história ficar melhor com 7 telas, omita tensao ou estrategia (omitir: “tensao” | “estrategia” | null).
LEGENDA (complementar, sem repetir as telas): primeira_linha (até 110 caracteres), historia (até 200), como_ganha (até 180), brasil (hipótese, até 180); até 3 hashtags.
IMAGENS: em imagens_necessarias diga, por função, O QUE a imagem precisa mostrar (produto, estabelecimento, uso real, print do app). Em ilustracao dê uma consulta curta em inglês para uma foto de licença aberta que mostre o PROBLEMA em geral (não a empresa), ex.: {"consulta":"unsold bread bakery","descricao":"pães que sobram"}.

Responda APENAS JSON:
{"ficha":{"problema":"","quem_compra":"","por_que_compra":"","como_cobra":"","evidencia":[{"claim_id":"c1","nota":""}],"surpresa":"","dificuldades":[""],"inspiracao_brasil":"","imagens_necessarias":[{"funcao":"descoberta","mostrar":""}],"ilustracao":{"consulta":"","descricao":""}},"capas":[{"angulo":"contradicao","titulo":"","apoio":""},{"angulo":"situacao","titulo":"","apoio":""},{"angulo":"descoberta","titulo":"","apoio":""}],"capa_escolhida":1,"omitir":null,"telas":[{"funcao":"descoberta","titulo":"","apoio":""},{"funcao":"tensao","rotulo":"","titulo":"","linha2":"","apoio":"","palavra":""},{"funcao":"revelacao","rotulo":"","titulo":"","apoio":""},{"funcao":"dinheiro","rotulo":"","titulo":"","apoio":""},{"funcao":"evidencia","rotulo":"","claim_id":"","legenda":"","apoio":""},{"funcao":"estrategia","rotulo":"","titulo":"","apoio":""},{"funcao":"licao","rotulo":"","titulo":"","apoio":"","nota":"","palavra":""},{"funcao":"pedro","titulo":"","apoio":""}],"legenda":{"primeira_linha":"","historia":"","como_ganha":"","brasil":""},"hashtags":["",""]}`;

function dadosParaIa(op) {
  const base = Copy.dadosParaIa(op);
  return { ...base, FONTES: (op.verificacao?.fontes || []).map((f) => ({ veiculo: f.veiculo, classe: f.classe, url: f.url, data: fmtData(f.publicada_em) })), SITUACAO_FONTE_OFICIAL: op.verificacao?.fonte_oficial ? 'lida' : 'não lida (bloqueio ou ausência)' };
}

// ── Do rascunho (IA ou humano) para o documento do carrossel ──────────────────
// Devolve { telas, capas, capa_escolhida, ficha, legenda, hashtags, ilustracao, erros }. `erros` = o que impede de montar (estrutura); os
// problemas de conteúdo são avaliados depois por Serie.validar.
function montarDoRascunho(j, op, { origem = 'ia', agora = Date.now() } = {}) {
  const erros = []; const bruto = j || {};
  const capas = Serie.normalizarCapas(bruto.capas);
  if (capas.length < 3) erros.push('Faltam as três opções de capa (ângulos diferentes).');
  const escolhida = Math.min(Math.max(Number(bruto.capa_escolhida) || 1, 1), Math.max(capas.length, 1));
  const lista = Array.isArray(bruto.telas) ? bruto.telas : [];
  const omitir = Serie.OMITIVEIS.includes(bruto.omitir) ? bruto.omitir : null;
  const telas = [];
  for (const funcao of Serie.ORDEM) {
    if (funcao === omitir) continue;
    const t = lista.find((x) => x?.funcao === funcao);
    if (!t) { erros.push(`Faltou a tela “${funcao}”.`); continue; }
    const textos = {}; for (const k of [...Serie.CAMPOS, 'claim_id']) if (t[k] != null && String(t[k]).trim()) textos[k] = String(t[k]);
    const tela = Serie.telaPadrao(funcao, textos, { id: `t_${funcao}` });
    if (t.layout && Serie.FUNCOES[funcao].permitidos.includes(t.layout)) tela.layout = t.layout;
    if (t.variante) tela.variante = String(t.variante);
    if (t.estilo && typeof t.estilo === 'object') tela.estilo = { ...tela.estilo, ...t.estilo };
    telas.push(tela);
  }
  // a capa escolhida alimenta a tela 1
  const capa = capas[escolhida - 1]; if (capa && telas[0]) { telas[0].textos = { ...telas[0].textos, rotulo: capa.rotulo, titulo: capa.titulo, ...(capa.apoio ? { apoio: capa.apoio } : {}) }; }
  const ficha = montarFicha(op, bruto.ficha, { origem, agora });
  const leg = Serie.montarLegenda({ partes: bruto.legenda || {}, hashtags: bruto.hashtags || [] }, op);
  erros.push(...leg.erros);
  return { telas, capas, capa_escolhida: capa?.id || null, ficha, legenda: leg.texto, partes_legenda: leg.partes, hashtags: leg.tags, ilustracao: ficha.ilustracao, erros };
}

// Erros de CONTEÚDO que fazem a IA tentar de novo (os mesmos bloqueios do validador + sugestões que mudam a escrita).
const SUGESTOES_QUE_REFAZEM = new Set(['FRASE_GASTA', 'JARGAO', 'EXPLICACAO_LONGA', 'POUCO_CONTEUDO', 'CAPA_GENERICA']);
function errosParaFeedback(r, v) {
  return [...r.erros, ...v.bloqueios.filter((b) => !['TEXTO_NAO_CABE', 'SEM_ENCERRAMENTO'].includes(b.codigo)).map((b) => b.mensagem), ...v.sugestoes.filter((s) => SUGESTOES_QUE_REFAZEM.has(s.codigo)).map((s) => s.mensagem)];
}

async function gerarRascunho(op, { deps = {}, tentativas = 3, feedback: fb0 = '', agora = Date.now() } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson; const usaveis = claimsUsaveis(op);
  if (!usaveis.some((c) => c.numero !== null && c.valor_exibicao)) throw U.erro('Sem número verificado não há tela de evidência: o carrossel não é gerado.', 'SEM_PROVA', 422);
  let feedback = fb0; let ultimo = null; const historico = [];
  for (let i = 1; i <= tentativas; i++) {
    const d = llmJson.dado('NEGOCIO', JSON.stringify(dadosParaIa(op)), 16000);
    const { dados, llm } = await pedir({ sistema: `${SISTEMA}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${d.bloco}\n${feedback ? `\nA VERSÃO ANTERIOR TEVE ESTES PROBLEMAS. Corrija todos sem perder o que estava bom:\n- ${feedback}\n` : ''}`, maxTokens: 4800, temperatura: i === 1 ? 0.6 : 0.35, budget: deps.budget });
    const r = montarDoRascunho(dados, op, { agora }); const v = Serie.validar({ telas: r.telas, legenda: r.legenda }, op);
    const erros = errosParaFeedback(r, v); const ficha = validarFicha(r.ficha, op);
    historico.push({ tentativa: i, erros: erros.length + ficha.length, llm });
    ultimo = { ...r, llm, erros_conteudo: [...erros, ...ficha] };
    if (!erros.length && !ficha.length) return { ...ultimo, tentativas: i, historico };
    feedback = [...new Set([...erros, ...ficha])].slice(0, 14).join('\n- ');
    if (deps.aoFalhar) await deps.aoFalhar({ tentativa: i, feedback });
  }
  // não para a geração: o rascunho segue com os problemas visíveis para o Pedro corrigir no editor
  return { ...ultimo, tentativas, historico, com_problemas: true };
}

// Regenera só uma tela (ou só um campo dela), mantendo todo o resto.
const SISTEMA_TELA = `Você reescreve UMA tela de um carrossel da série “Negócios que você não viu” (@pedro_destrava), mantendo a voz do restante: português brasileiro simples, frases curtas e completas, sem emoji, sem frases de efeito vazias, sem termo técnico sem explicar. Mesmas regras de fatos: use SOMENTE DADOS_VERIFICADOS, nunca invente número, atribua “segundo a empresa” na mesma tela quando o dado é da empresa, Brasil é hipótese, sem promessa de lucro.
Responda APENAS JSON com os campos da tela: {"rotulo":"","titulo":"","linha2":"","apoio":"","nota":"","palavra":"","legenda":"","claim_id":""} (omita os campos que a composição não usa). Marque UMA expressão com **destaque** no titulo. Cerca de 15 a 40 palavras no total.`;
async function regenerarTela(op, doc, indice, { instrucao = '', campo = null, deps = {}, tentativas = 3 } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson; const tela = doc.telas[indice]; const outras = doc.telas.map((t, i) => `${i + 1} (${t.funcao}): ${Serie.textoDaTela(t, { claims: Serie.claimsPorId(op) })}`).filter((_, i) => i !== indice);
  let feedback = ''; let ultimo = null;
  for (let k = 1; k <= tentativas; k++) {
    const d = llmJson.dado('NEGOCIO', JSON.stringify({ ...dadosParaIa(op), FICHA: doc.ficha }), 14000);
    const { dados } = await pedir({ sistema: `${SISTEMA_TELA}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${d.bloco}\n\nFunção da tela: ${tela.funcao} (${Serie.FUNCOES[tela.funcao].imagem}). Composição: ${tela.layout}. Texto atual: ${JSON.stringify(tela.textos)}.\nOutras telas (não repita):\n${outras.join('\n')}\n${campo ? `Reescreva SOMENTE o campo “${campo}”.` : 'Reescreva a tela.'}${instrucao ? `\nPedido do Pedro: ${U.limita(instrucao, 300)}` : ''}${feedback ? `\nA VERSÃO ANTERIOR FOI RECUSADA: ${feedback}` : ''}`, maxTokens: 900, temperatura: k === 1 ? 0.6 : 0.3, budget: deps.budget });
    const novos = { ...tela.textos }; for (const c of campo ? [campo] : [...Serie.CAMPOS, 'claim_id']) if (dados?.[c] != null && String(dados[c]).trim()) novos[c] = Serie.limpaTxt(dados[c], (Serie.LIMITES[c] || 40) + 40);
    const candidata = { ...tela, textos: novos }; const copia = { ...doc, telas: doc.telas.map((t, i) => (i === indice ? candidata : t)) };
    const v = Serie.validar(copia, op); const erros = v.bloqueios.filter((b) => b.tela === indice + 1 && b.codigo !== 'TEXTO_NAO_CABE').map((b) => b.mensagem).concat(v.sugestoes.filter((s) => s.tela === indice + 1 && SUGESTOES_QUE_REFAZEM.has(s.codigo)).map((s) => s.mensagem));
    ultimo = { textos: novos, erros };
    if (!erros.length) return { textos: novos, tentativas: k };
    feedback = erros.join('; ');
  }
  return { ...ultimo, com_problemas: true, tentativas };
}

module.exports = { montarFicha, validarFicha, montarDoRascunho, gerarRascunho, regenerarTela, dadosParaIa, SISTEMA };
