// Perfil → Painel de audiência: 1.000 vozes simuladas (12 perfis ponderados) que avaliam cada copy antes da produção.
// É uma simulação baseada em dados agregados da conta, não pessoas reais; a calibração compara a nota com o resultado real.
(function () {
  const st = { dados: null, calib: null, carregando: false, jaCarregou: false, ocupado: false, erro: null, abertos: false };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function carregar(ctx, forcar) {
    if (st.carregando || (st.jaCarregou && !forcar)) return;
    st.carregando = true;
    try { st.dados = await ctx.api('/api/painel'); st.erro = null; } catch (e) { st.erro = e.message || 'Não consegui ler o painel.'; }
    st.carregando = false; st.jaCarregou = true; ctx.render();
  }
  function secao() {
    const d = st.dados;
    if (!d) return st.erro ? `<div class="es-card"><div class="es-label">Painel de audiência</div><div class="es-warn">${esc(st.erro)}</div></div>` : '';
    const c = d.config || {};
    const lista = (d.personas || []).map((p) => `<li><b>${esc(p.rotulo)}</b> · ${esc(p.membros)} vozes<br><span class="rc-mudo">${esc(p.quem || '')}${p.compartilha_quando ? ` Compartilha quando: ${esc(p.compartilha_quando)}` : ''}</span></li>`).join('');
    const cal = st.calib;
    return `<div class="es-card" id="pn-secao"><div class="es-label">Painel de audiência (1.000 vozes simuladas)</div>
      <div class="es-text">Antes de virar carrossel, cada roteiro é avaliado por perfis desenhados a partir dos dados agregados dos seus seguidores (idade, gênero, cidade e comentários) mais perfis de empreendedores. Nota baixa gera uma reescrita; se continuar baixa, o tema é descartado. <b>É uma simulação, não pessoas reais</b>: a nota só vale de verdade depois de conferida com o resultado dos posts.</div>
      <div class="es-days" style="grid-template-columns:1fr 1fr;margin-top:8px">
        <button data-action="pn-ativo" data-v="true" aria-pressed="${!!c.ativo}" ${st.ocupado ? 'disabled' : ''}>Ligado</button>
        <button data-action="pn-ativo" data-v="false" aria-pressed="${!c.ativo}" ${st.ocupado ? 'disabled' : ''}>Desligado</button></div>
      <div class="es-text rc-mudo">${d.montado ? `${esc(d.total)} vozes em ${(d.personas || []).length} perfis · montado em ${esc(new Date(d.criado_em).toLocaleDateString('pt-BR'))} · nota mínima ${esc(c.minimo)}` : 'Painel ainda não montado.'}</div>
      ${lista ? `<details ${st.abertos ? 'open' : ''}><summary>Ver os perfis</summary><ul class="pn-lista">${lista}</ul></details>` : ''}
      <button class="es-btn" style="margin-top:8px" data-action="pn-montar" ${st.ocupado ? 'disabled' : ''}>${st.ocupado ? 'Trabalhando…' : (d.montado ? 'Atualizar painel' : 'Montar painel')}</button>
      <button class="es-btn ghost" style="margin-top:8px" data-action="pn-calibrar" ${st.ocupado ? 'disabled' : ''}>Conferir se o painel acerta</button>
      ${cal ? `<div class="es-text rc-mudo">${esc(cal.leitura || cal.motivo || (cal.correlacao != null ? `Correlação com o resultado real: ${cal.correlacao} em ${cal.n} posts.` : 'Sem dados suficientes ainda.'))}</div>` : ''}
      ${st.erro ? `<div class="es-warn" role="status">${esc(st.erro)}</div>` : ''}</div>`;
  }
  async function acao(a, el, ctx) {
    if (!/^pn-/.test(a)) return false;
    st.ocupado = true; st.erro = null; ctx.render();
    try {
      if (a === 'pn-ativo') { await ctx.api('/api/painel/config', { method: 'PUT', body: { ativo: el.dataset.v === 'true' } }); ctx.toast('Painel salvo.'); }
      if (a === 'pn-montar') { const r = await ctx.api('/api/painel/montar', { method: 'POST', body: {} }); ctx.toast(`Painel montado: ${r.total} vozes.`); st.abertos = true; }
      if (a === 'pn-calibrar') st.calib = await ctx.api('/api/painel/calibracao');
    } catch (e) { st.erro = e.message || 'Falhou.'; }
    st.ocupado = false; await carregar(ctx, true); return true;
  }
  window.Painel = { secao, acao, carregar, _st: st };
})();
