// Copy do carrossel "Ideias que dão dinheiro" (8 telas), legenda e roteiro de Reels.
// A IA escreve só os trechos variáveis; a ESTRUTURA de cada tela é montada em código (as frases de abertura pedidas
// pelo Pedro) e TUDO que a IA escreve passa por validadores: palavras por tela, frases proibidas, emoji, exclamação,
// números que não estão nas afirmações verificadas, atribuição "segundo a empresa", dinheiro na capa, hipótese só na tela 7.
const llmJson = require('../llmJson');
const C = require('./config');
const N = require('./numeros');
const U = require('./util');

const INTRO = {
  problema: 'Tudo começou com um problema comum:',
  dinheiro: 'O dinheiro entra assim:',
  funciona: 'Funciona porque junta três coisas:',
  brasil: 'Uma versão brasileira poderia começar assim:',
};
const ROTULOS_BRASIL = ['Público', 'Produto', 'Canal', 'Cobrança', 'Teste'];
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;
// A frase fixa já traz "que faz": o resultado precisa completar "que faz [algo] [fazer algo]", não começar com outro verbo conjugado.
const VERBO_CONJUGADO = /^(rastreia|gerencia|permite|ajuda|cria|paga|conecta|automatiza|organiza|mostra|entrega|calcula|envia|gera|ensina|vende|compra|encontra|re[uú]ne|transforma|resolve|simplifica|oferece|facilita|monitora|controla|conduz|liga|cobra|recebe|usa|faz)\b/i;
const HEDGES_FORA_DA_7 = /\b(provavelmente|talvez|possivelmente|deve estar|pode ser que|aparentemente|supostamente)\b/i;

const sem = (s) => U.semAcento(s).toLowerCase().replace(/[“”"']/g, ' ').replace(/\s+/g, ' ');

// ── Validadores (puros) ─────────────────────────────────────────────────────
const claimsUsaveis = (op) => (op.verificacao?.claims || []).filter((c) => c.usavel);

function numerosNaoComprovados(texto, claims, { permitirContagem = false } = {}) {
  const valores = claims.filter((c) => c.numero !== null).map((c) => c.numero);
  const anosOk = claims.map((c) => c.data_do_fato).filter(Boolean).map((x) => Number(String(x).slice(0, 4)));
  return N.numerosDeDado(texto).filter((n) => {
    // Na tela de HIPÓTESE, uma meta de contagem do teste (“os 30 primeiros clientes”) não é fato; dinheiro e porcentagem continuam proibidos.
    if (permitirContagem && n.tipo === 'quantidade' && Number.isInteger(n.valor) && n.valor < 1000) return false;
    if (n.tipo === 'ano' && anosOk.includes(n.valor)) return false;
    if (n.tipo === 'ano' && claims.some((c) => (c.tipo === 'fundacao' || c.tipo === 'lancamento') && c.numero === n.valor)) return false;
    return !valores.some((v) => N.igual(v, n.valor));
  }).map((n) => n.raw);
}

// Número que veio de afirmação com atribuição (empresa, plataforma) precisa carregar a atribuição no mesmo texto.
function atribuicaoFaltando(texto, claims) {
  const t = sem(texto); const faltam = new Set();
  for (const n of N.numerosDeDado(texto)) {
    const c = claims.find((x) => x.numero !== null && N.igual(x.numero, n.valor) && x.atribuicao);
    if (c && !t.includes(sem(c.atribuicao)) && !/segundo (a empresa|o fundador|a app store|a apple)/.test(t)) faltam.add(c.atribuicao);
  }
  return [...faltam];
}

// Dinheiro na capa só com número verificado do mesmo tipo ("fatura milhões" exige faturamento verificado ≥ 1 milhão).
function dinheiroNaCapa(texto, claims) {
  const t = sem(texto); const erros = [];
  const fala = (re) => re.test(t);
  const maior = (tipos) => Math.max(0, ...claims.filter((c) => tipos.includes(c.tipo) && c.numero !== null).map((c) => (c.unidade === 'USD' || c.unidade === 'BRL' || c.unidade === 'EUR' ? c.numero : 0)));
  if (fala(/\b(milh(ao|oes)|milionari[ao]s?|bilh(ao|oes)|bilionari[ao]s?)\b/)) {
    const bil = fala(/\b(bilh|bilionari)/);
    const piso = bil ? 1e9 : 1e6;
    const verbo = fala(/\b(fatur|receita|vend(e|em|eu)|arrecad)/) ? ['receita', 'vendas'] : fala(/\b(vale|valor de mercado|avaliad)/) ? ['valuation'] : fala(/\b(lucr)/) ? ['lucro'] : fala(/\b(capt|levant|investiment|recebeu)/) ? ['investimento'] : ['receita', 'vendas', 'valuation', 'investimento', 'lucro', 'usuarios', 'clientes'];
    if (maior(verbo) < piso && !(verbo.includes('usuarios') && claims.some((c) => ['usuarios', 'clientes'].includes(c.tipo) && c.numero >= piso))) erros.push(`a capa fala em ${bil ? 'bilhões' : 'milhões'} sem afirmação verificada desse tipo (${verbo.join(' ou ')})`);
  }
  if (fala(/\blucr(o|a|ativ)/) && !claims.some((c) => c.tipo === 'lucro')) erros.push('a capa fala em lucro, mas nenhum dado de lucro foi confirmado');
  return erros;
}

// Se o texto traz um número que veio da empresa e a IA esqueceu "segundo a empresa", o código acrescenta a atribuição na frase do número
// (só ACRESCENTA a fonte, nunca muda o dado). O resultado ainda passa pelos validadores de tamanho.
function repararAtribuicao(texto, claims) {
  let t = String(texto || ''); const norm = (x) => sem(x);
  for (const n of N.numerosDeDado(t)) {
    const c = claims.find((x) => x.numero !== null && N.igual(x.numero, n.valor) && x.atribuicao);
    if (!c || norm(t).includes(norm(c.atribuicao)) || /segundo (a empresa|o fundador|a app store|a apple)/.test(norm(t))) continue;
    const i = t.indexOf(n.raw); if (i < 0) continue;
    const resto = t.slice(i); const m = /[.!?]|\n|$/.exec(resto); const fim = i + m.index;
    t = `${t.slice(0, fim).replace(/[,;\s]+$/, '')}, ${c.atribuicao}${t.slice(fim)}`;
  }
  return t;
}

function checarTexto(texto, rotulo, { capa = false } = {}) {
  const e = []; const t = sem(texto);
  for (const f of C.FRASES_PROIBIDAS) if (t.includes(f)) e.push(`${rotulo}: frase proibida “${f.trim()}”`);
  for (const f of C.ABSOLUTOS_NAO_PROVAVEIS) if (t.includes(f)) e.push(`${rotulo}: afirmação que não dá para provar (“${f}”)`);
  if (EMOJI.test(texto)) e.push(`${rotulo}: emoji não é permitido`);
  if (capa && /[!?]/.test(texto)) e.push(`${rotulo}: a capa não leva ! nem ?`);
  if (/\*\*[^*]+\*\*.*\*\*[^*]+\*\*/.test(texto)) e.push(`${rotulo}: só um destaque por tela`);
  return e;
}

// O rótulo escrito pela IA precisa dizer o que o número É (receita não pode virar "usuários", nem investimento virar "faturamento").
const FAMILIA_ROTULO = [
  ['receita', /\b(receita|faturamento|fatura|faturou|vendas|vendeu|arrecad)/i, ['receita', 'vendas']],
  ['investimento', /\b(investiment|captou|capta[cç]|rodada|aporte|levantou)/i, ['investimento']],
  ['valuation', /\b(valuation|avalia|vale\b|valor de mercado)/i, ['valuation']],
  ['lucro', /\b(lucr|lucrativ)/i, ['lucro']],
  ['pessoas', /\b(clientes|usu[aá]rios|assinantes|membros|lojistas|motoristas|alunos|criadores|downloads|avalia[cç][oõ]es)/i, ['clientes', 'usuarios', 'avaliacoes_app']],
  ['paises', /\b(pa[ií]ses|mercados)/i, ['paises']],
  ['crescimento', /\b(cresciment|crescer|cresceu)/i, ['crescimento']],
];
function rotuloIncoerente(rotulo, claim) {
  for (const [nome, re, tipos] of FAMILIA_ROTULO) if (re.test(rotulo) && !tipos.includes(claim.tipo)) return `o rótulo “${rotulo}” fala de ${nome}, mas o número ${claim.id} é do tipo ${claim.tipo}`;
  return null;
}

// Monta as 8 telas a partir do JSON da IA. Devolve { slides, erros }.
function montarTelas(j, op, { fixo = C.CTA_FIXO } = {}) {
  const erros = []; const usaveis = claimsUsaveis(op);
  const porId = new Map(usaveis.map((c) => [c.id, c]));
  const s = Array.isArray(j?.slides) ? j.slides : [];
  const get = (n) => s.find((x) => Number(x?.n) === n) || {};
  const limpa = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();
  const semPonto = (x) => limpa(x).replace(/[.:;]+$/, '');
  // A IA às vezes repete a frase de abertura que o sistema já escreve ("Tudo começou com um problema comum: ..."): tira a repetição.
  const semEco = (x, intro) => { let t = semPonto(x); const re = new RegExp(`^${intro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[:]/g, '[:,]?')}\\s*`, 'i'); while (re.test(t)) t = t.replace(re, ''); return t; };
  const semPrefixo = (x, re) => semPonto(x).replace(re, '');
  const slides = [];

  // 1 capa
  const capa = repararAtribuicao(limpa(get(1).texto), usaveis);
  slides.push({ n: 1, funcao: 'capa', layout: 'capa', texto: capa, imagem: 'negocio' });
  // 2 problema
  const prob = semEco(get(2).problema, INTRO.problema);
  slides.push({ n: 2, funcao: 'problema', layout: 'problema', rotulo: 'O problema', intro: INTRO.problema, corpo: prob ? `${prob}.` : '', texto: `${INTRO.problema} ${prob}.` });
  // 3 solução
  const prod = semPrefixo(semEco(get(3).produto, 'A solução foi criar'), /^criar\s+/i).replace(/\s+que\s+faz$/i, ''); const res = semPrefixo(get(3).resultado, /^(que\s+)?faz\s+/i);
  slides.push({ n: 3, funcao: 'solucao', layout: 'solucao', rotulo: 'A solução', texto: `A solução foi criar ${prod} que faz ${res}.`, imagem: 'negocio' });
  // 4 dinheiro
  const modelo = Object.keys(C.MODELOS_RECEITA).includes(get(4).modelo) ? get(4).modelo : null;
  if (!modelo) erros.push('Tela 4: informe o modelo de receita (assinatura, comissao, venda, licenca, mensalidade, publicidade, marketplace ou servico_recorrente)');
  const expl = semEco(get(4).explicacao, INTRO.dinheiro);
  slides.push({ n: 4, funcao: 'dinheiro', layout: 'dinheiro', rotulo: 'Como ganha dinheiro', modelo, intro: INTRO.dinheiro, corpo: `${expl}.`, texto: `${INTRO.dinheiro} ${expl}.` });
  // 5 prova (valores vêm das afirmações verificadas, nunca da IA)
  const itens5 = (Array.isArray(get(5).itens) ? get(5).itens : []).slice(0, 3).map((it) => ({ claim: porId.get(String(it?.claim_id)), rotulo: semPonto(it?.rotulo) }));
  const prova = [];
  itens5.forEach((it, i) => {
    if (!it.claim) { erros.push(`Tela 5: o item ${i + 1} usa uma afirmação que não está liberada (${itens5[i].rotulo || 'sem rótulo'})`); return; }
    if (it.claim.numero === null || !it.claim.valor_exibicao) { erros.push(`Tela 5: a afirmação ${it.claim.id} não tem número`); return; }
    if (/\d/.test(it.rotulo)) erros.push(`Tela 5: o rótulo “${it.rotulo}” não pode ter número (o valor vem da fonte)`);
    const inc = rotuloIncoerente(it.rotulo, it.claim); if (inc) erros.push(`Tela 5: ${inc}`);
    if (/\b(mil|milh[aãõo]\w*|bilh[aãõo]\w*|mais de|cerca de|quase)\b/i.test(it.rotulo)) erros.push(`Tela 5: o rótulo “${it.rotulo}” repete o valor; diga só o que o número mede (“clientes ativos”)`);
    if (itens5.slice(0, i).some((o) => o.claim && o.claim.id === it.claim.id)) erros.push(`Tela 5: o número ${it.claim.id} aparece duas vezes`);
    prova.push({ claim_id: it.claim.id, valor: it.claim.valor_exibicao, rotulo: it.rotulo, tipo: it.claim.tipo, atribuicao: it.claim.atribuicao, url: it.claim.url, veiculo: it.claim.veiculo, data_publicacao: it.claim.data_publicacao, periodo: it.claim.periodo });
  });
  if (!prova.length) erros.push('Tela 5: nenhuma prova numérica liberada foi usada');
  const tit5 = semPonto(get(5).titulo);
  const atrib = [...new Set(prova.map((p) => p.atribuicao).filter(Boolean))];
  const fonteLinha = prova.length ? `${atrib.length ? `${atrib.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(' · ')}. ` : ''}Fonte: ${[...new Set(prova.map((p) => p.veiculo))].join(', ')}${prova[0].data_publicacao ? `, ${String(prova[0].data_publicacao).slice(0, 10).split('-').reverse().join('/')}` : ''}.` : '';
  slides.push({ n: 5, funcao: 'prova', layout: 'prova', rotulo: 'A prova', titulo: tit5, prova, fonte_linha: fonteLinha, texto: [tit5, ...prova.flatMap((p) => [p.valor, p.rotulo, p.atribuicao || ''])].join(' ') });
  // 6 por que funciona
  const itens6 = ['dor', 'facilidade', 'recorrencia'].map((k) => semEco(get(6)[k], INTRO.funciona));
  slides.push({ n: 6, funcao: 'funciona', layout: 'funciona', rotulo: 'Por que funciona', intro: INTRO.funciona, itens: itens6, texto: `${INTRO.funciona} ${itens6.join(' ')}` });
  // 7 Brasil (hipótese)
  const b = get(7);
  const itens7 = [['Público', 'publico_inicial'], ['Produto', 'produto_minimo'], ['Canal', 'canal_de_vendas'], ['Cobrança', 'forma_de_cobranca'], ['Teste', 'teste_baixo_custo']].map(([r, k]) => ({ rotulo: r, valor: semPonto(b[k]) }));
  slides.push({ n: 7, funcao: 'brasil', layout: 'brasil', rotulo: 'Hipótese para o Brasil', intro: INTRO.brasil, itens: itens7, texto: `${INTRO.brasil} ${itens7.map((i) => `${i.rotulo} ${i.valor}`).join(' ')}` });
  // 8 fixo
  slides.push({ n: 8, funcao: 'cta', layout: 'cta', principal: fixo.principal, secundario: fixo.secundario, cta: fixo.cta, texto: `${fixo.principal} ${fixo.secundario} ${fixo.cta}` });
  slides.forEach((x) => { x.palavras = U.contaPalavras(x.texto); });
  return { slides, erros };
}

function validarTelas(slides, op) {
  const erros = []; const usaveis = claimsUsaveis(op);
  slides.forEach((s) => {
    const r = `Tela ${s.n}`;
    if (s.n === 8) return;
    const min = 8; const max = s.n === 1 ? 18 : 25;
    if (s.palavras < min) erros.push(`${r}: tem ${s.palavras} palavras (mínimo ${min})`);
    if (s.palavras > max) erros.push(`${r}: tem ${s.palavras} palavras (máximo ${max})`);
    erros.push(...checarTexto(s.texto, r, { capa: s.n === 1 }));
    if (s.n !== 7 && HEDGES_FORA_DA_7.test(s.texto)) erros.push(`${r}: hipótese ou dúvida só pode aparecer na tela 7`);
    if (s.n !== 5) {
      const sem_prova = numerosNaoComprovados(s.texto, usaveis, { permitirContagem: s.n === 7 });
      if (sem_prova.length) erros.push(`${r}: número sem comprovação (${sem_prova.join(', ')})`);
      const f = atribuicaoFaltando(s.texto, usaveis);
      if (f.length) erros.push(`${r}: o número vem de “${f[0]}”; escreva a atribuição na própria tela`);
    }
    if (s.n === 1) erros.push(...dinheiroNaCapa(s.texto, usaveis).map((e) => `${r}: ${e}`));
    if (/\blucr(o|a|ativ)/i.test(U.semAcento(s.texto)) && !usaveis.some((c) => c.tipo === 'lucro')) erros.push(`${r}: fala em lucro sem dado de lucro confirmado`);
    if (s.n === 7) {
      if (s.itens.some((i) => !i.valor)) erros.push('Tela 7: faltam itens da hipótese');
      s.itens.forEach((i) => { if (U.contaPalavras(i.valor) > 3) erros.push(`Tela 7: “${i.valor}” tem mais de 3 palavras`); });
    }
    if (s.n === 6 && s.itens.some((i) => !i || U.contaPalavras(i) > 4 || U.contaPalavras(i) < 2)) erros.push('Tela 6: cada item deve ser uma expressão com sentido completo, de 2 a 4 palavras (não uma palavra solta)');
    if (s.n === 3 && /\b(s[aã]o|[eé]|foi|est[aã]o|est[aá]|fica|ficam|t[eê]m|tem|pode|podem|ser[aã]o|s[aã]o)\b/i.test(String(s.texto).split(/\bque faz\s+/i).pop() || '')) erros.push('Tela 3: depois de “que faz” use um infinitivo (“o cliente receber…”, “as comissões serem pagas sozinhas”), sem “é”, “são” ou “foi”');
    if (s.n === 3 && VERBO_CONJUGADO.test(String(s.texto).split(/\bque faz\s+/i).pop() || '')) erros.push('Tela 3: depois de “que faz” escreva o que muda para o cliente (“o cachorro ficar limpo sem sair de casa”), não outro verbo conjugado');
    if (s.n === 2 && !s.corpo.replace(/[.]/g, '').trim()) erros.push('Tela 2: faltou descrever o problema');
  });
  const tudo = slides.map((s) => s.texto).join(' ');
  if ((tudo.match(/!/g) || []).length > 1) erros.push('Exclamação demais (no máximo uma no carrossel todo)');
  if ((tudo.match(/\?/g) || []).length > 2) erros.push('Pergunta demais (no máximo duas no carrossel todo)');
  return [...new Set(erros)];
}

function montarLegenda(j, op) {
  const erros = []; const usaveis = claimsUsaveis(op);
  const l = (k, max) => { const v = repararAtribuicao(String(j?.legenda?.[k] ?? '').replace(/\s+/g, ' ').trim(), usaveis); if (!v) erros.push(`Legenda: faltou “${k}”`); if (v.length > max) erros.push(`Legenda: “${k}” tem ${v.length} caracteres (máximo ${max})`); return v; };
  const primeira = l('primeira_linha', 110); const resumo = l('resumo', 160); const como = l('como_ganha', 150); const brasil = l('brasil', 150);
  const hashtags = (Array.isArray(j?.hashtags) ? j.hashtags : []).map((h) => `#${String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => /^#[\p{L}\p{N}_]{3,30}$/u.test(h));
  if (!hashtags.length) erros.push('Legenda: inclua de 1 a 3 hashtags');
  const tags = [...new Set(hashtags)].slice(0, 3);
  const aviso = 'Oportunidade não é garantia de resultado: teste pequeno antes de investir.';
  const texto = [primeira, '', `${resumo} ${como}`.trim(), brasil, '', aviso, '', C.ENCERRAMENTO_LEGENDA, '', tags.join(' ')].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (texto.length > 700) erros.push(`Legenda: ${texto.length} caracteres (máximo 700)`);
  erros.push(...checarTexto(`${primeira} ${resumo} ${como} ${brasil}`, 'Legenda'));
  const sp = numerosNaoComprovados(`${primeira} ${resumo} ${como} ${brasil}`, usaveis);
  if (sp.length) erros.push(`Legenda: número sem comprovação (${sp.join(', ')})`);
  const f = atribuicaoFaltando(`${primeira} ${resumo} ${como} ${brasil}`, usaveis);
  if (f.length) erros.push(`Legenda: o número vem de “${f[0]}”; escreva a atribuição`);
  if (!/(garantia|garantid)/i.test(texto)) erros.push('Legenda: falta o aviso de que oportunidade não é garantia');
  return { texto, tags, erros, partes: { primeira, resumo, como, brasil } };
}

// ── Pedido à IA ─────────────────────────────────────────────────────────────
const SISTEMA = `Você escreve carrosséis de Instagram do perfil @pedro_destrava, série “Ideias que dão dinheiro”: topo de funil, fácil de entender, curioso, para empresários, empreendedores e quem procura renda extra no Brasil.

VOZ: uma pessoa explicando para um amigo. Palavras simples. Um fato por vez. Frases curtas. Comece pelo fato mais interessante. Explique os números. Sem moralismo, sem frase vazia, sem introdução abstrata, sem emoji, sem exclamação, sem perguntas em excesso.
PROIBIDO: “em um mundo onde”, “você não vai acreditar”, “isso muda tudo”, “o futuro chegou”, “mais do que”, “não é apenas”, “revolucionário”, “game changer”, “no cenário atual”, “descubra como”, “jornada”.
FATOS: use SOMENTE o que está em DADOS_VERIFICADOS. Nunca invente nem arredonde número. Não chame de lucrativo quem só cresceu ou recebeu investimento. Valuation não é dinheiro em caixa. Quando o dado vem da empresa, escreva “segundo a empresa” na própria tela em que o número aparece (na capa e na legenda também). NUNCA escreva “milhões” ou “bilhões” a menos que um dado verificado seja de pelo menos 1 milhão do tipo certo; com 100 mil clientes, escreva “mais de 100 mil clientes, segundo a empresa”.
NÃO afirme que o negócio “não existe no Brasil” nem que “vai funcionar” aqui: isso você não sabe. A tela 7 é HIPÓTESE.

ESTRUTURA (o sistema monta as frases de abertura; você escreve só o que falta):
1. capa (8 a 18 palavras): UMA afirmação concreta + curiosidade + consequência financeira (só se houver dado verificado). Modelos: “Essa empresa fatura milhões resolvendo um problema que todo mundo ignora.” / “Essa ideia simples virou um negócio de US$ X, segundo a empresa.” / “Alguém transformou [problema comum] em uma empresa de milhões.” Sem ? e sem !. Use **assim** em UMA expressão curta para destacar.
2. problema: texto que completa “Tudo começou com um problema comum:” (de 6 a 18 palavras).
3. solucao: “produto” (com artigo, SEM verbo: “um aplicativo de gestão de afiliados”, 3 a 8 palavras) e “resultado” (3 a 10 palavras, completa “que faz …”: “o cachorro ficar limpo sem você sair”, “pagamentos de comissão acontecerem sozinhos”; nunca comece com verbo conjugado como “rastreia” ou “paga”) para a frase “A solução foi criar [produto] que faz [resultado].”
4. dinheiro: “modelo” (assinatura, comissao, venda, licenca, mensalidade, publicidade, marketplace ou servico_recorrente) e “explicacao” que completa “O dinheiro entra assim:” (de 6 a 18 palavras). Só descreva como cobra o que estiver nos DADOS_VERIFICADOS ou em negocio.como_ganha_dinheiro.
5. prova (a tela soma título + valor + rótulo + a atribuição “segundo a empresa”, de 8 a 25 palavras; use 2 ou 3 itens se houver, e título de 4 a 6 palavras): “titulo” e “itens”: de 1 a 3 itens {claim_id, rotulo}, onde claim_id vem de DADOS_VERIFICADOS (somente afirmações com número) e rotulo (1 a 3 palavras, sem números) diz o que o número mede, ex.: “usuários ativos”. O valor aparece sozinho, vindo da fonte.
6. funciona: “dor”, “facilidade”, “recorrencia”: três itens de 2 a 4 palavras, cada um com sentido completo, que completam “Funciona porque junta três coisas:” (ex.: “empresas sem tempo para parcerias”, “cadastro e pagamento automáticos”, “cobrança mensal que se repete”). Nada de adjetivo solto.
7. brasil (hipótese prática, nunca promessa): publico_inicial, produto_minimo, canal_de_vendas, forma_de_cobranca, teste_baixo_custo: cada um com 2 a 3 palavras (ex.: “pet shops de bairro”). Sem valores em dinheiro nem porcentagens.
(A tela 8 é fixa; não escreva.)
Telas 2 a 7 somam entre 8 e 25 palavras CADA UMA (contando a frase de abertura e os rótulos Público/Produto/Canal/Cobrança/Teste na tela 7). A tela 7 já tem 6 + 5 = 11 palavras fixas: os cinco valores somam no máximo 14.

LEGENDA (o sistema acrescenta ~280 caracteres fixos; as quatro partes juntas devem ter no máximo 400 caracteres): primeira_linha (até 100 caracteres, forte), resumo (até 130), como_ganha (até 130), brasil (até 130, como hipótese). Até 3 hashtags, sem números.

Responda APENAS JSON: {"slides":[{"n":1,"texto":""},{"n":2,"problema":""},{"n":3,"produto":"","resultado":""},{"n":4,"modelo":"","explicacao":""},{"n":5,"titulo":"","itens":[{"claim_id":"c1","rotulo":""}]},{"n":6,"dor":"","facilidade":"","recorrencia":""},{"n":7,"publico_inicial":"","produto_minimo":"","canal_de_vendas":"","forma_de_cobranca":"","teste_baixo_custo":""}],"legenda":{"primeira_linha":"","resumo":"","como_ganha":"","brasil":""},"hashtags":["",""]}`;

function dadosParaIa(op) {
  const usaveis = claimsUsaveis(op);
  return {
    negocio: { nome: op.nome, pais: op.pais, categoria: C.CATEGORIAS[op.categoria], resumo: op.resumo, problema: op.problema, solucao: op.solucao, como_ganha_dinheiro: op.como_ganha_dinheiro, modelo_receita_sugerido: op.modelo_receita, adaptacao_brasil_sugerida: op.adaptacao_brasil, investimento_para_testar: op.investimento_para_testar },
    DADOS_VERIFICADOS: usaveis.map((c) => ({ id: c.id, tipo: c.tipo, afirmacao: c.texto, numero: c.numero, valor_na_tela: c.valor_exibicao, unidade: c.unidade, periodo: c.periodo, atribuicao: c.atribuicao || 'duas fontes independentes confirmam', observacoes: c.observacoes })),
  };
}

async function gerarCopia(op, { deps = {}, tentativas = 3, feedback: feedbackInicial = '' } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson;
  const usaveis = claimsUsaveis(op);
  if (!usaveis.some((c) => c.numero !== null && c.valor_exibicao)) throw Object.assign(new Error('Sem número verificado não há tela de prova: o carrossel não é gerado.'), { code: 'SEM_PROVA', status: 422 });
  let feedback = feedbackInicial; let ultimo = null; const historico = [];
  for (let i = 1; i <= tentativas; i++) {
    const d = llmJson.dado('OPORTUNIDADE', JSON.stringify(dadosParaIa(op)), 14000);
    const { dados, llm } = await pedir({ sistema: `${SISTEMA}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${d.bloco}\n${feedback ? `\nA VERSÃO ANTERIOR FOI RECUSADA PELOS SEGUINTES MOTIVOS. Corrija todos:\n- ${feedback}\n` : ''}`, maxTokens: 3200, temperatura: i === 1 ? 0.5 : 0.3, budget: deps.budget });
    const m = montarTelas(dados, op);
    const leg = montarLegenda(dados, op);
    const erros = [...m.erros, ...validarTelas(m.slides, op), ...leg.erros];
    historico.push({ tentativa: i, erros: erros.length, llm });
    ultimo = { slides: m.slides, legenda: leg.texto, hashtags: leg.tags, partes_legenda: leg.partes, llm, erros };
    if (!erros.length) return { ...ultimo, tentativas: i, historico };
    feedback = [...new Set(erros)].slice(0, 12).join('\n- ');
    if (deps.aoFalhar) await deps.aoFalhar({ tentativa: i, erros: [...new Set(erros)], feedback });
  }
  const e = Object.assign(new Error(`A copy não passou nas regras depois de ${tentativas} tentativas: ${ultimo.erros.slice(0, 4).join('; ')}`), { code: 'COPY_INVALIDA', status: 422, erros: ultimo.erros, historico });
  throw e;
}

// ── Reels ───────────────────────────────────────────────────────────────────
const SISTEMA_REELS = `Você escreve o roteiro de um Reels de 30 a 40 segundos para o perfil @pedro_destrava, série “Ideias que dão dinheiro”, a partir do mesmo negócio. Mesma voz e mesmas regras do carrossel: frases curtas e humanas, só fatos de DADOS_VERIFICADOS (com “segundo a empresa” quando o dado é da empresa), nenhum número inventado, sem emoji, sem exclamação, sem as frases proibidas (“em um mundo onde”, “isso muda tudo”, “o futuro chegou”, “mais do que”, “não é apenas”, “revolucionário”). Brasil é HIPÓTESE, nunca promessa.
Responda APENAS JSON: {"gancho":"até 14 palavras, primeiros 3 segundos","blocos":[{"tempo":"3-10s","fala":"","tela":"texto curto na tela"},{"tempo":"10-18s","fala":"","tela":""},{"tempo":"18-26s","fala":"","tela":""},{"tempo":"26-34s","fala":"","tela":""}],"fechamento":"convite para seguir @pedro_destrava, até 16 palavras"}
Blocos: problema e solução; como o negócio ganha dinheiro; a prova (somente dados verificados); hipótese para testar no Brasil.`;

async function gerarReels(op, { deps = {}, tentativas = 2 } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson; const usaveis = claimsUsaveis(op);
  let feedback = ''; let erros = [];
  for (let i = 1; i <= tentativas; i++) {
    const d = llmJson.dado('OPORTUNIDADE', JSON.stringify(dadosParaIa(op)), 14000);
    const { dados, llm } = await pedir({ sistema: `${SISTEMA_REELS}\n\n${llmJson.REGRAS_DADOS}`, usuario: `${d.bloco}${feedback ? `\nRECUSADO POR: ${feedback}` : ''}`, maxTokens: 1800, temperatura: 0.4, budget: deps.budget });
    const blocos = (Array.isArray(dados?.blocos) ? dados.blocos : []).slice(0, 5).map((b) => ({ tempo: U.limita(b?.tempo, 12), fala: U.limita(b?.fala, 260), tela: U.limita(b?.tela, 80) }));
    const gancho = U.limita(dados?.gancho, 140); const fecho = U.limita(dados?.fechamento, 160);
    const tudo = [gancho, ...blocos.flatMap((b) => [b.fala, b.tela]), fecho].join(' ');
    erros = [...checarTexto(tudo, 'Reels')];
    if (!gancho || blocos.length < 3 || !fecho) erros.push('Reels: faltam partes do roteiro');
    if (U.contaPalavras(gancho) > 16) erros.push('Reels: gancho com mais de 16 palavras');
    const sp = numerosNaoComprovados(tudo, usaveis); if (sp.length) erros.push(`Reels: número sem comprovação (${sp.join(', ')})`);
    const f = atribuicaoFaltando(tudo, usaveis); if (f.length) erros.push(`Reels: falta a atribuição “${f[0]}”`);
    if (!/pedro_destrava/i.test(fecho)) erros.push('Reels: o fechamento deve convidar a seguir @pedro_destrava');
    if (!erros.length) return { gancho, blocos, fechamento: fecho, palavras: U.contaPalavras(tudo), llm };
    feedback = erros.slice(0, 8).join('; ');
  }
  throw Object.assign(new Error(`O roteiro de Reels não passou nas regras: ${erros.slice(0, 3).join('; ')}`), { code: 'COPY_INVALIDA', status: 422, erros });
}

module.exports = { repararAtribuicao, rotuloIncoerente, gerarCopia, gerarReels, montarTelas, validarTelas, montarLegenda, checarTexto, numerosNaoComprovados, atribuicaoFaltando, dinheiroNaCapa, claimsUsaveis, INTRO, ROTULOS_BRASIL, SISTEMA };
