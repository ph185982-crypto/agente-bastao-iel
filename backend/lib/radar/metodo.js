// Método de pesquisa e copy com substância, usado por QUALQUER template (o template só desenha; não muda o argumento).
// Ordem: briefing auditável (FATO / ANÁLISE / HIPÓTESE, cada um com base nos fatos) → três ganchos pontuados em código →
// sete telas com papel definido → validação em código (especificidade, causalidade, atribuição, hipótese) → revisão por IA
// (uma segunda chamada no mesmo provedor, que aponta o problema específico e a correção; nunca bloqueia sozinha).
// Princípios (síntese adaptada, não fórmula literal): começar pelo interesse e pelo conhecimento do leitor; continuidade entre telas;
// pesquisar produto, cliente e operação antes da frase; preferir explicação e fato específico a adjetivo; testar hipóteses;
// provas reais e autoridade legítima. Os nomes desses autores NÃO aparecem no texto público.
const llmJson = require('../llmJson');
const Copy = require('./copy');
const Serie = require('./serie');
const C = require('./config');
const N = require('./numeros');
const U = require('./util');
const { ACCOUNT } = require('../account');
const Padrao = require('../padraoCarrossel');

const TEMPLATE = 'minimalista';
const ORDEM = ['gancho', 'problema', 'mecanismo_1', 'mecanismo_2', 'conta', 'aplicacao', 'encerramento'];
// Função de cada tela → composição. Fotos: gancho, mecanismo 1, conta e aplicação (como no modelo de referência); Pedro só no encerramento.
const FUNCOES_MIN = Object.freeze({
  gancho: { rotulo: 'Gancho', layout: 'min_foto', permitidos: ['min_foto', 'min_texto', 'min_produto'], imagem: 'o negócio em operação, real', tipo: 'FATO', foto: true },
  problema: { rotulo: 'Problema e contexto', layout: 'min_texto', permitidos: ['min_texto', 'min_foto', 'min_produto'], imagem: 'opcional', tipo: 'FATO', foto: false, opcional: true },
  mecanismo_1: { rotulo: 'Primeiro mecanismo', layout: 'min_foto', permitidos: ['min_foto', 'min_texto', 'min_produto'], imagem: 'a operação ou o produto que mostra o mecanismo', tipo: 'ANALISE', foto: true },
  mecanismo_2: { rotulo: 'Segundo mecanismo', layout: 'min_texto', permitidos: ['min_texto', 'min_foto', 'min_produto'], imagem: 'opcional', tipo: 'ANALISE', foto: false, opcional: true },
  conta: { rotulo: 'Conta, evidência ou limite', layout: 'min_foto', permitidos: ['min_foto', 'min_texto', 'min_produto'], imagem: 'print verdadeiro ou o uso real que sustenta o número', tipo: 'FATO', foto: true },
  aplicacao: { rotulo: 'Aplicação e teste', layout: 'min_foto', permitidos: ['min_foto', 'min_texto', 'min_produto'], imagem: 'uma cena real de teste ou de uso (ilustrativa se não for da empresa)', tipo: 'HIPOTESE', foto: true },
  encerramento: { rotulo: 'Síntese e convite', layout: 'min_encerramento', permitidos: ['min_encerramento'], imagem: 'foto aprovada do Pedro', tipo: 'MISTO', foto: false },
});
const ANGULOS_MIN = Object.freeze({ oportunidade: 'Oportunidade ou benefício', contradicao: 'Contradição', erro: 'Erro, perda ou detalhe ignorado' });
const MAX_CORPO = 70; const MIN_CORPO = 14;

const sem = (s) => U.semAcento(s).toLowerCase().replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const STOP = new Set('para pelo pela pelos pelas com sem uma uns umas dos das que como mais menos esse essa isso este esta sobre entre quando onde porque tambem ainda muito muita todo toda todos todas seu sua seus suas nos nas num numa ser estar ter faz fazer pode podem sao sendo foram sobre cada outro outra mesmo mesma depois antes'.split(' '));
const GENERICO = new Set('empresa cliente clientes produto negocio ideia mercado crescimento inovacao solucao problema resultado pessoas usuarios modelo receita dinheiro operacao aplicativo plataforma forma parte simples pessoa forte valor sempre tempo dia coisa'.split(' '));
// Termos que só valem se vierem do caso: nome, fatos, mecanismos e operação. Palavra de qualquer empresa não conta.
const termos = (s) => sem(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w) && !GENERICO.has(w));
const CAUSAL = /\b(causou|causa o crescimento|graças a|gracas a|fez crescer|resultou em|levou ao crescimento|impulsionou|explica o crescimento|por isso cresceu)\b/;
const ATRIBUI_DECISAO = /\b(segundo a empresa|a empresa (decidiu|escolheu|afirma|diz|garante|cobra|monta|mudou))\b/;
const MARCA_HIPOTESE = /\b(hipotese|hipótese|poderia|pode ser|poderia ser|testar|teste sugerido|simular|experimentar)\b/;
const EXAGERO = /\b(incrivel|incrível|revolucion|milagre|garantid|segredo|nunca falha|sem risco)\b/;
const CONECTIVO = /\b(porque|assim|quando|para que|por isso|com isso|então|entao|dessa forma|desse jeito)\b/;

// ── Briefing: a ficha auditável que fica antes da redação ───────────────────────
// Estrutura: fatos (cada um com fonte ou campo do negócio), análises (cada uma com base em fatos e flag de causalidade),
// hipóteses (nunca atribuídas à empresa), decisão específica, mecanismos (com base), limitações e aprendizado do leitor.
function validarBriefing(b, op, { v1 = false } = {}) {
  const erros = []; const usaveis = Copy.claimsUsaveis(op); const idsClaim = new Set(usaveis.map((c) => c.id));
  if (!b || typeof b !== 'object') return ['Briefing ausente.'];
  const fatos = Array.isArray(b.fatos) ? b.fatos : []; const ids = new Set(fatos.map((f) => String(f?.id)));
  // mecanismos e telas podem apoiar-se em fatos OU análises; análises só em fatos
  const idsBase = new Set([...ids, ...(Array.isArray(b.analises) ? b.analises : []).map((a) => String(a?.id))]);
  if (fatos.length < 3) erros.push('Briefing: faltam fatos (mínimo 3, cada um com fonte ou campo do negócio).');
  for (const f of fatos) {
    if (f.claim_id && !idsClaim.has(String(f.claim_id))) erros.push(`Briefing: o fato ${f.id} usa uma afirmação que não está verificada (${f.claim_id}).`);
    if (!f.claim_id && !f.campo_do_negocio) erros.push(`Briefing: o fato ${f.id} não tem fonte nem campo do negócio. Fato sem origem não entra.`);
  }
  for (const a of (Array.isArray(b.analises) ? b.analises : [])) {
    if (!Array.isArray(a.base) || !a.base.length || a.base.some((x) => !ids.has(String(x)))) erros.push(`Briefing: a análise ${a.id} precisa apontar fatos existentes.`);
    if (!a.causalidade_demonstrada && CAUSAL.test(sem(a.texto))) erros.push(`Causalidade não demonstrada na análise ${a.id}: escreva como interpretação (“pode ajudar”, “uma leitura é”), não como causa.`);
  }
  for (const h of (Array.isArray(b.hipoteses) ? b.hipoteses : [])) if (ATRIBUI_DECISAO.test(sem(h.texto))) erros.push(`A hipótese ${h.id} foi escrita como decisão da empresa. Hipótese nossa não vira atribuição à empresa.`);
  const dec = b.decisao_especifica || {};
  if (!dec.texto || !Array.isArray(dec.base) || !dec.base.length) erros.push('Briefing: falta a decisão específica que torna o caso interessante, apoiada em fato.');
  const mec = Array.isArray(b.mecanismos) ? b.mecanismos : [];
  if (mec.length < 2) erros.push('Briefing: são necessários ao menos dois mecanismos explicados (como funciona e por que gera vantagem).');
  for (const m of mec) {
    if (!m.como_funciona || !m.vantagem || !m.condicao_de_falha) erros.push(`Mecanismo “${m.nome || '?'}”: falta como funciona, por que gera vantagem ou em que condição deixa de funcionar.`);
    if (!Array.isArray(m.base) || !m.base.length || m.base.some((x) => !idsBase.has(String(x)))) erros.push(`Mecanismo “${m.nome || '?'}”: precisa de fatos ou análises existentes como base.`);
  }
  if (!Array.isArray(b.limitacoes) || !b.limitacoes.length) erros.push('Briefing: registre ao menos uma limitação, custo ou risco.');
  if (!b.aprendizado_leitor) erros.push('Briefing: falta o principal aprendizado que o leitor pode usar.');
  if (v1) erros.push(...validarBriefingV1(b, mec));
  // número de qualquer campo do briefing precisa estar nas afirmações verificadas
  const textoBriefing = [...fatos.map((f) => f.texto), ...(b.analises || []).map((a) => a.texto), ...mec.map((m) => `${m.como_funciona} ${m.vantagem} ${m.exemplo || ''}`), dec.texto].join(' ');
  const sp = Copy.numerosNaoComprovados(textoBriefing, usaveis, { permitirContagem: true }); if (sp.length) erros.push(`Briefing: número sem comprovação (${sp.join(', ')}).`);
  return erros;
}

// Padrão v1: briefing completo (público, conhecimento, oferta, quem paga, receita, operação, evidência, custos,
// aplicação, fontes e dúvidas em aberto), teste de valor antes de escrever e estrutura de cada argumento.
const CAMPOS_V1 = { publico: 'público', interesse: 'interesse do público', nivel_conhecimento: 'nível de conhecimento do leitor' };
const NEGOCIO_V1 = { produto: 'oferta/produto', problema: 'problema', quem_paga: 'quem paga', forma_cobranca: 'como a receita entra', operacao: 'operação' };
function validarBriefingV1(b, mec) {
  const e = [];
  for (const [k, nome] of Object.entries(CAMPOS_V1)) if (!String(b[k] || '').trim()) e.push(`Briefing: falta o ${nome}.`);
  for (const [k, nome] of Object.entries(NEGOCIO_V1)) if (!String(b.negocio?.[k] || '').trim()) e.push(`Briefing: falta ${nome} no negócio.`);
  if (!Array.isArray(b.duvidas_abertas)) e.push('Briefing: registre as dúvidas em aberto (lista, pode ser vazia), para não virarem afirmação.');
  if (!String(b.aplicacao || '').trim()) e.push('Briefing: falta a aplicação (o teste que o leitor pode fazer).');
  const tv = b.teste_de_valor || {};
  if (!tv.o_que_aprende || !tv.por_que_importa) e.push('Teste de valor: diga o que o leitor aprende e por que isso importa para ele, antes de escrever.');
  else if (tv.aprovado === false) e.push(`Teste de valor reprovado: ${U.limita(tv.motivo || 'o conteúdo não entrega algo específico', 160)}. Aprofunde a pesquisa ou proponha menos telas.`);
  for (const m of mec) if (!String(m.exemplo || '').trim()) e.push(`Mecanismo “${m.nome || '?'}”: falta o exemplo concreto (afirmação → como funciona → exemplo → evidência → limitação → implicação).`);
  return e;
}

// Briefing visual de cada tela, ANTES de procurar imagem: o que mostrar, o que a imagem acrescenta, entidade exata, fonte preferida,
// buscas, enquadramento, orientação e resolução, o que precisa aparecer, o que é proibido e o que fazer se não houver imagem.
const VISUAL = {
  gancho: { mostrar: 'o produto ou o serviço em uso real', acrescenta: 'mostra do que a história fala antes da explicação', tipo: 'foto', enquadramento: 'plano aberto ou médio, o produto inteiro visível', deve: ['o produto/serviço real da empresa'] },
  problema: { mostrar: 'a situação do problema, se houver imagem real', acrescenta: 'torna concreto o problema', tipo: 'foto', enquadramento: 'plano médio', deve: ['a situação descrita no texto'] },
  mecanismo_1: { mostrar: 'a operação ou a parte do produto que explica o mecanismo', acrescenta: 'mostra COMO funciona', tipo: 'foto ou print do app', enquadramento: 'detalhe do mecanismo, sem cortar o essencial', deve: ['o passo do mecanismo citado'] },
  mecanismo_2: { mostrar: 'o segundo mecanismo em ação', acrescenta: 'mostra o detalhe da operação', tipo: 'foto ou print do app', enquadramento: 'detalhe', deve: ['o passo citado'] },
  conta: { mostrar: 'print verdadeiro, página oficial ou uso real que sustenta o número', acrescenta: 'prova visual do dado', tipo: 'print ou documento', enquadramento: 'inteiro, legível, sem corte', deve: ['o dado ou o preço citado, se for print'] },
  aplicacao: { mostrar: 'uma cena de teste pequeno; ilustrativa se não for da empresa', acrescenta: 'ajuda o leitor a imaginar o teste', tipo: 'foto ilustrativa (rotulada) ou da empresa', enquadramento: 'plano médio', deve: ['a ação do teste'] },
  encerramento: { mostrar: 'a foto aprovada do Pedro', acrescenta: 'assinatura do perfil', tipo: 'foto aprovada', enquadramento: 'retrato, sem alterar o rosto', deve: ['Pedro'] },
};
function briefingVisual(t, op, b) {
  const v = VISUAL[t.funcao] || VISUAL.gancho; const nome = op?.nome || b?.negocio?.nome || '';
  const site = op?.verificacao?.fonte_oficial?.url || null;
  return {
    mostrar: v.mostrar, acrescenta: v.acrescenta, tipo: v.tipo, entidade: t.funcao === 'encerramento' ? 'Pedro Destrava' : nome,
    fonte_preferida: t.funcao === 'encerramento' ? 'foto aprovada' : ['envio do Pedro', 'kit de imprensa', site ? `página oficial (${site})` : 'página oficial', 'canais oficiais', 'print real', 'editorial com licença'].join(' → '),
    buscas: t.funcao === 'encerramento' ? [] : [`${nome} ${b?.negocio?.produto || ''}`.trim(), `${nome} press kit`, `${nome} app screenshot`].filter(Boolean),
    enquadramento: v.enquadramento, orientacao: 'horizontal ou quadrada (a foto ocupa a largura da tela)', resolucao_minima: '900 px de largura', deve_aparecer: v.deve,
    proibido: ['foto de outra empresa', 'marca d’água', 'retrato documental inventado', 'print falso', 'texto pequeno ilegível', 'imagem gerada por IA fora da tela de teste'],
    sem_imagem: 'a tela fica só com texto e aparece um aviso pedindo a imagem; nenhuma imagem genérica entra no lugar',
  };
}

// Termos específicos do caso (nome + fatos + mecanismos + decisão). Usados no teste de especificidade.
function termosDoCaso(op, b) {
  const base = [op.nome, ...(b?.fatos || []).map((f) => f.texto), ...(b?.mecanismos || []).map((m) => `${m.nome} ${m.como_funciona} ${m.exemplo || ''}`), b?.decisao_especifica?.texto, b?.negocio?.produto, b?.negocio?.operacao];
  return new Set(base.flatMap((x) => termos(x || '')));
}

// ── Telas ────────────────────────────────────────────────────────────────────
// v1: telas opcionais (problema, segundo mecanismo) podem ser omitidas quando falta conteúdo — menos telas em vez de enchimento.
// Cada tela guarda: função narrativa, título, corpo, informação nova, relação com a anterior, fatos usados, evidências e briefing visual.
// Só título e corpo são desenhados.
function montarTelas(dados, op, { agora = Date.now(), v1 = false, briefing = null } = {}) {
  const lista = Array.isArray(dados?.telas) ? dados.telas : [];
  const erros = []; const telas = []; const omitidas = [];
  ORDEM.forEach((funcao, i) => {
    const t = lista.find((x) => x?.funcao === funcao) || (v1 ? null : lista[i]);
    const f = FUNCOES_MIN[funcao];
    if (!t || (v1 && t.omitir)) {
      if (v1 && f.opcional) { omitidas.push({ funcao, motivo: U.limita(t?.omitir || 'sem conteúdo específico para esta tela', 200) }); return; }
      erros.push(`Faltou a tela ${i + 1} (${f.rotulo}).`); return;
    }
    const textos = funcao === 'encerramento'
      ? { titulo: U.limita(t.titulo, 160), apoio: U.limita(t.apoio || t.corpo, 220) }
      : { titulo: U.limita(t.titulo, 140), corpo: U.limita(String(t.corpo || '').trim(), 600) };
    // seções do briefing citadas como base (hipóteses, aprendizado…) não são fatos: saem da base; hipótese não precisa de base
    const SECOES = new Set(['hipoteses', 'hipotese', 'aprendizado_leitor', 'aplicacao', 'tese', 'limitacoes', 'teste_de_valor', 'pergunta_capa']);
    const base = (Array.isArray(t.base) ? t.base.map(String) : Array.isArray(t.fatos_usados) ? t.fatos_usados.map(String) : []).filter((x) => !SECOES.has(x) && !/^h\d+$/.test(x));
    const tela = { id: `t_${funcao}`, funcao, layout: f.layout, textos, foto: { imagem_id: null, enq: 'auto', forma: null }, tipo: t.tipo || f.tipo, base, notas_imagem: f.imagem, bloqueada: false, template: v1 ? Padrao.ID : TEMPLATE };
    if (v1) {
      Object.assign(tela, { informacao_nova: U.limita(t.informacao_nova, 240), relacao_anterior: U.limita(t.relacao_anterior, 240), fatos_usados: base, evidencias: (Array.isArray(t.evidencias) ? t.evidencias : []).map(String).slice(0, 8), travas: { texto: false, imagem: false } });
      tela.briefing_visual = { ...briefingVisual(tela, op, briefing), ...(t.briefing_visual && typeof t.briefing_visual === 'object' ? Object.fromEntries(Object.entries(t.briefing_visual).filter(([k]) => ['mostrar', 'acrescenta', 'buscas', 'enquadramento', 'deve_aparecer', 'proibido'].includes(k))) : {}) };
    }
    telas.push(tela);
  });
  return { telas, erros, omitidas };
}

// Validação de conteúdo de cada tela. Retorna bloqueios (falhas objetivas) e sugestões (julgamento editorial com correção).
function validarTelas(telas, op, b, { v1 = false } = {}) {
  const bl = []; const sg = []; const usaveis = Copy.claimsUsaveis(op); const termosC = termosDoCaso(op, b);
  const ids = new Set([...(b?.fatos || []), ...(b?.analises || [])].map((f) => String(f.id)));
  const tudoFala = telas.map((t) => `${t.textos.titulo || ''} ${t.textos.corpo || t.textos.apoio || ''}`).join(' ');
  telas.forEach((t, i) => {
    const n = i + 1; const txt = `${t.textos.titulo || ''} ${t.textos.corpo || t.textos.apoio || ''}`; const s = sem(txt); const r = `Tela ${n}`;
    if (!String(t.textos.titulo || '').trim()) bl.push(`${r}: falta o título.`);
    if (t.funcao !== 'encerramento') {
      const pal = U.contaPalavras(t.textos.corpo || ''); if (pal < MIN_CORPO) bl.push(`${r}: o texto tem ${pal} palavras; falta explicar (mínimo ${MIN_CORPO}).`);
      if (pal > MAX_CORPO) bl.push(`${r}: o texto tem ${pal} palavras (máximo ${MAX_CORPO}). Corte o que não explica.`);
    }
    // número, atribuição, promessa e frases proibidas
    const sp = Copy.numerosNaoComprovados(txt, usaveis, { permitirContagem: t.funcao === 'aplicacao' }); if (sp.length) bl.push(`${r}: número sem comprovação (${sp.join(', ')}).`);
    const fa = Copy.atribuicaoFaltando(txt, usaveis); if (fa.length) bl.push(`${r}: o número vem de “${fa[0]}”; escreva a atribuição na própria tela.`);
    const pr = proporcoesSemFonte(txt, op); if (pr.length) bl.push(`${r}: proporção sem comprovação (“${pr[0]}”). Use só proporções que estão nas fontes verificadas.`);
    for (const f of C.FRASES_PROIBIDAS) if (s.includes(f)) bl.push(`${r}: frase proibida “${f.trim()}”.`);
    for (const f of C.ABSOLUTOS_NAO_PROVAVEIS) if (s.includes(f)) bl.push(`${r}: “${f}” não dá para provar.`);
    if (/[!]/.test(txt)) bl.push(`${r}: sem exclamação.`);
    if (/\p{Extended_Pictographic}/u.test(txt)) bl.push(`${r}: sem emoji.`);
    if (t.funcao !== 'encerramento' && /@[\w.]+/.test(txt)) bl.push(`${r}: o nome e o @ só aparecem no encerramento.`);
    if (t.funcao === 'encerramento' && /@[\w.]+/.test(txt) && !new RegExp(ACCOUNT.handle.replace('@', '@')).test(txt)) bl.push(`${r}: o @ do encerramento precisa ser ${ACCOUNT.handle}.`);
    // hipótese e atribuição
    if (t.tipo === 'HIPOTESE' && !MARCA_HIPOTESE.test(s)) bl.push(`${r}: é hipótese, mas não está marcada como tal (use “poderia”, “pode ser” ou “teste”).`);
    if (t.tipo === 'HIPOTESE' && ATRIBUI_DECISAO.test(s)) bl.push(`${r}: hipótese nossa escrita como decisão da empresa. Reescreva como sugestão de teste.`);
    if (/\bbrasil|brasileir/.test(s) && t.tipo !== 'HIPOTESE' && !MARCA_HIPOTESE.test(s)) bl.push(`${r}: menção ao Brasil precisa estar marcada como hipótese.`);
    if (CAUSAL.test(s) && t.tipo !== 'FATO') { const ok = (b?.analises || []).some((a) => a.causalidade_demonstrada); if (!ok) bl.push(`${r}: causa não demonstrada. Descreva como interpretação.`); }
    // base factual
    if (['FATO', 'ANALISE'].includes(t.tipo) && !(t.base || []).length && t.funcao !== 'encerramento') bl.push(`${r}: a tela afirma algo sem apontar a base (fato ou análise do briefing).`);
    if ((t.base || []).some((x) => !ids.has(String(x)))) bl.push(`${r}: aponta um fato que não existe no briefing.`);
    // especificidade: o texto precisa conter algo deste caso (teste de troca de nome)
    if (t.funcao !== 'encerramento') {
      const hits = [...new Set(termos(txt))].filter((w) => termosC.has(w));
      if (!hits.length) {
        const msg = `${r}: o texto poderia ser de qualquer outra empresa (nenhum termo do caso). Cite o mecanismo, o preço, a operação ou o fato específico.`;
        (['mecanismo_1', 'mecanismo_2'].includes(t.funcao) ? bl : sg).push(msg);
      }
      if (['mecanismo_1', 'mecanismo_2'].includes(t.funcao) && !CONECTIVO.test(s)) sg.push(`${r}: o mecanismo aparece, mas não explica o porquê. Acrescente “porque”, “assim” ou “quando”.`);
    }
    if (EXAGERO.test(s)) sg.push(`${r}: exagero (“${(s.match(EXAGERO) || [''])[0]}”). Troque por fato ou explicação.`);
    if (/\b(conheca|voce sabia|no mundo dos negocios|solucao inovadora|descubra o poder)\b/.test(s)) bl.push(`${r}: abertura proibida.`);
    if (/\b(marketplace|saas|mvp|b2b|b2c|churn|onboarding|fintech|unicornio|monetizacao|escalavel)\b/.test(s)) sg.push(`${r}: termo técnico sem explicação. Explique na primeira vez, com palavras simples.`);
  });
  // ordem e foto do Pedro
  telas.forEach((t, i) => { if (t.layout === 'min_encerramento' && i !== telas.length - 1) bl.push(`Tela ${i + 1}: a foto do Pedro só pode estar no encerramento.`); });
  if (telas[telas.length - 1]?.layout !== 'min_encerramento') bl.push('A última tela precisa ser o encerramento do Pedro.');
  if (!v1 && telas.length !== ORDEM.length) bl.push(`São ${ORDEM.length} telas no modelo minimalista.`);
  if (v1) {
    if (telas.length < 5 || telas.length > 7) bl.push(`O padrão tem de 5 a 7 telas (tem ${telas.length}).`);
    for (const f of ['gancho', 'mecanismo_1', 'conta', 'aplicacao', 'encerramento']) if (!telas.some((t) => t.funcao === f)) bl.push(`Falta a tela de ${FUNCOES_MIN[f].rotulo.toLowerCase()}.`);
    telas.forEach((t, i) => {
      if (t.funcao === 'encerramento') return;
      if (!String(t.informacao_nova || '').trim()) bl.push(`Tela ${i + 1}: diga qual informação nova ela acrescenta (campo “informação nova”).`);
      if (i > 0 && !String(t.relacao_anterior || '').trim()) sg.push(`Tela ${i + 1}: registre a relação com a tela anterior.`);
      for (const ev of t.evidencias || []) if (!usaveis.some((c) => c.id === ev)) bl.push(`Tela ${i + 1}: a evidência ${ev} não está entre as afirmações verificadas.`);
    });
    const novas = telas.map((t) => sem(t.informacao_nova || '')).filter(Boolean);
    if (new Set(novas).size < novas.length) sg.push('Duas telas declaram a mesma informação nova: uma delas repete a outra.');
  }
  // continuidade e repetição: nenhuma tela repete a anterior com outras palavras
  for (let i = 1; i < telas.length; i++) {
    const a = new Set(termos(`${telas[i - 1].textos.titulo || ''}`)); const bT = termos(`${telas[i].textos.titulo || ''}`);
    if (bT.length >= 3 && bT.filter((w) => a.has(w)).length / bT.length >= 0.7) sg.push(`Tela ${i + 1}: repete o título da tela ${i}. Avance a história.`);
  }
  void ids; void tudoFala;
  return { bloqueios: [...new Set(bl)], sugestoes: [...new Set(sg)] };
}

// Três ganchos: ângulos diferentes; escolha por pontuação em código. Números e exagero não ganham vantagem.
function escolherGancho(ganchos) {
  const lista = (Array.isArray(ganchos) ? ganchos : []).slice(0, 3);
  const angulos = new Set(lista.map((g) => g.angulo));
  const erros = []; if (lista.length !== 3) erros.push('São necessários três ganchos.'); if (angulos.size !== 3 || !['oportunidade', 'contradicao', 'erro'].every((a) => angulos.has(a))) erros.push('Os três ganchos precisam ter os ângulos oportunidade, contradição e erro/perda.');
  const pontuados = lista.map((g, i) => {
    const sc = g.scores || {}; const soma = ['clareza', 'relevancia', 'especificidade', 'sustentacao', 'entregabilidade'].reduce((m, k) => m + (Number(sc[k]) || 0), 0);
    const pen = EXAGERO.test(sem(g.titulo)) ? 2 : 0;
    return { i, id: `capa_${i + 1}`, angulo: g.angulo, titulo: U.limita(g.titulo, 140), apoio: '', rotulo: '', total: soma - pen, scores: sc };
  });
  const escolhido = pontuados.reduce((best, g) => (g.total > best.total ? g : best), pontuados[0] || { i: 0 });
  return { ganchos: pontuados.map(({ i, total, scores, ...g }) => ({ ...g, pontuacao: total, scores })), escolhido: escolhido.i, erros };
}

// Revisão por IA (segunda etapa). Só aponta; a correção vira sugestão. Quando não há chave, fica registrado como não executada.
async function revisarIA(op, telas, b, { deps = {} } = {}) {
  const pedir = deps.pedirJson || (llmJson.hasLlmKey() ? llmJson.pedirJson : null);
  if (!pedir) return { executada: false, motivo: 'sem chave de IA neste ambiente: só a revisão técnica por código rodou' };
  const texto = telas.map((t, i) => `${i + 1} (${FUNCOES_MIN[t.funcao].rotulo}, ${t.tipo}): ${t.textos.titulo || ''} — ${t.textos.corpo || t.textos.apoio || ''}`).join('\n');
  const { dados, llm } = await pedir({ sistema: `${REVISOR}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${llmJson.dado('TELAS', texto, 6000).bloco}\n${llmJson.dado('BRIEFING', JSON.stringify(b || {}), 6000).bloco}`, maxTokens: 1800, temperatura: 0.2, budget: deps.budget });
  const revisao = (Array.isArray(dados?.telas) ? dados.telas : []).slice(0, 7).map((x, i) => ({ tela: i + 1, problema: U.limita(x?.problema, 220), correcao: U.limita(x?.correcao, 220), informacao_nova: x?.informacao_nova !== false, explica: x?.explica !== false, promessa_cumprida: x?.promessa_cumprida !== false, repete: x?.repete === true, tecnica_demonstrada: x?.tecnica_demonstrada !== false, imagem_relaciona: x?.imagem_relaciona !== false }));
  return { executada: true, llm, telas: revisao, sugestoes: revisao.filter((x) => x.problema && x.problema !== 'nenhum').map((x) => `Tela ${x.tela}: ${x.problema}${x.correcao ? ` → ${x.correcao}` : ''}`) };
}

// ── Pedido à IA: briefing → ganchos → telas, em uma chamada ───────────────────────
const SISTEMA = `Você escreve o carrossel "Estratégia por trás" do perfil @pedro_destrava: mostra a estratégia escondida por trás de um negócio que funciona. O leitor deve terminar entendendo algo específico que não percebia antes: uma decisão, como funciona, por que pode dar vantagem, qual evidência sustenta, em que condição a vantagem deixa de valer e o que pode testar.
Não é apresentação, nem lista de "três técnicas". Não é tom de "essa empresa é interessante", "ela resolveu um problema", "inovação faz a diferença": isso é genérico e está proibido.

PASSO 1 — BRIEFING (auditável). Use SOMENTE DADOS_VERIFICADOS e os campos do negócio. Separe:
- FATO: informação documentada, com fonte (claim_id) ou campo do negócio.
- ANALISE: interpretação sustentada por fatos listados em "base". Se a causalidade não foi demonstrada, marque causalidade_demonstrada=false e escreva como interpretação ("uma leitura é", "pode ajudar"), nunca "causou".
- HIPOTESE: adaptação ou teste proposto. Nunca escreva hipótese como decisão atribuída à empresa.
Registre: negócio e produto; problema; para quem e por quê; quem paga e pelo que paga; forma de cobrança; operação; evidência; decisão específica (com base); mecanismos (como funciona, exemplo, por que gera vantagem, condição em que deixa de funcionar, base); limitações, custos e riscos; aprendizado do leitor.
Se não houver algo específico para explicar, responda com "telas": [] e "sem_pauta": "motivo". Não complete com generalidades.

PASSO 2 — TRÊS GANCHOS com ângulos diferentes: "oportunidade" (benefício), "contradicao" (algo que parece não bater), "erro" (perda ou detalhe ignorado). Para cada um dê scores de 1 a 5 em clareza, relevancia, especificidade e sustentacao. Não dê vantagem a número nem a exagero.

PASSO 3 — SETE TELAS, nesta ordem, cada uma com uma ideia central e que acrescenta algo novo:
gancho (FATO) · problema (FATO) · mecanismo_1 (ANALISE, com exemplo concreto) · mecanismo_2 (ANALISE, aprofunda ou mostra a condição de falha) · conta (FATO: evidência, comparação ou limite importante, com atribuição "segundo a empresa" quando for da empresa) · aplicacao (HIPOTESE: um teste pequeno, com custos e restrições) · encerramento (MISTO: síntese e convite para seguir).
Títulos avançam a história; corpos explicam (14 a 70 palavras). Termos técnicos explicados na primeira vez. Frases simples, sem infantilizar. Sem "!", sem emoji, sem frase de efeito vazia, sem "o segredo é", sem "pense fora da caixa".
Números só de DADOS_VERIFICADOS, com "segundo a empresa" quando forem da empresa. Dinheiro só com número verificado do tipo certo. Nunca diga que é inédito no Brasil nem que vai funcionar aqui: Brasil é hipótese.
Legenda: primeira_linha, historia, como_ganha, brasil (hipótese). Até 3 hashtags.

Responda APENAS JSON:
{"sem_pauta":null,"briefing":{"negocio":{"nome":"","produto":"","problema":"","para_quem":"","quem_paga":"","pelo_que_paga":"","forma_cobranca":"","operacao":""},"fatos":[{"id":"f1","texto":"","claim_id":"c1 ou null","campo_do_negocio":"nome do campo ou null"}],"analises":[{"id":"a1","texto":"","base":["f1"],"causalidade_demonstrada":false}],"hipoteses":[{"id":"h1","texto":""}],"decisao_especifica":{"texto":"","base":["f1"]},"mecanismos":[{"nome":"","como_funciona":"","exemplo":"","vantagem":"","condicao_de_falha":"","base":["f1"]},{"nome":"","como_funciona":"","exemplo":"","vantagem":"","condicao_de_falha":"","base":["a1"]}],"limitacoes":[""],"aprendizado_leitor":"","tese":"","pergunta_capa":""},"ganchos":[{"angulo":"oportunidade","titulo":"","scores":{"clareza":3,"relevancia":3,"especificidade":3,"sustentacao":3}},{"angulo":"contradicao","titulo":"","scores":{}},{"angulo":"erro","titulo":"","scores":{}}],"telas":[{"funcao":"gancho","tipo":"FATO","base":["f1"],"titulo":"","corpo":""},{"funcao":"problema","tipo":"FATO","base":["f1"],"titulo":"","corpo":""},{"funcao":"mecanismo_1","tipo":"ANALISE","base":["a1"],"titulo":"","corpo":""},{"funcao":"mecanismo_2","tipo":"ANALISE","base":["a1"],"titulo":"","corpo":""},{"funcao":"conta","tipo":"FATO","base":["f1"],"titulo":"","corpo":""},{"funcao":"aplicacao","tipo":"HIPOTESE","base":[],"titulo":"","corpo":""},{"funcao":"encerramento","tipo":"MISTO","base":[],"titulo":"","apoio":""}],"legenda":{"primeira_linha":"","historia":"","como_ganha":"","brasil":""},"hashtags":[""]}`;

// Padrão v1: mesmo método, com o briefing completo, o teste de valor e os campos de cada tela.
const SISTEMA_V1 = `${SISTEMA.split('Responda APENAS JSON:')[0].replace('Você escreve o carrossel "Estratégia por trás"', 'Você escreve o carrossel do padrão "Pedro Destrava — Minimalista"')}
COMPLEMENTOS OBRIGATÓRIOS DO PADRÃO:
- Briefing: publico (para quem é), interesse (o que esse público quer), nivel_conhecimento (o que ele já sabe), aplicacao (o teste que pode fazer), duvidas_abertas (o que a pesquisa NÃO confirmou; nunca vira afirmação).
- teste_de_valor ANTES de escrever: o_que_aprende, por_que_importa, aprovado (false se não houver algo específico; então use sem_pauta).
- Cada mecanismo segue: afirmação → como funciona → exemplo → evidência (base) → limitação (condicao_de_falha) → implicação (vantagem).
- Ganchos: scores também em "entregabilidade" (as telas cumprem a promessa?).
- Telas: de 5 a 7. "problema" e "mecanismo_2" podem ter "omitir": "motivo" se não houver conteúdo específico (menos telas é melhor que enchimento).
- Cada tela: informacao_nova (o que ela acrescenta), relacao_anterior, base (fatos/análises usados), evidencias (ids de DADOS_VERIFICADOS), briefing_visual {mostrar, acrescenta, buscas, enquadramento, deve_aparecer, proibido}.
- Só título e corpo vão para a imagem. Sem nome, @ ou foto do Pedro antes do encerramento. Encerramento: aprendizado específico desta pauta, um único convite, ${ACCOUNT.handle}, motivo para seguir.
Responda APENAS JSON no formato: {"sem_pauta":null,"briefing":{"publico":"","interesse":"","nivel_conhecimento":"","negocio":{"nome":"","produto":"","problema":"","para_quem":"","quem_paga":"","pelo_que_paga":"","forma_cobranca":"","operacao":""},"fatos":[],"analises":[],"hipoteses":[],"decisao_especifica":{"texto":"","base":[]},"mecanismos":[{"nome":"","como_funciona":"","exemplo":"","vantagem":"","condicao_de_falha":"","base":[]}],"limitacoes":[],"aprendizado_leitor":"","aplicacao":"","duvidas_abertas":[],"teste_de_valor":{"o_que_aprende":"","por_que_importa":"","aprovado":true}},"ganchos":[{"angulo":"oportunidade","titulo":"","scores":{"clareza":3,"relevancia":3,"especificidade":3,"sustentacao":3,"entregabilidade":3}},{"angulo":"contradicao","titulo":"","scores":{}},{"angulo":"erro","titulo":"","scores":{}}],"telas":[{"funcao":"gancho","tipo":"FATO","base":[],"evidencias":[],"informacao_nova":"","relacao_anterior":"","titulo":"","corpo":"","briefing_visual":{}}],"legenda":{"primeira_linha":"","historia":"","como_ganha":"","brasil":""},"hashtags":[]}`;

const REVISOR = `Você é o revisor editorial. Você NÃO escreve o texto: aponta, para cada uma das 7 telas, o problema específico e a correção.
Verifique: qual informação nova a tela acrescenta; se a promessa da capa foi cumprida; se há explicação ou só opinião; se há repetição; se a técnica está demonstrada; se fato, análise e hipótese estão diferenciados; se a imagem se relaciona ao argumento (use "imagem_relaciona": false se não).
Responda APENAS JSON: {"telas":[{"problema":"","correcao":"","informacao_nova":true,"explica":true,"promessa_cumprida":true,"repete":false,"tecnica_demonstrada":true,"imagem_relaciona":true}]}
Se a tela está boa, use "problema": "nenhum".`;

function dadosParaIa(op) {
  return { ...Copy.dadosParaIa(op), ORIENTACAO: 'Use somente DADOS_VERIFICADOS e os campos do negócio. Não invente nada.' };
}

// Do JSON da IA (ou de um rascunho escrito à mão, com o mesmo formato) para as telas e o documento.
// Correções mecânicas e seguras do formato do briefing (vistas com a IA real em produção). Nenhuma cria fato sem fonte:
// - fato escrito como texto com os ids das afirmações entre parênteses ("… (c5, c13)") vira fato ligado à primeira afirmação verificada;
// - fato sem id ganha id; fato com id de afirmação verificada e sem claim_id é ligado a ela; análise sem id ganha id;
// - afirmação VERIFICADA citada direto (em análise, mecanismo, decisão ou tela) entra como fato com a própria fonte.
function normalizarBriefing(b, op, telas = []) {
  if (!b || typeof b !== 'object') return b;
  const porId = new Map(Copy.claimsUsaveis(op).map((c) => [String(c.id), c]));
  const fatos = (Array.isArray(b.fatos) ? b.fatos : []).map((f, i) => {
    if (typeof f === 'string') { const ids = (f.match(/\bc\d+\b/g) || []).filter((x) => porId.has(x)); return { id: ids[0] || `f${i + 1}`, texto: f.replace(/\s*\((?:\s*c\d+\s*,?)+\)/g, '').trim(), claim_id: ids[0] || null, campo_do_negocio: null }; }
    if (!f || typeof f !== 'object') return null;
    const o = { ...f }; if (!o.id) o.id = o.claim_id || `f${i + 1}`;
    if (!o.claim_id && !o.campo_do_negocio && porId.has(String(o.id))) o.claim_id = String(o.id);
    return o;
  }).filter(Boolean);
  if (Array.isArray(b.analises)) b.analises = b.analises.map((a, i) => (a && typeof a === 'object' ? { ...a, id: a.id || `a${i + 1}` } : a));
  const citadas = [...(b.analises || []).flatMap((a) => a?.base || []), ...(b.mecanismos || []).flatMap((m) => m?.base || []), ...(b.decisao_especifica?.base || []), ...(Array.isArray(telas) ? telas : []).flatMap((t) => [...(t?.base || []), ...(t?.fatos_usados || [])])].map(String);
  const ids = new Set(fatos.map((f) => String(f.id)));
  for (const c of citadas) if (porId.has(c) && !ids.has(c)) { fatos.push({ id: c, texto: porId.get(c).texto, claim_id: c, campo_do_negocio: null }); ids.add(c); }
  // campo do negócio citado como base ("negocio.solucao") vira fato do tipo campo do negócio, com o texto do próprio campo
  for (const c of citadas) { const m = /^negocio\.(\w+)$/.exec(c); const v = m && b.negocio?.[m[1]]; if (v && !ids.has(c)) { fatos.push({ id: c, texto: U.limita(v, 260), claim_id: null, campo_do_negocio: m[1] }); ids.add(c); } }
  b.fatos = fatos;
  return b;
}
// Proporção escrita por extenso ("um terço", "metade") também é número: só entra se estiver nas afirmações verificadas.
const PROPORCAO = /\b(um terco|dois tercos|metade d[aoe]s?|um quarto|tres quartos|um quinto|a maioria d[aoe]s?)\b/;
function proporcoesSemFonte(txt, op) {
  const fontes = sem(Copy.claimsUsaveis(op).map((c) => `${c.texto} ${c.trecho || ''}`).join(' '));
  const achadas = sem(txt).match(new RegExp(PROPORCAO.source, 'g')) || [];
  return [...new Set(achadas)].filter((p) => !fontes.includes(p.split(' ').slice(0, 2).join(' ')) && !/\b(one third|two thirds|half|quarter|majority|most)\b/i.test(Copy.claimsUsaveis(op).map((c) => c.trecho || '').join(' ')));
}

function montarDoc(j, op, { agora = Date.now(), v1 = false } = {}) {
  const b = normalizarBriefing(j?.briefing || null, op, j?.telas); const erros = [];
  if (j?.sem_pauta) return { sem_pauta: j.sem_pauta, telas: [], capas: [], erros: [j.sem_pauta], briefing: b };
  const t = montarTelas(j, op, { agora, v1, briefing: b }); erros.push(...t.erros);
  const g = escolherGancho(j?.ganchos); erros.push(...g.erros);
  const capas = g.ganchos.map((x) => ({ id: x.id, angulo: x.angulo, titulo: x.titulo, apoio: '', rotulo: '', ...(v1 ? { pontuacao: x.pontuacao, scores: x.scores } : {}) }));
  const escolhida = g.ganchos[g.escolhido] || g.ganchos[0];
  if (t.telas[0] && escolhida) t.telas[0].textos.titulo = escolhida.titulo;
  const leg = Serie.montarLegenda({ partes: j?.legenda || {}, hashtags: j?.hashtags || [] }, op); erros.push(...leg.erros);
  return { telas: t.telas, omitidas: t.omitidas, template: v1 ? Padrao.ID : TEMPLATE, capas, capa_escolhida: escolhida?.id || null, ganchos: g.ganchos, briefing: b, legenda: leg.texto, partes_legenda: leg.partes, hashtags: leg.tags, erros, ficha: fichaDoBriefing(op, b) };
}

// Ficha da pesquisa (formato da ficha editorial) derivada do briefing, para o pacote e a revisão do Pedro.
function fichaDoBriefing(op, b) {
  const usaveis = Copy.claimsUsaveis(op); const fatos = b?.fatos || []; const mec = b?.mecanismos || [];
  const evid = fatos.filter((f) => f.claim_id).map((f) => usaveis.find((c) => c.id === String(f.claim_id))).filter(Boolean).map((c) => ({ claim_id: c.id, valor: c.valor_exibicao || null, tipo: c.tipo, afirmacao: c.texto, atribuicao: c.atribuicao || null, veiculo: c.veiculo, url: c.url, data_publicacao: c.data_publicacao ? String(c.data_publicacao).slice(0, 10) : null, trecho: c.trecho, nota: '' }));
  const lacunas = [];
  if (!usaveis.some((c) => ['modelo_receita', 'preco'].includes(c.tipo))) lacunas.push('Como cobra: nenhuma fonte verificada confirma o modelo. Afirmações sobre cobrança ficam como análise, sem número.');
  if (!op.verificacao?.fonte_oficial) lacunas.push('Não há fonte oficial lida: números valem só com duas fontes independentes ou atribuição à empresa.');
  return {
    empresa: op.nome, pais: op.pais, categoria: op.categoria, site_oficial: op.verificacao?.fonte_oficial?.url || null,
    problema: b?.negocio?.problema || '', quem_compra: [b?.negocio?.para_quem, b?.negocio?.quem_paga].filter(Boolean).join(' — '), por_que_compra: b?.negocio?.pelo_que_paga || '', como_cobra: b?.negocio?.forma_cobranca || '',
    evidencia: evid, surpresa: b?.decisao_especifica?.texto || '', dificuldades: (b?.limitacoes || []).map((x) => ({ texto: U.limita(x, 220) })),
    inspiracao_brasil: (b?.hipoteses || [])[0]?.texto || '', hipotese_brasil: true, imagens_necessarias: [], ilustracao: null,
    lacunas, fontes: (op.verificacao?.fontes || []).map((x) => ({ veiculo: x.veiculo, url: x.url, classe: x.classe, publicada_em: x.publicada_em })), gerada_em: new Date().toISOString(), origem: 'ia', mecanismos: mec.map((m) => ({ nome: m.nome, como_funciona: m.como_funciona, vantagem: m.vantagem, condicao_de_falha: m.condicao_de_falha })), aprendizado_leitor: b?.aprendizado_leitor || '',
  };
}

// Validação completa do documento minimalista: briefing + telas + legenda + revisão técnica (bloqueios e sugestões).
function validarDocMin(doc, op) {
  const b = doc.briefing || null; const v1 = Padrao.ehV1(doc.template);
  const bl = [...validarBriefing(b, op, { v1 })]; const sg = [];
  const v = validarTelas(doc.telas || [], op, b, { v1 }); bl.push(...v.bloqueios); sg.push(...v.sugestoes);
  if (v1) { const r = validarVisualV1(doc); bl.push(...r.bloqueios); sg.push(...r.sugestoes); }
  if (doc.legenda?.texto) {
    const usaveis = Copy.claimsUsaveis(op); const leg = doc.legenda.texto;
    const sp = Copy.numerosNaoComprovados(leg, usaveis); if (sp.length) bl.push(`Legenda: número sem comprovação (${sp.join(', ')}).`);
    for (const h of (String(leg).match(/@[\w.]+/g) || [])) if (h.toLowerCase() !== ACCOUNT.handle.toLowerCase()) bl.push(`Legenda: o @ “${h}” não é ${ACCOUNT.handle}.`);
    if (!/garantia|garantid|promessa de lucro|teste/i.test(leg)) sg.push('Legenda: diga que é um teste ou hipótese, não promessa de lucro.');
    if (String(leg).length > 700) sg.push(`Legenda com ${String(leg).length} caracteres (até 700 funciona melhor).`);
  }
  const ganchos = (doc.capas || []).map((c) => c.titulo);
  if (ganchos.length !== 3) bl.push('São necessários três ganchos com ângulos diferentes.');
  // imagem gerada por IA é ilustração: nunca ilustra fato, análise, o negócio nem o problema
  const imgs = doc.imagens || [];
  (doc.telas || []).forEach((t, i) => {
    const im = imgs.find((x) => x.id === t.foto?.imagem_id);
    if (im && im.tipo === 'ia_ilustracao' && !['aplicacao'].includes(t.funcao)) bl.push(`Tela ${i + 1}: imagem gerada por IA não pode ilustrar ${FUNCOES_MIN[t.funcao]?.rotulo.toLowerCase() || 'esta tela'}. Ela só cabe na tela de teste, marcada como ilustração.`);
  });
  (doc.telas || []).forEach((t, i) => { if (['min_foto', 'min_produto'].includes(t.layout) && !t.foto?.imagem_id) sg.push(`Tela ${i + 1}: sem foto adequada (${FUNCOES_MIN[t.funcao]?.imagem || 'imagem real'}). Envie uma foto ou um print verdadeiro; o modelo não usa imagem genérica para disfarçar a falta.`); });
  if (doc.revisao?.sugestoes?.length) sg.push(...doc.revisao.sugestoes);
  if (doc.revisao && !doc.revisao.executada) sg.push(`Revisão por IA não executada: ${doc.revisao.motivo}.`);
  return { ok: [...new Set(bl)].length === 0, bloqueios: [...new Set(bl)].map((mensagem) => ({ codigo: 'METODO', mensagem, tela: null })), sugestoes: [...new Set(sg)].map((mensagem) => ({ codigo: 'EDITORIAL', mensagem, tela: null })), resumo: { bloqueios: [...new Set(bl)].length, sugestoes: [...new Set(sg)].length, telas: (doc.telas || []).length, composicoes: [...new Set((doc.telas || []).map((t) => t.layout))].length } };
}

// Bloqueios visuais do padrão v1, a partir do render MEDIDO e das imagens escolhidas (separados das preferências).
function validarVisualV1(doc) {
  const bl = []; const sg = []; const imgs = doc.imagens || []; const telas = doc.telas || [];
  (doc.render || []).forEach((r, i) => {
    const m = r.metricas || {}; const n = `Tela ${i + 1}`;
    if (m.largura && (m.largura !== 1080 || m.altura !== 1350)) bl.push(`${n}: dimensões erradas (${m.largura}×${m.altura}).`);
    for (const p of m.problemas || []) bl.push(`${n}: ${p}.`);
    for (const a of m.avisos || []) sg.push(`${n}: ${a}.`);
  });
  // a mesma foto em duas telas só se o Pedro escolheu assim; a escolha automática não repete foto por conveniência
  const uso = {}; telas.forEach((t, i) => { const id = t.foto?.imagem_id; if (id) (uso[id] ||= []).push({ i, manual: !!t.foto.manual }); });
  for (const [id, l] of Object.entries(uso)) if (l.length > 1) (l.every((x) => x.manual) ? sg : bl).push(`A mesma imagem (${id}) aparece nas telas ${l.map((x) => x.i + 1).join(' e ')}. Use uma imagem pertinente por tela ou deixe a tela só com texto.`);
  telas.forEach((t, i) => {
    const im = imgs.find((x) => x.id === t.foto?.imagem_id); if (!im) return;
    if (im.papel === 'pedro' || im.tipo === 'pedro') bl.push(`Tela ${i + 1}: foto do Pedro antes do encerramento.`);
    if (im.relacao === 'nao_relacionada' || im.descartada) bl.push(`Tela ${i + 1}: a imagem não tem relação com a história.`);
    if (im.permissao !== 'confirmada' && ['editorial', 'stock_duvidoso', 'desconhecida'].includes(im.licenca_classe)) bl.push(`Tela ${i + 1}: uso de imagem com direito duvidoso ainda não revisado.`);
  });
  // não deixar as últimas telas só com texto: ao menos uma das duas telas antes do encerramento tem imagem
  const antes = telas.slice(-3, -1); if (antes.length && antes.every((t) => !t.foto?.imagem_id)) sg.push('As telas finais estão todas só com texto: envie uma imagem pertinente para a conta ou para a aplicação.');
  const comFoto = telas.filter((t) => t.foto?.imagem_id && t.funcao !== 'encerramento').length;
  if (comFoto < 3) sg.push(`Só ${comFoto} tela(s) com imagem do assunto (o padrão costuma ter 3 ou 4). Faltam imagens pertinentes; nenhuma genérica foi colocada no lugar.`);
  if ((doc.legenda?.hashtags || []).length > 3) bl.push('A legenda tem mais de 3 hashtags.');
  // créditos de imagem com licença que exige atribuição entram sozinhos na ficha e na legenda exportada (pacote)
  return { bloqueios: bl, sugestoes: sg };
}

async function gerarMinimalista(op, { deps = {}, tentativas = 3, feedback: fb0 = '', agora = Date.now(), template = TEMPLATE } = {}) {
  const v1 = Padrao.ehV1(template);
  const pedir = deps.pedirJson || llmJson.pedirJson;
  if (!Copy.claimsUsaveis(op).some((c) => c.numero !== null && c.valor_exibicao)) throw U.erro('Sem número verificado não há tela de evidência: o carrossel não é gerado.', 'SEM_PROVA', 422);
  let feedback = fb0; const historico = []; let ultimo = null;
  for (let i = 1; i <= tentativas; i++) {
    const d = llmJson.dado('NEGOCIO', JSON.stringify(dadosParaIa(op)), 16000);
    const { dados, llm } = await pedir({ sistema: `${v1 ? SISTEMA_V1 : SISTEMA}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${d.bloco}\n${feedback ? `\nA VERSÃO ANTERIOR TEVE ESTES PROBLEMAS. Corrija todos sem perder o que estava bom:\n- ${feedback}\n` : ''}`, maxTokens: 6500, temperatura: i === 1 ? 0.6 : 0.35, budget: deps.budget });
    const r = montarDoc(dados, op, { agora, v1 }); const v = validarDocMin(r, op);
    historico.push({ tentativa: i, bloqueios: v.bloqueios.length, llm });
    ultimo = { ...r, llm, validacao: v };
    if (r.sem_pauta) return { ...ultimo, sem_pauta: r.sem_pauta, tentativas: i, historico };
    if (v.ok) break;
    feedback = v.bloqueios.map((b) => b.mensagem).slice(0, 12).join('\n- ');
    if (deps.aoFalhar) await deps.aoFalhar({ tentativa: i, feedback });
  }
  let revisao = await revisarIA(op, ultimo.telas || [], ultimo.briefing, { deps });
  // v1: quando a revisão recusa uma tela, uma rodada de correção específica (a correção apontada vira instrução);
  // o que não se resolver fica PENDENTE e visível no editor.
  if (v1 && revisao.executada && ultimo.telas?.length) {
    const corrigidas = []; const pendentes = [];
    for (const x of (revisao.telas || []).filter((y) => y.problema && y.problema !== 'nenhum').slice(0, 4)) {
      const i = x.tela - 1; if (!ultimo.telas[i] || ultimo.telas[i].funcao === 'encerramento') continue;
      try {
        const rr = await regenerarTelaMin(op, ultimo, i, { instrucao: `Correção pedida pela revisão: ${x.problema}. ${x.correcao || ''}`, deps, tentativas: 1 });
        if (!rr.com_problemas) { ultimo.telas[i] = { ...ultimo.telas[i], textos: rr.textos }; corrigidas.push(x.tela); } else pendentes.push(x.tela);
      } catch { pendentes.push(x.tela); }
    }
    revisao = { ...revisao, corrigidas, pendentes, sugestoes: (revisao.sugestoes || []).filter((t) => !corrigidas.some((n) => t.startsWith(`Tela ${n}:`))).map((t) => (pendentes.some((n) => t.startsWith(`Tela ${n}:`)) ? `PENDENTE — ${t}` : t)) };
  }
  ultimo.revisao = revisao; ultimo.validacao = validarDocMin({ ...ultimo, revisao }, op);
  return { ...ultimo, tentativas: historico.length, historico, com_problemas: !ultimo.validacao.ok };
}

const SISTEMA_TELA = `Você reescreve UMA tela do carrossel "Estratégia por trás" (@pedro_destrava). Mantenha o papel da tela, use só DADOS_VERIFICADOS e o briefing, explique (não só opine), sem "!", sem emoji, Brasil só como hipótese, 14 a 70 palavras no corpo.
Responda APENAS JSON: {"titulo":"","corpo":""} (para o encerramento: {"titulo":"","apoio":""}).`;
async function regenerarTelaMin(op, doc, indice, { instrucao = '', campo = null, deps = {}, tentativas = 3 } = {}) {
  const v1 = Padrao.ehV1(doc.template);
  const pedir = deps.pedirJson || llmJson.pedirJson; const tela = doc.telas[indice];
  let feedback = ''; let ultimo = null;
  for (let k = 1; k <= tentativas; k++) {
    const d = llmJson.dado('BRIEFING', JSON.stringify({ briefing: doc.briefing, tela: { funcao: tela.funcao, tipo: tela.tipo, papel: FUNCOES_MIN[tela.funcao].rotulo }, outras: doc.telas.map((t, j) => `${j + 1}: ${t.textos.titulo || ''}`).filter((_, j) => j !== indice), instrucao }), 12000);
    const { dados } = await pedir({ sistema: `${SISTEMA_TELA}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${d.bloco}\nTexto atual: ${JSON.stringify(tela.textos)}${campo ? `\nReescreva SOMENTE “${campo}”.` : ''}${feedback ? `\nA VERSÃO ANTERIOR FOI RECUSADA: ${feedback}` : ''}`, maxTokens: 900, temperatura: k === 1 ? 0.6 : 0.3, budget: deps.budget });
    const novos = { ...tela.textos }; for (const c of campo ? [campo] : Object.keys(tela.textos)) if (dados?.[c] != null && String(dados[c]).trim()) novos[c] = U.limita(dados[c], c === 'titulo' ? 140 : 600);
    const candidata = doc.telas.map((t, j) => (j === indice ? { ...t, textos: novos } : t));
    const v = validarTelas(candidata, op, doc.briefing, { v1 }); const erros = v.bloqueios.filter((m) => m.startsWith(`Tela ${indice + 1}:`)).concat(v.sugestoes.filter((m) => m.startsWith(`Tela ${indice + 1}:`)));
    ultimo = { textos: novos, erros }; if (!erros.length) return { textos: novos, tentativas: k };
    feedback = erros.join('; ');
  }
  return { ...ultimo, com_problemas: true, tentativas };
}

module.exports = { normalizarBriefing, proporcoesSemFonte, briefingVisual, validarBriefingV1, validarVisualV1, SISTEMA_V1, TEMPLATE, ORDEM, FUNCOES_MIN, ANGULOS_MIN, validarBriefing, validarTelas, validarDocMin, montarDoc, montarTelas, escolherGancho, fichaDoBriefing, gerarMinimalista, regenerarTelaMin, revisarIA, termos, termosDoCaso, SISTEMA };
