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
const HG = require('../../static/hookGuard');
const { ACCOUNT } = require('./account');

const deps = (d = {}) => ({ llmJson: d.llmJson || require('./llmJson') });

// Perfil de voz definido pelo Pedro (Ajustes). Orienta o estilo; NUNCA autoriza inventar
// fato, número, citação ou experiência pessoal — as regras de fatos continuam acima dele.
const vozDoPedro = (voz) => {
  const t = String(voz || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 1500);
  return t ? `\n\nPERFIL DE VOZ DEFINIDO PELO PEDRO (estilo apenas; não autoriza inventar fatos, números, citações nem histórias pessoais):\n${t}` : '';
};

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
const utilizaveis = (claims) => claims.filter((c) => c.decisao?.tipo !== 'retirar' && !(c.tipo === 'opiniao' && c.origem === 'copy'));

async function gerarBriefing({ fonte, claims: todas, evidencias, recentes = [], objetivo, formato, voz }, d0) {
  const d = deps(d0);
  const claims = utilizaveis(todas);
  const lista = claims.map((c) => resumoClaim(c, evidencias));
  const f = d.llmJson.dado('FONTE_PRINCIPAL', `${fonte.titulo}\n${fonte.veiculo} · ${fonte.publicada_em || 'sem data'}\n\n${String(fonte.texto || '').slice(0, 3000)}`, 3500);
  const rec = d.llmJson.dado('POSTS_RECENTES_DO_PERFIL', recentes.slice(0, 4).join('\n'), 700);
  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.35, maxTokens: 1400,
    sistema: `${E.VOZ}${vozDoPedro(voz)}\n\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `Monte o BRIEFING editorial deste conteúdo para ${ACCOUNT.handle}. Use SÓ as afirmações listadas (por id) como fatos disponíveis. Afirmações "nao_verificada", "parcialmente_sustentada" ou "contradita" NÃO são fatos: registre-as em duvidas.

AFIRMAÇÕES (com o estado verificado pelo sistema):
${JSON.stringify(lista)}

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


const DIRECAO_EDITORIAL = `DIREÇÃO PARA O CELULAR:
- A capa traz uma tensão CONCRETA da matéria. Não use "Será que... realmente...?", "Você sabia?", "Isso muda tudo" ou pergunta genérica. Curiosidade vem do acontecimento.
- Selecione o que muda para o leitor. Não enumere votos e trâmites se a pauta não for sobre a votação. Prefira a consequência concreta e a evidência a uma cronologia burocrática.\n- Título até 7 palavras; corpo de 1 ou 2 frases. Título e corpo se complementam, NUNCA repetem a mesma frase. O dado principal pode ser o título.
- Atribua uma vez: "segundo a Agência Brasil". Não repita "segundo" no slide. Não use rótulos "contexto", "prova" ou "gap" como título.
- Defina composicao: "numero" para dado como título; "recorte" para resumo fiel da fonte; "foto" para contraste visual; "manifesto" para posição; "pergunta" para UMA pergunta ao leitor sobre escolha concreta; "texto" para transição. Varie pelo menos 3 composições. Isso não autoriza criar afirmações.
- Perto do fim, UMA pergunta participativa ligada ao caso (o que cobraria, escolheria ou mudaria). funcao explicacao, composicao pergunta. Sem fato novo, sem "comente SIM" nem enquete inventada.
- Sem moral pronta, tom de consultor ou generalização absoluta. Não force opinião: a posição pode ser uma cobrança concreta, nunca um efeito econômico inventado. A capa anuncia o acontecimento da fonte, não uma lição genérica.
- CTA até 24 palavras com UMA ação, conforme o objetivo pedido, e benefício concreto ligado ao tema. Escreva a chamada apenas no campo cta, nunca como outro slide. Sem "análises rápidas", "mais insights", "próximas notícias" ou história pessoal de origem inventada.
`;

// ── Copy ───────────────────────────────────────────────────────────────────
const LAYOUT_POR_FUNCAO = { capa: 'capa_tipografica', contexto: 'explicacao', explicacao: 'explicacao', consequencia: 'explicacao', opiniao: 'explicacao', prova: 'prova', comparacao: 'comparacao', encerramento: 'encerramento' };


// Dados dos slides do tema "reportagem": só texto curto, sem HTML; o valor passa depois pelos mesmos gates de número dos textos.
const curto = (v, n) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const ladoDado = (l) => ({ rotulo: curto(l && l.rotulo, 14), valor: curto(l && l.valor, 14), ...(l && l.unidade ? { unidade: curto(l.unidade, 24) } : {}), ...(l && l.detalhe ? { detalhe: curto(l.detalhe, 60) } : {}) });
function dadosComparacao(d) {
  const out = { esquerda: ladoDado(d.esquerda), direita: ladoDado(d.direita) };
  if (d.faixa && d.faixa.valor) out.faixa = { valor: curto(d.faixa.valor, 28), ...(d.faixa.texto ? { texto: curto(d.faixa.texto, 30) } : {}) };
  out.tom = d.tom === 'alerta' ? 'alerta' : 'neutro';
  return out;
}
const dadosNumero = (d) => ({ numero: { valor: curto(d.numero.valor, 8), rotulo: curto(d.numero.rotulo, 22) } });

function montarVersao({ dados, claims, evidencias, formato, editorial = false, recentes = [] }) {
  const ids = new Set(claims.map((c) => c.id));
  const novasOpinioes = [];
  const limpaIds = (arr) => [...new Set((arr || []).map(String).filter((i) => ids.has(i)))];
  const problemas = [];
  const chamada = texto => /^(siga|segue|salve|guarde|envie|envia|manda|mande|compartilhe)\b/i.test(String(texto||'').replace(/\*+/g,'').trim());

  const contraRecentes = (recentes || []).map((r) => String(r).split(/\n/)[0]).filter(Boolean);
  const capas = (E.COMPOSICAO_CAPAS).map((cfg) => {
    const c = (dados.capas || []).find((x) => x && x.foco === cfg.foco);
    if (!c || !c.texto) { problemas.push(`faltou a capa de foco "${cfg.foco}"`); return null; }
    const texto = String(c.texto).slice(0, 220);
    // Capa copiada de exemplo/gancho já publicado, ou parecida com post recente, volta para correção.
    const g = HG.verificar(texto, { contra: contraRecentes });
    if (!g.ok) problemas.push(`a capa de foco "${cfg.foco}" ${g.motivo.charAt(0).toLowerCase()}${g.motivo.slice(1)}`);
    return { id: `k_${cfg.foco}`, foco: cfg.foco, texto, explicacao: String(c.explicacao || '').slice(0, 220), claim_ids: limpaIds(c.claim_ids), formula: HG.detectarFormula(texto) };
  }).filter(Boolean);

  const slides = [];
  (dados.slides || []).slice(0, 9).forEach((s, i) => {
    if (!s || !s.texto) return;
    const funcao = E.FUNCOES_SLIDE[s.funcao] ? s.funcao : 'explicacao';
    if(funcao==='encerramento' || (!s.opiniao && (chamada(s.titulo) || (!(s.claim_ids||[]).length && chamada(s.texto)))))return; // appended once from the dedicated CTA field
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
      dados: layout === 'comparacao' ? dadosComparacao(s.dados) : (s.dados && s.dados.numero ? dadosNumero(s.dados) : null), claim_ids,
      ...(editorial ? { design:'editorial_2026', composicao:['numero','recorte','pergunta','foto','manifesto','texto'].includes(s.composicao) ? s.composicao : null } : {}),
    });
  });
  if (formato === 'estatico') slides.splice(1);
  const cta = String(dados.cta || '').slice(0, 200);
  if (formato !== 'estatico' && cta) slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'encerramento', titulo: null, texto: cta, claim_ids: [] });
  if (slides.length < (formato === 'estatico' ? 1 : 3)) problemas.push('poucos slides');

  // Slide de conteúdo sem afirmação ligada e sem ser opinião: provável fato sem fonte.
  slides.forEach((s, i) => {
    if (i > 0 && !['encerramento', 'capa'].includes(s.funcao) && !(s.claim_ids || []).length && s.texto.split(/\s+/).length > 8) problemas.push(`o slide ${i + 1} afirma algo sem afirmação ligada: ligue a uma afirmação (claim_ids) ou marque como opinião`);
    if (editorial && [s.titulo,s.texto].filter(Boolean).join(' ').replace(/\*\*/g,'').split(/\s+/).filter(Boolean).length > 32) problemas.push(`o slide ${i + 1} tem texto demais: reduza título e corpo juntos para até 28 palavras, preservando os fatos e a atribuição`);
  });
  const META = /parcialmente (sustentad|confirmad)|confirmad[oa] parcialmente|n[aã]o confirmad|fonte [uú]nica|verifica[cç][aã]o independente|n[aã]o verificad|sustentada por|estado da afirma|claim_ids?|\[a\d+\]|【/i;
  slides.forEach((s, i) => { if (META.test(s.texto)) problemas.push(`o slide ${i + 1} fala do sistema de checagem em vez de falar do assunto (reescreva sem "fonte única", "sustentada" etc.)`); });
  if (META.test(dados.legenda || '')) problemas.push('a legenda fala do sistema de checagem em vez de falar do assunto');
  const proibidas = (E.FRASES_PROIBIDAS || []).filter((f) => f.re.test(normBase([...slides.map((s) => `${s.titulo || ''} ${s.texto}`), dados.legenda || '', cta].join(' '))));
  proibidas.forEach((f) => problemas.push(`o texto usa “${f.rotulo}”: reescreva sem essa expressão`));
  if (formato !== 'estatico' && slides.length >= 2) {
    const pal = (t) => new Set(normBase(t).split(' ').filter((w) => w.length > 3));
    const a = pal(slides[0].texto), b = pal(slides[1].texto);
    if (a.size >= 3 && b.size >= 3 && [...a].filter((w) => b.has(w)).length / Math.min(a.size, b.size) >= 0.5) problemas.push('o segundo slide repete a capa: ele precisa acrescentar o que falta entender');
  }
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

function capasConferidas(c, v) {
  return (v.capas || []).filter(k=>{
    const anchors=String(c.fonte_principal?.titulo||'').match(/\b[\p{Lu}][\p{L}\p{N}_-]{2,}/gu)||[];
    if(v.slides[0]?.design==='editorial_2026' && !M.extrairNumeros(k.texto).length && anchors.length && !anchors.some(a=>normBase(k.texto).includes(normBase(a))))return false;
    const slide={...v.slides[0],titulo:null,texto:k.texto,claim_ids:k.claim_ids||[]};
    const p=provisorio({claims:c.claims,evidencias:c.evidencias,fonte:c.fonte_principal,versao:{...v,slides:[slide]},opinioes:[]});
    // Required attribution is added by manterAtribuicoes after cover selection.
    return !G.bloqueios(p,{conta:M.ACCOUNT_PIN}).some(b=>['numero_sem_origem','numero_sem_afirmacao','citacao_sem_origem','atribuicao_sem_origem','valores_divergentes'].includes(b.id));
  });
}

async function gerarCopia({ briefing, fonte, claims: todas, evidencias, recentes = [], formato = 'carrossel', editorial = false, instrucoes = '', voz, objetivo }, d0) {
  const d = deps(d0);
  const claims = utilizaveis(todas);
  const semBase = premissasCausais(briefing.tese, claims).length > 0;
  const lista = claims.map((c) => { const {motivo,fontes,risco,central,mutavel,...essenciais}=resumoClaim(c,evidencias); return essenciais; });
  const direcao=editorial?{assunto:fonte.titulo,objetivo:objetivo||briefing.objetivo,estrutura:'fatos e detalhes da matéria, sem consequência ou opinião obrigatória',orientacao:'Explique os fatos listados. A progressão nasce dos detalhes da notícia; não imponha uma tese, moral ou consequência que a fonte não apresenta.'}:{assunto:briefing.assunto,acontecimento:briefing.acontecimento,objetivo:briefing.objetivo,tese:semBase?'Explique somente os fatos abaixo.':briefing.tese,tese_tipo:semBase?'explicacao':briefing.tese_tipo,estrutura:E.ESTRUTURAS[briefing.estrutura]?.nome,motivo_compartilhar:briefing.motivo_compartilhar,conflito:briefing.conflito,duvidas:briefing.duvidas};
  const rec = d.llmJson.dado('POSTS_RECENTES_DO_PERFIL', recentes.slice(0, 4).join('\n'), 700);
  const budget = { max: 2, usados: 0 };

  const pedir = async (feedback) => {
    const { dados, llm } = await d.llmJson.pedirJson({
      temperatura: 0.45, maxTokens: editorial ? 2200 : 2600, esforco: 'low', budget,
      sistema: `${E.VOZ}${vozDoPedro(voz)}\n\n${d.llmJson.REGRAS_DADOS}`,
      usuario: `Escreva o conteúdo para ${ACCOUNT.handle} seguindo o BRIEFING. ${formato === 'estatico' ? 'Formato: post estático (UMA imagem que se sustenta sozinha).' : 'Formato: carrossel.'}

BRIEFING (tese é uma hipótese editorial, nunca uma fonte factual): ${JSON.stringify(direcao)}

AFIRMAÇÕES DISPONÍVEIS (use claim_ids exatos; o estado é o verificado pelo sistema):
${JSON.stringify(lista)}

REGRAS DE FATOS (inegociáveis):
1. Use só as afirmações listadas e claim_ids exatos. Todo número, data, nome, citação ou detalhe factual precisa constar na afirmação ligada ou no cálculo dela. Não invente fontes nem causalidade. Uma pergunta não pode insinuar um mecanismo que a fonte não traz. Multa não prova repasse ao consumidor; dólar em queda não prova que seja hora de investir.
2. sustentada pode ser fato. parcialmente_sustentada e nao_verificada só entram com atribuição explícita ao veículo. contradita não entra. Respeite natureza, precisa_atribuicao e condicao_obrigatoria, inclusive na capa. Anúncio não é regra vigente, previsão não é certeza.
3. Aspas só para trecho exato. Nome de quem disse vem da fonte. Fonte, condição e ressalvas não podem ser removidas para criar impacto.
4. Opinião é marcada opiniao:true, com claim_ids das premissas factuais, e deve soar como posição ("na minha leitura"). Nunca invente experiência pessoal. Fatos embutidos em opinião continuam exigindo fonte. Perguntas e convites sem fato novo não precisam de claim_ids.
5. Um slide de prova mostra um dado ou declaração. Toda explicação acrescenta compreensão. Não escreva sobre a checagem interna: nada de "claim", "fonte única", "parcialmente sustentada" ou "sem verificação independente" no texto público. Uma limitação real é falada normalmente ("o governo diz que pretende", "ainda depende de aprovação").

${E.padraoParaPrompt({ formato, editorial })}

ESTRUTURA: escolha a que a pauta pede (a sugerida é ${briefing.estrutura}). Cada slide tem UMA função (capa, contexto, prova, explicacao, comparacao, consequencia, opiniao) e acrescenta informação ou compreensão. ${formato === 'estatico' ? 'Uma imagem.' : editorial ? 'Use 5 a 6 slides de conteúdo + CTA final; histórias curtas podem ter 4.' : `Base de ${E.SLIDES_BASE.min} a ${E.SLIDES_BASE.max} slides contando o encerramento fixo (4 a 5 de conteúdo mais o fecho); até 8 de conteúdo só quando a pauta exigir.`} CAPA de 4 a 10 palavras, com um número, uma contradição ou uma consequência concreta no bolso de quem lê (nada de capa que parece manchete de jornal nem "Como…?" genérico); demais telas até ${editorial?28:35} palavras, contando título e corpo, e UMA ideia por tela.
${editorial ? DIRECAO_EDITORIAL : ''}
Marque com **duas estrelas** UM único trecho por slide (a expressão principal); nunca mais de um.
Para "comparacao" preencha dados: {"esquerda":{"rotulo":"DEZ/2022","valor":"198,7 mil","unidade":"pessoas"},"direita":{...},"faixa":{"valor":"+97,4%","texto":"em cadastros"},"tom":"neutro"} só com valores das afirmações (rótulo de até 14 caracteres, valor de até 14, unidade de até 24). "tom":"alerta" só quando as fontes mostram piora e você assume essa leitura; na dúvida use "neutro". Quando UM número carrega o slide (função "prova"), use dados: {"numero":{"valor":"36","rotulo":"Impostos"}} e escreva em "texto" o que ele conta. Não invente rótulo, valor nem variação: a variação percentual só entra se o cálculo estiver nas afirmações ou for exata entre os dois valores.

TRÊS CAPAS realmente diferentes para a MESMA base factual, uma de cada foco: "acontecimento" (o fato novo, direto), "consequencia" (${editorial ? 'um detalhe relevante da matéria; só mencione efeito prático se a base o demonstrar' : 'o efeito na vida prática'}), "tensao" (a pergunta ou tensão central). Explique em 1 frase a diferença. Não escolha a que tiver mais números ou palavras agressivas.
GANCHO DA CAPA: cada capa usa uma FÓRMULA diferente entre estas (a mecânica se repete, o texto não): ${Object.values(HG.FORMULAS).map((f) => `${f.nome} (${f.dica})`).join('; ')}. EXEMPLOS PROIBIDOS: não copie nem parafraseie nenhum destes (eles só mostram o mecanismo, e dois deles já saíram sem resultado algum): ${HG.proibidos().map((x) => `“${x.texto}”`).join(' · ')}. Também não repita a abertura de nenhum post recente listado.

LEGENDA: primeira linha forte, até 600 caracteres, com a fonte principal citada em texto. Pode retomar o fato principal e acrescentar somente detalhes das afirmações listadas; não invente consequências para evitar repetição. ${objetivo ? require('../../static/growthModel').OBJETIVOS[objetivo]?.cta || '' : `CTA coerente com o objetivo (${briefing.objetivo}): ${E.OBJETIVOS[briefing.objetivo]?.cta}.`} O CTA do último slide pede ENVIO a uma pessoa específica ("manda para quem…") ou salvamento, e quando convida a seguir diz O QUE a pessoa recebe seguindo; nunca apenas "segue o perfil". O único @ permitido é @pedro_destrava (com underscore). No máximo 3 hashtags (ou nenhuma). Varie a abertura e o fechamento em relação aos posts recentes.
${instrucoes ? `INSTRUÇÃO DO PEDRO: ${instrucoes}\n` : ''}${feedback ? `\nA VERSÃO ANTERIOR TEVE PROBLEMAS. CORRIJA SÓ ISTO:\n${feedback}\n` : ''}
${rec.bloco}

Responda APENAS JSON:
{"estrutura":"acontecimento","capas":[{"foco":"acontecimento","texto":"","explicacao":"","claim_ids":[]},{"foco":"consequencia",...},{"foco":"tensao",...}],"slides":[{"funcao":"capa","composicao":"texto","rotulo":"","titulo":"","texto":"","claim_ids":[],"opiniao":false,"dados":null}],"legenda":"","legenda_claim_ids":[],"cta":"","hashtags":[]}`,
    });
    return { dados, llm };
  };

  // A Vercel corta a etapa em 60 s: a segunda tentativa (correção) só roda se a
  // primeira terminou cedo. Se não der tempo, os problemas continuam visíveis.
  const t0 = Date.now();
  let r = await pedir('');
  let m = montarVersao({ dados: r.dados, claims, evidencias, formato, editorial, recentes });
  let prov = provisorio({ claims, evidencias, fonte, versao: m.versao, opinioes: m.opinioes });
  const fatosProblemas = (c) => G.bloqueios(c, { conta: M.ACCOUNT_PIN }).filter((b) => ['numero_sem_origem', 'numero_sem_afirmacao', 'citacao_sem_origem', 'atribuicao_sem_origem', 'valores_divergentes', 'ressalva_ausente'].includes(b.id));
  let falhas = fatosProblemas(prov);
  let tentativas = 1;
  const tempoUsado = Date.now() - t0;
  let semTempo = false;
  if ((falhas.length || m.problemas.length) && budget.usados < budget.max && tempoUsado > 24000) semTempo = true;
  if ((falhas.length || m.problemas.length) && budget.usados < budget.max && !semTempo) {
    const fb = [...falhas.map((b) => `- ${b.titulo}: ${b.detalhe}`), ...m.problemas.map((p) => `- ${p}`)].join('\n');
    let prazo;
    try {
      const restante = 50000 - (Date.now() - t0);
      const r2 = await Promise.race([pedir(fb), new Promise((_, no) => { prazo = setTimeout(() => no(new Error('sem tempo para a correção')), Math.max(1000, restante)); })]);
      const m2 = montarVersao({ dados: r2.dados, claims, evidencias, formato, editorial, recentes });
      const prov2 = provisorio({ claims, evidencias, fonte, versao: m2.versao, opinioes: m2.opinioes });
      const f2 = fatosProblemas(prov2);
      tentativas = 2;
      if (f2.length + m2.problemas.length <= falhas.length + m.problemas.length) { r = r2; m = m2; prov = prov2; falhas = f2; }
    } catch (e) { /* mantém a primeira tentativa; os problemas continuam visíveis */ }
    finally { clearTimeout(prazo); }
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
const normBase = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\*\*/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const RAIZES_CAUSAIS=['repass','dilui','encarec','barate'];
function premissasCausais(texto, claims) {
  const base=normBase(claims.filter(c=>c.tipo!=='opiniao'&&c.natureza!=='opiniao'&&c.decisao?.tipo!=='retirar').map(c=>c.texto).join(' '));
  return RAIZES_CAUSAIS.some(raiz=>normBase(texto).includes(raiz)&&!base.includes(raiz)) ? [{texto:String(texto).slice(0,240),claim_id:null,verificacao_deterministica:true}] : [];
}
function premissaConferida(p, claims) {
  const texto=String(p.texto||'').slice(0,240), k=claims.find(c=>c.id===String(p.claim_id) && c.tipo!=='opiniao' && c.natureza!=='opiniao' && c.decisao?.tipo!=='retirar');
  const trecho=String(p.trecho_base||'').trim(), base=normBase(k?.texto);
  let ok=!!k && trecho.length>=8 && base.includes(normBase(trecho));
  // Regression guard: a fine or price movement does not prove a new causal
  // mechanism. An ID about the same company alone cannot support that claim.
  const relacoes=[/repass\w*/g,/dilui\w*/g,/encarec\w*/g,/barate\w*/g,/garant\w*/g];
  for(const r of relacoes){const raiz=r.source.split('\\')[0];if(new RegExp(raiz).test(normBase(texto))&&!new RegExp(raiz).test(base))ok=false;}
  return {texto,claim_id:ok?k.id:null,...(ok?{trecho_base:trecho}: {})};
}
async function auditarOpinioes({ slides, claims, revisaoIntegral = false }, d0) {
  const d = deps(d0);
  const ops = (slides || []).filter((s) => s && s.id && (s.texto || s.titulo)).slice(0, 12)
    .map((s) => ({ ...s, texto: M.textoParaAuditoria(s) }));
  if (!ops.length) return { auditoria: [] };
  const lista = claims.filter((c) => c.tipo !== 'opiniao' && c.natureza !== 'opiniao' && c.decisao?.tipo !== 'retirar').map((c) => ({ id: c.id, texto: c.texto, estado: c.estado }));
  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.1, maxTokens: 1500, esforco: 'low',
    sistema: `Você separa avaliações de afirmações factuais. Afirmações condicionais e possibilidades causais também precisam de base: "pode repassar a multa ao consumidor" não é sustentada por "a empresa foi multada". "O dólar caiu" não prova vantagem para comprar ações. Perguntas e CTAs podem embutir essas premissas: confira-os também. Uma base só sustenta a MESMA relação (mesmo sujeito, efeito, alcance, status e números). Para ligar um claim_id, copie um trecho_base literal da afirmação que realmente demonstra essa relação; coincidência de nome ou número não basta. Sem base integral, claim_id:null. Opiniões anteriores não são fontes.\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `AFIRMAÇÕES CONFERIDAS: ${JSON.stringify(lista)}

TEXTOS DO POST: ${JSON.stringify(ops.map((s) => ({ id: s.id, texto: String(s.texto).replace(/\*\*/g, '') })))}

Para cada texto, copie LITERALMENTE os trechos que afirmam fatos (sem paráfrase), com o id da afirmação conferida que os sustenta, ou null. Avaliação pura, título sem afirmação e convite sem fato recebem premissas:[]. Não preencha com rótulos de exemplo.
Devolva exatamente estes IDs, uma vez cada, sem trocar ou inventar: ${JSON.stringify(ops.map(s=>s.id))}. Se um texto não trouxer fatos, devolva premissas: [].
Responda APENAS JSON com slides. Cada slide contém id e premissas. Cada premissa contém texto (trecho literal do slide), claim_id e trecho_base (trecho literal da afirmação conferida).` ,
  });
  const recebidos = Array.isArray(dados?.slides) ? dados.slides : [];
  if (ops.some((s) => {
    const itens = recebidos.filter((x) => x && x.id === s.id);
    return itens.length !== 1 || !Array.isArray(itens[0].premissas)
      || itens[0].premissas.some((p) => !p || typeof p.texto !== 'string' || !p.texto.trim() || !normBase(s.texto).includes(normBase(p.texto)));
  })) {
    // A malformed extraction is not evidence against the post. The mandatory
    // full-text reviewer can still check every assertion against the sources.
    // These provisional records cannot pass the gates without that review.
    if(revisaoIntegral)return {auditoria:ops.map(s=>({slide_id:s.id,hash_texto:M.hash(s.texto),premissas:premissasCausais(s.texto,claims),extracao_incompleta:true})),llm};
    throw Object.assign(new Error('A conferência não cobriu todos os textos. Confira de novo antes de aprovar.'), { code: 'AUDITORIA_INCOMPLETA' });
  }
  const auditoria = recebidos.filter((x) => x && ops.some((s) => s.id === x.id)).map((x) => {
    const s = ops.find((y) => y.id === x.id);
    return {
      slide_id: x.id, hash_texto: require('../../static/contentModel').hash(s.texto),
      premissas: [...(x.premissas || []).slice(0, 6).map(p=>premissaConferida(p,claims)).filter((p) => p.texto),...premissasCausais(s.texto,claims)],
    };
  });
  return { auditoria, llm };
}

// A second, separately checkpointed task verifies entailment instead of writing
// or extracting copy. A matching entity/number is not evidence of causation.
async function conferirVinculos({auditoria,claims,textos,fonte},d0){
  const d=deps(d0),unidades=(textos||auditoria.map(a=>({id:a.slide_id,texto:a.premissas.map(p=>p.texto).join(' ')}))).filter(t=>t.texto);
  if(!unidades.length)return {auditoria};
  const bases=claims.filter(c=>c.tipo!=='opiniao'&&c.natureza!=='opiniao'&&c.decisao?.tipo!=='retirar'&&c.estado!=='contradita').map(c=>({id:c.id,texto:c.texto}));
  const {dados,llm}=await d.llmJson.pedirJson({temperatura:0,maxTokens:1800,esforco:'medium',
    sistema:`Confira TODO o texto de cada tela contra as bases, sem conhecimento externo. Pode haver fatos que outro revisor deixou passar. Possibilidades ("podem perder clientes", "pode aumentar a margem") afirmam mecanismos: sem base explícita, bloqueie. "Multas garantem qualidade" também exige prova do efeito; não é só opinião. Perguntas podem insinuar premissas não demonstradas. Mesma empresa ou número não prova uma relação causal. "O dólar caiu" não sustenta "a margem melhora e favorece ações". "A empresa foi multada" não sustenta repasse ao consumidor nem perda de clientes. Não confunda prazo futuro com regra vigente. Avaliações puras ("eu cobraria um plano de melhoria"), perguntas sem pressuposto factual e convites a seguir/salvar não precisam de prova. sustenta:true significa que todos os fatos do texto estão nas bases.\n${d.llmJson.REGRAS_DADOS}`,
    usuario:`FONTE DAS BASES: ${JSON.stringify({veiculo:fonte?.veiculo||null,titulo:fonte?.titulo||null})}. Uma atribuição a esse veículo é válida. Preserve equivalência semântica quando sujeito, valor, período e condição forem os mesmos; uma paráfrase fiel não é um fato novo. Título e corpo devem ser lidos juntos.\n${d.llmJson.dado('BASES_FACTUAIS',JSON.stringify(bases),14000).bloco}\n${d.llmJson.dado('TEXTOS_COMPLETOS',JSON.stringify(unidades),6000).bloco}\nJSON com chave textos. Cada item contém id (um dos IDs reais: ${JSON.stringify(unidades.map(t=>t.id))}), sustenta (boolean) e problemas (array). Para texto sustentado ou convite sem fatos: sustenta:true,problemas:[]. Se faltar base: sustenta:false, problemas com texto (copie literalmente o trecho REAL problemático, até 160 caracteres) e motivo (explique o que falta). Não devolva rótulos ou exemplos como se fossem trechos do texto.`});
  if(!Array.isArray(dados?.textos)||unidades.some(p=>dados.textos.filter(v=>v?.id===p.id&&typeof v.sustenta==='boolean'&&Array.isArray(v.problemas)&&v.problemas.every(q=>q&&typeof q.texto==='string'&&q.texto.trim()&&normBase(p.texto).includes(normBase(q.texto)))).length!==1))throw Object.assign(new Error('A conferência das fontes não cobriu todos os textos.'),{code:'AUDITORIA_INCOMPLETA'});
  return {auditoria:auditoria.map(a=>{
    const v=dados.textos.find(v=>v.id===a.slide_id);if(!v)return a;
    const faltas=v.sustenta&&!v.problemas.length?[]:(v.problemas.length?v.problemas:[{texto:unidades.find(t=>t.id===a.slide_id)?.texto,motivo:'A base não demonstra este texto.'}]);
    const anteriores=v.sustenta&&!faltas.length?a.premissas.filter(p=>p.claim_id||p.verificacao_deterministica):a.premissas;
    return {...a,texto_conferido:true,premissas:[...anteriores.map(p=>p.claim_id?{...p,vinculo_conferido:v.sustenta}:p),...faltas.map(p=>({texto:String(p.texto||'Afirmação sem base.').slice(0,240),claim_id:null,motivo:String(p.motivo||'').slice(0,240)}))]};
  }),llm};
}

module.exports = { vozDoPedro, auditarOpinioes, conferirVinculos, premissaConferida, premissasCausais, gerarBriefing, gerarCopia, montarVersao, provisorio, capasConferidas, resumoClaim, LAYOUT_POR_FUNCAO };
