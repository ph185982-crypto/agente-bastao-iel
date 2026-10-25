// Editor do carrossel "Negócios que você não viu" (aba Radar). Feito para o celular: uma tela por vez, abas grandes, botões de toque.
// Tudo o que muda passa pelo servidor, que re-renderiza só as telas afetadas, revalida e devolve o estado. Aqui só se mostra e se comanda.
(function () {
  'use strict';
  const ED = { id: null, d: null, n: 1, aba: 'texto', vals: {}, ocupado: null, up: { papel: 'foto', permissao: false, descricao: '', credito: '', licenca: '', url: '' }, capas: {}, legenda: null, instrucao: '' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = () => window.RadarUI.util;
  const ctx = () => window.Mesa.ctx();
  const api = (c, path, body, method = 'POST') => c.api(`/api/radar/carrosseis/${encodeURIComponent(ED.id)}${path}`, method === 'GET' ? {} : { method, body });
  const CAMPOS = { corpo: ['Texto (parágrafos separados por linha em branco)', 600, true], rotulo: ['Rótulo (linha pequena no topo)', 56, false], titulo: ['Título (use **assim** para destacar)', 130, true], linha2: ['Segunda linha (em laranja)', 70, false], apoio: ['Texto de apoio', 170, true], nota: ['Nota', 110, false], palavra: ['Palavra gigante de fundo', 14, false], legenda: ['O que o número mede', 70, false] };
  const USA = { min_texto: ['titulo', 'corpo'], min_foto: ['titulo', 'corpo'], min_produto: ['titulo', 'corpo'], min_encerramento: ['titulo', 'apoio'], manchete_produto: ['rotulo', 'titulo', 'apoio', 'nota', 'palavra'], foto_documental: ['rotulo', 'titulo', 'apoio'], contraste: ['rotulo', 'titulo', 'linha2', 'apoio', 'palavra'], evidencia: ['rotulo', 'legenda', 'apoio'], quebra_azul: ['rotulo', 'titulo', 'apoio'], encerramento_pedro: ['titulo', 'apoio'] };
  const ROT_LAYOUT = { min_produto: 'Produto recortado', min_texto: 'Só texto', min_foto: 'Foto e texto', min_encerramento: 'Encerramento do Pedro', manchete_produto: 'Manchete + produto', foto_documental: 'Foto grande', contraste: 'Contraste', evidencia: 'Dado em destaque', quebra_azul: 'Tela azul', encerramento_pedro: 'Encerramento do Pedro' };
  const ABAS = [['texto', 'Texto'], ['foto', 'Foto'], ['comp', 'Composição'], ['capas', 'Capas'], ['legenda', 'Legenda'], ['revisao', 'Revisão']];
  const tela = () => ED.d?.telas?.[ED.n - 1];
  const v1 = () => !!ED.d?.padrao_v1;
  const META = { informacao_nova: 'Informação nova desta tela (não aparece na arte)', relacao_anterior: 'Relação com a tela anterior (não aparece na arte)' };
  const valorDe = (t, c) => (ED.vals[t.id] && c in ED.vals[t.id] ? ED.vals[t.id][c] : (t.textos?.[c] ?? ''));

  function atualizar(r) { ED.d = { ...ED.d, ...r.carrossel }; ED.vals = {}; ED.legenda = null; ED.capas = {}; const l = window.RadarUI._st.carrosseis; const i = l.findIndex((x) => x.id === ED.id); if (i >= 0) l[i] = { ...l[i], ...r.carrossel }; if (ED.n > ED.d.telas.length) ED.n = ED.d.telas.length; }
  async function operar(c, rotulo, fn, okMsg) {
    ED.ocupado = rotulo; c.render();
    try { const r = await fn(); atualizar(r); if (okMsg) c.toast(okMsg); if (r.regeneracao?.com_problemas) c.toast('A IA não conseguiu resolver todos os problemas desta tela. Veja a Revisão.'); }
    catch (e) { c.toast(e.message || 'Não foi possível concluir.'); }
    finally { ED.ocupado = null; c.render(); }
  }

  // ── Telas ─────────────────────────────────────────────────────────────────────
  function miniaturas() {
    return `<div class="rdn-thumbs" role="tablist" aria-label="Telas">${ED.d.telas.map((t) => `<button role="tab" class="rdn-th ${t.n === ED.n ? 'on' : ''} ${!t.cabe ? 'alerta' : ''}" data-action="rd-ed-tela" data-n="${t.n}" aria-selected="${t.n === ED.n}" aria-label="Tela ${t.n}: ${esc(t.funcao_rotulo)}"><img data-rd-src="${esc(t.url)}?w=240&h=${esc(t.sha)}" alt="" width="240" height="300"><b>${t.n}</b>${t.bloqueada ? '<i title="Bloqueada">🔒</i>' : ''}${!t.cabe ? '<i title="Texto não cabe">!</i>' : ''}</button>`).join('')}</div>`;
  }
  function abaTexto(t) {
    const campos = USA[t.layout] || ['titulo', 'apoio'];
    const trava = t.bloqueada || t.travas?.texto ? 'disabled' : '';
    const meta = v1() && t.funcao !== 'encerramento' ? Object.entries(META).map(([k, r]) => `<label>${r}<input type="text" maxlength="240" data-ed-meta="${k}" value="${esc(ED.vals[t.id]?.['meta:' + k] ?? t[k] ?? '')}" ${trava}></label>`).join('') + `<p class="rdn-dica">Tipo: <b>${esc(t.tipo || '')}</b> · fatos usados: ${esc((t.fatos_usados || []).join(', ') || '—')} · evidências: ${esc((t.evidencias || []).join(', ') || '—')}. Mudar um fato reabre todas as conferências.</p>` : '';
    const travaTxt = v1() ? `<button class="rd-btn peq ${t.travas?.texto ? 'laranja' : 'fantasma'}" data-action="rd-ed-travar" data-k="texto" ${ED.ocupado ? 'disabled' : ''}>${t.travas?.texto ? '🔓 Destravar texto' : '🔒 Travar texto'}</button>` : '';
    const evid = t.layout === 'evidencia' ? `<label>Dado verificado que aparece em destaque<select data-ed-claim ${trava}>${ED.d.dados_verificados.map((x) => `<option value="${esc(x.id)}" ${x.id === t.textos.claim_id ? 'selected' : ''}>${esc(x.valor)} — ${esc(x.texto.slice(0, 70))}${x.atribuicao ? ` (${esc(x.atribuicao)})` : ''}</option>`).join('')}</select></label><p class="rdn-dica">O número vem da fonte conferida: não dá para digitar outro valor.</p>` : '';
    return `<div class="rdn-form">${travaTxt}${evid}${campos.map((c) => { const [r, max, longo] = CAMPOS[c]; const v = valorDe(t, c); return `<label>${r}${longo ? `<textarea rows="3" maxlength="${max + 60}" data-ed-campo="${c}" ${trava}>${esc(v)}</textarea>` : `<input type="text" maxlength="${max + 40}" data-ed-campo="${c}" value="${esc(v)}" ${trava}>`}<small data-ed-cont="${c}">${[...String(v)].length}/${max}</small></label>`; }).join('')}${meta}
      <div class="rd-acoes"><button class="rd-btn laranja" data-action="rd-ed-salvar-texto" ${trava || ED.ocupado ? 'disabled' : ''}>${ED.ocupado === 'texto' ? 'Salvando…' : 'Salvar texto desta tela'}</button></div>
      <details class="rd-det"><summary>Reescrever com a IA (só esta tela)</summary><label>O que você quer mudar? (opcional)<textarea rows="2" maxlength="300" data-ed-instrucao placeholder="Ex.: mais direto, sem termo técnico">${esc(ED.instrucao)}</textarea></label>
      <div class="rd-acoes"><button class="rd-btn" data-action="rd-ed-regenerar" ${trava || ED.ocupado ? 'disabled' : ''}>${ED.ocupado === 'regenerar' ? 'Reescrevendo…' : 'Reescrever a tela inteira'}</button></div><p class="rdn-dica">As outras telas não mudam. Telas bloqueadas ficam como estão.</p></details></div>`;
  }
  function abaFotoV1(t) {
    const trava = t.bloqueada || t.travas?.imagem ? 'disabled' : ''; const b = t.briefing_visual || {}; const imgs = ED.d.imagens_editor || [];
    if (t.layout === 'min_encerramento') return '<p class="rdn-dica">O encerramento usa a sua foto aprovada (Radar → Nova pauta → Foto do Pedro). O rosto não é alterado: só recorte e tamanho.</p>';
    const f = t.foto || {}; const foco = f.foco || null; const cand = (f.candidatos || []);
    const grade = [0.2, 0.5, 0.8].flatMap((y) => [0.2, 0.5, 0.8].map((x) => `<button class="rdn-foco ${foco && Math.abs(foco.x - x) < 0.01 && Math.abs(foco.y - y) < 0.01 ? 'on' : ''}" data-action="rd-ed-foco" data-x="${x}" data-y="${y}" ${trava || !f.imagem_id ? 'disabled' : ''} aria-label="Foco ${x === 0.2 ? 'à esquerda' : x === 0.5 ? 'no centro' : 'à direita'}, ${y === 0.2 ? 'em cima' : y === 0.5 ? 'no meio' : 'embaixo'}"></button>`)).join('');
    const lista = imgs.map((im) => { const c = cand.find((x) => x.id === im.id); return `<div class="rdn-img ${f.imagem_id === im.id ? 'on' : ''}"><button class="rdn-pick" data-action="rd-ed-foto" data-img="${esc(im.id)}" ${trava} aria-pressed="${f.imagem_id === im.id}"><img data-rd-src="${esc(im.url)}?w=360" alt="${esc(im.descricao)}" width="360" height="240"></button>
      <div><b>${esc(im.tipo === 'ia_ilustracao' ? 'Ilustração por IA (só na tela de teste)' : im.relacao === 'ilustrativa' ? 'Ilustrativa (não é da empresa)' : im.papel === 'print' ? 'Print real' : 'Foto do negócio')}</b><small>${esc(im.descricao)}</small>${c ? `<small>${c.aceita ? 'Candidata' : 'Recusada'} (${esc(c.nota)}): ${esc(c.motivos.join('; '))}</small>` : ''}
      <small>${im.origem?.url_pagina ? `<a href="${esc(im.origem.url_pagina)}" target="_blank" rel="noopener noreferrer">origem: ${esc(im.origem.dominio)}</a>` : esc(im.origem?.dominio || 'origem declarada por você')} · ${esc(im.licenca || '')}</small>
      <button class="rd-btn peq ${im.permissao === 'confirmada' ? 'fantasma' : 'laranja'}" data-action="rd-ed-permissao" data-img="${esc(im.id)}" data-sim="${im.permissao === 'confirmada' ? '0' : '1'}">${im.permissao === 'confirmada' ? '✓ Uso confirmado (tocar para desfazer)' : 'Confirmar que posso usar'}</button></div></div>`; }).join('') || '<p class="rdn-dica">Nenhuma imagem foi encontrada nas fontes. Envie uma abaixo: a ferramenta não inventa foto nem print.</p>';
    const fi = t.foto_info;
    return `${f.pendente ? `<div class="rd-aviso">${esc(f.pendente)}</div>` : ''}
      <details class="rd-det"><summary>Briefing visual desta tela</summary><dl class="rd-dl"><div><dt>Mostrar</dt><dd>${esc(b.mostrar || '')}</dd></div><div><dt>O que acrescenta</dt><dd>${esc(b.acrescenta || '')}</dd></div><div><dt>Entidade</dt><dd>${esc(b.entidade || '')}</dd></div><div><dt>Fonte preferida</dt><dd>${esc(b.fonte_preferida || '')}</dd></div><div><dt>Buscas</dt><dd>${esc((b.buscas || []).join(' · '))}</dd></div><div><dt>Enquadramento</dt><dd>${esc(b.enquadramento || '')} · ${esc(b.orientacao || '')} · mín. ${esc(b.resolucao_minima || '')}</dd></div><div><dt>Precisa aparecer</dt><dd>${esc((b.deve_aparecer || []).join(', '))}</dd></div><div><dt>Proibido</dt><dd>${esc((b.proibido || []).join(', '))}</dd></div><div><dt>Sem imagem</dt><dd>${esc(b.sem_imagem || '')}</dd></div></dl></details>
      <div class="rd-acoes"><button class="rd-btn peq ${t.travas?.imagem ? 'laranja' : 'fantasma'}" data-action="rd-ed-travar" data-k="imagem" ${ED.ocupado ? 'disabled' : ''}>${t.travas?.imagem ? '🔓 Destravar imagem e recorte' : '🔒 Travar imagem e recorte'}</button><button class="rd-btn peq ${!f.imagem_id ? 'azul' : 'fantasma'}" data-action="rd-ed-foto" data-img="" ${trava}>Sem foto nesta tela</button></div>
      <div class="rdn-grupo"><b>Ponto de foco do recorte</b><div class="rdn-focos" role="group" aria-label="Ponto de foco">${grade}</div><button class="rd-btn peq ${!foco ? 'azul' : 'fantasma'}" data-action="rd-ed-enq" data-v="auto" ${trava || !f.imagem_id ? 'disabled' : ''}>Automático</button>${fi ? `<small>Imagem ${esc((fi.origem_px || []).join('×'))} px · corte ${esc(fi.corte_pct)}% · ampliação ${esc(String(fi.ampliacao).replace('.', ','))}×</small>` : ''}</div>
      <div class="rdn-imgs">${lista}</div>
      ${uploadHtml()}`;
  }
  function uploadHtml() {
    const u = ED.up;
    return `<details class="rd-det"><summary>Enviar outra imagem</summary><div class="rdn-form">
        <label>Arquivo<input type="file" accept="image/jpeg,image/png,image/webp" data-ed-arquivo></label>
        <label>ou link da imagem<input type="url" inputmode="url" data-ed-up="url" value="${esc(u.url)}" placeholder="https://…"></label>
        <label>O que a imagem mostra<input type="text" maxlength="140" data-ed-up="descricao" value="${esc(u.descricao)}"></label>
        <label>Crédito (vai na legenda e na ficha, não na arte)<input type="text" maxlength="56" data-ed-up="credito" value="${esc(u.credito)}" placeholder="Foto: nome ou site"></label>
        <label>De onde veio e qual a licença<input type="text" maxlength="220" data-ed-up="licenca" value="${esc(u.licenca)}"></label>
        <label>Tipo<select data-ed-up="papel">${[['foto', 'Foto do negócio'], ['print', 'Print real do aplicativo ou site'], ['documento', 'Documento ou reportagem'], ['ilustracao', 'Ilustração (não é da empresa)']].map(([k, r]) => `<option value="${k}" ${u.papel === k ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="rdn-check"><input type="checkbox" data-ed-up="permissao" ${u.permissao ? 'checked' : ''}> Tenho permissão para usar esta imagem</label>
        <div class="rd-acoes"><button class="rd-btn laranja" data-action="rd-ed-enviar-link" ${ED.ocupado ? 'disabled' : ''}>Usar o link nesta tela</button></div><p class="rdn-dica">Produto com fundo transparente (PNG) entra recortado. Print precisa ser verdadeiro e rastreável, nunca recriado por IA.</p></div></details>`;
  }
  function abaFoto(t) {
    if (v1()) return abaFotoV1(t);
    const trava = t.bloqueada ? 'disabled' : '';
    const imgs = ED.d.imagens_editor || [];
    const lista = imgs.length ? imgs.map((im) => `<div class="rdn-img ${t.foto.imagem_id === im.id ? 'on' : ''}"><button class="rdn-pick" data-action="rd-ed-foto" data-img="${esc(im.id)}" ${trava} aria-pressed="${t.foto.imagem_id === im.id}"><img data-rd-src="${esc(im.url)}?w=360" alt="${esc(im.descricao)}" width="360" height="240"></button>
      <div><b>${esc(im.relacao === 'ilustrativa' ? 'Ilustrativa (não é da empresa)' : im.papel === 'print' ? 'Print real do aplicativo' : 'Foto do negócio')}</b><small>${esc(im.descricao)}</small><small>${esc(im.credito || '')}</small>
      <small>${im.origem?.url_pagina ? `<a href="${esc(im.origem.url_pagina)}" target="_blank" rel="noopener noreferrer">origem: ${esc(im.origem.dominio)}</a>` : esc(im.origem?.dominio || 'origem declarada por você')} · ${esc(im.licenca || '')}</small>
      <button class="rd-btn peq ${im.permissao === 'confirmada' ? 'fantasma' : 'laranja'}" data-action="rd-ed-permissao" data-img="${esc(im.id)}" data-sim="${im.permissao === 'confirmada' ? '0' : '1'}">${im.permissao === 'confirmada' ? '✓ Uso confirmado (tocar para desfazer)' : 'Confirmar que posso usar'}</button></div></div>`).join('') : '<p class="rdn-dica">Nenhuma imagem foi encontrada nas fontes. Envie uma abaixo: a ferramenta não inventa foto nem print.</p>';
    const enq = [['auto', 'Automático'], ['centro', 'Centro'], ['topo', 'Topo'], ['baixo', 'Base'], ['esquerda', 'Esquerda'], ['direita', 'Direita']]; const formas = [['', 'Padrão da tela'], ['retangulo', 'Retângulo'], ['arco', 'Arco'], ['circulo', 'Círculo'], ['inclinado', 'Moldura inclinada']];
    const u = ED.up;
    return `<p class="rdn-dica">Precisa mostrar: <b>${esc(t.imagem_precisa || 'imagem real')}</b>.${t.sem_imagem ? ' <b class="rdn-alerta">Esta tela está sem imagem adequada.</b>' : ''}</p>
      <div class="rd-acoes"><button class="rd-btn ${!t.foto.imagem_id ? 'azul' : 'fantasma'}" data-action="rd-ed-foto" data-img="" ${trava}>Sem foto nesta tela</button></div>
      <div class="rdn-imgs">${lista}</div>
      <div class="rdn-grupo"><b>Enquadramento</b><div class="rdn-opcoes">${enq.map(([k, r]) => `<button class="rd-btn peq ${(t.foto.enq || 'auto') === k ? 'azul' : 'fantasma'}" data-action="rd-ed-enq" data-v="${k}" ${trava}>${r}</button>`).join('')}</div></div>
      <div class="rdn-grupo"><b>Formato da foto</b><div class="rdn-opcoes">${formas.map(([k, r]) => `<button class="rd-btn peq ${(t.foto.forma || '') === k ? 'azul' : 'fantasma'}" data-action="rd-ed-forma" data-v="${k}" ${trava}>${r}</button>`).join('')}</div></div>
      <details class="rd-det" ${imgs.length ? '' : 'open'}><summary>Enviar outra imagem</summary><div class="rdn-form">
        <label>Arquivo<input type="file" accept="image/jpeg,image/png,image/webp" data-ed-arquivo></label>
        <label>ou link da imagem<input type="url" inputmode="url" data-ed-up="url" value="${esc(u.url)}" placeholder="https://…"></label>
        <label>O que a imagem mostra<input type="text" maxlength="140" data-ed-up="descricao" value="${esc(u.descricao)}"></label>
        <label>Crédito (aparece na arte)<input type="text" maxlength="56" data-ed-up="credito" value="${esc(u.credito)}" placeholder="Foto: nome ou site"></label>
        <label>De onde veio e qual a licença<input type="text" maxlength="220" data-ed-up="licenca" value="${esc(u.licenca)}"></label>
        <label>Tipo<select data-ed-up="papel">${[['foto', 'Foto do negócio'], ['print', 'Print real do aplicativo ou site'], ['documento', 'Documento ou reportagem'], ['ilustracao', 'Ilustração (não é da empresa)']].map(([k, r]) => `<option value="${k}" ${u.papel === k ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="rdn-check"><input type="checkbox" data-ed-up="permissao" ${u.permissao ? 'checked' : ''}> Tenho permissão para usar esta imagem</label>
        <div class="rd-acoes"><button class="rd-btn laranja" data-action="rd-ed-enviar-link" ${ED.ocupado ? 'disabled' : ''}>Usar o link nesta tela</button></div><p class="rdn-dica">Print precisa ser verdadeiro e rastreável: ele vem do app ou do site, nunca recriado por IA.</p></div></details>`;
  }
  function abaComp(t) {
    const opts = t.composicoes.map((k) => `<button class="rd-btn ${t.layout === k ? 'azul' : 'fantasma'}" data-action="rd-ed-layout" data-v="${k}" ${t.bloqueada || ED.ocupado ? 'disabled' : ''} aria-pressed="${t.layout === k}">${ROT_LAYOUT[k]}</button>`).join('');
    const e = t.estilo || {};
    const estilo = t.layout === 'foto_documental' ? `<div class="rdn-grupo"><b>Cor do título</b><div class="rdn-opcoes">${[['preto', 'Preto'], ['azul', 'Azul']].map(([k, r]) => `<button class="rd-btn peq ${(e.cor || 'preto') === k ? 'azul' : 'fantasma'}" data-action="rd-ed-estilo" data-k="cor" data-v="${k}">${r}</button>`).join('')}</div></div>
      <div class="rdn-grupo"><b>Marca no destaque</b><div class="rdn-opcoes">${[['nenhuma', 'Nenhuma'], ['sublinhado', 'Sublinhado'], ['circulo', 'Círculo']].map(([k, r]) => `<button class="rd-btn peq ${(e.marca || 'nenhuma') === k ? 'azul' : 'fantasma'}" data-action="rd-ed-estilo" data-k="marca" data-v="${k}">${r}</button>`).join('')}</div></div>` : (t.layout === 'manchete_produto' ? `<div class="rdn-grupo"><b>Variação</b><div class="rdn-opcoes">${[['meia_lua', 'Produto no sol'], ['canto', 'Palavra gigante']].map(([k, r]) => `<button class="rd-btn peq ${(t.variante || 'meia_lua') === k ? 'azul' : 'fantasma'}" data-action="rd-ed-variante" data-v="${k}">${r}</button>`).join('')}</div></div>` : '');
    return `<p class="rdn-dica">Função desta tela: <b>${esc(t.funcao_rotulo)}</b>. A composição muda o desenho; o texto continua o mesmo.</p><div class="rdn-opcoes">${opts}</div>${estilo}`;
  }
  function abaCapas() {
    const cs = ED.d.capas || [];
    return `<p class="rdn-dica">Três ganchos com ângulos diferentes. Escolha o gancho; as outras telas não mudam.${v1() ? ' A pontuação soma clareza, especificidade, relevância, sustentação nos fatos e entrega (sem bônus para número ou superlativo).' : ''}</p>${cs.map((c) => `<div class="rdn-capa ${ED.d.capa_escolhida === c.id ? 'on' : ''}"><b>${esc((ED.d.angulos || {})[c.angulo] || c.angulo)}${c.pontuacao != null ? ` · ${esc(c.pontuacao)} pontos` : ''}</b>${c.scores ? `<small>${esc(Object.entries(c.scores).map(([k, n]) => `${k} ${n}`).join(' · '))}</small>` : ''}
      <label>Título<textarea rows="2" data-ed-capa="${esc(c.id)}" data-campo="titulo">${esc(ED.capas[c.id]?.titulo ?? c.titulo)}</textarea></label>${v1() ? '' : `<label>Apoio<input type="text" data-ed-capa="${esc(c.id)}" data-campo="apoio" value="${esc(ED.capas[c.id]?.apoio ?? c.apoio ?? '')}"></label>`}
      <div class="rd-acoes"><button class="rd-btn ${ED.d.capa_escolhida === c.id ? 'azul' : 'laranja'}" data-action="rd-ed-capa" data-capa="${esc(c.id)}" ${ED.ocupado ? 'disabled' : ''}>${ED.d.capa_escolhida === c.id ? 'Capa escolhida: salvar alterações' : 'Usar esta capa'}</button></div></div>`).join('')}`;
  }
  function abaLegenda() {
    const v = ED.legenda ?? ED.d.legenda_texto ?? '';
    return `<div class="rdn-form"><label>Legenda do post<textarea rows="10" data-ed-legenda maxlength="1200">${esc(v)}</textarea><small data-ed-cont="legenda">${[...v].length}/700 recomendado</small></label>
      <div class="rd-acoes"><button class="rd-btn laranja" data-action="rd-ed-salvar-legenda" ${ED.ocupado ? 'disabled' : ''}>Salvar legenda</button></div><p class="rdn-dica">A legenda complementa o carrossel. Até 3 hashtags, sem obrigação de usar.</p></div>`;
  }
  function abaRevisao() {
    const v = ED.d.validacao || { bloqueios: [], sugestoes: [] }; const f = ED.d.ficha;
    const lista = (arr, cls) => arr.map((x) => `<li class="${cls}">${x.tela ? `<button class="rdn-link" data-action="rd-ed-tela" data-n="${x.tela}">Tela ${x.tela}</button> ` : ''}${esc(x.mensagem)}</li>`).join('');
    return `<h4 class="rdn-h">Bloqueios <span>${v.bloqueios.length}</span></h4>${v.bloqueios.length ? `<ul class="rdn-lista">${lista(v.bloqueios, 'b')}</ul>` : '<p class="rdn-ok">Nenhum bloqueio: fatos com fonte, textos cabem, arquivos conferidos.</p>'}
      <h4 class="rdn-h">Sugestões editoriais <span>${v.sugestoes.length}</span></h4><p class="rdn-dica">Julgamento editorial: você decide. Não é nota de viralização (ninguém consegue prever isso) e não esconde falha factual.</p>${v.sugestoes.length ? `<ul class="rdn-lista">${lista(v.sugestoes, 's')}</ul>` : '<p class="rdn-ok">Sem sugestões.</p>'}
      ${f ? `<details class="rd-det"><summary>Pesquisa da história</summary><dl class="rd-dl"><div><dt>Problema que resolve</dt><dd>${esc(f.problema)}</dd></div><div><dt>Quem compra e por quê</dt><dd>${esc([f.quem_compra, f.por_que_compra].filter(Boolean).join(' — '))}</dd></div><div><dt>Como cobra</dt><dd>${esc(f.como_cobra)}</dd></div><div><dt>Evidência</dt><dd>${(f.evidencia || []).map((e) => `${esc(e.valor || '')} ${esc(e.afirmacao)} ${e.atribuicao ? `(${esc(e.atribuicao)})` : ''} — <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.veiculo)}</a>`).join('<br>') || '—'}</dd></div><div><dt>O que surpreende</dt><dd>${esc(f.surpresa)}</dd></div><div><dt>Dificuldades</dt><dd>${(f.dificuldades || []).map((d) => `${esc(d.texto)}${d.url ? ` — <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.veiculo)}</a>${d.fonte_unica ? ' (fonte única, atribuída na tela)' : ''}` : ''}`).join('<br>') || '—'}</dd></div><div><dt>Para testar no Brasil (hipótese)</dt><dd>${esc(f.inspiracao_brasil)}</dd></div>${(f.lacunas || []).length ? `<div><dt>Lacunas</dt><dd>${f.lacunas.map(esc).join('<br>')}</dd></div>` : ''}</dl></details>` : ''}
      <details class="rd-det"><summary>Versões (${(ED.d.versoes || []).length})</summary><ul class="rdn-lista">${(ED.d.versoes || []).slice().reverse().map((x) => `<li>v${x.v} · ${esc(new Date(x.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))} · ${esc(x.motivo)} <button class="rd-btn peq fantasma" data-action="rd-ed-restaurar" data-v="${x.v}">Restaurar</button></li>`).join('')}</ul></details>`;
  }

  function render() {
    if (!ED.id || !ED.d) return '';
    const d = ED.d; const t = tela(); if (!t) return '';
    const v = d.validacao || { bloqueios: [], sugestoes: [] }; const busy = ED.ocupado;
    const painel = { texto: abaTexto, foto: abaFoto, comp: abaComp, capas: abaCapas, legenda: abaLegenda, revisao: abaRevisao }[ED.aba](t);
    return `<div class="rdn" role="dialog" aria-modal="true" aria-label="Editar carrossel"><div class="rdn-topo"><button class="rd-btn fantasma peq" data-action="rd-ed-fechar">‹ Fechar</button><div class="rdn-tit"><b>${esc(d.nome || 'Carrossel')}</b><small>${esc(d.serie_nome || '')} · v${esc(d.versao)}</small></div>
      <div class="rdn-estado"><span class="rd-tag ${v.bloqueios.length ? 'alerta' : 'laranja'}">${v.bloqueios.length ? `${v.bloqueios.length} bloqueio(s)` : 'sem bloqueios'}</span>${v.sugestoes.length ? `<span class="rd-tag suave">${v.sugestoes.length} sugestão(ões)</span>` : ''}</div></div>
      <div class="rdn-corpo">
        <div class="rdn-prev ${busy ? 'ocupado' : ''}"><img data-rd-src="${esc(t.url)}?w=1080&h=${esc(t.sha)}" alt="Tela ${t.n} de ${d.telas.length}: ${esc(t.funcao_rotulo)}" width="1080" height="1350">${busy ? '<div class="rdn-espera" role="status">Atualizando só esta tela…</div>' : ''}</div>
        <p class="rdn-meta">Tela ${t.n} de ${d.telas.length} · ${esc(t.funcao_rotulo)} · ${esc(ROT_LAYOUT[t.layout])} · ${t.palavras} palavras${t.bloqueada ? ' · 🔒 bloqueada' : ''}</p>
        ${!t.cabe ? `<div class="rd-aviso erro">${t.problemas.map(esc).join('<br>')}</div>` : ''}${(t.avisos || []).length ? `<div class="rd-aviso">${t.avisos.map(esc).join('<br>')}</div>` : ''}${d.legado && d.template ? '<div class="rd-aviso">Modelo antigo: dá para editar e exportar. Para o padrão novo, use “Criar nova versão no padrão novo” na fila.</div>' : ''}
        ${miniaturas()}
        <div class="rd-acoes rdn-ferr"><button class="rd-btn peq fantasma" data-action="rd-ed-mover" data-d="-1" ${t.n === 1 || busy ? 'disabled' : ''}>◀ Mover para trás</button><button class="rd-btn peq fantasma" data-action="rd-ed-mover" data-d="1" ${t.n === d.telas.length || busy ? 'disabled' : ''}>Mover para frente ▶</button>
          <button class="rd-btn peq ${t.bloqueada ? 'laranja' : 'fantasma'}" data-action="rd-ed-bloquear" ${busy ? 'disabled' : ''}>${t.bloqueada ? '🔓 Desbloquear' : '🔒 Bloquear (aprovada)'}</button>${t.remover_permitido ? `<button class="rd-btn peq risco" data-action="rd-ed-remover" ${busy ? 'disabled' : ''}>Tirar esta tela</button>` : ''}</div>
        <div class="rdn-abas" role="tablist">${ABAS.map(([k, r]) => `<button role="tab" data-action="rd-ed-aba" data-aba="${k}" aria-selected="${ED.aba === k}" class="${ED.aba === k ? 'on' : ''}">${r}${k === 'revisao' && v.bloqueios.length ? ` <i>${v.bloqueios.length}</i>` : ''}</button>`).join('')}</div>
        <div class="rdn-painel">${painel}</div>
      </div>
      <div class="rdn-rodape"><button class="rd-btn azul" data-action="rd-ed-zip" ${v.bloqueios.length || busy ? 'disabled' : ''} title="${v.bloqueios.length ? 'Corrija os bloqueios para exportar' : ''}">Baixar ZIP</button>${d.estado === 'aprovado' ? '<span class="rd-tag laranja">Aprovado</span>' : `<button class="rd-btn laranja" data-action="rd-ed-aprovar" ${v.bloqueios.length || busy ? 'disabled' : ''}>Aprovar</button>`}</div></div>`;
  }

  // ── Ações ─────────────────────────────────────────────────────────────────────
  async function acao(a, el, c) {
    try {
      switch (a) {
        case 'rd-ed-abrir': { ED.id = el.dataset.id; ED.n = 1; ED.aba = 'texto'; ED.vals = {}; ED.d = null; c.render(); const r = await c.api(`/api/radar/carrosseis/${encodeURIComponent(ED.id)}`); ED.d = r; c.render(); break; }
        case 'rd-ed-fechar': ED.id = null; ED.d = null; await window.RadarUI.carregar(c, { forcar: true }); c.render(); break;
        case 'rd-ed-tela': ED.n = Number(el.dataset.n); if (a && ED.aba === 'revisao' && !el.closest('.rdn-lista')) ED.aba = ED.aba; c.render(); break;
        case 'rd-ed-aba': ED.aba = el.dataset.aba; c.render(); break;
        case 'rd-ed-salvar-texto': {
          const t = tela(); const textos = {}; document.querySelectorAll('[data-ed-campo]').forEach((i) => { textos[i.dataset.edCampo] = i.value; });
          const cl = document.querySelector('[data-ed-claim]'); if (cl) textos.claim_id = cl.value;
          const meta = {}; document.querySelectorAll('[data-ed-meta]').forEach((i) => { meta[i.dataset.edMeta] = i.value; });
          await operar(c, 'texto', () => api(c, `/tela/${t.n}`, { textos, ...(Object.keys(meta).length ? { meta } : {}) }), 'Texto salvo. Só esta tela foi refeita.'); break;
        }
        case 'rd-ed-regenerar': { const t = tela(); const instrucao = document.querySelector('[data-ed-instrucao]')?.value || ''; ED.instrucao = ''; await operar(c, 'regenerar', () => api(c, `/tela/${t.n}/regenerar`, { instrucao }), 'Tela reescrita. As outras ficaram como estavam.'); break; }
        case 'rd-ed-bloquear': { const t = tela(); await operar(c, 'bloquear', () => api(c, `/tela/${t.n}`, { bloqueada: !t.bloqueada }), t.bloqueada ? 'Tela desbloqueada.' : 'Tela bloqueada: nada a altera sem você desbloquear.'); break; }
        case 'rd-ed-mover': {
          const n = ED.n; const j = n + Number(el.dataset.d); const ordem = ED.d.telas.map((x) => x.n); [ordem[n - 1], ordem[j - 1]] = [ordem[j - 1], ordem[n - 1]];
          await operar(c, 'mover', () => api(c, '/reordenar', { ordem }), 'Ordem alterada; a numeração foi atualizada.'); ED.n = j; c.render(); break;
        }
        case 'rd-ed-remover': { const t = tela(); if (!confirm(`Tirar a tela ${t.n} (${t.funcao_rotulo})? O carrossel fica com ${ED.d.telas.length - 1} telas.`)) break; await operar(c, 'remover', () => api(c, '/remover', { n: t.n }), 'Tela removida.'); break; }
        case 'rd-ed-foto': { const t = tela(); await operar(c, 'foto', () => api(c, `/tela/${t.n}`, { foto: { imagem_id: el.dataset.img || null } }), 'Foto trocada nesta tela.'); break; }
        case 'rd-ed-foco': { const t = tela(); await operar(c, 'foto', () => api(c, `/tela/${t.n}`, { foto: { foco: { x: Number(el.dataset.x), y: Number(el.dataset.y) } } }), 'Recorte ajustado. O texto não mudou.'); break; }
        case 'rd-ed-travar': { const t = tela(); const k = el.dataset.k; const atual = !!t.travas?.[k]; await operar(c, 'travar', () => api(c, `/tela/${t.n}`, { travas: { [k]: !atual } }), atual ? 'Destravado.' : (k === 'texto' ? 'Texto travado: a IA não reescreve esta tela.' : 'Imagem e recorte travados.')); break; }
        case 'rd-ed-enq': { const t = tela(); await operar(c, 'foto', () => api(c, `/tela/${t.n}`, { foto: { enq: el.dataset.v } })); break; }
        case 'rd-ed-forma': { const t = tela(); await operar(c, 'foto', () => api(c, `/tela/${t.n}`, { foto: { forma: el.dataset.v || null } })); break; }
        case 'rd-ed-permissao': await operar(c, 'permissao', () => api(c, `/imagens/${encodeURIComponent(el.dataset.img)}/permissao`, { confirmada: el.dataset.sim === '1' }), 'Registrado.'); break;
        case 'rd-ed-enviar-link': { const t = tela(); if (!ED.up.url) { c.toast('Cole o link da imagem ou escolha um arquivo.'); break; } await operar(c, 'foto', () => api(c, '/imagens', { ...ED.up, tela: t.n }), 'Imagem adicionada e aplicada nesta tela.'); break; }
        case 'rd-ed-layout': { const t = tela(); await operar(c, 'comp', () => api(c, `/tela/${t.n}`, { layout: el.dataset.v }), 'Composição trocada.'); break; }
        case 'rd-ed-estilo': { const t = tela(); await operar(c, 'comp', () => api(c, `/tela/${t.n}`, { estilo: { [el.dataset.k]: el.dataset.v } })); break; }
        case 'rd-ed-variante': { const t = tela(); await operar(c, 'comp', () => api(c, `/tela/${t.n}`, { variante: el.dataset.v })); break; }
        case 'rd-ed-capa': { const id = el.dataset.capa; const ed = ED.capas[id] || {}; await operar(c, 'capa', () => api(c, '/capa', { capa_id: id, escolher: id, ...ed }), 'Capa aplicada na tela 1.'); break; }
        case 'rd-ed-salvar-legenda': { const texto = document.querySelector('[data-ed-legenda]')?.value || ''; await operar(c, 'legenda', () => api(c, '/legenda', { texto }), 'Legenda salva.'); break; }
        case 'rd-ed-restaurar': if (!confirm('Restaurar esta versão? O estado atual continua guardado no histórico.')) break; await operar(c, 'restaurar', () => api(c, '/restaurar', { v: Number(el.dataset.v) }), 'Versão restaurada.'); break;
        case 'rd-ed-zip': { const x = ED.d.zip; const nome = x?.nome || 'carrossel.zip'; ED.ocupado = 'zip'; c.render(); try { await U().baixar(`/api/radar/carrosseis/${encodeURIComponent(ED.id)}/zip`, nome, { semCache: true }); c.toast('Download iniciado.'); } catch (e) { c.toast(e.message); } finally { ED.ocupado = null; c.render(); } break; }
        case 'rd-ed-aprovar': ED.ocupado = 'aprovar'; c.render(); try { await c.api(`/api/radar/carrosseis/${encodeURIComponent(ED.id)}/decisao`, { method: 'POST', body: { acao: 'aprovar' } }); const r = await c.api(`/api/radar/carrosseis/${encodeURIComponent(ED.id)}`); ED.d = r; const l = window.RadarUI._st.carrosseis; const i = l.findIndex((x) => x.id === ED.id); if (i >= 0) l[i] = { ...l[i], ...r }; c.toast('Aprovado. Baixe o ZIP e poste quando quiser: nada é publicado sozinho.'); } catch (e) { c.toast(e.message); } finally { ED.ocupado = null; c.render(); } break;
        default: return false;
      }
    } catch (e) { ED.ocupado = null; c.toast(e.message || 'Não foi possível concluir.'); c.render(); }
    return true;
  }

  // Digitação: guarda os valores sem redesenhar (a tela inteira é refeita a cada ação e perderia o foco).
  const root = document.getElementById('esteira');
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.edCampo) { const t = tela(); if (!t) return; (ED.vals[t.id] ||= {})[el.dataset.edCampo] = el.value; const max = CAMPOS[el.dataset.edCampo][1]; const s = root.querySelector(`[data-ed-cont="${el.dataset.edCampo}"]`); if (s) { const n = [...el.value].length; s.textContent = `${n}/${max}`; s.classList.toggle('passou', n > max); } }
    else if (el.dataset.edMeta) { const t = tela(); if (t) (ED.vals[t.id] ||= {})[`meta:${el.dataset.edMeta}`] = el.value; }
    else if (el.dataset.edInstrucao !== undefined) ED.instrucao = el.value;
    else if (el.dataset.edLegenda !== undefined) { ED.legenda = el.value; const s = root.querySelector('[data-ed-cont="legenda"]'); if (s) s.textContent = `${[...el.value].length}/700 recomendado`; }
    else if (el.dataset.edCapa) { (ED.capas[el.dataset.edCapa] ||= {})[el.dataset.campo] = el.value; }
    else if (el.dataset.edUp) { ED.up[el.dataset.edUp] = el.type === 'checkbox' ? el.checked : el.value; }
  });
  root.addEventListener('change', async (ev) => {
    const el = ev.target; if (el.dataset.edUp) { ED.up[el.dataset.edUp] = el.type === 'checkbox' ? el.checked : el.value; return; }
    if (el.dataset.edArquivo === undefined || !el.files?.[0]) return;
    const f = el.files[0]; const c = ctx(); const t = tela(); if (!t) return;
    if (f.size > 12 * 1024 * 1024) { c.toast('Imagem grande demais (máximo 12 MB).'); return; }
    const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(f); });
    await operar(c, 'foto', () => api(c, '/imagens', { arquivo_base64: b64, ...ED.up, descricao: ED.up.descricao || f.name, tela: t.n }), 'Imagem adicionada e aplicada nesta tela.');
  });

  window.RadarEditor = { render, acao, _ed: ED };
})();
