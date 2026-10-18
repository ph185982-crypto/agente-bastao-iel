// Pesquisa com evidências rastreáveis: ler a fonte, levantar afirmações,
// procurar confirmação independente e registrar cada coisa com origem.
//
// O que a IA faz aqui: LER texto e PROPOR afirmações, trechos e julgamentos.
// O que o código faz: conferir cada trecho no texto real, decidir independência
// entre fontes, calcular o estado de cada afirmação e recusar o que não se
// sustenta. Nada que a IA diga vira evidência sem passar por essa conferência.
const crypto = require('crypto');
const M = require('../../static/contentModel');
const Ev = require('./evidence');
const { extrairArtigo } = require('./extract');

const REDES_SOCIAIS = /(^|\.)(instagram\.com|facebook\.com|fb\.watch|fb\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|t\.me|wa\.me|threads\.net|kwai\.com)$/i;

function deps(d = {}) {
  return {
    safeFetch: d.safeFetch || require('./safeFetch').safeFetch,
    llmJson: d.llmJson || require('./llmJson'),
    feeds: d.feeds || require('./feeds'),
    connectors: d.connectors || require('./connectors'),
    busca: d.busca || require('./busca'),
    agora: d.agora || (() => Date.now()),
  };
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

// ── 1. Ler a fonte ─────────────────────────────────────────────────────────
async function lerFonte({ url, texto }, d0) {
  const d = deps(d0);
  if (texto && !url) {
    const t = String(texto).replace(/\r/g, '').trim();
    const dado = d.llmJson.dado('FONTE', t, 30000);
    return {
      tipo: 'texto', url: null, url_final: null, titulo: t.split('\n')[0].slice(0, 140), veiculo: 'Texto colado pelo Pedro', autores: null,
      publicada_em: null, atualizada_em: null, acessada_em: new Date(d.agora()).toISOString(), texto: t.slice(0, 30000),
      legivel: t.length >= 200, acesso: 'ok', hash: sha(t), dominio: null,
      suspeita_de_instrucao: dado.suspeita_de_instrucao,
      observacoes: ['Texto colado: prova só o que está escrito nele. A veracidade precisa de fonte externa.', ...(t.length < 200 ? ['Texto curto demais para extrair afirmações.'] : [])],
    };
  }
  const { validaUrl } = require('./safeFetch');
  const u = validaUrl(url);
  const host = u.hostname.replace(/^www\./, '');
  if (REDES_SOCIAIS.test(host)) {
    return {
      tipo: 'link', url: u.toString(), url_final: u.toString(), titulo: '', veiculo: host, autores: null, publicada_em: null, atualizada_em: null,
      acessada_em: new Date(d.agora()).toISOString(), texto: '', legivel: false, acesso: 'nao_legivel', hash: null, dominio: Ev.dominioRegistravel(u.toString()),
      observacoes: ['Redes sociais não são lidas automaticamente (exigem login e proíbem coleta). Cole o texto do post ou envie um print.'],
    };
  }
  const r = await d.safeFetch(u.toString(), { timeoutMs: 12000 });
  const base = {
    tipo: 'artigo', url: u.toString(), url_final: r.url_final, acessada_em: r.acessada_em, dominio: Ev.dominioRegistravel(r.url_final), redirecionamentos: r.redirecionamentos,
  };
  if (r.acesso_negado || r.status >= 400) {
    return { ...base, titulo: '', veiculo: host, autores: null, publicada_em: null, atualizada_em: null, texto: '', legivel: false, acesso: r.acesso_negado ? 'negado' : 'erro', hash: null,
      observacoes: [r.acesso_negado ? `O site recusou a leitura (HTTP ${r.status}). Não contorno bloqueio nem login: cole o texto ou envie um print.` : `O site respondeu HTTP ${r.status}. Tente de novo ou cole o texto.`] };
  }
  const a = extrairArtigo(r.corpo, r.url_final);
  const dado = d.llmJson.dado('FONTE', a.texto, 30000);
  return {
    ...base, titulo: a.titulo, veiculo: a.veiculo, autores: a.autores, publicada_em: a.publicada_em, atualizada_em: a.atualizada_em,
    texto: a.texto, legivel: a.legivel, acesso: a.legivel ? 'ok' : 'nao_legivel', hash: a.texto ? sha(a.texto) : null,
    suspeita_de_instrucao: dado.suspeita_de_instrucao,
    observacoes: [...a.observacoes, ...(dado.suspeita_de_instrucao ? ['O texto contém frases que parecem instruções para uma IA. Foram tratadas como dado e ignoradas.'] : [])],
  };
}

// ── 2. Levantar afirmações ─────────────────────────────────────────────────
const SERIES_PERMITIDAS = new Set([433, 1737, 1619, 432]);

function validaConector(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.tipo === 'bcb' && SERIES_PERMITIDAS.has(Number(c.serie)) && /^\d{4}-\d{2}$/.test(String(c.periodo || ''))) {
    return { tipo: 'bcb', serie: Number(c.serie), periodo: c.periodo, valor_dito: Number.isFinite(Number(c.valor_dito)) ? Number(c.valor_dito) : null };
  }
  if (c.tipo === 'camara' && /^[A-Za-z]{2,4}$/.test(String(c.sigla || '')) && Number.isInteger(Number(c.numero)) && /^\d{4}$/.test(String(c.ano))) {
    return { tipo: 'camara', sigla: String(c.sigla).toUpperCase(), numero: Number(c.numero), ano: Number(c.ano) };
  }
  return null;
}

async function levantarAfirmacoes(fonte, d0, { max = 8 } = {}) {
  const d = deps(d0);
  if (!fonte.legivel) throw Object.assign(new Error('A fonte não tem texto legível para extrair afirmações.'), { code: 'FONTE_ILEGIVEL' });
  const entrada = d.llmJson.dado('FONTE', fonte.texto, 24000);
  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.1, maxTokens: 4500,
    sistema: `Você é um checador de fatos cuidadoso. Extrai afirmações do texto e NUNCA acrescenta nada que não esteja nele.\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `Do texto abaixo, liste as afirmações FACTUAIS e CHECÁVEIS (no máximo ${max}). Para cada uma:
- texto: frase completa e autônoma (sem pronomes ambíguos), com os números exatos do trecho. Só use números (inclusive número de lei/emenda) que aparecem NO TRECHO escolhido; se precisar de outro número, escolha um trecho que o contenha. Não calcule prazos nem totais. NÃO fortaleça o que o texto diz: se o texto fala em proposta, estudo, intenção ou previsão, a afirmação diz isso ("O governo anunciou que pretende…", "O ministro estima que…"), nunca "a medida está em vigor" ou "a medida vai gerar";
- tipo: "fato", "calculo", "declaracao" (alguém DISSE algo: escreva "Fulano disse que…") ou "opiniao";
- natureza: "fato" (algo que aconteceu, está em vigor, OU regra já aprovada/promulgada/publicada, mesmo com prazo futuro — o que a lei/emenda determina é fato), "dado" (número/estatística), "anuncio" (proposta, plano ou intenção que ainda depende de decisão), "declaracao" (o que alguém disse), "previsao" (efeito futuro ESTIMADO por alguém, ex.: "vai gerar empregos") ou "opiniao";
- correspondencia: o trecho sustenta a afirmação INTEIRA ("integral") ou só parte ("parcial")? Se parcial, diga em "falta" o que não está no trecho;
- central: true só nas 3 ou 4 que sustentam a notícia;
- trecho: cópia EXATA e literal (até 300 caracteres) do texto que contém a afirmação. Não resuma, não corrija, não una pedaços;
- quando: data do acontecimento, só se o texto disser (senão null);
- mutavel: true se pode mudar com o tempo (situação de projeto, votação, preço, posição);
- risco: "alto" se acusa pessoa, envolve crime, saúde, eleição ou dinheiro público de forma grave; senão "baixo";
- valores: números da afirmação [{"valor":0,"unidade":"BRL|%|unidade|ano","periodo":""}];
- conector (opcional, só se a afirmação for exatamente sobre esse dado oficial): {"tipo":"bcb","serie":433|1737|1619|432,"periodo":"YYYY-MM","valor_dito":número} (433 = IPCA mensal em %, 1619 = salário mínimo em R$, 432 = meta Selic % a.a.) ou {"tipo":"camara","sigla":"PLP","numero":0,"ano":2026} (situação de proposição na Câmara).

${entrada.bloco}

Responda APENAS JSON: {"afirmacoes":[{"texto":"","tipo":"fato","natureza":"fato","correspondencia":"integral","falta":"","central":true,"trecho":"","quando":null,"mutavel":false,"risco":"baixo","valores":[],"conector":null}]}`,
  });

  const descartadas = [];
  const evidFonte = [];
  const claims = [];
  const hoje = new Date(d.agora()).toISOString();
  const grupoPrincipal = 'g0';
  (dados.afirmacoes || []).slice(0, max + 4).forEach((a) => {
    if (!a || !a.texto) return;
    const achou = Ev.acharTrecho(fonte.texto, a.trecho);
    if (!achou.ok) { descartadas.push({ texto: String(a.texto).slice(0, 120), motivo: achou.motivo }); return; }
    const tipo = ['fato', 'calculo', 'declaracao', 'opiniao'].includes(a.tipo) ? a.tipo : 'fato';
    const natureza = M.NATUREZAS.includes(a.natureza) ? a.natureza : M.naturezaDe({ tipo });
    const id = `a${claims.length + 1}`;
    // Correspondência: a IA diz se o trecho cobre tudo; o código confere os números.
    let correspondencia = a.correspondencia === 'parcial' ? 'parcial' : 'integral';
    let falta = a.falta ? String(a.falta) : null;
    const ausentes = Ev.numerosAusentes(a.texto, a.trecho);
    if (ausentes.length) { correspondencia = 'parcial'; falta = `o trecho não traz ${ausentes.join(', ')}`; }
    const colado = fonte.tipo === 'texto';
    const e = Ev.novaEvidencia({
      via: colado ? 'texto_colado' : 'artigo', url: fonte.url_final || fonte.url, titulo: fonte.titulo, origem: fonte.veiculo,
      trecho: String(a.trecho).slice(0, 400), publicada_em: fonte.publicada_em, consultada_em: fonte.acessada_em,
      abrangencia: natureza === 'declaracao' || natureza === 'anuncio' ? 'Prova que foi dito/anunciado, não que seja verdade ou que vá acontecer' : 'O que o texto afirma',
      limitacoes: colado ? 'Texto colado: prova o que está escrito nele, não que seja verdadeiro.' : null,
      correspondencia: tipo === 'opiniao' ? 'nao_sustenta' : correspondencia, falta,
      autoridade: colado ? 'texto_colado' : undefined,
      grupo: grupoPrincipal, dominio: fonte.dominio, via_fonte_principal: true,
    });
    e.fonte_principal = true;
    evidFonte.push(e);
    claims.push({
      id, texto: String(a.texto).slice(0, 400), tipo, natureza, central: !!a.central, risco: a.risco === 'alto' ? 'alto' : 'baixo',
      quando: a.quando || null, mutavel: !!a.mutavel, valores: (Array.isArray(a.valores) ? a.valores : []).filter((v) => v && Number.isFinite(Number(v.valor))).map((v) => ({ valor: Number(v.valor), unidade: String(v.unidade || ''), periodo: String(v.periodo || '') })),
      conector: validaConector(a.conector), evidencias: [e.id], origem: 'fonte_principal', criada_em: hoje, revisao: {},
    });
  });
  // No máximo 4 centrais.
  let centrais = 0;
  claims.forEach((c) => { if (c.central) { centrais += 1; if (centrais > 4) c.central = false; } });
  if (!claims.some((c) => c.central) && claims.length) claims[0].central = true;
  if (!claims.length) throw Object.assign(new Error('Não consegui extrair afirmações verificáveis desse texto.'), { code: 'SEM_AFIRMACOES', descartadas });
  claims.forEach((c) => {
    const r = M.avaliarAfirmacao(c, evidFonte);
    c.estado = r.estado;
    c.motivo_estado = r.motivo;
    c.exige_atribuicao = r.exige_atribuicao;
  });
  return { claims, evidencias: evidFonte, descartadas, llm };
}

// ── 3. Verificar uma afirmação ─────────────────────────────────────────────
const normPer = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function diferePeriodoOuUnidade(claim, m) {
  const pers = (claim.valores || []).map((v) => normPer(v.periodo)).filter(Boolean);
  const unis = (claim.valores || []).map((v) => normPer(v.unidade)).filter(Boolean);
  const pm = normPer(m.periodo); const um = normPer(m.unidade);
  return (pm && pers.length && !pers.some((p) => p === pm || p.includes(pm) || pm.includes(p))) || (um && unis.length && !unis.some((u) => u === um || u.includes(um) || um.includes(u)));
}

const STOP_EXTRA = new Set(['segundo', 'disse', 'afirmou', 'afirma', 'ainda', 'tambem', 'outro', 'outra', 'sobre', 'entre', 'apos', 'desde', 'quando', 'governo', 'federal']);

function consultaDe(claim, feeds) {
  const palavras = feeds.termos(claim.texto).filter((w) => !STOP_EXTRA.has(w));
  const nums = (claim.texto.match(/\d[\d.,]*%?/g) || []).filter((n) => n.length >= 2);
  const unicas = [...new Set(palavras)].sort((a, b) => b.length - a.length).slice(0, 7);
  return { palavras: unicas, numeros: nums.slice(0, 3) };
}

async function verificarAfirmacao(claim, fonte, evidenciasAtuais, d0, { maxCandidatos = 3, links = [] } = {}) {
  const d = deps(d0);
  const log = [];
  const novas = [];
  const hoje = d.agora();
  const budget = { max: 2, usados: 0 };
  const dominioFonte = fonte.dominio || Ev.dominioRegistravel(fonte.url_final || fonte.url || '');
  // Re-verificar renova o que veio de fora; a matéria de origem continua.
  const evidFonte = (evidenciasAtuais || []).filter((e) => (claim.evidencias || []).includes(e.id) && e.fonte_principal);

  // (a) Dado oficial, quando a afirmação é exatamente sobre ele.
  const con = validaConector(claim.conector);
  if (con?.tipo === 'bcb') {
    try {
      const r = await d.connectors.evidenciaSerieBcb(con.serie, con.periodo);
      if (r) {
        const e = r.evidencia;
        if (con.valor_dito != null) {
          e.relacao = d.connectors.compararNumero(con.valor_dito, r.valor);
          e.correspondencia = e.relacao === 'sustenta' ? 'integral' : 'contradiz';
          e.explicacao = e.relacao === 'sustenta' ? `O valor dito (${con.valor_dito}) confere com o oficial (${r.valor}).` : `O valor dito (${con.valor_dito}) difere do oficial (${r.valor}).`;
        } else { e.relacao = 'neutra'; e.correspondencia = 'nao_sustenta'; e.explicacao = 'Há dado oficial, mas a afirmação não traz valor para comparar.'; }
        novas.push(e);
        log.push(`Banco Central (SGS ${con.serie}, ${con.periodo}): ${r.valor}`);
      } else log.push(`Banco Central: sem valor para ${con.periodo}`);
    } catch (e) { log.push(`Banco Central indisponível: ${e.message}`); }
  }
  if (con?.tipo === 'camara') {
    try {
      const r = await d.connectors.proposicaoCamara({ sigla: con.sigla, numero: con.numero, ano: con.ano });
      if (r) { r.evidencia.relacao = 'neutra'; r.evidencia.correspondencia = 'nao_sustenta'; r.evidencia.explicacao = 'Situação oficial na Câmara (compare com o que a matéria diz).'; novas.push(r.evidencia); log.push(`Câmara: ${con.sigla} ${con.numero}/${con.ano} está "${r.situacao}"`); }
      else log.push(`Câmara: ${con.sigla} ${con.numero}/${con.ano} não encontrada`);
    } catch (e) { log.push(`Câmara indisponível: ${e.message}`); }
  }

  // (b) Outras matérias, nos feeds dos veículos (janela curta).
  const q = consultaDe(claim, d.feeds);
  const lidos = await d.feeds.lerTodos();
  const naoLidos = lidos.status.filter((s) => !s.ok && !s.inativo).map((s) => s.nome);
  const candidatosBrutos = d.feeds.filtrar(lidos.itens, { palavras: q.palavras, dias: 10, agora: hoje, minimo: Math.max(4, q.palavras.length) });
  const vistos = new Set([dominioFonte]);
  const candidatos = [];
  // Links que o Pedro mandou conferir: entram primeiro (mesmo domínio da fonte também,
  // para mostrar quando é reprodução da mesma matéria).
  for (const u of (links || []).slice(0, 3)) {
    try {
      const url = require('./safeFetch').validaUrl(u).toString();
      const dom = Ev.dominioRegistravel(url);
      if (url === fonte.url_final || url === fonte.url) continue;
      candidatos.push({ titulo: '', url, publicada_em: null, origem: dom, dominio: dom, via_link: true });
    } catch (e) { log.push(`Link recusado (${u}): ${e.message}`); }
  }
  for (const c of candidatosBrutos) {
    const dom = Ev.dominioRegistravel(c.url);
    if (vistos.has(dom) || c.url === fonte.url_final || candidatos.some((x) => x.dominio === dom)) continue;
    vistos.add(dom);
    candidatos.push({ ...c, dominio: dom });
    if (candidatos.length >= maxCandidatos) break;
  }
  log.push(`${lidos.status.filter((s) => s.ok).length} feeds lidos; ${candidatosBrutos.length} matérias parecidas; ${candidatos.length} de veículos diferentes escolhidas${naoLidos.length ? `; sem resposta: ${naoLidos.join(', ')}` : ''}`);

  // (b2) Busca web opcional: só acha links; a página é lida como as outras.
  let cobertura = d.busca.cobertura();
  if (d.busca.provedor() && candidatos.length < maxCandidatos) {
    try {
      const r = await d.busca.buscar([...q.palavras, ...q.numeros].join(' '), { dias: 30 });
      d.llmJson.registrarChamada?.({ provider: r.provedor, model: 'busca web', tipo: 'busca', duracao_ms: r.duracao_ms, ok: true, creditos: r.creditos });
      let n = 0;
      for (const x of r.resultados) {
        const dom = Ev.dominioRegistravel(x.url);
        if (vistos.has(dom) || x.url === fonte.url_final) continue;
        vistos.add(dom);
        candidatos.push({ titulo: x.titulo, url: x.url, publicada_em: x.publicada_em, origem: dom, dominio: dom, via_busca: r.provedor });
        n += 1;
        if (candidatos.length >= maxCandidatos) break;
      }
      log.push(`Busca web (${r.provedor}): ${r.resultados.length} resultado(s); ${n} de veículos novos para ler`);
    } catch (e) {
      d.llmJson.registrarChamada?.({ provider: d.busca.provedor(), model: 'busca web', tipo: 'busca', ok: false, erro: e.message });
      log.push(`Busca web indisponível: ${e.message}`);
      cobertura = `${cobertura} A busca falhou nesta conferência.`;
    }
  }

  const lidasPaginas = [];
  for (const c of candidatos) {
    try {
      const r = await d.safeFetch(c.url, { timeoutMs: 10000 });
      if (r.acesso_negado || r.status >= 400) { lidasPaginas.push({ ...c, texto: '', obs: `página recusou leitura (HTTP ${r.status})` }); continue; }
      const a = extrairArtigo(r.corpo, r.url_final);
      lidasPaginas.push({ ...c, url: r.url_final, titulo: a.titulo || c.titulo, veiculo: a.veiculo || c.origem, publicada_em: a.publicada_em || c.publicada_em, texto: a.texto, consultada_em: r.acessada_em, obs: a.legivel ? null : 'texto curto' });
    } catch (e) { lidasPaginas.push({ ...c, texto: '', obs: e.message }); }
  }

  const legiveis = lidasPaginas.filter((p) => p.texto && p.texto.length >= 400);
  if (legiveis.length) {
    const blocos = legiveis.map((p, i) => d.llmJson.dado(`MATERIA_${i}`, p.texto.slice(0, 5000), 5000).bloco).join('\n');
    try {
      const { dados, llm } = await d.llmJson.pedirJson({
        temperatura: 0.1, maxTokens: 2500, budget,
        sistema: `Você compara matérias com uma afirmação e é rigoroso: só diz que uma matéria "sustenta" se ela afirma, com as mesmas grandezas, o que a afirmação diz.\n${d.llmJson.REGRAS_DADOS}`,
        usuario: `AFIRMAÇÃO A VERIFICAR: ${claim.texto}
Para cada MATERIA_i abaixo responda:
- correspondencia: "integral" (o trecho afirma o mesmo, com os mesmos números, pessoas, período e status), "parcial" (cobre só parte, ou o status é outro: proposta × aprovado × em vigor), "contradiz" (afirma algo incompatível NO MESMO período e unidade) ou "nao_sustenta" (não trata disso);
- trecho: cópia EXATA e literal (até 300 caracteres) da matéria que fundamenta a resposta (vazio se nao_sustenta);
- falta: se parcial, o que a afirmação diz e o trecho não;
- explicacao: 1 frase;
- periodo, unidade, abrangencia, limitacoes: o que o trecho cobre e o que NÃO cobre (ex.: só um estado, só um mês, só a Câmara).
Números diferentes de períodos, bases ou unidades diferentes NÃO são contradição: são "parcial".
Não use conhecimento externo.

${blocos}

Responda APENAS JSON: {"materias":[{"i":0,"correspondencia":"nao_sustenta","trecho":"","falta":"","explicacao":"","periodo":"","unidade":"","abrangencia":"","limitacoes":""}]}`,
      });
      for (const m of dados.materias || []) {
        const p = legiveis[m.i];
        if (!p) continue;
        let correspondencia = Ev.CORRESP.includes(m.correspondencia) ? m.correspondencia : (Ev.CORRESP_DE[m.relacao] || 'nao_sustenta');
        let trecho = String(m.trecho || '');
        let falta = m.falta ? String(m.falta) : null;
        let encontrado = true;
        if (correspondencia !== 'nao_sustenta') {
          const ok = Ev.acharTrecho(p.texto, trecho);
          if (!ok.ok) { encontrado = false; log.push(`${p.veiculo || p.origem}: o trecho citado não está na matéria; o julgamento foi descartado`); }
        }
        if (encontrado && correspondencia === 'integral') {
          const ausentes = Ev.numerosAusentes(claim.texto, trecho);
          if (ausentes.length) { correspondencia = 'parcial'; falta = `o trecho não traz ${ausentes.join(', ')}`; }
        }
        // Números de períodos/unidades diferentes não são contradição.
        if (correspondencia === 'contradiz' && diferePeriodoOuUnidade(claim, m)) {
          correspondencia = 'parcial';
          falta = `compara período/unidade diferentes (${[m.periodo, m.unidade].filter(Boolean).join(', ')}): não é contradição`;
        }
        const e = Ev.novaEvidencia({
          via: 'artigo', url: p.url, titulo: p.titulo, origem: p.veiculo || p.origem, trecho, publicada_em: p.publicada_em, consultada_em: p.consultada_em,
          periodo: m.periodo || null, unidade: m.unidade || null, abrangencia: m.abrangencia || null, limitacoes: m.limitacoes || null,
          correspondencia, falta, trecho_encontrado: encontrado, explicacao: m.explicacao, dominio: p.dominio, llm,
        });
        e.texto_completo = p.texto;
        Ev.marcarDesatualizada(e, { mutavel: claim.mutavel, agora: hoje });
        novas.push(e);
        log.push(`${e.origem}: ${encontrado ? correspondencia : 'trecho não encontrado'}`);
      }
    } catch (e) { log.push(`Comparação por IA indisponível: ${e.message}`); }
  } else if (candidatos.length) {
    log.push('As matérias parecidas não puderam ser lidas por inteiro; nada foi julgado.');
  }
  lidasPaginas.filter((p) => !p.texto || p.texto.length < 400).forEach((p) => log.push(`${p.origem || p.veiculo || p.dominio}: ${p.obs || 'sem texto'}`));

  // Independência: mesmo domínio ou texto muito parecido = mesmo grupo.
  Ev.agrupar(novas, { dominio: dominioFonte, texto: fonte.texto });
  novas.forEach((e) => {
    delete e.texto_completo;
    if (e.via === 'artigo' && e.grupo === 'g0') { e.autoridade = 'republicacao'; e.limitacoes = [e.limitacoes, 'Reproduz a mesma matéria de origem: não é confirmação independente.'].filter(Boolean).join(' '); }
  });

  const todas = [...evidFonte, ...novas];
  const claimIds = [...evidFonte.map((e) => e.id), ...novas.map((e) => e.id)];
  const atualizada = { ...claim, evidencias: claimIds };
  const r = M.avaliarAfirmacao(atualizada, todas.map((e) => ({ ...e, grupo: e.grupo || (e.fonte_principal ? 'g0' : e.id) })));
  atualizada.estado = r.estado;
  atualizada.motivo_estado = r.motivo;
  atualizada.exige_atribuicao = r.exige_atribuicao;
  atualizada.verificada_em = new Date(hoje).toISOString();
  return { claim: atualizada, evidencias: novas, log, consulta: q, janela_dias: 10, cobertura };
}

// ── 4. Conferir uma afirmação escrita/corrigida pelo Pedro ─────────────────
// Usa só o que já foi acessado: o texto da matéria principal e os trechos
// guardados das outras fontes. Responde, separadamente, se há trecho, se ele
// sustenta a afirmação inteira e o que falta. Não pesquisa de novo.
async function conferirAfirmacao({ claim, fonte, evidencias = [] }, d0) {
  const d = deps(d0);
  const outras = evidencias.filter((e) => !e.fonte_principal && e.trecho && e.trecho_encontrado !== false).slice(0, 8);
  const blocos = [d.llmJson.dado('FONTE_0', String(fonte.texto || '').slice(0, 20000), 20000).bloco,
    ...outras.map((e, i) => d.llmJson.dado(`FONTE_${i + 1}`, `${e.origem}: ${e.trecho}`, 1200).bloco)].join('\n');
  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.1, maxTokens: 1800,
    sistema: `Você confere se textos sustentam uma afirmação. É rigoroso com status (proposta × aprovado × em vigor), quem disse, números, período e abrangência.\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `AFIRMAÇÃO: ${claim.texto}
Para cada FONTE_i, responda:
- correspondencia: "integral", "parcial", "contradiz" ou "nao_sustenta";
- trecho: cópia EXATA e literal (até 300 caracteres) que fundamenta a resposta (vazio se nao_sustenta);
- falta: se parcial, o que a afirmação diz e a fonte não (ex.: "a fonte fala em proposta; a afirmação diz que está em vigor").
Também classifique a natureza da afirmação: "fato", "dado", "anuncio", "declaracao", "previsao" ou "opiniao".

${blocos}

Responda APENAS JSON: {"natureza":"fato","fontes":[{"i":0,"correspondencia":"nao_sustenta","trecho":"","falta":""}]}`,
  });
  const base = evidencias.find((e) => e.fonte_principal) || {};
  const novas = [];
  for (const f of dados.fontes || []) {
    const i = Number(f.i);
    const ref = i === 0 ? null : outras[i - 1];
    if (i !== 0 && !ref) continue;
    let correspondencia = Ev.CORRESP.includes(f.correspondencia) ? f.correspondencia : 'nao_sustenta';
    const trecho = String(f.trecho || '');
    let falta = f.falta ? String(f.falta) : null;
    const textoRef = i === 0 ? fonte.texto : ref.trecho;
    const achou = correspondencia === 'nao_sustenta' ? { ok: !!trecho } : Ev.acharTrecho(textoRef, trecho);
    if (correspondencia === 'integral' && achou.ok) {
      const aus = Ev.numerosAusentes(claim.texto, trecho);
      if (aus.length) { correspondencia = 'parcial'; falta = `o trecho não traz ${aus.join(', ')}`; }
    }
    const meta = i === 0 ? base : ref;
    const e = Ev.novaEvidencia({
      via: meta.via || 'artigo', url: meta.url || fonte.url_final || fonte.url, titulo: meta.titulo || fonte.titulo, origem: meta.origem || fonte.veiculo,
      trecho: trecho.slice(0, 400), publicada_em: meta.publicada_em || fonte.publicada_em, consultada_em: meta.consultada_em || fonte.acessada_em,
      periodo: meta.periodo, unidade: meta.unidade, abrangencia: meta.abrangencia, limitacoes: meta.limitacoes,
      correspondencia, falta, trecho_encontrado: !!achou.ok, autoridade: meta.autoridade, grupo: meta.grupo || (i === 0 ? 'g0' : null), dominio: meta.dominio || fonte.dominio, llm,
    });
    if (i === 0) e.fonte_principal = true;
    if (e.trecho_encontrado && e.trecho) novas.push(e);
  }
  const natureza = M.NATUREZAS.includes(dados.natureza) ? dados.natureza : (claim.natureza || 'fato');
  const atualizada = { ...claim, natureza, evidencias: novas.map((e) => e.id), precisa_conferir: false };
  const r = M.avaliarAfirmacao(atualizada, novas);
  atualizada.estado = r.estado; atualizada.motivo_estado = r.motivo; atualizada.exige_atribuicao = r.exige_atribuicao;
  atualizada.verificada_em = new Date(d.agora()).toISOString();
  return { claim: atualizada, evidencias: novas, llm };
}

module.exports = { conferirAfirmacao, diferePeriodoOuUnidade, lerFonte, levantarAfirmacoes, verificarAfirmacao, validaConector, consultaDe, REDES_SOCIAIS };
