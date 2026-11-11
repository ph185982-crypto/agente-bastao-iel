// Carrossel "top" do @pedro_destrava: notícia com tese, no visual da referência (marinho/amarelo/vermelho, foto real em P&B).
// Etapas retomáveis (cada chamada de `passo` cabe no limite da função):
//   ler → fatos → angulo → roteiro (2 versões) → juri → foto → arte (slide a slide) → fim
// A IA escreve; o CÓDIGO confere (checagem.js): trecho de cada fato tem de estar na matéria, todo número do carrossel tem de
// ser de um fato conferido. O júri dá nota e escolhe; abaixo da régua o carrossel não vai para a aprovação.
// No fim vira um conteúdo da Mesa "Para aprovar" (status em_revisao): o Pedro aprova e o fluxo de publicação existente publica.
// Nada é publicado aqui.
const crypto = require('crypto');
const M = require('../../../static/contentModel');
const llmJson = require('../llmJson');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const P = require('./prompts');
const K = require('./checagem');

const conta = () => ACCOUNT.ig_id;
const agoraISO = () => new Date().toISOString();
const erro = (msg, code, status = 400) => Object.assign(new Error(msg), { code, status });
const ETAPAS = ['ler', 'fatos', 'angulo', 'roteiro', 'juri', 'capas', 'painel', 'foto', 'arte', 'fim'];
const ROTULO = { ler: 'Lendo a matéria', fatos: 'Separando os fatos e conferindo na matéria', angulo: 'Testando se a pauta vale (teste do grupo)', roteiro: 'Escrevendo as versões', juri: 'Júri escolhendo a melhor', capas: 'Sala de redação: 10 mentes escrevendo capas', painel: 'Painel de 1.000 pessoas avaliando a copy', foto: 'Buscando foto real com licença', arte: 'Desenhando os slides', fim: 'Pronto para aprovar' };
// nucleo_min: bolso OU contradição precisa pesar (número e personagem sozinhos dão post de cotação, não de tese).
const REGUA = { gatilhos_min: 5, nota_min: 7.5, nucleo_min: 2 };
// Formatos que o pipeline produz: carrossel reportagem, carrossel tweet, post estático (1–2 imagens + legenda longa) e
// ensaio (texto corrido em slides escuros, variante do tweet).
const FORMATOS = ['tweet', 'reportagem', 'estatico', 'ensaio'];
const LEASE_MS = 70000; const MAX_TENTATIVAS = 3;

function regua() {
  const n = Number(process.env.TOP_NOTA_MINIMA); const g = Number(process.env.TOP_GATILHOS_MINIMO);
  return { nota_min: Number.isFinite(n) && n > 0 ? n : REGUA.nota_min, gatilhos_min: Number.isFinite(g) && g >= 0 ? g : REGUA.gatilhos_min, nucleo_min: REGUA.nucleo_min };
}

async function vozDoPedro() {
  // Legendas reais dos posts que mais foram compartilhados (painel Resultados). Sem painel, segue sem exemplos.
  try {
    const cfg = await armazem().config.obter(conta());
    // Exemplos de voz: os posts do Pedro e, da ferramenta, só os que foram MAIS enviados que a mediana dos posts dele
    // (o que a ferramenta acertou volta para a escrita; o que errou não vira exemplo).
    const corte = cfg.meu_placar?.seus?.envios_mil ?? null;
    const posts = (cfg.meu_instagram?.posts || []).filter((p) => String(p.legenda || '').length > 80 && p.alcance
      && (!p.da_ferramenta || (corte != null && p.maduro && ((p.compartilhamentos || 0) / p.alcance) * 1000 > corte)));
    return posts.map((p) => ({ p, envios: (p.compartilhamentos || 0) / p.alcance }))
      .sort((a, b) => b.envios - a.envios).slice(0, 5).map(({ p }) => String(p.legenda).replace(/\s+/g, ' ').slice(0, 420));
  } catch { return []; }
}

// ── Criação ─────────────────────────────────────────────────────────────────────
const PROPRIOS = ['historia', 'como_fazer', 'caso'];
const MODOS = ['opiniao', ...PROPRIOS];
async function criar({ url = null, texto = null, titulo = '', origem = 'manual', formato = null, modo = null } = {}) {
  const a = armazem(); if (!a?.duravel) throw erro('O carrossel precisa do banco de dados no servidor.', 'SEM_BANCO', 503);
  const u = url ? require('../radar/pauta').urlValida(url) : null;
  if (url && !u) throw erro('Link inválido.', 'LINK_INVALIDO');
  const modoOk = MODOS.includes(modo) ? modo : null;
  if (!u && String(texto || '').trim().length < (PROPRIOS.includes(modoOk) ? 200 : 300)) throw erro(PROPRIOS.includes(modoOk) ? 'Escreva pelo menos 200 caracteres: a ferramenta só usa o que você contar.' : 'Envie o link da matéria ou cole um texto com pelo menos 300 caracteres.', 'ENTRADA');
  const fmt = FORMATOS.includes(formato) ? formato : null;
  // Post estático é um conteúdo `formato: 'estatico'` (1 ou 2 imagens); os demais continuam carrossel.
  const c = M.novoConteudo({ titulo: String(titulo || '').slice(0, 140) || (fmt === 'estatico' ? 'Post em preparação' : 'Carrossel em preparação'), origem: u ? { tipo: 'link', url: u } : { tipo: 'texto' }, formato: fmt === 'estatico' ? 'estatico' : 'carrossel' });
  c.top = { versao_motor: 1, estado: 'em_andamento', etapa: 'ler', origem, entrada: { url: u, texto: u ? null : String(texto).slice(0, 30000), formato: fmt, modo: modoOk }, tentativas: {}, erros: [], criado_em: agoraISO() };
  await a.conteudos.salvar(conta(), c.id, c, 0);
  return c;
}

const opiniao = (c) => c.top?.entrada?.modo === 'opiniao';
// Linhas PRÓPRIAS do Pedro (cadastro "Minhas histórias e casos"): a fonte é o texto que ele escreveu. Não há matéria, tese de
// denúncia nem rodapé de fonte; os "fatos" são as frases dele e número só entra se estiver no texto dele.
const proprio = (c) => PROPRIOS.includes(c.top?.entrada?.modo);
const semMateria = (c) => opiniao(c) || proprio(c);
// Chamada do último slide: história pede para mandar a quem precisa; passo a passo pede para salvar; o resto, mandar para a pessoa certa.
function chamadaFinal(c) {
  const m = c.top?.entrada?.modo;
  if (m === 'como_fazer') return 'Salva esse passo a passo.';
  if (m === 'historia') return 'Manda pra quem precisa ouvir isso.';
  return `Manda pra ${c.top?.angulo?.enviar_para || 'seu sócio'}.`;
}
// Modo OPINIÃO (reciclagem de tese): não há matéria com fatos; o conteúdo sai como leitura do Pedro, sem nenhum número, e sem rodapé de fonte.
const AVISO_OPINIAO = 'SEM FATOS VERIFICADOS. Este conteúdo é OPINIÃO do Pedro sobre a TESE do briefing, escrita do zero. PROIBIDO qualquer número, porcentagem, valor em reais, data, estatística, pesquisa, estudo ou citação: nada disso pode ser verificado aqui. Use papéis gap, contradicao, consequencia e leitura (não existe tela de prova com número); cenas do dia a dia do empreendedor, raciocínio e posição. Marque como leitura ("na minha leitura", "pra mim"), sem afirmar dado do mundo como se fosse fato.';

// ── Etapas ──────────────────────────────────────────────────────────────────────
const Mentes = require('../mentes');
const E = {};
E.ler = async (c, ctx) => {
  const f = await (ctx.deps.lerFonte || require('../research').lerFonte)({ url: c.top.entrada.url, texto: c.top.entrada.texto });
  if (!f?.legivel) throw Object.assign(erro(f?.acesso === 'negado' ? 'O site recusou a leitura automática. Cole o texto da matéria.' : 'A matéria não tem texto legível.', 'LINK_ILEGIVEL', 422), { terminal: true });
  c.fonte_principal = { tipo: f.tipo, url: f.url_final || f.url || null, titulo: f.titulo || '', veiculo: f.veiculo || '', publicada_em: f.publicada_em || null, texto: String(f.texto || '').slice(0, 30000), acessada_em: f.acessada_em || agoraISO() };
  if (f.titulo) c.titulo = String(f.titulo).slice(0, 140);
};

E.fatos = async (c, ctx) => {
  if (opiniao(c)) { c.top.fatos = []; c.top.fatos_descartados = []; c.top.protagonista = null; return; }
  if (proprio(c)) {
    // Sem IA: cada frase do relato do Pedro é um fato, com o trecho literal. Nada de fora entra.
    const frases = String(c.fonte_principal.texto || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter((f) => f.length >= 12).slice(0, 24);
    c.top.fatos = frases.map((f, i) => ({ id: `f${i + 1}`, id_ia: `f${i + 1}`, texto: f.slice(0, 400), trecho: f.slice(0, 600), tipo: 'fato', quem: null, valores: M.extrairNumeros(f).map((n) => n.valor), origem: 'relato' }));
    c.top.fatos_descartados = []; c.top.protagonista = null;
    if (!c.top.fatos.length) throw Object.assign(erro('O texto cadastrado não tem frases completas para virar conteúdo.', 'SEM_FATOS', 422), { terminal: true, fim: 'descartada' });
    return;
  }
  const d = llmJson.dado('MATERIA', `${c.fonte_principal.titulo}\n\n${c.fonte_principal.texto}`, 18000);
  const { dados } = await ctx.ia({ sistema: `${P.FATOS}\n\n${llmJson.REGRAS_DADOS}`, usuario: d.bloco, maxTokens: 2600, temperatura: 0.1 });
  const r = K.verificarFatos(dados?.fatos, c.fonte_principal.texto);
  // A manchete lida da página também é fato do veículo: o número dela (ex.: "CBS em 11,3%") às vezes não volta da extração.
  const manchete = String(c.fonte_principal.titulo || '').trim(); const nManchete = M.extrairNumeros(manchete).filter(M.exigeOrigem).map((n) => n.valor);
  if (nManchete.length && !r.fatos.some((f) => f.trecho === manchete)) r.fatos.push({ id: `f${r.fatos.length + 1}`, id_ia: 'manchete', texto: manchete.slice(0, 400), trecho: manchete.slice(0, 600), tipo: 'fato', quem: null, valores: M.extrairNumeros(manchete).map((n) => n.valor), origem: 'manchete' });
  c.top.fatos = r.fatos; c.top.fatos_descartados = r.descartados.slice(0, 12);
  c.top.protagonista = dados?.protagonista ? String(dados.protagonista).slice(0, 80) : null;
  if (r.fatos.length < 2) throw Object.assign(erro('A matéria não tem fatos suficientes que deu para conferir palavra por palavra.', 'SEM_FATOS', 422), { terminal: true, fim: 'descartada' });
};

E.angulo = async (c, ctx) => {
  const { dados } = await ctx.ia({ sistema: P.ANGULO, usuario: proprio(c) ? `${P.LINHAS[c.top.entrada.modo].angulo}\n\nTEXTO DO PEDRO (fonte única):\n${c.fonte_principal.texto.slice(0, 6000)}` : opiniao(c) ? `${AVISO_OPINIAO}\n\nBRIEFING (tese e ponte para o Pedro):\n${c.fonte_principal.texto.slice(0, 3000)}\n\nNo "numero" dê 0 (não há número). Avalie bolso, contradição e personagem pela tese e pela ponte.` : `TÍTULO: ${c.fonte_principal.titulo}\nVEÍCULO: ${c.fonte_principal.veiculo}\nFATOS VERIFICADOS:\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}`, maxTokens: 700, temperatura: 0.3, preferirMelhor: true });
  const g = dados?.gatilhos || {}; const n = (k) => Math.max(0, Math.min(3, Number(g[k]) || 0));
  const empreendedor = g.empreendedor === undefined ? null : n('empreendedor'); // fora da soma: é filtro de público, não de viralidade
  const enviarPara = String(dados?.enviar_para || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  c.top.angulo = { empreendedor, enviar_para: /^(seu|sua|seus|suas|quem)\b/i.test(enviarPara) ? enviarPara : 'seu sócio', gatilhos: { contradicao: n('contradicao'), bolso: n('bolso'), numero: n('numero'), personagem: n('personagem') }, tese: String(dados?.tese || '').slice(0, 260), por_que_mandaria: String(dados?.por_que_mandaria || '').slice(0, 240), risco: String(dados?.risco || '').slice(0, 240), imagem: { busca: String(dados?.imagem?.busca || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().slice(0, 80), pessoa_central: dados?.imagem?.pessoa_central === true, lugar_brasil: dados?.imagem?.lugar_brasil ? String(dados.imagem.lugar_brasil).slice(0, 80) : null } };
  c.top.angulo.soma = Object.values(c.top.angulo.gatilhos).reduce((x, y) => x + y, 0);
  // Formato visual: o pedido de quem criou (piloto alterna para variar o feed) vence; senão a escolha do editor.
  c.top.formato = c.top.entrada?.formato || (dados?.formato === 'tweet' ? 'tweet' : 'reportagem');
  if (semMateria(c)) { if (!c.top.angulo.tese) throw Object.assign(erro('Não saiu uma tese a partir do briefing.', 'PAUTA_FRACA', 422), { terminal: true, fim: 'descartada' }); return; }
  if (empreendedor === 0) throw Object.assign(erro('A pauta não muda nada para quem empreende (público do perfil): fica de fora.', 'PAUTA_FRACA', 422), { terminal: true, fim: 'descartada' });
  const nucleo = Math.max(c.top.angulo.gatilhos.bolso, c.top.angulo.gatilhos.contradicao);
  if (c.top.angulo.soma >= regua().gatilhos_min && c.top.angulo.tese && nucleo < regua().nucleo_min) throw Object.assign(erro(`Sem bolso nem contradição (máximo ${nucleo}/3; mínimo ${regua().nucleo_min}): vira post de cotação, não de tese.`, 'PAUTA_FRACA', 422), { terminal: true, fim: 'descartada' });
  if (c.top.angulo.soma < regua().gatilhos_min || !c.top.angulo.tese) throw Object.assign(erro(`Não passou no teste do grupo (${c.top.angulo.soma}/12 nos gatilhos; mínimo ${regua().gatilhos_min}).`, 'PAUTA_FRACA', 422), { terminal: true, fim: 'descartada' });
};

E.roteiro = async (c, ctx) => {
  c.top.versoes ||= [];
  const voz = c.top.voz || (c.top.voz = await vozDoPedro());
  const fatos = proprio(c) ? `TEXTO DO PEDRO (fonte única; nada além disto pode ser afirmado):\n${c.fonte_principal.texto.slice(0, 6000)}\n\nFRASES DELE (use os ids em "fatos"):\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}` : opiniao(c) ? `${AVISO_OPINIAO}\n\nBRIEFING:\n${c.fonte_principal.texto.slice(0, 3000)}` : `FATOS VERIFICADOS (fonte: ${c.fonte_principal.veiculo}${c.fonte_principal.publicada_em ? `, ${String(c.fonte_principal.publicada_em).slice(0, 10)}` : ''}):\n${c.top.fatos.map((f) => `${f.id} [${f.tipo}${f.quem ? `, ${f.quem}` : ''}]: ${f.texto}`).join('\n')}`;
  while (c.top.versoes.length < 2 && ctx.restante() > 22000) {
    const anterior = c.top.versoes[c.top.versoes.length - 1];
    const feedback = anterior && !anterior.checagem.ok ? anterior.checagem.problemas.slice(0, 8).join('\n') : '';
    // Cada versão é escrita com o método de um copywriter (dupla em rodízio pelo id do carrossel).
    if (c.top.pesos_redator === undefined) { try { c.top.pesos_redator = ctx.deps.placar !== undefined ? (ctx.deps.placar?.pesos?.redator || null) : ((await armazem().config.obter(conta())).meu_placar?.pesos?.redator || null); } catch { c.top.pesos_redator = null; } }
    const mente = (ctx.deps.mentes || Mentes).parPara(c.id, c.top.pesos_redator)[c.top.versoes.length];
    const { dados } = await ctx.ia({ sistema: (proprio(c) ? `${P.LINHAS[c.top.entrada.modo].roteiro}\n\n` : '') + P.roteiro({ voz, tese: c.top.angulo.tese, porQue: c.top.angulo.por_que_mandaria, feedback, formato: c.top.formato, mente: Mentes.paraRoteiro(mente), enviarPara: c.top.angulo.enviar_para }), usuario: semMateria(c) ? fatos : `${fatos}\n\nTÍTULO DA MATÉRIA: ${c.fonte_principal.titulo}`, maxTokens: 3800, temperatura: c.top.versoes.length ? 0.85 : 0.6, preferirMelhor: true });
    const v = normalizarRoteiro(dados, c.top.formato);
    const estatico = c.top.formato === 'estatico';
    // Data também sai: o portão de publicação trata "27/10/2026" como número que precisa de fonte.
    const DATA = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2} de (?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;
    const limparFrases = (txt) => String(txt || '').split(/(?<=[.!?])\s+/).filter((f) => !K.numerosSemFonte(f, c.top.fatos).length && !DATA.test(f)).join(' ').trim();
    // Legenda longa (post estático) é escrita em parágrafos: limpa frase a frase sem perder as quebras.
    const limparParagrafos = (txt) => K.paragrafosDe(txt).map(limparFrases).filter(Boolean).join('\n\n');
    v.legenda = estatico ? limparParagrafos(v.legenda) : limparFrases(v.legenda); v.cta_motivo = K.numerosSemFonte(v.cta_motivo, c.top.fatos).length ? '' : v.cta_motivo;
    v.fechamento = { titulo: K.numerosSemFonte(v.fechamento.titulo, c.top.fatos).length ? '' : v.fechamento.titulo, texto: limparFrases(v.fechamento.texto).replace(/eu comecei o pedro destrava por isso\.?/i, '').trim() };
    v.checagem = K.checarRoteiro({ ...v, capa: v.capas[0]?.texto || '', telas: [...v.telas], legenda: estatico ? v.legenda : `${v.legenda}\n${v.fechamento.titulo}\n${v.fechamento.texto}\n${v.cta_motivo}` }, c.top.fatos, { formato: c.top.formato, opiniao: semMateria(c) });
    // capas com número fora dos fatos ou com vício de texto de IA saem da lista (não derrubam a versão inteira)
    v.capas = v.capas.filter((k) => K.checarRoteiro({ capa: k.texto, telas: v.telas, legenda: '' }, c.top.fatos).problemas.every((p) => !p.startsWith('capa')) && !Mentes.AI.vicios(k.texto).length);
    // Texto com cara de IA (a mesma fórmula em todo post): 3 ou mais vícios reprovam a versão, com as frases apontadas.
    const vic = Mentes.AI.vicios([...v.telas.map((t) => [t.titulo, t.texto, t.destaque].filter(Boolean).join(' ')), v.fechamento.titulo, v.fechamento.texto, v.legenda]);
    v.vicios = vic.length;
    if (vic.length >= 3) v.checagem = { ...v.checagem, ok: false, problemas: [...v.checagem.problemas, `Texto com cara de IA (${vic.length} vícios). Reescreva sem: ${vic.slice(0, 5).map((x) => `${x.nome} em "${x.trecho}"`).join('; ')}`] };
    // No post estático a legenda É o post: a régua é mais dura (2 vícios já reprovam a legenda).
    if (estatico) { const vl = Mentes.AI.vicios(v.legenda); if (vl.length >= 2) v.checagem = { ...v.checagem, ok: false, problemas: [...v.checagem.problemas, `Legenda com cara de IA (${vl.length} vícios). Reescreva sem: ${vl.slice(0, 4).map((x) => `${x.nome} em "${x.trecho}"`).join('; ')}`] }; }
    v.mente = mente?.id || null;
    c.top.versoes.push(v);
  }
  if (c.top.versoes.length < 2) return { concluida: false };
  if (!c.top.versoes.some((v) => v.checagem.ok && v.capas.length)) {
    c.top.reescritas = (c.top.reescritas || 0) + 1;
    if (c.top.reescritas > 2) throw Object.assign(erro(`As versões não passaram na checagem: ${c.top.versoes[1].checagem.problemas.slice(0, 2).join(' ')}`, 'CHECAGEM', 422), { terminal: true, fim: 'abaixo_da_regua' });
    c.top.versoes = c.top.versoes.slice(-1); return { concluida: false };
  }
};

// Campo vazio, "null" ou só códigos internos ("f1,f2") não vai para a arte.
function limpaCampo(v, n) {
  const x = String(v ?? '').trim();
  if (!x || /^(null|none|n\/a|-)$/i.test(x) || /^\s*\[?\s*[a-z]?\d+(\s*[,;]\s*[a-z]?\d+)*\s*\]?\s*$/i.test(x) || /^(f\d+[\s,;]*)+$/i.test(x)) return null;
  return x.slice(0, n);
}

// Tira referências internas que a IA às vezes escreve no texto: "(f1)", "[f2, f3]", "f1,f2".
const semIds = (x) => (x == null ? x : String(x).replace(/\s*[\[(]\s*f\d+(?:\s*[,;]\s*f\d+)*\s*[\])]/gi, '').replace(/\s{2,}/g, ' ').trim());
// "Segue o @pedro_destrava" já é fixo na faixa: o motivo vem sem repetir a chamada.
const semChamada = (x) => String(x || '').replace(/^\s*(segue|siga)\s+(o\s+)?@?pedro_destrava[\s,:–-]*/i, '').trim();

const PAPEIS = ['gap', 'prova', 'contradicao', 'consequencia', 'leitura'];
const hashtagsDe = (d) => (Array.isArray(d?.hashtags) ? d.hashtags : []).map((h) => `#${String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2).slice(0, 3);
const umaLinha = (x, n) => semIds(String(x || '')).replace(/\s+/g, ' ').trim().slice(0, n);

// Post estático: capa (headline até 10 palavras) + no máximo 1 tela ("virar") + legenda longa em parágrafos.
function normalizarEstatico(d, capas) {
  const vir = d?.virar || {}; const t = vir.precisa === true && vir.tela && (vir.tela.texto || '') ? vir.tela : null;
  const telas = t ? [{ papel: ['prova', 'leitura'].includes(t.papel) ? t.papel : 'leitura', layout: 'tweet', titulo: null, texto: umaLinha(t.texto, 220), destaque: null, apoio: null, dados: null, imagem_busca: null, fatos: Array.isArray(t.fatos) ? t.fatos.map(String).slice(0, 6) : [] }] : [];
  // legenda: lista de parágrafos ou texto com linhas em branco; cada parágrafo numa linha só
  const brutos = Array.isArray(d?.legenda) ? d.legenda.map(String) : K.paragrafosDe(d?.legenda);
  const legenda = brutos.map((p) => semIds(p).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8).join('\n\n').slice(0, 1800);
  const ouro = umaLinha(d?.frase_de_ouro, 140);
  return { formato: 'estatico', capas: capas.filter((k) => K.palavras(k.texto) <= 10), telas, legenda, hashtags: hashtagsDe(d), cta_motivo: semChamada(semIds(d?.cta_motivo)).slice(0, 90), frase_de_ouro: ouro, virar_motivo: umaLinha(vir.motivo, 160), fechamento: { titulo: ouro.slice(0, 80), texto: '' } };
}

// Ensaio: abertura (capa) + 4 a 6 blocos de 2–3 parágrafos (texto do bloco com parágrafos separados por linha em branco) + fechamento com a frase de ouro.
function normalizarEnsaio(d, capas) {
  const telas = (Array.isArray(d?.telas) ? d.telas : []).slice(0, 6).map((t) => {
    const ps = (Array.isArray(t?.paragrafos) ? t.paragrafos : K.paragrafosDe(t?.texto)).map((p) => semIds(String(p || '')).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
    return { papel: PAPEIS.includes(t?.papel) ? t.papel : 'gap', layout: 'ensaio', titulo: null, texto: ps.join('\n\n').slice(0, 520), destaque: null, apoio: null, dados: null, imagem_busca: null, fatos: Array.isArray(t?.fatos) ? t.fatos.map(String).slice(0, 6) : [] };
  }).filter((t) => t.texto);
  const semChamadaFinal = (txt) => String(txt || '').split(/(?<=[.!?])\s+/).filter((f) => !/\b(manda|mande|marca|marque|envia|envie|compartilha|compartilhe|segue|siga|segue o)\b|eu comecei o pedro destrava/i.test(f)).join(' ');
  return { formato: 'ensaio', capas, telas, legenda: semIds(String(d?.legenda || '')).slice(0, 900), hashtags: hashtagsDe(d), cta_motivo: semChamada(semIds(d?.cta_motivo)).slice(0, 90), fechamento: { titulo: umaLinha(d?.fechamento?.titulo, 110), texto: semChamadaFinal(semIds(String(d?.fechamento?.texto || ''))).slice(0, 200) } };
}

function normalizarRoteiro(d, formato = 'reportagem') {
  const tweet = formato === 'tweet';
  const capas = (Array.isArray(d?.capas) ? d.capas : []).map((k) => ({ texto: String(k?.texto || k || '').replace(/\s+/g, ' ').trim().slice(0, 160), mecanismo: String(k?.mecanismo || '').slice(0, 40) })).filter((k) => k.texto && K.palavras(k.texto) <= (tweet ? 14 : 14)).slice(0, 10);
  if (formato === 'estatico') return normalizarEstatico(d, capas);
  if (formato === 'ensaio') return normalizarEnsaio(d, capas);
  const LAY = ['rep_manchete', 'rep_comparacao', 'rep_numero'];
  if (tweet) {
    // tweet: só texto, uma frase por tela; a foto do tweet vem da busca sugerida (ilustrativa, Pexels)
    const telasT = (Array.isArray(d?.telas) ? d.telas : []).slice(0, 8).map((t) => ({
      papel: ['gap', 'prova', 'contradicao', 'consequencia', 'leitura'].includes(t?.papel) ? t.papel : 'gap', layout: 'tweet',
      titulo: null, texto: t?.texto ? semIds(String(t.texto)).replace(/\s+/g, ' ').trim().slice(0, 260) : null, destaque: null, apoio: null, dados: null,
      imagem_busca: t?.imagem_busca ? String(t.imagem_busca).replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().slice(0, 60) : null,
      fatos: Array.isArray(t?.fatos) ? t.fatos.map(String).slice(0, 6) : [],
    })).filter((t) => t.texto);
    return { formato: 'tweet', capas, telas: telasT, legenda: semIds(String(d?.legenda || '')).slice(0, 900), hashtags: (Array.isArray(d?.hashtags) ? d.hashtags : []).map((h) => `#${String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2).slice(0, 3), cta_motivo: semChamada(semIds(d?.cta_motivo)).slice(0, 90), fechamento: { titulo: semIds(String(d?.fechamento?.titulo || '')).slice(0, 80), texto: semIds(String(d?.fechamento?.texto || '')).split(/(?<=[.!?])\s+/).filter((f) => !/\b(manda|mande|marca|marque|envia|envie|compartilha|compartilhe|segue|siga|segue o)\b|eu comecei o pedro destrava/i.test(f)).join(' ').slice(0, 240) } };
  }
  const telas = (Array.isArray(d?.telas) ? d.telas : []).slice(0, 7).map((t) => ({
    papel: ['gap', 'prova', 'contradicao', 'consequencia', 'leitura'].includes(t?.papel) ? t.papel : 'gap',
    layout: LAY.includes(t?.layout) ? t.layout : 'rep_manchete',
    titulo: t?.titulo ? semIds(String(t.titulo)).slice(0, 90) : null, texto: t?.texto ? semIds(String(t.texto)).slice(0, 320) : null,
    destaque: limpaCampo(t?.destaque, 80), apoio: limpaCampo(t?.apoio, 200),
    dados: t?.dados && typeof t.dados === 'object' ? limpaDados(t.dados) : null, fatos: Array.isArray(t?.fatos) ? t.fatos.map(String).slice(0, 6) : [],
  })).filter((t) => t.titulo || t.texto || t.dados).map(repararTela);
  return { capas, telas, legenda: semIds(String(d?.legenda || '')).slice(0, 900), hashtags: (Array.isArray(d?.hashtags) ? d.hashtags : []).map((h) => `#${String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2).slice(0, 3), cta_motivo: semChamada(semIds(d?.cta_motivo)).slice(0, 90), fechamento: { titulo: semIds(String(d?.fechamento?.titulo || '')).slice(0, 70), texto: semIds(String(d?.fechamento?.texto || '')).slice(0, 200) } };
}
// Conserta por código o que dá para consertar sem inventar: tela de número sem número e comparação sem os dois lados
// viram manchete (o texto continua; o desenho muda). Assim um detalhe de formato não derruba a versão inteira.
function repararTela(t) {
  if (t.layout === 'rep_numero' && !t.dados?.numero?.valor) return { ...t, layout: 'rep_manchete', dados: null };
  if (t.layout === 'rep_comparacao') {
    const tem = (l) => !!(l?.valor && /\d/.test(l.valor));
    const e = tem(t.dados?.esquerda); const d = tem(t.dados?.direita);
    // comparação só vale com número dos dois lados; com um só, vira "número gigante"; sem nenhum, manchete
    if (!e && !d) return { ...t, layout: 'rep_manchete', dados: null };
    if (!e || !d) { const l = e ? t.dados.esquerda : t.dados.direita; return { ...t, layout: 'rep_numero', dados: { numero: { valor: String(l.valor).slice(0, 16), rotulo: String(l.rotulo || t.titulo || '').slice(0, 22) } } }; }
  }
  if (t.layout === 'rep_manchete' && t.dados && !t.dados.numero && !t.dados.esquerda) return { ...t, dados: null };
  return t;
}

function limpaDados(d) {
  const curto = (v, n) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  // texto de apoio cortado em palavra inteira (nunca "não ligad", "de varej")
  const palavra = (v, n) => { const t = curto(v, 400); if (t.length <= n) return t; return t.slice(0, n + 1).replace(/\s+\S*$/, '').replace(/[,;:\-–]+$/, '').trim(); };
  const lado = (l) => (l && l.valor ? { rotulo: palavra(l.rotulo, 18), valor: curto(l.valor, 14), ...(l.unidade ? { unidade: palavra(l.unidade, 26) } : {}) } : null);
  // rótulo cortado em palavra inteira, sem parêntese aberto pela metade
  const rotulo = (v) => { let r = curto(v, 60); if (r.length > 22) { r = r.slice(0, 23).replace(/\s+\S*$/, ''); } return r.replace(/\s*\([^)]*$/, '').trim(); };
  if (d.numero) { const n = typeof d.numero === 'object' ? d.numero : { valor: d.numero, rotulo: d.rotulo }; return { numero: { valor: curto(n.valor, 16), rotulo: rotulo(n.rotulo) } }; }
  const out = { esquerda: lado(d.esquerda), direita: lado(d.direita), tom: d.tom === 'alerta' ? 'alerta' : 'neutro' };
  if (d.faixa?.valor) out.faixa = { valor: curto(d.faixa.valor, 32), ...(d.faixa.texto ? { texto: palavra(d.faixa.texto, 30) } : {}) };
  return out;
}

E.juri = async (c, ctx) => {
  const vs = c.top.versoes;
  const notaFormato = [P.notaJuri(c.top.formato), proprio(c) ? P.LINHAS[c.top.entrada.modo].juri : opiniao(c) ? 'CONTEÚDO DE OPINIÃO (sem fatos verificados, por desenho): não exija prova numérica. Em "honestidade", reprove (abaixo de 7) quem afirma número, dado, pesquisa ou fato do mundo como verdade; opinião marcada como leitura do Pedro é honesta. Em "prova" avalie a força do argumento e da cena, não o número.' : ''].filter(Boolean).join('\n');
  const usuario = `${notaFormato ? `${notaFormato}\n\n` : ''}FATOS VERIFICADOS:\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}\n\n` + vs.map((v, i) => `VERSÃO ${i}${v.checagem.ok ? '' : ' (reprovada na checagem: ' + v.checagem.problemas.slice(0, 2).join(' ') + ')'}\nCAPAS:\n${v.capas.map((k, j) => `  [${j}] ${k.texto}`).join('\n')}\nTELAS:\n${v.telas.map((t, j) => `  ${j + 2}. (${t.papel}) ${[t.titulo, t.texto, t.destaque, t.dados ? JSON.stringify(t.dados) : ''].filter(Boolean).join(' | ')}`).join('\n')}${v.fechamento?.titulo ? `\nFECHAMENTO: ${[v.fechamento.titulo, v.fechamento.texto].filter(Boolean).join(' ')}` : ''}\nLEGENDA: ${v.legenda}`).join('\n\n');
  const { dados } = await ctx.ia({ sistema: P.JURI, usuario, maxTokens: 900, temperatura: 0.1, preferirMelhor: true });
  const notas = Array.isArray(dados?.versoes) ? dados.versoes : [];
  let melhor = -1; let nota = -1;
  vs.forEach((v, i) => {
    const j = notas.find((x) => Number(x.indice) === i) || notas[i] || {};
    const hon = Number(j.notas?.honestidade);
    v.juri = { notas: j.notas || {}, nota: Math.max(0, Math.min(10, Number(j.nota) || 0)), defeito: String(j.defeito || '').slice(0, 200) };
    // Veto: afirmação além dos fatos (ex.: chamar de "novo imposto" o que os fatos não dizem que é novo) derruba a versão.
    if (Number.isFinite(hon) && hon < 7) { v.juri.nota = Math.min(v.juri.nota, hon); v.juri.defeito = `Honestidade ${hon}: ${String(j.honestidade_motivo || v.juri.defeito || 'afirma mais do que os fatos sustentam')}`.slice(0, 220); }
    if (v.checagem.ok && v.capas.length && v.juri.nota > nota) { nota = v.juri.nota; melhor = i; }
  });
  if (melhor < 0) throw Object.assign(erro('Nenhuma versão passou na checagem.', 'CHECAGEM', 422), { terminal: true, fim: 'abaixo_da_regua' });
  const v = vs[melhor];
  const esc = (Array.isArray(dados?.capas_escolhidas) ? dados.capas_escolhidas : [0, 1]).map(Number).filter((n) => n >= 0 && n < v.capas.length);
  c.top.escolha = { versao: melhor, nota, capas: [...new Set([...esc, 0, 1])].filter((n) => n < v.capas.length).slice(0, 2), defeito: v.juri.defeito };
  if (nota < regua().nota_min) {
    c.top.reprovacoes_juri = (c.top.reprovacoes_juri || 0) + 1;
    if (c.top.reprovacoes_juri > 1) throw Object.assign(erro(`O júri deu ${nota.toFixed(1)} (mínimo ${regua().nota_min}). Defeito: ${v.juri.defeito || 'sem detalhe'}`, 'ABAIXO_DA_REGUA', 422), { terminal: true, fim: 'abaixo_da_regua' });
    // mais uma rodada de roteiro com o defeito apontado
    c.top.reescritas = 0;
    c.top.versoes = [{ ...v, checagem: { ok: false, problemas: [`O júri deu ${nota.toFixed(1)}: ${v.juri.defeito}`] } }];
    return { voltar: 'roteiro' };
  }
};

// Painel de audiência (backend/lib/painel): 30 vozes que representam 1.000 pessoas avaliam a copy ANTES de virar arte.
// Escolhe a melhor capa; nota baixa manda reescrever uma vez com as objeções e, se continuar baixa, descarta.
// Falha ou painel ainda não montado = segue sem painel (nunca trava a produção).
// Sala de redação: as 10 mentes escrevem 1 capa cada para a versão vencedora (uma chamada só). As capas que passam na
// checagem de fatos entram na disputa; o painel de audiência escolhe a melhor entre as do júri e as das mentes.
E.capas = async (c, ctx) => {
  const v = c.top.versoes[c.top.escolha.versao];
  if (v.sala_feita) return;
  const M = ctx.deps.mentes || Mentes;
  // Post estático: a legenda é o corpo do post; a sala precisa lê-la (não há telas). Ensaio/tweet/reportagem: as telas.
  const corpo = c.top.formato === 'estatico'
    ? `O POST (a legenda é o corpo; a capa é a headline da imagem, até 10 palavras):\n${v.legenda}${v.telas[0] ? `\n2º SLIDE: ${v.telas[0].texto}` : ''}`
    : `O CARROSSEL (slides depois da capa):\n${v.telas.map((t, j) => `${j + 2}. ${[t.titulo, t.texto].filter(Boolean).join(' — ')}`).join('\n')}`;
  const usuario = `FATOS VERIFICADOS:\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}\n\nTESE: ${c.top.angulo?.tese || ''}\nCOM QUEM FALAR: ${c.top.angulo?.enviar_para || 'o empreendedor'}\n\n${corpo}\n\nCAPAS QUE JÁ EXISTEM (não repita):\n${v.capas.map((k) => `- ${k.texto}`).join('\n')}`;
  let dados;
  try { ({ dados } = await ctx.ia({ sistema: M.SALA_CAPAS, usuario, maxTokens: 1400, temperatura: 0.8, preferirMelhor: true })); } catch (e) {
    if (e.status === 429 || /\b429\b|rate.?limit|tokens per (day|minute)|\bTP[DM]\b/i.test(String(e.message)) || (c.top.tentativas.capas || 0) < 1) throw e;
    v.sala_feita = true; c.top.mentes = { ...(c.top.mentes || {}), roteiro: v.mente || null, sala: 0, falhou: String(e.message).slice(0, 120) }; return;
  }
  const maxPal = c.top.formato === 'tweet' || c.top.formato === 'ensaio' ? 14 : c.top.formato === 'estatico' ? 10 : 12;
  const ja = new Set(v.capas.map((k) => k.texto.toLowerCase()));
  const novas = (Array.isArray(dados?.capas) ? dados.capas : []).map((k) => ({ texto: String(k?.texto || '').replace(/\s+/g, ' ').trim().slice(0, 160), mecanismo: `mente:${M.porId.has(String(k?.mente)) ? String(k.mente) : 'sala'}` }))
    .filter((k) => k.texto && K.palavras(k.texto) <= maxPal && !ja.has(k.texto.toLowerCase()) && !/\b\d{1,2}\/\d{1,2}\b/.test(k.texto))
    .filter((k) => K.checarRoteiro({ capa: k.texto, telas: v.telas, legenda: '' }, c.top.fatos).problemas.every((p) => !p.startsWith('capa')))
    .filter((k) => !M.AI.vicios(k.texto).length);
  v.capas = [...v.capas, ...novas].slice(0, 22);
  v.sala_feita = true;
  c.top.mentes = { ...(c.top.mentes || {}), roteiro: v.mente || null, sala: novas.length };
};

E.painel = async (c, ctx) => {
  const PN = ctx.deps.painel || require('../painel');
  const cfg = await PN.config();
  if (!cfg.ativo) { c.top.painel = { ativo: false }; return; }
  const personas = await PN.personasAtuais();
  if (!personas?.personas?.length) { c.top.painel = { ativo: false, motivo: 'Painel ainda não montado.' }; return; }
  const v = c.top.versoes[c.top.escolha.versao];
  const dasMentes = v.capas.map((k, i) => (String(k.mecanismo).startsWith('mente:') ? i : -1)).filter((i) => i >= 0);
  const ordem = [...new Set([...(c.top.escolha.capas || []), 0, 1, ...dasMentes])].filter((n) => n < v.capas.length).slice(0, 8);
  const r = await PN.avaliar({ capas: ordem.map((i) => v.capas[i].texto), slides: v.telas.map((t) => [t.titulo, t.texto].filter(Boolean).join(' — ')), legenda: v.legenda, tese: c.top.angulo?.tese || '' }, { ia: ctx.ia, personas });
  if (!r.ok) {
    // Todo roteiro passa pelo painel: cota esgotada (429) espera a cota voltar; outra falha da IA tenta mais uma vez antes de seguir sem a nota.
    if (r.erro_ia && (r.erro_ia.status === 429 || /\b429\b|rate.?limit|tokens per (day|minute)|\bTP[DM]\b/i.test(String(r.erro_ia.message)) || (c.top.tentativas.painel || 0) < 1)) throw r.erro_ia;
    c.top.painel = { ativo: true, falhou: r.motivo }; return;
  }
  c.top.painel = { ativo: true, ...r, capa_indices: ordem };
  if (r.melhor_capa > 0) c.top.escolha.capas = [ordem[r.melhor_capa], ...ordem.filter((_, i) => i !== r.melhor_capa)].slice(0, 2);
  // O painel NÃO barra por padrão: ele escolhe a melhor capa e a nota fica registrada para o placar medir se ela prevê
  // alguma coisa. Motivo (produção, 11/11): barrou 5 de 5 carrosséis com nota 8,1 a 9,1 do júri, com objeções que não
  // batiam com o texto ("fala de grandes corporações" num post sobre IPCA; "memes" onde não havia meme), depois de 12 a
  // 14 chamadas de IA cada. Ele só volta a barrar quando o placar provar que a nota acompanha envios e salvos reais
  // (10+ posts medidos e correlação positiva).
  let soOpina = true;
  try { const cal = ctx.deps.placar !== undefined ? ctx.deps.placar?.calibracao?.painel : (await armazem().config.obter(conta())).meu_placar?.calibracao?.painel; soOpina = !(cal && cal.acerta === true); } catch { /* sem placar: o painel só opina */ }
  if (r.nota < cfg.minimo && soOpina) c.top.painel.so_opina = true;
  if (r.nota < cfg.minimo && !soOpina) {
    const motivo = `O painel de audiência deu ${r.nota.toFixed(1)} (mínimo ${cfg.minimo}). ${r.objecoes.map((o) => `${o.quem}: "${o.texto}"`).join(' · ')}`.slice(0, 380);
    c.top.reprovacoes_painel = (c.top.reprovacoes_painel || 0) + 1;
    if (c.top.reprovacoes_painel > 1) throw Object.assign(erro(motivo, 'ABAIXO_DA_REGUA', 422), { terminal: true, fim: 'abaixo_da_regua' });
    c.top.reescritas = 0;
    c.top.versoes = [{ ...v, checagem: { ok: false, problemas: [motivo] } }];
    return { voltar: 'roteiro' };
  }
  // As capas das mentes não passaram pelo júri: antes de usar uma, um revisor confere se ela afirma só o que os fatos
  // sustentam ("o dobro", "sem limite", ator errado, promessa que o carrossel não entrega). Reprovada, vale a próxima.
  const notaDe = (i) => r.capas[ordem.indexOf(i)] ?? -1;
  const ranking = [...ordem].sort((a, b) => notaDe(b) - notaDe(a));
  const daMente = (i) => String(v.capas[i]?.mecanismo || '').startsWith('mente:');
  const corte = ranking.findIndex((j) => !daMente(j));   // capas de mente que estão acima da melhor capa do júri
  const aConferir = ranking.slice(0, corte < 0 ? ranking.length : corte).slice(0, 3);
  if (aConferir.length) {
    let reprovadas = new Set(aConferir);
    try {
      const { dados } = await ctx.ia({ sistema: P.REVISOR_CAPA, usuario: `FATOS VERIFICADOS:\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}\n\nO CARROSSEL:\n${v.telas.map((t, j) => `${j + 2}. ${[t.titulo, t.texto].filter(Boolean).join(' — ')}`).join('\n')}\n\nCAPAS:\n${aConferir.map((i) => `[${i}] ${v.capas[i].texto}`).join('\n')}`, maxTokens: 500, temperatura: 0.1, preferirMelhor: true });
      const res = Array.isArray(dados?.capas) ? dados.capas : [];
      reprovadas = new Set(aConferir.filter((i) => { const x = res.find((y) => Number(y.indice) === i); return !x || x.ok !== true; }));
      c.top.revisao_capas = res.slice(0, 3).map((x) => ({ indice: Number(x.indice), ok: x.ok === true, motivo: String(x.motivo || '').slice(0, 160) }));
    } catch (e) {
      if (e.status === 429 || /\b429\b|rate.?limit|tokens per (day|minute)|\bTP[DM]\b/i.test(String(e.message))) throw e;
      c.top.revisao_capas = [{ falhou: String(e.message).slice(0, 120) }]; // sem revisão, nenhuma capa de mente é usada
    }
    const ok = ranking.filter((i) => !daMente(i) || (aConferir.includes(i) && !reprovadas.has(i)));
    if (ok.length) c.top.escolha.capas = [...new Set([ok[0], ...ok.slice(1)])].slice(0, 2);
  }
};

// Foto da CAPA, nesta ordem: a PESSOA central (Wikimedia Commons, licença aberta); o LUGAR/instituição brasileira
// (Commons, foto real: plenário do Senado, STF…); a CENA ilustrativa ligada ao assunto (Pexels). Uma foto só, na capa.
E.foto = async (c, ctx) => {
  // Registra qual mente escreveu a capa escolhida e o roteiro (para comparar com o resultado real depois).
  { const v = c.top.versoes[c.top.escolha.versao]; const k = v?.capas?.[c.top.escolha.capas?.[0] ?? 0]; const m = String(k?.mecanismo || '');
    c.top.mentes = { ...(c.top.mentes || {}), roteiro: v?.mente || c.top.mentes?.roteiro || null, capa: m.startsWith('mente:') ? m.slice(6) : (v?.mente ? `${v.mente} (roteiro)` : null) }; }
  // Ensaio: só a palavra, fundo escuro, nenhuma foto.
  if (c.top.formato === 'ensaio') return;
  // Nos formatos tweet e estático a capa nunca é prédio (Congresso, sede de estatal): é gente com emoção. Foto de lugar só na reportagem.
  const lugar = ['tweet', 'estatico'].includes(c.top.formato) ? null : c.top.angulo?.imagem?.lugar_brasil;
  if (lugar && !c.top.foto_lugar_id && !(c.top.protagonista && c.top.angulo?.imagem?.pessoa_central === true)) {
    try {
      const f = await (ctx.deps.fotoDe || require('./fotos').fotoDe)(lugar, { modo: 'lugar' });
      if (f) { await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg'); c.imagens = [...(c.imagens || []).filter((i) => i.id !== f.meta.id), f.meta]; c.top.foto_lugar_id = f.meta.id; }
    } catch { /* segue para a cena */ }
  }
  // Instituição brasileira sem foto real disponível: capa tipográfica. Banco de imagens traria um parlamento estrangeiro.
  if (!lugar && !c.top.foto_lugar_id && !c.top.fotos_cena && (ctx.deps.buscarFoto || process.env.PEXELS_API_KEY)) {
    c.top.fotos_cena = [];
    try {
      const FS = require('../fotosStudio');
      // a busca específica do ângulo primeiro; a genérica só se ela falhar (nunca foto aleatória de "negócios")
      const consultas = [c.top.angulo?.imagem?.busca, ...(c.top.angulo?.imagem?.busca ? [] : FS.consultasPara(c.titulo || '').slice(0, 1))].filter(Boolean);
      for (const q of consultas) {
        if (c.top.fotos_cena.length >= 1) break;
        try {
          const f = await (ctx.deps.buscarFoto || FS.buscarFoto)(q, { excluir: c.top.fotos_cena, pessoa: true });
          await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg');
          c.imagens = [...(c.imagens || []).filter((i) => i.id !== f.meta.id), { ...f.meta, exige_credito: false }];
          c.top.fotos_cena.push(f.meta.id);
        } catch { /* próxima consulta */ }
      }
      c.top.foto_cena_id = c.top.fotos_cena[0] || null;
    } catch { /* sem foto de cena: segue com as formas */ }
  }
  // Foto de pessoa só quando o ângulo confirma que a notícia gira em torno DELA e o nome parece de gente (não "Senado Federal").
  const INSTITUICAO = /\b(senado|c[âa]mara|congresso|supremo|tribunal|minist[ée]rio|governo|banco|prefeitura|assembleia|partido|federal|nacional|empresa|grupo|companhia|ag[êe]ncia)\b/i;
  // Formato tweet: até 3 fotos ilustrativas, uma por tweet que pediu (a frase sozinha costuma ser mais forte).
  if (c.top.formato === 'tweet' && !c.top.fotos_tweet && (ctx.deps.buscarFoto || process.env.PEXELS_API_KEY)) {
    c.top.fotos_tweet = {};
    const v = c.top.versoes?.[c.top.escolha?.versao]; const FS = require('../fotosStudio'); const usadas = [...(c.top.fotos_cena || []), c.top.foto_lugar_id].filter(Boolean); // não repete a foto da capa
    for (const [i, t] of (v?.telas || []).entries()) {
      if (!t.imagem_busca || Object.keys(c.top.fotos_tweet).length >= 3 || ctx.restante() < 12000) continue;
      try {
        const f = await (ctx.deps.buscarFoto || FS.buscarFoto)(t.imagem_busca, { excluir: usadas });
        await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg');
        c.imagens = [...(c.imagens || []).filter((x) => x.id !== f.meta.id), { ...f.meta, exige_credito: false }];
        c.top.fotos_tweet[i] = f.meta.id; usadas.push(f.meta.id);
      } catch { /* este tweet fica só com a frase */ }
    }
  }
  if (!c.top.protagonista || c.top.angulo?.imagem?.pessoa_central !== true || INSTITUICAO.test(c.top.protagonista)) return;
  try {
    const f = await (ctx.deps.fotoDe || require('./fotos').fotoDe)(c.top.protagonista);
    if (!f) { c.top.aviso_foto = `Não achei foto de ${c.top.protagonista} com licença que permita uso: o carrossel sai só com as formas.`; return; }
    await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg');
    c.imagens = [...(c.imagens || []).filter((i) => i.id !== f.meta.id), f.meta];
    c.top.foto_id = f.meta.id;
  } catch (e) { c.top.aviso_foto = `A busca de foto falhou (${String(e.message).slice(0, 80)}): o carrossel sai só com as formas.`; }
};

const MARCA_ATRIBUICAO = /(?<!\p{L})(segundo|de acordo com|conforme|diz|dizem|disse|disseram|afirma|afirmou|declarou|anuncia|anunciou|prev[êe]|estima|promete|prometeu|deve|pode|poder[áa]|aponta|apontam|apontou|avalia|avaliam|alerta|alertam|alertou|calcula|calculam|projeta|projetam|recomenda|recomendam|v[êe]|veem|criticou|critica|criticam|lembrou|lembra|defendeu|defende|defendem|cobrou|cobra|cobram|classificou|classifica|chamou|falou|ressaltou|destacou|explicou|reconheceu|reconhece|argumenta|argumentou|avaliou)(?!\p{L})/iu;
// Monta a versão no modelo de conteúdo (claims, evidências, auditoria) a partir da versão vencedora.
function montarVersao(c) {
  const v = c.top.versoes[c.top.escolha.versao];
  const fonte = c.fonte_principal;
  const data = fonte.publicada_em ? new Date(fonte.publicada_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
  // Sem data na linha de fonte: o portão de publicação trata "29/10/2026" como número sem fonte.
  const linhaFonte = semMateria(c) ? null : `Fonte: ${fonte.veiculo || 'matéria'}`; void data;
  const porIa = new Map(c.top.fatos.map((f) => [f.id_ia, f.id])); const ids = new Set(c.top.fatos.map((f) => f.id));
  const mapa = (arr) => [...new Set((arr || []).map((x) => (ids.has(x) ? x : porIa.get(x))).filter(Boolean))];
  const numsDe = (txt) => M.extrairNumeros(txt).filter(M.exigeOrigem);
  // Cada número liga ao FATO que o traz; declaração/previsão só quando nenhum fato puro tem aquele número (senão a tela
  // passa a exigir "quem disse" à toa).
  const fatosComNumeros = (txt) => [...new Set(numsDe(txt).flatMap((n) => {
    const cand = c.top.fatos.filter((f) => f.valores.some((x) => M.igual(x, n.valor)));
    const puros = cand.filter((f) => !['declaracao', 'previsao'].includes(f.tipo));
    return (puros.length ? puros : cand).map((f) => f.id);
  }))];
  c.claims = c.top.fatos.map((f) => ({ id: f.id, texto: f.texto, tipo: 'fato', natureza: f.tipo === 'declaracao' ? 'declaracao' : f.tipo === 'previsao' ? 'previsao' : 'fato', central: true, estado: 'sustentada', evidencias: [`e_${f.id}`], valores: f.valores.map((x) => ({ valor: x })), risco: 'baixo', revisao: {}, origem: 'top' }));
  c.evidencias = c.top.fatos.map((f) => ({ id: `e_${f.id}`, tipo: 'secundaria', autoridade: 'imprensa', correspondencia: 'integral', relacao: 'sustenta', trecho: f.trecho, origem: proprio(c) ? 'Relato do Pedro' : fonte.veiculo || 'matéria', titulo: fonte.titulo, url: fonte.url, consultada_em: fonte.acessada_em, fonte_principal: true }));
  const capa = v.capas[c.top.escolha.capas[0] ?? 0]?.texto || v.capas[0].texto;
  if (c.top.formato === 'tweet') return montarVersaoTweet(c, v, { capa, fatosComNumeros, mapa, fonte });
  if (c.top.formato === 'estatico') return montarVersaoEstatico(c, v, { capa, fatosComNumeros, mapa, fonte });
  if (c.top.formato === 'ensaio') return montarVersaoEnsaio(c, v, { capa, fatosComNumeros, mapa, fonte });
  const cenas = c.top.fotos_cena || (c.top.foto_cena_id ? [c.top.foto_cena_id] : []);
  const foto = c.top.foto_id || c.top.foto_lugar_id || cenas[0] || null; // capa: pessoa > lugar > cena
  const internas = []; // telas internas sem foto: o layout de texto fica limpo (foto espremida piorava a leitura)
  const telasTexto = v.telas.map((t, i) => (!['leitura', 'prova'].includes(t.papel) && !['rep_comparacao', 'rep_numero'].includes(t.layout) ? i : -1)).filter((i) => i >= 0);
  const fotoDaTela = new Map(internas.map((id, j) => [telasTexto[j], id]).filter(([i]) => i !== undefined));
  const cena = internas[0] || null;
  const slides = [{ id: 's1', funcao: 'capa', layout: 'rep_capa', tema_visual: 'reportagem', texto: capa, titulo: null, subtitulo: null, claim_ids: fatosComNumeros(capa), ...(foto ? { imagem_id: foto } : {}), dados: null }];
  const opinioes = [];
  v.telas.forEach((t, i) => {
    const funcao = { gap: 'contexto', prova: 'prova', contradicao: 'consequencia', consequencia: 'consequencia', leitura: 'opiniao' }[t.papel] || 'explicacao';
    const texto = [t.texto, t.apoio, t.destaque].filter(Boolean).join(' ');
    let claim_ids = mapa(t.fatos); for (const id of fatosComNumeros(`${t.titulo || ''} ${texto} ${K.textosDaTela({ dados: t.dados })}`)) if (!claim_ids.includes(id)) claim_ids.push(id);
    if (t.papel === 'leitura') { const oid = `o${opinioes.length + 1}`; opinioes.push({ id: oid, texto: [t.titulo, t.texto, t.destaque].filter(Boolean).join(' ').slice(0, 400), tipo: 'opiniao', natureza: 'opiniao', central: false, estado: 'nao_verificada', premissas: claim_ids, evidencias: [], risco: 'baixo', origem: 'top', revisao: {} }); claim_ids = [oid]; }
    const prova = ['rep_comparacao', 'rep_numero'].includes(t.layout);
    // Declaração/previsão apresentada na tela precisa dizer quem disse (portão "Falta a atribuição").
    const aAtribuir = c.top.fatos.find((f) => claim_ids.includes(f.id) && ['declaracao', 'previsao'].includes(f.tipo));
    if (aAtribuir && !MARCA_ATRIBUICAO.test(`${t.titulo || ''} ${texto}`)) t.texto = `Segundo ${aAtribuir.quem || fonte.veiculo || 'a reportagem'}: ${t.texto || ''}`.trim();
    slides.push({ id: `s${i + 2}`, funcao, layout: t.layout, tema_visual: 'reportagem', titulo: t.titulo, texto: t.texto || '', destaque: t.destaque, apoio: t.apoio, dados: t.dados ? { ...t.dados, ...(t.destaque || t.apoio ? { extra: { destaque: t.destaque, apoio: t.apoio } } : {}) } : (t.destaque || t.apoio ? { extra: { destaque: t.destaque, apoio: t.apoio } } : null), fonte_linha: prova ? linhaFonte : null, fundo: t.papel === 'contradicao' ? 'marinho' : null, claim_ids, ...(fotoDaTela.has(i) ? { imagem_id: fotoDaTela.get(i) } : {}) });
  });
  c.claims.push(...opinioes);
  void cena; const creditos = (c.imagens || []).filter((i) => [foto, ...internas].includes(i.id) && i.exige_credito).map((i) => `Foto: ${i.autor} (${i.licenca}), via Wikimedia Commons.`);
  // A data fica na tela de prova; na legenda só o veículo (data solta na legenda vira "número sem fonte" nos portões).
  // Legenda: só frases cujos números estão nos fatos (com a mesma régua do portão, que não perdoa data solta).
  const fraseOk = (f) => numsDe(f).every((n) => c.top.fatos.some((x) => x.valores.some((y) => M.igual(y, n.valor))));
  const corpo = String(v.legenda || '').split(/(?<=[.!?])\s+/).filter(fraseOk).join(' ').trim();
  const legenda = [corpo, (semMateria(c) ? '' : `Fonte: ${fonte.veiculo || 'matéria'} (informações segundo a reportagem).`), ...creditos].filter(Boolean).join('\n\n').slice(0, 2000);
  const motivo = (v.cta_motivo || 'se você também cobra resultado').replace(/^[,:\s]+/, '').replace(/[.!]+$/, '');
  const cta = `Segue o @pedro_destrava ${motivo}.`.slice(0, 160);
  // Fechamento no desenho da peça de referência: frase de impacto, posição, "Eu comecei o Pedro Destrava por isso." e a faixa de chamada.
  // Se houver a arte original aprovada (upload:encerramento), ela substitui este slide no desenho (renderizarSlide).
  slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'encerramento', tema_visual: 'reportagem', titulo: v.fechamento?.titulo || 'O resultado está nos números.', texto: v.fechamento?.texto || '', destaque: 'Eu comecei o Pedro Destrava por isso.', cta: 'Segue o @pedro_destrava', cta_apoio: motivo, claim_ids: fatosComNumeros(`${v.fechamento?.titulo || ''} ${v.fechamento?.texto || ''}`), dados: { extra: { destaque: 'Eu comecei o Pedro Destrava por isso.', cta_apoio: motivo } } });
  return { capas: v.capas.map((k, j) => ({ id: `k${j + 1}`, foco: k.mecanismo || 'gancho', texto: k.texto, claim_ids: fatosComNumeros(k.texto) })), capa_escolhida: 'k' + ((c.top.escolha.capas[0] ?? 0) + 1), estrutura: 'acontecimento', slides, legenda, legenda_claim_ids: fatosComNumeros(legenda), cta, hashtags: v.hashtags };
}

// Formato tweet: cada tela vira um "tweet" (texto só), capa = 1º tweet (com a foto da capa, se houver), último = fechamento.
function montarVersaoTweet(c, v, { capa, fatosComNumeros, mapa, fonte }) {
  const fotoCapa = c.top.foto_id || c.top.foto_lugar_id || (c.top.fotos_cena || [])[0] || null;
  const slides = [{ id: 's1', funcao: 'capa', layout: 'tweet', tema_visual: 'tweet', texto: capa, titulo: null, claim_ids: fatosComNumeros(capa), ...(fotoCapa ? { imagem_id: fotoCapa } : {}), dados: null }];
  const opinioes = [];
  v.telas.forEach((t, i) => {
    const funcao = { gap: 'contexto', prova: 'prova', contradicao: 'consequencia', consequencia: 'consequencia', leitura: 'opiniao' }[t.papel] || 'explicacao';
    let claim_ids = mapa(t.fatos); for (const id of fatosComNumeros(t.texto || '')) if (!claim_ids.includes(id)) claim_ids.push(id);
    if (t.papel === 'leitura') { const oid = `o${opinioes.length + 1}`; opinioes.push({ id: oid, texto: String(t.texto || '').slice(0, 400), tipo: 'opiniao', natureza: 'opiniao', central: false, estado: 'nao_verificada', premissas: claim_ids, evidencias: [], risco: 'baixo', origem: 'top', revisao: {} }); claim_ids = [oid]; }
    // Declaração/previsão só fica ligada ao tweet que de fato a cita (traz o número do fato) ou já atribui quem disse. Tweet de
    // posição ou de chamada ("manda pra seu sócio…") não vira "Fulano disse que…": o vínculo é solto, sem mexer no texto.
    const citaNumero = (f) => fatosComNumeros(t.texto || '').includes(f.id);
    claim_ids = claim_ids.filter((id) => { const f = c.top.fatos.find((x) => x.id === id); return !f || !['declaracao', 'previsao'].includes(f.tipo) || citaNumero(f) || MARCA_ATRIBUICAO.test(t.texto || ''); });
    const aAtribuir = c.top.fatos.find((f) => claim_ids.includes(f.id) && ['declaracao', 'previsao'].includes(f.tipo));
    if (aAtribuir && !MARCA_ATRIBUICAO.test(t.texto || '')) t.texto = `${aAtribuir.quem || fonte.veiculo || 'A reportagem'} disse que ${String(t.texto || '').replace(/^\p{Lu}/u, (m) => m.toLowerCase())}`;
    const foto = c.top.fotos_tweet?.[i] || null;
    slides.push({ id: `s${i + 2}`, funcao, layout: 'tweet', tema_visual: 'tweet', titulo: null, texto: t.texto || '', claim_ids, ...(foto ? { imagem_id: foto } : {}), dados: null });
  });
  c.claims.push(...opinioes);
  const numsDe = (txt) => M.extrairNumeros(txt).filter(M.exigeOrigem);
  const fraseOk = (f) => numsDe(f).every((n) => c.top.fatos.some((x) => x.valores.some((y) => M.igual(y, n.valor))));
  const corpo = String(v.legenda || '').split(/(?<=[.!?])\s+/).filter(fraseOk).join(' ').trim();
  const legenda = [corpo, (semMateria(c) ? '' : `Fonte: ${fonte.veiculo || 'matéria'} (informações segundo a reportagem).`)].filter(Boolean).join('\n\n').slice(0, 2000);
  const motivo = (v.cta_motivo || 'se você também cobra resultado').replace(/^[,:\s]+/, '').replace(/[.!]+$/, '');
  const cta = `Segue o @pedro_destrava ${motivo}.`.slice(0, 160);
  slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'tweet', tema_visual: 'tweet', titulo: v.fechamento?.titulo || '', texto: v.fechamento?.texto || '', cta: chamadaFinal(c), cta_apoio: `Segue o @pedro_destrava ${motivo}.`, claim_ids: fatosComNumeros(`${v.fechamento?.titulo || ''} ${v.fechamento?.texto || ''}`), dados: null });
  return { capas: v.capas.map((k, j) => ({ id: `k${j + 1}`, foco: k.mecanismo || 'gancho', texto: k.texto, claim_ids: fatosComNumeros(k.texto) })), capa_escolhida: 'k' + ((c.top.escolha.capas[0] ?? 0) + 1), estrutura: 'sequencia', slides, legenda, legenda_claim_ids: fatosComNumeros(legenda), cta, hashtags: v.hashtags };
}

// Legenda só com frases cujos números estão nos fatos; preserva os parágrafos (post estático) e acrescenta a fonte no fim.
function legendaComFonte(c, texto, fonte, { paragrafos = false, fotos = [] } = {}) {
  const numsDe = (txt) => M.extrairNumeros(txt).filter(M.exigeOrigem);
  const fraseOk = (f) => numsDe(f).every((n) => c.top.fatos.some((x) => x.valores.some((y) => M.igual(y, n.valor))));
  const limpa = (t) => String(t || '').split(/(?<=[.!?])\s+/).filter(fraseOk).join(' ').trim();
  const corpo = paragrafos ? K.paragrafosDe(texto).map(limpa).filter(Boolean).join('\n\n') : limpa(texto);
  // foto do Wikimedia Commons com licença que exige crédito: o crédito vai na legenda
  const creditos = (c.imagens || []).filter((i) => fotos.includes(i.id) && i.exige_credito).map((i) => `Foto: ${i.autor} (${i.licenca}), via Wikimedia Commons.`);
  return [corpo, (semMateria(c) ? '' : `Fonte: ${fonte.veiculo || 'matéria'} (informações segundo a reportagem).`), ...creditos].filter(Boolean).join('\n\n').slice(0, 2000);
}

// Post estático: 1 slide (capa do tema tweet: headline + foto de gente) ou 2 (capa + "virar" com a prova/leitura e a chamada).
// A legenda longa é o corpo do post. Com 1 slide o publicador manda IMAGE; com 2, carrossel.
function montarVersaoEstatico(c, v, { capa, fatosComNumeros, mapa, fonte }) {
  const fotoCapa = c.top.foto_id || c.top.foto_lugar_id || (c.top.fotos_cena || [])[0] || null;
  const slides = [{ id: 's1', funcao: 'capa', layout: 'tweet', tema_visual: 'tweet', texto: capa, titulo: null, claim_ids: fatosComNumeros(capa), ...(fotoCapa ? { imagem_id: fotoCapa } : {}), dados: null }];
  const motivo = (v.cta_motivo || 'se você também cobra resultado').replace(/^[,:\s]+/, '').replace(/[.!]+$/, '');
  const t = v.telas[0];
  if (t) {
    let claim_ids = mapa(t.fatos); for (const id of fatosComNumeros(t.texto || '')) if (!claim_ids.includes(id)) claim_ids.push(id);
    if (t.papel === 'leitura') { const oid = 'o1'; c.claims.push({ id: oid, texto: String(t.texto || '').slice(0, 400), tipo: 'opiniao', natureza: 'opiniao', central: false, estado: 'nao_verificada', premissas: claim_ids, evidencias: [], risco: 'baixo', origem: 'top', revisao: {} }); claim_ids = [oid]; }
    const cita = (f) => fatosComNumeros(t.texto || '').includes(f.id);
    claim_ids = claim_ids.filter((id) => { const f = c.top.fatos.find((x) => x.id === id); return !f || !['declaracao', 'previsao'].includes(f.tipo) || cita(f) || MARCA_ATRIBUICAO.test(t.texto || ''); });
    const aAtribuir = c.top.fatos.find((f) => claim_ids.includes(f.id) && ['declaracao', 'previsao'].includes(f.tipo));
    if (aAtribuir && !MARCA_ATRIBUICAO.test(t.texto || '')) t.texto = `${aAtribuir.quem || fonte.veiculo || 'A reportagem'} disse que ${String(t.texto || '').replace(/^\p{Lu}/u, (m) => m.toLowerCase())}`;
    // o 2º slide fecha o post: traz a prova/leitura e a chamada (manda pra… / segue)
    slides.push({ id: 's2', funcao: t.papel === 'leitura' ? 'opiniao' : 'prova', layout: 'tweet', tema_visual: 'tweet', titulo: null, texto: t.texto || '', cta: chamadaFinal(c), cta_apoio: `Segue o @pedro_destrava ${motivo}.`, claim_ids, dados: null });
  }
  const legenda = legendaComFonte(c, v.legenda, fonte, { paragrafos: true, fotos: [fotoCapa].filter(Boolean) });
  const cta = `Segue o @pedro_destrava ${motivo}.`.slice(0, 160);
  return { formato: 'estatico', capas: v.capas.map((k, j) => ({ id: `k${j + 1}`, foco: k.mecanismo || 'gancho', texto: k.texto, claim_ids: fatosComNumeros(k.texto) })), capa_escolhida: 'k' + ((c.top.escolha.capas[0] ?? 0) + 1), estrutura: 'post_unico', slides, legenda, legenda_claim_ids: fatosComNumeros(legenda), cta, hashtags: v.hashtags };
}

// Ensaio: 1º slide = abertura (capa, maior) + 1º bloco; blocos seguintes um por slide; último = frase de ouro em destaque + chamada.
function montarVersaoEnsaio(c, v, { capa, fatosComNumeros, mapa, fonte }) {
  const slides = []; const opinioes = [];
  v.telas.forEach((t, i) => {
    const funcao = { gap: 'contexto', prova: 'prova', contradicao: 'consequencia', consequencia: 'consequencia', leitura: 'opiniao' }[t.papel] || 'explicacao';
    let claim_ids = mapa(t.fatos); for (const id of fatosComNumeros(t.texto || '')) if (!claim_ids.includes(id)) claim_ids.push(id);
    if (t.papel === 'leitura') { const oid = `o${opinioes.length + 1}`; opinioes.push({ id: oid, texto: String(t.texto || '').replace(/\s+/g, ' ').slice(0, 400), tipo: 'opiniao', natureza: 'opiniao', central: false, estado: 'nao_verificada', premissas: claim_ids, evidencias: [], risco: 'baixo', origem: 'top', revisao: {} }); claim_ids = [oid]; }
    const cita = (f) => fatosComNumeros(t.texto || '').includes(f.id);
    claim_ids = claim_ids.filter((id) => { const f = c.top.fatos.find((x) => x.id === id); return !f || !['declaracao', 'previsao'].includes(f.tipo) || cita(f) || MARCA_ATRIBUICAO.test(t.texto || ''); });
    const aAtribuir = c.top.fatos.find((f) => claim_ids.includes(f.id) && ['declaracao', 'previsao'].includes(f.tipo));
    if (aAtribuir && !MARCA_ATRIBUICAO.test(t.texto || '')) t.texto = `${aAtribuir.quem || fonte.veiculo || 'A reportagem'} disse que ${String(t.texto || '').replace(/^\p{Lu}/u, (m) => m.toLowerCase())}`;
    if (i === 0) { for (const id of fatosComNumeros(capa)) if (!claim_ids.includes(id)) claim_ids.push(id); slides.push({ id: 's1', funcao: 'capa', layout: 'ensaio', tema_visual: 'ensaio', titulo: capa, texto: t.texto || '', claim_ids, dados: null }); return; }
    slides.push({ id: `s${i + 1}`, funcao, layout: 'ensaio', tema_visual: 'ensaio', titulo: null, texto: t.texto || '', claim_ids, dados: null });
  });
  c.claims.push(...opinioes);
  const legenda = legendaComFonte(c, v.legenda, fonte);
  const motivo = (v.cta_motivo || 'se você também cobra resultado').replace(/^[,:\s]+/, '').replace(/[.!]+$/, '');
  const cta = `Segue o @pedro_destrava ${motivo}.`.slice(0, 160);
  slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'ensaio', tema_visual: 'ensaio', titulo: v.fechamento?.titulo || '', texto: v.fechamento?.texto || '', cta: chamadaFinal(c), cta_apoio: cta, claim_ids: fatosComNumeros(`${v.fechamento?.titulo || ''} ${v.fechamento?.texto || ''}`), dados: null });
  return { formato: 'ensaio', capas: v.capas.map((k, j) => ({ id: `k${j + 1}`, foco: k.mecanismo || 'gancho', texto: k.texto, claim_ids: fatosComNumeros(k.texto) })), capa_escolhida: 'k' + ((c.top.escolha.capas[0] ?? 0) + 1), estrutura: 'ensaio', slides, legenda, legenda_claim_ids: fatosComNumeros(legenda), cta, hashtags: v.hashtags };
}

function auditar(c) {
  const v = M.versaoAtiva(c);
  c.auditoria_textos = {};
  for (const s of v.slides) {
    const premissas = (s.claim_ids || []).flatMap((id) => { const k = c.claims.find((q) => q.id === id); return k?.tipo === 'opiniao' ? (k.premissas || []).map((p) => ({ texto: c.claims.find((q) => q.id === p)?.texto || '', claim_id: p })) : [{ texto: k?.texto || '', claim_id: id }]; });
    c.auditoria_textos[s.id] = { slide_id: s.id, hash_texto: M.hash(M.textoParaAuditoria(s)), premissas, conferido_por: 'codigo:top', em: agoraISO() };
  }
  c.auditoria_textos.legenda = { slide_id: 'legenda', hash_texto: M.hash(v.legenda), premissas: (v.legenda_claim_ids || []).map((id) => ({ texto: c.claims.find((q) => q.id === id)?.texto || '', claim_id: id })), conferido_por: 'codigo:top', em: agoraISO() };
}

E.arte = async (c, ctx) => {
  if (!c.top.versao_montada) {
    const dados = montarVersao(c);
    M.criarVersao(c, dados, { quem: 'sistema', rotulo: `top: nota ${c.top.escolha.nota.toFixed(1)}` });
    auditar(c); c.top.versao_montada = M.versaoAtiva(c).id; c.top.arte_indice = 0;
    c.arte = c.arte || { renders: [] }; c.arte.renders = c.arte.renders || [];
  }
  const v = M.versaoAtiva(c); const arte = ctx.deps.arte || require('../arte');
  const enc = (await armazem().arquivos.obter(conta(), 'upload:encerramento'))?.dados || null;
  while (c.top.arte_indice < v.slides.length && ctx.restante() > 9000) {
    const s = v.slides[c.top.arte_indice];
    if (c.arte.renders.some((q) => q.versao === v.id && q.slide_id === s.id && q.texto_hash === M.hashRender(s))) { c.top.arte_indice += 1; continue; }
    const imagem = s.imagem_id ? (await armazem().arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados : null;
    const r = await arte.renderizarSlide(s, { indice: c.top.arte_indice + 1, total: v.slides.length, imagem, arquivoEncerramento: s.layout === 'encerramento' ? enc : null });
    const key = `render:${c.id}:${v.id}:${s.id}:${M.hashRender(s)}`;
    // Prévia em JPEG (~5× menor que PNG): a publicação redesenha o slide a partir do texto, a prévia é só para ver no app.
    const previa = await require('sharp')(r.png).flatten({ background: '#FAF7F0' }).jpeg({ quality: 84 }).toBuffer().catch(() => null);
    await armazem().arquivos.salvar(conta(), key, previa || r.png, previa ? 'image/jpeg' : 'image/png');
    c.arte.renders = [...c.arte.renders.filter((q) => q.versao !== v.id || q.slide_id !== s.id), { slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), blob_key: key, indice: c.top.arte_indice + 1, total: v.slides.length, metrics: r.metrics, elementos: r.metrics.elementos || [] }];
    c.top.arte_indice += 1;
  }
  if (c.top.arte_indice < v.slides.length) return { concluida: false };
  const naoCabe = c.arte.renders.filter((r) => r.versao === v.id && r.metrics?.cabe === false);
  // Texto que não cabe: uma tentativa de encurtar sem IA (fica a 1ª frase, sai o apoio) e desenhar de novo esses slides.
  if (naoCabe.length && !c.top.encurtado) {
    c.top.encurtado = true;
    const dados = JSON.parse(JSON.stringify(v)); const ids = new Set(naoCabe.map((r) => r.slide_id));
    for (const s of dados.slides) {
      if (!ids.has(s.id)) continue;
      // Número/comparação grande demais para o desenho: vira manchete (o número vai para o título).
      if (s.layout === 'rep_numero' && s.dados?.numero) { s.titulo = `${s.dados.numero.valor} ${s.dados.numero.rotulo || ''}`.trim(); s.layout = 'rep_manchete'; s.dados = null; s.texto = [s.texto, s.apoio].filter(Boolean).join(' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' '); s.apoio = null; continue; }
      else if (s.layout === 'rep_comparacao' && s.dados?.esquerda && s.dados?.direita) { const e = s.dados.esquerda; const d = s.dados.direita; s.texto = `${e.rotulo}: ${e.valor} ${e.unidade || ''}. ${d.rotulo}: ${d.valor} ${d.unidade || ''}.`.replace(/\s+/g, ' ').trim(); s.layout = 'rep_manchete'; s.dados = null; continue; }
      // Ensaio: sai o último parágrafo do bloco (cortar na 1ª frase destruiria o texto corrido).
      if (s.layout === 'ensaio') { const ps = K.paragrafosDe(s.texto); s.texto = (ps.length > 1 ? ps.slice(0, -1) : ps).join('\n\n'); if (s.funcao === 'encerramento') s.texto = ''; continue; }
      const primeira = String(s.texto || '').split(/(?<=[.!?])\s+/)[0] || '';
      s.texto = primeira; s.apoio = null; if (s.dados?.extra) s.dados.extra.apoio = null;
      if (s.layout === 'encerramento') { s.texto = ''; }
    }
    M.criarVersao(c, dados, { quem: 'sistema', rotulo: 'top: texto encurtado para caber' });
    auditar(c); const nova = M.versaoAtiva(c);
    // os slides que já cabiam aproveitam o desenho (mesmo texto → mesma chave de render)
    c.arte.renders = [...c.arte.renders, ...c.arte.renders.filter((r) => r.versao === v.id && !ids.has(r.slide_id)).map((r) => ({ ...r, versao: nova.id }))];
    c.top.versao_montada = nova.id; c.top.arte_indice = 0;
    return { concluida: false };
  }
  if (naoCabe.length) c.top.aviso_arte = `${naoCabe.length} slide(s) com texto acima do tamanho legível: encurte antes de aprovar.`;
};

// Os mesmos portões da tela de aprovação (fatos ligados à fonte, atribuição, texto que cabe…). Carrossel que não passa
// não vai para "Para aprovar": o Pedro só vê o que dá para publicar com um toque.
function portoes(c) {
  const G = require('../../../static/qualityGates');
  const cl = M.clone(c); (cl.claims || []).forEach((k) => { k.revisao = { ...(k.revisao || {}), confirmada_por_pedro: true }; });
  return G.avaliar(cl, { conta: M.ACCOUNT_PIN }).bloqueios;
}
const motivoPortoes = (bl) => `Não passou nos portões de publicação: ${bl.slice(0, 2).map((b) => `${b.titulo}${b.detalhe ? ` (${String(b.detalhe).slice(0, 140)})` : ''}`).join(' · ')}`;

E.fim = async (c) => {
  const bl = portoes(c);
  if (bl.length) throw Object.assign(erro(motivoPortoes(bl), 'PORTOES', 422), { terminal: true, fim: 'abaixo_da_regua' });
  c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: agoraISO(), origem: 'top' };
  c.top.estado = 'concluida'; c.top.concluido_em = agoraISO();
  M.registrar(c, 'sistema', 'pronto', `Carrossel pronto (nota do júri ${c.top.escolha.nota.toFixed(1)}): confira e aprove.`);
  // No piloto/monitor o aviso é um só por janela de aprovação (piloto.js); só a criação manual avisa na hora.
  return { notificar: !['piloto', 'monitor'].includes(c.top.origem) };
};

// ── Motor ───────────────────────────────────────────────────────────────────────
async function passo(id, { deps = {}, orcamentoMs = 44000 } = {}) {
  const a = armazem(); const inicio = Date.now();
  let reg = await a.conteudos.obter(conta(), id); if (!reg || !reg.doc.top) throw erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  let c = reg.doc; let rev = reg.rev;
  if (c.top.estado !== 'em_andamento') return { conteudo: c, concluido: true };
  if (c.top.adiar_ate && Date.parse(c.top.adiar_ate) > Date.now()) return { conteudo: c, ocupado: true, adiado: true, concluido: false };
  if (c.top.lease_ate && Date.parse(c.top.lease_ate) > Date.now()) return { conteudo: c, ocupado: true, concluido: false };
  c.top.lease_ate = new Date(Date.now() + LEASE_MS).toISOString();
  try { rev = (await a.conteudos.salvar(conta(), id, c, rev)).rev; } catch (e) { if (e.code === 'CONFLITO') return { conteudo: c, ocupado: true, concluido: false }; throw e; }
  const ctx = {
    deps, restante: () => orcamentoMs - (Date.now() - inicio),
    ia: async (args) => {
      const pedir = deps.pedirJson || llmJson.pedirJson;
      let resultado;
      if (deps.pedirJson) resultado = await pedir(args);
      else { const r = await llmJson.comConsumo(() => llmJson.comPrazo(Math.max(12000, ctx.restante() - 2000), () => pedir(args))); c.top.chamadas_ia = (c.top.chamadas_ia || 0) + (r.consumo?.chamadas?.length || 0); resultado = r.resultado; }
      // Registra qual IA escreveu cada etapa (para o Pedro saber se foi a premium) …
      c.top.ia = [...(c.top.ia || []).slice(-11), { etapa: c.top.etapa, provider: resultado?.llm?.provider || null, model: resultado?.llm?.model || null }];
      // … e, com a premium ligada, nunca escreve ângulo/roteiro/júri com modelo gratuito: espera a premium voltar.
      const LLM = require('../llm');
      const forte = deps.modeloForte || LLM.modeloForte;
      if (args.preferirMelhor && (deps.premiumLigado ? deps.premiumLigado() : (!deps.pedirJson && LLM.premiumLigado())) && !forte(resultado?.llm?.model)) {
        const ue = (deps.ultimoErro || LLM.ultimoErro)('openai'); const semCredito = process.env.IA_OPENAI === '1' && !!process.env.OPENAI_API_KEY && /credit|insufficient_quota|billing/i.test(`${ue?.code || ''} ${ue?.mensagem || ''}`);
        throw Object.assign(new Error(semCredito ? 'A OpenAI está sem créditos e nenhum outro modelo forte respondeu. O piloto espera para não escrever com modelo fraco.' : `Nenhum modelo forte disponível agora (${resultado?.llm?.provider || '?'}/${resultado?.llm?.model || '?'} é fraco); espero em vez de escrever raso.`), { status: 429, code: 'IA_PREMIUM', esperar_min: semCredito ? 60 : 15, sem_credito: semCredito });
      }
      return resultado;
    },
  };
  const gravar = async () => { c.updated_at = agoraISO(); c.top.lease_ate = new Date(Date.now() + LEASE_MS).toISOString(); rev = (await a.conteudos.salvar(conta(), id, c, rev)).rev; };
  let notificar = false;
  while (c.top.estado === 'em_andamento' && ctx.restante() > 9000) {
    const etapa = c.top.etapa;
    try {
      const r = (await E[etapa](c, ctx)) || {};
      if (r.concluida === false) { await gravar(); break; }
      if (r.notificar) notificar = true;
      c.top.tentativas[etapa] = 0;
      c.top.etapa = r.voltar || ETAPAS[ETAPAS.indexOf(etapa) + 1] || 'fim';
      if (etapa === 'fim') break;
      await gravar();
    } catch (e) {
      if (e.code === 'CONFLITO') return { conteudo: c, ocupado: true, concluido: false };
      // Cota da IA esgotada (429): não é defeito do carrossel. Espera a cota voltar em vez de descartar.
      if (e.status === 429 || /\b429\b|rate.?limit|tokens per (day|minute)|\bTP[DM]\b/i.test(String(e.message))) {
        const dia = /per day|\bTPD\b/i.test(String(e.message)) || e.code === 'IA_PREMIUM';
        // Espera longa (1 h) só quando TODOS os provedores fortes estão sem cota/crédito; se algum só oscilou (503, timeout),
        // volta em 10 min.
        const LLMx = require('../llm'); const fortes = (deps.provedoresFortes || LLMx.provedoresFortes)();
        const semCota = (n) => { const u = (deps.ultimoErro || LLMx.ultimoErro)(n); return u && u.status === 429; };
        const todosSemCota = fortes.length === 0 || fortes.every(semCota);
        const minutos = e.esperar_min && e.sem_credito ? (todosSemCota ? 60 : 10) : dia ? (todosSemCota ? 60 : 10) : 2;
        c.top.adiar_ate = new Date(Date.now() + minutos * 60000).toISOString(); c.top.cota_dia = dia && todosSemCota; c.top.sem_credito = !!e.sem_credito && todosSemCota;
        c.top.erros.push({ etapa, em: agoraISO(), mensagem: String(e.message).slice(0, 240), codigo: 'COTA_IA', tentativa: 0 });
        await gravar(); break;
      }
      const n = (c.top.tentativas[etapa] = (c.top.tentativas[etapa] || 0) + 1);
      c.top.erros.push({ etapa, em: agoraISO(), mensagem: String(e.message).slice(0, 240), codigo: e.code || null, tentativa: n });
      if (e.terminal || e.code === 'SEM_IA' || n >= MAX_TENTATIVAS) {
        c.top.estado = e.fim || 'erro'; c.top.motivo = String(e.message).slice(0, 300);
        c.status = 'arquivado'; M.registrar(c, 'sistema', 'top_' + c.top.estado, c.top.motivo);
        // descartado: as prévias não servem para nada e ocupam o banco
        const chaves = (c.arte?.renders || []).map((r) => r.blob_key).filter(Boolean);
        if (chaves.length && a.arquivos.apagar) { await a.arquivos.apagar(conta(), chaves).catch(() => {}); c.arte.renders = []; }
      }
      await gravar(); break;
    }
  }
  try { c.top.lease_ate = null; rev = (await a.conteudos.salvar(conta(), id, c, rev)).rev; } catch { /* lease expira */ }
  if (notificar) await require('../push').notificar({ corpo: `Carrossel pronto para aprovar: ${String(c.titulo).slice(0, 90)}`, tag: `top-${c.id}` }).catch(() => {});
  return { conteudo: c, concluido: c.top.estado !== 'em_andamento' };
}

async function executarTudo(id, { deps = {}, maxMs = 10 * 60000 } = {}) {
  const t0 = Date.now(); let r;
  do { r = await passo(id, { deps }); if (r.concluido) break; if (r.ocupado) await new Promise((x) => setTimeout(x, 500)); } while (Date.now() - t0 < maxMs);
  return r;
}

function resumo(c) {
  const t = c.top || {};
  return { id: c.id, titulo: c.titulo, formato: t.formato || null, estado: t.estado, etapa: t.etapa, rotulo: ROTULO[t.etapa] || t.etapa, motivo: t.motivo || null, nota: t.escolha?.nota ?? null, gatilhos: t.angulo?.gatilhos || null, tese: t.angulo?.tese || null, fatos: (t.fatos || []).length, fatos_descartados: (t.fatos_descartados || []).length, protagonista: t.protagonista || null, aviso_foto: t.aviso_foto || null, aviso_arte: t.aviso_arte || null, chamadas_ia: t.chamadas_ia || 0, erros: (t.erros || []).slice(-3) };
}

// Conserta um carrossel pronto cujas afirmações foram trocadas por fora (ex.: a preparação antiga rodou nele): recompõe
// afirmações, evidências e auditoria a partir dos fatos verificados. A versão (slides, textos, arte) não muda.
async function reparar(id) {
  const a = armazem(); const reg = await a.conteudos.obter(conta(), id);
  if (!reg?.doc?.top) throw erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const c = reg.doc; if (c.top.estado !== 'concluida') throw erro('Só dá para consertar carrossel pronto.', 'TOP', 409);
  montarVersao(c); auditar(c);
  if (!['aprovado', 'publicado', 'arquivado'].includes(c.status)) { c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: c.top.concluido_em || agoraISO(), origem: 'top' }; }
  M.registrar(c, 'sistema', 'reparo', 'Afirmações e fontes recompostas a partir dos fatos verificados.');
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  return c;
}

// Redesenha as prévias que sumiram do armazém (a versão não muda; a publicação já redesenha sozinha).
async function refazerPrevias(id, { deps = {}, forcar = false } = {}) {
  const a = armazem(); const reg = await a.conteudos.obter(conta(), id);
  if (!reg?.doc) throw erro('Conteúdo não encontrado.', 'NAO_ENCONTRADO', 404);
  const c = reg.doc; const v = M.versaoAtiva(c); const arte = deps.arte || require('../arte'); let refeitas = 0;
  const enc = (await a.arquivos.obter(conta(), 'upload:encerramento'))?.dados || null;
  for (const [i, s] of v.slides.entries()) {
    const r0 = (c.arte?.renders || []).find((r) => r.versao === v.id && r.slide_id === s.id);
    if (!forcar && r0?.blob_key && await a.arquivos.obter(conta(), r0.blob_key)) continue; // forcar: refaz com o desenho atual (ex.: capa nova)
    const imagem = s.imagem_id ? (await a.arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados : null;
    const r = await arte.renderizarSlide(s, { indice: i + 1, total: v.slides.length, imagem: imagem ? Buffer.from(imagem) : null, arquivoEncerramento: s.layout === 'encerramento' && enc ? Buffer.from(enc) : null });
    const key = `render:${c.id}:${v.id}:${s.id}:${M.hashRender(s)}`;
    const previa = await require('sharp')(r.png).flatten({ background: '#FAF7F0' }).jpeg({ quality: 84 }).toBuffer().catch(() => null);
    await a.arquivos.salvar(conta(), key, previa || r.png, previa ? 'image/jpeg' : 'image/png');
    c.arte.renders = [...(c.arte.renders || []).filter((q) => !(q.versao === v.id && q.slide_id === s.id)), { slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), blob_key: key, indice: i + 1, total: v.slides.length, metrics: r.metrics, elementos: r.metrics.elementos || [] }];
    refeitas++;
  }
  if (refeitas) await a.conteudos.salvar(conta(), id, c, reg.rev);
  return { id, refeitas };
}

// Confere de novo um carrossel já pronto: se não passa nos portões, sai de "Para aprovar" (arquivado, abaixo da régua).
async function revalidar(id) {
  const a = armazem(); const reg = await a.conteudos.obter(conta(), id);
  if (!reg?.doc?.top) throw erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const c = reg.doc; if (c.top.estado !== 'concluida' || ['aprovado', 'publicado'].includes(c.status)) return { conteudo: c, bloqueios: [] };
  const bl = portoes(c); if (!bl.length) return { conteudo: c, bloqueios: [] };
  c.top.estado = 'abaixo_da_regua'; c.top.motivo = motivoPortoes(bl); c.status = 'arquivado'; c.studio = { ...(c.studio || {}), estado: 'descartado', job: null }; delete c.studio.erro;
  M.registrar(c, 'sistema', 'top_abaixo_da_regua', c.top.motivo);
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  return { conteudo: c, bloqueios: bl };
}

module.exports = { PROPRIOS, MODOS, chamadaFinal, refazerPrevias, revalidar, portoes, reparar, criar, passo, executarTudo, resumo, montarVersao, auditar, normalizarRoteiro, ETAPAS, ROTULO, REGUA, FORMATOS, regua, hashEntrada: (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10) };
