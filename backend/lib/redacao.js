// Briefing e copy. A IA escreve; o código confere.
//  - o briefing só pode apoiar-se em afirmações que existem (ids reais);
//  - o texto só pode usar afirmações com estado conhecido e deve atribuir quando
//    a afirmação não está sustentada;
//  - números e citações são conferidos pelas mesmas regras da revisão
//    (qualityGates); se algo escapar, uma segunda tentativa recebe o erro exato;
//  - o que ainda escapar fica VISÍVEL como bloqueio, não é escondido.
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');
const E = require('../../static/editorial');
const { ACCOUNT } = require('./account');

const deps = (d = {}) => ({ llmJson: d.llmJson || require('./llmJson') });

const resumoClaim = (c, evid) => {
  const evs = (c.evidencias || []).map((id) => evid.find((e) => e.id === id)).filter(Boolean);
  return {
    id: c.id, tipo: c.tipo, natureza: M.naturezaDe(c), texto: c.texto, central: !!c.central, estado: c.estado, motivo: c.motivo_estado || '', risco: c.risco, mutavel: !!c.mutavel,
    precisa_atribuicao: !!(c.exige_atribuicao || c.decisao?.tipo === 'atribuir'),
    condicao_obrigatoria: c.decisao?.tipo === 'atribuir' ? c.decisao.condicao : undefined,
    valores: c.valores || [], calculo: c.calculo ? { formula: c.calculo.formula, resultado: c.calculo.resultado, entradas: c.calculo.entradas } : undefined,
    fontes: evs.map((e) => ({ origem: e.origem, relacao: e.relacao, publicada_em: e.publicada_em, limitacoes: e.limitacoes })).slice(0, 4),
  };
};

// ── Briefing ───────────────────────────────────────────────────────────────
const utilizaveis = (claims) => claims.filter((c) => c.decisao?.tipo !== 'retirar');

async function gerarBriefing({ fonte, claims: todas, evidencias, recentes = [], objetivo, formato }, d0) {
  const d = deps(d0);
  const claims = utilizaveis(todas);
  const lista = claims.map((c) => resumoClaim(c, evidencias));
  const f = d.llmJson.dado('FONTE_PRINCIPAL', `${fonte.titulo}\n${fonte.veiculo} · ${fonte.publicada_em || 'sem data'}\n\n${String(fonte.texto || '').slice(0, 5000)}`, 6000);
  const rec = d.llmJson.dado('POSTS_RECENTES_DO_PERFIL', recentes.slice(0, 8).join('\n'), 2500);
  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.35, maxTokens: 3000,
    sistema: `${E.VOZ}\n\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `Monte o BRIEFING editorial deste conteúdo para ${ACCOUNT.handle}. Use SÓ as afirmações listadas (por id) como fatos disponíveis. Afirmações "nao_verificada", "parcialmente_sustentada" ou "contradita" NÃO são fatos: registre-as em duvidas.

AFIRMAÇÕES (com o estado verificado pelo sistema):
${JSON.stringify(lista, null, 1)}

${f.bloco}
${rec.bloco}
${objetivo ? `OBJETIVO PEDIDO PELO PEDRO: ${objetivo}\n` : ''}${formato ? `FORMATO PEDIDO: ${formato}\n` : ''}
Campos:
- assunto: 1 frase;
- acontecimento: o que aconteceu, só com o que as afirmações sustentam;
- por_que_interessa: por que isso importa para quem segue o perfil (sem forçar);
- objetivo: "alcance", "autoridade" ou "conversao" (e objetivo_motivo em 1 frase);
- tese: a tese ou pergunta central (NUNCA vazia: se não há posição possível, escreva a pergunta que o conteúdo responde). tese_tipo: "opiniao" (posição do Pedro, com premissas factuais) ou "explicacao". Se os fatos NÃO sustentam a conclusão que o perfil tenderia a defender, não force: preencha "conflito" com {"descricao","alternativa_enquadramento"};
- fatos_disponiveis: ids das afirmações que podem ser ditas como fato;
- duvidas: o que ainda não está confirmado ou é limitado (lista de frases curtas);
- formato: "carrossel" ou "estatico" (Reels e Stories ainda não são gerados por esta etapa) e formato_motivo;
- estrutura: "acontecimento", "investigacao", "antes_depois", "historia" ou "tese" e estrutura_motivo;
- motivo_compartilhar: por que alguém enviaria, salvaria ou seguiria (específico, sem promessa);
- diferenca_recentes: em que este conteúdo difere dos posts recentes listados (ou "sem posts recentes para comparar").
Não dê notas nem pontuação.

Responda APENAS JSON com esses campos.`,
  });
  const ids = new Set(claims.map((c) => c.id));
  const fatos = (dados.fatos_disponiveis || []).filter((id) => ids.has(id) && claims.find((c) => c.id === id).estado === 'sustentada');
  // Dúvidas automáticas: o código não confia na IA para listar o que não está confirmado.
  const duvidasAuto = claims.filter((c) => c.estado !== 'sustentada' && c.tipo !== 'opiniao').map((c) => `“${c.texto}”: ${c.estado === 'nao_verificada' ? 'não verificada' : c.estado === 'contradita' ? 'contradita pelas fontes' : 'só em parte sustentada'}${c.motivo_estado ? ` (${c.motivo_estado})` : ''}`);
  return {
    briefing: {
      assunto: String(dados.assunto || '').slice(0, 300),
      acontecimento: String(dados.acontecimento || '').slice(0, 600),
      por_que_interessa: String(dados.por_que_interessa || '').slice(0, 400),
      objetivo: E.OBJETIVOS[dados.objetivo] ? dados.objetivo : 'autoridade',
      objetivo_motivo: String(dados.objetivo_motivo || '').slice(0, 300),
      tese: String(dados.tese || '').trim().slice(0, 400) || String(dados.assunto || '').slice(0, 400),
      tese_tipo: dados.tese_tipo === 'opiniao' ? 'opiniao' : 'explicacao',
      conflito: dados.conflito && dados.conflito.descricao ? { descricao: String(dados.conflito.descricao).slice(0, 400), alternativa_enquadramento: String(dados.conflito.alternativa_enquadramento || '').slice(0, 400) } : null,
      fatos_disponiveis: fatos,
      duvidas: [...duvidasAuto, ...((dados.duvidas || []).map(String).slice(0, 6))],
      formato: ['carrossel', 'estatico'].includes(dados.formato) ? dados.formato : 'carrossel',
      formato_motivo: String(dados.formato_motivo || '').slice(0, 300),
      estrutura: E.ESTRUTURAS[dados.estrutura] ? dados.estrutura : 'acontecimento',
      estrutura_motivo: String(dados.estrutura_motivo || '').slice(0, 300),
      motivo_compartilhar: String(dados.motivo_compartilhar || '').slice(0, 400),
      diferenca_recentes: String(dados.diferenca_recentes || '').slice(0, 400),
      gerado_em: new Date().toISOString(),
      llm,
    },
  };
}

// ── Copy ───────────────────────────────────────────────────────────────────
const LAYOUT_POR_FUNCAO = { capa: 'capa_tipografica', contexto: 'explicacao', explicacao: 'explicacao', consequencia: 'explicacao', opiniao: 'explicacao', prova: 'prova', comparacao: 'comparacao', encerramento: 'encerramento' };

function montarVersao({ dados, claims, evidencias, formato }) {
  const ids = new Set(claims.map((c) => c.id));
  const novasOpinioes = [];
  const limpaIds = (arr) => [...new Set((arr || []).map(String).filter((i) => ids.has(i)))];
  const problemas = [];

  const capas = (E.COMPOSICAO_CAPAS).map((cfg) => {
    const c = (dados.capas || []).find((x) => x && x.foco === cfg.foco);
    if (!c || !c.texto) { problemas.push(`faltou a capa de foco "${cfg.foco}"`); return null; }
    return { id: `k_${cfg.foco}`, foco: cfg.foco, texto: String(c.texto).slice(0, 220), explicacao: String(c.explicacao || '').slice(0, 220), claim_ids: limpaIds(c.claim_ids) };
  }).filter(Boolean);

  const slides = [];
  (dados.slides || []).slice(0, 9).forEach((s, i) => {
    if (!s || !s.texto) return;
    const funcao = E.FUNCOES_SLIDE[s.funcao] ? s.funcao : 'explicacao';
    let claim_ids = limpaIds(s.claim_ids);
    s = { ...s, texto: String(s.texto).replace(/【[^】]*】/g, '').replace(/\s+([.,;:!?])/g, '$1').trim() };
    if (s.opiniao) {
      const id = `o${novasOpinioes.length + 1}`;
      novasOpinioes.push({ id, texto: String(s.texto).slice(0, 400), tipo: 'opiniao', central: false, estado: 'nao_verificada', premissas: claim_ids, evidencias: [], risco: 'baixo', origem: 'copy', revisao: {} });
      claim_ids = [id];
    }
    let layout = LAYOUT_POR_FUNCAO[funcao] || 'explicacao';
    if (layout === 'comparacao' && !(s.dados && s.dados.esquerda && s.dados.direita)) layout = 'explicacao';
    // O primeiro slide é sempre a capa. Se o modelo começou pelo contexto, a capa
    // entra antes com a primeira opção (provisória até o Pedro escolher).
    if (!slides.length && funcao !== 'capa') {
      const k = capas[0];
      if (k) slides.push({ id: 's1', funcao: 'capa', layout: 'capa_tipografica', titulo: null, texto: k.texto, rotulo: null, dados: null, claim_ids: k.claim_ids });
    }
    const ehCapa = !slides.length;
    if (ehCapa) layout = 'capa_tipografica';
    slides.push({
      id: `s${slides.length + 1}`, funcao: ehCapa ? 'capa' : (funcao === 'capa' ? 'contexto' : funcao), layout,
      titulo: s.titulo ? String(s.titulo).slice(0, 120) : null, texto: String(s.texto).slice(0, 700), rotulo: ehCapa && s.rotulo ? String(s.rotulo).slice(0, 28) : null,
      dados: layout === 'comparacao' ? { esquerda: s.dados.esquerda, direita: s.dados.direita } : null, claim_ids,
    });
  });
  if (formato === 'estatico') slides.splice(1);
  const cta = String(dados.cta || '').slice(0, 200);
  if (formato !== 'estatico' && cta) slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'encerramento', titulo: null, texto: cta, claim_ids: [] });
  if (slides.length < (formato === 'estatico' ? 1 : 3)) problemas.push('poucos slides');

  // Slide de conteúdo sem afirmação ligada e sem ser opinião: provável fato sem fonte.
  slides.forEach((s, i) => {
    if (i > 0 && !['encerramento', 'capa'].includes(s.funcao) && !(s.claim_ids || []).length && s.texto.split(/\s+/).length > 8) problemas.push(`o slide ${i + 1} afirma algo sem afirmação ligada: ligue a uma afirmação (claim_ids) ou marque como opinião`);
  });
  const META = /parcialmente (sustentad|confirmad)|confirmad[oa] parcialmente|n[aã]o confirmad|fonte [uú]nica|verifica[cç][aã]o independente|n[aã]o verificad|sustentada por|estado da afirma|claim_ids?|\[a\d+\]|【/i;
  slides.forEach((s, i) => { if (META.test(s.texto)) problemas.push(`o slide ${i + 1} fala do sistema de checagem em vez de falar do assunto (reescreva sem "fonte única", "sustentada" etc.)`); });
  if (META.test(dados.legenda || '')) problemas.push('a legenda fala do sistema de checagem em vez de falar do assunto');
  if (formato !== 'estatico' && cta.split(/\s+/).filter(Boolean).length < 4) problemas.push('a chamada final (cta) precisa ser uma frase completa, não uma palavra');

  const hashtags = (dados.hashtags || []).map(String).filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h)).slice(0, 3);
  return {
    versao: {
      estrutura: E.ESTRUTURAS[dados.estrutura] ? dados.estrutura : null,
      capas, capa_escolhida: null, slides,
      // Hashtags ficam no campo próprio, não repetidas dentro da legenda.
      legenda: String(dados.legenda || '').replace(/\*\*/g, '').replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 1400), legenda_claim_ids: limpaIds(dados.legenda_claim_ids),
      cta, hashtags, formato,
    },
    opinioes: novasOpinioes,
    problemas,
  };
}

// Constrói um conteúdo provisório só para rodar as regras de revisão sobre o texto.
function provisorio({ claims, evidencias, fonte, versao, opinioes }) {
  const c = M.novoConteudo({ titulo: 'provisório' });
  c.claims = [...claims, ...opinioes];
  c.evidencias = evidencias;
  c.fonte_principal = fonte;
  c.copia = { versao_ativa: 'v0', versoes: [{ id: 'v0', ...versao, hash: M.hash(M.conteudoDaVersao(versao)) }] };
  return c;
}

async function gerarCopia({ briefing, fonte, claims: todas, evidencias, recentes = [], formato = 'carrossel', instrucoes = '' }, d0) {
  const d = deps(d0);
  const claims = utilizaveis(todas);
  const lista = claims.map((c) => resumoClaim(c, evidencias));
  const rec = d.llmJson.dado('POSTS_RECENTES_DO_PERFIL', recentes.slice(0, 8).join('\n'), 2500);
  const budget = { max: 2, usados: 0 };

  const pedir = async (feedback) => {
    const { dados, llm } = await d.llmJson.pedirJson({
      temperatura: 0.6, maxTokens: 4500, budget,
      sistema: `${E.VOZ}\n\n${d.llmJson.REGRAS_DADOS}`,
      usuario: `Escreva o conteúdo para ${ACCOUNT.handle} seguindo o BRIEFING. ${formato === 'estatico' ? 'Formato: post estático (UMA imagem que se sustenta sozinha).' : 'Formato: carrossel.'}

BRIEFING: ${JSON.stringify({ assunto: briefing.assunto, acontecimento: briefing.acontecimento, objetivo: briefing.objetivo, tese: briefing.tese, tese_tipo: briefing.tese_tipo, estrutura: E.ESTRUTURAS[briefing.estrutura]?.nome, motivo_compartilhar: briefing.motivo_compartilhar, conflito: briefing.conflito, duvidas: briefing.duvidas })}

AFIRMAÇÕES DISPONÍVEIS (use claim_ids exatos; o estado é o verificado pelo sistema):
${JSON.stringify(lista, null, 1)}

REGRAS DE FATOS (inegociáveis):
1. Todo número, data, nome ou acontecimento vem de uma afirmação listada; o slide aponta o(s) id(s) em claim_ids. Nenhum número que não esteja na afirmação ou no cálculo ligado a ela.
2. Afirmação "sustentada": pode ser dita como fato. "parcialmente_sustentada" ou "nao_verificada": só com atribuição ("segundo o ${fonte.veiculo || 'veículo'}…") e sem apresentar como certeza. "contradita": não use como fato.
2b. Afirmação com precisa_atribuicao (anúncio, declaração, previsão): o slide que a usa DIZ quem anunciou/disse/estimou ou a condição ("o governo anunciou…", "ainda depende de aprovação", "é uma estimativa do ministério"). Se houver condicao_obrigatoria, use essa expressão. Nunca tire ressalvas para deixar o texto mais forte — isso vale também para a capa.
3. Citação entre aspas só se for cópia exata de texto das afirmações. Não atribua fala a ninguém que a afirmação não atribua.
4. Opinião do Pedro deve parecer opinião ("na minha leitura…") e marque o slide com "opiniao": true; nele, claim_ids são as premissas factuais.
5. Não crie experiência pessoal nem história que o Pedro não contou.
6. O texto PÚBLICO nunca fala do sistema de checagem: não escreva "parcialmente sustentada", "fonte única", "sem verificação independente", "não verificada". Quando algo ainda é só anúncio, intenção ou declaração, diga isso do jeito de quem fala ("o governo diz que pretende…", "por enquanto é só anúncio", "ainda não há regra publicada"). Limitação da fonte vai para o briefing, não para o slide.
7. Um slide de prova mostra UM dado ou UMA declaração, com no máximo um trecho em **destaque**. Vários dados vão em slides separados.
8. Slide de opinião é a posição do Pedro sobre o assunto (o que ele acha e por quê), nunca um comentário sobre a qualidade das fontes.
9. Slide sem claim_ids só pode ser: capa, transição, pergunta ou OPINIÃO marcada ("opiniao": true). Generalização como "reduzir horas costuma elevar custos" é opinião ou precisa de afirmação com fonte; não escreva como fato.
10. Não acrescente detalhe factual que não esteja nas afirmações ligadas ao slide (prazo, exceção, quem decide, acordo coletivo etc.).

ESTRUTURA: escolha a que a pauta pede (a sugerida é ${briefing.estrutura}). Cada slide tem UMA função (capa, contexto, prova, explicacao, comparacao, consequencia, opiniao) e precisa acrescentar informação, compreensão ou progressão: se não acrescenta, não escreva. ${formato === 'estatico' ? '' : 'Use o número de slides que a história pedir (entre 4 e 8 de conteúdo); não existe meta de quantidade.'} Texto por slide curto o bastante para ler no celular (capa até 18 palavras; demais até 45).
Marque com **duas estrelas** no máximo 2 trechos por slide.
Para "comparacao" preencha dados: {"esquerda":{"rotulo":"","valor":"","detalhe":""},"direita":{...}} só com valores das afirmações.

TRÊS CAPAS realmente diferentes para a MESMA base factual, uma de cada foco: "acontecimento" (o fato novo, direto), "consequencia" (o efeito na vida prática), "tensao" (a pergunta ou tensão central). Explique em 1 frase a diferença. Não escolha a que tiver mais números ou palavras agressivas.

LEGENDA: primeira linha forte, até 600 caracteres, sem repetir os slides, com a fonte principal citada em texto. CTA coerente com o objetivo (${briefing.objetivo}): ${E.OBJETIVOS[briefing.objetivo]?.cta}. No máximo 3 hashtags (ou nenhuma). Varie a abertura e o fechamento em relação aos posts recentes.
${instrucoes ? `INSTRUÇÃO DO PEDRO: ${instrucoes}\n` : ''}${feedback ? `\nA VERSÃO ANTERIOR TEVE PROBLEMAS. CORRIJA SÓ ISTO:\n${feedback}\n` : ''}
${rec.bloco}

Responda APENAS JSON:
{"estrutura":"acontecimento","capas":[{"foco":"acontecimento","texto":"","explicacao":"","claim_ids":[]},{"foco":"consequencia",...},{"foco":"tensao",...}],"slides":[{"funcao":"capa","rotulo":"","titulo":"","texto":"","claim_ids":[],"opiniao":false,"dados":null}],"legenda":"","legenda_claim_ids":[],"cta":"","hashtags":[]}`,
    });
    return { dados, llm };
  };

  // A Vercel corta a etapa em 60 s: a segunda tentativa (correção) só roda se a
  // primeira terminou cedo. Se não der tempo, os problemas continuam visíveis.
  const t0 = Date.now();
  let r = await pedir('');
  let m = montarVersao({ dados: r.dados, claims, evidencias, formato });
  let prov = provisorio({ claims, evidencias, fonte, versao: m.versao, opinioes: m.opinioes });
  const fatosProblemas = (c) => G.bloqueios(c, { conta: M.ACCOUNT_PIN }).filter((b) => ['numero_sem_origem', 'numero_sem_afirmacao', 'citacao_sem_origem', 'atribuicao_sem_origem', 'valores_divergentes', 'ressalva_ausente'].includes(b.id));
  let falhas = fatosProblemas(prov);
  let tentativas = 1;
  const tempoUsado = Date.now() - t0;
  let semTempo = false;
  if ((falhas.length || m.problemas.length) && budget.usados < budget.max && tempoUsado > 24000) semTempo = true;
  if ((falhas.length || m.problemas.length) && budget.usados < budget.max && !semTempo) {
    const fb = [...falhas.map((b) => `- ${b.titulo}: ${b.detalhe}`), ...m.problemas.map((p) => `- ${p}`)].join('\n');
    try {
      const restante = 50000 - (Date.now() - t0);
      const r2 = await Promise.race([pedir(fb), new Promise((_, no) => setTimeout(() => no(new Error('sem tempo para a correção')), Math.max(1000, restante)))]);
      const m2 = montarVersao({ dados: r2.dados, claims, evidencias, formato });
      const prov2 = provisorio({ claims, evidencias, fonte, versao: m2.versao, opinioes: m2.opinioes });
      const f2 = fatosProblemas(prov2);
      tentativas = 2;
      if (f2.length + m2.problemas.length <= falhas.length + m.problemas.length) { r = r2; m = m2; prov = prov2; falhas = f2; }
    } catch (e) { /* mantém a primeira tentativa; os problemas continuam visíveis */ }
  }
  // Linha de fonte das provas e comparações: do registro, nunca da IA.
  m.versao.slides.forEach((s) => { if (['prova', 'comparacao'].includes(s.layout)) s.fonte_linha = M.linhaDeFonte(prov, s.claim_ids) || null; });
  return { versao: m.versao, opinioes: m.opinioes, problemas_de_forma: m.problemas, bloqueios_de_fatos: falhas.map((b) => ({ id: b.id, detalhe: b.detalhe })), llm: r.llm, tentativas, correcao_pulada_por_tempo: semTempo };
}

// ── Auditoria do texto público ─────────────────────────────────────────────
// Nem toda afirmação errada tem número ou aspas. A IA lista as afirmações de
// fato de cada slide e da legenda (inclusive as escondidas numa opinião, como
// "aumenta impostos") e diz qual afirmação conferida sustenta cada uma; o código
// só aceita ids que existem. Fato sem afirmação vira bloqueio.
async function auditarOpinioes({ slides, claims }, d0) {
  const d = deps(d0);
  const ops = (slides || []).filter((s) => s && s.id && s.texto).slice(0, 12);
  if (!ops.length) return { auditoria: [] };
  const ids = new Set(claims.map((c) => c.id));
  const lista = claims.filter((c) => c.tipo !== 'opiniao' && c.decisao?.tipo !== 'retirar').map((c) => ({ id: c.id, texto: c.texto, estado: c.estado }));
  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.1, maxTokens: 1500, esforco: 'low',
    sistema: `Você separa, em textos de post, o que é avaliação do autor do que é afirmação de fato. É rigoroso: "aumenta a carga tributária", "vai fechar empresas", "a maioria apoia", "muda a rotina dos agentes de saúde" são afirmações de fato. Uma afirmação só é sustentada se a afirmação conferida diz a MESMA coisa (mesmo sujeito, alcance, status e números).\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `AFIRMAÇÕES CONFERIDAS: ${JSON.stringify(lista)}

TEXTOS DO POST: ${JSON.stringify(ops.map((s) => ({ id: s.id, texto: String(s.texto).replace(/\*\*/g, '') })))}

Para cada texto, liste as afirmações de FATO (não as avaliações, perguntas ou convites) e, para cada uma, o id da afirmação conferida que a sustenta, ou null se nenhuma sustenta.
Responda APENAS JSON: {"slides":[{"id":"s4","premissas":[{"texto":"","claim_id":null}]}]}`,
  });
  const auditoria = (dados.slides || []).filter((x) => ops.some((s) => s.id === x.id)).map((x) => {
    const s = ops.find((y) => y.id === x.id);
    return {
      slide_id: x.id, hash_texto: require('../../static/contentModel').hash(s.texto),
      premissas: (x.premissas || []).slice(0, 6).map((p) => ({ texto: String(p.texto || '').slice(0, 240), claim_id: ids.has(String(p.claim_id)) ? String(p.claim_id) : null })).filter((p) => p.texto),
    };
  });
  return { auditoria, llm };
}

module.exports = { auditarOpinioes, gerarBriefing, gerarCopia, montarVersao, provisorio, resumoClaim, LAYOUT_POR_FUNCAO };
