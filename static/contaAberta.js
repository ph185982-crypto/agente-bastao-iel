// "A Conta Aberta": prova com números reais de um cliente (informados por você) + Porta de entrada
// (iscas com palavra-chave e link, DMs por palavra digitadas à mão). Sem IA: as contas são do servidor.
(function () {
  const st = { form: { periodo: '', canal: '', categoria: '', cliente: '', aut: false, faturamento: '', comissao: '', frete: '', imposto: '', ads: '', outros: '', sobrou: '', isca_id: '' },
    iscas: null, dms: [], guardada: true, erro: null, aviso: null, criando: false, salvando: false, carregou: false, ed: {} };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAMPOS = [['faturamento', 'Faturamento bruto (R$)'], ['comissao', 'Comissão do canal (R$)'], ['frete', 'Frete (R$)'], ['imposto', 'Imposto (R$)'], ['ads', 'Anúncios (R$)'], ['outros', 'Outros custos (R$)'], ['sobrou', 'Quanto sobrou (R$) — opcional']];

  document.addEventListener('input', (e) => {
    const id = e.target && e.target.id;
    if (!id || !id.startsWith('ca-')) return;
    if (id.startsWith('ca-i-')) { const [, , campo, isca] = id.split('-'); (st.ed[isca] ||= {})[campo] = e.target.value; return; }
    const k = id.slice(3);
    if (k === 'aut') st.form.aut = e.target.checked; else if (k in st.form) st.form[k] = e.target.value;
  });
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'ca-aut') st.form.aut = e.target.checked; });

  async function carregar(ctx) {
    if (st.carregou) return;
    try { const r = await ctx.api('/api/content/iscas'); st.iscas = r.iscas; st.dms = r.dms || []; st.guardada = r.guardada !== false; if (!st.form.isca_id && r.iscas[0]) st.form.isca_id = r.iscas[0].id; st.erro = null; } catch (e) { st.erro = e.message; }
    st.carregou = true; ctx.render();
  }

  const num = (v) => (v === '' || v == null ? undefined : Number(String(v).replace(/\./g, '').replace(',', '.')));
  async function criar(ctx) {
    if (st.criando) return;
    const f = st.form;
    const entrada = { periodo: f.periodo, canal: f.canal, categoria: f.categoria, cliente: f.cliente, cliente_autorizou: !!f.aut, isca_id: f.isca_id };
    CAMPOS.forEach(([k]) => { entrada[k] = num(f[k]); });
    st.criando = true; st.erro = null; st.aviso = null; ctx.render();
    try {
      const r = await ctx.api('/api/content/conta-aberta', { method: 'POST', body: { request_id: ctx.novoId('ca'), entrada } });
      const c = r.conteudo;
      await ctx.persistir(c);
      try { await window.MesaEditor._internos.atualizarArte(ctx, c); } catch (e) { ctx.toast('A prova foi criada, mas a arte falhou: ' + e.message); }
      ctx.toast(r.pendencias?.length ? `Prova criada. Falta: ${r.pendencias[0].texto}` : 'Prova criada. Confira e aprove na Central.');
      st.criando = false;
      return ctx.abrirConteudo(c.id);
    } catch (e) { st.erro = e.message || 'Não consegui criar a prova.'; }
    st.criando = false; ctx.render();
  }

  async function salvarIscas(ctx) {
    st.salvando = true; st.erro = null; ctx.render();
    try {
      const lista = (st.iscas || []).map((i) => ({ id: i.id, nome: (st.ed[i.id]?.nome ?? i.nome), palavra: (st.ed[i.id]?.palavra ?? i.palavra), link: (st.ed[i.id]?.link ?? i.link) }));
      const r = await ctx.api('/api/content/iscas', { method: 'PUT', body: { iscas: lista } });
      st.iscas = r.iscas; st.ed = {}; st.guardada = r.guardada !== false; ctx.toast('Iscas salvas.');
    } catch (e) { st.erro = e.message; }
    st.salvando = false; ctx.render();
  }

  async function registrarDms(ctx) {
    const palavra = document.getElementById('ca-dm-palavra')?.value;
    const dms = Number(document.getElementById('ca-dm-n')?.value);
    const q = document.getElementById('ca-dm-q')?.value;
    st.erro = null;
    try { const r = await ctx.api('/api/content/dms', { method: 'POST', body: { palavra, dms, qualificadas: q === '' ? null : Number(q) } }); st.dms = r.dms; ctx.toast('DMs registradas.'); } catch (e) { st.erro = e.message; }
    ctx.render();
  }

  function render() {
    const f = st.form; const iscas = st.iscas || [];
    const campo = (id, rotulo, extra = '') => `<label for="ca-${id}">${esc(rotulo)}</label><input id="ca-${id}" class="es-input" ${extra} value="${esc(f[id])}">`;
    const semLink = iscas.filter((i) => !i.link);
    return `<button class="es-btn ghost sm" style="width:auto" data-action="voltar">‹ Voltar</button>
      <div class="es-h1" style="margin-top:12px">Conta aberta</div>
      <div class="es-sub">Prova com números reais de um cliente. Os valores são seus (dos registros do cliente); a ferramenta faz as contas, confere se fecham e anonimiza por padrão. Não publica nada: vai para a Central para você aprovar.</div>
      ${st.erro ? `<div class="es-errbox">${esc(st.erro)}</div>` : ''}
      <div class="es-card">
        ${campo('periodo', 'Período', 'placeholder="set/2026"')}
        ${campo('canal', 'Canal de venda', 'placeholder="Shopee"')}
        ${campo('categoria', 'Tipo de loja', 'placeholder="moda"')}
        ${CAMPOS.map(([k, r]) => campo(k, r, 'inputmode="decimal" placeholder="0"')).join('')}
        <label for="ca-cliente">Nome do cliente (opcional)</label><input id="ca-cliente" class="es-input" value="${esc(f.cliente)}" autocomplete="off">
        <label class="ca-check"><input id="ca-aut" type="checkbox" ${f.aut ? 'checked' : ''}> O cliente autorizou usar o nome</label>
        <div class="es-text ca-mudo">Sem a autorização marcada, o nome é omitido e nem chega a ser guardado. A legenda diz que os dados foram informados pelo cliente, sem auditoria independente.</div>
        <label for="ca-isca_id">Chamada final</label>
        <select id="ca-isca_id" class="es-input" data-ca-isca>${iscas.map((i) => `<option value="${esc(i.id)}" ${f.isca_id === i.id ? 'selected' : ''}>${esc(i.nome)} (${esc(i.palavra)})${i.link ? '' : ' — sem link'}</option>`).join('')}</select>
        <button class="es-btn" style="margin-top:12px" data-action="ca-criar" ${st.criando ? 'disabled' : ''}>${st.criando ? 'Calculando…' : 'Criar a prova'}</button>
      </div>
      <div class="es-label">Porta de entrada (iscas)</div>
      <div class="es-card">
        ${semLink.length ? `<div class="es-warn">Sem link não há chamada: ${esc(semLink.map((i) => i.nome).join(', '))}. Cole o link para liberar a chamada “Comenta ${esc(semLink[0].palavra)}”.</div>` : ''}
        ${iscas.map((i) => `<div class="ca-isca"><b>${esc(i.nome)}</b>
          <label for="ca-i-nome-${esc(i.id)}">Nome</label><input id="ca-i-nome-${esc(i.id)}" class="es-input" value="${esc(st.ed[i.id]?.nome ?? i.nome)}">
          <label for="ca-i-palavra-${esc(i.id)}">Palavra para comentar</label><input id="ca-i-palavra-${esc(i.id)}" class="es-input" value="${esc(st.ed[i.id]?.palavra ?? i.palavra)}">
          <label for="ca-i-link-${esc(i.id)}">Link (https://…)</label><input id="ca-i-link-${esc(i.id)}" class="es-input" inputmode="url" value="${esc(st.ed[i.id]?.link ?? i.link)}"></div>`).join('')}
        <button class="es-btn ghost" data-action="ca-salvar-iscas" ${st.salvando ? 'disabled' : ''}>${st.salvando ? 'Salvando…' : 'Salvar iscas'}</button>
        ${st.guardada ? '' : '<div class="es-warn">Sem banco de dados no servidor, as iscas não ficam guardadas.</div>'}
      </div>
      <div class="es-label">DMs recebidas por palavra (digite por semana)</div>
      <div class="es-card">
        <div class="es-text ca-mudo">Não há integração com as mensagens do Instagram: este número é seu, digitado à mão.</div>
        <label for="ca-dm-palavra">Palavra</label><select id="ca-dm-palavra" class="es-input">${iscas.map((i) => `<option value="${esc(i.palavra)}">${esc(i.palavra)}</option>`).join('')}</select>
        <label for="ca-dm-n">DMs recebidas na semana</label><input id="ca-dm-n" class="es-input" inputmode="numeric" placeholder="0">
        <label for="ca-dm-q">Qualificadas (opcional)</label><input id="ca-dm-q" class="es-input" inputmode="numeric" placeholder="deixe vazio se não souber">
        <button class="es-btn ghost" data-action="ca-dms">Registrar</button>
        ${st.dms.length ? `<table class="ca-tab"><thead><tr><th>Semana</th><th>Palavra</th><th>DMs</th><th>Qualif.</th></tr></thead><tbody>${st.dms.slice(0, 8).map((d) => `<tr><td>${esc(d.semana)}</td><td>${esc(d.palavra)}</td><td>${esc(d.dms)}</td><td>${d.qualificadas == null ? '—' : esc(d.qualificadas)}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>`;
  }

  async function acao(a, el, ctx) {
    if (a === 'ca-abrir') { ctx.state.tab = 'mesa'; ctx.state.sub = 'conta-aberta'; ctx.state.atual = null; ctx.render(); await carregar(ctx); return true; }
    if (a === 'ca-criar') { await criar(ctx); return true; }
    if (a === 'ca-salvar-iscas') { await salvarIscas(ctx); return true; }
    if (a === 'ca-dms') { await registrarDms(ctx); return true; }
    return false;
  }

  window.ContaAberta = { render, acao, carregar, _st: st };
})();
