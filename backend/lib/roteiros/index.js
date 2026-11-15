// Fábrica de roteiros de Reels: até 10 por dia, cada um passando por três fiscais antes de aparecer na aba Vídeos.
//
//  Roteirista (IA)  → escreve seguindo a skill (skill.js) e um dos 12 formatos, a partir de uma pauta real:
//                     tese viral da reciclagem, história/caso/passo a passo do Pedro ou notícia da fila do piloto.
//  Fiscal do código → regras objetivas, sem IA: gancho curto, duração, CTA único, vícios de IA, número que não está na pauta.
//  Fiscal de retenção (IA) e fiscal de verdade e voz (IA) → notas 0–10 na checklist dos 15 critérios.
//  Aprovado (média ≥ 7,5 e nenhum eliminatório < 7) vira um cartão "Roteiro pronto" na aba Vídeos.
//  Reprovado: reescreve UMA vez com o parecer dos fiscais; reprovou de novo, descarta.
//
// Custo: só IA gratuita (pago: 'nunca'). Cada fase é uma chamada; o estado fica no piloto e avança a cada rodada,
// então nada passa do limite de 60 s da função.
const crypto = require('crypto');
const M = require('../../../static/contentModel');
const llmJson = require('../llmJson');
const Mentes = require('../mentes');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const S = require('./skill');

const conta = () => ACCOUNT.ig_id;
const META_DIA = 5;
const TENTATIVAS_DIA = 24;       // teto de roteiros começados por dia (protege a cota gratuita)
const DIAS_PAUTA_USADA = 30;
const DIAS_VALIDADE = 7;         // roteiro não gravado em 7 dias sai da aba
const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const limpa = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const erro = (msg, code, status = 400) => Object.assign(new Error(msg), { code, status });

// ── Pautas ────────────────────────────────────────────────────────────────────
// Ordem do dia: tese viral, notícia, tese, história própria… (a fonte que faltar cede a vez para a seguinte).
// Só pautas que sustentam um bom roteiro: teses de reels/posts virais e as histórias do Pedro (notícia só com a manchete reprovava).
const ROTACAO = ['tese', 'tese', 'proprio', 'tese', 'tese', 'noticia'];

async function pautas({ est = {}, deps = {} } = {}) {
  const usadas = new Set(((est.roteiros || {}).usadas || []).map((u) => u.chave));
  const out = { tese: [], noticia: [], proprio: [] };
  try {
    const itens = await (deps.teses || (() => require('../reciclagem/coletar').listar({ dias: 10, limite: 60 })))();
    for (const it of (Array.isArray(itens) ? itens : itens?.itens) || []) {
      if (!it.tese) continue; const chave = `rc:${it.id}`; if (usadas.has(chave)) continue;
      out.tese.push({ chave, tipo: 'tese', url: it.permalink || null, tema: limpa(it.tema || it.tese, 120), texto: [`TESE (viralizou em outra conta; não cite a origem): ${it.tese}`, it.ponte_pedro ? `PONTE PARA O EMPREENDEDOR BRASILEIRO: ${it.ponte_pedro}` : '', it.mecanismo ? `MECANISMO QUE FEZ VIRALIZAR: ${it.mecanismo}` : ''].filter(Boolean).join('\n'), peso: Number(it.vl) || 0, reel: it.tipo === 'reel' ? 1 : 0, autor: [it.conta?.handle, it.conta?.nome].filter((x) => x && String(x).replace(/^[@#]/, '').length >= 4).map((x) => String(x).replace(/^[@#]/, '').replace(/\(.*\)/, '').trim()) }); // handle e nome inteiros ("Conta Azul", não "Conta")
    }
    out.tese.sort((a, b) => (b.reel - a.reel) || (b.peso - a.peso)); // tese de reel viral primeiro: virou vídeo uma vez, vira de novo
  } catch { /* fonte fora do ar: as outras cobrem */ }
  try {
    const hs = await (deps.historias || (() => require('../historias').listar()))();
    for (const h of [...(hs || [])].reverse()) {
      const chave = `hs:${h.id}`; if (usadas.has(chave)) continue;
      out.proprio.push({ chave, tipo: h.tipo || 'historia', tema: limpa(h.titulo, 120), texto: `${h.tipo === 'como_fazer' ? 'PASSO A PASSO' : h.tipo === 'caso' ? 'CASO REAL' : 'HISTÓRIA REAL'} DO PEDRO (fatos verdadeiros; não invente nada além disto):\n${h.texto}` });
    }
  } catch { /* sem cadastro */ }
  for (const p of (deps.noticias || [])) { // notícia só se alguém passar explicitamente
    const chave = `pt:${p.id}`; if (usadas.has(chave) || !p.titulo) continue;
    out.noticia.push({ chave, tipo: 'noticia', tema: limpa(p.titulo, 140), texto: `NOTÍCIA EM ALTA (você só tem a manchete; não invente detalhe, número ou data que não está aqui):\n${p.titulo}`, url: p.url || null });
  }
  return out;
}

function escolherPauta(fontes, n) {
  for (let i = 0; i < ROTACAO.length; i++) {
    const tipo = ROTACAO[(n + i) % ROTACAO.length];
    if (fontes[tipo]?.length) return fontes[tipo].shift();
  }
  return null;
}

// Formato que a pauta sustenta, o menos usado hoje primeiro.
function escolherFormato(pauta, usadosHoje = {}, sortear = Math.random) {
  const tipo = pauta.tipo === 'proprio' ? 'historia' : pauta.tipo;
  let ids = Object.entries(S.FORMATOS).filter(([, f]) => f.tipos.includes(tipo)).map(([id]) => id);
  if (!/\d/.test(pauta.texto)) ids = ids.filter((id) => !['F2', 'F7'].includes(id) || ids.length < 3); // conta e comparação pedem número
  if (!ids.length) ids = ['F1', 'F12'];
  const menor = Math.min(...ids.map((id) => usadosHoje[id] || 0));
  const cand = ids.filter((id) => (usadosHoje[id] || 0) === menor);
  return cand[Math.floor(sortear() * cand.length) % cand.length];
}

// ── Roteirista ────────────────────────────────────────────────────────────────
function promptRoteirista({ formato, feedback = '' }) {
  const f = S.FORMATOS[formato];
  return `Você é o roteirista de Reels do @pedro_destrava. Escreva UM roteiro falado, gravado por ele olhando para a câmera, lido no teleprompter.
${S.SKILL}

FORMATO DESTE ROTEIRO: ${formato} · ${f.nome}
${f.estrutura}
CTA preferido deste formato: ${f.cta === 'envio' ? 'envio com destinatário específico' : f.cta === 'salvar' ? 'salvar (lista, conta ou passo a passo)' : 'pergunta binária para comentar'}.

${Mentes.AI.REGRAS}
${feedback ? `\nREESCREVA DO ZERO. Os fiscais reprovaram a versão anterior por:\n${feedback}\n` : ''}
Responda APENAS JSON:
{"titulo":"até 8 palavras","publico":"quem o gancho nomeia","gancho":"1ª frase falada, até 15 palavras","tela_gancho":"3 a 5 palavras na tela","visual":"o que aparece nos 3 primeiros segundos (gesto, objeto, cenário)","foreshadow":"1 ou 2 frases que abrem o loop","blocos":[{"fala":"2 a 4 frases curtas","tela":"3 a 5 palavras"}],"payoff":"a frase que entrega a promessa","cta":"1 frase","cta_tipo":"envio|salvar|comentar"}
Use de 3 a 6 blocos. Total falado entre ${S.PALAVRAS.min} e ${S.PALAVRAS.max} palavras.`;
}

function normalizar(d) {
  const blocos = (Array.isArray(d?.blocos) ? d.blocos : []).slice(0, 8).map((b) => ({ fala: limpa(b?.fala, 600), tela: limpa(b?.tela, 60) })).filter((b) => b.fala);
  return {
    titulo: limpa(d?.titulo, 90), publico: limpa(d?.publico, 80), gancho: limpa(d?.gancho, 240), tela_gancho: limpa(d?.tela_gancho, 60), visual: limpa(d?.visual, 200),
    foreshadow: limpa(d?.foreshadow, 300), blocos, payoff: limpa(d?.payoff, 300), cta: limpa(d?.cta, 240), cta_tipo: ['envio', 'salvar', 'comentar'].includes(d?.cta_tipo) ? d.cta_tipo : null,
  };
}

// Texto que o Pedro lê: uma frase por linha, um parágrafo por bloco.
function textoFalado(r) {
  const porLinha = (s) => String(s || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).join('\n');
  return [r.gancho, r.foreshadow, ...r.blocos.map((b) => b.fala), r.payoff, r.cta].filter(Boolean).map(porLinha).join('\n\n');
}

// ── Fiscal do código (sem IA) ─────────────────────────────────────────────────
const ABERTURAS_PROIBIDAS = /^(oi|olá|fala|e aí|eai|hoje (eu )?(vou|vamos)|você sabia|bom dia|boa tarde|boa noite|galera|pessoal)\b/i;
const VICIOS_ROTEIRO = /\b(vamos lá|bora lá|se liga|vem comigo|não se trata de|no mundo de hoje|nos dias atuais|descubra|desvende|guia definitivo|game changer|jornada|alavancar|potencializar|e o melhor de tudo|mas não para por aí|em resumo|resumindo|concluindo|spoiler|é isso,? pessoal|ademais|outrossim|por conseguinte|estudos mostram|especialistas afirmam)\b/i;
const POLITICO = /\b(lula|bolsonaro|haddad|moraes|tarc[ií]sio|pt\b|psol|pl\b|stf|elei[çc][aã]o|candidat)/i;
const CTA_RUIM = /\b(curte|curta|segue|siga|ativa o sininho|deixa (sua|a sua) opini[aã]o)\b/i;

// Números que aparecem na pauta: os únicos que o roteiro pode usar (mais contagens pequenas de lista: 2 a 10).
function numerosDe(texto) { return new Set((String(texto || '').match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, ''))); }
function numerosSemFonte(r, pauta) {
  const permitidos = numerosDe(pauta.texto);
  const falado = [textoFalado(r), r.tela_gancho, ...r.blocos.map((b) => b.tela)].join(' ');
  return [...new Set((falado.match(/\d+(?:[.,]\d+)*/g) || []))].filter((n) => { const k = n.replace(/[.,]/g, ''); return !permitidos.has(k) && !(Number(k) >= 1 && Number(k) <= 10 && k.length <= 2); });
}

function fiscalCodigo(r, pauta) {
  const p = [];
  const falado = textoFalado(r); const total = palavras(falado);
  if (!r.gancho) p.push({ criterio: 1, motivo: 'sem gancho' });
  else {
    if (palavras(r.gancho) > 16) p.push({ criterio: 1, motivo: `gancho com ${palavras(r.gancho)} palavras (máximo 15)`, trecho: r.gancho });
    if (ABERTURAS_PROIBIDAS.test(r.gancho.trim())) p.push({ criterio: 1, motivo: 'gancho abre com saudação ou "hoje vou falar"', trecho: r.gancho });
    if (POLITICO.test(`${r.gancho} ${r.tela_gancho}`)) p.push({ criterio: 14, motivo: 'nome de político, partido ou eleição no gancho (o Instagram corta o alcance para quem não segue)', trecho: r.gancho });
  }
  if (!r.tela_gancho || palavras(r.tela_gancho) > 6) p.push({ criterio: 3, motivo: 'texto de tela do gancho ausente ou com mais de 5 palavras' });
  if (r.blocos.length < 2) p.push({ criterio: 7, motivo: 'menos de 2 blocos de desenvolvimento' });
  if (!r.payoff) p.push({ criterio: 4, motivo: 'sem payoff' });
  if (total < S.PALAVRAS.min * 0.85) p.push({ criterio: 11, motivo: `curto demais (${total} palavras; mínimo ${S.PALAVRAS.min})` });
  if (total > S.PALAVRAS.max * 1.1) p.push({ criterio: 11, motivo: `longo demais (${total} palavras; máximo ${S.PALAVRAS.max})` });
  if (!r.cta) p.push({ criterio: 13, motivo: 'sem chamada final' });
  else if (CTA_RUIM.test(r.cta)) p.push({ criterio: 13, motivo: 'CTA genérico ("curte", "segue", "deixa sua opinião")', trecho: r.cta });
  const longas = falado.split(/(?<=[.!?])\s+|\n+/).filter((f) => palavras(f) > 24);
  if (longas.length) p.push({ criterio: 10, motivo: `${longas.length} frase(s) com mais de 24 palavras`, trecho: longas[0].slice(0, 160) });
  const vic = Mentes.AI.vicios([falado]); const m = falado.match(VICIOS_ROTEIRO);
  if (vic.length + (m ? 1 : 0) >= 2) p.push({ criterio: 15, motivo: `vícios de IA: ${[...vic.slice(0, 3).map((v) => v.nome), m ? `"${m[0]}"` : null].filter(Boolean).join(', ')}` });
  if (/[\u{1F300}-\u{1FAFF}]|#\w/u.test(falado)) p.push({ criterio: 15, motivo: 'emoji ou hashtag no roteiro falado' });
  // A pauta veio de um post de outra conta: o roteiro não cita nem promove essa conta, marca ou produto.
  const autores = (pauta.autor || []).map((a) => a.toLowerCase()).filter((a) => a.length >= 4);
  const normal = (t) => ` ${String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const marca = autores.find((a) => normal(falado).includes(normal(a)));
  if (marca || /\b(podcast|canal|perfil|newsletter) d[aoe]s? [A-Z]/.test(falado)) p.push({ criterio: 14, eliminar: true, motivo: `cita ou promove marca/perfil de terceiros${marca ? ` (${marca})` : ''}: o roteiro é do Pedro, sem divulgar outra conta` });
  const sem = numerosSemFonte(r, pauta);
  if (sem.length) p.push({ criterio: 8, eliminar: true, motivo: `número que não está na pauta: ${sem.slice(0, 4).join(', ')} (número inventado reprova)` });
  return { problemas: p, palavras: total, duracao_s: Math.round(total / S.PALAVRAS_POR_S) };
}

// ── Fiscais de IA ─────────────────────────────────────────────────────────────
function promptFiscal(qual) {
  const crit = qual === 'ambos' ? S.CRITERIOS : S.CRITERIOS.filter((c) => c.fiscal === qual);
  const papel = qual === 'ambos'
    ? 'FISCAL DE QUALIDADE (dois olhares numa leitura só). RETENÇÃO: você pensa como Paddy Galloway, Jenny Hoyos e Kallaway, a pessoa decide em 3 segundos se fica. VERDADE E VOZ: número inventado, fato que a pauta não sustenta, tom de palanque e texto com cara de IA queimam a reputação do Pedro.'
    : qual === 'retencao'
    ? 'FISCAL DE RETENÇÃO E VIRALIDADE. Você pensa como Paddy Galloway, Jenny Hoyos e Kallaway: a pessoa decide em 3 segundos se fica, e sai no primeiro trecho sem novidade.'
    : 'FISCAL DE VERDADE, VOZ E REPUTAÇÃO. Você protege o Pedro: número inventado, fato não sustentado pela pauta, tom de palanque, ataque pessoal e texto com cara de IA queimam a reputação dele.';
  return `Você é o ${papel}
Avalie o roteiro de Reel do @pedro_destrava (público: dono de pequena empresa, MEI, vendedor de marketplace) com rigor; nota 8+ só para o que está realmente pronto para gravar. Na dúvida, nota menor.
Critérios (0 a 10; ★ = eliminatório):
${crit.map((c) => `${c.n}${c.el ? '★' : ''}. ${c.nome}`).join('\n')}
${qual !== 'retencao' ? 'Critério 8: compare cada número, data, valor e fato com a PAUTA. O que não está na pauta e é afirmado como fato = nota 0. Opinião assumida ("na minha leitura") e cena genérica do dia a dia são permitidas.\n' : ''}${qual !== 'retencao' ? `Além das notas:
- "correcoes": erro de português no roteiro — palavra errada, expressão trocada (ex.: "torcer dinheiro" no lugar de "torrar dinheiro"), concordância. {"trecho":"texto EXATO do roteiro, até 6 palavras","correcao":"como fica"}. Só erro, não estilo. No máximo 5.
- "pessoas_marcas": cada pessoa, empresa ou marca REAL citada no roteiro (fora o Pedro): {"nome":"","fatos":["cada fato afirmado sobre ela, curto"],"na_pauta":true}. na_pauta = true só se TODOS esses fatos estão escritos na PAUTA.
` : ''}Responda APENAS JSON: {"notas":{${crit.map((c) => `"${c.n}":0`).join(',')}},"problemas":[{"criterio":0,"trecho":"frase exata do roteiro","sugestao":"como reescrever"}]${qual !== 'retencao' ? ',"correcoes":[],"pessoas_marcas":[]' : ''}}
No máximo 4 problemas, os mais graves.`;
}

// Correções de português do fiscal: só as que existem LITERALMENTE no roteiro e são curtas (troca de palavra, não reescrita).
function lerCorrecoes(d, r) {
  const texto = r ? [textoFalado(r), r.tela_gancho, ...(r.blocos || []).map((b) => b.tela)].join('\n') : '';
  const out = [];
  for (const x of (Array.isArray(d?.correcoes) ? d.correcoes : []).slice(0, 5)) {
    const trecho = limpa(x?.trecho, 80); const correcao = limpa(x?.correcao, 100);
    if (!trecho || !correcao || trecho === correcao) continue;
    if (palavras(trecho) > 8 || palavras(correcao) > 10 || !texto.includes(trecho)) continue;
    out.push({ trecho, correcao });
  }
  return out;
}

function aplicarCorrecoes(r, correcoes) {
  if (!correcoes?.length) return { roteiro: r, aplicadas: [] };
  const aplicadas = [];
  const troca = (t) => { let s = String(t || ''); for (const c of correcoes) if (s.includes(c.trecho)) { s = s.split(c.trecho).join(c.correcao); if (!aplicadas.includes(c)) aplicadas.push(c); } return s; };
  const novo = { ...r, gancho: troca(r.gancho), tela_gancho: troca(r.tela_gancho), foreshadow: troca(r.foreshadow), payoff: troca(r.payoff), cta: troca(r.cta), blocos: (r.blocos || []).map((b) => ({ ...b, fala: troca(b.fala), tela: troca(b.tela) })) };
  return { roteiro: novo, aplicadas };
}

// Pessoas e marcas reais citadas: o Pedro confere antes de gravar (fato errado sobre gente de verdade queima a reputação).
function lerFatosReais(d) {
  return (Array.isArray(d?.pessoas_marcas) ? d.pessoas_marcas : []).slice(0, 6).map((x) => ({
    nome: limpa(x?.nome, 60), fatos: (Array.isArray(x?.fatos) ? x.fatos : []).map((f) => limpa(f, 160)).filter(Boolean).slice(0, 5), na_pauta: x?.na_pauta === true,
  })).filter((x) => x.nome && !/pedro/i.test(x.nome));
}

function usuarioFiscal(r, pauta, formato) {
  return `PAUTA (a única fonte de fatos):\n${pauta.texto.slice(0, 2500)}\n\nFORMATO: ${formato} · ${S.FORMATOS[formato]?.nome}\n\nROTEIRO:\n[TELA no gancho: ${r.tela_gancho}] [VISUAL: ${r.visual}]\nGANCHO: ${r.gancho}\nFORESHADOW: ${r.foreshadow}\n${r.blocos.map((b, i) => `BLOCO ${i + 1} [TELA: ${b.tela}]: ${b.fala}`).join('\n')}\nPAYOFF: ${r.payoff}\nCTA (${r.cta_tipo || '?'}): ${r.cta}`;
}

function lerNotas(d, qual) {
  const out = {};
  for (const c of S.CRITERIOS.filter((x) => x.fiscal === qual)) { const v = Number(d?.notas?.[c.n] ?? d?.notas?.[String(c.n)]); out[c.n] = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null; }
  const problemas = (Array.isArray(d?.problemas) ? d.problemas : []).slice(0, 4).map((x) => ({ criterio: Number(x?.criterio) || null, trecho: limpa(x?.trecho, 200), sugestao: limpa(x?.sugestao, 240) }));
  return { notas: out, problemas };
}

// Junta os três pareceres. Nota que a IA não deu conta como reprovação daquele critério (não aprova no escuro).
function veredito({ retencao, verdade, codigo }) {
  const notas = { ...(retencao?.notas || {}), ...(verdade?.notas || {}) };
  for (const p of codigo?.problemas || []) if (p.criterio) notas[p.criterio] = Math.min(notas[p.criterio] ?? 10, p.eliminar ? 0 : 5);
  const vals = S.CRITERIOS.map((c) => notas[c.n]);
  const faltando = S.CRITERIOS.filter((c) => notas[c.n] == null).map((c) => c.n);
  const media = Math.round((vals.reduce((s, v) => s + (v ?? 0), 0) / S.CRITERIOS.length) * 10) / 10;
  const eliminatorios = S.CRITERIOS.filter((c) => c.el && (notas[c.n] ?? 0) < S.ELIMINATORIO_MIN).map((c) => c.n);
  const aprovado = !faltando.length && media >= S.MEDIA_MIN && !eliminatorios.length;
  return { aprovado, media, eliminatorios, notas, faltando };
}

function feedbackDe(v, pareceres) {
  const linhas = [];
  for (const p of pareceres.codigo?.problemas || []) linhas.push(`- [${p.criterio}] ${p.motivo}${p.trecho ? `: "${p.trecho}"` : ''}`);
  for (const p of [...(pareceres.retencao?.problemas || []), ...(pareceres.verdade?.problemas || [])]) linhas.push(`- [${p.criterio}] "${p.trecho}" → ${p.sugestao}`);
  const baixos = S.CRITERIOS.filter((c) => (v.notas[c.n] ?? 0) < 7).map((c) => `${c.n} (${c.nome}): ${v.notas[c.n] ?? 'sem nota'}`);
  if (baixos.length) linhas.push(`- Notas baixas: ${baixos.join('; ')}`);
  return linhas.slice(0, 10).join('\n');
}

// ── Saída: cartão na aba Vídeos ──────────────────────────────────────────────
async function salvarRoteiro(rasc, { deps = {}, agora = Date.now() } = {}) {
  const r = rasc.roteiro; const v = rasc.veredito;
  const c = M.novoConteudo({ titulo: (r.titulo || rasc.pauta.tema || 'Roteiro de Reel').slice(0, 140), formato: 'reels', origem: { tipo: 'roteiros' } });
  c.id = `vd_${crypto.randomBytes(8).toString('hex')}`; // prefixo dos vídeos: aparece na aba Vídeos
  c.video = {
    estado: 'roteiro', roteiro_texto: textoFalado(r), titulo: r.titulo || null, publico: r.publico || null,
    duracao_estimada_s: rasc.codigo.duracao_s, palavras: rasc.codigo.palavras, origem: null,
    roteiro: {
      formato: rasc.formato, formato_nome: S.FORMATOS[rasc.formato]?.nome, nota: v.media, notas: v.notas, tentativas: rasc.tentativa,
      tela_gancho: r.tela_gancho, visual: r.visual, telas: r.blocos.map((b) => b.tela).filter(Boolean), cta_tipo: r.cta_tipo,
      pauta: { tipo: rasc.pauta.tipo, tema: rasc.pauta.tema, url: rasc.pauta.url || null, chave: rasc.pauta.chave },
      correcoes: rasc.correcoes || [], fatos_reais: rasc.fatos || [],
      ia: rasc.ia || [], gerado_em: new Date(agora).toISOString(),
    },
    worker: { tentativas: 0 }, log: [{ em: new Date(agora).toISOString(), msg: `Roteiro ${rasc.formato} aprovado pelos fiscais (média ${v.media}).` }],
  };
  c.studio = { estado: 'video', etapa: 'roteiro' };
  if (deps.salvar) return deps.salvar(c);
  const a = armazem(); if (!a?.duravel) throw erro('Os roteiros precisam do banco de dados no servidor.', 'SEM_BANCO', 503);
  await a.conteudos.salvar(conta(), c.id, c, 0);
  return c;
}

// Roteiro gravado (o Pedro abriu o teleprompter e mandou o vídeo) ou velho: sai da aba.
async function arquivar(id, motivo = 'gravado') {
  const a = armazem(); if (!a?.duravel || !String(id || '').startsWith('vd_')) return false;
  const reg = await a.conteudos.obter(conta(), id); const c = reg?.doc;
  if (!c || c.video?.estado !== 'roteiro' || c.status === 'arquivado') return false;
  c.status = 'arquivado'; c.video.roteiro = { ...(c.video.roteiro || {}), arquivado: motivo, arquivado_em: new Date().toISOString() };
  c.updated_at = new Date().toISOString();
  await a.conteudos.salvar(conta(), c.id, c, reg.rev);
  return true;
}
async function arquivarVelhos({ agora = Date.now() } = {}) {
  const a = armazem(); if (!a?.duravel) return 0;
  let n = 0;
  for (const x of (await a.conteudos.listar(conta())).filter((y) => String(y.id).startsWith('vd_'))) {
    const reg = await a.conteudos.obter(conta(), x.id); const c = reg?.doc;
    if (c?.video?.estado === 'roteiro' && c.status !== 'arquivado' && agora - Date.parse(c.created_at || 0) > DIAS_VALIDADE * 86400000) { if (await arquivar(c.id, 'vencido')) n++; }
  }
  return n;
}

// ── Avanço (uma fase por chamada de IA, estado em est.roteiros) ──────────────
function estadoDoDia(est, dia, agora) {
  const r = est.roteiros && typeof est.roteiros === 'object' ? est.roteiros : {};
  const usadas = (r.usadas || []).filter((u) => Date.parse(u.em) > agora - DIAS_PAUTA_USADA * 86400000);
  if (r.dia !== dia) return { dia, feitos: 0, descartados: 0, comecados: 0, formatos: {}, usadas, rascunho: r.rascunho || null, pausa_ate: r.pausa_ate || null, ultimos: [] };
  return { feitos: 0, descartados: 0, comecados: 0, formatos: {}, ultimos: [], ...r, usadas };
}

const pendente = (r, meta = META_DIA) => !!r && (r.rascunho || (r.feitos < meta && r.comecados < TENTATIVAS_DIA));

// Limite por minuto (TPM/RPM) zera logo: volta em 4 min. Cota do dia ou sem crédito: 45 min.
function pausaMin(e) { const m = `${e?.code || ''} ${e?.message || ''}`; return /per minute|\bTPM\b|\bRPM\b|por minuto/i.test(m) && !/per day|\bTPD\b|\bRPD\b|di[aá]ri/i.test(m) ? 4 : 45; }
function ehCota(e) { return /cota|quota|rate.?limit|429|too many|limite di[aá]rio|sem_credito|indispon/i.test(`${e?.code || ''} ${e?.message || ''}`); }

async function chamarIA({ sistema, usuario, maxTokens, temperatura, etapa, deps, restanteMs }) {
  const pedir = deps.pedirJson || llmJson.pedirJson;
  const prazo = Math.max(8000, Math.min(30000, restanteMs - 3000));
  const fn = () => pedir({ sistema, usuario, maxTokens, temperatura, pago: 'nunca', etapa, preferirMelhor: true });
  const res = deps.pedirJson ? await fn() : await llmJson.comPrazo(prazo, fn);
  return res;
}

// Faz o que couber no orçamento: começa um roteiro, escreve, fiscaliza, reescreve, salva ou descarta.
async function avancar(est, { agora = Date.now(), dia, orcamentoMs = 40000, meta = META_DIA, deps = {} } = {}) {
  const inicio = Date.now(); const restante = () => orcamentoMs - (Date.now() - inicio);
  const R = estadoDoDia(est, dia, agora); est.roteiros = R;
  const out = { salvos: [], descartados: [], fases: [] };
  if (!deps.pedirJson && !llmJson.hasLlmKey()) return { ...out, sem_ia: true };
  if (R.pausa_ate && Date.parse(R.pausa_ate) > agora) return { ...out, pausado: true };
  R.pausa_ate = null;
  if (R.ultimo_arquivamento !== dia && !deps.salvar) { R.ultimo_arquivamento = dia; try { out.arquivados = await arquivarVelhos({ agora }); } catch { /* cortesia */ } }

  while (restante() > 14000 && pendente(R, meta)) {
    try {
      if (!R.rascunho) {
        const fontes = await pautas({ est: { ...est, roteiros: R }, deps });
        const pauta = escolherPauta(fontes, R.comecados);
        if (!pauta) { out.sem_pauta = true; break; }
        const formato = escolherFormato(pauta, R.formatos, deps.sortear || Math.random);
        R.usadas.push({ chave: pauta.chave, em: new Date(agora).toISOString() });
        R.comecados += 1; R.formatos[formato] = (R.formatos[formato] || 0) + 1;
        R.rascunho = { id: `rt_${crypto.randomBytes(4).toString('hex')}`, pauta, formato, fase: 'escrever', tentativa: 1, feedback: '', ia: [] };
      }
      const x = R.rascunho;
      if (x.fase === 'escrever') {
        const { dados, llm } = await chamarIA({ sistema: promptRoteirista({ formato: x.formato, feedback: x.feedback }), usuario: `PAUTA:\n${x.pauta.texto.slice(0, 3000)}`, maxTokens: 1400, temperatura: x.tentativa === 1 ? 0.75 : 0.85, etapa: 'roteiro_video', deps, restanteMs: restante() });
        x.ia.push(llm?.provider || '?');
        x.roteiro = normalizar(dados); x.codigo = fiscalCodigo(x.roteiro, x.pauta);
        out.fases.push(`${x.id}:escreveu`);
        // O código já reprovou: nem gasta os fiscais de IA.
        const grave = x.codigo.problemas.some((p) => p.eliminar) || x.codigo.problemas.length >= 3 || !x.roteiro.blocos.length;
        x.fase = grave ? 'decidir' : 'fiscal'; // um fiscal só, com os 15 critérios (economiza uma chamada por roteiro)
        if (grave) x.pareceres = { codigo: x.codigo };
        continue;
      }
      if (x.fase === 'fiscal') {
        const { dados, llm } = await chamarIA({ sistema: promptFiscal('ambos'), usuario: usuarioFiscal(x.roteiro, x.pauta, x.formato), maxTokens: 900, temperatura: 0.2, etapa: 'fiscal_roteiro', deps, restanteMs: restante() });
        x.ia.push(llm?.provider || '?');
        x.pareceres = { codigo: x.codigo, retencao: lerNotas(dados, 'retencao'), verdade: lerNotas(dados, 'verdade') };
        x.correcoes = lerCorrecoes(dados, x.roteiro); x.fatos = lerFatosReais(dados);
        for (const f of x.fatos.filter((y) => !y.na_pauta)) x.codigo.problemas.push({ criterio: 8, eliminar: true, motivo: `fato sobre ${f.nome} que a pauta não sustenta (${f.fatos[0] || 'sem fonte'}): tire o fato ou fique só no que a pauta diz`, trecho: f.nome });
        out.fases.push(`${x.id}:fiscal`); x.fase = 'decidir';
        continue;
      }
      if (x.fase === 'retencao' || x.fase === 'verdade') {
        const { dados, llm } = await chamarIA({ sistema: promptFiscal(x.fase), usuario: usuarioFiscal(x.roteiro, x.pauta, x.formato), maxTokens: 700, temperatura: 0.2, etapa: `fiscal_${x.fase}`, deps, restanteMs: restante() });
        x.ia.push(llm?.provider || '?');
        x.pareceres = { ...(x.pareceres || {}), codigo: x.codigo, [x.fase]: lerNotas(dados, x.fase) };
        out.fases.push(`${x.id}:${x.fase}`);
        // Retenção já matou o roteiro (eliminatório abaixo de 5): pula o segundo fiscal.
        const ret = x.pareceres.retencao;
        const morto = x.fase === 'retencao' && S.CRITERIOS.some((c) => c.el && c.fiscal === 'retencao' && (ret.notas[c.n] ?? 0) < 5);
        x.fase = x.fase === 'retencao' && !morto ? 'verdade' : 'decidir';
        continue;
      }
      if (x.fase === 'decidir') {
        const v = veredito({ retencao: x.pareceres?.retencao, verdade: x.pareceres?.verdade, codigo: x.codigo });
        x.veredito = v;
        if (v.aprovado) {
          const corr = aplicarCorrecoes(x.roteiro, x.correcoes); x.roteiro = corr.roteiro; x.correcoes = corr.aplicadas;
          const c = await salvarRoteiro(x, { deps, agora });
          R.feitos += 1; out.salvos.push({ id: c.id, titulo: c.titulo, nota: v.media, formato: x.formato });
          R.ultimos = [{ id: c.id, titulo: c.titulo, nota: v.media, formato: x.formato, em: new Date(agora).toISOString() }, ...(R.ultimos || [])].slice(0, 12);
          R.rascunho = null;
        } else if (x.tentativa < 2) {
          x.feedback = feedbackDe(v, x.pareceres || { codigo: x.codigo }); x.tentativa += 1; x.fase = 'escrever'; x.pareceres = null;
        } else {
          R.descartados += 1; out.descartados.push({ pauta: x.pauta.tema, formato: x.formato, media: v.media, eliminatorios: v.eliminatorios });
          R.ultimos_descartes = [{ tema: x.pauta.tema, formato: x.formato, media: v.media, motivo: feedbackDe(v, x.pareceres || { codigo: x.codigo }).split('\n')[0] || '', em: new Date(agora).toISOString() }, ...(R.ultimos_descartes || [])].slice(0, 8);
          R.rascunho = null;
        }
        continue;
      }
      R.rascunho = null; // fase desconhecida: recomeça
    } catch (e) {
      if (ehCota(e)) { R.pausa_ate = new Date(agora + pausaMin(e) * 60000).toISOString(); out.pausado = true; out.erro = String(e.message).slice(0, 140); break; }
      // Falha avulsa (JSON ruim, prazo): conta a tentativa e segue; na terceira falha da mesma fase, descarta.
      const x = R.rascunho; out.erro = String(e.message).slice(0, 140);
      if (x) { x.falhas = (x.falhas || 0) + 1; if (x.falhas >= 3) { R.descartados += 1; R.rascunho = null; } }
      break;
    }
  }
  return out;
}

function resumo(est, { dia } = {}) {
  const R = est.roteiros || {};
  const hoje = R.dia === dia;
  return { meta: META_DIA, feitos: hoje ? R.feitos || 0 : 0, descartados: hoje ? R.descartados || 0 : 0, comecados: hoje ? R.comecados || 0 : 0, em_producao: R.rascunho ? { formato: R.rascunho.formato, tema: R.rascunho.pauta?.tema, fase: R.rascunho.fase, tentativa: R.rascunho.tentativa } : null, pausa_ate: R.pausa_ate || null, ultimos: R.ultimos || [], ultimos_descartes: R.ultimos_descartes || [] };
}

module.exports = { pausaMin, META_DIA, TENTATIVAS_DIA, ROTACAO, pautas, escolherPauta, escolherFormato, promptRoteirista, promptFiscal, normalizar, textoFalado, fiscalCodigo, numerosSemFonte, lerNotas, lerCorrecoes, aplicarCorrecoes, lerFatosReais, veredito, feedbackDe, salvarRoteiro, arquivar, arquivarVelhos, estadoDoDia, pendente, avancar, resumo };
