// "Minhas histórias e casos" (Perfil): o material do Pedro que vira conteúdo. Ele escreve ou dita pelo teclado do celular
// uma história dele, um caso de cliente ou um passo a passo; a ferramenta só usa o que estiver escrito aqui.
// O servidor guarda e escreve; nada é publicado sem aprovação. Ações com prefixo hs-.
(function () {
  'use strict';
  const ST = { carregando: false, carregou: false, erro: null, itens: [], tipos: { historia: 'História minha', caso: 'Caso de cliente', como_fazer: 'Como fazer' }, min: 200, max: 6000,
    form: { tipo: 'historia', titulo: '', texto: '' }, editando: null, salvando: false, ocupado: {} };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dia = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }); };
  const AJUDA = {
    historia: 'Conte como aconteceu: onde você estava, o que deu errado ou apertou, o que você decidiu e o que aprendeu.',
    caso: 'Conte como o negócio estava, o que foi feito e como ficou. Não escreva o nome do cliente, da empresa nem a cidade.',
    como_fazer: 'Escreva os passos na ordem, como você explicaria para um cliente. Um passo por frase.',
  };

  async function carregar(ctx, forcar) {
    if (ST.carregando || (ST.carregou && !forcar)) return;
    ST.carregando = true; ctx.render();
    try { const r = await ctx.api('/api/historias'); ST.itens = r.itens || []; ST.tipos = r.tipos || ST.tipos; ST.min = r.min || ST.min; ST.max = r.max || ST.max; ST.erro = null; }
    catch (e) { ST.erro = e.message || 'Não consegui abrir suas histórias.'; }
    ST.carregando = false; ST.carregou = true; ctx.render();
  }

  const contador = () => { const n = ST.form.texto.trim().length; return n < ST.min ? `${n} de ${ST.min} caracteres no mínimo` : `${n} caracteres`; };

  function formulario() {
    const f = ST.form;
    const tipos = Object.entries(ST.tipos).map(([k, r]) => `<button type="button" class="hs-tipo" data-action="hs-tipo" data-tipo="${k}" aria-pressed="${f.tipo === k}">${esc(r)}</button>`).join('');
    return `<div class="es-card hs-form"><div class="es-label">${ST.editando ? 'Editar' : 'Nova'}</div>
      <div class="hs-tipos" role="group" aria-label="Tipo">${tipos}</div>
      <p class="es-text hs-ajuda" id="hs-ajuda">${esc(AJUDA[f.tipo])}</p>
      <label class="hs-campo">Título (opcional)<input id="hs-titulo" data-hs-campo="titulo" value="${esc(f.titulo)}" maxlength="120" placeholder="Ex.: A terça da maquininha"></label>
      <label class="hs-campo">Seu texto<textarea id="hs-texto" data-hs-campo="texto" rows="9" maxlength="${ST.max}" placeholder="Escreva ou toque no microfone do teclado e fale.">${esc(f.texto)}</textarea></label>
      <div class="hs-rodape"><span class="hs-contador" id="hs-contador" aria-live="polite">${esc(contador())}</span>
        <span class="hs-botoes">${ST.editando ? '<button class="es-btn ghost sm" data-action="hs-cancelar">Cancelar</button>' : ''}<button class="es-btn sm" data-action="hs-salvar" ${ST.salvando ? 'disabled' : ''}>${ST.salvando ? 'Salvando…' : 'Salvar'}</button></span></div>
      <p class="es-text hs-nota">A ferramenta só usa o que você escrever aqui. Nada é inventado e nada vai ao Instagram sem a sua aprovação.</p></div>`;
  }

  function cartao(h) {
    const uso = (h.usos || [])[(h.usos || []).length - 1];
    const status = uso ? `<span class="mz-chip ok">Virou conteúdo em ${esc(dia(uso.em))}</span>` : '<span class="mz-chip neutro">Ainda não usado</span>';
    const oc = ST.ocupado[h.id];
    return `<article class="es-card hs-item"><div class="hs-topo"><span class="hs-etiqueta">${esc(ST.tipos[h.tipo] || h.tipo)}</span>${status}</div>
      <h3 class="hs-titulo">${esc(h.titulo)}</h3><p class="es-text hs-trecho">${esc(h.texto.slice(0, 220))}${h.texto.length > 220 ? '…' : ''}</p>
      <div class="hs-acoes"><button class="es-btn sm" data-action="hs-gerar" data-id="${esc(h.id)}" ${oc ? 'disabled' : ''}>${oc === 'gerar' ? 'Enviando…' : uso ? 'Gerar outro carrossel' : 'Gerar carrossel agora'}</button>
        <button class="es-btn ghost sm" data-action="hs-editar" data-id="${esc(h.id)}" ${oc ? 'disabled' : ''}>Editar</button>
        <button class="es-btn ghost sm" data-action="hs-apagar" data-id="${esc(h.id)}" ${oc ? 'disabled' : ''}>Apagar</button></div></article>`;
  }

  function render() {
    let corpo = `<button class="hs-voltar" data-action="tab" data-tab="ajustes">← Perfil</button>
      <span class="st-eyebrow">SEU MATERIAL</span><h1 class="es-h1">Minhas histórias e casos</h1>
      <p class="es-text hs-intro">O que mais cresce conta é história, passo prático e caso real. Escreva aqui e a ferramenta transforma em carrossel na sua voz. Com histórias cadastradas, o piloto usa uma a cada três peças do dia.</p>`;
    if (ST.erro) corpo += `<div class="es-warn">${esc(ST.erro)} <button class="es-btn ghost sm" data-action="hs-recarregar">Tentar de novo</button></div>`;
    corpo += formulario();
    if (ST.carregando && !ST.carregou) corpo += '<div class="es-empty-day">Abrindo suas histórias…</div>';
    else if (!ST.itens.length && !ST.erro) corpo += '<div class="es-empty-day">Você ainda não cadastrou nada. Comece por uma história curta: um aperto que você passou e o que aprendeu.</div>';
    else if (ST.itens.length) corpo += `<div class="es-label hs-lista-titulo">Cadastradas (${ST.itens.length})</div>${ST.itens.map(cartao).join('')}`;
    return `<div class="hs-tela">${corpo}</div>`;
  }

  // Digitação: guarda no estado sem redesenhar a tela (senão o teclado do celular fecha a cada letra).
  document.addEventListener('input', (e) => {
    const k = e.target?.dataset?.hsCampo; if (!k) return;
    ST.form[k] = e.target.value;
    if (k === 'texto') { const c = document.getElementById('hs-contador'); if (c) c.textContent = contador(); }
  });

  async function acao(a, el, ctx) {
    if (!a || !a.startsWith('hs-')) return false;
    if (a === 'hs-recarregar') { await carregar(ctx, true); return true; }
    if (a === 'hs-tipo') { ST.form.tipo = el.dataset.tipo; ctx.render(); return true; }
    if (a === 'hs-cancelar') { ST.editando = null; ST.form = { tipo: 'historia', titulo: '', texto: '' }; ctx.render(); return true; }
    if (a === 'hs-editar') { const h = ST.itens.find((x) => x.id === el.dataset.id); if (h) { ST.editando = h.id; ST.form = { tipo: h.tipo, titulo: h.titulo, texto: h.texto }; ctx.render(); document.getElementById('hs-texto')?.scrollIntoView({ block: 'center' }); } return true; }
    if (a === 'hs-salvar') {
      if (ST.salvando) return true;
      if (ST.form.texto.trim().length < ST.min) { ctx.toast(`Conte um pouco mais: faltam ${ST.min - ST.form.texto.trim().length} caracteres.`); return true; }
      ST.salvando = true; ctx.render();
      try {
        const salvo = await ctx.api(ST.editando ? `/api/historias/${encodeURIComponent(ST.editando)}` : '/api/historias', { method: ST.editando ? 'PUT' : 'POST', body: ST.form });
        ST.itens = ST.editando ? ST.itens.map((x) => (x.id === salvo.id ? salvo : x)) : [salvo, ...ST.itens];
        ST.editando = null; ST.form = { tipo: salvo.tipo, titulo: '', texto: '' }; ctx.toast('Salvo.');
      } catch (e) { ctx.toast(e.message || 'Não consegui salvar.'); }
      ST.salvando = false; ctx.render(); return true;
    }
    const id = el.dataset.id; if (!id) return true;
    if (a === 'hs-apagar') {
      if (!window.confirm('Apagar este texto do cadastro? O conteúdo que já foi gerado com ele não é apagado.')) return true;
      ST.ocupado[id] = 'apagar'; ctx.render();
      try { await ctx.api(`/api/historias/${encodeURIComponent(id)}`, { method: 'DELETE' }); ST.itens = ST.itens.filter((x) => x.id !== id); if (ST.editando === id) { ST.editando = null; ST.form = { tipo: 'historia', titulo: '', texto: '' }; } }
      catch (e) { ctx.toast(e.message || 'Não consegui apagar.'); }
      delete ST.ocupado[id]; ctx.render(); return true;
    }
    if (a === 'hs-gerar') {
      ST.ocupado[id] = 'gerar'; ctx.render();
      try {
        await ctx.api(`/api/historias/${encodeURIComponent(id)}/gerar`, { method: 'POST', body: {} });
        ctx.toast('Em produção. Aparece em Aprovar quando ficar pronto.');
        ctx.api('/api/top/piloto/rodada', { method: 'POST', body: {} }).catch(() => {}); // começa já, sem esperar o relógio
        const r = await ctx.api('/api/historias').catch(() => null); if (r) ST.itens = r.itens || ST.itens;
      } catch (e) { ctx.toast(e.message || 'Não consegui gerar agora.'); }
      delete ST.ocupado[id]; ctx.render(); return true;
    }
    return true;
  }

  window.Historias = { render, acao, carregar, _st: ST };
})();
