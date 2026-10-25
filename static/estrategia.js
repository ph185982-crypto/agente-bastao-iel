// Ajustes → Estratégia de pautas: modo político, temas bloqueados e dias sem repetir assunto.
// Tudo é guardado no servidor e lido pela busca de pautas; nada fica fixo no código.
(function () {
  const st = { dados: null, carregando: false, salvando: false, erro: null, jaCarregou: false, mon: null, buscando: false, ultima: null };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function carregar(ctx) {
    if (st.carregando || st.jaCarregou) return;
    st.carregando = true;
    try { st.dados = await ctx.api('/api/content/estrategia'); st.erro = null; } catch (e) { st.erro = e.message || 'Não consegui ler a estratégia.'; }
    try { st.mon = await ctx.api('/api/monitor/estado'); } catch { /* sem monitor */ }
    st.carregando = false; st.jaCarregou = true; ctx.render();
  }

  async function salvar(ctx, patch) {
    if (st.salvando) return;
    st.salvando = true; st.erro = null; ctx.render();
    try { st.dados = await ctx.api('/api/content/estrategia', { method: 'PUT', body: patch }); ctx.toast('Estratégia salva.'); } catch (e) { st.erro = e.message || 'Não consegui salvar.'; }
    st.salvando = false; ctx.render();
  }

  const quando = (iso) => { if (!iso) return 'ainda não rodou'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'agora mesmo' : m < 90 ? `há ${m} min` : m < 2880 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`; };
  function cartaoMonitor() {
    const m = st.mon; if (!m) return '';
    const c = m.config; const r = st.ultima || m.ultimo_resultado;
    const alertas = (r?.alertas || []).slice(0, 4);
    return `<div class="es-card">
      <div class="es-label">Monitor de notícias em alta</div>
      <div class="es-text">Lê os veículos, vê o que está sendo coberto por vários ao mesmo tempo, te avisa e já monta o <b>roteiro</b>. Você aprova o roteiro, depois valida o carrossel e só então publica. Nada vai ao Instagram sozinho.</div>
      <div class="es-days" style="grid-template-columns:1fr 1fr;margin-top:8px">
        <button data-action="es-mon-ativo" data-v="true" aria-pressed="${c.ativo}" ${st.salvando ? 'disabled' : ''}>Ligado</button>
        <button data-action="es-mon-ativo" data-v="false" aria-pressed="${!c.ativo}" ${st.salvando ? 'disabled' : ''}>Desligado</button>
      </div>
      <div class="es-text ca-mudo">Cada rodada usa IA para triar e cada roteiro usa o pipeline de texto. Por isso vem desligado e tem teto diário.</div>
      <label class="es-label" for="mon-min" style="margin-top:10px">Veículos cobrindo o mesmo assunto (mínimo)</label><input id="mon-min" class="es-input" type="number" min="2" max="10" value="${esc(c.min_veiculos)}">
      <label class="es-label" for="mon-janela" style="margin-top:10px">Janela (horas)</label><input id="mon-janela" class="es-input" type="number" min="1" max="72" value="${esc(c.janela_horas)}">
      <label class="es-label" for="mon-lim" style="margin-top:10px">Prioridade mínima (0 a 100)</label><input id="mon-lim" class="es-input" type="number" min="0" max="100" value="${esc(c.limiar_prioridade)}">
      <label class="es-label" for="mon-max" style="margin-top:10px">Roteiros por dia (teto)</label><input id="mon-max" class="es-input" type="number" min="0" max="10" value="${esc(c.max_roteiros_dia)}">
      <button class="es-btn ghost" style="margin-top:10px" data-action="es-mon-salvar" ${st.salvando ? 'disabled' : ''}>Salvar monitor</button>
      <button class="es-btn" style="margin-top:8px" data-action="es-mon-agora" ${st.buscando ? 'disabled' : ''}>${st.buscando ? 'Lendo os veículos…' : 'Buscar o que está em alta agora'}</button>
      <div class="es-text ca-mudo" style="margin-top:8px">Última rodada: ${esc(quando(m.ultimo_tick))} · roteiros hoje: ${esc(m.roteiros_hoje)} de ${esc(c.max_roteiros_dia)}.${r?.motivo ? ' ' + esc(r.motivo) : ''}</div>
      ${alertas.length ? `<ul class="ig-obs">${alertas.map((a) => `<li><b>${esc(a.titulo)}</b> · ${esc(Array.isArray(a.veiculos) ? a.veiculos.length : a.veiculos)} veículos · ${a.roteiro ? 'roteiro em preparação' : esc(a.motivo_sem_roteiro || 'sem roteiro')}</li>`).join('')}</ul>` : ''}
      ${(r?.erros || []).length ? `<div class="es-warn">${esc(r.erros[0])}</div>` : ''}
      ${m.guardado === false ? '<div class="es-warn">Sem banco de dados no servidor o monitor não roda (não teria como lembrar o que já avisou).</div>' : ''}
      <div class="es-text ca-mudo">“Em alta” = vários veículos cobrindo o mesmo fato agora: sinal de cobertura, não de audiência. Para rodar com o app fechado, veja docs/MONITOR.md.</div>
    </div>`;
  }

  async function salvarMon(ctx, monitor) {
    if (st.salvando) return;
    st.salvando = true; st.erro = null; ctx.render();
    try { st.dados = await ctx.api('/api/content/estrategia', { method: 'PUT', body: { monitor } }); st.mon = await ctx.api('/api/monitor/estado'); ctx.toast('Monitor salvo.'); } catch (e) { st.erro = e.message || 'Não consegui salvar.'; }
    st.salvando = false; ctx.render();
  }

  function secao() {
    const d = st.dados;
    if (!d) return `<div class="es-card"><div class="es-label">Estratégia de pautas</div><div class="es-text">${st.erro ? esc(st.erro) : 'Carregando…'}</div></div>`;
    const neutro = d.modo_politico !== 'allowed';
    return cartaoMonitor() + `<div class="es-card">
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
    if (a === 'es-mon-ativo') { await salvarMon(ctx, { ativo: el.dataset.v === 'true' }); return true; }
    if (a === 'es-mon-salvar') {
      const v = (id) => Number(document.getElementById(id)?.value);
      await salvarMon(ctx, { min_veiculos: v('mon-min'), janela_horas: v('mon-janela'), limiar_prioridade: v('mon-lim'), max_roteiros_dia: v('mon-max') });
      return true;
    }
    if (a === 'es-mon-agora') {
      if (st.buscando) return true;
      st.buscando = true; st.erro = null; ctx.render();
      try { st.ultima = await ctx.api('/api/monitor/tick', { method: 'POST', body: { forcar: true } }); st.mon = await ctx.api('/api/monitor/estado'); ctx.toast(st.ultima.alertas?.length ? `${st.ultima.alertas.length} assunto(s) em alta.` : st.ultima.executou === false ? st.ultima.motivo : 'Nada em alta agora.'); window.StudioMobile?.atualizar({ silencioso: true }); } catch (e) { st.erro = e.message; }
      st.buscando = false; ctx.render(); return true;
    }
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
