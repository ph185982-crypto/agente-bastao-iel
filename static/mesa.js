// Mesa de trabalho do Pedro Destrava.
// Navegação: Mesa | Central | Criar | Ajustes. (A Central de aprovação substitui a aba Semana.)
//  - Mesa: três entradas (encontrar pauta, falar sobre algo que o Pedro trouxe,
//    transformar uma ideia) que levam ao MESMO editor, mais a biblioteca.
//  - Tudo é guardado no aparelho por Store (IndexedDB) com versões e backup.
//  - "Criar" continua abrindo as ferramentas antigas sem mudança.
(function () {
  'use strict';
  const M = window.ContentModel;
  const G = window.QualityGates;
  const S = window.Store;
  const C = window.EsteiraCore;
  const E = window.Editorial;
  const root = document.getElementById('esteira');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtData = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const fmtDia = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const STATUS_ROTULO = { rascunho: 'Rascunho', em_revisao: 'Em revisão', aprovado: 'Aprovado', exportado: 'Exportado', publicado: 'Publicado', arquivado: 'Arquivado' };
  const ETAPA_ROTULO = { leitura: 'Ler a fonte', afirmacoes: 'Levantar afirmações', pesquisa: 'Pesquisar', briefing: 'Briefing', copy: 'Texto', arte: 'Arte' };

  // ── Estado ──────────────────────────────────────────────────────────────────
  const state = {
    tab: 'mesa',
    sub: null,                 // 'descobrir' | 'conteudo' | null
    pronto: false,
    storage: { ok: true, erro: null, persistente: null },
    migracao: null,
    contents: [],
    atual: null,               // id do conteúdo aberto
    filtro: 'todos',
    busca: '',
    ordem: 'recentes',
    config: { pilares: E.PILARES_PADRAO, weekly_goal: 5, posting_days: [1, 2, 3, 4, 5], hidden_modules: ['videoIA'], video_template: 'viral', voice_profile: E.VOICE_PROFILE_PADRAO, daily_generation_cap: 10 },
    conta: { esperado: null, confirmada: false, perfil: null, erro: null, carregando: false },
    insights: null,
    insightsLoading: false,
    insightsError: null,
    descoberta: { carregando: false, erro: null, dados: null },
    criarModulo: 'carousels',
    semana: C.weekStart(new Date()),
    quarentena: [],
    backups: [],
    confirmando: null,
    toast: null,
    resultadoImport: null,
    verJson: null,
    encerramento: null,
    servidor: null,            // estado da cópia no servidor
    syncMeta: {},              // id → { rev, conferido, conflito, erro }
    sincronizando: false,
  };

  // ── API ─────────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error || `Erro ${res.status}`);
      e.status = res.status; e.code = err.code; e.detalhe = err;
      throw e;
    }
    return opts.raw ? res : res.json();
  }
  const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`);

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg) {
    state.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast = null; const el = root.querySelector('.es-toast-slot'); if (el) el.innerHTML = ''; }, 3200);
    const el = root.querySelector('.es-toast-slot');
    if (el) el.innerHTML = `<div class="es-toast" role="status">${esc(msg)}</div>`;
  }

  // ── Dados ───────────────────────────────────────────────────────────────────
  async function carregar() {
    state.contents = await S.listar();
    state.quarentena = await S.quarentena();
    state.backups = await S.listarBackups();
    const cfg = await S.cfgGet('config_v2');
    if (cfg) state.config = { ...state.config, ...cfg };
    const ins = await S.cfgGet('insights_v1');
    if (ins && ins.conta?.ok && ins.conta.ig_id === M.ACCOUNT_PIN.ig_id && ins.schema === M.SCHEMA) state.insights = ins;
    state.encerramento = (await S.cfgGet('encerramento_aprovado')) || null;
  }

  async function salvarConfig(patch) {
    state.config = { ...state.config, ...patch };
    await S.cfgSet('config_v2', state.config);
  }

  async function confirmarConta(force) {
    state.conta.carregando = true; state.conta.erro = null; render();
    try {
      const r = await api(`/api/account?confirm=1${force ? '&force=1' : ''}`);
      state.conta = { ...state.conta, esperado: r.esperado, confirmada: true, perfil: r.perfil, erro: null, carregando: false, ambiente: r.ambiente_com_problema };
    } catch (e) {
      state.conta = { ...state.conta, confirmada: false, erro: e.message, carregando: false };
    }
    render();
  }

  async function lerPerfil() {
    if (state.insightsLoading) return;
    state.insightsLoading = true; state.insightsError = null; render();
    try {
      const d = await api('/api/queue/insights?force=1');
      if (!d.conta?.ok || d.conta.ig_id !== M.ACCOUNT_PIN.ig_id) throw new Error('A leitura não veio da conta @pedro_destrava. Nada foi guardado.');
      state.insights = d;
      await S.cfgSet('insights_v1', d);
      toast('Perfil lido e conferido.');
    } catch (e) { state.insightsError = e.message; } finally { state.insightsLoading = false; render(); }
  }

  // Posts recentes do perfil: leitura antiga (se houver) + os posts lidos pela aba Resultados (Meta).
  const recentesParaPrompt = () => [...(state.insights?.posts || []).filter((p) => !p.colab).slice(0, 8).map((p) => p.legenda || p.gancho), ...((window.MeuInstagram?._st?.dados?.posts) || []).slice(0, 12).map((p) => p.legenda)].filter(Boolean).slice(0, 16);

  // ── Descoberta (entrada A) ──────────────────────────────────────────────────
  async function descobrir() {
    if (state.descoberta.carregando) return;
    state.descoberta = { ...state.descoberta, carregando: true, erro: null }; render();
    try {
      const d = await api('/api/content/discover', { method: 'POST', body: { pilares: state.config.pilares, recentes: recentesParaPrompt(), dias: 3 } });
      state.descoberta = { carregando: false, erro: null, dados: d };
    } catch (e) { state.descoberta = { ...state.descoberta, carregando: false, erro: e.message }; }
    render();
  }

  // ── Conteúdos ───────────────────────────────────────────────────────────────
  function criarConteudoDeFonte({ url, titulo, texto, pauta }) {
    const c = M.novoConteudo({
      titulo: titulo || (url ? url : 'Novo conteúdo'),
      origem: url ? { tipo: pauta ? 'pauta' : 'link', url, capturado_em: new Date().toISOString(), pauta: pauta || null } : { tipo: 'texto', texto_bruto: texto || '' },
      conta: { ...M.ACCOUNT_PIN, confirmed_at: state.conta.perfil?.checked_at || null, source: state.conta.confirmada ? 'api' : 'codigo' },
    });
    return c;
  }

  async function abrirConteudo(id) {
    state.atual = id; state.sub = 'conteudo'; state.tab = 'mesa';
    render();
    window.scrollTo?.(0, 0);
  }
  const conteudoAtual = () => state.contents.find((c) => c.id === state.atual) || null;

  async function persistir(c) {
    await S.salvar(c);
    const i = state.contents.findIndex((x) => x.id === c.id);
    if (i === -1) state.contents.unshift(c); else state.contents[i] = c;
    state.contents.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    if (window.Sync && state.servidor?.configurado) window.Sync.agendar(c);
  }

  async function entregarArquivo(blob, nome) {
    const file = new File([blob], nome, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ── Telas ───────────────────────────────────────────────────────────────────
  const ICON = {
    mesa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 10h18M5 10v9M19 10v9M3 6h18"/></svg>',
    semana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    central: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l3 3 5-6"/></svg>',
    resultados: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
    criar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="#fff"/><circle cx="15" cy="12" r="2" fill="#fff"/><circle cx="7" cy="18" r="2" fill="#fff"/></svg>',
  };

  function chipConta() {
    const c = state.conta;
    if (c.erro) return `<span class="mz-chip err" title="${esc(c.erro)}">Conta não confirmada</span>`;
    if (c.confirmada) return `<span class="mz-chip ok">${esc(M.ACCOUNT_PIN.handle)} · confirmada na API</span>`;
    return `<span class="mz-chip neutro">${esc(M.ACCOUNT_PIN.handle)} · fixa no código</span>`;
  }
  function chipServidor(c) {
    if (!state.servidor) return '';
    if (!state.servidor.configurado) return '<span class="mz-chip warn">Só neste navegador</span>';
    const m = state.syncMeta[c.id] || {};
    if (m.conflito) return '<span class="mz-chip err">Conflito com outro aparelho</span>';
    if (m.conferido) return `<span class="mz-chip ok">No servidor (rev. ${m.rev})</span>`;
    return '<span class="mz-chip warn">Ainda não enviado</span>';
  }

  function chipArmazenamento() {
    if (!S.ok || !state.storage.ok) return '<span class="mz-chip err">Sem salvamento neste navegador</span>';
    if (state.storage.persistente === false) return '<span class="mz-chip warn">Salvo neste aparelho (o navegador pode limpar)</span>';
    return '<span class="mz-chip ok">Salvo neste aparelho</span>';
  }

  function cardConteudo(c) {
    const al = S.puro.alertasDoConteudo(c);
    const v = M.versaoAtiva(c);
    const etapa = M.resumoParaLista(c).etapa_pendente;
    return `<button class="es-card mz-item" data-action="abrir" data-id="${c.id}">
      <div class="es-between"><span class="mz-status ${c.status}">${STATUS_ROTULO[c.status] || c.status}</span><span class="es-text">${fmtData(c.updated_at)}</span></div>
      <div class="es-title" style="text-align:left">${esc(c.titulo || 'Sem título')}</div>
      <div class="es-text" style="text-align:left">${c.legado ? 'Veio da fila anterior' : v ? `Versão ${esc(v.id)}` : etapa ? `Próxima etapa: ${esc(ETAPA_ROTULO[etapa] || etapa)}` : ''}${c.agenda?.data ? ` · agendado ${esc(fmtDia(c.agenda.data))}` : ''}</div>
      ${al.length ? `<div class="mz-alertas">${al.map((a) => `<span class="mz-chip warn">${esc(a)}</span>`).join('')}</div>` : ''}
    </button>`;
  }

  function telaMesa() {
    if (window.StudioMobile) return window.StudioMobile.telaCriar();
    const ativos = state.contents.filter((c) => c.status !== 'arquivado');
    const filtros = [['todos', 'Todos'], ['andamento', 'Em andamento'], ['aprovado', 'Aprovados'], ['publicado', 'Publicados'], ['arquivado', 'Arquivados'], ['legado', 'Fila anterior']];
    return `
      <section class="studio-welcome">
        <div><div class="studio-eyebrow">Seu estúdio de conteúdo</div><h1 class="es-h1">Boas ideias merecem<br>ganhar o mundo.</h1>
        <p>Da primeira pauta ao próximo post.<br>Crie, revise e publique com a sua voz.</p></div>
        <div class="studio-flow" aria-label="Seu fluxo de trabalho"><span><i>01</i> Encontre a ideia</span><span><i>02</i> Dê a sua voz</span><span><i>03</i> Revise e publique</span></div>
      </section>
      <div class="studio-entries">
        <button class="mz-entry" data-action="entrada" data-e="link"><i class="studio-entry-icon">${ICON.criar}</i><div><b>Quero falar sobre isso</b><span>Comece com um link ou texto e transforme a informação em conteúdo.</span></div><i class="studio-arrow" aria-hidden="true">↗</i></button>
        <button class="mz-entry secondary" data-action="entrada" data-e="descobrir"><i class="studio-entry-icon">${ICON.mesa}</i><div><b>Encontre uma pauta</b><span>Descubra assuntos recentes, com fontes e conexão com o seu perfil.</span></div><i class="studio-arrow" aria-hidden="true">↗</i></button>
      </div>
      <div class="studio-stats" aria-label="Resumo dos conteúdos">
        ${[['andamento', 'Em andamento', ativos.filter(c => ['rascunho', 'em_revisao'].includes(c.status) && !c.legado).length], ['aprovado', 'Aprovados', ativos.filter(c => ['aprovado', 'exportado'].includes(c.status)).length], ['publicado', 'Publicados', ativos.filter(c => c.status === 'publicado').length]].map(([k,l,n]) => `<button data-action="resumo" data-f="${k}"><span class="studio-stat-dot ${k}"></span><span>${l}</span><b>${n}</b><i aria-hidden="true">↗</i></button>`).join('')}
      </div>
      <section class="studio-library" aria-labelledby="library-title">
        <div class="studio-section-head"><div><h2 id="library-title">Sua biblioteca</h2><p>Continue de onde parou. Cada ideia tem seu lugar.</p></div><span class="studio-total">${ativos.length} conteúdo${ativos.length === 1 ? '' : 's'}</span></div>
        <div class="studio-library-tools"><label class="studio-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="library-search" type="search" value="${esc(state.busca)}" placeholder="Buscar por título ou assunto" aria-label="Buscar na biblioteca" autocomplete="off"></label><label class="studio-sort"><span class="sr-only">Ordenar conteúdos</span><select id="library-sort"><option value="recentes" ${state.ordem === 'recentes' ? 'selected' : ''}>Mais recentes</option><option value="antigos" ${state.ordem === 'antigos' ? 'selected' : ''}>Mais antigos</option><option value="titulo" ${state.ordem === 'titulo' ? 'selected' : ''}>Título: A–Z</option></select></label></div>
        <div class="mz-filtros" role="group" aria-label="Filtrar conteúdos">${filtros.map(([k,l]) => `<button class="es-chip ${state.filtro === k ? 'score' : 'pillar'}" data-action="filtro" data-f="${k}" aria-pressed="${state.filtro === k}">${l}</button>`).join('')}</div>
        <div id="library-results">${resultadosBiblioteca()}</div>
      </section>
      ${state.migracao?.quarentena?.length ? `<div class="es-warn" style="margin-top:14px">Isolei ${state.migracao.quarentena.length} dado(s) sem origem de conta confirmada. Você pode consultá-los em Ajustes › Dados isolados.</div>` : ''}`;
  }

  function resultadosBiblioteca() {
    const normalizar = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    const busca = normalizar(state.busca.trim());
    const lista = state.contents.filter((c) => {
      if (busca && !normalizar(`${c.titulo || ''} ${c.origem?.pauta?.pilar || ''}`).includes(busca)) return false;
      if (state.filtro === 'arquivado') return c.status === 'arquivado';
      if (c.status === 'arquivado' && state.filtro !== 'arquivado') return false;
      if (state.filtro === 'andamento') return ['rascunho', 'em_revisao'].includes(c.status) && !c.legado;
      if (state.filtro === 'aprovado') return ['aprovado', 'exportado'].includes(c.status);
      if (state.filtro === 'publicado') return c.status === 'publicado';
      if (state.filtro === 'legado') return !!c.legado;
      return true;
    }).sort((a,b) => state.ordem === 'titulo' ? (a.titulo || '').localeCompare(b.titulo || '', 'pt-BR') : state.ordem === 'antigos' ? (a.updated_at || '').localeCompare(b.updated_at || '') : (b.updated_at || '').localeCompare(a.updated_at || ''));
    return `<p class="studio-result-count" role="status">${lista.length} conteúdo${lista.length === 1 ? '' : 's'} nesta seleção</p><div class="studio-content-grid">${lista.map(cardConteudo).join('') || `<div class="studio-empty"><div class="studio-empty-icon">${ICON.mesa}</div><h3>${state.busca || state.filtro !== 'todos' ? 'Nenhum conteúdo encontrado' : 'Sua próxima ideia começa aqui'}</h3><p>${state.busca || state.filtro !== 'todos' ? 'Experimente outra busca ou veja todos os conteúdos.' : 'Cole um link ou texto para criar o primeiro conteúdo da sua biblioteca.'}</p><button class="es-btn sm" style="width:auto" data-action="${state.busca || state.filtro !== 'todos' ? 'limpar-filtros' : 'entrada'}" data-e="link">${state.busca || state.filtro !== 'todos' ? 'Limpar busca e filtros' : 'Criar primeiro conteúdo'}</button></div>`}</div>`;
  }

  function cardPauta(p) {
    const veic = (p.veiculos || []).join(', ');
    return `<article class="es-card">
      <div class="es-row" style="flex-wrap:wrap;gap:6px">
        <span class="es-chip pillar">${esc(p.pilar)}</span>
        ${p.ligacao ? `<span class="mz-chip ${p.ligacao === 'forte' ? 'ok' : 'neutro'}">Ligação com o perfil: ${p.ligacao === 'forte' ? 'forte' : 'média'}</span>` : ''}
        ${p.risco === 'alto' ? '<span class="mz-chip err">Assunto sensível</span>' : ''}
        ${p.repete_recente ? '<span class="mz-chip warn">Parecido com post recente</span>' : ''}
        ${typeof p.prioridade === 'number' ? `<span class="mz-chip neutro" title="Estimativa só para ordenar a lista; não prevê alcance">Prioridade ${p.prioridade}</span>` : ''}
        ${p.mecanismo ? `<span class="mz-chip neutro">${esc({ antes_depois: 'Antes e depois', numero_chocante: 'Número que choca', contraintuitivo: 'Contraintuitivo', pergunta_dor: 'Pergunta que dói' }[p.mecanismo] || p.mecanismo)}</span>` : ''}
        ${(p.penalidades || []).map((x) => `<span class="mz-chip warn">${esc({ partidario: 'Partidário', direito_autoral: 'Direito de uso', sem_fonte: 'Sem fonte' }[x.tipo] || x.tipo)} −${x.pontos}</span>`).join('')}
      </div>
      <div class="es-title">${esc(p.titulo)}</div>
      <div class="es-text">${esc(p.resumo)}</div>
      <div class="es-text" style="margin-top:6px"><b>${esc(veic)}</b> · ${esc(fmtData(p.publicada_em))}</div>
      ${p.por_que_interessa ? `<div class="mz-bloco"><b>Por que interessa ao perfil</b><span>${esc(p.por_que_interessa)}</span></div>` : '<div class="es-warn">Sem justificativa da IA nesta pauta.</div>'}
      ${p.por_que_enviaria ? `<div class="mz-bloco"><b>Por que alguém mandaria</b><span>${esc(p.por_que_enviaria)}</span></div>` : ''}
      ${p.angulo ? `<div class="mz-bloco"><b>Ângulo possível</b><span>${esc(p.angulo)}</span></div>` : ''}
      ${p.angulo_lojista ? `<div class="mz-bloco"><b>Espelho para quem vende</b><span>${esc(p.angulo_lojista)}</span></div>` : ''}
      ${p.limitacoes ? `<div class="mz-bloco"><b>O que confirmar</b><span>${esc(p.limitacoes)}</span></div>` : ''}
      <div class="es-text" style="margin-top:8px">${(p.fontes || []).map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.origem || 'fonte')}</a>`).join(' · ')}</div>
      <div class="es-actions">
        <button class="es-btn" data-action="desenvolver" data-id="${p.id}">Desenvolver</button>
        <button class="es-btn ghost" data-action="descartar-pauta" data-id="${p.id}">Descartar</button>
      </div>
    </article>`;
  }

  function telaDescobrir() {
    const d = state.descoberta;
    const dados = d.dados;
    const ok = (dados?.feeds || []).filter((f) => f.ok).length;
    const total = (dados?.feeds || []).length;
    return `
      <button class="es-btn ghost sm" style="width:auto" data-action="voltar">‹ Mesa</button>
      <div class="es-h1" style="margin-top:12px">Encontre uma pauta</div>
      <div class="es-sub">Notícias dos últimos 3 dias, lidas nos feeds dos próprios veículos. Não é uma busca completa nem um ranking de tendências.</div>
      <button class="es-btn" data-action="descobrir" ${d.carregando ? 'disabled' : ''}>${d.carregando ? '<span class="es-spin"></span> Lendo os veículos…' : dados ? 'Buscar de novo' : 'Buscar agora'}</button>
      ${d.erro ? `<div class="es-errbox">${esc(d.erro)}</div>` : ''}
      ${dados ? `<div class="es-text" style="margin-top:10px">Consultado ${esc(fmtData(dados.gerado_em))} · ${ok} de ${total} veículos lidos${dados.ia?.usada ? ` · justificativas por IA (${esc(dados.ia.provider)}/${esc(dados.ia.model)}); links, datas e veículos vêm do feed` : dados.ia?.erro ? ` · sem justificativas: ${esc(dados.ia.erro)}` : ''}</div>
        <details class="mz-det"><summary>Veículos consultados</summary>${dados.feeds.map((f) => `<div class="es-text">${f.ok ? '✓' : '✗'} ${esc(f.nome)}${f.ok ? ` (${f.itens} itens)` : ` — ${esc(f.erro)}`}</div>`).join('')}</details>
        ${dados.aviso_prioridade ? `<div class="es-text" style="margin-top:8px">${esc(dados.aviso_prioridade)}</div>` : ''}
        <div class="es-stack" style="margin-top:14px">${dados.pautas.map(cardPauta).join('') || '<div class="es-empty-day">Nenhuma notícia dos pilares nos últimos dias.</div>'}</div>
        ${(dados.descartadas || []).length ? `<details class="mz-det"><summary>${dados.descartadas.length} descartada(s): ver por quê</summary>${dados.descartadas.map((d) => `<div class="es-text"><b>${esc(d.titulo)}</b><br>${esc(d.detalhe)}</div>`).join('')}</details>` : ''}` : ''}
    `;
  }

  function telaConteudo() {
    const c = conteudoAtual();
    if (!c && state.novo && window.MesaEditor) return window.MesaEditor.telaNovo();
    if (!c) return '<div class="es-empty-day">Conteúdo não encontrado.</div>';
    const al = S.puro.alertasDoConteudo(c);
    const topo = `<button class="es-btn ghost sm" style="width:auto" data-action="voltar">‹ Mesa</button>
      <div class="mz-top" style="margin-top:12px"><span class="mz-status ${c.status}">${STATUS_ROTULO[c.status]}</span>${chipConta()}${chipServidor(c)}</div>
      <div class="es-h1">${esc(c.titulo)}</div>`;
    if (c.legado) return topo + telaLegado(c, al);
    return topo + (window.MesaEditor ? window.MesaEditor.render(c, { state, esc, fmtData }) : '<div class="es-empty-day">Editor em preparação.</div>');
  }

  function telaLegado(c, al) {
    const l = c.legado;
    return `
      <div class="es-warn">${esc(l.aviso)} Para publicar com segurança, refaça este assunto pela Mesa.</div>
      ${al.filter((a) => a.includes('@')).map((a) => `<div class="es-errbox">${esc(a)}: o @ correto é ${esc(M.ACCOUNT_PIN.handle)}. As artes antigas podem estar com o @ errado.</div>`).join('')}
      <div class="es-label">Formato</div><div class="es-text">${esc(l.formato || '—')}${l.tipo_carrossel ? ` · ${esc(l.tipo_carrossel)}` : ''}</div>
      ${l.legenda ? `<div class="es-label">Legenda gerada</div><div class="es-script">${esc(l.legenda)}</div>` : ''}
      ${l.roteiro ? `<div class="es-label">Roteiro</div><div class="es-script">${esc([l.roteiro.hook, ...(l.roteiro.blocos || []), l.roteiro.cta].filter(Boolean).join('\n'))}</div>` : ''}
      <div class="es-label">Arquivos guardados</div>
      <div id="legado-arquivos" class="es-thumbs" data-legado="${esc(c.id)}"></div>
      <div class="es-actions">
        <button class="es-btn ghost" data-action="agendar" data-id="${c.id}">${c.agenda?.data ? `Agendado: ${esc(fmtDia(c.agenda.data))}` : 'Agendar'}</button>
        <button class="es-btn danger" data-action="arquivar" data-id="${c.id}">Arquivar</button>
      </div>
      ${c.publicacao ? `<div class="es-text" style="margin-top:12px">Publicado${c.publicacao.url ? `: <a href="${esc(c.publicacao.url)}" target="_blank" rel="noopener noreferrer">ver post</a>` : ''}</div>` : ''}
      <div class="es-label">Histórico</div>
      ${c.historico.slice(-6).reverse().map((h) => `<div class="es-text">${esc(fmtData(h.em))} · ${esc(h.resumo)}</div>`).join('')}
    `;
  }

  function telaSemana() {
    const dias = C.weekDays(state.semana);
    const hoje = C.toISODate(new Date());
    const doDia = (d) => state.contents.filter((c) => c.agenda?.data === d && c.status !== 'arquivado');
    const semData = state.contents.filter((c) => !c.agenda?.data && ['rascunho', 'em_revisao', 'aprovado', 'exportado'].includes(c.status) && !c.legado);
    const f0 = dias[0].split('-'); const f6 = dias[6].split('-');
    return `
      <div class="es-between">
        <button class="es-btn sm ghost icon" data-action="sem" data-d="-7" aria-label="Semana anterior">‹</button>
        <div style="text-align:center"><div class="es-h1" style="font-size:20px">Semana</div><div class="es-sub" style="margin:0">${f0[2]}/${f0[1]} a ${f6[2]}/${f6[1]}</div></div>
        <button class="es-btn sm ghost icon" data-action="sem" data-d="7" aria-label="Próxima semana">›</button>
      </div>
      ${dias.map((d) => {
        const its = doDia(d); const dow = C.parseISODate(d).getDay();
        const posta = state.config.posting_days.includes(dow);
        if (!its.length && !posta) return '';
        return `<section class="es-day"><div class="es-day-head ${d === hoje ? 'today' : ''}"><b>${DOW[dow]} ${d.slice(8)}/${d.slice(5, 7)}</b><span>${d === hoje ? 'hoje' : ''}</span></div>
          <div class="es-stack">${its.map(cardConteudo).join('') || '<div class="es-empty-day">Nada agendado.</div>'}</div></section>`;
      }).join('')}
      ${semData.length ? `<div class="es-label">Sem data</div><div class="es-stack">${semData.map(cardConteudo).join('')}</div>` : ''}
      <div class="es-text" style="margin-top:16px">Métricas de resultado ficam para a próxima entrega: só vão aparecer ligadas ao post publicado de verdade.</div>`;
  }

  function secaoConta() {
    const c = state.conta;
    const p = c.perfil;
    return `<div class="es-card">
      <div class="es-title" style="margin-top:0">Conta</div>
      <div class="es-text">Perfil de publicação: <b>${esc(M.ACCOUNT_PIN.handle)}</b>. Os conteúdos deste estúdio pertencem a esta conta.</div>
      ${c.ambiente ? `<div class="es-warn">Servidor: ${esc(c.ambiente)}</div>` : ''}
      ${p ? `<div class="es-text" style="margin-top:6px">Confirmada na API em ${esc(fmtData(p.checked_at))}: ${esc(p.username)}, ${Number(p.seguidores).toLocaleString('pt-BR')} seguidores, ${p.verified ? 'verificada' : 'não verificada (por isso nenhuma arte mostra selo)'}.</div>` : ''}
      ${c.erro ? `<div class="es-errbox">${esc(c.erro)}</div>` : ''}
      <button class="es-btn ghost sm" style="margin-top:10px" data-action="confirmar-conta" ${c.carregando ? 'disabled' : ''}>${c.carregando ? 'Conferindo…' : 'Confirmar conta na API (1 consulta)'}</button>
      <div class="es-text" style="margin-top:10px">${window.__picoAuth?.protected ? 'Acesso protegido por código.' : '<b>Acesso direto:</b> não é necessário código para usar a ferramenta.'} ${window.__picoAuth?.protected ? '<button class="es-chip pillar" style="border:0;cursor:pointer" data-action="sair">Sair deste aparelho</button>' : ''}</div>
    </div>`;
  }

  function secaoPerfil() {
    const i = state.insights;
    return `<div class="es-card" style="margin-top:12px">
      <div class="es-title" style="margin-top:0">Leitura do perfil</div>
      ${i ? `<div class="es-text">Lida em ${esc(fmtData(i.atualizado_em))} da conta ${esc(i.conta.username)}: ${i.amostra} posts de ${esc(fmtDia(i.periodo?.de))} a ${esc(fmtDia(i.periodo?.ate))}.
        Fora da conta: ${i.excluidos.colaboracoes} colaboração(ões) e ${i.excluidos.com_menos_de_72h} post(s) com menos de 72 h.</div>
        ${(i.hipoteses || []).map((h) => `<div class="mz-bloco"><b>Hipótese ${h.suficiente ? '' : '(amostra insuficiente)'}</b><span>${esc(h.texto)} ${esc(h.limitacoes)}</span></div>`).join('')}
        <div class="es-text" style="margin-top:8px">Não temos: ${esc((i.campos?.indisponiveis || []).join(', '))}.</div>` : '<div class="es-text">Ainda não lida. A leitura confere a conta antes de guardar qualquer coisa.</div>'}
      ${state.insightsError ? `<div class="es-errbox">${esc(state.insightsError)}</div>` : ''}
      <button class="es-btn ghost sm" style="margin-top:10px" data-action="ler-perfil" ${state.insightsLoading ? 'disabled' : ''}>${state.insightsLoading ? '<span class="es-spin"></span> Lendo…' : 'Ler meu perfil (2 a 3 consultas)'}</button>
    </div>`;
  }

  function secaoArmazenamento() {
    const st = state.storage;
    const conf = (k, txt, cls = 'ghost') => (state.confirmando === k
      ? `<button class="es-btn danger sm" data-action="${k}-sim">Confirmar</button><button class="es-btn ghost sm" data-action="cancelar-confirmacao">Cancelar</button>`
      : `<button class="es-btn ${cls} sm" data-action="${k}">${txt}</button>`);
    return `<div class="es-card" style="margin-top:12px">
      <div class="es-title" style="margin-top:0">Armazenamento e recuperação</div>
      ${secaoServidor()}
      <div class="es-label">Cópia neste navegador</div>
      <div class="es-text">Tudo é gravado <b>neste navegador</b> (IndexedDB) a cada alteração. ${st.persistente === true ? 'O navegador marcou como persistente.' : 'O navegador não garantiu persistência: ele pode limpar os dados se faltar espaço.'}${st.uso ? ` Em uso: ${(st.uso / 1048576).toFixed(1)} MB.` : ''}</div>
      <div class="es-text" style="margin-top:6px">“Baixar backup” gera um arquivo que fica com você, fora do navegador e do servidor.</div>
      <div class="es-actions">
        <button class="es-btn" data-action="exportar-backup">Baixar backup (arquivo)</button>
        <label class="es-btn ghost" style="cursor:pointer">Importar backup<input type="file" accept="application/json,.json" id="import-backup" hidden></label>
      </div>
      ${state.resultadoImport ? `<div class="es-warn">Importado: ${state.resultadoImport.adicionados} novo(s), ${state.resultadoImport.substituidos} atualizado(s) (o anterior ficou guardado), ${state.resultadoImport.mantidos} mantido(s) por serem mais recentes aqui.</div>` : ''}
      <div class="es-label">Backups locais automáticos (só neste navegador: diário, últimos 7)</div>
      ${state.backups.length ? state.backups.map((b) => `<div class="es-between" style="margin-bottom:8px"><span class="es-text">${esc(fmtData(b.em))} · ${esc(b.motivo)} · ${b.n} conteúdo(s)</span>
        ${state.confirmando === `restaurar-${b.id}` ? `<span class="es-row"><button class="es-btn danger sm" style="width:auto" data-action="restaurar-sim" data-id="${b.id}">Restaurar</button><button class="es-btn ghost sm" style="width:auto" data-action="cancelar-confirmacao">Não</button></span>` : `<button class="es-btn ghost sm" style="width:auto" data-action="restaurar" data-id="${b.id}">Restaurar</button>`}</div>`).join('') : '<div class="es-text">Nenhum ainda. O primeiro é criado quando houver conteúdo.</div>'}
      <button class="es-btn ghost sm" style="margin-top:8px" data-action="backup-agora">Criar backup agora</button>
    </div>`;
  }

  function secaoServidor() {
    const sv = state.servidor;
    if (!sv) return '<div class="es-text">Verificando a cópia no servidor…</div>';
    const busca = sv.cobertura ? `<div class="es-label">Cobertura da pesquisa</div><div class="es-text">${esc(sv.cobertura)}</div>` : '';
    return busca + secaoServidorCopia(sv);
  }
  function secaoServidorCopia(sv) {
    if (!sv.configurado) return `<div class="es-warn"><b>Sem cópia no servidor.</b> A única cópia está neste navegador. Se ele for limpo ou o aparelho for perdido, o trabalho só volta pelo arquivo de backup.</div>`;
    const metas = Object.values(state.syncMeta);
    const conferidos = state.contents.filter((c) => state.syncMeta[c.id]?.conferido && !state.syncMeta[c.id]?.conflito).length;
    const conflitos = state.contents.filter((c) => state.syncMeta[c.id]?.conflito);
    const u = state.servidor.ultimo;
    return `<div class="es-label">Cópia no servidor</div>
      <div class="es-text"><b>Conectada</b> (${esc(sv.tipo)}). ${conferidos} de ${state.contents.length} conteúdo(s) gravados e conferidos lá.${u ? ` Última sincronização: ${esc(fmtData(u.em))} — ${u.enviados} enviado(s), ${u.trazidos || 0} trazido(s), ${u.erros + (u.nao_conferidos || 0)} com erro.` : ''}</div>
      ${metas.some((m) => m.erro && !m.conferido) ? '<div class="es-warn">Alguns conteúdos não foram confirmados no servidor. Eles continuam salvos aqui.</div>' : ''}
      ${conflitos.map((c) => `<div class="es-warn"><b>Conflito em “${esc(c.titulo)}”:</b> outro aparelho gravou uma versão diferente. Nenhuma foi perdida.<div class="es-actions"><button class="es-btn ghost sm" data-action="conflito" data-id="${c.id}" data-escolha="servidor">Usar a do servidor (a daqui vira snapshot)</button><button class="es-btn ghost sm" data-action="conflito" data-id="${c.id}" data-escolha="local">Manter a deste aparelho (a do servidor fica no histórico de lá)</button></div></div>`).join('')}
      <button class="es-btn ghost sm" style="margin:8px 0" data-action="sincronizar" ${state.sincronizando ? 'disabled' : ''}>${state.sincronizando ? '<span class="es-spin"></span> Sincronizando…' : 'Sincronizar agora'}</button>`;
  }

  async function carregarSync() {
    if (!window.Sync) return;
    state.servidor = await window.Sync.status(true);
    if (state.servidor.configurado) {
      state.servidor.ultimo = await S.cfgGet('sync_ultimo');
      for (const c of state.contents) state.syncMeta[c.id] = (await window.Sync.meta(c.id)) || {};
      // Encerramento aprovado enviado de outro aparelho.
      if (!state.encerramento) {
        const b = await window.Sync.baixarArquivo('upload:encerramento').catch(() => null);
        if (b) {
          await S.salvarBlob('upload:encerramento', b, { origem: 'servidor' });
          const bmp = await createImageBitmap(b).catch(() => null);
          state.encerramento = { nome: 'encerramento (do servidor)', largura: bmp?.width, altura: bmp?.height, em: new Date().toISOString(), tipo: b.type };
          await S.cfgSet('encerramento_aprovado', state.encerramento);
        }
      }
    }
  }

  async function sincronizar() {
    if (state.sincronizando) return;
    state.sincronizando = true; render();
    try {
      const r = await window.Sync.sincronizarTudo();
      await carregar(); await carregarSync();
      if (r.configurado) toast(`Servidor: ${r.enviados} enviado(s) e conferido(s), ${r.trazidos} trazido(s)${r.conflitos ? `, ${r.conflitos} conflito(s)` : ''}${r.erros ? `, ${r.erros} erro(s)` : ''}.`);
    } catch (e) { toast(`Sincronização falhou: ${e.message}. Nada local foi alterado.`); } finally { state.sincronizando = false; render(); }
  }

  function secaoQuarentena() {
    const q = state.quarentena;
    return `<div class="es-card" style="margin-top:12px">
      <div class="es-title" style="margin-top:0">Dados isolados (quarentena)</div>
      <div class="es-text">Dados sem origem confirmada ou apagados por você. Nada é descartado em silêncio: ficam aqui, fora de uso.</div>
      ${q.length ? q.map((x, i) => `<div class="mz-bloco"><b>${esc(x.motivo)}</b><span>${esc(fmtData(x.em))} · ${esc(x.origem)}</span>
        <button class="es-chip pillar" style="border:0;cursor:pointer;margin-top:6px" data-action="ver-json" data-i="${i}">${state.verJson === i ? 'Ocultar' : 'Ver conteúdo'}</button>
        ${state.verJson === i ? `<pre class="mz-pre">${esc(JSON.stringify(x.dado, null, 1).slice(0, 4000))}</pre>` : ''}</div>`).join('') : '<div class="es-text" style="margin-top:8px">Nada isolado.</div>'}
    </div>`;
  }

  function secaoVoz() {
    const v = state.config.voice_profile ?? E.VOICE_PROFILE_PADRAO;
    return `<div class="es-card" style="margin-top:12px"><div class="es-title" style="margin-top:0">Tom de voz</div>
      <div class="es-text">Entra em toda geração de texto e legenda. Orienta o estilo; não autoriza inventar fatos, números ou histórias.</div>
      <textarea id="voz-perfil" class="es-input" rows="6" maxlength="1500">${esc(v)}</textarea>
      <div class="es-actions"><button class="es-btn" data-action="salvar-voz">Salvar tom de voz</button><button class="es-btn ghost" data-action="voz-padrao">Voltar ao padrão</button></div></div>`;
  }

  function secaoRotina() {
    const cfg = state.config;
    return `<div class="es-card" style="margin-top:12px">
      <div class="es-title" style="margin-top:0">Pilares</div>
      <div class="es-text">O nome é livre; as palavras (separadas por vírgula) filtram as notícias.</div>
      ${cfg.pilares.map((p, i) => `<div class="mz-pilar"><input class="es-input" data-pilar-nome="${i}" value="${esc(p.nome)}" aria-label="Nome do pilar"><input class="es-input" data-pilar-palavras="${i}" value="${esc((p.palavras || []).join(', '))}" aria-label="Palavras do pilar"></div>`).join('')}
      <button class="es-btn ghost sm" data-action="salvar-pilares">Salvar pilares</button>
      <div class="es-label">Dias de postagem</div>
      <div class="es-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-action="dia" data-d="${d}" aria-pressed="${cfg.posting_days.includes(d)}">${DOW[d]}</button>`).join('')}</div>
      <div class="es-label">Encerramento aprovado</div>
      <div class="es-text">${state.encerramento ? `Arquivo guardado: ${esc(state.encerramento.nome)} (${state.encerramento.largura}×${state.encerramento.altura}). Entra como último slide, sem alteração.` : 'Nenhum arquivo ainda. Sem ele o último slide usa só texto e fica marcado como provisório. Envie o arquivo aprovado (PNG 1080×1350).'}</div>
      <label class="es-btn ghost sm" style="cursor:pointer;margin-top:8px">${state.encerramento ? 'Trocar arquivo' : 'Enviar arquivo'}<input type="file" accept="image/png,image/jpeg" id="enviar-encerramento" hidden></label>
      <div class="es-label">Ferramentas escondidas</div>
      <div class="es-days" style="grid-template-columns:1fr"><button data-action="mod-videoia" aria-pressed="${!cfg.hidden_modules.includes('videoIA')}">Vídeo IA ${cfg.hidden_modules.includes('videoIA') ? '(escondido)' : '(visível)'}</button></div>
    </div>`;
  }

  function telaAjustes() {
    if(window.StudioMobile)return `<div class="st-profile"><span class="st-eyebrow">PEDRO DESTRAVA</span><h1>Seu perfil</h1>${window.StudioMobile.perfil()}<details class="st-advanced" ${state.ajustesAvancado ? 'open' : ''}><summary>Configurações e editor avançado</summary>${secaoConta()}${window.MesaCentral ? window.MesaCentral.secaoConexoes() : ''}${window.MesaEstrategia ? window.MesaEstrategia.secao() : ''}${secaoVoz()}${secaoPerfil()}${secaoArmazenamento()}${secaoQuarentena()}${secaoRotina()}<button class="es-btn ghost" data-action="tab" data-tab="criar">Abrir ferramentas extras</button></details></div>`;
    return `<div class="es-h1">Ajustes</div>${secaoConta()}${window.MesaCentral ? window.MesaCentral.secaoConexoes() : ''}${window.MesaEstrategia ? window.MesaEstrategia.secao() : ''}${secaoVoz()}${secaoPerfil()}${secaoArmazenamento()}${secaoQuarentena()}${secaoRotina()}`;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const CRIAR = [
    { id: 'carousels', label: 'Carrossel' }, { id: 'tvcuts', label: 'Cortes TV' }, { id: 'editor', label: 'Reel por link' },
    { id: 'reels', label: 'Reciclar' }, { id: 'video', label: 'Vídeo IA', flag: 'videoIA' },
  ];
  const escondido = (m) => { const x = CRIAR.find((k) => k.id === m); return x?.flag && state.config.hidden_modules.includes(x.flag); };
  const trocarAntigo = (tab) => { if (window.__picoSwitchTab) window.__picoSwitchTab(tab); else setTimeout(() => trocarAntigo(tab), 200); };

  let ultimaTela = '';
  const scrollDasTelas = new Map();
  function estadoSalvamento() {
    if (!S.ok || !state.storage.ok) return ['err', 'Verificar salvamento'];
    if (state.sincronizando) return ['loading', 'Sincronizando…'];
    if (!state.servidor) return ['loading', 'Verificando conexão…'];
    if (!state.servidor.configurado) return ['warn', 'Salvo neste navegador'];
    if (state.contents.some(c => state.syncMeta[c.id]?.conflito || (state.syncMeta[c.id]?.erro && !state.syncMeta[c.id]?.conferido))) return ['warn', 'Revisar sincronização'];
    return ['ok', 'Conectado ao servidor'];
  }

  function render() {
    if (!state.pronto) { root.innerHTML = '<main class="es-main"><div class="es-empty-day">Abrindo seu trabalho…</div></main>'; return; }
    const scroll = root.querySelector('.es-main')?.scrollTop || 0;
    if (ultimaTela) scrollDasTelas.set(ultimaTela, scroll);
    const tela = `${state.tab}:${state.sub || ''}:${state.atual || ''}`;
    const mudouTela = tela !== ultimaTela;
    document.body.dataset.studioTab = state.tab;
    // Quem está digitando não perde o texto quando uma resposta do servidor redesenha a tela.
    const foco = document.activeElement && root.contains(document.activeElement) && document.activeElement.id && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'file'
      ? { id: document.activeElement.id, valor: document.activeElement.value, ini: document.activeElement.selectionStart, fim: document.activeElement.selectionEnd } : null;
    const botaoFocado = root.contains(document.activeElement) && document.activeElement?.dataset?.action ? { ...document.activeElement.dataset } : null;
    let corpo = '';
    if (state.tab === 'mesa') corpo = state.sub === 'descobrir' ? telaDescobrir() : state.sub === 'conta-aberta' ? (window.ContaAberta ? window.ContaAberta.render(ctxEditor()) : '') : state.sub === 'conteudo' ? telaConteudo() : telaMesa();
    else if (state.tab === 'central') corpo = window.MesaCentral ? window.MesaCentral.render(ctxEditor()) : '';
    else if (state.tab === 'resultados') corpo = window.MeuInstagram ? window.MeuInstagram.render(ctxEditor()) : '';
    else if (state.tab === 'semana') corpo = telaSemana();
    else if (state.tab === 'ajustes') corpo = telaAjustes();
    const nCentral = window.MesaCentral ? window.MesaCentral.badge() : 0;
    const tabs = window.StudioMobile ? [['central', 'Aprovar'], ['mesa', 'Criar'], ['criar', 'Ferramentas'], ['resultados', 'Resultados'], ['ajustes', 'Perfil']] : [['mesa', 'Mesa'], ['central', 'Central'], ['criar', 'Criar'], ['resultados', 'Resultados'], ['ajustes', 'Ajustes']];
    const [saveClass, saveText] = estadoSalvamento();
    root.innerHTML = `
      <a class="studio-skip" href="#${state.tab === 'criar' ? 'pico-legacy-app' : 'studio-main'}">Ir para o conteúdo</a>
      <div class="studio-brand"><img class="st-brand-logo" src="/logo-app.svg" alt="" width="36" height="36"><div><b>PEDRO DESTRAVA</b><span>Estúdio de conteúdo</span></div></div>
      <header class="studio-header"><div class="studio-breadcrumb">Meu estúdio <span>/</span> <b>${tabs.find(t => t[0] === state.tab)?.[1] || 'Mesa'}</b></div><button class="studio-save ${saveClass}" data-action="tab" data-tab="ajustes" aria-label="${saveText}. Ver ajustes de armazenamento"><i aria-hidden="true"></i><span>${saveText}</span></button><span class="studio-avatar" title="${esc(M.ACCOUNT_PIN.handle)}">PD</span></header>
      <div class="es-top" ${state.tab === 'criar' ? '' : 'hidden'}>${CRIAR.filter((m) => !escondido(m.id)).map((m) => `<button data-action="criar" data-m="${m.id}" aria-pressed="${state.criarModulo === m.id}">${m.label}</button>`).join('')}</div>
      <main id="studio-main" class="es-main" tabindex="-1" ${state.tab === 'criar' ? 'hidden' : ''}><div class="studio-page ${state.tab === 'mesa' && !state.sub ? 'studio-home' : ''}">${corpo}</div></main>
      <div class="es-toast-slot">${state.toast ? `<div class="es-toast" role="status">${esc(state.toast)}</div>` : ''}</div>
      <nav class="es-nav" aria-label="Navegação principal">${tabs.map(([id, l]) => `<button data-action="tab" data-tab="${id}" aria-current="${state.tab === id ? 'page' : 'false'}">${ICON[id]}<span>${l}</span>${id === 'central' && nCentral ? `<i class="es-badge" aria-label="${nCentral} para aprovar">${nCentral}</i>` : ''}</button>`).join('')}</nav>`;
    root.insertAdjacentHTML('beforeend', `<div class="studio-rail-footer"><span class="studio-avatar">PD</span><div><b>Pedro Destrava</b><span>${esc(M.ACCOUNT_PIN.handle)}</span></div></div>`);
    const m = root.querySelector('.es-main');
    if (m) { m.scrollTop = mudouTela ? (scrollDasTelas.get(tela) || 0) : scroll; if (mudouTela && !m.hidden) m.focus({ preventScroll: true }); }
    ultimaTela = tela;
    if (foco) {
      const el = root.querySelector(`#${CSS.escape(foco.id)}`);
      if (el) { el.value = foco.valor; try { el.focus({ preventScroll: true }); el.setSelectionRange(foco.ini, foco.fim); } catch { /* sem seleção */ } }
    } else if (botaoFocado && (!mudouTela || state.tab === 'criar')) {
      const botao = [...root.querySelectorAll('[data-action]')].find(el => Object.entries(botaoFocado).every(([k,v]) => el.dataset[k] === v));
      botao?.focus({ preventScroll: true });
    }
    if (state.tab === 'mesa' && state.sub === 'conteudo') preencherArquivosLegado();
    if (window.MesaEditor?.aposRender) window.MesaEditor.aposRender(root, { state });
  }

  async function preencherArquivosLegado() {
    const el = root.querySelector('#legado-arquivos'); if (!el) return;
    const id = el.dataset.legado; const c = state.contents.find((x) => x.id === id); if (!c) return;
    const n = (c.legado?.arquivos || []).length;
    const partes = [];
    for (let i = 0; i < n; i++) {
      const b = await S.obterBlob(`legacy:${c.legado.id_original}:${i}`);
      if (b?.blob?.type?.startsWith('image/')) partes.push(`<img src="${URL.createObjectURL(b.blob)}" alt="Arquivo ${i + 1} da fila anterior">`);
      else if (b?.blob) partes.push(`<a class="es-chip pillar" href="${URL.createObjectURL(b.blob)}" download="${esc(b.nome || `arquivo-${i + 1}`)}">${esc(b.nome || `arquivo ${i + 1}`)}</a>`);
    }
    el.innerHTML = partes.join('') || '<div class="es-text">Os arquivos não estão neste aparelho.</div>';
  }

  // ── Eventos ─────────────────────────────────────────────────────────────────
  // O painel "Configurações" é recriado a cada ação; lembrar se estava aberto evita que ele feche sozinho.
  root.addEventListener('toggle', (ev) => { if (ev.target.classList && ev.target.classList.contains('st-advanced')) state.ajustesAvancado = ev.target.open; }, true);
  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]'); if (!el) return;
    const a = el.dataset.action; const id = el.dataset.id;
    try {
      if (window.MesaEditor?.acao && await window.MesaEditor.acao(a, el, ctxEditor())) return;
      if (window.MesaCentral?.acao && await window.MesaCentral.acao(a, el, ctxEditor())) return;
      if (window.MeuInstagram?.acao && await window.MeuInstagram.acao(a, el, ctxEditor())) return;
      if (window.MesaEstrategia?.acao && await window.MesaEstrategia.acao(a, el, ctxEditor())) return;
      if (window.ContaAberta?.acao && await window.ContaAberta.acao(a, el, ctxEditor())) return;
      switch (a) {
        case 'tab': state.tab = el.dataset.tab; if (state.tab === 'resultados') window.MeuInstagram?.carregar(ctxEditor()); if (state.tab === 'central') window.MesaCentral?.carregar(ctxEditor()); if (state.tab === 'ajustes') { window.MesaCentral?.carregar(ctxEditor(), { forcarSaude: true }); window.MesaEstrategia?.carregar(ctxEditor()); } if (state.tab === 'mesa' && state.sub === 'conteudo') { /* mantém */ } if (state.tab === 'criar') trocarAntigo(state.criarModulo); return render();
        case 'criar': state.criarModulo = el.dataset.m; trocarAntigo(state.criarModulo); return render();
        case 'voltar': state.sub = null; state.atual = null; state.novo = null; return render();
        case 'abrir': return abrirConteudo(id);
        case 'filtro': state.filtro = el.dataset.f; return render();
        case 'resumo': state.filtro = el.dataset.f; state.busca = ''; render(); root.querySelector('.studio-library')?.scrollIntoView({ block: 'start' }); return;
        case 'limpar-filtros': state.busca = ''; state.filtro = 'todos'; render(); root.querySelector('#library-search')?.focus({ preventScroll: true }); return;
        case 'entrada':
          if (el.dataset.e === 'descobrir') { state.sub = 'descobrir'; render(); if (!state.descoberta.dados) descobrir(); return; }
          if (el.dataset.e === 'link') { state.sub = 'conteudo'; state.atual = null; return window.MesaEditor?.novoPorLink ? window.MesaEditor.novoPorLink(ctxEditor()) : toast('Disponível na próxima etapa.'); }
          return toast('A entrada por ideia e áudio vem na próxima entrega.');
        case 'descobrir': return descobrir();
        case 'descartar-pauta': { const d = state.descoberta.dados; d.pautas = d.pautas.filter((p) => p.id !== id); return render(); }
        case 'desenvolver': {
          const p = state.descoberta.dados.pautas.find((x) => x.id === id);
          if (window.MesaEditor?.desenvolverPauta) return window.MesaEditor.desenvolverPauta(p, ctxEditor());
          return toast('O desenvolvimento da pauta chega com o fluxo completo (próxima etapa).');
        }
        case 'sem': state.semana = C.addDays(state.semana, Number(el.dataset.d)); return render();
        case 'agendar': {
          const c = state.contents.find((x) => x.id === id);
          c.agenda = { data: c.agenda?.data ? null : C.toISODate(new Date()) };
          M.registrar(c, 'pedro', 'agenda', c.agenda.data ? `Agendou para ${c.agenda.data}` : 'Removeu a data');
          await persistir(c); return render();
        }
        case 'arquivar': { const c = state.contents.find((x) => x.id === id); c.status = 'arquivado'; M.registrar(c, 'pedro', 'arquivado', 'Arquivou'); await S.snapshot(c, 'arquivado'); await persistir(c); state.sub = null; return render(); }
        case 'confirmar-conta': return confirmarConta(true);
        case 'ler-perfil': return lerPerfil();
        case 'sair': return window.PicoAuth?.sair();
        case 'salvar-voz': { const t = root.querySelector('#voz-perfil')?.value.trim() || ''; await salvarConfig({ voice_profile: t }); toast('Tom de voz salvo.'); return render(); }
        case 'voz-padrao': await salvarConfig({ voice_profile: E.VOICE_PROFILE_PADRAO }); toast('Voltou ao tom padrão.'); return render();
        case 'sincronizar': return sincronizar();
        case 'conflito': { const r = await window.Sync.resolverConflito(id, el.dataset.escolha); await carregar(); await carregarSync(); toast(r === 'servidor' ? 'Agora vale a cópia do servidor. A deste aparelho ficou como snapshot.' : 'A cópia deste aparelho foi enviada.'); return render(); }
        case 'exportar-backup': { const blob = await S.exportar(); await entregarArquivo(blob, `pico-backup-${C.toISODate(new Date())}.json`); return toast('Backup gerado.'); }
        case 'backup-agora': await S.criarBackupAutomatico('manual'); state.backups = await S.listarBackups(); toast('Backup criado.'); return render();
        case 'restaurar': state.confirmando = `restaurar-${id}`; return render();
        case 'restaurar-sim': { state.resultadoImport = await S.restaurarBackup(id); state.confirmando = null; await carregar(); toast('Backup restaurado sem apagar nada que fosse mais novo.'); return render(); }
        case 'cancelar-confirmacao': state.confirmando = null; return render();
        case 'ver-json': state.verJson = state.verJson === Number(el.dataset.i) ? null : Number(el.dataset.i); return render();
        case 'salvar-pilares': {
          const pilares = state.config.pilares.map((p, i) => ({
            ...p,
            nome: root.querySelector(`[data-pilar-nome="${i}"]`)?.value.trim() || p.nome,
            palavras: (root.querySelector(`[data-pilar-palavras="${i}"]`)?.value || '').split(',').map((x) => x.trim()).filter(Boolean),
          }));
          await salvarConfig({ pilares }); toast('Pilares salvos.'); return render();
        }
        case 'dia': { const d = Number(el.dataset.d); const set = new Set(state.config.posting_days); set.has(d) ? set.delete(d) : set.add(d); if (!set.size) return toast('Deixe pelo menos um dia.'); await salvarConfig({ posting_days: [...set].sort() }); return render(); }
        case 'mod-videoia': { const s = new Set(state.config.hidden_modules); s.has('videoIA') ? s.delete('videoIA') : s.add('videoIA'); await salvarConfig({ hidden_modules: [...s] }); return render(); }
        default:
      }
    } catch (e) { toast(e.message || 'Algo deu errado.'); render(); }
  });

  root.addEventListener('change', async (ev) => {
    const el = ev.target;
    try {
      if (el.id === 'library-sort') { state.ordem = el.value; root.querySelector('#library-results').innerHTML = resultadosBiblioteca(); return; }
      if (el.id === 'import-backup' && el.files?.[0]) { state.resultadoImport = await S.importarArquivo(el.files[0]); await carregar(); toast('Backup importado.'); render(); }
      if (el.id === 'enviar-encerramento' && el.files?.[0]) {
        const f = el.files[0];
        const bmp = await createImageBitmap(f);
        await S.salvarBlob('upload:encerramento', f, { nome: f.name });
        state.encerramento = { nome: f.name, largura: bmp.width, altura: bmp.height, em: new Date().toISOString(), tipo: f.type };
        await S.cfgSet('encerramento_aprovado', state.encerramento);
        if (state.servidor?.configurado && window.Sync) {
          await window.Sync.enviarArquivo('upload:encerramento', f).then(() => S.cfgSet('encerramento_no_servidor', true)).catch((e) => toast(`Encerramento guardado só neste aparelho: ${e.message}`));
        }
        toast(bmp.width === 1080 && bmp.height === 1350 ? 'Arquivo guardado.' : `Guardado, mas o tamanho é ${bmp.width}×${bmp.height} (o esperado é 1080×1350).`);
        render();
      }
      if (window.MesaEditor?.aoMudar) await window.MesaEditor.aoMudar(el, ctxEditor());
      if (window.MesaCentral?.aoMudar) await window.MesaCentral.aoMudar(el, ctxEditor());
    } catch (e) { toast(e.message || 'Não foi possível concluir.'); }
  });

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'library-search') {
      state.busca = el.value;
      root.querySelector('#library-results').innerHTML = resultadosBiblioteca();
    }
    if (state.novo && ['ed-novo-url', 'ed-novo-texto'].includes(el.id)) state.novo[el.id === 'ed-novo-url' ? 'url' : 'texto'] = el.value;
  });

  // Contexto entregue ao editor (B): tudo que ele precisa, sem acesso ao resto.
  function ctxEditor() {
    return { state, M, G, S, E, api, esc, fmtData, toast, render, persistir, salvarConfig, abrirConteudo, criarConteudoDeFonte, novoId, entregarArquivo, recentesParaPrompt, conteudoAtual };
  }
  window.Mesa = { state, ctx: ctxEditor };

  // ── Início ──────────────────────────────────────────────────────────────────
  (async function init() {
    render();
    const r = await S.iniciar();
    state.storage = r.estado || { ok: false };
    state.migracao = r.migracao || null;
    if (!r.ok) { state.pronto = true; render(); return; }
    await carregar();
    state.pronto = true;
    render();
    // Cópia no servidor: confere estado e sincroniza ao abrir (traz o que foi feito em outro aparelho).
    carregarSync().then(() => { render(); if (state.servidor?.configurado) sincronizar(); }).catch(() => {});
    window.addEventListener('pico-sync', async (ev) => { if (window.Sync) { state.syncMeta[ev.detail.id] = (await window.Sync.meta(ev.detail.id)) || {}; } });
    api('/api/account').then((x) => { state.conta = { ...state.conta, esperado: x.esperado, ambiente: x.ambiente_com_problema }; render(); }).catch(() => {});
  })();
})();
