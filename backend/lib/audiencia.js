// Inteligência de Audiência: o que a audiência REAL pergunta, critica, conta e pede, cruzado com o desempenho real dos posts.
// Pura (sem IA, sem custo): recebe os comentários guardados (comunidade.js) e os posts lidos da Meta (crescimento.juntarPosts).
// Nada é simulado: sem comentário, a categoria não aparece; o "potencial" vem dos posts reais do mesmo tema; o score é
// comparativo (ordena oportunidades entre si), não previsão de alcance.
const C = require('./crescimento');

const DIA = 86400000;
const arred = (n, d = 0) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const MIN_COMENTARIOS = 3;
const CLASSES_DOR = new Set(['pergunta', 'duvida', 'critica', 'discordancia']);
const NOMES_TEMA = Object.fromEntries([...C.TEMAS.map((t) => [t.id, t.nome]), ['outros', 'Outros']]);
const PILAR_TEMA = Object.fromEntries(C.TEMAS.map((t) => [t.id, t.pilar]));
const FORMATO = { reel: 'Reel', carrossel: 'Carrossel', imagem: 'Post único', video: 'Vídeo' };
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('a o e de da do das dos em no na nos nas um uma que se nao sim eu voce vc pra para por com como mais mas muito isso esse essa ele ela tem ter foi era ser sao the and is to of'.split(' '));
const chaves = (t) => new Set(norm(t).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)));

// Perguntas parecidas (≥ 50% das palavras-chave em comum) viram um grupo: a recorrência.
function agruparPerguntas(cs) {
  const grupos = [];
  for (const c of cs) {
    const k = chaves(c.texto); if (k.size < 2) continue;
    const g = grupos.find((x) => { let comum = 0; for (const w of k) if (x.k.has(w)) comum++; return comum / Math.min(k.size, x.k.size) >= 0.5; });
    if (g) { g.itens.push(c); for (const w of k) g.k.add(w); } else grupos.push({ k: new Set(k), itens: [c] });
  }
  return grupos.filter((g) => g.itens.length >= 2).sort((a, b) => b.itens.length - a.itens.length)
    .map((g) => ({ n: g.itens.length, exemplo: g.itens[0].texto.slice(0, 160), tema: g.itens[0].tema, ids: g.itens.slice(0, 5).map((x) => x.id) }));
}

function analisar({ comentarios = [], posts = [], dna = null, agora = Date.now() } = {}) {
  const cs = comentarios.filter((c) => c.classe !== 'spam');
  const maduros = posts.filter((p) => p.maduro && p.alcance);
  const geral = C.resumoGrupo(maduros);
  const recente = (c, de, ate) => { const t = Date.parse(c.em || c.criado_em); return t >= agora - de * DIA && t < agora - ate * DIA; };
  const pilaresDna = new Set((dna?.pilares || []).map((p) => p.id));
  const porTema = new Map();
  for (const c of cs) { const k = c.tema || 'outros'; if (!porTema.has(k)) porTema.set(k, []); porTema.get(k).push(c); }
  const categorias = [...porTema.entries()].map(([tema, lista]) => {
    const ult14 = lista.filter((c) => recente(c, 14, 0)).length; const ant14 = lista.filter((c) => recente(c, 28, 14)).length;
    const sent = { positivo: 0, negativo: 0, neutro: 0 }; for (const c of lista) sent[c.sentimento || 'neutro']++;
    const ps = maduros.filter((p) => C.temaDe(p.legenda).id === tema); const g = C.resumoGrupo(ps);
    const classes = {}; for (const c of lista) classes[c.classe] = (classes[c.classe] || 0) + 1;
    const semanas = Math.max(1, (agora - Math.min(...lista.map((c) => Date.parse(c.em || c.criado_em) || agora))) / (7 * DIA));
    return {
      tema, nome: NOMES_TEMA[tema] || tema, volume: lista.length, por_semana: arred(lista.length / semanas, 1),
      crescimento_pct: ant14 >= 3 ? arred(((ult14 - ant14) / ant14) * 100) : null, ultimos_14d: ult14, anteriores_14d: ant14,
      sentimento: sent, classes, recorrencia: agruparPerguntas(lista.filter((c) => ['pergunta', 'duvida'].includes(c.classe)))[0]?.n || 0,
      posts: g.n, potencial_compartilhamento: g.amostra !== 'insuficiente' && geral.envios_mil ? arred(g.envios_mil / geral.envios_mil, 2) : null,
      potencial_salvamento: g.amostra !== 'insuficiente' && geral.salvos_mil ? arred(g.salvos_mil / geral.salvos_mil, 2) : null,
      potencial_serie: (classes.pergunta || 0) + (classes.duvida || 0) + (classes.sugestao || 0) >= 3,
      compativel_posicionamento: tema !== 'outros' && (!pilaresDna.size || pilaresDna.has(PILAR_TEMA[tema])),
      potencial_comercial: classes.interesse_comercial || 0, amostra: lista.length >= MIN_COMENTARIOS ? 'suficiente' : 'pequena',
    };
  }).sort((a, b) => b.volume - a.volume);

  const perguntas = agruparPerguntas(cs.filter((c) => ['pergunta', 'duvida'].includes(c.classe)));
  const dores = agruparPerguntas(cs.filter((c) => CLASSES_DOR.has(c.classe)));
  const crescentes = categorias.filter((x) => x.crescimento_pct != null && x.crescimento_pct >= 30 && x.ultimos_14d >= 3);
  const saturados = categorias.filter((x) => x.posts >= 5 && x.potencial_compartilhamento != null && x.potencial_compartilhamento < 0.77);
  const controversos = categorias.filter((x) => x.volume >= MIN_COMENTARIOS && ((x.classes.discordancia || 0) + (x.classes.critica || 0)) / x.volume >= 0.3);
  const comunidade = categorias.filter((x) => (x.classes.historia || 0) >= 2);

  // Score comparativo 0–100: volume e recorrência (30), crescimento (15), potencial de envio/salvamento real (25),
  // posicionamento (15), série (10), comercial (5). Pesos explícitos; o número só ordena as oportunidades entre si.
  const maxVol = Math.max(1, ...categorias.map((x) => x.volume));
  const sugestoes = categorias.filter((x) => x.tema !== 'outros' && x.volume >= MIN_COMENTARIOS).map((x) => {
    const pot = Math.max(x.potencial_compartilhamento ?? 0.5, x.potencial_salvamento ?? 0.5);
    const score = Math.round(30 * Math.min(1, (x.volume + x.recorrencia * 2) / (maxVol + 2)) + 15 * Math.min(1, Math.max(0, (x.crescimento_pct ?? 0) / 100)) + 25 * Math.min(1, pot / 2) + 15 * (x.compativel_posicionamento ? 1 : 0) + 10 * (x.potencial_serie ? 1 : 0) + 5 * Math.min(1, x.potencial_comercial / 3));
    const grupo = perguntas.find((g) => g.tema === x.tema) || dores.find((g) => g.tema === x.tema);
    const fmt = (() => { const ps = maduros.filter((p) => C.temaDe(p.legenda).id === x.tema); const por = {}; for (const p of ps) (por[p.tipo] ||= []).push(p); const best = Object.entries(por).map(([k, v]) => [k, C.resumoGrupo(v)]).filter(([, r]) => r.n >= 3).sort((a, b) => (b[1].resultado ?? 0) - (a[1].resultado ?? 0))[0]; return best ? FORMATO[best[0]] : null; })();
    const problema = (x.classes.duvida || x.classes.pergunta) ? 'A audiência pergunta e não entende' : (x.classes.critica || x.classes.discordancia) ? 'A audiência discorda ou desconfia' : 'A audiência traz o assunto por conta própria';
    return {
      tema: x.nome, tema_id: x.tema, score,
      evidencia: `${x.volume} comentários (${x.ultimos_14d} nos últimos 14 dias)${grupo ? `; pergunta recorrente ${grupo.n}×: "${grupo.exemplo}"` : ''}${x.posts ? `; ${x.posts} posts do tema medidos` : '; nenhum post do tema medido ainda'}.`,
      publico: x.potencial_comercial ? 'Quem já pensa em resolver isso no próprio negócio' : 'Seguidores que comentam o tema',
      problema, angulo: grupo ? `Responder a pergunta "${grupo.exemplo.slice(0, 90)}" mostrando quem ganha, quem paga e qual é o jogo.` : `Explicar a estratégia escondida em ${x.nome.toLowerCase()} a partir do que a audiência comentou.`,
      formato: fmt || 'Sem dado de formato para o tema: testar Reel',
      objetivo: x.potencial_comercial ? 'autoridade' : x.crescimento_pct > 0 ? 'descoberta' : 'identidade',
      justificativa: [x.potencial_compartilhamento != null ? `envios do tema ${x.potencial_compartilhamento}× a mediana do perfil` : 'sem posts suficientes do tema para medir envios', x.compativel_posicionamento ? 'combina com os pilares do DNA' : 'fora dos pilares do DNA', x.potencial_serie ? 'perguntas suficientes para uma série' : null].filter(Boolean).join('; '),
    };
  }).sort((a, b) => b.score - a.score).slice(0, 8);

  return {
    total_comentarios: comentarios.length, considerados: cs.length, spam: comentarios.length - cs.length,
    categorias, radar: { crescentes, perguntas_frequentes: perguntas.slice(0, 8), dores_recorrentes: dores.slice(0, 8), saturados, controversos, comunidade }, sugestoes,
    regras: { score: 'Comparativo de 0 a 100 (volume e recorrência 30, crescimento 15, envio/salvamento real 25, posicionamento 15, série 10, comercial 5). Não prevê alcance.', minimo: `${MIN_COMENTARIOS} comentários por tema` },
    fontes_indisponiveis: ['Comentários de concorrentes: a Graph API não entrega o texto de comentários de outras contas.', 'DMs e respostas a Stories: exigem webhooks e permissões de mensagens que o app não tem.'],
  };
}

module.exports = { analisar, agruparPerguntas, MIN_COMENTARIOS };
