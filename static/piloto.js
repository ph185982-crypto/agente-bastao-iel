// Perfil → Piloto automático: o app produz os carrosséis sozinho e o Pedro só aprova.
// Mostra o dia (prontos, aprovados, agenda), liga/desliga e ajusta meta e horários. A produção e a publicação no horário
// rodam no servidor (agendador a cada 10 min); nada é publicado sem aprovação.
(function () {
  const st = { dados: null, carregando: false, jaCarregou: false, salvando: false, rodando: false, erro: null };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  async function carregar(ctx, forcar) {
    if (st.carregando || (st.jaCarregou && !forcar)) return;
    st.carregando = true;
    try { st.dados = await ctx.api('/api/top/piloto'); st.erro = null; } catch (e) { st.erro = e.message || 'Não consegui ler o piloto.'; }
    st.carregando = false; st.jaCarregou = true; ctx.render();
  }
  async function salvar(ctx, patch) {
    st.salvando = true; st.erro = null; ctx.render();
    try { st.dados = await ctx.api('/api/top/piloto', { method: 'PUT', body: patch }); ctx.toast('Piloto salvo.'); } catch (e) { st.erro = e.message || 'Não consegui salvar.'; }
    st.salvando = false; ctx.render();
  }

  function secao() {
    const d = st.dados; if (!d) return st.erro ? `<div class="es-card"><div class="es-label">Piloto automático</div><div class="es-warn">${esc(st.erro)}</div></div>` : '';
    const c = d.config; const h = d.hoje;
    return `<div class="es-card" id="pl-secao"><div class="es-label">Piloto automático</div>
      <div class="es-text">O app escolhe as pautas, escreve, confere os números e desenha. Você recebe um aviso às ${esc(c.janelas_aprovacao.join(' e '))}, aprova, e cada aprovado entra no próximo horário da grade. <b>Nada vai ao Instagram sem a sua aprovação.</b></div>
      <div class="es-days" style="grid-template-columns:1fr 1fr;margin-top:8px">
        <button data-action="pl-ativo" data-v="true" aria-pressed="${c.ativo}" ${st.salvando ? 'disabled' : ''}>Ligado</button>
        <button data-action="pl-ativo" data-v="false" aria-pressed="${!c.ativo}" ${st.salvando ? 'disabled' : ''}>Desligado</button></div>
      <div class="pl-hoje"><div><b>${h.prontos}</b><span>para aprovar</span></div><div><b>${h.em_producao}</b><span>em produção</span></div><div><b>${h.aprovados}</b><span>aprovados hoje</span></div><div><b>${d.agenda.length}</b><span>agendados</span></div></div>
      <div class="es-text rc-mudo">Hoje: ${h.criados} pauta(s) testada(s), ${h.descartados_regua} barrada(s) pela régua. ${d.proximo_horario ? `Próximo horário livre: ${esc(hora(d.proximo_horario))}.` : ''}</div>
      <label class="es-label" for="pl-meta">Carrosséis por dia (meta)</label><input id="pl-meta" class="es-input" type="number" min="1" max="15" value="${esc(c.meta_dia)}">
      <label class="es-label" for="pl-horarios">Horários de publicação</label><input id="pl-horarios" class="es-input" value="${esc(c.horarios.join(', '))}">
      <label class="es-label" for="pl-janelas">Avisos para aprovar</label><input id="pl-janelas" class="es-input" value="${esc(c.janelas_aprovacao.join(', '))}">
      <button class="es-btn ghost" style="margin-top:10px" data-action="pl-salvar" ${st.salvando ? 'disabled' : ''}>Salvar piloto</button>
      <button class="es-btn" style="margin-top:8px" data-action="pl-rodar" ${st.rodando ? 'disabled' : ''}>${st.rodando ? 'Trabalhando…' : 'Produzir agora'}</button>
      ${d.ultima_rodada ? `<div class="es-text rc-mudo">Última rodada: ${esc(hora(d.ultima_rodada.em))}${(d.ultima_rodada.avisos || []).length ? ` · ${esc(d.ultima_rodada.avisos[0])}` : ''}</div>` : ''}
      ${st.erro ? `<div class="es-warn" role="status">${esc(st.erro)}</div>` : ''}</div>`;
  }

  const lista = (v) => String(v || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  async function acao(a, el, ctx) {
    if (a === 'pl-ativo') { await salvar(ctx, { ativo: el.dataset.v === 'true' }); return true; }
    if (a === 'pl-salvar') {
      await salvar(ctx, { meta_dia: Number(document.getElementById('pl-meta')?.value), horarios: lista(document.getElementById('pl-horarios')?.value), janelas_aprovacao: lista(document.getElementById('pl-janelas')?.value) });
      return true;
    }
    if (a === 'pl-rodar') {
      st.rodando = true; ctx.render();
      try { const r = await ctx.api('/api/top/piloto/rodada', { method: 'POST', body: {} }); ctx.toast(r.criado ? `Novo carrossel em produção: ${r.criado.titulo}` : r.avancados?.length ? 'Produção avançou.' : (r.avisos?.[0] || r.motivo || 'Nada a fazer agora.')); } catch (e) { st.erro = e.message; }
      st.rodando = false; await carregar(ctx, true); return true;
    }
    return false;
  }
  window.Piloto = { secao, acao, carregar, _st: st };
})();
