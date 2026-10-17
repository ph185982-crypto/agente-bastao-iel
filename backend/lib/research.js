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
- texto: frase completa e autônoma (sem pronomes ambíguos), com os números exatos do texto;
- tipo: "fato", "calculo", "declaracao" (alguém DISSE algo: escreva "Fulano disse que…" e crie à parte a afirmação de fundo como "fato") ou "opiniao";
- central: true só nas 3 ou 4 que sustentam a notícia;
- trecho: cópia EXATA e literal (até 300 caracteres) do texto que contém a afirmação. Não resuma, não corrija, não una pedaços;
- quando: data do acontecimento, só se o texto disser (senão null);
- mutavel: true se pode mudar com o tempo (situação de projeto, votação, preço, posição);
- risco: "alto" se acusa pessoa, envolve crime, saúde, eleição ou dinheiro público de forma grave; senão "baixo";
- valores: números da afirmação [{"valor":0,"unidade":"BRL|%|unidade|ano","periodo":""}];
- conector (opcional, só se a afirmação for exatamente sobre esse dado oficial): {"tipo":"bcb","serie":433|1737|1619|432,"periodo":"YYYY-MM","valor_dito":número} (433 = IPCA mensal em %, 1619 = salário mínimo em R$, 432 = meta Selic % a.a.) ou {"tipo":"camara","sigla":"PLP","numero":0,"ano":2026} (situação de proposição na Câmara).

${entrada.bloco}

Responda APENAS JSON: {"afirmacoes":[{"texto":"","tipo":"fato","central":true,"trecho":"","quando":null,"mutavel":false,"risco":"baixo","valores":[],"conector":null}]}`,
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
    const id = `a${claims.length + 1}`;
    const e = Ev.novaEvidencia({
      via: 'artigo', tipo: 'secundaria', url: fonte.url_final || fonte.url, titulo: fonte.titulo, origem: fonte.veiculo,
      trecho: String(a.trecho).slice(0, 400), publicada_em: fonte.publicada_em, consultada_em: fonte.acessada_em,
      abrangencia: tipo === 'declaracao' ? 'Prova que a declaração foi feita, não que seja verdadeira' : 'O que a matéria afirma',
      limitacoes: 'Fonte única até aqui: uma matéria não confirma a si mesma.', relacao: tipo === 'opiniao' ? 'neutra' : 'sustenta',
      grupo: grupoPrincipal, dominio: fonte.dominio, via_fonte_principal: true,
    });
    e.fonte_principal = true;
    evidFonte.push(e);
    claims.push({
      id, texto: String(a.texto).slice(0, 400), tipo, central: !!a.central, risco: a.risco === 'alto' ? 'alto' : 'baixo',
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
    c.estado = c.tipo === 'opiniao' ? 'nao_verificada' : r.estado;
    c.motivo_estado = r.motivo;
  });
  return { claims, evidencias: evidFonte, descartadas, llm };
}

// ── 3. Verificar uma afirmação ─────────────────────────────────────────────
const STOP_EXTRA = new Set(['segundo', 'disse', 'afirmou', 'afirma', 'ainda', 'tambem', 'outro', 'outra', 'sobre', 'entre', 'apos', 'desde', 'quando', 'governo', 'federal']);

function consultaDe(claim, feeds) {
  const palavras = feeds.termos(claim.texto).filter((w) => !STOP_EXTRA.has(w));
  const nums = (claim.texto.match(/\d[\d.,]*%?/g) || []).filter((n) => n.length >= 2);
  const unicas = [...new Set(palavras)].sort((a, b) => b.length - a.length).slice(0, 7);
  return { palavras: unicas, numeros: nums.slice(0, 3) };
}

async function verificarAfirmacao(claim, fonte, evidenciasAtuais, d0, { maxCandidatos = 3 } = {}) {
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
          e.explicacao = e.relacao === 'sustenta' ? `O valor dito (${con.valor_dito}) confere com o oficial (${r.valor}).` : `O valor dito (${con.valor_dito}) difere do oficial (${r.valor}).`;
        } else { e.relacao = 'neutra'; e.explicacao = 'Há dado oficial, mas a afirmação não traz valor para comparar.'; }
        novas.push(e);
        log.push(`Banco Central (SGS ${con.serie}, ${con.periodo}): ${r.valor}`);
      } else log.push(`Banco Central: sem valor para ${con.periodo}`);
    } catch (e) { log.push(`Banco Central indisponível: ${e.message}`); }
  }
  if (con?.tipo === 'camara') {
    try {
      const r = await d.connectors.proposicaoCamara({ sigla: con.sigla, numero: con.numero, ano: con.ano });
      if (r) { r.evidencia.relacao = 'neutra'; r.evidencia.explicacao = 'Situação oficial na Câmara (compare com o que a matéria diz).'; novas.push(r.evidencia); log.push(`Câmara: ${con.sigla} ${con.numero}/${con.ano} está "${r.situacao}"`); }
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
  for (const c of candidatosBrutos) {
    const dom = Ev.dominioRegistravel(c.url);
    if (vistos.has(dom) || c.url === fonte.url_final) continue;
    vistos.add(dom);
    candidatos.push({ ...c, dominio: dom });
    if (candidatos.length >= maxCandidatos) break;
  }
  log.push(`${lidos.status.filter((s) => s.ok).length} feeds lidos; ${candidatosBrutos.length} matérias parecidas; ${candidatos.length} de veículos diferentes escolhidas${naoLidos.length ? `; sem resposta: ${naoLidos.join(', ')}` : ''}`);

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
- relacao: "sustenta" (afirma o mesmo, com os mesmos números/pessoas), "contradiz" (afirma algo incompatível), "parcial" (cobre só parte, ou números/período diferentes) ou "neutra" (não trata do assunto);
- trecho: cópia EXATA e literal (até 300 caracteres) da matéria que fundamenta a relação (vazio se neutra);
- explicacao: 1 frase;
- periodo, abrangencia, limitacoes: o que o trecho cobre e o que NÃO cobre (ex.: só um estado, só um mês, só a Câmara).
Não use conhecimento externo.

${blocos}

Responda APENAS JSON: {"materias":[{"i":0,"relacao":"neutra","trecho":"","explicacao":"","periodo":"","abrangencia":"","limitacoes":""}]}`,
      });
      for (const m of dados.materias || []) {
        const p = legiveis[m.i];
        if (!p) continue;
        let relacao = ['sustenta', 'contradiz', 'parcial', 'neutra'].includes(m.relacao) ? m.relacao : 'neutra';
        let trecho = String(m.trecho || '');
        if (relacao !== 'neutra') {
          const ok = Ev.acharTrecho(p.texto, trecho);
          if (!ok.ok) { relacao = 'neutra'; trecho = ''; log.push(`${p.veiculo}: o trecho citado não está na matéria; descartei o julgamento`); }
        }
        const e = Ev.novaEvidencia({
          via: 'artigo', tipo: 'secundaria', url: p.url, titulo: p.titulo, origem: p.veiculo || p.origem, trecho, publicada_em: p.publicada_em, consultada_em: p.consultada_em,
          periodo: m.periodo || null, abrangencia: m.abrangencia || null, limitacoes: m.limitacoes || null, relacao, explicacao: m.explicacao, dominio: p.dominio, llm,
        });
        e.texto_completo = p.texto;
        Ev.marcarDesatualizada(e, { mutavel: claim.mutavel, agora: hoje });
        novas.push(e);
        log.push(`${e.origem}: ${relacao}`);
      }
    } catch (e) { log.push(`Comparação por IA indisponível: ${e.message}`); }
  } else if (candidatos.length) {
    log.push('As matérias parecidas não puderam ser lidas por inteiro; nada foi julgado.');
  }
  lidasPaginas.filter((p) => !p.texto || p.texto.length < 400).forEach((p) => log.push(`${p.origem || p.veiculo || p.dominio}: ${p.obs || 'sem texto'}`));

  // Independência: mesmo domínio ou texto muito parecido = mesmo grupo.
  Ev.agrupar(novas, { dominio: dominioFonte, texto: fonte.texto });
  novas.forEach((e) => { delete e.texto_completo; });

  const todas = [...evidFonte, ...novas];
  const claimIds = [...evidFonte.map((e) => e.id), ...novas.map((e) => e.id)];
  const atualizada = { ...claim, evidencias: claimIds };
  const r = M.avaliarAfirmacao(atualizada, todas.map((e) => ({ ...e, grupo: e.grupo || (e.fonte_principal ? 'g0' : e.id) })));
  atualizada.estado = atualizada.tipo === 'opiniao' ? 'nao_verificada' : r.estado;
  atualizada.motivo_estado = r.motivo;
  atualizada.verificada_em = new Date(hoje).toISOString();
  return { claim: atualizada, evidencias: novas, log, consulta: q, janela_dias: 10 };
}

module.exports = { lerFonte, levantarAfirmacoes, verificarAfirmacao, validaConector, consultaDe, REDES_SOCIAIS };
