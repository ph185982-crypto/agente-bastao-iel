// Regras puras da esteira semanal: datas da semana, distribuição dos itens
// nos dias de postagem e sugestão de formato. Sem DOM e sem rede — roda no
// navegador (window.EsteiraCore) e no Node (require), pra ter teste e pro
// backend usar a mesma regra do front.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EsteiraCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FORMATS = ['carrossel', 'corte_tv', 'roteiro'];

  // Os 4 primeiros são os modelos virais (static/viralPlaybook.js); os demais
  // são os tipos antigos do módulo de carrossel.
  const CAROUSEL_TYPES = {
    antes_agora: 'Antes × Agora',
    print: 'Print do Pedro',
    noticia: 'Notícia humana',
    lista: 'Lista editorial',
    padrao: 'Padrão',
    arquivo: 'Arquivo Secreto',
    boas_noticias: 'Boas Notícias',
    comecou: 'Começou',
    trending: 'Em alta',
  };
  const VIRAL_TYPES = ['antes_agora', 'print', 'noticia', 'lista'];

  const DEFAULT_CONFIG = {
    pillars: [
      'negócios e vendas online',
      'marketing digital e tráfego',
      'e-commerce e marketplaces',
      'curiosidades e fatos surpreendentes',
      'boas notícias do Brasil',
    ],
    weekly_goal: 5,
    posting_days: [1, 2, 3, 4, 5], // 0 = domingo … 6 = sábado
    hidden_modules: ['videoIA'],
    video_template: 'viral', // template do corte TV produzido pela fila
  };

  const pad = (n) => String(n).padStart(2, '0');

  function toISODate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseISODate(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Semana começa na segunda-feira.
  function weekStart(date = new Date()) {
    const d = typeof date === 'string' ? parseISODate(date) : new Date(date);
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return toISODate(d);
  }

  function weekDays(start) {
    const base = parseISODate(start);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return toISODate(d);
    });
  }

  function addDays(iso, n) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  // Coloca nos dias de postagem os itens da semana que ainda não têm dia
  // (ou cujo dia caiu fora da semana). Itens já agendados ficam onde estão.
  // Regras: carga equilibrada entre os dias (1 por dia enquanto der) e evitar
  // o mesmo formato em dias seguidos.
  // fromDate (opcional): dias antes dele já passaram e não recebem item novo.
  function distribute(items, config, start, fromDate) {
    const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
    const days = weekDays(start);
    let slots = days.filter((iso) => cfg.posting_days.includes(parseISODate(iso).getDay()));
    if (!slots.length) slots = days.slice(0, 5);
    if (fromDate) {
      const futuros = slots.filter((d) => d >= fromDate);
      slots = futuros.length ? futuros : [days.find((d) => d >= fromDate) || days[6]];
    }

    const out = items.map((it) => ({ ...it }));
    const load = Object.fromEntries(days.map((d) => [d, 0]));
    const formatsOn = Object.fromEntries(days.map((d) => [d, new Set()]));
    for (const it of out) {
      if (it.scheduled_date && load[it.scheduled_date] !== undefined) {
        load[it.scheduled_date] += 1;
        formatsOn[it.scheduled_date].add(it.format);
      }
    }

    const pending = out.filter((it) => !it.scheduled_date || load[it.scheduled_date] === undefined);
    for (const it of pending) {
      const minLoad = Math.min(...slots.map((d) => load[d]));
      const candidates = slots.filter((d) => load[d] === minLoad);
      const clash = (d) =>
        formatsOn[addDays(d, -1)]?.has(it.format) || formatsOn[addDays(d, 1)]?.has(it.format);
      const pick = candidates.find((d) => !clash(d)) || candidates[0];
      it.scheduled_date = pick;
      load[pick] += 1;
      formatsOn[pick].add(it.format);
    }
    return out;
  }

  // Sugestão de formato quando a IA não está disponível. Prefere os modelos
  // virais; os tipos antigos ficam pros temas que pedem o visual deles.
  function suggestFormat(pauta) {
    const text = `${pauta.title || ''} ${pauta.summary || ''}`.toLowerCase();
    const pillar = String(pauta.pillar || '').toLowerCase();
    if (pauta.video_url) return { format: 'corte_tv', carousel_type: null };
    if (/\b(eu|minha|meu|bastidor|aprendi|como eu)\b/.test(text)) return { format: 'roteiro', carousel_type: null };
    if (/\b(segredo|proibid|oculto|secreto|escondid|mist[eé]rio)\w*/.test(text)) return { format: 'carrossel', carousel_type: 'arquivo' };
    if (/\b(19\d\d|20\d\d|r\$|pre[çc]o|caro|infla[çc]|sal[aá]rio|antes|hoje|custa)/.test(text)) return { format: 'carrossel', carousel_type: 'antes_agora' };
    if (/\b(erros|li[çc][õo]es|sinais|motivos|maneiras|h[aá]bitos|regras|marcas que)\b/.test(text) || /^\d+\s/.test(text)) return { format: 'carrossel', carousel_type: 'lista' };
    if (/boas not[ií]cias/.test(pillar) || /\b(fam[ií]lia|hist[oó]ria|recusad|conseguiu|virou dono|dona de)\w*/.test(text)) return { format: 'carrossel', carousel_type: 'noticia' };
    return { format: 'carrossel', carousel_type: 'print' };
  }

  // Semana que recebe pauta aprovada hoje: a atual, se ainda tiver dia de
  // postagem pela frente; senão a próxima.
  function targetWeek(config, today = new Date()) {
    const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
    const hoje = typeof today === 'string' ? today : toISODate(today);
    const cur = weekStart(hoje);
    const restam = weekDays(cur).some((d) => d >= hoje && cfg.posting_days.includes(parseISODate(d).getDay()));
    return restam ? cur : addDays(cur, 7);
  }

  function summarizeWeek(items) {
    const active = items.filter((i) => i.status !== 'descartado');
    return {
      total: active.length,
      prontos: active.filter((i) => i.status === 'pronto' || i.status === 'postado').length,
      postados: active.filter((i) => i.status === 'postado').length,
    };
  }

  // Resumo de desempenho (fase 2): qual formato e qual pilar rendeu mais,
  // pela média de views+curtidas registradas manualmente.
  function performanceSummary(items) {
    const withMetrics = items.filter((i) => i.metrics && (Number(i.metrics.views) || Number(i.metrics.likes)));
    if (!withMetrics.length) return null;
    const score = (i) => (Number(i.metrics.views) || 0) + 10 * (Number(i.metrics.likes) || 0);
    const best = (key) => {
      const acc = {};
      for (const i of withMetrics) {
        const k = i[key] || '—';
        acc[k] = acc[k] || { soma: 0, n: 0 };
        acc[k].soma += score(i);
        acc[k].n += 1;
      }
      return Object.entries(acc)
        .map(([k, v]) => ({ chave: k, media: Math.round(v.soma / v.n), n: v.n }))
        .sort((a, b) => b.media - a.media);
    };
    return { formatos: best('format'), pilares: best('pillar'), amostra: withMetrics.length };
  }

  return {
    FORMATS, CAROUSEL_TYPES, VIRAL_TYPES, DEFAULT_CONFIG,
    toISODate, parseISODate, weekStart, weekDays, addDays,
    distribute, targetWeek, suggestFormat, summarizeWeek, performanceSummary,
  };
});
