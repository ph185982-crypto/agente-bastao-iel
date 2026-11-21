// Growth Dashboard + Diagnóstico (aba Resultados) e DNA Editorial (Ajustes). Só lê o que o servidor já guardou: nada aqui chama a Meta.
// Regras: métrica ausente aparece como "—" com o motivo; amostra pequena vem avisada; nenhuma tela declara "vencedor".
(function () {
  const st = { seg: 'painel', de: '', ate: '', painel: null, diag: null, dna: null, dias: 30, carregando: false, carregandoDiag: false, erro: null, erroDna: null, salvandoDna: false, jaDna: false, abrirDiag: false };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const link = (u) => (typeof u === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(u) ? u : null);

  async function carregarPainel(ctx, dias) {
    if (st.carregando) return;
    if (dias) st.dias = dias;
    st.carregando = true; st.erro = null; ctx.render();
    try { st.painel = await ctx.api(st.dias === 'custom' && st.de && st.ate ? `/api/crescimento/painel?de=${encodeURIComponent(st.de)}&ate=${encodeURIComponent(st.ate)}` : `/api/crescimento/painel?dias=${st.dias === 'custom' ? 30 : st.dias}`); } catch (e) { st.erro = e.message || 'Não consegui abrir o painel de crescimento.'; }
    st.carregando = false; ctx.render();
  }
  async function carregarDiag(ctx) {
    if (st.carregandoDiag) return;
    st.carregandoDiag = true; ctx.render();
    try { st.diag = await ctx.api('/api/crescimento/diagnostico'); } catch (e) { st.erro = e.message || 'Não consegui montar o diagnóstico.'; }
    st.carregandoDiag = false; ctx.render();
  }

  const valorKpi = (k) => {
    if (!k.disponivel) return '<span class="cr-nd">—</span>';
    const v = `${num(k.valor, Number.isInteger(k.valor) ? 0 : 1)}${k.unidade ? ' ' + esc(k.unidade) : ''}`;
    const dv = k.variacao_pct == null ? '' : ` <small class="cr-var ${k.variacao_pct >= 0 ? 'cr-sobe' : 'cr-desce'}">${k.variacao_pct >= 0 ? '▲' : '▼'} ${Math.abs(k.variacao_pct)}%</small>`;
    return v + dv;
  };
  const cartaoKpi = (k) => `<div class="cr-kpi ${k.disponivel ? '' : 'cr-off'}"><div class="cr-k-rot">${esc(k.rotulo)}</div><div class="cr-k-val">${valorKpi(k)}</div>${!k.disponivel && k.motivo ? `<div class="cr-k-nota">${esc(k.motivo)}</div>` : k.nota ? `<div class="cr-k-nota">${esc(k.nota)}${k.n != null ? ` · ${num(k.n)} posts` : ''}</div>` : ''}</div>`;
  const lista = (titulo, itens, vazio) => `<div class="cr-bloco"><div class="es-label">${esc(titulo)}</div>${itens?.length ? `<ul class="ig-obs">${itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : `<div class="es-text ig-mudo">${esc(vazio)}</div>`}</div>`;
  const linhaPost = (p) => { const u = link(p.permalink); const t = esc(p.legenda || 'Sem legenda'); return `<li>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${t}</a>` : t} <span class="ig-mudo">· ${esc(p.tipo)} · ${num(p.resultado, 1)} envios+salvos/mil</span></li>`; };

  function blocoPainel() {
    const p = st.painel;
    const per = [7, 30, 90].map((d) => `<button data-action="cr-periodo" data-v="${d}" aria-pressed="${st.dias === d}" ${st.carregando ? 'disabled' : ''}>${d} dias</button>`).join('') + `<button data-action="cr-periodo" data-v="custom" aria-pressed="${st.dias === 'custom'}">Datas</button>`;
    let h = `<div class="es-card cr-painel"><div class="es-between"><div class="es-label">Growth Dashboard</div></div>
      <div class="es-days" style="grid-template-columns:repeat(4,1fr);margin:8px 0">${per}</div>
      ${st.dias === 'custom' ? `<div class="cr-datas"><input id="cr-de" class="es-input" type="date" value="${esc(st.de)}" aria-label="De"><input id="cr-ate" class="es-input" type="date" value="${esc(st.ate)}" aria-label="Até"><button class="es-btn sm" data-action="cr-custom">Ver</button></div>` : ''}`;
    if (st.erro) h += `<div class="es-warn">${esc(st.erro)}</div>`;
    if (!p) return h + `<div class="es-text ig-mudo">${st.carregando ? 'Abrindo o painel…' : 'Carregando…'}</div></div>`;
    if (p.vazio) return h + '<div class="es-text">Ainda não há posts lidos. Toque em <b>Atualizar números</b> abaixo para trazer os últimos 90 dias da Meta (só leitura).</div></div>';
    const d = p.decisao;
    h += `<div class="es-text ig-mudo">${num(p.posts.maduros)} posts maduros (mais de 72 h) de ${num(p.posts.total)} no período${p.anterior.comparavel ? ', comparados ao período anterior' : '; sem período anterior comparável'}. Dado lido ${esc(p.origem?.snapshot_em ? new Date(p.origem.snapshot_em).toLocaleString('pt-BR') : 'só do arquivo')}.</div>
      <div class="cr-decisao"><div class="cr-dec"><b>Principal aprendizado</b><span>${esc(d.aprendizado || '—')}</span></div>
      <div class="cr-dec"><b>Principal oportunidade</b><span>${esc(d.oportunidade || 'Ainda não há oportunidade com dado suficiente.')}</span></div>
      <div class="cr-dec cr-acao"><b>Próxima ação</b><span>${esc(d.proxima_acao || '—')}</span></div></div>
      ${lista('O que está funcionando', d.funciona, 'Nada se destaca com amostra suficiente (mínimo 5 posts por grupo).')}
      ${lista('O que não está funcionando', d.nao_funciona, 'Nada abaixo do esperado com amostra suficiente.')}
      <div class="es-label" style="margin-top:12px">Indicadores</div><div class="cr-grid">${p.kpis.map(cartaoKpi).join('')}</div>`;
    if (p.formatos?.length) h += `<div class="es-label" style="margin-top:12px">Por formato (medianas)</div><div class="ig-tabela-wrap"><table class="ig-tabela"><thead><tr><th></th><th>Posts</th><th>Alcance</th><th>Envios/mil</th><th>Salv./mil</th><th>Curt./mil</th></tr></thead><tbody>${p.formatos.map((f) => `<tr><th scope="row">${esc(f.rotulo)}${f.amostra !== 'suficiente' ? ` <span class="mz-chip warn">${f.amostra === 'indicio' ? 'indício' : 'amostra pequena'}</span>` : ''}</th><td>${num(f.n)}</td><td>${num(f.alcance)}</td><td>${num(f.envios_mil, 1)}</td><td>${num(f.salvos_mil, 1)}</td><td>${num(f.curtidas_mil, 1)}</td></tr>`).join('')}</tbody></table></div>`;
    if (p.melhores?.length) h += `<div class="es-label" style="margin-top:12px">Mais enviados e salvos</div><ul class="ig-obs">${p.melhores.map(linhaPost).join('')}</ul>`;
    if (p.frequencia) h += `<div class="es-label" style="margin-top:12px">Frequência (últimas 4 semanas)</div><ul class="ig-obs">${p.frequencia.leitura.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><div class="es-text ig-mudo">${esc(p.frequencia.nota)}</div>`;
    if (p.posts_recentes?.length) h += `<div class="es-label" style="margin-top:12px">Distribuição pós-publicação</div><ul class="ig-obs">${p.posts_recentes.slice(0, 8).map((x) => `<li>${esc((x.legenda || 'Sem legenda').slice(0, 70))} <span class="ig-mudo">· ${esc(x.tipo)}</span> <button class="es-btn ghost sm" data-action="cr-dist" data-id="${esc(x.id)}">Plano</button>${window.CrescHub ? window.CrescHub.distDe(x.id) : ''}</li>`).join('')}</ul>`;
    h += `<details class="ig-limites"><summary>Como ler</summary><ul><li>${esc(p.regras.medida)}.</li><li>Destaque = ${esc(p.regras.destaque)}; amostra mínima ${p.regras.amostra_minima} posts por grupo.</li><li>${esc(p.regras.tema)}</li><li>Isto descreve o que aconteceu; não prova a causa nem prevê viralização.</li></ul></details>`;
    return h + '</div>';
  }

  function blocoDiag() {
    const d = st.diag;
    let h = `<div class="es-card"><div class="es-label">Diagnóstico do posicionamento</div><div class="es-text">Compara o posicionamento antigo (A), a transição (B) e o atual (C), com as datas que você definiu em Ajustes → DNA Editorial.</div>
      <button class="es-btn ghost" style="margin-top:8px" data-action="cr-diag" ${st.carregandoDiag ? 'disabled' : ''}>${st.carregandoDiag ? 'Analisando…' : d ? 'Atualizar diagnóstico' : 'Gerar diagnóstico'}</button>`;
    if (!d) return h + '</div>';
    if (d.vazio && !d.configurado) return h + `<div class="es-text" style="margin-top:8px">${esc(d.instrucao || 'Sem dados.')}</div></div>`;
    if (!d.configurado) return h + `<div class="es-warn" style="margin-top:8px">${esc(d.instrucao)}</div></div>`;
    h += `<div class="ig-tabela-wrap" style="margin-top:8px"><table class="ig-tabela"><thead><tr><th></th><th>Posts</th><th>Alcance</th><th>Envios/mil</th><th>Salv./mil</th></tr></thead><tbody>${['A', 'B', 'C'].map((k) => { const x = d.periodos[k]; return `<tr><th scope="row">${k} · ${esc(x.rotulo)}${x.amostra !== 'suficiente' ? ` <span class="mz-chip warn">${x.amostra === 'indicio' ? 'indício' : 'amostra pequena'}</span>` : ''}</th><td>${num(x.n)}</td><td>${num(x.alcance)}</td><td>${num(x.envios_mil, 1)}</td><td>${num(x.salvos_mil, 1)}</td></tr>`; }).join('')}</tbody></table></div>`;
    const r = d.relatorio;
    h += lista('Principais forças', r.forcas, 'Nenhuma diferença confiável a favor do posicionamento atual ainda.') + lista('Principais fraquezas', r.fraquezas, 'Nenhuma fraqueza confiável identificada.') + lista('O que manter', r.manter, 'Ainda sem tema com amostra suficiente.') + lista('O que parar de fazer', r.parar, 'Nada a cortar com dado suficiente: reduzir só com evidência.') + lista('O que testar', r.testar, 'Sem lacunas de amostra.') + lista('Oportunidades', r.oportunidades, 'Nenhuma oportunidade com dado suficiente.') + lista('Plano dos próximos 30 dias', r.plano_30_dias, '');
    if (d.pilares?.distribuicao?.length) h += `<div class="es-label" style="margin-top:10px">Pilares: hipótese × o que foi publicado (período atual)</div><ul class="ig-obs">${d.pilares.distribuicao.map((x) => `<li>${esc(x.nome)}: hipótese ${num(x.hipotese_pct)}% · real ${x.real_pct == null ? '—' : num(x.real_pct) + '%'}</li>`).join('')}</ul><div class="es-text ig-mudo">${esc(d.pilares.nota)}</div>`;
    h += `<details class="ig-limites"><summary>Limites deste diagnóstico</summary><ul>${(d.limitacoes || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
    return h + '</div>';
  }

  const SEGS = [['painel', 'Painel'], ['diag', 'Diagnóstico'], ['criativo', 'Criativo'], ['audiencia', 'Audiência'], ['comunidade', 'Comunidade'], ['lab', 'Lab'], ['funil', 'Funil'], ['fila', 'Fila'], ['series', 'Séries']];
  function render() {
    const nav = `<nav class="cr-segs" aria-label="Crescimento">${SEGS.map(([k, r]) => `<button data-action="cr-seg" data-v="${k}" aria-pressed="${st.seg === k}">${r}</button>`).join('')}</nav>`;
    const corpo = st.seg === 'painel' ? blocoPainel() : st.seg === 'diag' ? blocoDiag() : window.CrescHub ? window.CrescHub.render(st.seg) : '';
    return `<div class="cr-hub"><div class="es-h1" style="margin-bottom:6px">Crescimento</div>${nav}${corpo}</div>`;
  }

  // ── DNA Editorial (Ajustes) ──
  async function carregarDna(ctx) {
    if (st.jaDna) return; st.jaDna = true;
    try { st.dna = await ctx.api('/api/crescimento/dna'); st.erroDna = null; } catch (e) { st.erroDna = e.message || 'Não consegui ler o DNA Editorial.'; }
    ctx.render();
  }
  async function salvarDna(ctx, patch, msg) {
    if (st.salvandoDna) return; st.salvandoDna = true; st.erroDna = null; ctx.render();
    try { const r = await ctx.api('/api/crescimento/dna', { method: 'PUT', body: patch }); st.dna = { ...st.dna, ...r }; ctx.toast(msg || 'DNA Editorial salvo.'); st.diag = null; } catch (e) { st.erroDna = e.message || 'Não consegui salvar.'; }
    st.salvandoDna = false; ctx.render();
  }
  function secaoDna() {
    const d = st.dna;
    if (!d) return `<div class="es-card"><div class="es-label">DNA Editorial</div><div class="es-text">${esc(st.erroDna || 'Carregando…')}</div></div>`;
    const tipos = d.tipos_banco || {};
    return `<div class="es-card"><div class="es-label">DNA Editorial</div>
      <div class="es-text">É o que a IA lê antes de escrever qualquer roteiro: posicionamento, promessa, voz e o que nunca dizer. A IA só usa o que está aqui e na pauta; nunca inventa opinião ou experiência sua.</div>
      ${st.erroDna ? `<div class="es-warn">${esc(st.erroDna)}</div>` : ''}
      <label class="es-label" for="dna-pos" style="margin-top:10px">Posicionamento</label><textarea id="dna-pos" class="es-input" rows="3">${esc(d.posicionamento)}</textarea>
      <label class="es-label" for="dna-pro" style="margin-top:10px">Promessa</label><textarea id="dna-pro" class="es-input" rows="2">${esc(d.promessa)}</textarea>
      <label class="es-label" for="dna-proib" style="margin-top:10px">Expressões proibidas (uma por linha)</label><textarea id="dna-proib" class="es-input" rows="4">${esc((d.expressoes_proibidas || []).join('\n'))}</textarea>
      <div class="es-text ig-mudo" style="margin-top:6px">Personalidade: ${esc((d.personalidade || []).join(', '))}.</div>
      <div class="es-label" style="margin-top:10px">Pilares em teste (hipóteses, somam 100%)</div>
      <ul class="ig-obs">${(d.pilares || []).map((p) => `<li>${esc(p.nome)} — <input class="es-input cr-pct" data-pilar="${esc(p.id)}" type="number" min="0" max="100" value="${esc(p.pct)}" aria-label="Percentual de ${esc(p.nome)}"> %</li>`).join('')}</ul>
      <div class="es-label" style="margin-top:10px">Séries</div>
      <ul class="ig-obs">${(d.series || []).map((s) => `<li><b>${esc(s.nome)}</b>: ${esc(s.objetivo)}</li>`).join('')}</ul>
      <div class="es-label" style="margin-top:10px">Datas da transição (para o diagnóstico)</div>
      <label class="es-label" for="dna-b">A transição começou em</label><input id="dna-b" class="es-input" type="date" value="${esc(d.transicao?.inicio_b || '')}">
      <label class="es-label" for="dna-c" style="margin-top:6px">O novo posicionamento passou a valer em</label><input id="dna-c" class="es-input" type="date" value="${esc(d.transicao?.inicio_c || '')}">
      <button class="es-btn" style="margin-top:10px" data-action="dna-salvar" ${st.salvandoDna ? 'disabled' : ''}>${st.salvandoDna ? 'Salvando…' : 'Salvar DNA Editorial'}</button>
      ${d.guardada === false ? '<div class="es-warn">Sem banco de dados no servidor, este DNA não fica guardado.</div>' : ''}
      <div class="es-label" style="margin-top:14px">Banco de personalidade</div>
      <div class="es-text ig-mudo">Suas opiniões, experiências, aprendizados, erros, conquistas e frases, do jeito que você diz. As histórias e casos completos continuam em “Minhas histórias e casos”.</div>
      <select id="dna-tipo" class="es-input" style="margin-top:6px">${Object.entries(tipos).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select>
      <textarea id="dna-texto" class="es-input" rows="3" placeholder="Escreva com as suas palavras (mínimo 20 caracteres)" style="margin-top:6px"></textarea>
      <button class="es-btn ghost" style="margin-top:6px" data-action="dna-add" ${st.salvandoDna ? 'disabled' : ''}>Guardar no banco</button>
      ${(d.banco || []).length ? `<ul class="ig-obs">${d.banco.slice(0, 12).map((b) => `<li><b>${esc(tipos[b.tipo] || b.tipo)}:</b> ${esc(b.texto.slice(0, 160))} <button class="es-btn ghost sm" data-action="dna-del" data-id="${esc(b.id)}">Apagar</button></li>`).join('')}</ul>` : '<div class="es-text ig-mudo">Vazio: a IA não vai citar nenhuma opinião ou vivência sua.</div>'}
    </div>`;
  }

  async function acao(a, el, ctx) {
    if (a === 'cr-periodo') { if (el.dataset.v === 'custom') { st.dias = 'custom'; ctx.render(); return true; } await carregarPainel(ctx, Number(el.dataset.v)); return true; }
    if (a === 'cr-custom') { st.de = document.getElementById('cr-de')?.value || ''; st.ate = document.getElementById('cr-ate')?.value || ''; if (!st.de || !st.ate) { ctx.toast('Escolha as duas datas.'); return true; } await carregarPainel(ctx); return true; }
    if (a === 'cr-seg') { st.seg = el.dataset.v; ctx.render(); if (st.seg === 'diag' && !st.diag) await carregarDiag(ctx); else if (window.CrescHub) await window.CrescHub.carregar(st.seg, ctx); return true; }
    if (window.CrescHub && await window.CrescHub.acao(a, el, ctx)) return true;
    if (a === 'cr-diag') { await carregarDiag(ctx); return true; }
    if (a === 'dna-salvar') {
      const v = (id) => document.getElementById(id)?.value ?? '';
      const pilares = (st.dna?.pilares || []).map((p) => ({ ...p, pct: Number(document.querySelector(`[data-pilar="${p.id}"]`)?.value) }));
      await salvarDna(ctx, { posicionamento: v('dna-pos'), promessa: v('dna-pro'), expressoes_proibidas: v('dna-proib').split('\n').map((x) => x.trim()).filter(Boolean), pilares, transicao: { inicio_b: v('dna-b') || null, inicio_c: v('dna-c') || null } });
      return true;
    }
    if (a === 'dna-add') {
      if (st.salvandoDna) return true; st.salvandoDna = true; st.erroDna = null; ctx.render();
      try { const r = await ctx.api('/api/crescimento/dna/banco', { method: 'POST', body: { tipo: document.getElementById('dna-tipo')?.value, texto: document.getElementById('dna-texto')?.value } }); st.dna = { ...st.dna, ...r }; ctx.toast('Guardado no banco de personalidade.'); } catch (e) { st.erroDna = e.message || 'Não consegui guardar.'; }
      st.salvandoDna = false; ctx.render(); return true;
    }
    if (a === 'dna-del') {
      try { st.dna = { ...st.dna, ...(await ctx.api(`/api/crescimento/dna/banco/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' })) }; } catch (e) { st.erroDna = e.message || 'Não consegui apagar.'; }
      ctx.render(); return true;
    }
    return false;
  }
  async function carregar(ctx) { if (!st.painel && !st.carregando) await carregarPainel(ctx); }

  window.Crescimento = { render, secaoDna, acao, carregar, carregarDna, _st: st };
})();
