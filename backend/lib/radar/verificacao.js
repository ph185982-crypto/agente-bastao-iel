// Verificação: o que o Radar só chama de fato depois de conferido em código.
//
// A IA LÊ as páginas e PROPÕE afirmações com o trecho que as comprova. O código então:
//  1. confere que o trecho existe, palavra por palavra, no texto realmente lido;
//  2. confere que o número da afirmação aparece nesse trecho;
//  3. impede confusões de dinheiro: investimento não vira faturamento, valuation não vira caixa, crescimento ou
//     investimento não viram "lucrativo";
//  4. só libera um número quando há fonte oficial (marcado "segundo a empresa"), uma métrica medida por uma plataforma,
//     ou DUAS fontes independentes;
//  5. detecta negócio antigo apresentado como novidade.
// Nenhum número é estimado, arredondado para cima ou inferido: o que não passa fica de fora.
const Ev = require('../evidence');
const llmJson = require('../llmJson');
const C = require('./config');
const N = require('./numeros');
const U = require('./util');

const TIPOS = ['receita', 'lucro', 'usuarios', 'clientes', 'crescimento', 'investimento', 'valuation', 'fundacao', 'lancamento', 'paises', 'vendas', 'preco', 'modelo_receita', 'produto', 'avaliacoes_app', 'tendencia', 'outro'];
const NUMERICOS = new Set(['receita', 'lucro', 'usuarios', 'clientes', 'crescimento', 'investimento', 'valuation', 'paises', 'vendas', 'avaliacoes_app', 'preco']);
const DEMANDA = new Set(['receita', 'usuarios', 'clientes', 'crescimento', 'vendas', 'avaliacoes_app', 'tendencia', 'paises']);

const CUE = {
  receita: /(revenue|\barr\b|\bmrr\b|annual recurring|gross(?:ed)?|sales\b|turnover|faturamento|faturou|faturam|receita|vendas|vendeu|vendeu)/i,
  investimento: /(rais(?:ed|es|ing)\b|funding|funded|seed\b|series [a-e]\b|round\b|investment|invested|backed by|captou|capta[cç][aã]o|rodada|aporte|investimento|investiu)/i,
  valuation: /(valuation|valued at|valuing|avalia(?:da|do|[cç][aã]o)|vale(?:ndo)? \$|unic[oó]rnio|unicorn)/i,
  lucro: /(profitable|profit\b|profits\b|net income|lucrativ|lucro|rentabilidade|in the black|cash[- ]flow positive)/i,
  pessoas: /(users|customers|subscribers|downloads|clients|merchants|sellers|members|businesses|companies|creators|drivers|patients|students|stores|usu[aá]rios|clientes|assinantes|lojistas|membros|empresas|criadores|motoristas|alunos|lojas)/i,
  crescimento: /(growth|grew|growing|yoy|year[- ]over[- ]year|month[- ]over[- ]month|tripled|doubled|quadrupled|cresc|dobrou|triplicou|aument)/i,
  paises: /(countries|markets|pa[ií]ses|mercados)/i,
};
const janela = (trecho, raw, tam = 80) => { const i = String(trecho).indexOf(raw); if (i < 0) return String(trecho); return String(trecho).slice(Math.max(0, i - tam), i + raw.length + tam); };

// ── Regras de dinheiro (puras, testáveis) ───────────────────────────────────
// Devolve { ok, tipo, motivo }: o tipo pode ser corrigido (ex.: a IA chamou de receita algo que é investimento).
function conferirTipo({ tipo, texto = '', trecho = '', numero = null, unidade = null }) {
  if (!TIPOS.includes(tipo)) return { ok: false, motivo: `tipo de afirmação desconhecido (${tipo})` };
  const nums = N.extrair(trecho);
  const ref = numero != null ? nums.find((n) => N.igual(n.valor, numero)) : null;
  const j = ref ? janela(trecho, ref.raw) : trecho;
  const todo = `${texto} ${trecho}`;
  // "lucrativo" só com a palavra no trecho: crescer ou receber investimento não prova lucro.
  const dizLucro = CUE.lucro.test(texto);
  if (dizLucro && !CUE.lucro.test(trecho)) return { ok: false, motivo: 'a afirmação diz que é lucrativo, mas o trecho não diz (crescimento ou investimento não provam lucro)' };
  if (tipo === 'lucro' && !CUE.lucro.test(trecho)) return { ok: false, motivo: 'o trecho não fala de lucro' };

  if (tipo === 'receita' || tipo === 'vendas') {
    const rec = CUE.receita.test(j); const inv = CUE.investimento.test(j); const val = CUE.valuation.test(j);
    if (!rec && inv) return { ok: true, tipo: 'investimento', corrigido: true, motivo: 'o número é investimento recebido, não faturamento' };
    if (!rec && val) return { ok: true, tipo: 'valuation', corrigido: true, motivo: 'o número é valuation, não faturamento' };
    if (!rec) return { ok: false, motivo: 'o trecho não diz que esse valor é faturamento ou receita' };
    if (inv && !rec) return { ok: false, motivo: 'investimento confundido com faturamento' };
  }
  if (tipo === 'investimento') {
    if (CUE.valuation.test(j) && !CUE.investimento.test(j)) return { ok: true, tipo: 'valuation', corrigido: true, motivo: 'o número é valuation, não dinheiro recebido' };
    if (!CUE.investimento.test(j)) return { ok: false, motivo: 'o trecho não diz que esse valor foi investido na empresa' };
  }
  if (tipo === 'valuation' && !CUE.valuation.test(j)) return { ok: false, motivo: 'o trecho não fala de valuation' };
  if ((tipo === 'usuarios' || tipo === 'clientes') && !CUE.pessoas.test(j)) return { ok: false, motivo: 'o trecho não diz que esse número é de usuários ou clientes' };
  if (tipo === 'crescimento' && !(ref?.tipo === 'percentual' || ref?.tipo === 'multiplo' || CUE.crescimento.test(j))) return { ok: false, motivo: 'o trecho não descreve crescimento' };
  if (tipo === 'paises' && !CUE.paises.test(j)) return { ok: false, motivo: 'o trecho não fala de países ou mercados' };
  if (numero != null && !ref) return { ok: false, motivo: 'o número da afirmação não aparece no trecho' };
  if (unidade === 'USD' && ref && ref.moeda && ref.moeda !== 'USD') return { ok: false, motivo: 'a moeda do trecho não é a informada' };
  if (/(guaranteed|garantid)/i.test(todo) && /(income|renda|retorno|returns?)/i.test(todo)) return { ok: false, motivo: 'promessa de renda garantida não é fato verificável' };
  return { ok: true, tipo };
}

// ── Idade da história ──────────────────────────────────────────────────────
const RE_FUNDACAO = /(?:founded|established|launched in|started in|since|fundad[ao]s?(?: em)?|criad[ao]s?(?: em)?|desde)\s+(?:in\s+)?(?:[a-z]+\s+)?(19\d\d|20[01]\d|202\d)/i;
function anoDeFundacao(claims, textos = []) {
  const doClaim = claims.filter((c) => c.tipo === 'fundacao' && Number.isFinite(c.numero) && c.numero >= 1900 && c.numero <= 2100).map((c) => c.numero);
  if (doClaim.length) return Math.min(...doClaim);
  for (const t of textos) { const m = RE_FUNDACAO.exec(String(t || '').slice(0, 20000)); if (m) return Number(m[1]); }
  return null;
}
function avaliarIdade({ itens = [], docs = [], claims = [], agora = Date.now() }) {
  const ano = new Date(agora).getUTCFullYear();
  const fund = anoDeFundacao(claims, docs.map((d) => d.texto));
  const datas = [...itens.map((i) => i.publicada_em), ...docs.filter((d) => d.classe === 'imprensa').map((d) => d.publicada_em)].map((d) => Date.parse(d)).filter(Number.isFinite);
  const maisNova = datas.length ? Math.max(...datas) : null;
  const idadeHistoria = maisNova == null ? null : Math.floor((agora - maisNova) / 86400000);
  const lancRecente = claims.some((c) => c.tipo === 'lancamento' && Number.isFinite(c.numero) && c.numero >= ano - 1);
  if (idadeHistoria != null && idadeHistoria > C.IDADE_MAX_HISTORIA_DIAS) return { antigo: true, motivo: `a história mais recente encontrada tem ${idadeHistoria} dias`, ano_fundacao: fund, idade_historia_dias: idadeHistoria };
  if (fund && ano - fund >= C.ANOS_NEGOCIO_ANTIGO && !lancRecente) return { antigo: true, motivo: `a empresa existe desde ${fund} (${ano - fund} anos) e não há lançamento recente confirmado`, ano_fundacao: fund, idade_historia_dias: idadeHistoria };
  return { antigo: false, ano_fundacao: fund, idade_historia_dias: idadeHistoria, motivo: null };
}

// ── Sinais de descarte no texto lido ───────────────────────────────────────
function sinaisNoTexto(texto) {
  const achados = new Set();
  for (const [re, cod] of C.REGEX_DESCARTE) if (re.test(texto || '')) achados.add(cod);
  return [...achados];
}

// ── Documentos ─────────────────────────────────────────────────────────────
const nomeNoTexto = (nome, texto) => { const n = U.norm(nome).replace(/\s+/g, ' '); return n.length >= 2 && U.norm(texto).includes(n); };

function classeDoc(url, cand) {
  const h = U.host(url);
  const d = Ev.dominioRegistravel(url);
  if (cand.chave?.dominio && d === cand.chave.dominio) return 'oficial';
  if (C.DOMINIOS_IMPRENSA.test(h) || C.DOMINIOS_IMPRENSA.test(d)) return 'imprensa';
  return 'outro';
}

// Lê as páginas de um candidato: site oficial (se houver), matérias dos itens, e o texto do fundador no Show HN.
// Cada documento fica registrado com URL, veículo, data e acesso; falha de leitura vira limitação, não erro.
async function reunirDocumentos(cand, { deps = {}, agora = Date.now() } = {}) {
  const ler = deps.lerFonte || ((u) => require('../research').lerFonte({ url: u }));
  const docs = []; const limitacoes = [];
  const lerUm = async (url, papel) => {
    try {
      const f = await U.comTimeout(ler(url), 16000, 'a leitura da página');
      if (!f.legivel) { limitacoes.push(`Fonte não legível: ${U.host(url)} (${f.acesso === 'negado' ? 'o site recusou a leitura automática' : f.acesso === 'erro' ? 'a página não respondeu' : 'sem texto lido'}).`); return null; }
      return { url: f.url_final || url, url_pedida: url, titulo: f.titulo || '', veiculo: f.veiculo || U.host(url), publicada_em: f.publicada_em || null, acessada_em: f.acessada_em || new Date(agora).toISOString(), texto: f.texto, papel, dominio: f.dominio || Ev.dominioRegistravel(url), suspeita_de_instrucao: !!f.suspeita_de_instrucao };
    } catch (e) { limitacoes.push(`Fonte inacessível: ${U.host(url)} (${U.limita(e.message, 80)}).`); return null; }
  };

  // 1) Site oficial: o link veio do material, ou é um palpite da IA que a página precisa confirmar (o nome da empresa deve aparecer nela).
  const alvoOficial = cand.url_oficial || cand.url_sugerida;
  const tarefas = [];
  if (alvoOficial) tarefas.push((async () => {
    const d = await lerUm(alvoOficial, 'oficial');
    if (!d) return null;
    const dom = Ev.dominioRegistravel(d.url);
    if (C.DOMINIOS_AGREGADORES.test(dom) || C.DOMINIOS_IMPRENSA.test(dom)) { limitacoes.push(`O endereço ${U.host(d.url)} não é o site da empresa.`); return null; }
    if (!nomeNoTexto(cand.nome, `${d.titulo} ${d.texto.slice(0, 8000)}`)) { limitacoes.push(`A página ${U.host(d.url)} não menciona “${cand.nome}”: não foi aceita como site oficial.`); return null; }
    return { ...d, classe: 'oficial', dominio: dom };
  })());
  // 2) Matérias de imprensa citadas nos itens (até 2).
  const imprensa = [...new Map(cand.fontes_itens.filter((f) => f.fonte_classe === 'imprensa' && !C.DOMINIOS_AGREGADORES.test(U.host(f.url))).map((f) => [f.url, f])).values()].slice(0, 2);
  imprensa.forEach((f) => tarefas.push((async () => {
    const d = await lerUm(f.url, 'imprensa');
    if (!d) return null;
    if (!nomeNoTexto(cand.nome, `${d.titulo} ${d.texto}`)) { limitacoes.push(`A matéria de ${f.fonte_nome} não menciona “${cand.nome}” no texto lido.`); return null; }
    return { ...d, classe: 'imprensa', veiculo: d.veiculo || f.fonte_nome, publicada_em: d.publicada_em || f.publicada_em };
  })()));
  const lidos = (await Promise.all(tarefas)).filter(Boolean);
  docs.push(...lidos);

  // 3) Texto do fundador no Show HN (já veio no feed): vale como declaração da própria empresa.
  cand.fontes_itens.filter((f) => f.fonte_classe === 'comunidade' && f.resumo && f.resumo.length > 80).slice(0, 1).forEach((f) => {
    docs.push({ url: f.url_discussao || f.url, url_pedida: f.url_discussao || f.url, titulo: f.titulo, veiculo: 'Hacker News (texto do fundador)', publicada_em: f.publicada_em, acessada_em: new Date(agora).toISOString(), texto: `${f.titulo}\n${f.resumo}`, papel: 'fundador', classe: 'oficial', dominio: 'news.ycombinator.com' });
  });

  // 4) Loja de aplicativos (API pública da Apple): número de avaliações medido pela própria loja.
  if (deps.loja !== false) {
    try {
      const lj = await (deps.loja || require('./lojaApps').consultar)(cand, { agora });
      if (lj) docs.push({ ...lj, classe: 'plataforma', papel: 'loja' });
    } catch { /* loja é complemento: falha não bloqueia */ }
  }
  docs.forEach((d, i) => { d.indice = i; });
  return { docs, limitacoes };
}

// ── Pedido à IA: afirmações + trecho exato ─────────────────────────────────
const PROMPT_AFIRMACOES = `Você confere fatos para um perfil de negócios. Leia os DOCUMENTOS sobre a empresa/produto indicado e liste AFIRMAÇÕES VERIFICÁVEIS que estejam escritas neles.

REGRAS:
- Cada afirmação precisa de "trecho": cópia EXATA (palavra por palavra, no idioma original) de uma frase do documento que a comprova, com no máximo 280 caracteres. Se não consegue copiar um trecho, NÃO liste a afirmação.
- "numero" só se o número está no trecho. Escreva o número puro (ex.: 5000000), nunca estimado, arredondado ou somado. "unidade": USD, BRL, EUR, GBP, usuarios, clientes, paises, %, x, unidades ou null.
- Não transforme investimento recebido em faturamento. Não transforme valuation em dinheiro em caixa. Não diga "lucrativo" se o trecho não diz lucro.
- "texto": a afirmação em português claro, em uma frase, sem atribuição (o sistema atribui a fonte depois).
- "tipo": receita, lucro, usuarios, clientes, crescimento, investimento, valuation, fundacao (numero = ano), lancamento (numero = ano), paises, vendas, preco, modelo_receita (como a empresa cobra, sem número), produto (o que o produto faz, sem número), outro.
- "documento": o índice (i) do documento de onde veio o trecho.
- "data_do_fato": ano (ou ano-mês) a que o dado se refere, se o documento disser; senão null.
- Liste no máximo 12 afirmações, as mais úteis para explicar o negócio: o que faz, como cobra, e números de demanda (usuários, clientes, receita, crescimento, países).
- Se o documento não traz número nenhum, liste só as afirmações sem número (produto, modelo_receita, preco).

Responda APENAS JSON: {"afirmacoes":[{"documento":0,"tipo":"","texto":"","numero":null,"unidade":null,"periodo":null,"data_do_fato":null,"trecho":""}]}`;

async function pedirAfirmacoes(cand, docs, { deps = {} } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson;
  const corpo = docs.map((d) => `[DOCUMENTO ${d.indice}] veículo=${d.veiculo} · classe=${d.classe} · data=${d.publicada_em || 'sem data'} · url=${d.url}\n${llmJson.dado(`DOCUMENTO_${d.indice}`, d.texto, 6500).bloco}`).join('\n\n');
  const { dados, llm } = await pedir({
    sistema: `${PROMPT_AFIRMACOES}\n\n${llmJson.REGRAS_DADOS}`,
    usuario: `Empresa/produto: ${cand.nome}\n\n${corpo}`, maxTokens: 3200, temperatura: 0.1, budget: deps.budget,
  });
  return { afirmacoes: Array.isArray(dados?.afirmacoes) ? dados.afirmacoes : [], llm };
}

// ── Conferência em código ──────────────────────────────────────────────────
function conferirAfirmacoes(brutas, docs, { agora = Date.now() } = {}) {
  const aceitas = []; const rejeitadas = [];
  const rej = (a, motivo) => rejeitadas.push({ texto: U.limita(a?.texto, 160), tipo: a?.tipo || null, motivo });
  brutas.slice(0, 20).forEach((a, k) => {
    const doc = docs[Number(a?.documento)];
    if (!doc) return rej(a, 'o documento citado não existe');
    const trecho = String(a.trecho || '').trim();
    if (trecho.length < 12) return rej(a, 'sem trecho comprobatório');
    const achou = Ev.acharTrecho(doc.texto, trecho);
    if (!achou.ok) return rej(a, `o trecho não está no texto lido (${achou.motivo})`);
    const numero = a.numero === null || a.numero === undefined || a.numero === '' ? null : Number(a.numero);
    if (numero !== null && !Number.isFinite(numero)) return rej(a, 'número inválido');
    const tipoIa = TIPOS.includes(a.tipo) ? a.tipo : 'outro';
    const r = conferirTipo({ tipo: tipoIa, texto: String(a.texto || ''), trecho, numero, unidade: a.unidade || null });
    if (!r.ok) return rej(a, r.motivo);
    if (NUMERICOS.has(r.tipo) && numero === null && r.tipo !== 'preco') return rej(a, 'afirmação numérica sem número');
    const fonteClasse = doc.classe;
    aceitas.push({
      id: `c${aceitas.length + 1}`, tipo: r.tipo, tipo_original: r.corrigido ? tipoIa : undefined, texto: U.limita(a.texto, 260),
      numero, unidade: a.unidade || null, periodo: a.periodo ? U.limita(a.periodo, 40) : null, data_do_fato: a.data_do_fato ? U.limita(String(a.data_do_fato), 12) : null,
      valor_exibicao: numero !== null && r.tipo !== 'fundacao' && r.tipo !== 'lancamento' ? N.formatar(numero, a.unidade === 'usuarios' || a.unidade === 'clientes' || a.unidade === 'unidades' || a.unidade === 'paises' ? null : a.unidade) : null,
      url: doc.url, veiculo: doc.veiculo, data_publicacao: doc.publicada_em || null, consultado_em: doc.acessada_em || new Date(agora).toISOString(),
      trecho: U.limita(trecho, 300), origem: fonteClasse, documento: doc.indice,
      observacoes: [...(r.corrigido ? [`Reclassificada: ${r.motivo}.`] : [])],
    });
  });
  return { aceitas, rejeitadas };
}

// Métrica medida pela própria loja de aplicativos: entra direto (não depende da IA), com o texto da API como trecho.
function comMetricasDeLoja(aceitas, docs, agora) {
  const extras = docs.filter((d) => d.papel === 'loja' && d.metrica).map((d) => ({
    tipo: d.metrica.tipo, texto: `O aplicativo tem ${N.formatar(d.metrica.numero, null)} avaliações na App Store.`, numero: d.metrica.numero, unidade: 'avaliacoes', periodo: null, data_do_fato: null,
    valor_exibicao: N.formatar(d.metrica.numero, null), url: d.url, veiculo: d.veiculo, data_publicacao: d.publicada_em, consultado_em: d.acessada_em || new Date(agora).toISOString(),
    trecho: d.texto, origem: 'plataforma', documento: d.indice, observacoes: [],
  }));
  return [...aceitas, ...extras].map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

// Independência: domínios diferentes e textos que não são cópia um do outro (nem a mesma agência).
function independentes(a, b) {
  if (a.dominio === b.dominio) return false;
  if (Ev.similaridade(a.texto, b.texto) >= 0.6) return false;
  if (Ev.citaAgencia(a.texto) && Ev.citaAgencia(b.texto)) return false;
  return true;
}

// Decide se cada afirmação pode ir para uma tela e como deve ser atribuída.
function decidirUso(claims, docs) {
  const porClaim = claims.map((c) => ({ ...c }));
  porClaim.forEach((c) => {
    const doc = docs[c.documento];
    const confirmacoes = porClaim.filter((o) => o !== c && o.tipo === c.tipo && docs[o.documento] && independentes(doc, docs[o.documento])
      && (c.numero === null || o.numero === null ? c.numero === o.numero && U.norm(c.texto) === U.norm(o.texto) : N.igual(o.numero, c.numero)));
    c.confirmado_por = [...new Map(confirmacoes.map((o) => [o.url, { url: o.url, veiculo: o.veiculo, data_publicacao: o.data_publicacao }])).values()];
    const distintas = new Set([doc.dominio, ...confirmacoes.map((o) => docs[o.documento].dominio)]);
    if (doc.classe === 'oficial') {
      c.usavel = true; c.atribuicao = 'segundo a empresa';
      c.confianca = c.confirmado_por.length ? 'alta' : 'media';
      c.observacoes.push(c.confirmado_por.length ? 'Dado da empresa, confirmado também por fonte independente.' : 'Dado informado pela própria empresa: não foi confirmado por fonte independente.');
    } else if (doc.classe === 'plataforma') {
      c.usavel = true; c.atribuicao = `segundo ${doc.veiculo}`; c.confianca = 'alta'; c.observacoes.push('Número medido pela própria plataforma.');
    } else if (distintas.size >= 2) {
      c.usavel = true; c.atribuicao = null; c.confianca = 'alta'; c.observacoes.push('Confirmado por duas fontes independentes.');
    } else {
      c.usavel = false; c.atribuicao = null; c.confianca = 'baixa';
      c.observacoes.push(c.numero !== null ? 'Só uma matéria traz este número: não pode ser usado sem fonte oficial ou segunda fonte independente.' : 'Só uma matéria traz esta afirmação.');
    }
    if (c.tipo === 'valuation') c.observacoes.push('Valuation é uma estimativa do valor da empresa: não é dinheiro em caixa.');
    if (c.tipo === 'investimento') c.observacoes.push('Investimento recebido não é faturamento nem lucro.');
    if (c.tipo === 'receita' && c.periodo == null) c.observacoes.push('Período do faturamento não informado.');
  });
  return porClaim;
}

// Resultado final de um candidato.
function concluir({ cand, docs, claims, rejeitadas, limitacoes, agora }) {
  const oficiais = docs.filter((d) => d.classe === 'oficial');
  const imprensa = docs.filter((d) => d.classe === 'imprensa');
  const distintasImprensa = []; imprensa.forEach((d) => { if (distintasImprensa.every((o) => independentes(o, d))) distintasImprensa.push(d); });
  const fonteOficial = oficiais.find((d) => d.papel === 'oficial') || oficiais[0] || null;
  const existenciaOk = oficiais.length > 0 || distintasImprensa.length >= 2;
  const idade = avaliarIdade({ itens: cand.fontes_itens, docs, claims, agora });
  const textoTodo = docs.map((d) => d.texto).join('\n').slice(0, 60000);
  const sinais = [...new Set([...(cand.sinais_de_risco || []), ...sinaisNoTexto(`${cand.nome} ${cand.resumo} ${textoTodo}`)])];
  const motivos = []; let descartar = null;
  if (!docs.length) motivos.push('Nenhuma fonte pôde ser lida.');
  else if (!existenciaOk) motivos.push('Não há fonte oficial nem duas fontes independentes que confirmem o negócio.');
  if (sinais.length) { descartar = { codigo: sinais[0], motivo: `Sinal de ${C.SINAIS_DESCARTE[sinais[0]]}.` }; motivos.push(descartar.motivo); }
  if (idade.antigo) { descartar = descartar || { codigo: 'historia_antiga', motivo: `História antiga: ${idade.motivo}.` }; motivos.push(`História antiga: ${idade.motivo}.`); }
  const estado = descartar ? 'reprovada' : existenciaOk ? 'verificada' : 'insuficiente';
  const usaveis = claims.filter((c) => c.usavel);
  return {
    estado, verificada_em: new Date(agora).toISOString(), existencia_confirmada: existenciaOk,
    fonte_oficial: fonteOficial ? { url: fonteOficial.url, titulo: fonteOficial.titulo, veiculo: fonteOficial.veiculo, acessada_em: fonteOficial.acessada_em } : null,
    independentes: distintasImprensa.length,
    fontes: docs.map((d) => ({ indice: d.indice, url: d.url, veiculo: d.veiculo, classe: d.classe, papel: d.papel, titulo: d.titulo, publicada_em: d.publicada_em, acessada_em: d.acessada_em, dominio: d.dominio })),
    claims, claims_rejeitadas: rejeitadas, numeros_usaveis: usaveis.filter((c) => c.numero !== null && NUMERICOS.has(c.tipo)).map((c) => c.id),
    demanda_verificada: usaveis.filter((c) => DEMANDA.has(c.tipo) && c.numero !== null).length,
    modelo_receita_verificado: usaveis.some((c) => c.tipo === 'modelo_receita' || c.tipo === 'preco'),
    idade, sinais, descartar, motivos, limitacoes,
  };
}

// Entrada principal: um candidato → candidato com `verificacao`.
async function verificar(cand, { deps = {}, agora = Date.now() } = {}) {
  const { docs, limitacoes } = await reunirDocumentos(cand, { deps, agora });
  let claims = []; let rejeitadas = []; let llm = null;
  if (docs.length) {
    try {
      const r = await pedirAfirmacoes(cand, docs, { deps });
      llm = r.llm;
      const conf = conferirAfirmacoes(r.afirmacoes, docs, { agora });
      rejeitadas = conf.rejeitadas;
      claims = decidirUso(comMetricasDeLoja(conf.aceitas, docs, agora), docs);
    } catch (e) {
      limitacoes.push(`A IA não conseguiu ler as fontes (${U.limita(e.message, 100)}).`);
      const err = Object.assign(new Error(e.message), { code: e.code || 'IA' });
      if (['SEM_IA', 'LIMITE'].includes(e.code) || U.erroTemporario(e)) throw err;
    }
  }
  const verificacao = concluir({ cand, docs, claims, rejeitadas, limitacoes, agora });
  return { verificacao, llm, docs_lidos: docs.length };
}

module.exports = { verificar, reunirDocumentos, conferirAfirmacoes, conferirTipo, decidirUso, concluir, avaliarIdade, anoDeFundacao, sinaisNoTexto, independentes, pedirAfirmacoes, TIPOS, NUMERICOS, DEMANDA, CUE };
