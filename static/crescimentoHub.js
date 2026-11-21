// Abas do hub Crescimento (o Painel e o Diagnóstico ficam em static/crescimento.js): Estratégia criativa, Audiência, Comunidade,
// Growth Lab, Funil, Fila por prioridade, Séries e o plano de Distribuição por post. Nada é publicado daqui; a única ação externa
// é enviar UMA resposta de comentário aprovada, com confirmação.
(function () {
  const st = { dados: {}, carregando: {}, erro: {}, dist: {}, criAberta: null, ocupado: false, labPosts: { a: new Set(), b: new Set() } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const v = (id) => document.getElementById(id)?.value ?? '';
  const card = (titulo, corpo) => `<div class="es-card"><div class="es-label">${esc(titulo)}</div>${corpo}</div>`;
  const ROTA = { criativo: '/api/crescimento/criativo', audiencia: '/api/crescimento/audiencia', comunidade: '/api/crescimento/comunidade', lab: '/api/crescimento/lab', funil: '/api/crescimento/funil', fila: '/api/crescimento/prioridades', series: '/api/crescimento/series' };

  async function carregar(seg, ctx, forcar = false) {
    if (seg === 'criativo') window.Crescimento?.carregarDna(ctx);
    if (!ROTA[seg] || st.carregando[seg] || (st.dados[seg] && !forcar)) return;
    st.carregando[seg] = true; st.erro[seg] = null; ctx.render();
    try { st.dados[seg] = await ctx.api(ROTA[seg]); } catch (e) { st.erro[seg] = e.message || 'Não consegui abrir.'; }
    st.carregando[seg] = false; ctx.render();
  }
  async function chamar(ctx, url, { method = 'POST', body = {}, recarregar = null, ok = null } = {}) {
    if (st.ocupado) return null; st.ocupado = true; ctx.render();
    let r = null;
    try { r = await ctx.api(url, { method, body }); if (ok) ctx.toast(ok); if (r?.aviso) ctx.toast(r.aviso); } catch (e) { ctx.toast(e.message || 'Não deu certo.'); }
    st.ocupado = false;
    if (recarregar) await carregar(recarregar, ctx, true); else ctx.render();
    return r;
  }
  const topo = (seg, texto) => `${st.erro[seg] ? `<div class="es-warn">${esc(st.erro[seg])}</div>` : ''}${!st.dados[seg] ? `<div class="es-text ig-mudo">${st.carregando[seg] ? 'Abrindo…' : esc(texto || 'Carregando…')}</div>` : ''}`;
  const dis = () => (st.ocupado ? 'disabled' : '');

  // ── Estratégia criativa ──
  function criativo() {
    const d = st.dados.criativo;
    let h = card('Estratégia criativa', `<div class="es-text">Antes de produzir: contexto, audiência, 5 ângulos, formatos, 10+ ganchos e um score comparativo (não é previsão de viralização). Você aprova, edita, combina ou descarta.</div>
      <textarea id="cri-pauta" class="es-input" rows="4" placeholder="Cole a notícia, o fato ou a ideia (é a única fonte de fatos)" style="margin-top:8px"></textarea>
      <button class="es-btn" style="margin-top:8px" data-action="cri-gerar" ${dis()}>${st.ocupado ? 'Pensando…' : 'Gerar estratégia'}</button>`) + topo('criativo');
    if (!d) return h;
    const abertas = (d.estrategias || []).filter((e) => ['aberta', 'aprovada'].includes(e.estado)).slice(0, 8);
    if (!abertas.length) return h + '<div class="es-text ig-mudo">Nenhuma estratégia ainda.</div>';
    for (const e of abertas) {
      const r = e.resultado; const aberta = st.criAberta === e.id;
      h += `<div class="es-card"><div class="es-between"><b>${esc(e.pauta.slice(0, 90))}</b><span class="mz-chip ${e.estado === 'aprovada' ? 'ok' : 'neutro'}">${e.estado === 'aprovada' ? 'aprovada' : 'aberta'}</span></div>
        <button class="es-btn ghost sm" data-action="cri-abrir" data-id="${esc(e.id)}">${aberta ? 'Fechar' : 'Ver estratégia'}</button>`;
      if (aberta) {
        const c = r.contexto || {}; const au = r.audiencia || {};
        h += `<div class="es-label" style="margin-top:8px">Contexto</div><ul class="ig-obs">${[['O que aconteceu', c.o_que], ['Por que importa', c.por_que_importa], ['Quem é afetado', c.quem_afetado], ['Tensão', c.tensao], ['Impacto', c.impacto], ['Surpresa', c.surpresa]].map(([k, x]) => `<li><b>${k}:</b> ${esc(x || '—')}</li>`).join('')}</ul>
          <div class="es-label">Audiência</div><div class="es-text">${esc(au.principal || '—')} · secundário: ${esc(au.secundario || '—')} · conhecimento ${esc(au.conhecimento || '—')} · problema: ${esc(au.problema || '—')}</div>
          <div class="es-label" style="margin-top:8px">Ângulos</div><ul class="ig-obs">${(r.angulos || []).map((a) => `<li><b>${esc(a.rotulo)}</b> (${a.score ?? '—'}/100): ${esc(a.titulo)} — ${esc(a.ideia)}${a.precisa_opiniao_do_pedro ? ' <span class="mz-chip warn">precisa da sua opinião</span>' : ''}</li>`).join('')}</ul>
          <div class="es-label">Formatos</div><div class="es-text">${(r.formatos || []).map((f) => `${esc(f.rotulo)} ${num(f.nota)}/10`).join(' · ')}</div>
          <div class="es-label" style="margin-top:8px">Ganchos (${(r.ganchos || []).length})</div><ul class="ig-obs">${(r.ganchos || []).map((g) => `<li>${esc(g.texto)} <span class="ig-mudo">· ${esc(g.tipo || '')}</span></li>`).join('')}</ul>
          ${(r.avisos || []).map((a) => `<div class="es-warn">${esc(a)}</div>`).join('')}
          <div class="es-label" style="margin-top:8px">As 3 melhores opções</div>`;
        for (const o of r.opcoes || []) {
          h += `<div class="cr-opcao"><div class="es-between"><b>${o.n}. ${esc(o.titulo)}</b><span class="cr-score">${o.score ?? '—'}</span></div><div class="es-text">${esc(o.ideia)}</div><div class="es-text ig-mudo">Gancho: ${esc(o.gancho || '—')} · ${esc(d.formatos?.[o.formato] || o.formato)} · objetivo ${esc(o.objetivo)}</div>
            ${e.estado === 'aberta' ? `<label class="es-label" for="cri-g-${e.id}-${o.n}">Gancho (edite se quiser)</label><input id="cri-g-${e.id}-${o.n}" class="es-input" value="${esc(o.gancho || '')}">
            ${o.precisa_opiniao_do_pedro ? `<label class="es-label" for="cri-op-${e.id}-${o.n}">Sua opinião (obrigatória para este ângulo)</label><textarea id="cri-op-${e.id}-${o.n}" class="es-input" rows="2"></textarea>` : ''}
            <div class="cr-acoes"><button class="es-btn sm" data-action="cri-aprovar" data-id="${esc(e.id)}" data-n="${o.n}" ${dis()}>Aprovar</button></div>` : ''}</div>`;
        }
        if (e.estado === 'aberta') h += `<div class="cr-acoes" style="margin-top:8px"><select id="cri-serie-${e.id}" class="es-input" aria-label="Série"><option value="">Sem série</option>${(window.Crescimento?._st?.dna?.series || []).map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('')}</select>
          <button class="es-btn ghost sm" data-action="cri-novas" data-id="${esc(e.id)}" ${dis()}>Gerar novas opções</button>
          <button class="es-btn ghost sm" data-action="cri-combinar" data-id="${esc(e.id)}" ${dis()}>Combinar os 2 melhores ângulos</button>
          <button class="es-btn ghost sm" data-action="cri-descartar" data-id="${esc(e.id)}" ${dis()}>Descartar</button></div>`;
        else if (e.escolha) h += `<div class="es-text" style="margin-top:8px"><b>Aprovada:</b> ${esc(e.escolha.titulo)} · ${esc(e.escolha.formato)}. ${e.escolha.formato === 'reel' ? 'Vai para os roteiros de Reel (aba Vídeos) como prioridade.' : 'O carrossel sai pelo Criar e aparece em Aprovar.'}</div>`;
      }
      h += '</div>';
    }
    return h;
  }

  // ── Audiência ──
  function audiencia() {
    const d = st.dados.audiencia; let h = topo('audiencia');
    if (!d) return h;
    h += card('Inteligência de audiência', `<div class="es-text">${num(d.considerados)} comentários reais analisados (${num(d.spam)} spam fora). Leia os comentários na aba Comunidade para alimentar esta análise.</div>${(d.fontes_indisponiveis || []).map((f) => `<div class="es-text ig-mudo">${esc(f)}</div>`).join('')}
      <button class="es-btn ghost sm" style="margin-top:8px" data-action="aud-demo" ${dis()}>Ler dados demográficos da Meta</button>`);
    if (d.demografia) h += card('Demografia (Meta)', Object.entries(d.demografia.cortes || {}).map(([k, xs]) => `<div class="es-text"><b>${{ age: 'Idade', gender: 'Gênero', city: 'Cidade' }[k] || k}:</b> ${xs.slice(0, 5).map((x) => `${esc(x.valor)} ${num(x.n)}`).join(' · ')}</div>`).join('') + (d.demografia.erros || []).map((e) => `<div class="es-text ig-mudo">${esc(e)}</div>`).join(''));
    if (!d.considerados) return h + '<div class="es-text ig-mudo">Sem comentários lidos: nada para mostrar (nada é simulado).</div>';
    if (d.sugestoes?.length) h += card('Oportunidades (score comparativo)', d.sugestoes.map((s) => `<div class="cr-item"><div class="es-between"><b>${esc(s.tema)}</b><span class="cr-score">${s.score}</span></div><div class="es-text"><b>Evidência:</b> ${esc(s.evidencia)}</div><div class="es-text"><b>Problema:</b> ${esc(s.problema)} · <b>Público:</b> ${esc(s.publico)}</div><div class="es-text"><b>Ângulo:</b> ${esc(s.angulo)}</div><div class="es-text ig-mudo">Formato: ${esc(s.formato)} · objetivo: ${esc(s.objetivo)} · ${esc(s.justificativa)}</div><button class="es-btn ghost sm" data-action="aud-criativo" data-t="${esc(`${s.tema}: ${s.angulo} Evidência: ${s.evidencia}`)}" ${dis()}>Levar para a Estratégia criativa</button></div>`).join('') + `<div class="es-text ig-mudo">${esc(d.regras.score)}</div>`);
    const r = d.radar || {};
    const lis = (t, xs, f) => (xs?.length ? `<div class="es-label" style="margin-top:8px">${t}</div><ul class="ig-obs">${xs.map(f).join('')}</ul>` : '');
    h += card('Radar de audiência', lis('Perguntas frequentes', r.perguntas_frequentes, (g) => `<li>${esc(g.exemplo)} <span class="ig-mudo">(${g.n}×)</span></li>`) + lis('Dores recorrentes', r.dores_recorrentes, (g) => `<li>${esc(g.exemplo)} <span class="ig-mudo">(${g.n}×)</span></li>`) + lis('Interesses crescentes', r.crescentes, (x) => `<li>${esc(x.nome)}: +${x.crescimento_pct}% em 14 dias</li>`) + lis('Assuntos saturados', r.saturados, (x) => `<li>${esc(x.nome)}: envios ${x.potencial_compartilhamento}× a mediana em ${x.posts} posts</li>`) + lis('Temas controversos', r.controversos, (x) => `<li>${esc(x.nome)}</li>`) + lis('Temas que constroem comunidade', r.comunidade, (x) => `<li>${esc(x.nome)}: ${x.classes.historia} histórias</li>`) || '<div class="es-text ig-mudo">Ainda sem padrões com dado suficiente.</div>');
    h += card('Por tema', `<div class="ig-tabela-wrap"><table class="ig-tabela"><thead><tr><th></th><th>Coment.</th><th>/sem</th><th>Cresc.</th><th>Sentim. +/−</th><th>Envios×</th></tr></thead><tbody>${d.categorias.map((c) => `<tr><th scope="row">${esc(c.nome)}${c.amostra === 'pequena' ? ' <span class="mz-chip warn">pouco</span>' : ''}</th><td>${num(c.volume)}</td><td>${num(c.por_semana, 1)}</td><td>${c.crescimento_pct == null ? '—' : num(c.crescimento_pct) + '%'}</td><td>${num(c.sentimento.positivo)}/${num(c.sentimento.negativo)}</td><td>${c.potencial_compartilhamento == null ? '—' : num(c.potencial_compartilhamento, 2)}</td></tr>`).join('')}</tbody></table></div>`);
    return h;
  }

  // ── Comunidade ──
  function comunidade() {
    const d = st.dados.comunidade; let h = card('Comunidade', `<div class="es-text">Comentários reais dos seus posts, classificados. A IA sugere resposta só quando você pede; nada é enviado sem você aprovar e confirmar.</div>
      <button class="es-btn" style="margin-top:8px" data-action="com-ler" ${dis()}>${st.ocupado ? 'Lendo…' : 'Ler comentários agora'}</button>${d?.ler_em ? `<div class="es-text ig-mudo">Última leitura: ${esc(new Date(d.ler_em).toLocaleString('pt-BR'))}</div>` : ''}`) + topo('comunidade');
    if (!d) return h;
    const R = d.resumo; h += `<div class="es-text">${num(R.total)} comentários · <b>${num(R.pendentes)}</b> pedem resposta · ${Object.entries(R.por_classe || {}).map(([k, n]) => `${esc(d.classes[k] || k)} ${n}`).join(' · ')}</div>`;
    const lista = (d.comentarios || []).filter((c) => c.classe !== 'spam' && !['descartado'].includes(c.estado)).slice(0, 40);
    if (!lista.length) return h + '<div class="es-text ig-mudo">Nenhum comentário lido ainda.</div>';
    h += '<div class="es-card">' + lista.map((c) => `<div class="cr-item"><div class="es-between"><span class="mz-chip neutro">${esc(d.classes[c.classe] || c.classe)}</span><span class="ig-mudo">${esc(c.estado)}</span></div>
      <div class="es-text">“${esc(c.texto)}”</div><div class="es-text ig-mudo">em: ${esc(c.legenda_post || '')}</div>
      ${c.resposta ? `<label class="es-label" for="com-r-${esc(c.id)}">Resposta (${esc(c.resposta.tom || '')}; ${esc(c.resposta.recomendacao || '')})</label><textarea id="com-r-${esc(c.id)}" class="es-input" rows="2">${esc(c.resposta.texto)}</textarea>${c.resposta.pauta ? `<div class="es-text ig-mudo">Rende conteúdo (${esc(c.resposta.potencial_conteudo || '—')}): ${esc(c.resposta.pauta)}</div>` : ''}` : ''}
      <div class="cr-acoes">${c.estado !== 'respondido' ? `${!c.resposta ? `<button class="es-btn ghost sm" data-action="com-sugerir" data-id="${esc(c.id)}" ${dis()}>Sugerir resposta</button>` : `<button class="es-btn sm" data-action="com-aprovar" data-id="${esc(c.id)}" ${dis()}>${c.resposta.aprovada ? 'Salvar edição' : 'Aprovar'}</button>`}${c.resposta?.aprovada ? `<button class="es-btn sm" data-action="com-enviar" data-id="${esc(c.id)}" ${dis()}>Enviar no Instagram</button>` : ''}` : '<span class="ig-mudo">Respondido</span>'}
      ${!c.virou_pauta ? `<button class="es-btn ghost sm" data-action="com-pauta" data-id="${esc(c.id)}" ${dis()}>Virar pauta</button>` : '<span class="ig-mudo">Virou pauta</span>'}<button class="es-btn ghost sm" data-action="com-descartar" data-id="${esc(c.id)}" ${dis()}>Descartar</button></div></div>`).join('') + '</div>';
    return h;
  }

  // ── Growth Lab ──
  function lab() {
    const d = st.dados.lab; let h = topo('lab'); if (!d) return h;
    const opts = (o) => Object.entries(o).map(([k, r]) => `<option value="${esc(k)}">${esc(r)}</option>`).join('');
    h += card('Novo experimento', `<div class="es-text">Uma variável por vez. Marque os posts REAIS de cada grupo; sem a amostra mínima, não há conclusão.</div>
      <input id="lab-nome" class="es-input" placeholder="Nome (ex.: Rosto nos 3 primeiros segundos)" style="margin-top:6px">
      <textarea id="lab-hip" class="es-input" rows="2" placeholder="Hipótese: o que você espera e por quê" style="margin-top:6px"></textarea>
      <select id="lab-var" class="es-input" style="margin-top:6px" aria-label="Variável">${opts(d.variaveis)}</select>
      <select id="lab-ind" class="es-input" style="margin-top:6px" aria-label="Indicador principal">${opts(d.indicadores)}</select>
      <div class="cr-datas" style="grid-template-columns:1fr 1fr"><input id="lab-da" class="es-input" placeholder="Grupo A (ex.: com rosto)"><input id="lab-db" class="es-input" placeholder="Grupo B (ex.: sem rosto)"></div>
      <label class="es-label" for="lab-min">Amostra mínima por grupo</label><input id="lab-min" class="es-input" type="number" min="3" max="30" value="5">
      <div class="es-label" style="margin-top:8px">Posts (marque A ou B)</div>
      <ul class="ig-obs">${(d.posts || []).slice(0, 30).map((p) => `<li>${esc((p.legenda || 'Sem legenda').slice(0, 60))} <span class="ig-mudo">· ${esc(p.tipo)}${p.maduro ? '' : ' · ainda acumulando'}</span> <button class="es-btn ${st.labPosts.a.has(p.id) ? '' : 'ghost'} sm" data-action="lab-marca" data-g="a" data-id="${esc(p.id)}">A</button><button class="es-btn ${st.labPosts.b.has(p.id) ? '' : 'ghost'} sm" data-action="lab-marca" data-g="b" data-id="${esc(p.id)}">B</button></li>`).join('') || '<li>Sem posts lidos: atualize os números em Resultados.</li>'}</ul>
      <button class="es-btn" data-action="lab-criar" ${dis()}>Criar experimento</button>`);
    for (const e of d.experimentos || []) {
      const r = e.resultado;
      h += card(e.nome, `<div class="es-text"><b>Hipótese:</b> ${esc(e.hipotese)}</div><div class="es-text ig-mudo">${esc(d.variaveis[e.variavel])} · ${esc(d.indicadores[e.indicador])} · amostra mínima ${e.amostra_minima} · ${esc(e.status)}</div>
        <div class="es-text" style="margin-top:6px"><b>${{ amostra_insuficiente: 'Amostra insuficiente', inconclusivo: 'Inconclusivo', indicio_a: 'Indício: grupo A', indicio_b: 'Indício: grupo B' }[r.veredito]}</b> — ${esc(r.texto)}</div>
        ${(r.avisos || []).map((a) => `<div class="es-warn">${esc(a)}</div>`).join('')}
        ${(e.decisoes || []).length ? `<ul class="ig-obs">${e.decisoes.map((x) => `<li>${esc(new Date(x.em).toLocaleDateString('pt-BR'))}: ${esc(x.texto)}</li>`).join('')}</ul>` : ''}
        <input id="lab-dec-${esc(e.id)}" class="es-input" placeholder="Registrar decisão" style="margin-top:6px">
        <div class="cr-acoes"><button class="es-btn ghost sm" data-action="lab-decidir" data-id="${esc(e.id)}" ${dis()}>Registrar</button>${d.status.filter((s) => s !== e.status).map((s) => `<button class="es-btn ghost sm" data-action="lab-status" data-id="${esc(e.id)}" data-v="${s}" ${dis()}>${esc(s)}</button>`).join('')}<button class="es-btn ghost sm" data-action="lab-apagar" data-id="${esc(e.id)}" ${dis()}>Apagar</button></div>`);
    }
    return h;
  }

  // ── Funil ──
  function funil() {
    const d = st.dados.funil; let h = topo('funil'); if (!d) return h;
    const R = d.resumo; const est = ['lead', 'diagnostico', 'proposta', 'cliente'];
    h += card(`Funil (últimos ${d.dias} dias)`, `<div class="es-text ig-mudo">Descoberta → Seguidor → Relacionamento → Interesse vêm das métricas (Painel). Daqui para baixo, você registra.</div>
      <div class="cr-grid">${est.map((e) => `<div class="cr-kpi"><div class="cr-k-rot">${esc(d.estagios[e])}</div><div class="cr-k-val">${num(R.contagem[e])}</div></div>`).join('')}</div>
      <div class="es-text">Lead → diagnóstico ${R.taxas.lead_diagnostico == null ? '—' : R.taxas.lead_diagnostico + '%'} · diagnóstico → proposta ${R.taxas.diagnostico_proposta == null ? '—' : R.taxas.diagnostico_proposta + '%'} · proposta → cliente ${R.taxas.proposta_cliente == null ? '—' : R.taxas.proposta_cliente + '%'}${R.receita ? ` · receita R$ ${num(R.receita, 2)}` : ''}</div>`);
    h += card('Sequência editorial', `<div class="es-text">${esc(d.sequencia.recomendacao)}</div><div class="es-text ig-mudo">Descoberta não recebe CTA comercial.</div>`);
    h += card('Registrar lead', `<div class="es-text ig-mudo">Só um apelido: não guarde CPF, telefone ou e-mail aqui.</div>
      <input id="fu-nome" class="es-input" placeholder="Apelido (ex.: Loja de roupas de Goiânia)" style="margin-top:6px">
      <select id="fu-origem" class="es-input" style="margin-top:6px" aria-label="Origem">${Object.entries(d.origens).map(([k, r]) => `<option value="${esc(k)}">${esc(r)}</option>`).join('')}</select>
      <input id="fu-palavra" class="es-input" placeholder="Palavra-chave (se veio de isca)" style="margin-top:6px">
      <button class="es-btn" style="margin-top:8px" data-action="fu-criar" ${dis()}>Registrar</button>`);
    if (d.leads?.length) h += card('Leads', d.leads.slice(0, 40).map((l) => `<div class="cr-item"><div class="es-between"><b>${esc(l.nome)}</b><span class="mz-chip neutro">${esc(d.estagios[l.estagio])}</span></div><div class="es-text ig-mudo">${esc(d.origens[l.origem])}${l.palavra ? ` · ${esc(l.palavra)}` : ''} · ${esc(new Date(l.criado_em).toLocaleDateString('pt-BR'))}</div><div class="cr-acoes">${Object.keys(d.estagios).filter((e) => e !== l.estagio).map((e) => `<button class="es-btn ghost sm" data-action="fu-mover" data-id="${esc(l.id)}" data-v="${e}" ${dis()}>${esc(d.estagios[e])}</button>`).join('')}</div></div>`).join(''));
    return h;
  }

  // ── Fila por prioridade ──
  function fila() {
    const d = st.dados.fila; let h = topo('fila'); if (!d) return h;
    h += card('Prioridade da fila de aprovação', `<div class="es-text">Ordem estratégica, não de chegada: audiência comprovada ${d.pesos.audiencia_comprovada}, oportunidade ${d.pesos.oportunidade}, original ${d.pesos.original}, série ${d.pesos.serie}, posicionamento ${d.pesos.posicionamento}, funil ${d.pesos.funil}. Não publique só porque está pronto.</div>${d.frequencia.leitura.map((t) => `<div class="es-text ig-mudo">${esc(t)}</div>`).join('')}`);
    if (!d.fila.length) return h + '<div class="es-text ig-mudo">Nada esperando aprovação.</div>';
    return h + `<div class="es-card">${d.fila.map((c) => `<div class="cr-item"><div class="es-between"><b>${esc(c.titulo || c.id)}</b><span class="cr-score">${c.prioridade.score}</span></div><ul class="ig-obs">${c.prioridade.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul><div class="es-text ig-mudo">${esc(c.formato || '')}${c.objetivo ? ` · ${esc(c.objetivo)}` : ''}${c.serie ? ` · série ${esc(c.serie)}` : ''}</div></div>`).join('')}</div>`;
  }

  // ── Séries ──
  function series() {
    const d = st.dados.series; let h = topo('series'); if (!d) return h;
    return h + d.series.map((s) => card(s.nome, `<div class="es-text">${esc(s.objetivo)}</div><div class="es-text ig-mudo">Público: ${esc(s.publico || '—')} · formatos: ${esc((s.formatos || []).join(', '))}</div>
      <div class="es-text" style="margin-top:6px"><b>Episódios marcados:</b> ${num(s.episodios.length)} · publicados e medidos: ${num(s.desempenho.n)}${s.desempenho.n ? ` · envios/mil ${num(s.desempenho.envios_mil, 1)} (perfil: ${num(d.geral.envios_mil, 1)})` : ''}${s.desempenho.amostra !== 'suficiente' && s.desempenho.n ? ' · amostra pequena' : ''}</div>
      ${s.episodios.length ? `<ul class="ig-obs">${s.episodios.slice(0, 6).map((e) => `<li>${esc(e.titulo)} <span class="ig-mudo">· ${esc(e.status || '')}</span></li>`).join('')}</ul>` : '<div class="es-text ig-mudo">Nenhum conteúdo marcado com esta série. Escolha a série ao aprovar na Estratégia criativa.</div>'}
      ${(s.proximos || []).length ? `<div class="es-label">Próximos episódios</div><ul class="ig-obs">${s.proximos.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}`)).join('');
  }

  function distDe(id) {
    const p = st.dist[id]; if (!p) return '';
    if (p.erro) return `<div class="cr-dist">${esc(p.erro)}</div>`;
    return `<div class="cr-dist"><b>${esc(p.desempenho.leitura)}</b><div>Comentários: ${num(p.comentarios.total)} (${num(p.comentarios.pendentes)} pedem resposta)</div><ul class="ig-obs">${p.proximos_passos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="es-label">Stories</div><ul class="ig-obs">${p.stories.map((s) => `<li>${esc(s.texto)} <span class="ig-mudo">(${esc(s.quando)})</span></li>`).join('')}</ul><div class="es-label">Reaproveitar</div><ul class="ig-obs">${p.reaproveitar.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="ig-mudo">${esc(p.colaboracao)}</div></div>`;
  }

  function render(seg) {
    if (seg === 'criativo') return criativo(); if (seg === 'audiencia') return audiencia(); if (seg === 'comunidade') return comunidade();
    if (seg === 'lab') return lab(); if (seg === 'funil') return funil(); if (seg === 'fila') return fila(); if (seg === 'series') return series();
    return '';
  }

  async function acao(a, el, ctx) {
    const id = el.dataset.id;
    switch (a) {
      case 'cr-dist': if (st.dist[id]) { delete st.dist[id]; ctx.render(); return true; } try { st.dist[id] = await ctx.api(`/api/crescimento/distribuicao/${encodeURIComponent(id)}`); } catch (e) { st.dist[id] = { erro: e.message }; } ctx.render(); return true;
      case 'cri-gerar': { const r = await chamar(ctx, '/api/crescimento/criativo', { body: { pauta: v('cri-pauta') }, recarregar: 'criativo', ok: 'Estratégia pronta.' }); if (r?.id) { st.criAberta = r.id; ctx.render(); } return true; }
      case 'cri-abrir': st.criAberta = st.criAberta === id ? null : id; ctx.render(); return true;
      case 'cri-aprovar': { const n = Number(el.dataset.n); await chamar(ctx, `/api/crescimento/criativo/${id}/acao`, { body: { acao: 'aprovar', opcao: n, edicao: { gancho: v(`cri-g-${id}-${n}`), opiniao: v(`cri-op-${id}-${n}`) }, serie: v(`cri-serie-${id}`) || null }, recarregar: 'criativo', ok: 'Aprovada.' }); return true; }
      case 'cri-novas': { const r = await chamar(ctx, `/api/crescimento/criativo/${id}/acao`, { body: { acao: 'novas' }, recarregar: 'criativo', ok: 'Novas opções geradas.' }); if (r?.id) { st.criAberta = r.id; ctx.render(); } return true; }
      case 'cri-combinar': { const e = (st.dados.criativo?.estrategias || []).find((x) => x.id === id); const dois = [...(e?.resultado?.angulos || [])].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 2).map((x) => x.tipo); await chamar(ctx, `/api/crescimento/criativo/${id}/acao`, { body: { acao: 'combinar', combinar: dois }, recarregar: 'criativo', ok: 'Opção combinada criada.' }); return true; }
      case 'cri-descartar': await chamar(ctx, `/api/crescimento/criativo/${id}/acao`, { body: { acao: 'descartar' }, recarregar: 'criativo' }); return true;
      case 'aud-demo': await chamar(ctx, '/api/crescimento/audiencia/demografia', { recarregar: 'audiencia', ok: 'Demografia lida.' }); return true;
      case 'aud-criativo': { if (window.Crescimento?._st) window.Crescimento._st.seg = 'criativo'; await carregar('criativo', ctx); const t = document.getElementById('cri-pauta'); if (t) t.value = el.dataset.t || ''; ctx.render(); setTimeout(() => { const x = document.getElementById('cri-pauta'); if (x && !x.value) x.value = el.dataset.t || ''; }, 50); return true; }
      case 'com-ler': await chamar(ctx, '/api/crescimento/comunidade/ler', { recarregar: 'comunidade', ok: 'Comentários lidos.' }); return true;
      case 'com-sugerir': await chamar(ctx, `/api/crescimento/comunidade/${encodeURIComponent(id)}/sugerir`, { recarregar: 'comunidade' }); return true;
      case 'com-aprovar': await chamar(ctx, `/api/crescimento/comunidade/${encodeURIComponent(id)}/acao`, { body: { acao: 'aprovar', texto: v(`com-r-${id}`) }, recarregar: 'comunidade', ok: 'Resposta aprovada.' }); return true;
      case 'com-enviar': if (!window.confirm('Enviar esta resposta no Instagram agora?')) return true; await chamar(ctx, `/api/crescimento/comunidade/${encodeURIComponent(id)}/enviar`, { body: { confirmar: true }, recarregar: 'comunidade', ok: 'Resposta enviada.' }); return true;
      case 'com-pauta': await chamar(ctx, `/api/crescimento/comunidade/${encodeURIComponent(id)}/acao`, { body: { acao: 'pauta' }, recarregar: 'comunidade', ok: 'Virou pauta para os roteiros.' }); return true;
      case 'com-descartar': await chamar(ctx, `/api/crescimento/comunidade/${encodeURIComponent(id)}/acao`, { body: { acao: 'descartar' }, recarregar: 'comunidade' }); return true;
      case 'lab-marca': { const g = el.dataset.g; const outro = g === 'a' ? 'b' : 'a'; st.labPosts[outro].delete(id); if (st.labPosts[g].has(id)) st.labPosts[g].delete(id); else st.labPosts[g].add(id); ctx.render(); return true; }
      case 'lab-criar': { const r = await chamar(ctx, '/api/crescimento/lab', { body: { nome: v('lab-nome'), hipotese: v('lab-hip'), variavel: v('lab-var'), indicador: v('lab-ind'), amostra_minima: Number(v('lab-min')), grupo_a: { descricao: v('lab-da'), posts: [...st.labPosts.a] }, grupo_b: { descricao: v('lab-db'), posts: [...st.labPosts.b] } }, recarregar: 'lab', ok: 'Experimento criado.' }); if (r?.id) st.labPosts = { a: new Set(), b: new Set() }; return true; }
      case 'lab-decidir': await chamar(ctx, `/api/crescimento/lab/${id}/decisao`, { body: { texto: v(`lab-dec-${id}`) }, recarregar: 'lab', ok: 'Decisão registrada.' }); return true;
      case 'lab-status': await chamar(ctx, `/api/crescimento/lab/${id}`, { method: 'PUT', body: { status: el.dataset.v }, recarregar: 'lab' }); return true;
      case 'lab-apagar': if (!window.confirm('Apagar este experimento?')) return true; await chamar(ctx, `/api/crescimento/lab/${id}`, { method: 'DELETE', recarregar: 'lab' }); return true;
      case 'fu-criar': await chamar(ctx, '/api/crescimento/funil', { body: { nome: v('fu-nome'), origem: v('fu-origem'), palavra: v('fu-palavra') }, recarregar: 'funil', ok: 'Lead registrado.' }); return true;
      case 'fu-mover': await chamar(ctx, `/api/crescimento/funil/${id}/estagio`, { body: { estagio: el.dataset.v }, recarregar: 'funil' }); return true;
      default: return false;
    }
  }

  window.CrescHub = { render, acao, carregar, distDe, _st: st };
})();
