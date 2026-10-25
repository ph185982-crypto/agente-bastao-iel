// Aba "Radar": pesquisa de negócios que funcionam fora do Brasil, fila de aprovação dos carrosséis e aprendizado.
// O app só MOSTRA e comanda; pesquisa, verificação e geração rodam no servidor (continuam com o app fechado).
// Nada aqui publica no Instagram: o Pedro baixa o ZIP, posta por conta própria e marca como publicado.
(function () {
  'use strict';
  const ST = {
    carregando: false, carregou: false, erro: null, estado: null, filtro: 'todos', grupo: 'ativas', ops: [], total: 0, carrosseis: [], aprendizado: null,
    abertos: {}, editando: null, ocupado: {}, runId: null, progresso: null, polling: false, modal: null, slide: {}, detalhes: {}, publicando: null,
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Sao_Paulo';
  const dh = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const dia = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }); };
  const num = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  const link = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const ctxAtual = () => window.Mesa.ctx();

  // ── Imagens atrás do código de acesso: busca com o token e vira blob ──────────
  const blobs = new Map();
  async function blobDe(path) {
    if (blobs.has(path)) return blobs.get(path);
    const p = (async () => { const r = await fetch(path); if (!r.ok) throw new Error(`HTTP ${r.status}`); return URL.createObjectURL(await r.blob()); })();
    blobs.set(path, p); p.catch(() => blobs.delete(path));
    return p;
  }
  function hidratar() {
    requestAnimationFrame(() => document.querySelectorAll('img[data-rd-src]').forEach((img) => {
      if (img.dataset.rdOk) return; img.dataset.rdOk = '1';
      blobDe(img.dataset.rdSrc).then((u) => { img.src = u; }).catch(() => { img.alt = 'Imagem indisponível'; });
    }));
  }
  async function baixar(path, nome) {
    const u = await blobDe(path); const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  }

  // ── Dados ───────────────────────────────────────────────────────────────────
  async function carregar(ctx, { forcar = false } = {}) {
    if (ST.carregando || (ST.carregou && !forcar)) return;
    ST.carregando = true; ctx.render();
    try {
      const [estado, ops, cs, ap] = await Promise.all([ctx.api('/api/radar/estado'), ctx.api(`/api/radar/oportunidades?status=${ST.grupo}&filtro=${ST.filtro}`), ctx.api('/api/radar/carrosseis').catch(() => ({ carrosseis: [] })), ctx.api('/api/radar/aprendizado').catch(() => null)]);
      ST.estado = estado; ST.ops = ops.oportunidades || []; ST.total = ops.total || 0; ST.carrosseis = cs.carrosseis || []; ST.aprendizado = ap; ST.erro = null;
      if (estado.execucao_ativa && !ST.polling) conduzir(ctx, estado.execucao_ativa.id);
    } catch (e) { ST.erro = e.message || 'Não consegui abrir o Radar.'; }
    ST.carregando = false; ST.carregou = true; ctx.render();
  }
  async function recarregarLista(ctx) {
    try { const r = await ctx.api(`/api/radar/oportunidades?status=${ST.grupo}&filtro=${ST.filtro}`); ST.ops = r.oportunidades || []; ST.total = r.total || 0; } catch (e) { ctx.toast(e.message); }
    ctx.render();
  }

  // O app aberto conduz a pesquisa (cada chamada avança até ~40 s); o servidor também continua sozinho pela fila.
  async function conduzir(ctx, runId) {
    if (ST.polling) return; ST.polling = true; ST.runId = runId;
    try {
      for (let i = 0; i < 400; i++) {
        let r;
        try { r = await ctx.api(`/api/radar/execucoes/${encodeURIComponent(runId)}/passo`, { method: 'POST', body: {} }); }
        catch (e) { if (e.status === 429) { await new Promise((x) => setTimeout(x, 8000)); continue; } ST.progresso = { rotulo: `Reconectando… (${e.message})`, percentual: ST.progresso?.percentual || 0 }; ctx.render(); await new Promise((x) => setTimeout(x, 5000)); continue; }
        ST.progresso = { ...r.progresso, contadores: r.contadores };
        if (ctx.state.tab === 'radar') ctx.render();
        if (r.concluida) {
          ST.runId = null; ST.progresso = null;
          if (r.estado === 'erro') ctx.toast(`A pesquisa parou: ${r.erro_final?.mensagem || 'erro'}`);
          else ctx.toast(r.resultado?.carrossel_id ? 'Uma nova ideia de negócio está pronta para você.' : 'Pesquisa concluída. Veja as pautas.');
          break;
        }
        await new Promise((x) => setTimeout(x, r.ocupado ? 4000 : r.esperar_s ? Math.min(r.esperar_s, 10) * 1000 : 1200));
      }
    } finally { ST.polling = false; }
    await carregar(ctx, { forcar: true });
  }
  async function pesquisar(ctx) {
    if (ST.runId || ST.polling) return;
    ST.ocupado.pesquisar = true; ctx.render();
    try { const r = await ctx.api('/api/radar/pesquisar', { method: 'POST', body: {} }); ST.progresso = r.progresso; ctx.toast(r.existente ? 'Já havia uma pesquisa em andamento. Acompanhando.' : 'Pesquisa iniciada. Pode levar alguns minutos.'); conduzir(ctx, r.run_id); }
    catch (e) { ctx.toast(e.message); }
    delete ST.ocupado.pesquisar; ctx.render();
  }

  // ── Telas ───────────────────────────────────────────────────────────────────
  function painel() {
    const e = ST.estado; if (!e) return '';
    const m = e.metricas || {}; const u = e.ultima_pesquisa;
    const tile = (r, v, s, peq) => `<div class="rd-stat"><span>${r}</span><b class="${peq ? 'peq' : ''}">${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
    return `<div class="rd-stats" role="list">
      ${tile('Última pesquisa', u ? dh(u.em) : 'Nenhuma ainda', u ? (u.origem === 'cron' ? 'automática, 7h' : 'manual') : '', true)}
      ${tile('Próxima pesquisa', dh(e.proxima_pesquisa), '07:00 de Brasília, todo dia', true)}
      ${tile('Fontes consultadas', `${m.fontes_consultadas ?? 0}<small style="display:inline;font-size:12px;font-weight:600"> de ${m.fontes_ativas || '—'}</small>`, `${(e.fontes_configuradas || []).filter((f) => !f.ativa).length} fontes bloqueadas ou sem feed`)}
      ${tile('Oportunidades encontradas', num(m.oportunidades_encontradas), 'na última pesquisa')}
      ${tile('Aprovadas', num(m.aprovadas), `verificadas e com ${e.limiar}+ pontos`)}
      ${tile('Descartadas', num(m.descartadas), 'com o motivo em cada uma')}
    </div>`;
  }
  const barra = () => {
    if (!ST.progresso) return '';
    const p = ST.progresso; const c = p.contadores;
    return `<div class="rd-prog" role="status" aria-live="polite"><b>${esc(p.rotulo || 'Pesquisando…')}</b><div class="rd-barra"><i style="width:${Math.max(4, p.percentual || 0)}%"></i></div>
      <small>Etapa ${esc(p.indice || '…')} de ${esc(p.total || 7)}${c ? ` · ${num(c.fontes_consultadas)} fontes · ${num(c.candidatos_encontrados)} negócios · ${num(c.verificados)} verificados` : ''}. Pode fechar o app: a pesquisa continua no servidor e você recebe um aviso.</small></div>`;
  };

  function slidesHtml(c) {
    const n = ST.slide[c.id] || 0;
    if (!c.slides?.length) return `<div class="rd-vazio">${c.estado === 'erro' ? `Não foi possível gerar: ${esc(c.erro?.mensagem || 'erro')}` : 'Gerando as imagens…'}</div>`;
    return `<div class="rd-visor"><div class="rd-slides" data-rd-slides="${esc(c.id)}" role="group" aria-label="Carrossel de ${c.slides.length} telas">${c.slides.map((s, i) => `<img data-rd-src="${esc(s.url)}?w=1080" alt="Tela ${s.n}: ${esc((c.textos.find((t) => t.n === s.n) || {}).texto || '')}" width="1080" height="1350">`).join('')}</div><span class="rd-pos" data-rd-pos="${esc(c.id)}">${n + 1}/${c.slides.length}</span></div>
      <div class="rd-pontos" aria-hidden="true">${c.slides.map((_, i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>`;
  }
  function cartaoFila(c) {
    const ocupado = ST.ocupado[c.id];
    const fontes = c.ficha_markdown ? `<details class="rd-det"><summary>Ficha de fontes</summary><div class="rd-legenda">${esc(c.ficha_markdown)}</div></details>` : '';
    const estadoRotulo = { rascunho: 'Rascunho: há bloqueios a corrigir', aguardando_aprovacao: 'Aguardando sua aprovação', aprovado: 'Aprovado: pronto para postar', reprovado: 'Reprovado', publicado: 'Publicado', gerando: 'Gerando…', erro: 'Erro ao gerar' }[c.estado] || c.estado;
    return `<article class="rd-card" data-rd-card="${esc(c.id)}"><div class="rd-corpo">
      <div class="rd-tags"><span class="rd-tag laranja">${esc(estadoRotulo)}</span>${c.pontuacao != null ? `<span class="rd-tag">${esc(c.pontuacao)} pontos</span>` : ''}${c.excecao_limiar ? '<span class="rd-tag alerta">abaixo de 75, gerado por você</span>' : ''}<span class="rd-tag suave">versão ${esc(c.versao)}</span></div>
      <h3>${esc(c.nome || 'Carrossel')}</h3>${c.serie === 'negocios' ? `<p class="rd-meta">Série “${esc(c.serie_nome)}” · ${c.validacao?.bloqueios?.length ? `<b style="color:#A63B24">${c.validacao.bloqueios.length} bloqueio(s): ${esc(c.validacao.bloqueios[0].mensagem)}</b>` : 'sem bloqueios'}${c.validacao?.sugestoes?.length ? ` · ${c.validacao.sugestoes.length} sugestão(ões) editoriais` : ''}</p>` : ''}${slidesHtml(c)}
      ${c.avisos?.length ? `<div class="rd-aviso">${c.avisos.map(esc).join('<br>')}</div>` : ''}
      <details class="rd-det" open><summary>Legenda (${(c.legenda || '').length}/700)</summary><div class="rd-legenda">${esc(c.legenda || '')}</div></details>
      ${fontes}
      ${c.imagens?.length && c.serie !== 'negocios' ? `<details class="rd-det"><summary>Origem das imagens</summary><ul class="rd-lista">${c.imagens.map((i) => `<li>Telas ${esc(i.telas.join(', '))}: ${esc(i.descricao)}<br><a href="${esc(link(i.origem?.url_pagina))}" target="_blank" rel="noopener noreferrer">${esc(i.origem?.dominio || 'origem')}</a> · ${esc(i.licenca)}</li>`).join('')}</ul></details>` : '<p class="rd-meta">Nenhuma fotografia real foi usada: as telas são tipográficas.</p>'}
      <div class="rd-acoes">
        ${c.serie === 'negocios' ? `<button class="rd-btn laranja" data-action="rd-ed-abrir" data-id="${esc(c.id)}">Editar telas, fotos e legenda</button>` : ''}
        ${c.zip ? `<button class="rd-btn azul" data-action="rd-zip" data-id="${esc(c.id)}" ${c.serie === 'negocios' && c.validacao?.bloqueios?.length ? 'disabled' : ''}>Baixar ZIP (${(c.slides || []).length || 8} imagens + legenda + fontes)</button>` : ''}
        ${c.estado === 'aguardando_aprovacao' ? `<button class="rd-btn laranja" data-action="rd-aprovar" data-id="${esc(c.id)}" ${ocupado || c.validacao?.bloqueios?.length ? 'disabled' : ''}>Aprovar</button><button class="rd-btn risco" data-action="rd-reprovar" data-id="${esc(c.id)}" ${ocupado ? 'disabled' : ''}>Reprovar</button>` : ''}
        ${['aprovado', 'aguardando_aprovacao'].includes(c.estado) ? `<button class="rd-btn fantasma" data-action="rd-publicado" data-id="${esc(c.id)}">Já publiquei no Instagram</button>` : ''}
        ${c.estado === 'reprovado' ? `<button class="rd-btn fantasma" data-action="rd-reabrir" data-id="${esc(c.id)}">Reabrir</button>` : ''}
        ${c.estado === 'publicado' ? `<button class="rd-btn fantasma" data-action="rd-metricas" data-id="${esc(c.id)}">Informar números do post</button>` : ''}
      </div>
      <p class="rd-meta">Nada é publicado automaticamente. Criado em ${dh(c.criado_em)}.${c.publicacao ? ` Publicado em ${dh(c.publicacao.publicado_em)}.` : ''}${c.decisao?.motivo ? ` Motivo: ${esc(c.decisao.motivo)}` : ''}</p>
    </div></article>`;
  }
  function filaAprovacao() {
    const lista = ST.carrosseis.filter((c) => ['rascunho', 'aguardando_aprovacao', 'aprovado', 'gerando', 'erro'].includes(c.estado));
    if (!lista.length) return '';
    return `<div class="rd-h2"><h2>Fila de aprovação</h2><span>${lista.length} ${lista.length > 1 ? 'carrosséis' : 'carrossel'}</span></div>${lista.map(cartaoFila).join('')}`;
  }
  function publicados() {
    const lista = ST.carrosseis.filter((c) => ['publicado', 'reprovado'].includes(c.estado));
    if (!lista.length) return '';
    return `<details class="rd-det"><summary>Publicados e reprovados (${lista.length})</summary>${lista.map(cartaoFila).join('')}</details>`;
  }

  function cartaoOp(o) {
    const aberto = ST.abertos[o.id]; const ocupado = ST.ocupado[o.id]; const ed = ST.editando === o.id;
    const nota = o.pontuacao != null ? `<div class="rd-nota ${o.pontuacao >= (ST.estado?.limiar || 75) && o.verificacao_estado === 'verificada' ? 'ok' : ''}">${o.pontuacao}<small>de 100</small></div>` : '';
    const foto = o.imagem ? `<img data-rd-src="${esc(o.imagem.url)}" alt="Imagem do site oficial de ${esc(o.nome)}"><span class="rd-cred">${esc(o.imagem.tipo === 'banco_de_imagens' ? 'Imagem ilustrativa' : `Foto: ${o.imagem.origem?.dominio || 'site oficial'}`)}</span>` : `<div class="rd-sem">${esc(o.nome)}</div>`;
    const dem = o.prova_demanda.confirmada ? o.prova_demanda.itens.map((i) => `${esc(i.valor)}: ${esc(i.texto)}${i.atribuicao ? ` <small>(${esc(i.atribuicao)})</small>` : ''}`).join('<br>') : `<small>Ainda sem dado confirmado.${o.prova_demanda.citada ? ` O material cita: “${esc(o.prova_demanda.citada)}” (não verificado).` : ''}</small>`;
    const selo = { verificada: ['laranja', 'verificada'], insuficiente: ['alerta', 'não verificada'], reprovada: ['alerta', 'reprovada'] }[o.verificacao_estado];
    return `<article class="rd-card" data-rd-op="${esc(o.id)}"><div class="rd-foto">${foto}${nota}</div><div class="rd-corpo">
      <div class="rd-tags"><span class="rd-tag">${esc(o.pais)}</span><span class="rd-tag suave">${esc(o.categoria_rotulo || o.categoria)}</span>${o.ia ? '<span class="rd-tag suave">IA</span>' : ''}${selo ? `<span class="rd-tag ${selo[0]}">${selo[1]}</span>` : ''}${o.rank ? `<span class="rd-tag suave">nº ${o.rank}</span>` : ''}${o.status === 'carrossel_gerado' ? '<span class="rd-tag laranja">carrossel pronto</span>' : ''}${o.status === 'usada' ? '<span class="rd-tag suave">já utilizada</span>' : ''}${o.status === 'salva' ? '<span class="rd-tag suave">pauta salva</span>' : ''}</div>
      <h3>${esc(o.nome)}</h3><p class="rd-resumo">${esc(o.resumo)}</p>
      <dl class="rd-dl"><div><dt>Como ganha dinheiro</dt><dd>${esc(o.como_ganha_dinheiro || 'Não informado')}</dd></div>
      <div><dt>Prova de demanda</dt><dd>${dem}</dd></div>
      <div><dt>Investimento aproximado para testar</dt><dd>${esc({ baixo: 'Baixo', medio: 'Médio', alto: 'Alto' }[o.investimento_para_testar?.nivel] || '—')}${o.investimento_para_testar?.texto ? ` · ${esc(o.investimento_para_testar.texto)}` : ''}</dd></div>
      <div><dt>Adaptação ao Brasil (hipótese)</dt><dd>${esc(o.adaptacao_brasil || '—')}</dd></div></dl>
      ${o.descartada_motivo ? `<div class="rd-aviso">Descartada: ${esc(o.descartada_motivo)}</div>` : ''}
      ${!o.elegivel_carrossel && o.motivo_sem_carrossel && !o.descartada_motivo ? `<p class="rd-meta">${esc(o.motivo_sem_carrossel)}</p>` : ''}
      <div class="rd-acoes">
        ${o.carrossel_id ? '<button class="rd-btn azul" data-action="rd-ver-carrossel" data-id="' + esc(o.carrossel_id) + '">Ver carrossel</button>' : `<button class="rd-btn azul" data-action="rd-gerar" data-id="${esc(o.id)}" ${ocupado || !o.elegivel_carrossel ? 'disabled' : ''}>${ocupado === 'gerar' ? 'Gerando… (até 1 min)' : 'Gerar carrossel'}</button><button class="rd-btn fantasma peq" data-action="rd-gerar-min" data-id="${esc(o.id)}" ${ocupado || !o.elegivel_carrossel ? 'disabled' : ''} title="Modelo minimalista: estratégia por trás, 7 telas">Modelo minimalista</button><button class="rd-btn fantasma peq" data-action="rd-gerar-antiga" data-id="${esc(o.id)}" ${ocupado || !o.elegivel_carrossel ? 'disabled' : ''} title="Modelo anterior da série “Ideias que dão dinheiro”">Série antiga</button>`}
        <button class="rd-btn" data-action="rd-reels" data-id="${esc(o.id)}" ${ocupado || !o.elegivel_carrossel ? 'disabled' : ''}>${ocupado === 'reels' ? 'Gerando…' : o.reels ? 'Ver Reels' : 'Gerar Reels'}</button>
        ${o.status !== 'salva' && o.status !== 'descartada' && o.status !== 'descartada_usuario' ? `<button class="rd-btn fantasma" data-action="rd-op" data-acao="salvar_pauta" data-id="${esc(o.id)}">Salvar pauta</button>` : ''}
        ${['descartada', 'descartada_usuario'].includes(o.status) ? `<button class="rd-btn fantasma" data-action="rd-op" data-acao="restaurar" data-id="${esc(o.id)}">Restaurar</button>` : `<button class="rd-btn risco" data-action="rd-descartar" data-id="${esc(o.id)}">Descartar</button>`}
        <button class="rd-btn fantasma" data-action="rd-fontes" data-id="${esc(o.id)}" aria-expanded="${!!aberto}">${aberto ? 'Ocultar fontes' : 'Ver fontes'}</button>
        <button class="rd-btn fantasma" data-action="rd-editar" data-id="${esc(o.id)}">${ed ? 'Fechar edição' : 'Editar dados'}</button>
        ${o.status !== 'usada' ? `<button class="rd-btn fantasma" data-action="rd-op" data-acao="marcar_usada" data-id="${esc(o.id)}">Marcar como já utilizado</button>` : ''}
      </div>
      ${aberto ? detalheFontes(o) : ''}${ed ? formEdicao(o) : ''}
      <p class="rd-meta">Encontrada em ${dia(o.encontrada_em)}${o.status === 'candidata' ? '' : ''}.</p></div></article>`;
  }
  function detalheFontes(o) {
    const d = ST.detalhes[o.id];
    if (!d) return '<p class="rd-meta">Carregando fontes…</p>';
    const claims = d.verificacao?.claims || [];
    return `<div class="rd-det"><b style="font-size:12px">Fontes e evidências</b>
      <ul class="rd-lista">${(d.fontes || []).map((f) => `<li><a href="${esc(link(f.url))}" target="_blank" rel="noopener noreferrer">${esc(f.veiculo || f.url)}</a> · ${esc(f.classe || '')}${f.publicada_em ? ` · publicada em ${dia(f.publicada_em)}` : ''}${f.acessada_em ? ` · consultada em ${dia(f.acessada_em)}` : ''}</li>`).join('') || '<li>Nenhuma fonte lida.</li>'}</ul>
      ${claims.length ? `<b style="font-size:12px;display:block;margin-top:10px">Afirmações</b><ul class="rd-lista">${claims.map((c) => `<li><b>${esc(c.valor_exibicao || c.tipo)}</b> — ${esc(c.texto)} <span class="rd-tag ${c.usavel ? 'laranja' : 'alerta'}">${c.usavel ? 'liberada' : 'não usada'}</span> <span class="rd-tag suave">confiança ${esc(c.confianca)}</span>${c.atribuicao ? ` <span class="rd-tag suave">${esc(c.atribuicao)}</span>` : ''}<blockquote>“${esc(c.trecho)}”</blockquote><small><a href="${esc(link(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.veiculo)}</a> · ${dia(c.data_publicacao)} · consultada em ${dia(c.consultado_em)}${(c.observacoes || []).length ? `<br>${esc(c.observacoes.join(' '))}` : ''}</small></li>`).join('')}</ul>` : ''}
      ${d.criterios ? `<b style="font-size:12px;display:block;margin-top:10px">Pontuação</b><table class="rd-tab"><tr><th>Critério</th><th>Pontos</th><th>Motivo</th></tr>${Object.entries(d.criterios).map(([k, c]) => `<tr><td>${esc({ novidade: 'Novidade', demanda: 'Prova de demanda', receita: 'Modelo de receita', compreensao: 'Compreensão', brasil: 'Adaptação ao Brasil', investimento: 'Investimento', visual: 'Potencial visual', compartilhamento: 'Compartilhamento' }[k] || k)}</td><td>${num(c.pontos)}/${c.max}</td><td>${esc(c.limitado_por ? `limitado: ${c.limitado_por}` : c.motivo || '')}</td></tr>`).join('')}</table>` : ''}
      ${(d.verificacao?.limitacoes || []).length ? `<p class="rd-meta">${d.verificacao.limitacoes.map(esc).join('<br>')}</p>` : ''}
      ${d.reels ? `<b style="font-size:12px;display:block;margin-top:10px">Roteiro de Reels</b><div class="rd-legenda">${esc([d.reels.gancho, ...(d.reels.blocos || []).map((b) => `${b.tempo}: ${b.fala} [tela: ${b.tela}]`), d.reels.fechamento].join('\n\n'))}</div>` : ''}</div>`;
  }
  const formEdicao = (o) => `<div class="rd-det"><form class="rd-form" data-rd-form="editar" data-id="${esc(o.id)}">
    <label>Nome<input name="nome" value="${esc(o.nome)}" maxlength="80"></label><label>País<input name="pais" value="${esc(o.pais)}" maxlength="40"></label>
    <label>Categoria<select name="categoria">${Object.entries({ saas: 'SaaS', startup: 'Startup', produto: 'Produto', servico: 'Serviço', negocio_local: 'Negócio local', ecommerce: 'E-commerce' }).map(([k, v]) => `<option value="${k}" ${k === o.categoria ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Resumo em uma frase<textarea name="resumo" maxlength="240">${esc(o.resumo)}</textarea></label><label>Como ganha dinheiro<textarea name="como_ganha_dinheiro" maxlength="280">${esc(o.como_ganha_dinheiro)}</textarea></label>
    <label>Adaptação ao Brasil (hipótese)<textarea name="adaptacao_brasil" maxlength="280">${esc(o.adaptacao_brasil)}</textarea></label>
    <p class="rd-meta">Você edita só os textos descritivos. Números e fontes continuam os verificados; para mudar um número é preciso uma nova verificação.</p>
    <button class="rd-btn laranja" type="submit">Salvar alterações</button></form></div>`;

  // Nova história escolhida por você: o servidor lê as páginas e confere cada trecho antes de liberar qualquer número.
  const novaHistoria = () => `<details class="rd-det" ${ST.nova?.aberta ? 'open' : ''}><summary data-rd-nova>Nova história (avançado)</summary>
    <form class="rd-form" data-rd-form="historia"><p class="rd-meta">Indique o negócio, os links e as afirmações com o trecho exato que as comprova. O servidor abre cada página, confere o trecho palavra por palavra e só libera números com fonte oficial ou duas fontes independentes. Cole o JSON da pesquisa (veja docs/RADAR.md).</p>
    <label>Pesquisa (JSON)<textarea name="json" rows="8" spellcheck="false" placeholder='{"nome":"…","pais":"…","site_oficial":"https://…","fontes":["https://…"],"afirmacoes":[{"fonte":0,"tipo":"usuarios","texto":"…","numero":100000,"unidade":"usuarios","trecho":"…"}]}'>${esc(ST.nova?.json || '')}</textarea></label>
    <button class="rd-btn laranja" type="submit" ${ST.ocupado.historia ? 'disabled' : ''}>${ST.ocupado.historia ? 'Lendo e conferindo as fontes…' : 'Verificar fontes e criar história'}</button></form></details>`;
  const filtros = () => `<div class="rd-chips" role="group" aria-label="Filtros">${(ST.estado?.filtros || [['todos', 'Todos']]).map(([k, r]) => `<button class="rd-chip" data-action="rd-filtro" data-f="${esc(k)}" aria-pressed="${ST.filtro === k}">${esc(r)}</button>`).join('')}</div>
    <div class="rd-abas" role="group">${[['ativas', 'Pautas'], ['usadas', 'Já utilizadas'], ['descartadas', 'Descartadas']].map(([k, r]) => `<button data-action="rd-grupo" data-g="${k}" aria-pressed="${ST.grupo === k}">${r}</button>`).join('')}</div>`;

  function aprendizadoHtml() {
    const a = ST.aprendizado; if (!a) return '';
    const l = a.lideres || {};
    const linha = (r, x) => `<tr><td>${r}</td><td>${x ? `${esc(x.rotulo)} <small>(${esc(num(x.valor))}${x.amostra === 'pequena' ? ', amostra pequena' : ''})</small>` : '—'}</td></tr>`;
    return `<details class="rd-det"><summary>O que o Radar já aprendeu (${a.posts_medidos || 0} posts com números)</summary>
      ${(a.categorias || []).length ? `<table class="rd-tab"><tr><th>Quem lidera</th><th>Categoria</th></tr>${linha('Maior alcance', l.maior_alcance)}${linha('Maior retenção', l.maior_retencao)}${linha('Mais compartilhamentos por mil', l.mais_compartilhamentos)}${linha('Mais seguidores por mil alcançados', l.mais_seguidores)}</table>
      <table class="rd-tab" style="margin-top:10px"><tr><th>Categoria</th><th>Posts</th><th>Alcance</th><th>Seguidores</th></tr>${a.categorias.map((c) => `<tr><td>${esc(c.rotulo)}</td><td>${c.n}${c.amostra === 'pequena' ? ' *' : ''}</td><td>${num(c.alcance_mediana)}</td><td>${num(c.seguidores_ganhos_total)}</td></tr>`).join('')}</table>` : '<p class="rd-meta">Ainda não há posts com números. Depois de postar, use “Já publiquei” e informe os números.</p>'}
      <p class="rd-meta">${esc(a.aviso || '')}</p></details>`;
  }
  const fontesHtml = () => {
    const f = ST.estado?.fontes_configuradas || []; const run = ST.estado?.resultado_ultima?.fontes || [];
    const porId = new Map(run.map((x) => [x.id, x]));
    return `<details class="rd-det"><summary>Fontes configuradas (${f.filter((x) => x.ativa).length} ativas, ${f.filter((x) => !x.ativa).length} bloqueadas)</summary><div class="rd-fontes">${f.map((x) => { const r = porId.get(x.id); return `<div class="rd-fonte ${x.ativa ? '' : 'off'}"><span>${esc(x.nome)} <small>(${esc(x.idioma)})</small></span><small>${x.ativa ? (r ? (r.ok ? `${r.itens} itens` : esc(r.erro || 'falhou')) : 'ativa') : esc(x.motivo_inativa)}</small></div>`; }).join('')}</div>
      <p class="rd-meta">Termos pesquisados: ${esc((ST.estado?.termos?.en || []).concat(ST.estado?.termos?.pt || []).join(' · '))}. Só fontes abertas (RSS e APIs públicas), sem raspagem nem contorno de bloqueio.</p></details>`;
  };

  const MOTIVOS = {
    descartar: ['Já conhecido', 'Não é para o meu público', 'Difícil de copiar no Brasil', 'Dado fraco ou duvidoso', 'Tema repetido'],
    reprovar: ['Texto longo', 'Imagem fraca', 'Tema repetido', 'Dado duvidoso', 'Tom fora do meu'],
  };
  const escolhas = (tipo) => `<div class="rd-chips" role="radiogroup" aria-label="Motivo">${MOTIVOS[tipo].map((x) => `<label class="rd-chip"><input type="radio" name="motivo_opcao" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('')}</div><details class="rd-det"><summary>Escrever outro motivo</summary><textarea name="motivo" maxlength="200" aria-label="Outro motivo"></textarea></details>`;

  function modal() {
    const m = ST.modal; if (!m) return '';
    if (m.tipo === 'reprovar') return `<div class="rd-modal"><div role="dialog" aria-modal="true"><h3>Reprovar carrossel</h3><form class="rd-form" data-rd-form="reprovar" data-id="${esc(m.id)}"><p class="rd-meta">Toque no motivo (opcional):</p>${escolhas('reprovar')}<div class="rd-acoes rd-fixo"><button class="rd-btn risco" type="submit">Reprovar</button><button class="rd-btn fantasma" type="button" data-action="rd-fechar">Cancelar</button></div></form></div></div>`;
    if (m.tipo === 'descartar') return `<div class="rd-modal"><div role="dialog" aria-modal="true"><h3>Descartar oportunidade</h3><form class="rd-form" data-rd-form="descartar" data-id="${esc(m.id)}"><p class="rd-meta">Toque no motivo (opcional):</p>${escolhas('descartar')}<p class="rd-meta">Ela não será sugerida de novo.</p><div class="rd-acoes rd-fixo"><button class="rd-btn risco" type="submit">Descartar</button><button class="rd-btn fantasma" type="button" data-action="rd-fechar">Cancelar</button></div></form></div></div>`;
    if (m.tipo === 'publicado' || m.tipo === 'metricas') {
      const c = ST.carrosseis.find((x) => x.id === m.id) || {}; const mt = c.metricas || {};
      const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const campo = (k, r) => `<label>${r}<input name="${k}" type="number" inputmode="numeric" min="0" step="1" value="${mt[k] ?? ''}"></label>`;
      return `<div class="rd-modal"><div role="dialog" aria-modal="true"><h3>${m.tipo === 'publicado' ? 'Marcar como publicado' : 'Números do post'}</h3>
        <p class="rd-meta">Deixe em branco o que você ainda não sabe: vazio não vira zero. Curtida não é seguidor ganho.</p>
        <form class="rd-form" data-rd-form="${m.tipo}" data-id="${esc(m.id)}">
        ${m.tipo === 'publicado' ? `<label>Data e horário da publicação<input name="publicado_em" type="datetime-local" value="${agora}"></label><label>Link do post (opcional)<input name="link" type="url" inputmode="url" placeholder="https://www.instagram.com/p/..."></label>` : ''}
        <div class="rd-grid2">${campo('visualizacoes', 'Visualizações')}${campo('alcance', 'Alcance')}${campo('curtidas', 'Curtidas')}${campo('comentarios', 'Comentários')}${campo('compartilhamentos', 'Compartilhamentos')}${campo('salvamentos', 'Salvamentos')}${campo('visitas_perfil', 'Visitas ao perfil')}${campo('seguidores_ganhos', 'Seguidores ganhos')}${campo('retencao_pct', 'Retenção (%)')}</div>
        <div class="rd-acoes"><button class="rd-btn laranja" type="submit">Salvar</button><button class="rd-btn fantasma" type="button" data-action="rd-fechar">Cancelar</button></div></form></div></div>`;
    }
    if (m.tipo === 'reels') return `<div class="rd-modal"><div role="dialog" aria-modal="true"><h3>Roteiro de Reels</h3><div class="rd-legenda">${esc([m.dados.gancho, ...(m.dados.blocos || []).map((b) => `${b.tempo}: ${b.fala}\n[na tela: ${b.tela}]`), m.dados.fechamento].join('\n\n'))}</div><p class="rd-meta">Só fatos verificados; a ideia para o Brasil é hipótese.</p><div class="rd-acoes"><button class="rd-btn laranja" data-action="rd-copiar-reels">Copiar roteiro</button><button class="rd-btn fantasma" data-action="rd-fechar">Fechar</button></div></div></div>`;
    return '';
  }

  function render(ctx) {
    if (!ST.carregou && !ST.carregando && !ST.erro) setTimeout(() => carregar(ctx), 0);
    const e = ST.estado;
    const nova = e && e.nova_ideia ? `<button class="rd-nova" data-action="rd-ir-fila"><span style="font-size:26px">★</span><span>Uma nova ideia de negócio está pronta para você.<small>${e.fila_aprovacao} ${e.fila_aprovacao > 1 ? 'carrosséis' : 'carrossel'} na fila de aprovação</small></span></button>` : '';
    const avisos = [];
    if (e?.sem_banco) avisos.push('<div class="rd-aviso erro">O Radar precisa do banco de dados no servidor (Cópia no servidor) para guardar pesquisas e carrosséis.</div>');
    if (e && !e.ia_configurada) avisos.push('<div class="rd-aviso erro">Nenhuma chave de IA está configurada no servidor: a pesquisa automática não consegue rodar.</div>');
    if (e && !e.push) avisos.push('<div class="rd-aviso">Avisos no celular ainda não estão ativos (chaves VAPID). Em Perfil você ativa as notificações.</div>');
    const ativa = !!(ST.runId || e?.execucao_ativa);
    const html = `<div class="rd" id="rd-topo"><span class="rd-eyebrow">Radar de Negócios</span><h1>Ideias que dão dinheiro</h1>
      <p class="rd-sub">Todo dia às 7h o Radar pesquisa negócios que funcionam lá fora, confere as fontes e prepara um carrossel. Nada vai ao Instagram sem você.</p>
      ${ST.erro ? `<div class="rd-aviso erro">${esc(ST.erro)} <button class="rd-btn peq" data-action="rd-recarregar">Tentar de novo</button></div>` : ''}
      ${avisos.join('')}${nova}${painel()}
      <button class="rd-btn laranja cheio" data-action="rd-pesquisar" ${ativa || ST.ocupado.pesquisar || e?.sem_banco ? 'disabled' : ''}>${ativa ? 'Pesquisando…' : 'Pesquisar oportunidades agora'}</button>
      <div style="height:12px"></div>${barra()}
      ${ST.carregando && !e ? '<div class="rd-vazio">Abrindo o Radar…</div>' : ''}
      ${e?.resultado_ultima?.sem_carrossel_motivo && !ativa ? `<div class="rd-aviso">${esc(e.resultado_ultima.sem_carrossel_motivo)}</div>` : ''}
      <div id="rd-fila">${filaAprovacao()}</div>
      <div class="rd-h2"><h2>Oportunidades</h2><span>${ST.total} no total</span></div>${novaHistoria()}${filtros()}
      ${ST.ops.length ? ST.ops.map(cartaoOp).join('') : `<div class="rd-vazio">${e ? 'Nenhuma oportunidade neste filtro. Toque em “Pesquisar oportunidades agora” para buscar.' : ''}</div>`}
      ${publicados()}${aprendizadoHtml()}${fontesHtml()}${e?.resultado_ultima?.consumo ? `<p class="rd-meta">Última pesquisa: ${e.resultado_ultima.consumo.chamadas} chamadas de IA, custo estimado US$ ${num(e.resultado_ultima.consumo.custo_usd_estimado)} (provedores gratuitos não cobram).</p>` : ''}</div>${window.RadarEditor ? window.RadarEditor.render() : ''}${modal()}`;
    hidratar();
    return html;
  }

  // ── Ações ───────────────────────────────────────────────────────────────────
  async function acao(a, el, ctx) {
    if (!a.startsWith('rd-')) return false;
    if (a.startsWith('rd-ed-') && window.RadarEditor) return window.RadarEditor.acao(a, el, ctx);
    const id = el.dataset.id;
    const op = (acao, body = {}, rot = 'acao') => ctx.api(`/api/radar/oportunidades/${encodeURIComponent(id)}/acao`, { method: 'POST', body: { acao, ...body } });
    try {
      switch (a) {
        case 'rd-pesquisar': await pesquisar(ctx); break;
        case 'rd-recarregar': await carregar(ctx, { forcar: true }); break;
        case 'rd-filtro': ST.filtro = el.dataset.f; await recarregarLista(ctx); break;
        case 'rd-grupo': ST.grupo = el.dataset.g; await recarregarLista(ctx); break;
        case 'rd-ir-fila': document.getElementById('rd-fila')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
        case 'rd-fontes': {
          ST.abertos[id] = !ST.abertos[id]; ctx.render();
          if (ST.abertos[id] && !ST.detalhes[id]) { try { ST.detalhes[id] = await ctx.api(`/api/radar/oportunidades/${encodeURIComponent(id)}`); } catch (e) { ctx.toast(e.message); } ctx.render(); }
          break;
        }
        case 'rd-editar': ST.editando = ST.editando === id ? null : id; ctx.render(); break;
        case 'rd-op': await op(el.dataset.acao); ctx.toast({ salvar_pauta: 'Pauta salva.', marcar_usada: 'Marcada como já utilizada.', restaurar: 'Restaurada.' }[el.dataset.acao] || 'Pronto.'); await recarregarLista(ctx); break;
        case 'rd-descartar': ST.modal = { tipo: 'descartar', id }; ctx.render(); break;
        case 'rd-gerar': case 'rd-gerar-antiga': case 'rd-gerar-min': {
          ST.ocupado[id] = 'gerar'; ctx.render(); const corpo = a === 'rd-gerar-antiga' ? { serie: 'ideias' } : a === 'rd-gerar-min' ? { template: 'minimalista' } : {};
          try {
            let r = await op('gerar_carrossel', corpo);
            for (let i = 0; i < 6 && r.parcial; i++) { ctx.toast('Gerando as imagens…'); r = await op('gerar_carrossel', corpo); }
            ctx.toast(r.existente ? 'Esse carrossel já existe.' : (r.carrossel?.estado === 'rascunho' ? 'Carrossel criado como rascunho: há bloqueios a corrigir no editor.' : 'Carrossel pronto na fila de aprovação.'));
            await carregar(ctx, { forcar: true }); document.getElementById('rd-fila')?.scrollIntoView({ behavior: 'smooth' });
          }
          catch (e) { if (e.code === 'ABAIXO_DO_LIMIAR' && confirm(`${e.message}\n\nGerar mesmo assim?`)) { const r = await op('gerar_carrossel', { ...corpo, permitir_baixa: true }); void r; await carregar(ctx, { forcar: true }); } else ctx.toast(e.message); }
          finally { delete ST.ocupado[id]; ctx.render(); }
          break;
        }
        case 'rd-reels': {
          const o = ST.ops.find((x) => x.id === id);
          ST.ocupado[id] = 'reels'; ctx.render();
          try { let dados; if (o?.reels) dados = (await ctx.api(`/api/radar/oportunidades/${encodeURIComponent(id)}`)).reels; else dados = (await op('gerar_reels')).reels; ST.modal = { tipo: 'reels', dados }; }
          catch (e) { ctx.toast(e.message); } finally { delete ST.ocupado[id]; ctx.render(); }
          break;
        }
        case 'rd-copiar-reels': { const d = ST.modal?.dados; if (d) { try { await navigator.clipboard.writeText([d.gancho, ...(d.blocos || []).map((b) => `${b.tempo}: ${b.fala}`), d.fechamento].join('\n\n')); ctx.toast('Roteiro copiado.'); } catch { ctx.toast('Não consegui copiar. Selecione o texto.'); } } break; }
        case 'rd-ver-carrossel': document.getElementById('rd-fila')?.scrollIntoView({ behavior: 'smooth' }); ctx.toast('O carrossel está na fila de aprovação, acima.'); break;
        case 'rd-zip': { const c = ST.carrosseis.find((x) => x.id === id); await baixar(c.zip.url, c.zip.nome); ctx.toast('Download iniciado.'); break; }
        case 'rd-aprovar': ST.ocupado[id] = 1; ctx.render(); try { await ctx.api(`/api/radar/carrosseis/${encodeURIComponent(id)}/decisao`, { method: 'POST', body: { acao: 'aprovar' } }); ctx.toast('Aprovado. Baixe o ZIP e poste quando quiser: nada é publicado sozinho.'); await carregar(ctx, { forcar: true }); } catch (e) { ctx.toast(e.message); } finally { delete ST.ocupado[id]; ctx.render(); } break;
        case 'rd-reprovar': ST.modal = { tipo: 'reprovar', id }; ctx.render(); break;
        case 'rd-reabrir': await ctx.api(`/api/radar/carrosseis/${encodeURIComponent(id)}/decisao`, { method: 'POST', body: { acao: 'reabrir' } }); await carregar(ctx, { forcar: true }); break;
        case 'rd-publicado': ST.modal = { tipo: 'publicado', id }; ctx.render(); break;
        case 'rd-metricas': ST.modal = { tipo: 'metricas', id }; ctx.render(); break;
        case 'rd-fechar': ST.modal = null; ctx.render(); break;
        default: return false;
      }
    } catch (e) { ctx.toast(e.message || 'Não foi possível concluir.'); }
    return true;
  }

  // Formulários (envio com Enter ou toque) e rolagem do carrossel
  const root = document.getElementById('esteira');
  root.addEventListener('click', (ev) => { const sm = ev.target.closest('summary[data-rd-nova]'); if (sm) { ST.nova = { ...(ST.nova || {}), aberta: !sm.parentElement.open }; } });
  root.addEventListener('input', (ev) => { const t = ev.target; if (t.matches?.('[data-rd-form="historia"] textarea')) ST.nova = { ...(ST.nova || {}), json: t.value }; });
  root.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-rd-form]'); if (!f) return;
    ev.preventDefault(); const ctx = ctxAtual(); const id = f.dataset.id; const tipo = f.dataset.rdForm; const v = Object.fromEntries(new FormData(f).entries()); if ('motivo_opcao' in v || 'motivo' in v) v.motivo = [v.motivo_opcao, (v.motivo || '').trim()].filter(Boolean).join(' — ');
    try {
      if (tipo === 'editar') { await ctx.api(`/api/radar/oportunidades/${encodeURIComponent(id)}/acao`, { method: 'POST', body: { acao: 'editar', campos: v } }); ST.editando = null; ctx.toast('Dados atualizados.'); delete ST.detalhes[id]; await recarregarLista(ctx); }
      if (tipo === 'historia') { let entrada; try { entrada = JSON.parse(v.json || ''); } catch { ctx.toast('O JSON da pesquisa não é válido.'); return; } ST.ocupado.historia = true; ctx.render(); try { const o = await ctx.api('/api/radar/historias', { method: 'POST', body: entrada }); ctx.toast(o.verificacao_estado === 'verificada' ? `“${o.nome}” verificada. Toque em Gerar carrossel.` : `“${o.nome}” criada, mas a verificação ficou “${o.verificacao_estado}”. Veja as fontes.`); await recarregarLista(ctx); } finally { delete ST.ocupado.historia; ctx.render(); } return; }
      if (tipo === 'descartar') { await ctx.api(`/api/radar/oportunidades/${encodeURIComponent(id)}/acao`, { method: 'POST', body: { acao: 'descartar', motivo: v.motivo } }); ST.modal = null; ctx.toast('Descartada. Não será sugerida de novo.'); await recarregarLista(ctx); }
      if (tipo === 'reprovar') { await ctx.api(`/api/radar/carrosseis/${encodeURIComponent(id)}/decisao`, { method: 'POST', body: { acao: 'reprovar', motivo: v.motivo } }); ST.modal = null; ctx.toast('Carrossel reprovado.'); await carregar(ctx, { forcar: true }); }
      if (tipo === 'publicado' || tipo === 'metricas') {
        const { publicado_em, link: lk, ...m } = v;
        if (tipo === 'publicado') await ctx.api(`/api/radar/carrosseis/${encodeURIComponent(id)}/decisao`, { method: 'POST', body: { acao: 'publicado', publicado_em: publicado_em ? new Date(publicado_em).toISOString() : undefined, link: lk || null, metricas: m } });
        else await ctx.api(`/api/radar/carrosseis/${encodeURIComponent(id)}/metricas`, { method: 'POST', body: { metricas: m } });
        ST.modal = null; ctx.toast('Salvo. O Radar usa isso para aprender quais categorias funcionam.'); await carregar(ctx, { forcar: true });
      }
    } catch (e) { ctx.toast(e.message || 'Não foi possível salvar.'); }
  });
  root.addEventListener('scroll', (ev) => {
    const s = ev.target; if (!s.dataset || !s.dataset.rdSlides) return;
    const n = Math.round(s.scrollLeft / s.clientWidth); const id = s.dataset.rdSlides; ST.slide[id] = n;
    const pos = root.querySelector(`[data-rd-pos="${CSS.escape(id)}"]`); if (pos) pos.textContent = `${n + 1}/${s.children.length}`;
    const pts = s.parentElement.nextElementSibling; if (pts) [...pts.children].forEach((p, i) => p.classList.toggle('on', i === n));
  }, true);

  // Abrir direto na aba pela notificação (/?tab=radar) e pela mensagem do service worker.
  function abrirAba() {
    const tentar = (n = 0) => {
      if (!window.Mesa?.state?.pronto && n < 100) return setTimeout(() => tentar(n + 1), 100);
      if (!window.Mesa) return;
      window.Mesa.state.tab = 'radar'; carregar(ctxAtual(), { forcar: true }); ctxAtual().render();
    };
    tentar();
  }
  if (new URLSearchParams(location.search).get('tab') === 'radar') abrirAba();
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data && ev.data.tipo === 'abrir-aba' && ev.data.aba === 'radar') abrirAba(); });

  // Enquanto a aba está aberta e uma pesquisa automática roda, acompanha.
  setInterval(() => { try { const m = window.Mesa; if (m && m.state.tab === 'radar' && !window.RadarEditor?._ed?.id && ST.carregou && !ST.polling && !document.hidden) carregar(ctxAtual(), { forcar: true }); } catch { /* ignora */ } }, 90000);

  async function baixarFresco(path, nome) {
    const r = await fetch(path); if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch { /* sem corpo */ } throw new Error(m); }
    const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  window.RadarUI = { render, acao, carregar, badge: () => (ST.estado?.fila_aprovacao || 0), _st: ST, util: { esc, blobDe, hidratar, baixar: baixarFresco } };
})();
