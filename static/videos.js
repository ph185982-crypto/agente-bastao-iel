// Aba "Vídeos": o Pedro grava com o teleprompter (ou manda um vídeo da galeria), o worker edita
// (cortes, legendas, enquadramento) e o resultado volta aqui para aprovar, agendar ou refazer.
// Nada vai ao Instagram sem o toque em "Aprovar e publicar": a decisão passa por /api/studio/:id/decidir.
// Contrato: docs/VIDEOS_E_RECICLAGEM_SPEC.md (modelo de dados, rotas e integração).
(function () {
  'use strict';
  const CDN_BLOB = 'https://cdn.jsdelivr.net/npm/@vercel/blob@2.8.2/+esm';
  const ST = {
    lista: [], carregando: false, carregou: false, erro: null, semArmazenamento: null,
    ocupado: {},          // id → 'publicar' | 'agendar' | 'descartar' | 'refazer' | 'apagar'
    refazer: null,        // id do cartão com o painel "Refazer" aberto
    refazerOpts: {},      // id → { estilo, opcoes }
    envios: {},           // chave → { nome, pct, etapa, erro, id }
    timer: null, ctx: null,
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Sao_Paulo';
  const dh = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const dur = (s) => { if (s == null || Number.isNaN(Number(s))) return ''; const n = Math.round(Number(s)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const mb = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : '');

  const ROTULO = { enviado: 'Enviando…', na_fila: 'Na fila', editando: 'Editando…', pronto: 'Pronto para aprovar', erro: 'Erro', roteiro: 'Roteiro pronto' };
  const COR = { enviado: 'azul', na_fila: 'azul', editando: 'laranja', pronto: 'ok', erro: 'erro', roteiro: 'suave' };
  const ESTILOS = [['hormozi', 'Hormozi', 'Caixa-alta, palavra ativa em amarelo'], ['beast', 'Beast', 'Amarelo com contorno preto grosso'], ['caixa', 'Caixa', 'Branco sobre caixa preta']];
  const OPCOES = [['remover_pausas', 'Cortar pausas'], ['remover_muletas', 'Tirar muletas (é, né, hã)'], ['punch_in', 'Punch-in (zoom alternado)'], ['broll', 'B-roll (imagens de apoio)']];
  const OPCOES_PADRAO = { broll: true, musica: false, punch_in: true, remover_pausas: true, remover_muletas: true };
  const PENDENTES = new Set(['enviado', 'na_fila', 'editando']);
  const ctxAtual = () => ST.ctx || (window.Mesa && window.Mesa.ctx());

  // O resumo da lista e o documento completo têm formas diferentes; aqui vira uma forma só.
  function norm(c) {
    const v = c.video || {};
    const legenda = typeof c.legenda === 'string' ? c.legenda : (c.legenda && c.legenda.texto) || (v.legenda_ig && v.legenda_ig.texto) || '';
    return {
      id: c.id, titulo: c.titulo || 'Vídeo sem título', estado: c.estado || v.estado || 'na_fila', criado_em: c.criado_em || c.created_at || null,
      poster: c.poster || (v.resultado && v.resultado.poster_url) || (c.motion && c.motion.poster) || null,
      url: c.url || (v.resultado && v.resultado.url) || (c.motion && c.motion.url) || null,
      duracao: c.duracao ?? (v.resultado && v.resultado.duracao_s) ?? (v.origem && v.origem.duracao_s) ?? null,
      tamanho: (v.resultado && v.resultado.tamanho) || null,
      legenda, hashtags: c.hashtags || (c.legenda && c.legenda.hashtags) || (v.legenda_ig && v.legenda_ig.hashtags) || [],
      hash: c.hash || (c.motion && c.motion.hash) || null,
      estilo: c.estilo || v.estilo || 'hormozi', opcoes: { ...OPCOES_PADRAO, ...(c.opcoes || v.opcoes || {}) },
      erro: c.erro || (v.worker && v.worker.erro) || null, cortes: v.resultado && v.resultado.cortes, palavras: v.resultado && v.resultado.palavras,
      status: c.status || null, studio: c.studio || null, agenda: c.agenda || null, publicacao: c.publicacao || null, roteiro_texto: v.roteiro_texto || c.roteiro_texto || '',
    };
  }
  const agendado = (c) => !!(c.agenda && c.agenda.publicar_em) && c.status === 'aprovado';
  const publicado = (c) => c.status === 'publicado';
  const publicando = (c) => c.studio && c.studio.estado === 'publicando';
  const paraAprovar = (c) => c.estado === 'pronto' && !agendado(c) && !publicado(c) && !publicando(c) && c.status !== 'arquivado';

  // ── Dados ───────────────────────────────────────────────────────────────────
  async function carregar(ctx, forcar) {
    if (ctx) ST.ctx = ctx; ctx = ctxAtual();
    if (ST.carregando || (ST.carregou && !forcar)) return;
    ST.carregando = true;
    try {
      const r = await ctx.api('/api/videos');
      const lista = Array.isArray(r) ? r : (r.videos || r.lista || r.itens || []);
      ST.lista = lista.map(norm).filter((c) => c.status !== 'arquivado').sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
      ST.erro = null; ST.semArmazenamento = null;
    } catch (e) {
      if (e.status === 503) ST.semArmazenamento = e.message || 'O armazenamento de vídeos não está ligado.';
      else ST.erro = e.message || 'Não consegui abrir os vídeos.';
    }
    ST.carregando = false; ST.carregou = true;
    redesenhar(); agendarAtualizacao();
  }
  // Enquanto houver vídeo na fila ou em edição, a lista se atualiza sozinha a cada 10 s (só com a aba aberta).
  function agendarAtualizacao() {
    clearTimeout(ST.timer); ST.timer = null;
    const pendente = ST.lista.some((c) => PENDENTES.has(c.estado)) || Object.values(ST.envios).some((e) => e.etapa !== 'erro' && e.etapa !== 'concluido');
    if (!pendente) return;
    ST.timer = setTimeout(() => { const ctx = ctxAtual(); if (!ctx) return; if (document.hidden || !abaAberta(ctx)) return agendarAtualizacao(); carregar(ctx, true); }, 10000);
  }
  const abaAberta = (ctx) => !ctx.state || !('tab' in ctx.state) || ctx.state.tab === 'videos';
  function redesenhar() { const ctx = ctxAtual(); if (ctx && abaAberta(ctx) && !document.querySelector('.tp')) ctx.render(); }

  // ── Envio (galeria ou teleprompter) ─────────────────────────────────────────
  // POST /api/videos → upload direto ao Blob (token curto emitido por /api/videos/blob) → POST /api/videos/:id/enviado.
  async function carregarUpload() {
    if (window.__vercelBlobUpload) return window.__vercelBlobUpload;
    try { const m = await import(/* webpackIgnore: true */ CDN_BLOB); if (typeof m.upload !== 'function') throw new Error('sem upload()'); return m.upload; }
    catch (e) { throw new Error('Não consegui carregar o componente de envio. Verifique a conexão e tente de novo.'); }
  }
  const extensao = (blob, nome) => { const m = /\.(mp4|mov|webm|m4v)$/i.exec(nome || ''); if (m) return m[1].toLowerCase(); const t = String(blob.type || ''); return /mp4|m4v/.test(t) ? 'mp4' : /quicktime/.test(t) ? 'mov' : /webm/.test(t) ? 'webm' : 'mp4'; };
  async function enviarArquivo(blob, meta = {}, ctx) {
    if (ctx) ST.ctx = ctx; ctx = ctxAtual();
    if (!blob || !blob.size) throw new Error('O arquivo de vídeo está vazio.');
    if (blob.size > 600 * 1048576) throw new Error(`O vídeo tem ${mb(blob.size)}; o limite é 600 MB.`);
    const chave = `env_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const env = { nome: meta.nome || 'gravação', pct: 0, etapa: 'criando', erro: null, id: null, tamanho: blob.size };
    ST.envios[chave] = env; redesenhar();
    const progresso = typeof meta.onProgress === 'function' ? meta.onProgress : () => {};
    try {
      progresso({ etapa: 'criando', pct: 0 });
      const criado = await ctx.api('/api/videos', { method: 'POST', body: { titulo: meta.titulo || undefined, estilo: meta.estilo || undefined, opcoes: meta.opcoes || undefined, roteiro_id: meta.roteiro_id || undefined, roteiro_texto: meta.roteiro_texto || undefined } });
      const id = criado.id || (criado.doc && criado.doc.id); if (!id) throw new Error('O servidor não devolveu o id do vídeo.');
      env.id = id; env.etapa = 'enviando'; redesenhar(); progresso({ etapa: 'enviando', pct: 0, id });
      const upload = await carregarUpload();
      const tipo = blob.type || (extensao(blob, meta.nome) === 'webm' ? 'video/webm' : 'video/mp4');
      const r = await upload(`videos/${id}/origem.${extensao(blob, meta.nome)}`, blob, {
        access: 'public', handleUploadUrl: '/api/videos/blob', multipart: true, contentType: tipo,
        clientPayload: JSON.stringify({ id, papel: 'origem' }),
        onUploadProgress: (p) => { const pct = Math.max(0, Math.min(100, Math.round(p.percentage ?? (p.total ? p.loaded / p.total * 100 : 0)))); if (pct !== env.pct) { env.pct = pct; progresso({ etapa: 'enviando', pct, id }); atualizarBarra(chave); } },
      });
      env.pct = 100; env.etapa = 'registrando'; progresso({ etapa: 'registrando', pct: 100, id }); atualizarBarra(chave);
      await ctx.api(`/api/videos/${encodeURIComponent(id)}/enviado`, { method: 'POST', body: { url: r.url, pathname: r.pathname, tamanho: blob.size, contentType: r.contentType || tipo } });
      env.etapa = 'concluido'; progresso({ etapa: 'concluido', pct: 100, id });
      delete ST.envios[chave];
      ctx.toast('Vídeo enviado. Entrou na fila de edição; aviso quando ficar pronto.');
      await carregar(ctx, true);
      return { id };
    } catch (e) {
      env.etapa = 'erro'; env.erro = e.status === 503 ? (e.message || 'O armazenamento de vídeos não está ligado.') : (e.message || 'O envio falhou.');
      if (e.status === 503) ST.semArmazenamento = env.erro;
      progresso({ etapa: 'erro', erro: env.erro, id: env.id });
      redesenhar();
      throw new Error(env.erro);
    }
  }
  // A barra de progresso muda sem redesenhar a tela inteira (o Pedro pode estar lendo outro cartão).
  function atualizarBarra(chave) {
    const el = document.querySelector(`[data-vd-envio="${CSS.escape(chave)}"]`); if (!el) return redesenhar();
    const env = ST.envios[chave]; if (!env) return;
    const i = el.querySelector('.vd-barra i'); if (i) i.style.width = `${Math.max(3, env.pct)}%`;
    const t = el.querySelector('[data-vd-pct]'); if (t) t.textContent = textoEnvio(env);
  }
  const textoEnvio = (e) => e.etapa === 'criando' ? 'Preparando o envio…' : e.etapa === 'enviando' ? `Enviando ${e.pct}% · ${mb(e.tamanho)}` : e.etapa === 'registrando' ? 'Registrando na fila…' : e.etapa === 'erro' ? e.erro : 'Concluído';

  // ── Telas ───────────────────────────────────────────────────────────────────
  function cartaoEnvio(chave, e) {
    return `<article class="vd-card vd-envio ${e.etapa === 'erro' ? 'erro' : ''}" data-vd-envio="${esc(chave)}" aria-live="polite">
      <div class="vd-tags"><span class="vd-tag ${e.etapa === 'erro' ? 'erro' : 'azul'}">${e.etapa === 'erro' ? 'Envio falhou' : 'Enviando…'}</span></div>
      <h3>${esc(e.nome)}</h3>
      ${e.etapa !== 'erro' ? `<div class="vd-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e.pct}"><i style="width:${Math.max(3, e.pct)}%"></i></div>` : ''}
      <p class="vd-meta" data-vd-pct>${esc(textoEnvio(e))}</p>
      ${e.etapa === 'erro' ? `<div class="vd-acoes"><button class="vd-btn fantasma" data-action="vd-envio-fechar" data-chave="${esc(chave)}">Fechar</button></div>` : '<p class="vd-meta">Mantenha o app aberto até terminar o envio.</p>'}
    </article>`;
  }
  function painelRefazer(c) {
    const o = ST.refazerOpts[c.id] || (ST.refazerOpts[c.id] = { estilo: c.estilo, opcoes: { ...c.opcoes } });
    return `<div class="vd-refazer" role="group" aria-label="Refazer a edição">
      <b>Estilo das legendas</b>
      <div class="vd-estilos">${ESTILOS.map(([k, r, d]) => `<button type="button" class="vd-estilo ${k}" data-action="vd-refazer-estilo" data-id="${esc(c.id)}" data-estilo="${k}" aria-pressed="${o.estilo === k}"><i aria-hidden="true">Aa</i><span>${r}</span><small>${d}</small></button>`).join('')}</div>
      <b>O que o editor faz</b>
      <div class="vd-opcoes">${OPCOES.map(([k, r]) => `<label class="vd-check"><input type="checkbox" data-vd-opt="${k}" data-id="${esc(c.id)}" ${o.opcoes[k] ? 'checked' : ''}><span>${r}</span></label>`).join('')}</div>
      <div class="vd-acoes"><button class="vd-btn" data-action="vd-refazer-confirmar" data-id="${esc(c.id)}" ${ST.ocupado[c.id] ? 'disabled' : ''}>${ST.ocupado[c.id] === 'refazer' ? 'Enviando…' : 'Refazer com estas opções'}</button><button class="vd-btn fantasma" data-action="vd-refazer-cancelar" data-id="${esc(c.id)}">Cancelar</button></div>
      <p class="vd-meta">O vídeo volta para a fila; a versão atual deixa de valer até a nova ficar pronta.</p>
    </div>`;
  }
  function midia(c) {
    if (c.estado === 'pronto' && c.url) return `<div class="vd-player"><video controls playsinline preload="metadata" ${c.poster ? `poster="${esc(c.poster)}"` : ''} src="${esc(c.url)}" aria-label="Prévia do vídeo ${esc(c.titulo)}"></video>${c.duracao != null ? `<span class="vd-dur">${esc(dur(c.duracao))}</span>` : ''}</div>`;
    if (c.poster) return `<div class="vd-player"><img src="${esc(c.poster)}" alt="Quadro do vídeo ${esc(c.titulo)}" loading="lazy">${c.duracao != null ? `<span class="vd-dur">${esc(dur(c.duracao))}</span>` : ''}</div>`;
    const texto = c.estado === 'erro' ? 'A edição falhou' : c.estado === 'editando' ? 'Cortando, legendando e enquadrando…' : c.estado === 'enviado' ? 'Recebendo o arquivo…' : c.estado === 'roteiro' ? 'Roteiro pronto para gravar' : 'Aguardando o editor pegar o vídeo';
    return `<div class="vd-player vazio ${esc(c.estado)}">${PENDENTES.has(c.estado) ? '<span class="es-spin" aria-hidden="true"></span>' : c.estado === 'erro' ? '<span class="vd-x" aria-hidden="true">!</span>' : '<span class="vd-x" aria-hidden="true">▶</span>'}<p>${esc(texto)}</p>${c.estado === 'editando' ? '<small>Normalmente leva de 2 a 6 minutos. Pode fechar o app.</small>' : c.estado === 'na_fila' ? '<small>O editor roda a cada 5 minutos no servidor.</small>' : ''}</div>`;
  }
  function cartao(c) {
    const oc = ST.ocupado[c.id]; const d = oc ? 'disabled' : '';
    const situacao = publicado(c) ? ['ok', 'Publicado'] : agendado(c) ? ['azul', `Agendado · ${dh(c.agenda.publicar_em)}`] : publicando(c) ? ['laranja', 'Publicando…'] : [COR[c.estado] || 'suave', ROTULO[c.estado] || c.estado];
    const legenda = [c.legenda, (c.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
    const nomeArquivo = `${String(c.titulo || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'video'}.mp4`;
    return `<article class="vd-card estado-${esc(c.estado)}" data-vd-card="${esc(c.id)}" aria-busy="${!!oc}">
      <div class="vd-tags"><span class="vd-tag ${situacao[0]}">${esc(situacao[1])}</span><span class="vd-tag suave">${esc(ESTILOS.find((e) => e[0] === c.estilo)?.[1] || c.estilo)}</span>${c.cortes != null ? `<span class="vd-tag suave">${esc(c.cortes)} cortes</span>` : ''}</div>
      <h3>${esc(c.titulo)}</h3>
      ${midia(c)}
      ${c.estado === 'erro' ? `<div class="vd-aviso erro" role="status"><b>Não consegui editar este vídeo.</b> ${esc(c.erro || 'Erro sem detalhe.')} Você pode refazer com outro estilo ou enviar outro arquivo.</div>` : ''}
      ${c.estado === 'pronto' && legenda ? `<details class="vd-legenda" open><summary>Legenda do Instagram</summary><p>${esc(legenda)}</p><button class="vd-btn peq fantasma" data-action="vd-copiar" data-id="${esc(c.id)}" aria-label="Copiar legenda de ${esc(c.titulo)}">Copiar legenda</button></details>` : ''}
      ${c.estado === 'pronto' && !legenda ? '<p class="vd-meta">Sem legenda gerada: escreva a sua no Instagram ao publicar.</p>' : ''}
      ${c.roteiro_texto && c.estado !== 'pronto' ? `<details class="vd-legenda"><summary>Roteiro</summary><p>${esc(c.roteiro_texto)}</p></details>` : ''}
      ${paraAprovar(c) ? `<div class="vd-decisao">
          <button class="vd-btn" data-action="vd-publicar" data-id="${esc(c.id)}" ${d}>${oc === 'publicar' ? '<span class="es-spin"></span> Enviando…' : '✓ Aprovar e publicar agora'}</button>
          <button class="vd-btn contorno" data-action="vd-agendar" data-id="${esc(c.id)}" ${d} aria-label="Agendar ${esc(c.titulo)} no próximo horário livre">${oc === 'agendar' ? '<span class="es-spin"></span>' : '🕒 Agendar'}</button>
          <button class="vd-btn fantasma" data-action="vd-descartar" data-id="${esc(c.id)}" ${d} aria-label="Descartar ${esc(c.titulo)}">${oc === 'descartar' ? '<span class="es-spin"></span>' : '✕ Descartar'}</button>
        </div><p class="vd-meta">Agendar: entra no próximo horário livre da grade do piloto. Nada sai antes.</p>` : ''}
      <div class="vd-acoes">
        ${c.estado === 'pronto' && c.url ? `<a class="vd-btn fantasma" href="${esc(c.url)}" download="${esc(nomeArquivo)}" target="_blank" rel="noopener noreferrer" aria-label="Baixar o arquivo de ${esc(c.titulo)}">↓ Baixar${c.tamanho ? ` (${esc(mb(c.tamanho))})` : ''}</a>` : ''}
        ${['pronto', 'erro'].includes(c.estado) && !publicado(c) && !publicando(c) ? `<button class="vd-btn fantasma" data-action="vd-refazer" data-id="${esc(c.id)}" aria-expanded="${ST.refazer === c.id}" ${d}>↻ Refazer</button>` : ''}
        ${c.estado === 'roteiro' ? `<button class="vd-btn" data-action="vd-gravar" data-id="${esc(c.id)}">● Gravar com este roteiro</button>` : ''}
        ${c.publicacao && c.publicacao.url ? `<a class="vd-btn fantasma" href="${esc(c.publicacao.url)}" target="_blank" rel="noopener noreferrer">Ver no Instagram ↗</a>` : ''}
        ${!publicando(c) && !publicado(c) ? `<button class="vd-link" data-action="vd-apagar" data-id="${esc(c.id)}" ${d}>${oc === 'apagar' ? 'Apagando…' : 'Apagar vídeo'}</button>` : ''}
      </div>
      ${ST.refazer === c.id ? painelRefazer(c) : ''}
      <p class="vd-meta">${c.criado_em ? `Enviado em ${esc(dh(c.criado_em))}` : ''}${c.palavras ? ` · ${esc(c.palavras)} palavras transcritas` : ''}</p>
    </article>`;
  }
  function secao(titulo, lista, vazio) {
    if (!lista.length) return vazio ? `<div class="vd-vazio">${vazio}</div>` : '';
    return `<section class="vd-secao"><div class="vd-h2"><h2>${titulo}</h2><span>${lista.length}</span></div><div class="vd-grade">${lista.map(cartao).join('')}</div></section>`;
  }
  function render(ctx) {
    if (ctx) ST.ctx = ctx;
    if (!ST.carregou && !ST.carregando) setTimeout(() => carregar(ctx), 0);
    const envios = Object.entries(ST.envios);
    const prontos = ST.lista.filter(paraAprovar);
    const emEdicao = ST.lista.filter((c) => PENDENTES.has(c.estado));
    const comErro = ST.lista.filter((c) => c.estado === 'erro');
    const roteiros = ST.lista.filter((c) => c.estado === 'roteiro');
    const feitos = ST.lista.filter((c) => agendado(c) || publicado(c) || publicando(c));
    const nada = !ST.lista.length && !envios.length && ST.carregou && !ST.erro && !ST.semArmazenamento;
    return `<div class="vd" id="vd-topo">
      <span class="st-eyebrow">Vídeos</span><h1>Grave. O editor corta. <span class="br">Você aprova</span>.</h1>
      <p class="vd-sub">Grave lendo o roteiro na tela ou mande um vídeo da galeria. O servidor tira pausas e muletas, enquadra em 9:16, legenda palavra por palavra e escreve a legenda do post. Nada vai ao Instagram sem a sua aprovação.</p>
      <div class="vd-entradas">
        <button class="vd-entrada principal" data-action="vd-gravar" aria-label="Gravar um vídeo lendo o roteiro na tela"><i aria-hidden="true">●</i><b>Gravar com roteiro</b><small>Câmera frontal, roteiro rolando na tela, contagem 3-2-1.</small></button>
        <button class="vd-entrada" data-action="vd-galeria" aria-label="Enviar um vídeo que já está na galeria do celular"><i aria-hidden="true">↑</i><b>Enviar vídeo da galeria</b><small>MP4 ou MOV, até 600 MB. O envio vai direto para o armazenamento.</small></button>
        <input type="file" id="vd-arquivo" accept="video/mp4,video/quicktime,video/webm,video/*" hidden aria-hidden="true" tabindex="-1">
      </div>
      ${ST.semArmazenamento ? `<div class="vd-aviso erro" role="alert"><b>Armazenamento de vídeos não ligado.</b> ${esc(ST.semArmazenamento)} Para gravar e editar vídeos, o servidor precisa do Vercel Blob (variável <code>BLOB_READ_WRITE_TOKEN</code>). Depois de ligar, toque em “Tentar de novo”. <button class="vd-btn peq fantasma" data-action="vd-recarregar">Tentar de novo</button></div>` : ''}
      ${ST.erro ? `<div class="vd-aviso erro" role="alert">${esc(ST.erro)} <button class="vd-btn peq fantasma" data-action="vd-recarregar">Tentar de novo</button></div>` : ''}
      ${ST.carregando && !ST.carregou ? '<div class="vd-vazio"><span class="es-spin" aria-hidden="true"></span> Abrindo os vídeos…</div>' : ''}
      ${envios.length ? `<section class="vd-secao"><div class="vd-h2"><h2>Enviando</h2><span>${envios.length}</span></div><div class="vd-grade">${envios.map(([k, e]) => cartaoEnvio(k, e)).join('')}</div></section>` : ''}
      ${secao('Para aprovar', prontos)}
      ${secao('Em edição', emEdicao)}
      ${secao('Com erro', comErro)}
      ${secao('Roteiros para gravar', roteiros)}
      ${nada ? '<div class="vd-vazio"><b>Nenhum vídeo ainda.</b><p>Toque em “Gravar com roteiro” para o primeiro. O editor cuida dos cortes e das legendas; você só aprova.</p></div>' : ''}
      ${feitos.length ? `<details class="vd-feitos"><summary>Agendados e publicados (${feitos.length})</summary><div class="vd-grade">${feitos.map(cartao).join('')}</div></details>` : ''}
      ${emEdicao.length ? '<p class="vd-meta centro">A lista se atualiza sozinha enquanto houver vídeo em edição.</p>' : ''}
    </div>`;
  }

  // ── Ações ───────────────────────────────────────────────────────────────────
  // Aprovar/agendar/descartar exigem o hash da versão: o resumo da lista pode não trazer, então busca o documento.
  async function hashDe(ctx, c) {
    if (c.hash) return c.hash;
    const r = await ctx.api(`/api/videos/${encodeURIComponent(c.id)}`); const doc = r.doc || r;
    const v = (doc.copia && doc.copia.versoes || []).find((x) => x.id === (doc.copia && doc.copia.versao_ativa)) || (doc.copia && doc.copia.versoes || []).slice(-1)[0];
    return (doc.motion && doc.motion.hash) || (v && v.hash) || undefined;
  }
  async function decidir(ctx, c, acao, tipo) {
    if (ST.ocupado[c.id]) return; ST.ocupado[c.id] = tipo; redesenhar();
    try {
      const hash = await hashDe(ctx, c);
      const corpo = acao === 'descartar' ? { acao, hash, motivos: [], detalhe: '' } : { acao: 'aprovar', hash, agora: tipo === 'publicar' };
      const reg = await ctx.api(`/api/studio/${encodeURIComponent(c.id)}/decidir`, { method: 'POST', body: corpo });
      const doc = (reg && reg.doc) || {};
      ctx.toast(tipo === 'publicar' ? 'Aprovado! Publicando no Instagram agora.' : tipo === 'agendar' ? (doc.agenda && doc.agenda.publicar_em ? `Aprovado! Vai ao ar em ${dh(doc.agenda.publicar_em)}.` : 'Aprovado! Entra no próximo horário livre.') : 'Vídeo descartado.');
    } catch (e) {
      ctx.toast(e.code === 'PAUSADO' ? 'As publicações estão pausadas. Libere em Perfil para publicar.' : e.code === 'ACESSO_ABERTO' ? 'Crie o seu código de acesso em Perfil antes de publicar.' : (e.message || 'Não consegui concluir.'));
    } finally { delete ST.ocupado[c.id]; await carregar(ctx, true); }
  }
  async function acao(a, el, ctx) {
    if (!a || !a.startsWith('vd-')) return false;
    if (ctx) ST.ctx = ctx; ctx = ctxAtual();
    const id = el.dataset.id; const c = id ? ST.lista.find((x) => x.id === id) : null;
    try {
      switch (a) {
        case 'vd-recarregar': ST.erro = null; ST.semArmazenamento = null; await carregar(ctx, true); break;
        case 'vd-gravar': {
          if (!window.Teleprompter) { ctx.toast('O teleprompter não carregou. Atualize a página.'); break; }
          window.Teleprompter.abrir({ roteiro: c ? c.roteiro_texto : '', roteiro_id: c ? c.id : null, titulo: c ? c.titulo : '', ctx });
          break;
        }
        case 'vd-galeria': { const inp = document.getElementById('vd-arquivo'); if (inp) { inp.value = ''; inp.click(); } break; }
        case 'vd-envio-fechar': delete ST.envios[el.dataset.chave]; redesenhar(); break;
        case 'vd-copiar': {
          if (!c) break; const texto = [c.legenda, (c.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
          try { await navigator.clipboard.writeText(texto); ctx.toast('Legenda copiada.'); } catch { ctx.toast('Não consegui copiar. Selecione o texto e copie.'); }
          break;
        }
        case 'vd-publicar': if (c) await decidir(ctx, c, 'aprovar', 'publicar'); break;
        case 'vd-agendar': if (c) await decidir(ctx, c, 'aprovar', 'agendar'); break;
        case 'vd-descartar': if (c && confirm(`Descartar “${c.titulo}”? O vídeo sai da fila de aprovação.`)) await decidir(ctx, c, 'descartar', 'descartar'); break;
        case 'vd-refazer': ST.refazer = ST.refazer === id ? null : id; if (c && !ST.refazerOpts[id]) ST.refazerOpts[id] = { estilo: c.estilo, opcoes: { ...c.opcoes } }; redesenhar(); break;
        case 'vd-refazer-cancelar': ST.refazer = null; delete ST.refazerOpts[id]; redesenhar(); break;
        case 'vd-refazer-estilo': { const o = ST.refazerOpts[id] || (ST.refazerOpts[id] = { estilo: c ? c.estilo : 'hormozi', opcoes: { ...(c ? c.opcoes : OPCOES_PADRAO) } }); o.estilo = el.dataset.estilo; redesenhar(); break; }
        case 'vd-refazer-confirmar': {
          if (!c || ST.ocupado[id]) break; const o = ST.refazerOpts[id] || { estilo: c.estilo, opcoes: c.opcoes };
          ST.ocupado[id] = 'refazer'; redesenhar();
          try { await ctx.api(`/api/videos/${encodeURIComponent(id)}/refazer`, { method: 'POST', body: { estilo: o.estilo, opcoes: o.opcoes } }); ST.refazer = null; delete ST.refazerOpts[id]; ctx.toast('De volta à fila. Aviso quando a nova versão ficar pronta.'); }
          catch (e) { ctx.toast(e.message || 'Não consegui pedir a nova edição.'); }
          finally { delete ST.ocupado[id]; await carregar(ctx, true); }
          break;
        }
        case 'vd-apagar': {
          if (!c || ST.ocupado[id]) break; if (!confirm(`Apagar “${c.titulo}” e os arquivos do armazenamento? Não dá para desfazer.`)) break;
          ST.ocupado[id] = 'apagar'; redesenhar();
          try { await ctx.api(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' }); ctx.toast('Vídeo apagado.'); } catch (e) { ctx.toast(e.message || 'Não consegui apagar.'); }
          finally { delete ST.ocupado[id]; await carregar(ctx, true); }
          break;
        }
        default: return false;
      }
    } catch (e) { ctx.toast(e.message || 'Não foi possível concluir.'); }
    return true;
  }

  // Arquivo da galeria e caixas do painel "Refazer": delegação no documento, para funcionar em qualquer container.
  document.addEventListener('change', (ev) => {
    const t = ev.target; if (!t || !t.matches) return;
    if (t.id === 'vd-arquivo' && t.files && t.files[0]) {
      const f = t.files[0]; const ctx = ctxAtual(); if (!ctx) return;
      if (!/^video\//.test(f.type || '') && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) { ctx.toast('Escolha um arquivo de vídeo (MP4 ou MOV).'); return; }
      enviarArquivo(f, { nome: f.name, titulo: f.name.replace(/\.[^.]+$/, '') }, ctx).catch(() => { /* o erro já aparece no cartão de envio */ });
    }
    if (t.matches('input[data-vd-opt]')) { const id = t.dataset.id; const o = ST.refazerOpts[id]; if (o) o.opcoes[t.dataset.vdOpt] = t.checked; }
  });

  // Abrir direto na aba pela notificação (/?tab=videos) e pela mensagem do service worker.
  function abrirAba() {
    const tentar = (n = 0) => {
      if (!window.Mesa?.state?.pronto && n < 100) return setTimeout(() => tentar(n + 1), 100);
      if (!window.Mesa) return;
      window.Mesa.state.tab = 'videos'; carregar(window.Mesa.ctx(), true); window.Mesa.ctx().render();
    };
    tentar();
  }
  if (new URLSearchParams(location.search).get('tab') === 'videos') abrirAba();
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data && ev.data.tipo === 'abrir-aba' && ev.data.aba === 'videos') abrirAba(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ST.carregou) agendarAtualizacao(); });

  window.Videos = {
    render, acao, carregar, enviarArquivo,
    abrirComRoteiro: ({ roteiro, roteiro_id, titulo }, ctx) => { if (ctx) ST.ctx = ctx; return window.Teleprompter ? window.Teleprompter.abrir({ roteiro, roteiro_id, titulo, ctx: ctxAtual() }) : null; },
    badge: () => ST.lista.filter(paraAprovar).length,
    _st: ST, _norm: norm, ESTILOS, OPCOES,
  };
})();
