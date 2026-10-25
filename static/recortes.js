// Perfil → Visual dos carrosséis e Recortes.
// O visual "reportagem" usa rosto recortado em preto e branco. O app não gera nem altera rostos: só usa os recortes
// que o Pedro envia aqui, com crédito e licença, e os escolhe pelo nome da pessoa citada na pauta.
(function () {
  const st = { aberto: false, visual: null, lista: null, guardado: true, carregando: false, jaCarregou: false, erro: null, enviando: false, salvando: false,
    form: { nome: '', credito: '', licenca: 'CC BY 3.0 BR', licencaOutra: '', origem: '', exige: true, arquivo: null, nomeArquivo: '' } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_KB = 3000; // o limite da plataforma para o corpo de uma chamada é ~4,5 MB; em base64 o arquivo cresce 1/3
  const LICENCAS = ['CC BY 3.0 BR', 'CC BY 4.0', 'Domínio público', 'Autorizada pelo fotógrafo', 'Outra'];

  async function carregar(ctx, forcar) {
    if (st.carregando || (st.jaCarregou && !forcar)) return;
    st.carregando = true;
    try {
      const [e, r] = await Promise.all([ctx.api('/api/content/estrategia'), ctx.api('/api/recortes')]);
      st.visual = (e.visual && e.visual.tema) || 'reportagem'; st.lista = r.recortes || []; st.guardado = r.guardado !== false; st.erro = null;
    } catch (e) { st.erro = e.message || 'Não consegui ler os recortes.'; }
    st.carregando = false; st.jaCarregou = true; ctx.render();
  }

  function secao() {
    const f = st.form;
    const tema = (id, rot, desc) => `<button class="rc-tema" data-action="rc-tema" data-t="${id}" aria-pressed="${st.visual === id}" ${st.salvando ? 'disabled' : ''}><b>${rot}</b><small>${desc}</small></button>`;
    const lista = (st.lista || []).map((r) => `<li class="rc-item"><img src="/api/recortes/${esc(r.id)}/arquivo" alt="Recorte de ${esc(r.nome)}" width="64" height="80" loading="lazy"><div><b>${esc(r.nome)}</b><small>${esc(r.credito)} · ${esc(r.licenca)}</small></div><button class="es-btn danger sm" data-action="rc-remover" data-id="${esc(r.id)}" aria-label="Remover recorte de ${esc(r.nome)}">Remover</button></li>`).join('');
    return `<div class="es-card" id="rc-secao"><div class="es-label">Visual dos carrosséis</div>
      <div class="rc-temas" role="group" aria-label="Visual dos carrosséis">${tema('reportagem', 'Reportagem', 'Marinho, amarelo e vermelho; letra condensada; rosto recortado')}${tema('avanteza', 'Avanteza', 'Azul e laranja da marca; só tipografia')}</div>
      <div class="es-text rc-mudo">Vale para os próximos conteúdos. O que já foi gerado não muda sozinho.</div>
      <div class="es-label">Recortes (rostos)</div>
      <div class="es-text">PNG com <b>fundo transparente</b>, de foto com licença. O app usa o recorte em preto e branco, sem alterar o rosto, quando o nome da pessoa aparece na pauta. Sem recorte, a arte sai só com a forma de apoio.</div>
      ${st.erro ? `<div class="es-warn" role="status">${esc(st.erro)}</div>` : ''}
      ${!st.guardado ? '<div class="es-warn">Os recortes precisam do banco de dados no servidor. Veja docs/ATIVACAO.md.</div>' : ''}
      <ul class="rc-lista">${lista || '<li class="es-empty-day">Nenhum recorte ainda.</li>'}</ul>
      <details class="rc-novo" ${st.aberto ? 'open' : ''}><summary>Enviar um recorte</summary>
        <label class="es-label" for="rc-nome">Nome da pessoa (como aparece nas pautas)</label><input id="rc-nome" class="es-input" value="${esc(f.nome)}" maxlength="60" autocomplete="off">
        <label class="es-label" for="rc-credito">Crédito do fotógrafo</label><input id="rc-credito" class="es-input" value="${esc(f.credito)}" maxlength="120" placeholder="Ex.: Ricardo Stuckert / PR" autocomplete="off">
        <label class="es-label" for="rc-licenca">Licença</label><select id="rc-licenca" class="es-input">${LICENCAS.map((l) => `<option ${f.licenca === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${f.licenca === 'Outra' ? `<input id="rc-licenca-outra" class="es-input" style="margin-top:8px" value="${esc(f.licencaOutra)}" maxlength="100" placeholder="Descreva a licença">` : ''}
        <label class="es-label" for="rc-origem">Link da foto original (opcional)</label><input id="rc-origem" class="es-input" type="url" inputmode="url" value="${esc(f.origem)}" placeholder="https://…">
        <label class="es-label" for="rc-arquivo">Arquivo PNG (até ${MAX_KB / 1000} MB)</label><input id="rc-arquivo" type="file" accept="image/png,image/webp">
        ${f.nomeArquivo ? `<div class="es-text">Escolhido: ${esc(f.nomeArquivo)}</div>` : ''}
        <label class="cn-pausa" style="margin-top:10px"><input id="rc-exige" type="checkbox" ${f.exige ? 'checked' : ''}><span>A licença exige citar o crédito</span></label>
        <button class="es-btn" style="margin-top:10px" data-action="rc-enviar" ${st.enviando ? 'disabled' : ''}>${st.enviando ? 'Enviando…' : 'Salvar recorte'}</button>
      </details></div>`;
  }

  async function acao(a, el, ctx) {
    if (a === 'rc-tema') {
      if (st.salvando) return true;
      st.salvando = true; st.erro = null; ctx.render();
      try { const e = await ctx.api('/api/content/estrategia', { method: 'PUT', body: { visual: { tema: el.dataset.t } } }); st.visual = e.visual.tema; ctx.toast('Visual salvo para os próximos conteúdos.'); } catch (e) { st.erro = e.message || 'Não consegui salvar.'; }
      st.salvando = false; ctx.render(); return true;
    }
    if (a === 'rc-remover') {
      try { await ctx.api(`/api/recortes/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' }); st.lista = st.lista.filter((r) => r.id !== el.dataset.id); ctx.toast('Recorte removido.'); } catch (e) { st.erro = e.message; }
      ctx.render(); return true;
    }
    if (a === 'rc-enviar') {
      const f = st.form;
      if (!f.arquivo) { ctx.toast('Escolha o arquivo PNG do recorte.'); return true; }
      st.enviando = true; st.erro = null; ctx.render();
      try {
        const licenca = f.licenca === 'Outra' ? f.licencaOutra : f.licenca;
        const r = await ctx.api('/api/recortes', { method: 'POST', body: { nome: f.nome, credito: f.credito, licenca, origem_url: f.origem, exige_credito: f.exige, arquivo: f.arquivo } });
        st.lista = [...(st.lista || []).filter((x) => x.id !== r.id), r];
        st.form = { ...st.form, nome: '', credito: '', origem: '', arquivo: null, nomeArquivo: '' };
        ctx.toast('Recorte salvo.');
      } catch (e) { st.erro = e.message || 'Não consegui salvar o recorte.'; }
      st.enviando = false; ctx.render(); return true;
    }
    return false;
  }

  function aoDigitar(el) {
    const m = { 'rc-nome': 'nome', 'rc-credito': 'credito', 'rc-origem': 'origem', 'rc-licenca-outra': 'licencaOutra' }[el.id];
    if (m) st.form[m] = el.value;
  }
  function aoMudar(el, ctx) {
    if (el.id === 'rc-licenca') { st.form.licenca = el.value; ctx.render(); return true; }
    if (el.id === 'rc-exige') { st.form.exige = el.checked; return true; }
    if (el.id === 'rc-arquivo') {
      const arq = el.files && el.files[0];
      if (!arq) return true;
      if (arq.size > MAX_KB * 1000) { st.erro = `O arquivo tem ${(arq.size / 1e6).toFixed(1)} MB; o limite é ${MAX_KB / 1000} MB. Reduza a imagem.`; st.form.arquivo = null; st.form.nomeArquivo = ''; ctx.render(); return true; }
      const leitor = new FileReader();
      leitor.onload = () => { st.form.arquivo = String(leitor.result); st.form.nomeArquivo = arq.name; st.erro = null; ctx.render(); };
      leitor.readAsDataURL(arq);
      return true;
    }
    return false;
  }

  const raiz = document.getElementById('esteira');
  if (raiz) {
    raiz.addEventListener('input', (e) => aoDigitar(e.target));
    raiz.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('rc-novo')) st.aberto = e.target.open; }, true);
    raiz.addEventListener('change', (e) => { if (window.Mesa && aoMudar(e.target, window.Mesa.ctx())) e.stopPropagation(); }, true);
  }
  window.Recortes = { secao, acao, carregar, _st: st };
})();
