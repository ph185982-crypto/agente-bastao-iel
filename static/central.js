// Central de aprovação: os conteúdos prontos em fluxo, um toque para aprovar e publicar.
//
// "Aprovar" aqui é a MESMA aprovação do editor: só libera se não houver bloqueio de
// revisão (fatos, conta, arte). Publicar só acontece depois dessa aprovação explícita
// e usa a versão aprovada (o servidor confere o hash e as regras de novo).
// O app não "chuta" resultado: um card só vira "Publicado" quando a Meta confirmar.
(function () {
  'use strict';
  const M = window.ContentModel;
  const G = window.QualityGates;
  const S = window.Store;

  const ABAS = [['aprovar', 'Para aprovar'], ['publicando', 'Publicando'], ['publicados', 'Publicados'], ['erro', 'Com erro'], ['descartados', 'Descartados']];
  const INTERMEDIARIOS = ['iniciada', 'aguardando_processamento', 'publicando_final'];
  const GOV = /(^|\.)(gov|leg|jus|mp|mil)\.br$/i;

  const st = { aba: 'aprovar', config: null, saude: null, pubs: {}, ocupado: {}, poll: {}, carregou: false, carregando: false, erroServidor: null, saudeEm: 0 };

  const ctx = () => window.Mesa.ctx();
  const pubDe = (id) => st.pubs[id] || null;
  const ehPublicavel = (c) => !c.legado && !!M.versaoAtiva(c);

  function abaDe(c) {
    if (c.legado) return null;
    const p = pubDe(c.id);
    if (c.status === 'arquivado') return 'descartados';
    if (c.status === 'publicado' || p?.estado === 'publicada') return 'publicados';
    if (p?.estado === 'erro') return 'erro';
    if (p && INTERMEDIARIOS.includes(p.estado)) return 'publicando';
    if (['aprovado', 'exportado'].includes(c.status)) return 'publicando';
    return ehPublicavel(c) ? 'aprovar' : null;
  }

  const badge = () => (window.Mesa?.state?.contents || []).filter((c) => abaDe(c) === 'aprovar').length;

  // ── Servidor ────────────────────────────────────────────────────────────────
  async function carregar(x, { forcarSaude = false } = {}) {
    if (st.carregando) return;
    st.carregando = true;
    try {
      const [cfg, lista] = await Promise.all([x.api('/api/publish/config'), x.api('/api/publish/status').catch(() => ({ publicacoes: [] }))]);
      st.config = cfg.config; st.pubs = Object.fromEntries((lista.publicacoes || []).map((p) => [p.content_id, p]));
      st.erroServidor = null;
      // Retoma o que ficou no meio (app fechado): o servidor guardou o estado.
      Object.values(st.pubs).filter((p) => INTERMEDIARIOS.includes(p.estado)).forEach((p) => iniciarPolling(x, p.content_id));
    } catch (e) { st.erroServidor = e.message; }
    if (forcarSaude || Date.now() - st.saudeEm > 60000) await carregarSaude(x, true);
    st.carregou = true; st.carregando = false; x.render();
  }

  async function carregarSaude(x, silencioso) {
    try { st.saude = await x.api('/api/publish/instagram/health'); } catch (e) { st.saude = { configurado: false, erro: e.message }; }
    st.saudeEm = Date.now();
    if (!silencioso) x.render();
  }

  // ── Aprovar e publicar ──────────────────────────────────────────────────────
  const reabrirAprovacao = (c) => {
    if (c.revisao.aprovada_versao) {
      c.revisao = { aprovada_versao: null, aprovada_em: null, hash_aprovado: null, reaberta_em: new Date().toISOString() };
      if (['aprovado', 'exportado'].includes(c.status)) c.status = 'em_revisao';
    }
  };

  async function enviarArquivosDoConteudo(x, c) {
    const v = M.versaoAtiva(c);
    for (const s of v.slides) {
      if (!s.imagem_id) continue;
      const b = await S.obterBlob(`img:${s.imagem_id}`);
      if (!b?.blob) throw new Error('A foto de um slide não está neste aparelho. Envie a foto de novo.');
      await window.Sync.enviarArquivo(`img:${s.imagem_id}`, b.blob);
    }
    if (v.slides.some((s) => s.layout === 'encerramento')) {
      const enc = await S.obterBlob('upload:encerramento');
      if (enc?.blob) await window.Sync.enviarArquivo('upload:encerramento', enc.blob);
    }
  }

  async function publicar(x, c) {
    if (!x.state.servidor?.configurado) throw new Error('Publicar exige a cópia no servidor (banco de dados). Hoje o trabalho está só neste navegador: conecte o banco em Ajustes.');
    await enviarArquivosDoConteudo(x, c);
    const r = await window.Sync.enviar(c);
    if (!['enviado', 'igual'].includes(r.estado)) throw new Error('Não consegui gravar este conteúdo no servidor (' + (r.erro || r.estado) + '). Sem isso não dá para publicar.');
    const resp = await x.api(`/api/publish/instagram/${encodeURIComponent(c.id)}`, { method: 'POST', body: { hash_versao: c.revisao.hash_aprovado } });
    st.pubs[c.id] = resp;
    M.registrar(c, 'sistema', 'publicacao', `Enviado ao Instagram (${resp.estado})`);
    await x.persistir(c);
    iniciarPolling(x, c.id);
  }

  async function aprovarEPublicar(x, id) {
    if (st.ocupado[id]) return;      // duplo toque: o servidor também protege, mas nem pede duas vezes
    st.ocupado[id] = true; x.render();
    try {
      const c = x.state.contents.find((k) => k.id === id);
      const v = M.versaoAtiva(c);
      const g = G.avaliar(c, { conta: M.ACCOUNT_PIN, recentes: x.recentesParaPrompt() });
      if (g.bloqueios.length) { x.toast(`Ainda há ${g.bloqueios.length} pendência(s) de revisão. Toque em Revisar.`); return; }
      if (c.revisao.aprovada_versao !== v.id || c.revisao.hash_aprovado !== v.hash) {
        M.aprovar(c, g); await S.snapshot(c, 'aprovado'); await x.persistir(c);
      }
      if (st.config?.publish_paused) { x.toast('Publicações pausadas: o item ficou aprovado e NÃO foi enviado ao Instagram.'); return; }
      await publicar(x, c);
      x.toast('Enviado. Só vira "Publicado" quando o Instagram confirmar.');
    } catch (e) {
      x.toast(e.message || 'Não foi possível publicar.');
      if (e.detalhe?.reconectar) st.saude = { ...(st.saude || {}), reconectar: true };
    } finally { delete st.ocupado[id]; x.render(); }
  }

  // ── Polling: o servidor avança a máquina de estados a cada consulta ─────────
  function iniciarPolling(x, id) {
    if (st.poll[id]) return;
    st.poll[id] = true;
    (async () => {
      let n = 0;
      try {
        while (n < 90) {
          n += 1;
          await new Promise((r) => setTimeout(r, n < 4 ? 1500 : 3000));
          let p;
          try { p = await x.api(`/api/publish/instagram/${encodeURIComponent(id)}/status`); } catch (e) { if (e.status === 404) break; continue; }
          st.pubs[id] = p;
          if (p.reconectar) st.saude = { ...(st.saude || {}), reconectar: true };
          if (!INTERMEDIARIOS.includes(p.estado)) { await finalizarLocal(x, id, p); break; }
          x.render();
        }
      } finally { delete st.poll[id]; x.render(); }
    })();
  }

  async function finalizarLocal(x, id, p) {
    const c = x.state.contents.find((k) => k.id === id);
    if (!c) return;
    c.publicacoes = [{ network: 'instagram', status: p.estado, creation_id: p.creation_id, post_id: p.ig_media_id, permalink: p.permalink, published_at: p.publicada_em, error_raw: p.erro?.mensagem_original || null, error_friendly: p.erro?.amigavel || null, versao: p.versao, hash_versao: p.hash_versao }];
    if (p.estado === 'publicada' && c.status !== 'publicado') {
      try {
        if (c.revisao.aprovada_versao && M.versaoAtiva(c).hash === p.hash_versao) M.registrarExportacao(c, { arquivos: ['publicado_instagram'], hashes: [] });
        M.registrarPublicacao(c, { url: p.permalink, ig_post_id: p.ig_media_id, publicado_em: p.publicada_em });
        if (c.publicacao) c.publicacao.versao_publicada = p.versao;   // a versão que a Meta realmente recebeu
      } catch { c.status = 'publicado'; }
    }
    M.registrar(c, 'sistema', 'publicacao', p.estado === 'publicada' ? 'Publicado no Instagram' : `Publicação com erro: ${p.erro?.amigavel || p.estado}`);
    await x.persistir(c);
  }

  // ── Telas ───────────────────────────────────────────────────────────────────
  const dia = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const motivoDesabilitado = (c, g) => {
    if (g.bloqueios.length) return `${g.bloqueios.length} pendência(s) de revisão: ${g.bloqueios[0].titulo}`;
    return '';
  };

  function preview(c, esc) {
    const v = M.versaoAtiva(c);
    const imgs = v.slides.map((s) => c.arte.renders.find((r) => r.slide_id === s.id && r.versao === v.id)).filter(Boolean);
    if (imgs.length < v.slides.length) return '<div class="cn-sem-arte">A arte ainda não foi gerada. Toque em Revisar.</div>';
    return `<div class="cn-carrossel" role="group" aria-label="Slides do conteúdo">${imgs.map((r, i) => `<img data-render="${esc(r.blob_key)}" alt="Slide ${i + 1} de ${imgs.length}" loading="lazy">`).join('')}</div><div class="es-text" style="text-align:center">${v.slides.length} slide(s) · deslize para ver</div>`;
  }

  function cartao(c, x) {
    const { esc } = x;
    const v = M.versaoAtiva(c);
    const a = abaDe(c);
    const p = pubDe(c.id);
    const g = G.avaliar(c, { conta: M.ACCOUNT_PIN, recentes: x.recentesParaPrompt() });
    const ocupado = !!st.ocupado[c.id];
    const f = c.fonte_principal;
    const terceiros = f && f.tipo !== 'texto' && !GOV.test(f.dominio || '');
    const pausado = !!st.config?.publish_paused;
    const semServidor = !x.state.servidor?.configurado;
    const motivo = motivoDesabilitado(c, g);
    let corpo = '';
    if (a === 'aprovar') {
      corpo = `
        ${preview(c, esc)}
        <details class="mz-det" data-aberto="cl:${esc(c.id)}"><summary>Legenda (toque para editar)</summary>
          <textarea class="es-input" rows="6" data-cn-legenda="${esc(c.id)}">${esc(v.legenda)}</textarea>
          <div class="es-text">${esc(v.cta || '')} ${esc((v.hashtags || []).join(' '))}</div>
          <div class="es-text">Editar a legenda cria uma versão nova e pede aprovação de novo.</div>
        </details>
        ${terceiros ? '<div class="es-warn">Conteúdo de terceiros: confira o direito de uso. O crédito da fonte já vai na legenda.</div>' : ''}
        ${g.bloqueios.length ? `<div class="ed-bloq"><b>${g.bloqueios.length} pendência(s) de revisão</b><br>${esc(g.bloqueios[0].titulo)}${g.bloqueios.length > 1 ? ` e mais ${g.bloqueios.length - 1}` : ''}</div>` : ''}
        ${semServidor && !pausado ? '<div class="es-warn">Para publicar é preciso a cópia no servidor (banco de dados). Aprovar funciona; publicar não.</div>' : ''}
        <div class="cn-botoes">
          <button class="cn-btn cn-ok" data-action="cn-aprovar" data-id="${esc(c.id)}" ${motivo || ocupado ? 'disabled' : ''}>${ocupado ? '<span class="es-spin"></span> Enviando…' : pausado ? 'Aprovar (publicações pausadas)' : 'Aprovar e publicar'}</button>
          <button class="cn-btn cn-fora" data-action="cn-descartar" data-id="${esc(c.id)}" ${ocupado ? 'disabled' : ''}>Descartar</button>
        </div>
        ${motivo ? `<button class="cn-btn cn-link" data-action="cn-revisar" data-id="${esc(c.id)}">Revisar (${esc(motivo)})</button>` : '<button class="cn-btn cn-link" data-action="cn-revisar" data-id="' + esc(c.id) + '">Abrir no editor</button>'}`;
    } else if (a === 'publicando') {
      const emAndamento = p && INTERMEDIARIOS.includes(p.estado);
      corpo = `
        ${preview(c, esc)}
        <div class="es-text">${emAndamento ? `<span class="es-spin"></span> <b>Publicando…</b> ${esc({ iniciada: 'enviando as imagens à Meta', aguardando_processamento: 'a Meta está processando', publicando_final: 'confirmando a publicação' }[p.estado] || '')}` : `<b>Aprovado</b> em ${esc(dia(c.revisao.aprovada_em))}, ainda não enviado ao Instagram${pausado ? ' (publicações pausadas)' : ''}.`}</div>
        ${p?.aviso_temporario ? `<div class="es-warn">${esc(p.aviso_temporario)}</div>` : ''}
        ${(p?.avisos || []).map((t) => `<div class="es-warn">${esc(t)}</div>`).join('')}
        ${emAndamento ? '' : `<div class="cn-botoes"><button class="cn-btn cn-ok" data-action="cn-publicar" data-id="${esc(c.id)}" ${pausado || ocupado ? 'disabled' : ''}>${pausado ? 'Pausado' : 'Publicar agora'}</button></div>`}`;
    } else if (a === 'publicados') {
      const link = p?.permalink || c.publicacao?.url;
      corpo = `${preview(c, esc)}<div class="es-text"><b>Publicado</b> ${esc(dia(p?.publicada_em || c.publicacao?.publicado_em))}. ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver no Instagram</a>` : 'Link ainda não disponível.'}</div><div class="es-text">Versão publicada: ${esc(p?.versao || c.publicacao?.versao_publicada || '—')}</div>`;
    } else if (a === 'erro') {
      const e = p?.erro || {};
      corpo = `${preview(c, esc)}<div class="es-errbox"><b>Não publicou.</b> ${esc(e.amigavel || 'Erro desconhecido.')}</div>
        <details class="mz-det"><summary>Mensagem original da Meta</summary><pre class="mz-pre">${esc(JSON.stringify({ code: e.code, subcode: e.subcode, tipo: e.tipo, mensagem: e.mensagem_original, fbtrace_id: e.fbtrace_id }, null, 1))}</pre></details>
        <div class="cn-botoes"><button class="cn-btn cn-ok" data-action="cn-publicar" data-id="${esc(c.id)}" ${ocupado ? 'disabled' : ''}>Tentar de novo</button><button class="cn-btn cn-link" data-action="cn-revisar" data-id="${esc(c.id)}">Revisar</button></div>`;
    } else if (a === 'descartados') {
      corpo = `<div class="cn-botoes"><button class="cn-btn cn-link" data-action="cn-restaurar" data-id="${esc(c.id)}">Restaurar</button></div>`;
    }
    return `<article class="es-card cn-card" data-cn="${esc(c.id)}">
      <div class="es-row" style="flex-wrap:wrap;gap:6px"><span class="mz-chip neutro">${esc(c.formato === 'estatico' ? 'Imagem' : 'Carrossel')}</span>${c.origem?.pauta?.pilar ? `<span class="es-chip pillar">${esc(c.origem.pauta.pilar)}</span>` : ''}<span class="mz-chip ${g.bloqueios.length ? 'warn' : 'ok'}">${g.bloqueios.length ? 'Com pendências' : 'Revisão em ordem'}</span></div>
      <div class="es-title">${esc(c.titulo)}</div>
      ${corpo}
    </article>`;
  }

  function render(x) {
    const { esc } = x;
    if (!st.carregou && !st.carregando) setTimeout(() => carregar(x), 0);
    const lista = x.state.contents.filter((c) => abaDe(c));
    const contagem = Object.fromEntries(ABAS.map(([k]) => [k, lista.filter((c) => abaDe(c) === k).length]));
    const nessa = lista.filter((c) => abaDe(c) === st.aba);
    const reconectar = st.saude?.reconectar || Object.values(st.pubs).some((p) => p.reconectar);
    const hoje = x.state.contents.filter((c) => (c.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    const l = st.saude?.local;
    return `
      <div class="es-h1">Central de aprovação</div>
      ${reconectar ? '<div class="cn-banner" role="alert"><b>Reconecte o Instagram.</b> O acesso expirou ou foi revogado. Siga o passo a passo em docs/META_SETUP.md e atualize META_PAGE_ACCESS_TOKEN na Vercel.</div>' : ''}
      ${st.erroServidor ? `<div class="es-warn">Não consegui falar com o servidor: ${esc(st.erroServidor)}</div>` : ''}
      <div class="cn-topo">
        <label class="cn-pausa"><input type="checkbox" data-cn-pausa ${st.config?.publish_paused ? 'checked' : ''} ${st.config ? '' : 'disabled'}><span><b>Pausar publicações</b><br><small>${st.config?.publish_paused ? 'Ligado: aprovar não envia ao Instagram.' : 'Desligado: aprovar publica.'}</small></span></label>
        <div class="es-text">Criados hoje: <b>${hoje}</b>${l?.cap_diario != null ? ` · Publicados nas últimas 24 h: <b>${l.publicadas_24h ?? 0}/${l.cap_diario}</b>${(l.publicadas_24h ?? 0) >= l.cap_diario ? ' — <b>limite diário atingido</b>' : ''}` : ''}</div>
      </div>
      <div class="cn-abas" role="tablist">${ABAS.map(([k, r]) => `<button role="tab" aria-selected="${st.aba === k}" data-action="cn-aba" data-aba="${k}">${r}${contagem[k] ? ` (${contagem[k]})` : ''}</button>`).join('')}</div>
      <div class="es-stack">${nessa.map((c) => cartao(c, x)).join('') || `<div class="es-empty-day">${st.aba === 'aprovar' ? 'Nada esperando aprovação. Crie conteúdo na Mesa.' : 'Nada por aqui.'}</div>`}</div>`;
  }

  // ── Ajustes → Conexões ──────────────────────────────────────────────────────
  function secaoConexoes() {
    const { esc } = ctx();
    const s = st.saude;
    const linha = (ok, texto) => `<div class="es-text">${ok === true ? '✓' : ok === false ? '✗' : '•'} ${texto}</div>`;
    let corpo;
    if (!s) corpo = '<div class="es-text">Ainda não verifiquei.</div>';
    else if (s.erro && !s.configurado) corpo = `<div class="es-warn">${esc(s.erro)}</div>`;
    else {
      corpo = [
        s.configurado ? linha(true, 'Variáveis da Meta configuradas no servidor') : linha(false, `Falta configurar no servidor: <b>${esc((s.faltando || []).join(', '))}</b>`),
        s.conta ? (s.conta.ok ? linha(true, `Instagram conectado: <b>@${esc(s.conta.username)}</b> (id conferido com o da conta fixa)`) : linha(false, esc(s.conta.erro || 'Conta não conferida'))) : '',
        s.token ? (s.token.valido === true ? linha(true, `Token válido${s.token.expira_em ? ` · expira em ${esc(String(s.token.expira_em).slice(0, 10))}` : ''}${(s.token.escopos || []).length ? ` · permissões: ${esc(s.token.escopos.join(', '))}` : ''}`) : s.token.valido === false ? linha(false, 'Token inválido ou expirado — reconecte') : linha(null, esc(s.token.aviso || s.token.erro || 'Validade não verificada'))) : '',
        s.cota ? (s.cota.erro ? linha(null, `Cota: ${esc(s.cota.erro)}`) : linha(null, `Cota da Meta hoje: <b>${s.cota.usado ?? '?'}</b> de <b>${s.cota.total ?? '?'}</b> publicações em 24 h (lida ao vivo)`)) : '',
        s.local?.aviso ? linha(false, esc(s.local.aviso)) : (s.local ? linha(null, `Neste app: ${s.local.publicadas_24h} publicada(s) em 24 h (limite diário ${s.local.cap_diario}) · ${s.local.em_andamento} em andamento`) : ''),
        linha(null, `Versão da Graph API: ${esc(s.graph_version || '—')}`),
      ].join('');
    }
    const cfg = st.config || {};
    return `<div class="es-card" style="margin-top:12px"><div class="es-title" style="margin-top:0">Conexões</div>
      <div class="es-label">Instagram</div>${corpo}
      <button class="es-btn ghost sm" style="margin-top:8px" data-action="cn-saude">Verificar agora</button>
      <div class="es-label">Limites e regras de publicação</div>
      <label class="es-label" for="cn-cap">Máximo de publicações por dia</label>
      <input id="cn-cap" class="es-input" type="number" min="1" max="50" value="${esc(cfg.daily_publish_cap ?? 10)}" data-cn-cap ${st.config ? '' : 'disabled'}>
      <label class="cn-pausa"><input type="checkbox" data-cn-enc ${cfg.permitir_encerramento_provisorio ? 'checked' : ''} ${st.config ? '' : 'disabled'}><span>Permitir publicar com o encerramento provisório de texto<br><small>Desligado: só publica com o arquivo de encerramento aprovado.</small></span></label>
      <div class="es-text">Publicar é irreversível pela API: só acontece depois da sua aprovação. Passo a passo: docs/META_SETUP.md.</div></div>`;
  }

  // ── Ações ───────────────────────────────────────────────────────────────────
  async function acao(a, el, x) {
    if (!a.startsWith('cn-')) return false;
    const id = el.dataset.id;
    const c = id ? x.state.contents.find((k) => k.id === id) : null;
    switch (a) {
      case 'cn-aba': st.aba = el.dataset.aba; x.render(); return true;
      case 'cn-aprovar': await aprovarEPublicar(x, id); return true;
      case 'cn-publicar': {
        if (st.ocupado[id]) return true;
        st.ocupado[id] = true; x.render();
        try {
          const g = G.avaliar(c, { conta: M.ACCOUNT_PIN });
          if (g.bloqueios.length) throw new Error(`Há ${g.bloqueios.length} pendência(s) de revisão.`);
          if (c.revisao.aprovada_versao !== M.versaoAtiva(c).id) M.aprovar(c, g);
          await publicar(x, c); x.toast('Enviado. Só vira "Publicado" quando o Instagram confirmar.');
        } catch (e) { x.toast(e.message); } finally { delete st.ocupado[id]; x.render(); }
        return true;
      }
      case 'cn-revisar': await x.abrirConteudo(id); return true;
      case 'cn-descartar': c.status = 'arquivado'; M.registrar(c, 'pedro', 'arquivado', 'Descartou na Central'); await S.snapshot(c, 'descartado'); await x.persistir(c); x.render(); x.toast('Descartado. Dá para restaurar na aba Descartados.'); return true;
      case 'cn-restaurar': c.status = 'rascunho'; M.registrar(c, 'pedro', 'restaurado', 'Restaurou da aba Descartados'); await x.persistir(c); x.render(); return true;
      case 'cn-saude': await carregarSaude(x); return true;
      default: return false;
    }
  }

  async function aoMudar(el, x) {
    const d = el.dataset;
    try {
      if ('cnPausa' in d) { const r = await x.api('/api/publish/config', { method: 'PUT', body: { publish_paused: el.checked } }); st.config = r.config; x.toast(el.checked ? 'Publicações pausadas.' : 'Publicações liberadas.'); x.render(); return; }
      if ('cnCap' in d) { const r = await x.api('/api/publish/config', { method: 'PUT', body: { daily_publish_cap: Number(el.value) } }); st.config = r.config; x.toast(`Limite diário: ${r.config.daily_publish_cap}.`); x.render(); return; }
      if ('cnEnc' in d) { const r = await x.api('/api/publish/config', { method: 'PUT', body: { permitir_encerramento_provisorio: el.checked } }); st.config = r.config; x.render(); return; }
      if (d.cnLegenda) {
        const c = x.state.contents.find((k) => k.id === d.cnLegenda);
        const r = M.editarLegenda(c, { legenda: el.value.trim() });
        reabrirAprovacao(c);
        await x.persistir(c); x.render();
        x.toast(`Legenda salva como versão ${r.versao.id}. Aprove de novo para publicar.`);
      }
    } catch (e) { x.toast(e.message); x.render(); }
  }

  window.MesaCentral = { render, acao, aoMudar, carregar, badge, secaoConexoes, _st: st, _abaDe: abaDe };
})();
