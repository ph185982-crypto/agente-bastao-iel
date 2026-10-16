// ── Esteira semanal (Semana / Pautas / Criar / Ajustes) ───────────────────────
// Camada nova por cima do app antigo. A aba "Criar" mostra o app antigo
// intacto (carrossel, cortes TV, reel por link); as outras três são daqui.
// Persistência: IndexedDB no aparelho. Se o servidor tiver cofre (Upstash),
// os metadados da fila também vão pra lá; arquivos sempre ficam no aparelho.
(function () {
  'use strict';
  const C = window.EsteiraCore;
  const FORMAT_LABEL = { carrossel: 'Post', corte_tv: 'Corte TV', roteiro: 'Roteiro' };
  const STATUS_LABEL = { aguardando: 'Aguardando', produzindo: 'Produzindo', pronto: 'Pronto', postado: 'Postado', erro: 'Erro' };
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const CRIAR_MODULES = [
    { id: 'carousels', label: 'Carrossel' },
    { id: 'tvcuts', label: 'Cortes TV' },
    { id: 'editor', label: 'Reel por link' },
    { id: 'reels', label: 'Reciclar' },
    { id: 'video', label: 'Vídeo IA', flag: 'videoIA' },
  ];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const ehLinkDePost = (url) => /instagram\.com|facebook\.com|fb\.watch/i.test(url || '');

  // ── IndexedDB ───────────────────────────────────────────────────────────────
  const DB = (() => {
    let dbp = null;
    const open = () => (dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('pico-esteira', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('assets');
        db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const run = async (store, mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(r?.result);
        tx.onerror = () => reject(tx.error);
      });
    };
    return {
      all: (store) => run(store, 'readonly', (s) => s.getAll()),
      get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
      put: (store, value, key) => run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
      del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    };
  })();

  // ── Estado ──────────────────────────────────────────────────────────────────
  const state = {
    tab: 'semana',
    criarModule: 'carousels',
    week: C.weekStart(new Date()),
    items: [],
    config: { ...C.DEFAULT_CONFIG },
    storage: 'local',
    pautas: [],
    pautasAt: null,
    pautasLoading: false,
    pautasError: null,
    insights: null,
    insightsLoading: false,
    insightsError: null,
    openScore: null,
    producing: false,
    moving: null,
    linkEditing: null,
    toast: null,
    dbOk: true,
  };
  const assetUrls = new Map(); // itemId -> [{type, url, name, text}]

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error || `Erro ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return opts.raw ? res : res.json();
  }

  async function loadAll() {
    try {
      state.items = (await DB.all('items')) || [];
      const cfg = await DB.get('kv', 'config');
      if (cfg) state.config = { ...C.DEFAULT_CONFIG, ...cfg };
      const ins = await DB.get('kv', 'insights');
      if (ins) state.insights = ins;
      const p = await DB.get('kv', 'pautas');
      if (p) { state.pautas = p.list || []; state.pautasAt = p.at || null; }
    } catch (e) {
      console.warn('[esteira] IndexedDB indisponível:', e);
      state.dbOk = false;
    }
    try {
      const r = await api('/api/queue/config');
      state.storage = r.storage;
      if (r.storage === 'upstash') {
        state.config = { ...state.config, ...r.config };
        const w = await api(`/api/queue/week?start=${state.week}`);
        mergeRemote(w.items || []);
      }
    } catch { /* sem rede: segue local */ }
  }

  function mergeRemote(remote) {
    const map = new Map(state.items.map((i) => [i.id, i]));
    for (const r of remote) {
      const local = map.get(r.id);
      if (!local || (r.updated_at || '') > (local.updated_at || '')) map.set(r.id, { ...local, ...r });
    }
    state.items = [...map.values()];
    state.items.forEach((i) => DB.put('items', i).catch(() => {}));
  }

  async function saveItem(item, { remoteCreate = false } = {}) {
    item.updated_at = new Date().toISOString();
    const idx = state.items.findIndex((i) => i.id === item.id);
    if (idx === -1) state.items.push(item); else state.items[idx] = item;
    if (state.dbOk) await DB.put('items', item).catch(() => {});
    if (state.storage === 'upstash') {
      const path = remoteCreate ? '/api/queue/items' : `/api/queue/items/${item.id}`;
      api(path, { method: remoteCreate ? 'POST' : 'PATCH', body: item }).catch((e) => console.warn('[esteira] sync falhou:', e.message));
    }
  }

  async function removeItem(id) {
    state.items = state.items.filter((i) => i.id !== id);
    assetUrls.get(id)?.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    assetUrls.delete(id);
    if (state.dbOk) { await DB.del('items', id).catch(() => {}); await DB.del('assets', id).catch(() => {}); }
    if (state.storage === 'upstash') api(`/api/queue/items/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function saveConfig(patch) {
    state.config = { ...state.config, ...patch };
    if (state.dbOk) await DB.put('kv', state.config, 'config').catch(() => {});
    if (state.storage === 'upstash') api('/api/queue/config', { method: 'PUT', body: state.config }).catch(() => {});
    applyHiddenModules();
  }

  // Arquivos do item: blobs no IndexedDB, URLs de objeto em memória.
  async function saveAssets(itemId, assets) {
    if (state.dbOk) await DB.put('assets', assets, itemId).catch(() => {});
    assetUrls.set(itemId, assets.map((a) => ({ ...a, url: a.blob ? URL.createObjectURL(a.blob) : null })));
  }
  async function getAssets(itemId) {
    if (assetUrls.has(itemId)) return assetUrls.get(itemId);
    if (!state.dbOk) return [];
    const stored = (await DB.get('assets', itemId).catch(() => null)) || [];
    const list = stored.map((a) => ({ ...a, url: a.blob ? URL.createObjectURL(a.blob) : null }));
    assetUrls.set(itemId, list);
    return list;
  }

  const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

  // ── Fila ────────────────────────────────────────────────────────────────────
  const weekItems = () => state.items
    .filter((i) => i.week_start === state.week)
    .sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || '') || (a.created_at || '').localeCompare(b.created_at || ''));

  const today = () => C.toISODate(new Date());
  // Primeira semana (a partir da atual) que ainda tem espaço: abaixo da meta
  // semanal e, na semana corrente, com dia de postagem livre pela frente.
  function targetWeek() {
    const hoje = today();
    const goal = state.config.weekly_goal || 5;
    let week = C.targetWeek(state.config, hoje);
    for (let n = 0; n < 8; n++, week = C.addDays(week, 7)) {
      const daSemana = state.items.filter((i) => i.week_start === week);
      if (daSemana.length >= goal) continue;
      if (week !== C.weekStart(hoje)) return week;
      const livres = C.weekDays(week).filter((d) => d >= hoje && state.config.posting_days.includes(C.parseISODate(d).getDay())).length;
      const ocupados = daSemana.filter((i) => (i.scheduled_date || '') >= hoje && i.status !== 'postado').length;
      if (ocupados < livres) return week;
    }
    return week;
  }

  async function approvePauta(pautaId) {
    const p = state.pautas.find((x) => x.id === pautaId);
    if (!p) return;
    const week = targetWeek();
    const now = new Date().toISOString();
    const item = {
      id: uid(), week_start: week, scheduled_date: null, status: 'aguardando',
      format: p.format, pillar: p.pillar || '', title: p.title, summary: p.summary || '',
      source_url: p.source_url || '', source_name: p.source_name || '',
      video_url: p.video_url || '', carousel_type: p.format === 'carrossel' ? (p.carousel_type || 'padrao') : null,
      caption: '', hashtags: [], source_credit: '', assets: [], metrics: null,
      created_at: now, updated_at: now,
    };
    const placed = C.distribute([...state.items.filter((i) => i.week_start === week), item], state.config, week, week === C.weekStart(today()) ? today() : null).find((i) => i.id === item.id);
    item.scheduled_date = placed.scheduled_date;
    await saveItem(item, { remoteCreate: true });
    state.week = week;
    await dropPauta(pautaId);
    const d = C.parseISODate(item.scheduled_date);
    toast(`Adicionado: ${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`);
  }

  async function dropPauta(pautaId) {
    state.pautas = state.pautas.filter((x) => x.id !== pautaId);
    if (state.dbOk) await DB.put('kv', { list: state.pautas, at: state.pautasAt }, 'pautas').catch(() => {});
    render();
  }

  // ── Leitura do perfil e aprendizado ──────────────────────────────────────
  // A API grátis tem 150 consultas/mês: lê sozinho no máximo a cada 3 dias.
  const INSIGHTS_TTL = 3 * 24 * 3600e3;
  const insightsVelho = () => !state.insights || Date.now() - Date.parse(state.insights.atualizado_em || 0) > INSIGHTS_TTL;
  const insightsCompacto = () => {
    if (!state.insights) return null;
    const { posts, ...rest } = state.insights;
    void posts;
    return rest;
  };

  async function fetchInsights(force = false) {
    if (state.insightsLoading) return;
    state.insightsLoading = true;
    state.insightsError = null;
    render();
    try {
      state.insights = await api(`/api/queue/insights${force ? '?force=1' : ''}`);
      if (state.dbOk) await DB.put('kv', state.insights, 'insights').catch(() => {});
      const n = await aprenderMetricas();
      if (n) toast(`Aprendi com ${n} post(s) publicado(s).`);
    } catch (e) {
      state.insightsError = e.message;
    } finally {
      state.insightsLoading = false;
      render();
    }
  }

  // Preenche views/curtidas dos itens postados casando a legenda com os
  // posts reais do perfil. É assim que a fila aprende sem digitação.
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  async function aprenderMetricas() {
    const posts = state.insights?.posts || [];
    let n = 0;
    for (const it of state.items.filter((i) => i.status === 'postado' && !(i.metrics && i.metrics.manual))) {
      const chave = norm(String(it.caption || it.title).split('\n')[0]).slice(0, 40);
      if (chave.length < 12) continue;
      const post = posts.find((p) => norm(p.legenda).startsWith(chave) || norm(p.legenda).includes(chave));
      if (!post) continue;
      const metrics = { views: post.views || 0, likes: post.likes || 0, comments: post.comments || 0, url: post.url, auto: true };
      if (JSON.stringify(metrics) !== JSON.stringify(it.metrics)) { await saveItem({ ...it, metrics }); n += 1; }
    }
    return n;
  }

  async function fetchPautas() {
    if (state.pautasLoading) return;
    state.pautasLoading = true;
    state.pautasError = null;
    render();
    try {
      const exclude_titles = state.items.map((i) => i.title);
      const performance = C.performanceSummary(state.items);
      const r = await api('/api/queue/suggest', { method: 'POST', body: { pillars: state.config.pillars, exclude_titles, performance, insights: insightsCompacto() } });
      state.pautas = r.pautas || [];
      state.pautasAt = Date.now();
      if (state.dbOk) await DB.put('kv', { list: state.pautas, at: state.pautasAt }, 'pautas').catch(() => {});
      if (!state.pautas.length) state.pautasError = 'Nenhuma pauta nova agora. Tente de novo mais tarde.';
    } catch (e) {
      state.pautasError = e.message;
    } finally {
      state.pautasLoading = false;
      render();
    }
  }

  // ── Produção (um item por vez, uma chamada por etapa) ───────────────────────
  async function produceItem(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item || item.status === 'produzindo') return;
    if (item.format === 'corte_tv' && !item.video_url) {
      state.linkEditing = id;
      toast('Cole o link do vídeo pra produzir esse corte.');
      render();
      return;
    }
    await saveItem({ ...item, status: 'produzindo', error: null });
    render();
    try {
      const done = item.format === 'corte_tv' ? await produceCorte(item) : await produceViaQueue(item);
      await saveItem({ ...state.items.find((i) => i.id === id), ...done, status: 'pronto', error: null });
    } catch (e) {
      await saveItem({ ...state.items.find((i) => i.id === id), status: 'erro', error: e.message || 'Falhou' });
    }
    render();
  }

  async function produceViaQueue(item) {
    const r = await api('/api/queue/produce', { method: 'POST', body: { item: { ...item, assets: undefined }, insights: insightsCompacto() } });
    const assets = [];
    for (const a of r.assets || []) {
      if (a.type === 'image') assets.push({ type: 'image', name: a.name, blob: await dataUrlToBlob(a.url) });
      else if (a.type === 'text') assets.push({ type: 'text', name: a.name, text: a.text, blob: new Blob([a.text], { type: 'text/plain' }) });
    }
    await saveAssets(item.id, assets);
    return {
      caption: r.caption, hashtags: r.hashtags || [], source_credit: r.source_credit || '',
      third_party: !!r.third_party, roteiro: r.roteiro || null,
      viral: r.viral || null, fontes: r.fontes || [], gancho: r.gancho || '', ganchos: r.ganchos || [],
      carousel_type: r.template && item.format === 'carrossel' ? r.template : item.carousel_type,
      assets: assets.map((a) => ({ type: a.type, name: a.name })),
    };
  }

  async function produceCorte(item) {
    const fonte = ehLinkDePost(item.video_url) ? { instagramUrl: item.video_url } : { videoUrl: item.video_url };
    const a = await api('/api/video-editor/analyze', { method: 'POST', body: { ...fonte, headline: '' } });
    const res = await api('/api/video-editor/render', {
      method: 'POST', raw: true,
      body: { ...fonte, headline: a.headline, caption: a.caption, crop: a.crop || null, template: state.config.video_template || 'viral' },
    });
    const blob = await res.blob();
    await saveAssets(item.id, [{ type: 'video', name: 'corte.mp4', blob }]);
    const pack = await api('/api/queue/caption', { method: 'POST', body: { item: { ...item, assets: undefined }, caption: a.caption } });
    return {
      caption: pack.caption, hashtags: pack.hashtags || [], source_credit: pack.source_credit || '',
      third_party: !!pack.third_party, headline: a.headline, assets: [{ type: 'video', name: 'corte.mp4' }],
    };
  }

  async function produceAll() {
    if (state.producing) return;
    state.producing = true;
    render();
    const fila = weekItems().filter((i) => (i.status === 'aguardando' || i.status === 'erro') && !(i.format === 'corte_tv' && !i.video_url));
    for (const it of fila) await produceItem(it.id);
    state.producing = false;
    const faltaLink = weekItems().filter((i) => i.format === 'corte_tv' && !i.video_url && i.status === 'aguardando').length;
    toast(faltaLink ? `Pronto. ${faltaLink} corte(s) aguardando link.` : 'Semana produzida.');
    render();
  }

  // ── Baixar / compartilhar ───────────────────────────────────────────────────
  // ZIP sem compressão (armazenamento puro), suficiente pra PNG.
  function crc32(bytes) {
    let t = crc32.t;
    if (!t) {
      t = crc32.t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function makeZipAsync(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const data = new Uint8Array(await f.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
      central.push(cen.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cenSize = central.reduce((s, b) => s + (b.byteLength ?? b.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  async function copyCaption(id) {
    const item = state.items.find((i) => i.id === id);
    const text = item?.caption || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    toast('Legenda copiada.');
  }

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg) {
    state.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast = null; renderToast(); }, 2600);
    renderToast();
  }
  function renderToast() {
    const el = root.querySelector('.es-toast-slot');
    if (el) el.innerHTML = state.toast ? `<div class="es-toast" role="status">${esc(state.toast)}</div>` : '';
  }

  // ── Ícones ──────────────────────────────────────────────────────────────────
  const ICON = {
    semana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    pautas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
    criar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="#fff"/><circle cx="15" cy="12" r="2" fill="#fff"/><circle cx="7" cy="18" r="2" fill="#fff"/></svg>',
  };

  // ── Telas ───────────────────────────────────────────────────────────────────
  function fmtDay(iso) {
    const d = C.parseISODate(iso);
    return { dow: DOW[d.getDay()], label: `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}`, num: d.getDay() };
  }

  // Nota de viralização (0-100) com o porquê de cada ponto.
  function scoreBlock(it) {
    const v = it.viral;
    if (!v) return '';
    const cls = v.score >= 80 ? 'alta' : v.score >= 60 ? 'media' : 'baixa';
    const aberto = state.openScore === it.id;
    const falhas = v.checks.filter((c) => !c.ok);
    return `<button class="es-score ${cls}" data-action="toggle-score" data-id="${it.id}" aria-expanded="${aberto}">
        <b>${v.score}</b><span>nota de viralização${falhas.length ? ` · ${falhas.length} ajuste(s)` : ' · tudo certo'}</span><i>${aberto ? '▴' : '▾'}</i>
      </button>
      ${aberto ? `<ul class="es-checks">${v.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'} ${esc(c.label)}</b>${c.ok ? '' : `<span>${esc(c.dica)}</span>`}</li>`).join('')}
        ${(it.ganchos || []).length > 1 ? `<li class="alt"><b>Outros ganchos que a IA pensou</b>${it.ganchos.filter((g) => g !== it.gancho).map((g) => `<span>“${esc(g.replace(/\*\*/g, ''))}”</span>`).join('')}</li>` : ''}</ul>` : ''}`;
  }

  function itemCard(it) {
    const chips = `<div class="es-row" style="flex-wrap:wrap">
      <span class="es-chip ${it.format}">${FORMAT_LABEL[it.format]}${it.format === 'carrossel' && it.carousel_type ? ' · ' + esc(C.CAROUSEL_TYPES[it.carousel_type] || it.carousel_type) : ''}</span>
      ${it.pillar ? `<span class="es-chip pillar">${esc(it.pillar)}</span>` : ''}
    </div>`;
    const needsLink = it.format === 'corte_tv' && !it.video_url;
    let body = '';

    if (it.status === 'aguardando' || it.status === 'erro') {
      body += it.status === 'erro' ? `<div class="es-errbox">${esc(it.error || 'Falhou')}</div>` : '';
      if (needsLink || state.linkEditing === it.id) {
        body += `<div class="es-label" style="margin-top:12px">Link do vídeo</div>
          <div class="es-row"><input class="es-input" data-link-input="${it.id}" type="url" inputmode="url" placeholder="Cole o link do Reels ou do vídeo" value="${esc(it.video_url)}">
          <button class="es-btn icon" data-action="save-link" data-id="${it.id}" aria-label="Salvar link">OK</button></div>`;
      }
      body += `<div class="es-actions">
        <button class="es-btn ${it.status === 'erro' ? '' : ''}" data-action="produce" data-id="${it.id}" ${needsLink ? 'disabled' : ''}>${it.status === 'erro' ? 'Tentar de novo' : 'Produzir'}</button>
        <button class="es-btn ghost" data-action="cycle-format" data-id="${it.id}">Trocar formato</button>
      </div>`;
    } else if (it.status === 'produzindo') {
      body += `<div class="es-row" style="margin-top:12px;color:var(--es-primary);font-size:14px;font-weight:600"><span class="es-spin"></span> Produzindo… pode levar até 1 minuto</div>`;
    } else {
      body += `<div class="es-preview-slot" data-preview="${it.id}"></div>`;
      body += scoreBlock(it);
      if (['antes_agora', 'noticia', 'lista'].includes(it.carousel_type) || (it.fontes || []).length) {
        body += `<div class="es-warn">A IA escreveu esses fatos e números. Confira cada um antes de postar${(it.fontes || []).length ? `. Fontes citadas: ${esc(it.fontes.join(', '))}` : ''}.</div>`;
      }
      if (it.third_party) body += '<div class="es-warn">Conteúdo de terceiros: confira o direito de uso antes de postar.</div>';
      body += `<div class="es-actions">
        <button class="es-btn" data-action="download" data-id="${it.id}">Baixar</button>
        <button class="es-btn ghost" data-action="copy" data-id="${it.id}">Copiar legenda</button>
        ${it.status === 'pronto'
          ? `<button class="es-btn ok full" data-action="posted" data-id="${it.id}">Marcar como postado</button>`
          : `<div class="full"><div class="es-label" style="margin:6px 0 0">Resultado (opcional)</div>
              <div class="es-metrics">
                <input class="es-input" data-metric="views" data-id="${it.id}" inputmode="numeric" placeholder="Views" value="${esc(it.metrics?.views ?? '')}">
                <input class="es-input" data-metric="likes" data-id="${it.id}" inputmode="numeric" placeholder="Curtidas" value="${esc(it.metrics?.likes ?? '')}">
                <button class="es-btn sm dark" data-action="save-metrics" data-id="${it.id}">Salvar</button>
              </div></div>`}
      </div>`;
    }

    const moving = state.moving === it.id
      ? `<div class="es-days">${C.weekDays(state.week).map((d) => {
          const f = fmtDay(d);
          return `<button data-action="move-to" data-id="${it.id}" data-day="${d}" aria-pressed="${d === it.scheduled_date}">${f.dow}<br>${f.label.split('/')[0]}</button>`;
        }).join('')}</div>`
      : '';

    return `<article class="es-card" data-item="${it.id}">
      <div class="es-between">${chips}<span class="es-status ${it.status}">${STATUS_LABEL[it.status] || it.status}</span></div>
      <div class="es-title">${esc(it.title)}</div>
      ${it.summary ? `<div class="es-text">${esc(it.summary)}</div>` : ''}
      ${it.source_name && it.source_name !== 'Sugestão da IA' ? `<div class="es-text" style="margin-top:4px">Fonte: ${esc(it.source_name)}</div>` : ''}
      ${body}
      <div class="es-row" style="margin-top:10px">
        <button class="es-btn sm ghost" style="flex:1" data-action="move" data-id="${it.id}">${state.moving === it.id ? 'Fechar' : 'Mudar dia'}</button>
        <button class="es-btn sm danger icon" data-action="remove" data-id="${it.id}" aria-label="Remover da fila">✕</button>
      </div>
      ${moving}
    </article>`;
  }

  const melhorHorario = () => state.insights?.melhores_horarios?.[0]?.chave || '';

  function screenSemana() {
    const items = weekItems();
    const sum = C.summarizeWeek(items);
    const goal = state.config.weekly_goal || 5;
    const pct = Math.min(100, Math.round((sum.prontos / goal) * 100));
    const days = C.weekDays(state.week);
    const today = C.toISODate(new Date());
    const pendentes = items.filter((i) => i.status === 'aguardando' || i.status === 'erro').length;
    const perf = C.performanceSummary(state.items);
    const f0 = fmtDay(days[0]); const f6 = fmtDay(days[6]);

    const dayBlocks = days.map((d) => {
      const f = fmtDay(d);
      const its = items.filter((i) => i.scheduled_date === d);
      const posting = (state.config.posting_days || []).includes(f.num);
      if (!its.length && (!posting || d < today)) return '';
      return `<section class="es-day">
        <div class="es-day-head ${d === today ? 'today' : ''}"><b>${f.dow} ${f.label}</b><span>${d === today ? 'hoje' : posting ? '' : 'sem postagem'}${its.length && melhorHorario() ? ` · postar ${melhorHorario()}` : ''}</span></div>
        <div class="es-stack">${its.length ? its.map(itemCard).join('') : '<div class="es-empty-day">Nada agendado. Aprove uma pauta.</div>'}</div>
      </section>`;
    }).join('');

    return `
      <div class="es-between">
        <button class="es-btn sm ghost icon" data-action="week-prev" aria-label="Semana anterior">‹</button>
        <div style="text-align:center"><div class="es-h1" style="font-size:20px">Semana</div><div class="es-sub" style="margin:0">${f0.label} a ${f6.label}</div></div>
        <button class="es-btn sm ghost icon" data-action="week-next" aria-label="Próxima semana">›</button>
      </div>
      <div class="es-card hero" style="margin-top:14px">
        <div style="font-size:18px;font-weight:800">${sum.prontos} de ${goal} prontos esta semana</div>
        <div class="es-progress"><div style="width:${pct}%"></div></div>
        <div class="es-sub">${sum.postados} postado(s) · ${pendentes} aguardando produção</div>
        <button class="es-btn" style="margin-top:12px" data-action="produce-all" ${!pendentes || state.producing ? 'disabled' : ''}>
          ${state.producing ? '<span class="es-spin"></span> Produzindo a semana…' : 'Produzir tudo'}
        </button>
      </div>
      ${!items.length ? `<div class="es-card" style="margin-top:14px;text-align:center">
        <div class="es-title">Semana vazia</div><div class="es-text">Aprove pautas pra montar a semana.</div>
        <button class="es-btn" style="margin-top:12px" data-action="goto" data-tab="pautas">Ver pautas</button></div>` : ''}
      ${dayBlocks}
      ${perf ? `<div class="es-card" style="margin-top:18px">
        <div class="es-title" style="margin-top:0">O que rendeu mais</div>
        <div class="es-text">Formato: <b>${esc(FORMAT_LABEL[perf.formatos[0].chave] || perf.formatos[0].chave)}</b> · Pilar: <b>${esc(perf.pilares[0].chave)}</b> (${perf.amostra} posts medidos). Isso já orienta as próximas pautas.</div>
      </div>` : ''}
      ${!state.dbOk ? '<div class="es-errbox">Este navegador não deixa salvar dados (modo privado?). A fila some ao fechar.</div>' : ''}
    `;
  }

  function painelPerfil() {
    const ins = state.insights;
    const FMT = { imagem: 'imagem única', carrossel: 'carrossel', video: 'vídeo' };
    if (!ins) {
      return `<div class="es-card hero" style="margin-bottom:18px">
        <div style="font-size:16px;font-weight:800">Seu perfil ainda não foi lido</div>
        <div class="es-sub" style="margin:6px 0 12px">A ferramenta aprende com seus posts reais: o que rendeu, que gancho funcionou, melhor dia e horário.</div>
        <button class="es-btn" data-action="insights" ${state.insightsLoading ? 'disabled' : ''}>${state.insightsLoading ? '<span class="es-spin"></span> Lendo seus posts…' : 'Ler meu perfil agora'}</button>
        ${state.insightsError ? `<div class="es-errbox">${esc(state.insightsError)}</div>` : ''}
      </div>`;
    }
    const top = ins.top?.[0];
    const quando = new Date(ins.atualizado_em);
    return `<div class="es-card hero" style="margin-bottom:18px">
      <div class="es-between"><div style="font-size:16px;font-weight:800">Seu perfil agora</div>
        <button class="es-chip" style="background:rgba(255,255,255,.12);color:#fff" data-action="insights" ${state.insightsLoading ? 'disabled' : ''}>${state.insightsLoading ? 'Lendo…' : 'Atualizar'}</button></div>
      <div class="es-kpis">
        <div><b>${(ins.seguidores / 1000).toFixed(0)} mil</b><span>seguidores</span></div>
        <div><b>${FMT[ins.melhor_formato] || '—'}</b><span>formato que mais rende</span></div>
        <div><b>${esc(ins.melhores_dias?.[0]?.chave || '—')}</b><span>melhor dia</span></div>
      </div>
      ${top ? `<div class="es-sub" style="margin:10px 0 0">Campeão: “${esc(top.gancho.slice(0, 90))}” · <b style="color:#fff">${String(top.eng).replace('.', ',')}%</b> dos seguidores, ${top.vezes_mediana}x a sua média. As pautas e os textos usam esse mecanismo.</div>` : ''}
      <div class="es-sub" style="margin:8px 0 0;font-size:11px">Lido em ${quando.toLocaleDateString('pt-BR')} · ${ins.amostra} posts</div>
      ${state.insightsError ? `<div class="es-errbox">${esc(state.insightsError)}</div>` : ''}
    </div>`;
  }

  function screenPautas() {
    const at = state.pautasAt ? new Date(state.pautasAt) : null;
    const cards = state.pautas.map((p) => `
      <article class="es-card">
        <div class="es-between">
          <div class="es-row" style="flex-wrap:wrap">
            <button class="es-chip ${p.format}" data-action="pauta-format" data-id="${p.id}" aria-label="Trocar formato">${FORMAT_LABEL[p.format]} ▾</button>
            ${p.pillar ? `<span class="es-chip pillar">${esc(p.pillar)}</span>` : ''}
          </div>
          <span class="es-chip score" title="Potencial">${Math.round(p.score || 0)}</span>
        </div>
        <div class="es-title">${esc(p.title)}</div>
        <div class="es-text">${esc(p.summary)}</div>
        ${p.mecanismo ? `<div class="es-mec">Por que viraliza: ${esc(p.mecanismo)}</div>` : ''}
        <div class="es-text" style="margin-top:4px">Fonte: ${esc(p.source_name || '—')}</div>
        ${p.format === 'carrossel' ? `<select class="es-select" style="margin-top:10px" data-action="pauta-type" data-id="${p.id}">
          ${Object.entries(C.CAROUSEL_TYPES).map(([k, v]) => `<option value="${k}" ${p.carousel_type === k ? 'selected' : ''}>Carrossel ${esc(v)}</option>`).join('')}
        </select>` : ''}
        ${p.format === 'corte_tv' && !p.video_url ? '<div class="es-warn">Sem vídeo-fonte: vai aguardar você colar o link.</div>' : ''}
        <div class="es-actions">
          <button class="es-btn ok" data-action="approve" data-id="${p.id}">Aprovar</button>
          <button class="es-btn ghost" data-action="discard" data-id="${p.id}">Descartar</button>
        </div>
      </article>`).join('');

    return `
      ${painelPerfil()}
      <div class="es-h1">Pautas</div>
      <div class="es-sub">${at ? `Atualizado ${at.toLocaleDateString('pt-BR')} às ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Sugestões a partir dos seus pilares'}</div>
      <button class="es-btn" data-action="fetch-pautas" ${state.pautasLoading ? 'disabled' : ''}>
        ${state.pautasLoading ? '<span class="es-spin"></span> Buscando pautas… (até 1 min)' : 'Buscar agora'}
      </button>
      ${state.pautasError ? `<div class="es-errbox">${esc(state.pautasError)}</div>` : ''}
      <div class="es-stack" style="margin-top:14px">${cards || (!state.pautasLoading ? '<div class="es-empty-day">Toque em "Buscar agora" pra receber ~10 pautas.</div>' : '')}</div>
    `;
  }

  function screenAjustes() {
    const cfg = state.config;
    return `
      <div class="es-h1">Ajustes</div>
      <div class="es-sub">${state.storage === 'upstash' ? 'Fila sincronizada no servidor.' : 'Fila salva neste aparelho.'}</div>

      <div class="es-label">Pilares de conteúdo</div>
      ${cfg.pillars.map((p, i) => `<div class="es-list-item">
        <input class="es-input" data-pillar="${i}" value="${esc(p)}">
        <button class="es-btn icon danger" data-action="pillar-del" data-i="${i}" aria-label="Remover pilar">✕</button>
      </div>`).join('')}
      <div class="es-list-item">
        <input class="es-input" id="es-new-pillar" placeholder="Novo pilar">
        <button class="es-btn icon" data-action="pillar-add" aria-label="Adicionar pilar">+</button>
      </div>
      <button class="es-btn ghost sm" data-action="pillars-save">Salvar pilares</button>

      <div class="es-label">Meta semanal</div>
      <div class="es-stepper">
        <button class="es-btn icon ghost" data-action="goal" data-delta="-1" aria-label="Menos">−</button>
        <b>${cfg.weekly_goal}</b><span class="es-text">posts por semana</span>
        <button class="es-btn icon ghost" data-action="goal" data-delta="1" aria-label="Mais">+</button>
      </div>

      <div class="es-label">Dias de postagem</div>
      <div class="es-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-action="toggle-day" data-day="${d}" aria-pressed="${cfg.posting_days.includes(d)}">${DOW[d]}</button>`).join('')}</div>

      <div class="es-label">Template do corte TV</div>
      <div class="es-days" style="grid-template-columns:1fr 1fr">
        <button data-action="video-template" data-v="viral" aria-pressed="${cfg.video_template === 'viral'}">Viral</button>
        <button data-action="video-template" data-v="padrao" aria-pressed="${cfg.video_template === 'padrao'}">Padrão</button>
      </div>

      <div class="es-label">Módulos escondidos</div>
      <div class="es-days" style="grid-template-columns:1fr">
        <button data-action="toggle-module" data-m="videoIA" aria-pressed="${!cfg.hidden_modules.includes('videoIA')}">Vídeo IA ${cfg.hidden_modules.includes('videoIA') ? '(escondido)' : '(visível)'}</button>
      </div>

      <div class="es-label">Backup</div>
      <div class="es-actions" style="margin-top:0">
        <button class="es-btn ghost sm" data-action="export">Exportar fila</button>
        <label class="es-btn ghost sm" style="cursor:pointer">Importar<input type="file" accept="application/json" id="es-import" hidden></label>
      </div>
      <div class="es-text" style="margin-top:8px">O backup leva pautas, fila e ajustes (sem os arquivos). Serve pra trocar de aparelho.</div>
    `;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const root = document.getElementById('esteira');

  function applyHiddenModules() {
    if (state.tab === 'criar' && isHidden(state.criarModule)) state.criarModule = 'carousels';
  }
  const isHidden = (modId) => {
    const m = CRIAR_MODULES.find((x) => x.id === modId);
    return m?.flag && (state.config.hidden_modules || []).includes(m.flag);
  };

  function switchOld(tab) {
    if (typeof window.__picoSwitchTab === 'function') window.__picoSwitchTab(tab);
    else setTimeout(() => switchOld(tab), 200); // app antigo ainda montando
  }

  function render() {
    const main = state.tab === 'semana' ? screenSemana() : state.tab === 'pautas' ? screenPautas() : state.tab === 'ajustes' ? screenAjustes() : '';
    const pendentesPautas = state.pautas.length;
    const tabs = [['semana', 'Semana'], ['pautas', 'Pautas'], ['criar', 'Criar'], ['ajustes', 'Ajustes']];
    const scroll = root.querySelector('.es-main')?.scrollTop || 0;
    root.innerHTML = `
      <div class="es-top" ${state.tab === 'criar' ? '' : 'hidden'}>
        ${CRIAR_MODULES.filter((m) => !isHidden(m.id)).map((m) => `<button data-action="criar" data-m="${m.id}" aria-pressed="${state.criarModule === m.id}">${m.label}</button>`).join('')}
      </div>
      <main class="es-main" ${state.tab === 'criar' ? 'hidden' : ''}>${main}</main>
      <div class="es-toast-slot"></div>
      <nav class="es-nav" aria-label="Navegação principal">
        ${tabs.map(([id, label]) => `<button data-action="tab" data-tab="${id}" aria-current="${state.tab === id ? 'page' : 'false'}">
          ${ICON[id]}<span>${label}</span>${id === 'pautas' && pendentesPautas ? `<span class="es-badge">${pendentesPautas}</span>` : ''}
        </button>`).join('')}
      </nav>`;
    const m = root.querySelector('.es-main');
    if (m) m.scrollTop = scroll;
    renderToast();
    if (state.tab === 'semana') fillPreviews();
  }

  async function fillPreviews() {
    for (const slot of root.querySelectorAll('[data-preview]')) {
      const id = slot.dataset.preview;
      const item = state.items.find((i) => i.id === id);
      const assets = await getAssets(id);
      if (!slot.isConnected) continue;
      const imgs = assets.filter((a) => a.type === 'image' && a.url);
      const vid = assets.find((a) => a.type === 'video' && a.url);
      if (vid) slot.innerHTML = `<div class="es-preview"><video src="${vid.url}" controls playsinline preload="metadata"></video></div>`;
      else if (imgs.length) slot.innerHTML = `<div class="es-thumbs">${imgs.map((a) => `<img src="${a.url}" alt="">`).join('')}</div>`;
      else if (item?.roteiro) slot.innerHTML = `<div class="es-script"><b>Gancho:</b> ${esc(item.roteiro.hook)}\n\n${item.roteiro.blocos.map(esc).join('\n')}\n\n<b>CTA:</b> ${esc(item.roteiro.cta)}</div>`;
      else slot.innerHTML = '<div class="es-warn">Arquivo não está neste aparelho. Remova e produza de novo.</div>';
    }
  }

  // ── Eventos ─────────────────────────────────────────────────────────────────
  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.tagName === 'SELECT') return;
    const { action, id } = btn.dataset;
    const item = id ? state.items.find((i) => i.id === id) : null;

    switch (action) {
      case 'tab':
        state.tab = btn.dataset.tab;
        state.moving = null;
        if (state.tab === 'criar') switchOld(state.criarModule);
        if (state.tab === 'pautas' && insightsVelho() && !state.insightsLoading) fetchInsights(false);
        if (state.tab === 'pautas' && !state.pautas.length && !state.pautasLoading && (!state.pautasAt || Date.now() - state.pautasAt > 12 * 3600e3)) fetchPautas();
        root.querySelector('.es-main') && (root.querySelector('.es-main').scrollTop = 0);
        return render();
      case 'goto':
        state.tab = btn.dataset.tab;
        if (state.tab === 'pautas' && !state.pautas.length) fetchPautas();
        return render();
      case 'criar':
        state.criarModule = btn.dataset.m;
        switchOld(state.criarModule);
        return render();
      case 'week-prev': state.week = C.addDays(state.week, -7); return render();
      case 'week-next': state.week = C.addDays(state.week, 7); return render();
      case 'produce-all': return produceAll();
      case 'produce': return produceItem(id);
      case 'cycle-format': {
        const order = ['carrossel', 'roteiro', 'corte_tv'];
        const format = order[(order.indexOf(item.format) + 1) % order.length];
        await saveItem({ ...item, format, carousel_type: format === 'carrossel' ? (item.carousel_type || 'padrao') : null, status: 'aguardando', error: null });
        return render();
      }
      case 'save-link': {
        const input = root.querySelector(`[data-link-input="${id}"]`);
        const url = (input?.value || '').trim();
        if (!/^https?:\/\//i.test(url)) return toast('Cole um link que comece com https://');
        state.linkEditing = null;
        await saveItem({ ...item, video_url: url, status: 'aguardando', error: null });
        render();
        return produceItem(id);
      }
      case 'download': return downloadItem(id);
      case 'copy': return copyCaption(id);
      case 'posted': await saveItem({ ...item, status: 'postado', posted_at: new Date().toISOString() }); toast('Marcado como postado.'); return render();
      case 'save-metrics': {
        const v = root.querySelector(`[data-metric="views"][data-id="${id}"]`)?.value;
        const l = root.querySelector(`[data-metric="likes"][data-id="${id}"]`)?.value;
        await saveItem({ ...item, metrics: { views: Number(v) || 0, likes: Number(l) || 0, manual: true } });
        toast('Resultado salvo.');
        return render();
      }
      case 'move': state.moving = state.moving === id ? null : id; return render();
      case 'move-to': await saveItem({ ...item, scheduled_date: btn.dataset.day }); state.moving = null; return render();
      case 'remove':
        if (!confirm('Remover este item da fila?')) return;
        await removeItem(id);
        return render();
      case 'fetch-pautas': return fetchPautas();
      case 'insights': return fetchInsights(true);
      case 'toggle-score': state.openScore = state.openScore === id ? null : id; return render();
      case 'approve': await approvePauta(id); return render();
      case 'discard': return dropPauta(id);
      case 'pauta-format': {
        const p = state.pautas.find((x) => x.id === id);
        const order = ['carrossel', 'roteiro', 'corte_tv'];
        p.format = order[(order.indexOf(p.format) + 1) % order.length];
        if (p.format === 'carrossel' && !p.carousel_type) p.carousel_type = 'padrao';
        return render();
      }
      case 'pillar-del': {
        const pillars = state.config.pillars.filter((_, i) => i !== Number(btn.dataset.i));
        await saveConfig({ pillars });
        return render();
      }
      case 'pillar-add': {
        const v = root.querySelector('#es-new-pillar')?.value.trim();
        if (!v) return;
        await saveConfig({ pillars: [...readPillarInputs(), v] });
        return render();
      }
      case 'pillars-save': await saveConfig({ pillars: readPillarInputs() }); toast('Pilares salvos.'); return render();
      case 'goal': await saveConfig({ weekly_goal: Math.max(1, Math.min(21, state.config.weekly_goal + Number(btn.dataset.delta))) }); return render();
      case 'toggle-day': {
        const d = Number(btn.dataset.day);
        const set = new Set(state.config.posting_days);
        if (set.has(d)) set.delete(d); else set.add(d);
        if (!set.size) return toast('Deixe pelo menos um dia de postagem.');
        await saveConfig({ posting_days: [...set].sort() });
        return render();
      }
      case 'video-template': await saveConfig({ video_template: btn.dataset.v }); return render();
      case 'toggle-module': {
        const m = btn.dataset.m;
        const set = new Set(state.config.hidden_modules);
        if (set.has(m)) set.delete(m); else set.add(m);
        await saveConfig({ hidden_modules: [...set] });
        return render();
      }
      case 'export': return exportBackup();
      default:
    }
  });

  root.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.dataset.action === 'pauta-type') {
      const p = state.pautas.find((x) => x.id === el.dataset.id);
      if (p) p.carousel_type = el.value;
    }
    if (el.id === 'es-import' && el.files?.[0]) importBackup(el.files[0]);
  });

  const readPillarInputs = () => [...root.querySelectorAll('[data-pillar]')].map((i) => i.value.trim()).filter(Boolean);

  async function exportBackup() {
    const data = JSON.stringify({ v: 1, exported_at: new Date().toISOString(), config: state.config, items: state.items, pautas: state.pautas }, null, 2);
    const file = new File([data], `pico-fila-${C.toISODate(new Date())}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.items)) throw new Error('arquivo inválido');
      for (const it of data.items) {
        if (!state.items.some((i) => i.id === it.id)) await saveItem({ ...it, status: it.status === 'produzindo' ? 'aguardando' : it.status });
      }
      if (data.config) await saveConfig(data.config);
      toast(`${data.items.length} item(ns) importado(s).`);
      render();
    } catch (e) {
      toast(`Não deu pra importar: ${e.message}`);
    }
  }

  async function downloadItem(id) {
    const assets = (await getAssets(id)).filter((a) => a.blob);
    if (!assets.length) return toast('Arquivo não está neste aparelho. Produza de novo.');
    const files = assets.map((a) => new File([a.blob], a.name, { type: a.blob.type || 'application/octet-stream' }));
    // No celular, o menu de compartilhar salva direto na galeria.
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const blob = files.length === 1 ? files[0] : await makeZipAsync(files);
    const name = files.length === 1 ? files[0].name : 'carrossel.zip';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Itens que ficaram "produzindo" quando a aba fechou no meio voltam a aguardar.
  async function recoverInterrupted() {
    for (const it of state.items.filter((i) => i.status === 'produzindo')) {
      await saveItem({ ...it, status: 'erro', error: 'A produção foi interrompida. Toque em "Tentar de novo".' });
    }
  }

  (async function init() {
    render();
    await loadAll();
    await recoverInterrupted();
    // Semana atual vazia mas a próxima já montada: abre direto na próxima.
    const prox = C.addDays(state.week, 7);
    if (!state.items.some((i) => i.week_start === state.week) && state.items.some((i) => i.week_start === prox)) state.week = prox;
    applyHiddenModules();
    render();
  })();

  window.__esteira = { state };
})();
