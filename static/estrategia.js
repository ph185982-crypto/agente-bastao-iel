// Ajustes → Estratégia de pautas: modo político, temas bloqueados e dias sem repetir assunto.
// Tudo é guardado no servidor e lido pela busca de pautas; nada fica fixo no código.
(function () {
  const st = { dados: null, carregando: false, salvando: false, erro: null, jaCarregou: false };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function carregar(ctx) {
    if (st.carregando || st.jaCarregou) return;
    st.carregando = true;
    try { st.dados = await ctx.api('/api/content/estrategia'); st.erro = null; } catch (e) { st.erro = e.message || 'Não consegui ler a estratégia.'; }
    st.carregando = false; st.jaCarregou = true; ctx.render();
  }

  async function salvar(ctx, patch) {
    if (st.salvando) return;
    st.salvando = true; st.erro = null; ctx.render();
    try { st.dados = await ctx.api('/api/content/estrategia', { method: 'PUT', body: patch }); ctx.toast('Estratégia salva.'); } catch (e) { st.erro = e.message || 'Não consegui salvar.'; }
    st.salvando = false; ctx.render();
  }

  function secao() {
    const d = st.dados;
    if (!d) return `<div class="es-card"><div class="es-label">Estratégia de pautas</div><div class="es-text">${st.erro ? esc(st.erro) : 'Carregando…'}</div></div>`;
    const neutro = d.modo_politico !== 'allowed';
    return `<div class="es-card">
      <div class="es-label">Estratégia de pautas</div>
      ${st.erro ? `<div class="es-warn">${esc(st.erro)}</div>` : ''}
      <div class="es-text"><b>Política partidária e eleitoral</b></div>
      <div class="es-days" style="grid-template-columns:1fr 1fr">
        <button data-action="es-modo" data-v="neutral" aria-pressed="${neutro}" ${st.salvando ? 'disabled' : ''}>Neutro</button>
        <button data-action="es-modo" data-v="allowed" aria-pressed="${!neutro}" ${st.salvando ? 'disabled' : ''}>Liberado</button>
      </div>
      <div class="es-text" style="margin-top:6px">${neutro ? 'Neutro: pautas partidárias ou eleitorais ficam de fora da busca (imposto, juros e preço continuam). Elas aparecem em “descartadas”, com o motivo.' : 'Liberado: pautas partidárias entram na lista, com penalidade na prioridade.'}</div>
      <label class="es-label" for="est-bloq" style="margin-top:12px">Temas bloqueados (separados por vírgula)</label>
      <input id="est-bloq" class="es-input" type="text" value="${esc((d.temas_bloqueados || []).join(', '))}" placeholder="ex.: bets, crime">
      <label class="es-label" for="est-dias" style="margin-top:12px">Dias sem repetir um assunto</label>
      <input id="est-dias" class="es-input" type="number" min="1" max="90" value="${esc(d.dias_sem_repetir)}">
      <div class="es-text" style="margin-top:6px">Conta o que a ferramenta publicou e os posts que a aba Resultados leu do seu Instagram.</div>
      <button class="es-btn" style="margin-top:10px" data-action="es-salvar" ${st.salvando ? 'disabled' : ''}>${st.salvando ? 'Salvando…' : 'Salvar'}</button>
      ${d.guardada === false ? '<div class="es-warn">Sem banco de dados no servidor, esta escolha não fica guardada.</div>' : ''}
    </div>`;
  }

  async function acao(a, el, ctx) {
    if (a === 'es-modo') { await salvar(ctx, { modo_politico: el.dataset.v }); return true; }
    if (a === 'es-salvar') {
      const bloq = (document.getElementById('est-bloq')?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
      const dias = Number(document.getElementById('est-dias')?.value);
      await salvar(ctx, { temas_bloqueados: bloq, dias_sem_repetir: dias });
      return true;
    }
    return false;
  }

  window.MesaEstrategia = { secao, acao, carregar, _st: st };
})();
