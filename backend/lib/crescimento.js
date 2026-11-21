// Growth Dashboard e Diagnóstico de crescimento do @pedro_destrava. Funções PURAS sobre os posts que a ferramenta já lê da Meta
// (meuInstagram.js + o arquivo de posts do placar.js). Regras desta camada:
//  - Nada simulado: o que a Meta não entrega aparece como indisponível, com o motivo. Ausência não é zero.
//  - Mediana, nunca média; formatos separados (Reel e carrossel não se comparam direto); amostra mínima por grupo.
//  - Nada de "vencedor" abaixo da amostra mínima: o texto diz quantos posts faltam.
//  - As recomendações são REGRAS sobre esses números (sem IA, sem custo): cada frase traz a evidência que a gerou.
const MI = require('./meuInstagram');

const MIN_AMOSTRA = 5;          // por grupo, para dizer "suficiente"
const MIN_INDICIO = 3;          // abaixo disso nem indício
const RAZAO_DESTAQUE = 1.3;     // grupo com mediana 30% acima/abaixo da geral vira aprendizado
const DIA = 86400000;
const arred = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const mil = (parte, alc) => (parte == null || !alc ? null : (parte / alc) * 1000);
const med = (xs) => MI.mediana(xs.filter((x) => x != null && Number.isFinite(x)));
const soma = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ROTULO_FORMATO = { reel: 'Reel', carrossel: 'Carrossel', imagem: 'Imagem', video: 'Vídeo' };

// Tema por palavras da legenda: APROXIMADO (a legenda é tudo o que a Meta devolve). O painel avisa disso.
const TEMAS = [
  { id: 'ia', nome: 'Inteligência artificial', pilar: 'marketplace_empreender', rx: /\b(intelig[eê]ncia artificial|chatgpt|gpt|openai|\bia\b|rob[oô]s?|algoritmo)\b/ },
  { id: 'tecnologia', nome: 'Tecnologia', pilar: 'marketplace_empreender', rx: /\b(tecnologia|aplicativo|app|celular|iphone|google|apple|tesla|software|internet|startup)\b/ },
  { id: 'marketplace', nome: 'Marketplace', pilar: 'marketplace_empreender', rx: /\b(marketplace|mercado livre|shopee|amazon|shein|tiktok shop|magalu|loja virtual|e-?commerce|dropshipping)\b/ },
  { id: 'empreendedorismo', nome: 'Empreendedorismo', pilar: 'marketplace_empreender', rx: /\b(empreend|mei\b|cnpj|startup|neg[oó]cio|empres[aá]rio|sócio|socio|franquia)/ },
  { id: 'empresas', nome: 'Empresas', pilar: 'curiosidade_cotidiano', rx: /\b(empresa|marca|lucro|faturamento|bilion|milion|ceo|fundador|multinacional)/ },
  { id: 'dinheiro', nome: 'Dinheiro', pilar: 'dinheiro_consumo', rx: /\b(dinheiro|pre[cç]o|barato|caro|desconto|pagar|pago|taxa|juros|d[ií]vida|cart[aã]o|pix|invest|sal[aá]rio|renda|r\$)/ },
  { id: 'economia', nome: 'Economia', pilar: 'dinheiro_consumo', rx: /\b(economia|infla[cç][aã]o|imposto|tribut|selic|d[oó]lar|pib|banco central|reforma|governo)/ },
  { id: 'politica', nome: 'Política', pilar: 'opiniao_fiscalizacao', rx: /\b(pol[ií]tic|lula|bolsonaro|congresso|senado|stf|deputad|presidente|elei[cç][aã]o|ministro)/ },
  { id: 'comportamento', nome: 'Comportamento do consumidor', pilar: 'dinheiro_consumo', rx: /\b(consumidor|cliente|compra|psicolog|comportamento|vício|vicio|gatilho|persuas)/ },
  { id: 'curiosidade', nome: 'Curiosidades', pilar: 'curiosidade_cotidiano', rx: /\b(curiosidade|voc[eê] sabia|descobr|origem|hist[oó]ria d|por que|segredo|ningu[eé]m percebe|escondid)/ },
];
function temaDe(legenda) {
  const t = semAcento(legenda); const achados = [];
  for (const x of TEMAS) { const m = String(legenda || '').toLowerCase().match(new RegExp(x.rx.source, 'g')) || t.match(new RegExp(semAcento(x.rx.source), 'g')); if (m) achados.push([x, m.length]); }
  if (!achados.length) return { id: 'outros', nome: 'Outros / sem tema claro', pilar: null };
  achados.sort((a, b) => b[1] - a[1]); return achados[0][0];
}

const resultado = (p) => { const e = mil(p.compartilhamentos, p.alcance); const s = mil(p.salvamentos, p.alcance); return e == null && s == null ? null : (e || 0) + (s || 0); };
const medidas = (p) => ({
  envios_mil: mil(p.compartilhamentos, p.alcance), salvos_mil: mil(p.salvamentos, p.alcance), curtidas_mil: mil(p.curtidas, p.alcance),
  visitas_mil: mil(p.visitas_ao_perfil, p.alcance), seguidores_mil: mil(p.seguidores_ganhos, p.alcance), resultado: resultado(p),
});
function resumoGrupo(ps) {
  const x = ps.filter((p) => p.alcance); const m = x.map(medidas);
  const seg = x.filter((p) => p.seguidores_ganhos != null);
  return {
    n: x.length, amostra: x.length >= MIN_AMOSTRA ? 'suficiente' : x.length >= MIN_INDICIO ? 'indicio' : 'insuficiente',
    alcance: arred(med(x.map((p) => p.alcance)), 0), envios_mil: arred(med(m.map((q) => q.envios_mil))), salvos_mil: arred(med(m.map((q) => q.salvos_mil))),
    curtidas_mil: arred(med(m.map((q) => q.curtidas_mil))), resultado: arred(med(m.map((q) => q.resultado))),
    seguidores: seg.length ? seg.reduce((s, p) => s + p.seguidores_ganhos, 0) : null, n_com_seguidores: seg.length,
  };
}

// Junta a foto dos últimos 90 dias com o arquivo de posts (a foto vence: é mais recente).
function juntarPosts(snapshotPosts = [], arquivo = []) {
  const por = new Map((arquivo || []).map((p) => [String(p.id), { ...p, maduro: true }]));
  for (const p of snapshotPosts || []) por.set(String(p.id), p);
  return [...por.values()].sort((a, b) => Date.parse(b.publicado_em) - Date.parse(a.publicado_em));
}
const noIntervalo = (ps, de, ate) => ps.filter((p) => { const t = Date.parse(p.publicado_em); return t >= de && t < ate; });

function delta(atual, anterior) { return atual == null || anterior == null || !anterior ? null : arred(((atual - anterior) / Math.abs(anterior)) * 100, 0); }

// Série diária da conta (follower_count, últimos 30 dias): soma dos dias dentro do intervalo; null se o intervalo sai da série.
function somaSerie(serie, de, ate) {
  const pts = (serie || []).filter((x) => x.valor != null);
  if (!pts.length) return { valor: null, cobertura: 0 };
  const ini = Date.parse(pts[0].fim) - DIA; const fim = Date.parse(pts[pts.length - 1].fim);
  if (de < ini - 1000 || ate > fim + DIA) return { valor: null, cobertura: 0, fora: true };
  const dentro = pts.filter((x) => { const t = Date.parse(x.fim); return t > de && t <= ate + 3600000; });
  return { valor: dentro.length ? dentro.reduce((s, x) => s + x.valor, 0) : null, cobertura: dentro.length };
}

const kpi = (id, rotulo, valor, { anterior = null, unidade = '', nota = null, indisponivel = null, n = null } = {}) =>
  ({ id, rotulo, valor: indisponivel ? null : (valor == null ? null : valor), anterior: indisponivel ? null : anterior, variacao_pct: indisponivel ? null : delta(valor, anterior), unidade, n, disponivel: !indisponivel && valor != null, motivo: indisponivel || (valor == null ? 'Sem dado no período.' : null), nota });

function dmsNoIntervalo(dms = [], de, ate) {
  const ini = (sem) => { const [a, w] = sem.split('-W').map(Number); const j4 = Date.UTC(a, 0, 4); const d = new Date(j4); const dia = d.getUTCDay() || 7; return Date.UTC(a, 0, 4 - (dia - 1) + (w - 1) * 7); };
  const lis = (dms || []).filter((x) => /^\d{4}-W\d{2}$/.test(x.semana || '')).filter((x) => { const t = ini(x.semana); return t >= de - 6 * DIA && t < ate; });
  if (!lis.length) return null;
  return { dms: lis.reduce((s, x) => s + (x.dms || 0), 0), qualificadas: soma(lis.map((x) => x.qualificadas)) };
}

// Aprendizados sobre temas e formatos (só com amostra suficiente).
function achados(maduros) {
  const geral = resumoGrupo(maduros); const base = geral.resultado;
  const lista = [];
  const grupos = (rotulo, chave, nome) => {
    const m = new Map();
    for (const p of maduros) { const k = chave(p); if (!m.has(k.id)) m.set(k.id, { ...k, ps: [] }); m.get(k.id).ps.push(p); }
    for (const g of m.values()) {
      const r = resumoGrupo(g.ps);
      if (r.amostra === 'insuficiente' || g.id === 'outros') continue;
      lista.push({ dimensao: rotulo, id: g.id, nome: nome(g), ...r, razao: base && r.resultado != null ? arred(r.resultado / base, 2) : null, participacao_pct: arred((r.n / Math.max(1, maduros.length)) * 100, 0) });
    }
  };
  grupos('tema', (p) => temaDe(p.legenda), (g) => g.nome);
  grupos('formato', (p) => ({ id: p.tipo }), (g) => ROTULO_FORMATO[g.id] || g.id);
  return { geral, achados: lista };
}

const quantosFaltam = (n) => Math.max(0, MIN_AMOSTRA - n);

function painel({ posts = [], serie = null, seguidores = null, agora = Date.now(), dias = 30, de = null, ate = null, dms = [], gerado_em = null } = {}) {
  const fim = ate != null ? Number(ate) : agora; const ini = de != null ? Number(de) : fim - dias * DIA; const span = fim - ini;
  const atuais = noIntervalo(posts, ini, fim); const antes = noIntervalo(posts, ini - span, ini);
  const mad = (ps) => ps.filter((p) => p.maduro && p.alcance); const mAt = mad(atuais); const mAn = mad(antes);
  const reels = (ps) => ps.filter((p) => (p.tipo === 'reel' || p.tipo === 'video') && p.tempo_medio_s != null);
  const g = resumoGrupo(mAt); const gA = resumoGrupo(mAn);
  const temAnterior = mAn.length >= MIN_INDICIO;
  const segAt = somaSerie(serie?.follower_count, ini, fim); const segAn = somaSerie(serie?.follower_count, ini - span, ini);
  const feed = (ps) => ps.filter((p) => p.tipo === 'carrossel' || p.tipo === 'imagem');
  const visitas = soma(feed(mAt).map((p) => p.visitas_ao_perfil)); const visitasAn = soma(feed(mAn).map((p) => p.visitas_ao_perfil));
  const feedComSeg = feed(mAt).filter((p) => p.seguidores_ganhos != null && p.visitas_ao_perfil);
  const conv = feedComSeg.length ? soma(feedComSeg.map((p) => p.seguidores_ganhos)) / soma(feedComSeg.map((p) => p.visitas_ao_perfil)) * 100 : null;
  const dm = dmsNoIntervalo(dms, ini, fim);
  const nPoucos = (ps) => `${ps.length} posts maduros no período`;
  const kpis = [
    kpi('seguidores_atuais', 'Seguidores atuais', seguidores, { nota: 'Número da conta na última leitura.' }),
    kpi('seguidores_novos', 'Seguidores novos', segAt.valor, { anterior: segAn.valor, nota: 'Soma diária da Meta (follower_count). Só existe para os últimos 30 dias.', indisponivel: segAt.fora ? 'A Meta entrega a série diária só dos últimos 30 dias; este período sai dela.' : null }),
    kpi('seguidores_perdidos', 'Seguidores perdidos', null, { indisponivel: 'A Meta não informa quem deixou de seguir por esta conexão.' }),
    kpi('alcance_mediana', 'Alcance mediano por post', g.alcance, { anterior: temAnterior ? gA.alcance : null, n: g.n, nota: nPoucos(mAt) }),
    kpi('visualizacoes', 'Visualizações (posts do período)', soma(mAt.map((p) => p.visualizacoes)), { anterior: temAnterior ? soma(mAn.map((p) => p.visualizacoes)) : null, n: g.n, nota: 'Soma das visualizações dos posts publicados no período.' }),
    kpi('visitas_perfil', 'Visitas ao perfil (posts de feed)', visitas, { anterior: temAnterior ? visitasAn : null, nota: 'A Meta só informa visitas por post de feed, não de Reel.', n: feed(mAt).length }),
    kpi('conversao_visita_seguidor', 'Visitas que viraram seguidores (feed)', arred(conv, 1), { unidade: '%', nota: 'Seguidores ganhos ÷ visitas ao perfil, só posts de feed com os dois dados.', n: feedComSeg.length }),
    kpi('envios', 'Compartilhamentos (soma)', soma(mAt.map((p) => p.compartilhamentos)), { anterior: temAnterior ? soma(mAn.map((p) => p.compartilhamentos)) : null, n: g.n }),
    kpi('envios_mil', 'Compartilhamentos por mil alcançados', g.envios_mil, { anterior: temAnterior ? gA.envios_mil : null, n: g.n, nota: 'Mediana por post.' }),
    kpi('salvos', 'Salvamentos (soma)', soma(mAt.map((p) => p.salvamentos)), { anterior: temAnterior ? soma(mAn.map((p) => p.salvamentos)) : null, n: g.n }),
    kpi('salvos_mil', 'Salvamentos por mil alcançados', g.salvos_mil, { anterior: temAnterior ? gA.salvos_mil : null, n: g.n, nota: 'Mediana por post.' }),
    kpi('curtidas_mil', 'Curtidas por mil alcançados', g.curtidas_mil, { anterior: temAnterior ? gA.curtidas_mil : null, n: g.n, nota: 'Mediana por post; curtida oculta pelo perfil não entra.' }),
    kpi('comentarios', 'Comentários (soma)', soma(mAt.map((p) => p.comentarios)), { anterior: temAnterior ? soma(mAn.map((p) => p.comentarios)) : null, n: g.n }),
    kpi('tempo_medio_s', 'Tempo médio assistido (Reels)', arred(med(reels(mAt).map((p) => p.tempo_medio_s))), { anterior: temAnterior ? arred(med(reels(mAn).map((p) => p.tempo_medio_s))) : null, unidade: 's', n: reels(mAt).length, nota: 'Mediana dos Reels do período.' }),
    kpi('retencao_pct', 'Retenção (% do vídeo assistido)', arred(med(reels(mAt).map((p) => p.assistido_pct).filter((x) => x != null)), 0), { unidade: '%', n: reels(mAt).filter((p) => p.assistido_pct != null).length, nota: 'Só vídeos editados aqui (a duração é conhecida).' }),
    kpi('conclusao', 'Taxa de conclusão', null, { indisponivel: 'A Meta não entrega esta métrica por esta conexão.' }),
    kpi('cliques', 'Cliques', null, { indisponivel: 'Ainda não há coleta de cliques (link na bio e botões de Stories).' }),
    kpi('leads_dms', 'DMs por palavra-chave (digitadas)', dm?.dms ?? null, { nota: 'Digitadas por você em Conta aberta → Porta de entrada; não há leitura automática de DMs.', indisponivel: dm ? null : 'Nenhuma DM registrada no período.' }),
    kpi('diagnosticos', 'Diagnósticos', null, { indisponivel: 'Sem registro: o funil de conversão é a fase P4 e ainda não foi construído.' }),
    kpi('conversoes', 'Conversões (clientes)', null, { indisponivel: 'Sem registro: o funil de conversão é a fase P4 e ainda não foi construído.' }),
  ];
  const { achados: ac, geral } = achados(mAt.length >= MIN_INDICIO ? mAt : []);
  const formatos = ['reel', 'carrossel', 'imagem', 'video'].map((f) => ({ formato: f, rotulo: ROTULO_FORMATO[f], ...resumoGrupo(mAt.filter((p) => p.tipo === f)) })).filter((x) => x.n);
  const acima = ac.filter((a) => a.amostra === 'suficiente' && a.razao != null && a.razao >= RAZAO_DESTAQUE).sort((a, b) => b.razao - a.razao);
  const abaixo = ac.filter((a) => a.amostra === 'suficiente' && a.razao != null && a.razao <= 1 / RAZAO_DESTAQUE).sort((a, b) => a.razao - b.razao);
  const cap = (n) => String(n).charAt(0).toLowerCase() + String(n).slice(1);
  const decisao = { funciona: [], nao_funciona: [], aprendizado: null, oportunidade: null, proxima_acao: null, dados_suficientes: mAt.length >= MIN_AMOSTRA };
  for (const a of acima.slice(0, 3)) decisao.funciona.push(`${a.nome} (${a.dimensao}): mediana de ${a.resultado} envios+salvos por mil, ${a.razao}× a mediana geral (${geral.resultado}), em ${a.n} posts.`);
  for (const a of abaixo.slice(0, 3)) decisao.nao_funciona.push(`${a.nome} (${a.dimensao}): mediana de ${a.resultado} envios+salvos por mil, ${arred(1 / a.razao, 2)}× abaixo da mediana geral (${geral.resultado}), em ${a.n} posts.`);
  if (!mAt.length) {
    decisao.aprendizado = 'Sem posts maduros neste período: não há o que interpretar ainda.';
    decisao.proxima_acao = 'Atualize os números em Resultados para trazer os posts mais recentes.';
  } else if (mAt.length < MIN_AMOSTRA) {
    decisao.aprendizado = `Só ${mAt.length} post(s) maduro(s) no período; preciso de ${MIN_AMOSTRA} para comparar. Faltam ${quantosFaltam(mAt.length)}.`;
    decisao.proxima_acao = `Continue publicando e use o período de 90 dias para ter amostra. Nada será declarado "vencedor" antes disso.`;
  } else if (acima.length) {
    const top = acima[0];
    decisao.aprendizado = `${top.nome} (${top.dimensao}) está ${top.razao}× acima da mediana geral em envios+salvos por mil (${top.n} posts). É um indício a testar, não uma regra: tema, horário e capa se misturam.`;
    const raro = acima.find((a) => a.participacao_pct <= 25 && a.dimensao === 'tema');
    if (raro) { decisao.oportunidade = `${raro.nome} rende ${raro.razao}× a mediana, mas foi só ${raro.participacao_pct}% dos posts do período.`; decisao.proxima_acao = `Testar uma série de 3 posts de ${cap(raro.nome)} e comparar com a mediana geral (${geral.resultado}) quando tiver ${MIN_AMOSTRA} posts.`; }
    else decisao.proxima_acao = `Manter ${cap(top.nome)} e medir de novo daqui a 2 semanas.`;
  } else {
    decisao.aprendizado = `Com ${mAt.length} posts maduros, nenhum tema ou formato se destaca ${RAZAO_DESTAQUE}× da mediana geral (${geral.resultado} envios+salvos por mil). Não há aprendizado confiável ainda.`;
    decisao.proxima_acao = 'Variar um fator por vez (tema ou formato) para o próximo período mostrar diferença.';
  }
  const topPosts = [...mAt].map((p) => ({ id: p.id, tipo: p.tipo, permalink: p.permalink || null, legenda: p.legenda, alcance: p.alcance, resultado: arred(resultado(p)) })).filter((p) => p.resultado != null).sort((a, b) => b.resultado - a.resultado);
  return {
    periodo: { de: new Date(ini).toISOString(), ate: new Date(fim).toISOString(), dias: Math.round(span / DIA) },
    anterior: { de: new Date(ini - span).toISOString(), ate: new Date(ini).toISOString(), n_posts: mAn.length, comparavel: temAnterior },
    posts: { total: atuais.length, maduros: mAt.length, ainda_acumulando: atuais.length - mAt.length },
    kpis, formatos, temas: ac.filter((a) => a.dimensao === 'tema'), decisao,
    melhores: topPosts.slice(0, 3), piores: topPosts.slice(-3).reverse(),
    regras: { amostra_minima: MIN_AMOSTRA, destaque: `${RAZAO_DESTAQUE}× a mediana geral`, medida: 'envios + salvamentos por mil alcançados (mediana), só posts com mais de 72 h', tema: 'Tema inferido pelas palavras da legenda: aproximação.' },
    gerado_em,
  };
}

// ── Diagnóstico do posicionamento: períodos A (antigo), B (transição), C (atual), com as datas que o Pedro escolheu ──
function diagnostico({ posts = [], transicao = {}, pilares = [], agora = Date.now() } = {}) {
  const b = transicao?.inicio_b ? Date.parse(transicao.inicio_b) : null; const c = transicao?.inicio_c ? Date.parse(transicao.inicio_c) : null;
  if (!b || !c) return { configurado: false, instrucao: 'Defina em Ajustes → DNA Editorial a data em que a transição começou e a data em que o novo posicionamento passou a valer. O sistema não escolhe essas datas por você.' };
  const maduros = posts.filter((p) => p.maduro && p.alcance);
  const periodos = { A: { rotulo: 'Posicionamento antigo', ps: noIntervalo(maduros, 0, b) }, B: { rotulo: 'Transição', ps: noIntervalo(maduros, b, c) }, C: { rotulo: 'Posicionamento atual', ps: noIntervalo(maduros, c, agora + DIA) } };
  const out = {};
  for (const [k, v] of Object.entries(periodos)) {
    const por_formato = ['reel', 'carrossel', 'imagem', 'video'].map((f) => ({ formato: f, rotulo: ROTULO_FORMATO[f], ...resumoGrupo(v.ps.filter((p) => p.tipo === f)) })).filter((x) => x.n);
    const { achados: ac } = achados(v.ps.length >= MIN_INDICIO ? v.ps : []);
    const top = (campo) => [...v.ps].filter((p) => p[campo] != null).sort((x, y) => y[campo] - x[campo]).slice(0, 3).map((p) => ({ id: p.id, tipo: p.tipo, legenda: p.legenda, permalink: p.permalink || null, valor: p[campo] }));
    const feed = v.ps.filter((p) => p.visitas_ao_perfil != null && p.seguidores_ganhos != null);
    const medV = med(feed.map((p) => mil(p.visitas_ao_perfil, p.alcance)));
    const baixaConv = medV ? feed.filter((p) => mil(p.visitas_ao_perfil, p.alcance) >= medV * 1.5 && mil(p.seguidores_ganhos, p.alcance) <= 0.05).slice(0, 3).map((p) => ({ id: p.id, legenda: p.legenda, permalink: p.permalink || null })) : [];
    const dur = (lo, hi) => resumoGrupo(v.ps.filter((p) => (p.tipo === 'reel' || p.tipo === 'video') && p.duracao_s && p.duracao_s >= lo && p.duracao_s < hi));
    out[k] = {
      rotulo: v.rotulo, ...resumoGrupo(v.ps), por_formato,
      temas: ac.filter((a) => a.dimensao === 'tema'),
      maiores: { alcance: top('alcance'), compartilhamentos: top('compartilhamentos'), salvamentos: top('salvamentos'), seguidores: top('seguidores_ganhos'), visitas: top('visitas_ao_perfil') },
      alta_visita_baixa_conversao: baixaConv,
      duracao_reels: { ate_30s: dur(0, 30), de_30_a_60s: dur(30, 60), acima_60s: dur(60, 1e9) },
    };
  }
  const A = out.A; const C = out.C; const B = out.B;
  const comp = (campo) => (A.amostra === 'suficiente' && C.amostra === 'suficiente' && A[campo] != null && C[campo] != null ? { a: A[campo], c: C[campo], razao: arred(C[campo] / A[campo], 2) } : null);
  const comparacoes = { envios_mil: comp('envios_mil'), salvos_mil: comp('salvos_mil'), alcance: comp('alcance'), curtidas_mil: comp('curtidas_mil') };
  const forcas = []; const fraquezas = []; const manter = []; const parar = []; const testar = []; const oportunidades = [];
  const nome = { envios_mil: 'envios por mil alcançados', salvos_mil: 'salvamentos por mil alcançados', alcance: 'alcance mediano', curtidas_mil: 'curtidas por mil alcançados' };
  for (const [k, v] of Object.entries(comparacoes)) {
    if (!v) continue;
    const t = `${nome[k]}: mediana ${v.c} no posicionamento atual contra ${v.a} no antigo (${v.razao}×; ${C.n} e ${A.n} posts).`;
    if (v.razao >= RAZAO_DESTAQUE) forcas.push(t); else if (v.razao <= 1 / RAZAO_DESTAQUE) fraquezas.push(t);
  }
  const temasC = (C.temas || []).filter((t) => t.amostra === 'suficiente');
  for (const t of temasC) { if (t.razao >= RAZAO_DESTAQUE) { manter.push(`${t.nome}: ${t.razao}× a mediana do período atual (${t.n} posts).`); if (t.participacao_pct <= 25) oportunidades.push(`${t.nome} rende acima da média mas é só ${t.participacao_pct}% dos posts atuais.`); } else if (t.razao <= 1 / RAZAO_DESTAQUE) parar.push(`${t.nome}: ${arred(1 / t.razao, 2)}× abaixo da mediana do período atual (${t.n} posts). Reduza e meça de novo antes de cortar.`); }
  if (C.alta_visita_baixa_conversao.length) fraquezas.push(`${C.alta_visita_baixa_conversao.length} post(s) atual(is) levaram gente ao perfil que não virou seguidor: revise a primeira tela do perfil e o CTA.`);
  if (!C.por_formato.length) testar.push('Sem posts maduros no período atual: publique e volte aqui após 72 h.');
  for (const f of C.por_formato) if (f.amostra !== 'suficiente') testar.push(`${f.rotulo}: só ${f.n} post(s) no período atual; faltam ${quantosFaltam(f.n)} para uma leitura confiável.`);
  if (A.n < MIN_AMOSTRA || C.n < MIN_AMOSTRA) fraquezas.push(`A comparação antigo × atual ainda não é confiável: ${A.n} posts no período antigo e ${C.n} no atual (mínimo ${MIN_AMOSTRA} em cada). O arquivo cresce a cada leitura diária.`);
  const pilaresReal = {};
  for (const p of C.n ? periodos.C.ps : []) { const t = temaDe(p.legenda); const k = t.pilar || 'sem_pilar'; pilaresReal[k] = (pilaresReal[k] || 0) + 1; }
  const distribuicao = (pilares || []).map((p) => ({ id: p.id, nome: p.nome, hipotese_pct: p.pct, real_pct: C.n ? arred(((pilaresReal[p.id] || 0) / C.n) * 100, 0) : null }));
  const plano = [];
  if (testar.length) plano.push(`Fechar as lacunas de amostra: ${testar[0]}`);
  if (oportunidades.length) plano.push(`Fazer 3 posts do tema com melhor resposta e comparar: ${oportunidades[0]}`);
  if (parar.length) plano.push(`Reduzir um tema fraco por 2 semanas e medir: ${parar[0]}`);
  plano.push('Atualizar os números todo dia (a leitura é automática) e rever este diagnóstico em 30 dias.');
  return {
    configurado: true, transicao: { inicio_b: transicao.inicio_b, inicio_c: transicao.inicio_c }, periodos: out, comparacoes,
    relatorio: { forcas, fraquezas, manter, parar, testar, oportunidades, plano_30_dias: plano },
    pilares: { distribuicao, nota: 'Classificação por palavras da legenda: aproximada. Os percentuais dos pilares são hipóteses de teste.' },
    limitacoes: ['O histórico começa quando a ferramenta passou a arquivar os posts maduros; antes disso só existem os últimos 90 dias.', 'Presença do Pedro, tipo de narrativa, CTA e capa ainda não são marcados por post: entram no Growth Lab (fase P2).', 'Tema vem da legenda; formatos e períodos se misturam com horário e assunto, então vale como indício.'],
  };
}

module.exports = { painel, diagnostico, juntarPosts, temaDe, TEMAS, resumoGrupo, achados, medidas, MIN_AMOSTRA, RAZAO_DESTAQUE, somaSerie, dmsNoIntervalo };
