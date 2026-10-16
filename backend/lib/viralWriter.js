// Redator dos modelos virais. Escreve o conteúdo de cada modelo com o DNA do
// Pedro, as regras do playbook e os posts dele que mais renderam como
// referência. Gera 3 ganchos, escolhe pela nota de viralização e, se o
// conjunto sair fraco, reescreve uma vez com as falhas apontadas.
const { createCompatClient, hasLlmKey } = require('./llm');
const { PEDRO_DNA, LINGUAGEM_LEIGO, PROFILE_HANDLE } = require('./pedroDna');
const { insightsParaPrompt, lastInsights } = require('./profileInsights');
const PB = require('../../static/viralPlaybook');

let _llm = null;
const llm = () => (_llm ??= createCompatClient());

const FORMATO_JSON = {
  antes_agora: `{"ganchos":[{"tipo":"numero_choque","texto":""},{"tipo":"","texto":""},{"tipo":"","texto":""}],
 "slides":[{"texto":"comparação 1 com **número em destaque**","foto":"busca de foto em inglês"}],
 "licao":"a lição de dinheiro/negócio em 1-2 frases, com **destaque**","cta":"CTA de envio","caption":"legenda","fontes":["IBGE…"]}
Regras: 4 a 6 slides. O PRIMEIRO slide é o gancho escolhido, já com a primeira comparação. Cada slide segue o mesmo molde ("Em ANO… hoje…"), uma comparação por slide, número exato e verificável. Só use número que você tem certeza; se não tiver, compare quantidades relativas (metade, o dobro) em vez de inventar.`,
  print: `{"ganchos":[{"tipo":"contradicao","texto":""},{"tipo":"","texto":""},{"tipo":"","texto":""}],
 "frases":["frase 1 (o gancho escolhido)","frase 2 opcional"],"caption":"legenda","fontes":[]}
Regras: cada frase sozinha precisa fazer sentido e caber em 3 a 5 linhas (até 28 palavras). Coloque **destaque** em 2 a 4 palavras-chave. 1 frase = post único; 4 a 6 frases = carrossel de prints sobre o mesmo tema.`,
  noticia: `{"ganchos":[{"tipo":"historia_humana","texto":""},{"tipo":"","texto":""},{"tipo":"","texto":""}],
 "manchete":"a manchete escolhida com **número em destaque**","rotulo":"BOAS NOTÍCIAS|HISTÓRIA REAL|NEGÓCIOS","foto":"busca de foto em inglês (pessoas, cena real)","caption":"a história completa em 3 parágrafos curtos + a estratégia por trás + CTA","fontes":["veículo/fonte"]}
Regras: manchete com pessoa ou empresa real, emoção e um número, até 22 palavras. Só fatos verificáveis.`,
  lista: `{"ganchos":[{"tipo":"autoridade","texto":""},{"tipo":"","texto":""},{"tipo":"","texto":""}],
 "titulo":"título da lista (o gancho escolhido) com **destaque**","subtitulo":"1 linha que promete o que a pessoa ganha","itens":[{"titulo":"até 6 palavras","texto":"caso real em 1-2 frases curtas"}],"licao":"pergunta ou lição final","cta":"CTA","caption":"legenda","fontes":[]}
Regras: 6 a 9 itens, cada um com um caso real (empresa, marca, pessoa). Nada genérico.`,
};

function pickHook(ganchos, template) {
  const opts = (ganchos || []).map((g) => (typeof g === 'string' ? { texto: g } : g)).filter((g) => g && g.texto);
  if (!opts.length) return null;
  const nota = (g) => PB.viralScore({ template, hook: g.texto, slides: [], caption: 'Manda pra alguém.' }).checks
    .filter((c) => c.ok && /Gancho|clichê/i.test(c.label)).reduce((s, c) => s + c.peso, 0);
  return [...opts].sort((a, b) => nota(b) - nota(a))[0];
}

// Converte o conteúdo do modelo pro formato que a nota de viralização lê.
function paraNota(template, c) {
  if (template === 'antes_agora') return { template, hook: c.slides?.[0]?.texto, slides: [...(c.slides || []), { texto: `${c.licao || ''} ${c.cta || ''}` }], caption: c.caption, fontes: c.fontes };
  if (template === 'print') return { template, hook: c.frases?.[0], slides: (c.frases || []).map((f) => ({ texto: f })), caption: c.caption, fontes: c.fontes };
  if (template === 'noticia') return { template, hook: c.manchete, slides: [{ texto: c.manchete }], caption: c.caption, fontes: c.fontes };
  if (template === 'lista') return { template, hook: c.titulo, slides: [{ texto: c.titulo }, ...(c.itens || []).map((i) => ({ texto: `${i.titulo} ${i.texto}` })), { texto: `${c.licao || ''} ${c.cta || ''}` }], caption: c.caption, fontes: c.fontes };
  return { template, hook: '', slides: [], caption: c.caption };
}

// Número de telas que o post vai ter de fato (pra nota bater com o render).
function telasReais(template, c) {
  if (template === 'antes_agora') return (c.slides || []).length + 1;
  if (template === 'print') return (c.frases || []).length;
  if (template === 'noticia') return 1;
  if (template === 'lista') {
    const n = (c.itens || []).length;
    const porTela = Math.ceil(n / Math.max(1, Math.ceil(n / 3))) || 1;
    return Math.ceil(n / porTela) + 2;
  }
  return 1;
}

function nota(template, c) {
  const base = paraNota(template, c);
  const n = telasReais(template, c);
  const slides = base.slides.length === n ? base.slides : Array.from({ length: n }, (_, i) => base.slides[i] || { texto: '' });
  return PB.viralScore({ ...base, slides });
}

async function chamarIA(item, template, feedback, insights) {
  const ins = insightsParaPrompt(insights || lastInsights());
  const ai = await llm().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.75,
    response_format: { type: 'json_object' },
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `${PEDRO_DNA}\n\n${LINGUAGEM_LEIGO}\n\n${PB.resumoParaPrompt()}\n\n${ins}

TAREFA: escreva um post no modelo "${PB.TEMPLATES[template].nome}" para o ${PROFILE_HANDLE}.
Pauta: ${item.title}
Contexto: ${item.summary || '—'}
Pilar: ${item.pillar || '—'}
${item.source_name && !/sugest|tend/i.test(item.source_name) ? `Fonte da pauta: ${item.source_name} ${item.source_url || ''}` : ''}

Gere 3 ganchos de tipos diferentes e use o mais forte. Marque com **duas estrelas** o trecho de destaque (número ou palavra-chave).
Legenda: primeira linha forte, até 600 caracteres, termina com UM CTA ("Manda pra alguém que…" ou "Comenta PALAVRA…"), no máximo 3 hashtags no fim. Sem emoji dentro do texto das telas.
${feedback ? `\nA VERSÃO ANTERIOR FALHOU NISSO, CORRIJA:\n${feedback}\n` : ''}
Responda APENAS JSON no formato:
${FORMATO_JSON[template]}`,
    }],
  });
  return JSON.parse(ai.choices[0].message.content || '{}');
}

function normalizar(template, d) {
  const hook = pickHook(d.ganchos, template);
  const c = { ...d, fontes: Array.isArray(d.fontes) ? d.fontes.filter(Boolean).map(String) : [] };
  if (template === 'antes_agora') {
    c.slides = (d.slides || []).filter((s) => s && s.texto).slice(0, 6);
    if (hook && c.slides[0] && !c.slides[0].texto.includes(hook.texto.replace(/\*\*/g, '').slice(0, 20))) {
      // O gancho escolhido vira a capa; o resto das comparações segue.
      c.slides = [{ texto: hook.texto, foto: c.slides[0].foto }, ...c.slides].slice(0, 6);
    }
    if (c.slides.length < 3) throw new Error('poucas comparações');
  } else if (template === 'print') {
    c.frases = (d.frases || []).map(String).filter(Boolean).slice(0, 6);
    if (hook && !c.frases.some((f) => f.includes(hook.texto.slice(0, 20)))) c.frases = [hook.texto, ...c.frases].slice(0, 6);
    if (!c.frases.length) throw new Error('sem frase');
  } else if (template === 'noticia') {
    c.manchete = String(d.manchete || hook?.texto || '');
    if (!c.manchete) throw new Error('sem manchete');
  } else if (template === 'lista') {
    c.titulo = String(d.titulo || hook?.texto || '');
    c.itens = (d.itens || []).filter((i) => i && i.titulo).slice(0, 9);
    if (c.itens.length < 4) throw new Error('lista curta');
  }
  c.cta = c.cta || PB.CTAS.envio;
  c.gancho = hook?.texto || '';
  c.gancho_tipo = hook?.tipo || '';
  c.ganchos = (d.ganchos || []).map((g) => (typeof g === 'string' ? g : g.texto)).filter(Boolean);
  return c;
}

// Sem IA: não inventa número. Vira um Print (ou notícia) com o que a pauta tem.
function robo(item, template) {
  const titulo = String(item.title || '').replace(/[.!?]*$/, '.');
  const resumo = String(item.summary || '').trim();
  if (template === 'noticia') {
    return { template, conteudo: { manchete: titulo, rotulo: 'HISTÓRIA REAL', foto: item.title, caption: `${titulo}\n\n${resumo}\n\n${PB.CTAS.envio}`, fontes: item.source_name ? [item.source_name] : [] } };
  }
  return { template: 'print', conteudo: { frases: [titulo, resumo].filter(Boolean).slice(0, 2), caption: `${titulo}\n\n${resumo}\n\n${PB.CTAS.envio}`, fontes: [] } };
}

async function escrever(item, template, { insights, prazoMs = 30000 } = {}) {
  if (!PB.TEMPLATES[template]) throw new Error(`Modelo desconhecido: ${template}`);
  const comNota = (r, fonte) => ({ ...r, fonte, nota: nota(r.template, r.conteudo) });
  if (!hasLlmKey()) return comNota(robo(item, template), 'robo');
  const t0 = Date.now();
  let melhor = null;
  let feedback = '';
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const c = normalizar(template, await chamarIA(item, template, feedback, insights));
      const n = nota(template, c);
      if (!melhor || n.score > melhor.nota.score) melhor = { template, conteudo: c, nota: n, fonte: 'ia' };
      if (n.score >= 75 || Date.now() - t0 > prazoMs / 2) break;
      feedback = n.checks.filter((x) => !x.ok).map((x) => `- ${x.label}: ${x.dica}`).join('\n');
    } catch (e) {
      console.warn('[viralWriter] tentativa falhou:', e.message?.slice(0, 120));
      if (Date.now() - t0 > prazoMs / 2) break;
    }
  }
  if (melhor) return melhor;
  return comNota(robo(item, template), 'robo-reserva');
}

module.exports = { escrever, nota, normalizar, pickHook, robo, paraNota };
