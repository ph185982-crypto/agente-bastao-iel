// Reciclar: botão com duas opções (formato original / nosso formato branco ou preto).
// Aba "Reciclar" (Radar de Reciclagem): o que viralizou nas contas de empreendedorismo vigiadas, com índice de
// viralidade (VL), tema, mecanismo e tese neutra; tendências do dia no Google; e "Reciclar como…" carrossel, post ou reel.
// O app só MOSTRA e comanda; coleta, classificação e escrita rodam no servidor. Nunca copiamos o texto de terceiros:
// o que aparece aqui é tema/tese/ponte escritos pela IA e os números públicos do post. Nada é publicado sozinho.
// Sub-seção "Em alta no Brasil" (rc2-ea-*): o que está bombando agora no Brasil, sem filtro de nicho, para ideia de topo de funil.
// Ações com prefixo rc2- (rc- já é dos Recortes).
(function () {
  'use strict';
  const ST = {
    carregando: false, carregou: false, erro: null, itens: [], total: 0, estado: null, tendencias: null, tela: 'lista',
    filtro: { mecanismo: '', idioma: '', min_vl: '2', dias: '30' }, menu: null, ocupado: {}, roteiro: null, producao: null,
    contas: null, contasForm: { handle: '', nome: '', pais: 'BR', idioma: 'pt', por_que: '', canal: '', canal_nome: '', canal_pais: 'BR', canal_idioma: 'pt' }, contasAlterado: false, autoriza: null, autForm: {},
    // Sub-seção "Em alta no Brasil" (sem filtro de nicho). secao: 'teses' (o Radar de sempre) | 'em_alta'.
    secao: 'teses', ea: { carregando: false, carregou: false, erro: null, itens: [], total: 0, por_fonte: {}, estado: null, fonte: '', menu: null, contas: null, verContas: false, novo: '', novoCat: 'entretenimento' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Sao_Paulo';
  const dh = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const dia = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }); };
  const num = (n) => (n == null ? '—' : Number(n) >= 1000000 ? `${(Number(n) / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : Number(n) >= 1000 ? `${(Number(n) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : Number(n).toLocaleString('pt-BR'));
  const vlFmt = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`);
  const link = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const ctxAtual = () => window.Mesa.ctx();
  const PAIS = { BR: 'Brasil', US: 'EUA', GB: 'Reino Unido', MX: 'México', CO: 'Colômbia', ES: 'Espanha', CA: 'Canadá', AR: 'Argentina', PT: 'Portugal' };
  const IDIOMA = { pt: 'português', en: 'inglês', es: 'espanhol' };
  const MEC = { identidade: 'Identidade', nostalgia: 'Nostalgia', historia: 'História', lista_erros: 'Lista de erros', numero: 'Número', confissao: 'Confissão', polemica: 'Polêmica', pergunta: 'Pergunta', bastidor: 'Bastidor' };
  const TIPO = { reel: 'Reel', carrossel: 'Carrossel', imagem: 'Imagem', video: 'Vídeo', short: 'Short' };

  // ── Dados ───────────────────────────────────────────────────────────────────
  const query = () => { const f = ST.filtro; const p = new URLSearchParams({ dias: f.dias, min_vl: f.min_vl, so_imagens: '1', pendentes: '1' }); /* reciclado ou descartado não aparece mais */ if (f.mecanismo) p.set('mecanismo', f.mecanismo); if (f.idioma) p.set('idioma', f.idioma); return p.toString(); };
  async function carregar(ctx, forcar) {
    const f = forcar && typeof forcar === 'object' ? forcar.forcar : forcar;
    if (ST.carregando || (ST.carregou && !f)) return;
    ST.carregando = true; ctx.render();
    try {
      const [lista, tend] = await Promise.all([ctx.api(`/api/reciclagem?${query()}`), ctx.api('/api/reciclagem/tendencias').catch(() => null)]);
      ST.itens = lista.itens || []; ST.total = lista.total || 0; ST.estado = lista.estado || null; ST.tendencias = tend; ST.erro = null;
    } catch (e) { ST.erro = e.message || 'Não consegui abrir a Reciclagem.'; }
    ST.carregando = false; ST.carregou = true; ctx.render();
  }
  async function recarregarLista(ctx) {
    try { const r = await ctx.api(`/api/reciclagem?${query()}`); ST.itens = r.itens || []; ST.total = r.total || 0; ST.estado = r.estado || ST.estado; } catch (e) { ctx.toast(e.message); }
    ctx.render();
  }
  async function coletar(ctx) {
    if (ST.ocupado.coletar) return;
    ST.ocupado.coletar = true; ctx.render();
    try {
      const r = await ctx.api('/api/reciclagem/coletar', { method: 'POST', body: {} });
      ctx.toast(`Coleta feita: ${r.instagram?.contas_lidas || 0} contas lidas, ${r.novos || 0} ${r.novos === 1 ? 'tese nova' : 'teses novas'}${r.em_alta ? `, ${r.em_alta} em alta` : ''}.`);
      await carregar(ctx, { forcar: true });
    } catch (e) { ctx.toast(e.status === 429 ? 'A coleta já rodou há pouco. Espere alguns minutos.' : e.message); }
    delete ST.ocupado.coletar; ctx.render();
  }
  // Carrossel e post entram no pipeline "top": o app conduz os passos (o servidor também avança sozinho pelo piloto).
  async function conduzirTop(ctx, id, titulo) {
    ST.producao = { id, titulo, rotulo: 'Começando…' }; ctx.render();
    try {
      for (let i = 0; i < 60; i++) {
        let r;
        try { r = await ctx.api(`/api/top/carrosseis/${encodeURIComponent(id)}/passo`, { method: 'POST', body: {} }); }
        catch (e) { if (e.status === 429) { await new Promise((x) => setTimeout(x, 8000)); continue; } throw e; }
        ST.producao = { id, titulo, rotulo: r.rotulo || r.etapa || '…', estado: r.estado }; ctx.render();
        if (r.concluido || r.estado !== 'em_andamento') {
          if (r.estado === 'concluida') ctx.toast('Pronto para aprovar. Veja em “Aprovar”.');
          else ctx.toast(`A produção parou: ${r.motivo || r.estado || 'veja em Aprovar'}`);
          break;
        }
        await new Promise((x) => setTimeout(x, r.ocupado ? 4000 : 1200));
      }
    } catch (e) { ctx.toast(`A produção continua no servidor (${e.message}).`); }
    ST.producao = null; ctx.render();
  }
  async function reciclar(ctx, id, formato, mesmaEstrutura = false) {
    if (ST.ocupado[id]) return;
    ST.ocupado[id] = formato; ST.menu = null; ctx.render();
    try {
      const r = await ctx.api(`/api/reciclagem/${encodeURIComponent(id)}/reciclar`, { method: 'POST', body: { formato, mesma_estrutura: mesmaEstrutura } });
      const item = ST.itens.find((x) => x.id === id); if (item) item.reciclado = [...(item.reciclado || []), { formato, conteudo_id: r.id, em: new Date().toISOString() }];
      if (formato === 'reel') { ST.roteiro = { id: r.id, roteiro: r.roteiro, titulo: r.titulo, duracao: r.duracao_estimada_s, mente: r.mente, tentativas: r.tentativas }; ctx.toast('Roteiro pronto.'); }
      else { ctx.toast(`${formato === 'estatico' ? 'Post' : 'Carrossel'} em produção: a tese vira texto do Pedro com fatos brasileiros.`); delete ST.ocupado[id]; ctx.render(); await conduzirTop(ctx, r.id, r.titulo); return; }
    } catch (e) { ctx.toast(e.message || 'Não foi possível reciclar.'); }
    delete ST.ocupado[id]; ctx.render();
  }
  async function carregarContas(ctx) {
    try { ST.contas = await ctx.api('/api/reciclagem/contas'); ST.contasAlterado = false; } catch (e) { ctx.toast(e.message); }
    ctx.render();
  }
  async function salvarContas(ctx) {
    if (!ST.contas || ST.ocupado.contas) return;
    ST.ocupado.contas = true; ctx.render();
    try { ST.contas = await ctx.api('/api/reciclagem/contas', { method: 'PUT', body: ST.contas.config }); ST.contasAlterado = false; ctx.toast('Contas salvas. Valem a partir da próxima coleta.'); }
    catch (e) { ctx.toast(e.message); }
    delete ST.ocupado.contas; ctx.render();
  }

  // ── Telas ───────────────────────────────────────────────────────────────────
  function painel() {
    const e = ST.estado; if (!e) return '';
    const u = e.ultima_coleta; const emAlta = ST.itens.filter((i) => i.em_alta).length;
    const tile = (r, v, s, peq) => `<div class="rc2-stat"><span>${r}</span><b class="${peq ? 'peq' : ''}">${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
    return `<div class="rc2-stats" role="list">
      ${tile('Última coleta', u ? dh(u.em) : 'Nenhuma ainda', u ? `${u.instagram?.contas_lidas ?? 0} contas · ${u.youtube?.pulado ? 'YouTube desligado' : `${u.youtube?.canais_lidos ?? 0} canais`}` : 'Toque em “Atualizar agora”', true)}
      ${tile('Em alta', String(emAlta), `VL ≥ ${e.vl_alta || 3} neste filtro`)}
      ${tile('Próxima coleta', '09:00', 'de Brasília, todo dia', true)}
    </div>`;
  }
  function tendenciasHtml() {
    const t = ST.tendencias; if (!t || !(t.tendencias || []).length) return '';
    return `<section class="rc2-trends" aria-labelledby="rc2-tr-t"><div class="rc2-h2"><h2 id="rc2-tr-t">Em alta hoje no Google</h2><span>Brasil · ${dh(t.em)}</span></div>
      <div class="rc2-chips">${t.tendencias.slice(0, 14).map((x) => `<a class="rc2-trend ${x.itens?.length ? 'liga' : ''}" href="${esc(link(x.link))}" target="_blank" rel="noopener noreferrer" title="${esc((x.noticias || [])[0] || '')}">${esc(x.titulo)}${x.trafego ? `<small>${esc(x.trafego)}</small>` : ''}${x.itens?.length ? `<i aria-label="${x.itens.length} tese(s) ligadas">★</i>` : ''}</a>`).join('')}</div>
      <p class="rc2-meta">★ = assunto que bate com uma tese da lista. Tendência é tempero: a tese é que decide.</p></section>`;
  }
  function filtros() {
    const f = ST.filtro; const chip = (k, v, r) => `<button class="rc2-chip" data-action="rc2-filtro" data-k="${k}" data-v="${esc(v)}" aria-pressed="${f[k] === v}">${r}</button>`;
    return `<div class="rc2-filtros">
      <div class="rc2-chips" role="group" aria-label="Mecanismo">${chip('mecanismo', '', 'Todos')}${Object.entries(MEC).map(([k, r]) => chip('mecanismo', k, r)).join('')}</div>
      <div class="rc2-linha"><div class="rc2-chips" role="group" aria-label="Idioma">${chip('idioma', '', 'Todos os idiomas')}${Object.entries(IDIOMA).map(([k, r]) => chip('idioma', k, r[0].toUpperCase() + r.slice(1))).join('')}</div>
      <label class="rc2-sel">VL mínimo <select data-action="rc2-sel" data-k="min_vl">${['1.5', '2', '3', '5'].map((v) => `<option value="${v}" ${f.min_vl === v ? 'selected' : ''}>${v.replace('.', ',')}×</option>`).join('')}</select></label>
      <label class="rc2-sel">Período <select data-action="rc2-sel" data-k="dias">${[['7', '7 dias'], ['14', '14 dias'], ['30', '30 dias']].map(([v, r]) => `<option value="${v}" ${f.dias === v ? 'selected' : ''}>${r}</option>`).join('')}</select></label></div></div>`;
  }
  // Galeria do post original (deslize para o lado) e a legenda original, para ver o conteúdo antes de copiar.
  function galeria(i) {
    const ms = (i.midias || []).filter((u) => /^(https:\/\/|data:image\/)/.test(u));
    const fotos = ms.length ? `<div class="rc2-galeria" role="region" aria-label="Imagens do post (deslize para o lado)" tabindex="0">${ms.map((u, k) => `<img src="${esc(u)}" alt="Slide ${k + 1} de ${ms.length}" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('quebrada')">`).join('')}</div>${ms.length > 1 ? `<p class="rc2-meta">${ms.length} imagens · deslize para o lado</p>` : ''}` : '<p class="rc2-meta">Imagens aparecem a partir da próxima coleta.</p>';
    const leg = i.legenda ? `<details class="rc2-legenda"><summary>Legenda original</summary><p>${esc(i.legenda)}</p></details>` : '';
    return fotos + leg;
  }
  function cartao(i) {
    const oc = ST.ocupado[i.id]; const menu = ST.menu === i.id; const c = i.conta || {};
    const metricas = [i.curtidas != null ? `${num(i.curtidas)} curtidas` : null, i.comentarios != null ? `${num(i.comentarios)} comentários` : null, i.visualizacoes != null ? `${num(i.visualizacoes)} views` : null, i.seguidores != null ? `${num(i.seguidores)} seguidores` : null].filter(Boolean).join(' · ');
    const ja = (i.reciclado || []).slice(-3);
    return `<article class="rc2-card ${i.em_alta ? 'alta' : ''}" data-rc2-card="${esc(i.id)}">
      <div class="rc2-vl" aria-label="Índice de viralidade ${vlFmt(i.vl)}"><b>${vlFmt(i.vl)}</b><small>VL</small></div>
      <div class="rc2-corpo">
        <div class="rc2-conta"><b>@${esc(c.handle || '?')}</b><span>${esc(c.nome && c.nome !== c.handle ? c.nome : '')}</span><span class="rc2-tag suave">${esc(PAIS[c.pais] || c.pais || '?')} · ${esc(IDIOMA[c.idioma] || c.idioma || '?')}</span><span class="rc2-tag suave">${esc(i.rede === 'youtube' ? 'YouTube' : 'Instagram')} · ${esc(TIPO[i.tipo] || i.tipo || '')}</span></div>
        <p class="rc2-metrica">${esc(metricas || 'sem métricas públicas')} · ${dia(i.publicado_em)}</p>
        ${galeria(i)}
        ${i.tema ? `<h3>${esc(i.tema)}</h3>` : '<h3 class="rc2-mudo">Ainda sem tema (a IA classifica na próxima coleta)</h3>'}
        <div class="rc2-tags">${i.mecanismo ? `<span class="rc2-tag mec ${esc(i.mecanismo)}">${esc(MEC[i.mecanismo] || i.mecanismo)}</span>` : ''}${i.em_alta ? '<span class="rc2-tag alta">em alta</span>' : ''}${i.vl_views != null && i.vl_views >= 3 && i.tipo === 'reel' ? `<span class="rc2-tag suave">views ${vlFmt(i.vl_views)}</span>` : ''}</div>
        ${i.tese ? `<dl class="rc2-dl"><div><dt>Tese</dt><dd>${esc(i.tese)}</dd></div>${i.ponte_pedro ? `<div><dt>Ponte para o Pedro</dt><dd>${esc(i.ponte_pedro)}</dd></div>` : ''}</dl>` : ''}
        <div class="rc2-acoes">
          ${i.rede === 'instagram' && ['carrossel', 'imagem'].includes(i.tipo) ? `<button class="rc2-btn laranja" data-action="rc2-clonar-menu" data-id="${esc(i.id)}" aria-expanded="${ST.menuClone === i.id}" ${oc ? 'disabled' : ''}>${oc === 'clone' ? 'Reciclando…' : 'Reciclar'}</button>` : ''}
          ${i.tese ? `<button class="rc2-btn" data-action="rc2-menu" data-id="${esc(i.id)}" aria-expanded="${menu}" ${oc ? 'disabled' : ''}>${oc ? (oc === 'reel' ? 'Escrevendo o roteiro…' : 'Enviando para produção…') : 'Reciclar como…'}</button>` : ''}
          <a class="rc2-btn fantasma" href="${esc(link(i.permalink))}" target="_blank" rel="noopener noreferrer">Ver post original ↗</a>
          <button class="rc2-btn fantasma" data-action="rc2-descartar" data-id="${esc(i.id)}" aria-label="Descartar este post da lista" ${oc ? 'disabled' : ''}>✕ Descartar</button>
          ${ST.menuClone === i.id && !oc ? `<div class="rc2-clone-opcoes" role="group" aria-label="Como reciclar">
            <button class="rc2-opcao" data-action="rc2-clonar" data-id="${esc(i.id)}" data-modo="original"><b>Formato original</b><small>Mesmo visual do post (cores e layout), só traduzido. Tira a assinatura do autor e põe o seu @.</small></button>
            <button class="rc2-opcao" data-action="rc2-clonar" data-id="${esc(i.id)}" data-modo="nosso" data-fundo="branco"><b>Nosso formato · fundo branco</b><small>Pega o texto, traduz se precisar e monta no seu padrão. Sem custo de IA quando já está em português.</small></button>
            <button class="rc2-opcao preto" data-action="rc2-clonar" data-id="${esc(i.id)}" data-modo="nosso" data-fundo="preto"><b>Nosso formato · fundo preto</b><small>O mesmo, com fundo preto e texto branco.</small></button>
          </div>` : ''}
        </div>
        ${menu ? `<div class="rc2-menu" role="group" aria-label="Formato"><button class="rc2-btn" data-action="rc2-reciclar" data-id="${esc(i.id)}" data-f="carrossel">Carrossel</button><button class="rc2-btn" data-action="rc2-reciclar" data-id="${esc(i.id)}" data-f="carrossel" data-e="1">Carrossel na mesma estrutura</button><button class="rc2-btn" data-action="rc2-reciclar" data-id="${esc(i.id)}" data-f="estatico">Post estático</button><button class="rc2-btn" data-action="rc2-reciclar" data-id="${esc(i.id)}" data-f="reel">Roteiro de reel</button><p class="rc2-meta">Só a tese e a estrutura (nº de slides e tipo de gancho) são reaproveitadas; texto, exemplos e fotos são seus. Para republicar um conteúdo de terceiros como está, é preciso a autorização do autor, fora da ferramenta. Carrossel e post passam pelos mesmos filtros de fatos e anti-IA e vão para “Aprovar”.</p></div>` : ''}
        ${ST.autoriza === i.id ? formAutorizacao(i) : ''}
        ${ja.length ? `<p class="rc2-meta">Já reciclado: ${ja.map((r) => `${esc({ carrossel: 'carrossel', estatico: 'post', reel: 'reel', clone: 'clone traduzido' }[r.formato] || r.formato)} em ${dh(r.em)}`).join(' · ')}</p>` : ''}
      </div></article>`;
  }
  // Clone traduzido: só com a autorização do autor registrada (quem, onde, quando e a prova). O crédito entra na legenda.
  const CANAIS = ['DM do Instagram', 'WhatsApp', 'E-mail', 'Pessoalmente', 'Outro'];
  function formAutorizacao(i) {
    const f = ST.autForm; const a = i.autorizacao;
    if (a) return `<div class="rc2-menu" role="group" aria-label="Clone autorizado"><p class="rc2-meta">Autorizado por <b>${esc(a.autor)}</b> (${esc(a.canal)}, ${esc(a.data)}). Crédito: “${esc(a.credito)}”</p>
      <p class="rc2-meta">A ferramenta lê o texto de cada slide, traduz para o português (IA gratuita) e remonta no mesmo número de slides, com a foto de cada um. Vai para “Aprovar”; nada é publicado sem você.</p>
      <button class="rc2-btn laranja" data-action="rc2-clonar" data-id="${esc(i.id)}">Clonar agora</button> <button class="rc2-btn fantasma" data-action="rc2-clone-fechar">Fechar</button></div>`;
    return `<form class="rc2-menu rc2-aut" data-rc2-aut="${esc(i.id)}" aria-label="Registrar autorização">
      <p class="rc2-meta"><b>Antes de clonar, registre a autorização do autor.</b> Sem ela o post não é processado.</p>
      <label>Quem autorizou<input data-rc2-aut="autor" value="${esc(f.autor ?? `@${i.conta?.handle || ''}`)}" maxlength="40" required></label>
      <label>Onde<select data-rc2-aut="canal">${CANAIS.map((c) => `<option ${f.canal === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>Data<input type="date" data-rc2-aut="data" value="${esc(f.data || new Date().toISOString().slice(0, 10))}" required></label>
      <label>Prova (o que ele escreveu ou onde está o print)<textarea data-rc2-aut="prova" rows="3" maxlength="600" required>${esc(f.prova || '')}</textarea></label>
      <label>Crédito na legenda (opcional)<input data-rc2-aut="credito" value="${esc(f.credito || '')}" maxlength="160" placeholder="Conteúdo original de @autor, traduzido e publicado com autorização."></label>
      <button type="button" class="rc2-btn laranja" data-action="rc2-autorizar" data-id="${esc(i.id)}">Registrar autorização</button> <button type="button" class="rc2-btn fantasma" data-action="rc2-clone-fechar">Cancelar</button></form>`;
  }
  async function clonar(ctx, id, opcoes = {}) {
    if (ST.ocupado[id]) return;
    ST.ocupado[id] = 'clone'; ST.autoriza = null; ctx.render();
    try {
      let r = await ctx.api(`/api/reciclagem/${encodeURIComponent(id)}/clonar`, { method: 'POST', body: { modo: opcoes.modo || 'original', fundo: opcoes.fundo || 'branco' } });
      ST.producao = { id: r.id, titulo: 'Copiando o post', rotulo: 'Lendo os slides…' }; ctx.render();
      for (let k = 0; k < 40 && !r.concluido; k++) {
        await new Promise((x) => setTimeout(x, r.erro?.codigo === 'COTA_IA' ? 20000 : 1500));
        try { r = await ctx.api(`/api/reciclagem/clone/${encodeURIComponent(r.id)}/passo`, { method: 'POST', body: {} }); } catch (e) { if (e.status === 429) continue; throw e; }
        ST.producao = { id: r.id, titulo: 'Copiando o post', rotulo: { buscar: 'Buscando o post…', ler: `Lendo os slides (${r.lidos}/${r.slides || '?'})…`, traduzir: r.erro?.codigo === 'COTA_IA' ? 'IA gratuita sem cota: esperando…' : 'Traduzindo…', arte: 'Desenhando…', fim: 'Conferindo…' }[r.etapa] || '…' }; ctx.render();
      }
      if (r.estado === 'concluido') ctx.toast(r.aviso ? `Cópia pronta em “Aprovar”. Atenção: ${r.aviso}` : 'Cópia pronta. Veja em “Aprovar”.');
      else if (r.estado === 'erro') ctx.toast(`O clone parou: ${r.motivo}`);
      else ctx.toast('O clone continua no servidor; aparece em “Aprovar” quando terminar.');
      if (r.estado !== 'erro') ST.itens = ST.itens.filter((x) => x.id !== id); // reciclado: sai da lista
      const item = ST.itens.find((x) => x.id === id); if (item) item.reciclado = [...(item.reciclado || []), { formato: 'clone', conteudo_id: r.id, em: new Date().toISOString() }];
    } catch (e) { ctx.toast(e.message || 'Não foi possível clonar.'); }
    ST.producao = null; delete ST.ocupado[id]; ctx.render();
  }

  function roteiroModal() {
    const r = ST.roteiro; if (!r) return '';
    return `<div class="rc2-modal"><div role="dialog" aria-modal="true" aria-labelledby="rc2-rot-t"><h3 id="rc2-rot-t">${esc(r.titulo || 'Roteiro de reel')}</h3>
      <p class="rc2-meta">≈ ${esc(r.duracao || '?')} s falados · voz do Pedro · escrito do zero a partir da tese (${esc(r.tentativas || 1)} ${r.tentativas > 1 ? 'tentativas' : 'tentativa'})</p>
      <div class="rc2-roteiro">${esc(r.roteiro)}</div>
      <div class="rc2-acoes rc2-fixo"><button class="rc2-btn laranja" data-action="rc2-gravar">Gravar agora</button><button class="rc2-btn" data-action="rc2-copiar">Copiar roteiro</button><button class="rc2-btn fantasma" data-action="rc2-fechar">Fechar</button></div></div></div>`;
  }
  function producaoHtml() {
    const p = ST.producao; if (!p) return '';
    return `<div class="rc2-prog" role="status" aria-live="polite"><b>Produzindo “${esc(p.titulo || 'conteúdo')}”</b><small>${esc(p.rotulo)}. Pode fechar o app: a produção continua no servidor e aparece em “Aprovar”.</small></div>`;
  }
  function telaContas() {
    const c = ST.contas; const f = ST.contasForm;
    if (!c) return '<div class="rc2-vazio">Abrindo as contas…</div>';
    const removidasIg = new Set(c.removidas?.instagram || []); const removidasYt = new Set(c.removidas?.youtube || []);
    const li = (x) => `<li class="rc2-conta-item"><div><b>@${esc(x.handle)}</b> ${x.destaque ? '<span class="rc2-tag alta">★</span>' : ''}${x.adicionada ? '<span class="rc2-tag suave">sua</span>' : ''}${x.a_confirmar ? '<span class="rc2-tag aviso">a confirmar</span>' : ''}<small>${esc(x.nome !== x.handle ? x.nome : '')} · ${esc(PAIS[x.pais] || x.pais)} · ${esc(IDIOMA[x.idioma] || x.idioma)}</small>${x.por_que ? `<small>${esc(x.por_que)}</small>` : ''}</div><button class="rc2-btn peq fantasma" data-action="rc2-conta-remover" data-rede="instagram" data-id="${esc(x.handle)}">Remover</button></li>`;
    const liYt = (x) => `<li class="rc2-conta-item"><div><b>${esc(x.nome)}</b> ${x.adicionada ? '<span class="rc2-tag suave">sua</span>' : ''}<small><a href="${esc(link(x.url))}" target="_blank" rel="noopener noreferrer">${esc(x.canal)}</a> · ${esc(PAIS[x.pais] || x.pais)} · ${esc(IDIOMA[x.idioma] || x.idioma)}</small></div><button class="rc2-btn peq fantasma" data-action="rc2-conta-remover" data-rede="youtube" data-id="${esc(x.canal)}">Remover</button></li>`;
    const removidas = [...removidasIg].map((h) => `<li class="rc2-conta-item off"><div><b>@${esc(h)}</b><small>removida</small></div><button class="rc2-btn peq fantasma" data-action="rc2-conta-restaurar" data-rede="instagram" data-id="${esc(h)}">Restaurar</button></li>`).concat([...removidasYt].map((h) => `<li class="rc2-conta-item off"><div><b>${esc(h)}</b><small>removido</small></div><button class="rc2-btn peq fantasma" data-action="rc2-conta-restaurar" data-rede="youtube" data-id="${esc(h)}">Restaurar</button></li>`)).join('');
    const sel = (id, k, obj) => `<select id="${id}" data-rc2-campo="${k}">${Object.entries(obj).map(([v, r]) => `<option value="${v}" ${f[k] === v ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
    return `<div class="rc2-h2"><h2>Contas vigiadas</h2><span>${c.instagram.length} no Instagram · ${c.youtube.length} no YouTube</span></div>
      <p class="rc2-meta">Só contas profissionais (Business/Creator) podem ser lidas pela Meta; conta que recusar aparece no resumo da coleta. A coleta lê até 40 contas por dia, em rodízio.${ST.estado?.youtube ? '' : ' YouTube desligado: sem YOUTUBE_API_KEY no servidor.'}</p>
      <div class="rc2-acoes"><button class="rc2-btn laranja" data-action="rc2-contas-salvar" ${!ST.contasAlterado || ST.ocupado.contas ? 'disabled' : ''}>${ST.ocupado.contas ? 'Salvando…' : 'Salvar contas'}</button><button class="rc2-btn fantasma" data-action="rc2-tela" data-t="lista">Voltar</button></div>
      <details class="rc2-det" open><summary>Adicionar conta de Instagram</summary><div class="rc2-form">
        <label>Handle<input id="rc2-f-handle" data-rc2-campo="handle" value="${esc(f.handle)}" placeholder="sem @" maxlength="30" autocapitalize="off"></label>
        <label>Nome<input id="rc2-f-nome" data-rc2-campo="nome" value="${esc(f.nome)}" maxlength="80"></label>
        <div class="rc2-grid2"><label>País${sel('rc2-f-pais', 'pais', PAIS)}</label><label>Idioma${sel('rc2-f-idioma', 'idioma', IDIOMA)}</label></div>
        <label>Por que importa<input id="rc2-f-porque" data-rc2-campo="por_que" value="${esc(f.por_que)}" maxlength="200"></label>
        <button class="rc2-btn" data-action="rc2-conta-adicionar" data-rede="instagram">Adicionar à lista</button></div></details>
      <details class="rc2-det"><summary>Adicionar canal de YouTube</summary><div class="rc2-form">
        <label>Canal (@handle ou id UC…)<input id="rc2-f-canal" data-rc2-campo="canal" value="${esc(f.canal)}" maxlength="70" autocapitalize="off"></label>
        <label>Nome<input id="rc2-f-canal-nome" data-rc2-campo="canal_nome" value="${esc(f.canal_nome)}" maxlength="80"></label>
        <div class="rc2-grid2"><label>País${sel('rc2-f-canal-pais', 'canal_pais', PAIS)}</label><label>Idioma${sel('rc2-f-canal-idioma', 'canal_idioma', IDIOMA)}</label></div>
        <button class="rc2-btn" data-action="rc2-conta-adicionar" data-rede="youtube">Adicionar à lista</button></div></details>
      <h3 class="rc2-h3">Instagram</h3><ul class="rc2-contas">${c.instagram.map(li).join('')}</ul>
      <h3 class="rc2-h3">YouTube</h3><ul class="rc2-contas">${c.youtube.map(liYt).join('')}</ul>
      ${removidas ? `<h3 class="rc2-h3">Removidas</h3><ul class="rc2-contas">${removidas}</ul>` : ''}`;
  }

  // ── Em alta no Brasil ─────────────────────────────────────────────────────────
  // O que está bombando agora no Brasil, sem filtro de nicho: posts das grandes páginas (Instagram), buscas em alta
  // (Google Trends) e top de hashtags gerais. Só link, números e miniatura; "Reciclar" usa o mesmo clone das teses.
  const FONTE_EA = { instagram: 'Instagram', instagram_hashtag: 'Hashtag', google_trends: 'Google' };
  const CAT_EA = { noticias: 'Notícias', entretenimento: 'Entretenimento', esporte: 'Esporte', humor: 'Humor', celebridade: 'Celebridade', outros: 'Outros' };
  const atras = (iso) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '—'; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `há ${m} min` : m < 48 * 60 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`; };
  async function carregarEmAlta(ctx, forcar) {
    const E = ST.ea; if (E.carregando || (E.carregou && !forcar)) return;
    E.carregando = true; ctx.render();
    try { const r = await ctx.api('/api/reciclagem/em-alta?limite=120'); Object.assign(E, { itens: r.itens || [], total: r.total || 0, por_fonte: r.por_fonte || {}, estado: r.estado || null, erro: null }); }
    catch (e) { E.erro = e.message || 'Não consegui abrir o "Em alta no Brasil".'; }
    E.carregando = false; E.carregou = true; ctx.render();
  }
  async function coletarEmAlta(ctx) {
    if (ST.ocupado.ea_coletar) return;
    ST.ocupado.ea_coletar = true; ctx.render();
    try {
      const r = await ctx.api('/api/reciclagem/em-alta/coletar', { method: 'POST', body: {} });
      if (r.ocupado) ctx.toast('Já tem uma coleta rodando. Em instantes a lista atualiza.');
      else if (r.recente) ctx.toast('A lista foi atualizada há menos de 5 minutos.');
      else { const f = r.fontes || {}; ctx.toast(`Atualizado: ${f.instagram?.contas_lidas ?? 0} páginas lidas, ${f.google_trends?.itens ?? 0} buscas do Google, ${r.novos || 0} novos.`); }
      await carregarEmAlta(ctx, true);
    } catch (e) { ctx.toast(e.status === 429 ? 'Atualizou há pouco. Espere alguns minutos.' : e.message); }
    delete ST.ocupado.ea_coletar; ctx.render();
  }
  async function carregarContasEmAlta(ctx) {
    try { ST.ea.contas = await ctx.api('/api/reciclagem/em-alta/contas'); } catch (e) { ctx.toast(e.message); }
    ctx.render();
  }
  async function salvarContasEmAlta(ctx, cfg) {
    try { ST.ea.contas = await ctx.api('/api/reciclagem/em-alta/contas', { method: 'PUT', body: cfg }); ctx.toast('Lista de páginas salva.'); } catch (e) { ctx.toast(e.message); }
    ctx.render();
  }
  // Leva o post para a lista da Reciclagem (id rc_…) e roda o mesmo clone das teses.
  async function reciclarEmAlta(ctx, id, opcoes) {
    if (ST.ocupado[id]) return;
    ST.ocupado[id] = 'clone'; ST.ea.menu = null; ctx.render();
    let rcId = null;
    try { rcId = (await ctx.api(`/api/reciclagem/em-alta/${encodeURIComponent(id)}/levar`, { method: 'POST', body: {} })).id; }
    catch (e) { ctx.toast(e.message || 'Não foi possível reciclar este post.'); }
    delete ST.ocupado[id]; ctx.render();
    if (!rcId) return;
    const it = ST.ea.itens.find((x) => x.id === id); if (it) it.levado = { id: rcId, em: new Date().toISOString() };
    await clonar(ctx, rcId, opcoes);
  }
  function cartaoEmAlta(i) {
    const c = i.conta || {}; const m = i.metricas || {}; const oc = ST.ocupado[i.id];
    const metricas = [m.curtidas != null ? `${num(m.curtidas)} curtidas` : null, m.comentarios != null ? `${num(m.comentarios)} comentários` : null, m.visualizacoes != null ? `${num(m.visualizacoes)} views` : null, m.por_hora != null ? `${num(m.por_hora)} interações/h` : null].filter(Boolean).join(' · ');
    const reciclavel = ['carrossel', 'imagem'].includes(i.tipo);
    const thumb = /^https:\/\//.test(i.thumbnail || '') ? `<img class="rc2-ea-thumb" src="${esc(i.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    const texto = String(i.titulo || '').slice(0, 220);
    return `<article class="rc2-card" data-rc2-ea="${esc(i.id)}">
      <div class="rc2-vl" aria-label="Força em alta ${esc(i.score)} de 100"><b>${esc(i.score)}</b><small>EM ALTA</small></div>
      <div class="rc2-corpo">
        <div class="rc2-conta"><b>${c.handle && !String(c.handle).startsWith('#') ? '@' : ''}${esc(c.handle || '?')}</b><span>${esc(c.nome && c.nome !== c.handle ? c.nome : '')}</span><span class="rc2-tag suave">${esc(FONTE_EA[i.fonte] || i.fonte)} · ${esc(TIPO[i.tipo] || i.tipo || '')}</span>${c.cat && CAT_EA[c.cat] && c.cat !== 'outros' ? `<span class="rc2-tag suave">${esc(CAT_EA[c.cat])}</span>` : ''}</div>
        <p class="rc2-metrica">${esc(metricas || 'sem métricas públicas')} · ${esc(atras(i.publicado_em))}</p>
        <div class="rc2-ea-midia">${thumb}<p class="rc2-ea-texto">${texto ? esc(texto) + (String(i.titulo || '').length > 220 ? '…' : '') : '<span class="rc2-mudo">(sem legenda)</span>'}</p></div>
        <div class="rc2-acoes">
          ${reciclavel ? `<button class="rc2-btn laranja" data-action="rc2-ea-menu" data-id="${esc(i.id)}" aria-expanded="${ST.ea.menu === i.id}" ${oc ? 'disabled' : ''}>${oc ? 'Reciclando…' : i.levado ? 'Reciclar de novo' : 'Reciclar'}</button>` : ''}
          <a class="rc2-btn fantasma" href="${esc(link(i.permalink))}" target="_blank" rel="noopener noreferrer">Abrir no Instagram ↗</a>
          ${ST.ea.menu === i.id && !oc ? `<div class="rc2-clone-opcoes" role="group" aria-label="Como reciclar">
            <button class="rc2-opcao" data-action="rc2-ea-clonar" data-id="${esc(i.id)}" data-modo="original"><b>Formato original</b><small>Mesmo visual do post, só traduzido/ajustado. Tira a assinatura do autor e põe o seu @.</small></button>
            <button class="rc2-opcao" data-action="rc2-ea-clonar" data-id="${esc(i.id)}" data-modo="nosso" data-fundo="branco"><b>Nosso formato · fundo branco</b><small>Pega o texto e monta no seu padrão.</small></button>
            <button class="rc2-opcao preto" data-action="rc2-ea-clonar" data-id="${esc(i.id)}" data-modo="nosso" data-fundo="preto"><b>Nosso formato · fundo preto</b><small>O mesmo, com fundo preto e texto branco.</small></button>
          </div>` : ''}
        </div>
      </div></article>`;
  }
  function buscasEmAlta(lista) {
    if (!lista.length) return '';
    return `<section class="rc2-trends" aria-labelledby="rc2-ea-g"><div class="rc2-h2"><h2 id="rc2-ea-g">Buscas em alta no Google</h2><span>Brasil · agora</span></div>
      <ol class="rc2-ea-buscas">${lista.map((t) => { const n = (t.noticias || [])[0]; return `<li><a href="${esc(link(t.permalink))}" target="_blank" rel="noopener noreferrer"><b>${esc(t.titulo)}</b>${t.metricas?.trafego ? `<small>${esc(t.metricas.trafego)} buscas</small>` : ''}</a>${n ? `<span>${esc(n.titulo)}${n.fonte ? ` · ${esc(n.fonte)}` : ''}</span>` : ''}</li>`; }).join('')}</ol></section>`;
  }
  function contasEmAltaHtml() {
    const C = ST.ea.contas; const E = ST.ea;
    if (!C) return '<p class="rc2-meta">Abrindo a lista…</p>';
    return `<p class="rc2-meta">Até ${C.max_por_rodada} páginas por rodada, em rodízio (as lidas há mais tempo primeiro). Só perfis profissionais podem ser lidos pela Meta; página recusada fica 7 dias fora.</p>
      <div class="rc2-form rc2-ea-add"><label>Adicionar página<input data-rc2-ea-campo="novo" value="${esc(E.novo)}" placeholder="handle, sem @" maxlength="30" autocapitalize="off"></label>
        <label>Assunto<select data-rc2-ea-campo="novoCat">${Object.entries(CAT_EA).map(([k, r]) => `<option value="${k}" ${E.novoCat === k ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
        <button class="rc2-btn" data-action="rc2-ea-conta-add">Adicionar</button></div>
      <ul class="rc2-contas">${C.contas.map((x) => `<li class="rc2-conta-item ${x.recusada ? 'off' : ''}"><div><b>@${esc(x.handle)}</b> ${x.adicionada ? '<span class="rc2-tag suave">sua</span>' : ''}${x.recusada ? '<span class="rc2-tag aviso">recusada pela Meta</span>' : ''}<small>${esc(x.nome !== x.handle ? x.nome : '')} · ${esc(CAT_EA[x.cat] || x.cat || '')} · ${x.lida_em ? `lida ${esc(atras(x.lida_em))}` : 'ainda não lida'}</small>${x.recusada ? `<small>${esc(x.recusada.erro || '')}</small>` : ''}</div><button class="rc2-btn peq fantasma" data-action="rc2-ea-conta-remover" data-id="${esc(x.handle)}">Remover</button></li>`).join('')}</ul>
      ${(C.removidas || []).length ? `<h3 class="rc2-h3">Removidas</h3><ul class="rc2-contas">${C.removidas.map((h) => `<li class="rc2-conta-item off"><div><b>@${esc(h)}</b></div><button class="rc2-btn peq fantasma" data-action="rc2-ea-conta-restaurar" data-id="${esc(h)}">Restaurar</button></li>`).join('')}</ul>` : ''}`;
  }
  function emAltaHtml(ctx) {
    const E = ST.ea; if (!E.carregou && !E.carregando && !E.erro) setTimeout(() => carregarEmAlta(ctx), 0);
    const u = E.estado?.ultima_coleta; const pf = E.por_fonte || {};
    const tile = (r, v, s, peq) => `<div class="rc2-stat"><span>${r}</span><b class="${peq ? 'peq' : ''}">${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
    const chip = (v, r) => `<button class="rc2-chip" data-action="rc2-ea-fonte" data-v="${esc(v)}" aria-pressed="${E.fonte === v}">${r}</button>`;
    const posts = E.itens.filter((i) => i.fonte !== 'google_trends' && (!E.fonte || E.fonte === i.fonte));
    const buscas = !E.fonte || E.fonte === 'google_trends' ? E.itens.filter((i) => i.fonte === 'google_trends').slice(0, 15) : [];
    const avisos = u?.avisos?.length ? `<p class="rc2-meta">${u.avisos.map(esc).join('<br>')}</p>` : '';
    const vazio = E.carregando && !E.itens.length ? '<div class="rc2-vazio">Abrindo o que está em alta…</div>' : !E.itens.length ? `<div class="rc2-vazio">${u ? 'Nada nas últimas 72 h. Toque em “Atualizar agora”.' : 'Ainda não houve coleta. Toque em “Atualizar agora” (depois ela roda sozinha a cada 3 h).'}</div>` : '';
    return `<p class="rc2-sub">O que está bombando AGORA no Brasil, sem filtro de nicho (notícia, esporte, novela, humor, celebridade), para tirar ideia de conteúdo de topo de funil. A nota vai de 0 a 100 dentro de cada fonte e favorece o que é recente: interações por hora desde a publicação. Só link, números e miniatura; nada é copiado.</p>
      ${E.erro ? `<div class="rc2-aviso erro">${esc(E.erro)} <button class="rc2-btn peq" data-action="rc2-ea-recarregar">Tentar de novo</button></div>` : ''}
      ${E.estado && !E.estado.banco ? '<div class="rc2-aviso erro">Precisa do banco de dados no servidor (Cópia no servidor) para guardar a lista.</div>' : ''}
      <div class="rc2-stats" role="list">
        ${tile('Última coleta', u ? dh(u.em) : 'Nenhuma ainda', u ? `${u.fontes?.instagram?.contas_lidas ?? 0} páginas · ${u.fontes?.google_trends?.ok ? 'Google ok' : 'Google falhou'}` : 'Toque em “Atualizar agora”', true)}
        ${tile('Na lista', String(E.total || 0), `${pf.instagram || 0} Instagram · ${pf.google_trends || 0} Google${pf.instagram_hashtag ? ` · ${pf.instagram_hashtag} hashtag` : ''}`)}
        ${tile('Próxima coleta', 'a cada 3 h', 'automática; guarda 72 h', true)}
      </div>
      <div class="rc2-acoes rc2-topo"><button class="rc2-btn laranja cheio" data-action="rc2-ea-coletar" ${ST.ocupado.ea_coletar ? 'disabled' : ''}>${ST.ocupado.ea_coletar ? 'Lendo as páginas… (até 1 min)' : 'Atualizar agora'}</button><button class="rc2-btn fantasma" data-action="rc2-ea-contas" aria-expanded="${E.verContas}">Páginas lidas</button></div>
      ${E.verContas ? `<section class="rc2-trends rc2-ea-contas"><div class="rc2-h2"><h2>Páginas lidas</h2><span>${E.contas ? `${E.contas.contas.length} páginas` : ''}</span></div>${contasEmAltaHtml()}</section>` : ''}
      ${producaoHtml()}
      <div class="rc2-chips" role="group" aria-label="Fonte">${chip('', 'Tudo')}${chip('instagram', 'Instagram')}${chip('google_trends', 'Google')}${pf.instagram_hashtag ? chip('instagram_hashtag', 'Hashtags') : ''}</div>
      ${buscasEmAlta(buscas)}
      ${E.fonte === 'google_trends' ? '' : `<div class="rc2-h2"><h2>Posts em alta</h2><span>${posts.length} ${posts.length === 1 ? 'post' : 'posts'} · últimas 48 h</span></div>`}
      ${vazio || (E.fonte === 'google_trends' ? '' : posts.length ? posts.map(cartaoEmAlta).join('') : '<div class="rc2-vazio">Nenhum post nesta fonte agora.</div>')}
      ${u?.fontes?.instagram?.recusadas?.length ? `<details class="rc2-det"><summary>Páginas que a Meta recusou na última coleta (${u.fontes.instagram.recusadas.length})</summary><ul class="rc2-lista">${u.fontes.instagram.recusadas.map((r) => `<li><b>@${esc(r.handle)}</b>: ${esc(r.erro)}</li>`).join('')}</ul></details>` : ''}
      ${avisos}`;
  }
  function abasSecao() {
    const b = (v, r) => `<button class="rc2-aba" role="tab" data-action="rc2-secao" data-v="${v}" aria-selected="${ST.secao === v}">${r}</button>`;
    return `<div class="rc2-abas" role="tablist" aria-label="Seções da Reciclagem">${b('teses', 'Teses das contas vigiadas')}${b('em_alta', 'Em alta no Brasil')}</div>`;
  }

  // Com a aba aberta e visível: a cada 30 s lê mais uma conta no servidor (rodízio, sem IA) e atualiza a lista.
  let timer = null;
  function vigiar(ctx) {
    if (timer) return;
    timer = setInterval(async () => {
      if (document.hidden || !document.querySelector('.rc2')) { if (!document.querySelector('.rc2')) { clearInterval(timer); timer = null; } return; }
      if (Object.keys(ST.ocupado).length || ST.carregando) return;
      try { const r = await ctx.api('/api/reciclagem/coletar-uma', { method: 'POST', body: {} }); if (r.novos) ctx.toast(`${r.novos} post${r.novos > 1 ? 's' : ''} novo${r.novos > 1 ? 's' : ''} na Reciclagem.`); } catch { /* limite da Meta ou rede: tenta no próximo ciclo */ }
      await recarregarLista(ctx); ctx.render();
    }, 30000);
  }
  function render(ctx) {
    if (!ST.carregou && !ST.carregando && !ST.erro) setTimeout(() => carregar(ctx), 0);
    vigiar(ctx);
    const e = ST.estado; const avisos = [];
    if (e && !e.banco) avisos.push('<div class="rc2-aviso erro">A Reciclagem precisa do banco de dados no servidor (Cópia no servidor) para guardar as teses.</div>');
    if (e && !e.instagram) avisos.push('<div class="rc2-aviso">A conexão com a Meta não está configurada (META_PAGE_ACCESS_TOKEN / META_IG_USER_ID): sem ela as contas de Instagram não são lidas.</div>');
    if (e && !e.ia) avisos.push('<div class="rc2-aviso erro">Nenhuma IA configurada no servidor: os posts entram sem tema e tese, e nada pode ser reciclado.</div>');
    const corpo = ST.tela === 'contas' ? telaContas() : ST.secao === 'em_alta' ? emAltaHtml(ctx) : `
      ${painel()}
      <div class="rc2-acoes rc2-topo"><button class="rc2-btn laranja cheio" data-action="rc2-coletar" ${ST.ocupado.coletar || (e && !e.banco) ? 'disabled' : ''}>${ST.ocupado.coletar ? 'Lendo as contas… (até 1 min)' : 'Atualizar agora'}</button><button class="rc2-btn fantasma" data-action="rc2-tela" data-t="contas">Contas vigiadas</button></div>
      ${producaoHtml()}${tendenciasHtml()}
      <div class="rc2-h2"><h2>Teses em alta</h2><span>${ST.total} ${ST.total === 1 ? 'tese' : 'teses'} no filtro</span></div>${filtros()}
      ${ST.carregando && !ST.itens.length ? '<div class="rc2-vazio">Abrindo a Reciclagem…</div>' : ST.itens.length ? ST.itens.map(cartao).join('') : `<div class="rc2-vazio">${e?.ultima_coleta ? 'Nenhuma tese neste filtro. Baixe o VL mínimo ou amplie o período.' : 'Ainda não houve coleta. Toque em “Atualizar agora” ou espere as 9h.'}</div>`}
      ${e?.ultima_coleta?.instagram?.recusadas?.length ? `<details class="rc2-det"><summary>Contas que a Meta recusou na última coleta (${e.ultima_coleta.instagram.recusadas.length})</summary><ul class="rc2-lista">${e.ultima_coleta.instagram.recusadas.map((r) => `<li><b>@${esc(r.handle)}</b>: ${esc(r.erro)}</li>`).join('')}</ul></details>` : ''}
      ${e?.ultima_coleta?.avisos?.length ? `<p class="rc2-meta">${e.ultima_coleta.avisos.map(esc).join('<br>')}</p>` : ''}`;
    return `<div class="rc2" id="rc2-topo"><span class="rc2-eyebrow">Radar de Reciclagem</span><h1>O que viralizou lá fora, na voz do Pedro</h1>
      ${ST.tela === 'contas' ? '' : abasSecao()}
      ${ST.secao === 'em_alta' && ST.tela !== 'contas' ? '' : `<p class="rc2-sub">Todo dia às 9h o radar lê contas de empreendedorismo em 7 países, mede o que saiu da curva e extrai a TESE. Você recicla a tese, nunca o texto, em carrossel, post ou reel. Nada vai ao Instagram sem você.</p>
      ${ST.erro ? `<div class="rc2-aviso erro">${esc(ST.erro)} <button class="rc2-btn peq" data-action="rc2-recarregar">Tentar de novo</button></div>` : ''}${avisos.join('')}`}
      ${corpo}</div>${roteiroModal()}`;
  }

  // ── Ações ───────────────────────────────────────────────────────────────────
  async function acao(a, el, ctx) {
    if (!a.startsWith('rc2-')) return false;
    const id = el.dataset.id;
    try {
      switch (a) {
        case 'rc2-recarregar': await carregar(ctx, { forcar: true }); break;
        case 'rc2-coletar': await coletar(ctx); break;
        case 'rc2-filtro': ST.filtro[el.dataset.k] = el.dataset.v; await recarregarLista(ctx); break;
        case 'rc2-sel': break; // tratado no evento change
        case 'rc2-tela': ST.tela = el.dataset.t === 'contas' ? 'contas' : 'lista'; ctx.render(); if (ST.tela === 'contas') await carregarContas(ctx); break;
        case 'rc2-menu': ST.menu = ST.menu === id ? null : id; ctx.render(); break;
        case 'rc2-clone-abrir': ST.autoriza = ST.autoriza === id ? null : id; ST.autForm = {}; ST.menu = null; ctx.render(); break;
        case 'rc2-clone-fechar': ST.autoriza = null; ctx.render(); break;
        case 'rc2-autorizar': {
          const f = ST.autForm; const item = ST.itens.find((x) => x.id === id);
          const corpo = { autor: f.autor ?? `@${item?.conta?.handle || ''}`, canal: f.canal || CANAIS[0], data: f.data || new Date().toISOString().slice(0, 10), prova: f.prova || '', credito: f.credito || '' };
          try { const a = await ctx.api(`/api/reciclagem/${encodeURIComponent(id)}/autorizacao`, { method: 'POST', body: corpo }); if (item) item.autorizacao = a; ctx.toast('Autorização registrada.'); } catch (e) { ctx.toast(e.message); }
          ctx.render(); break;
        }
        case 'rc2-descartar': {
          ST.itens = ST.itens.filter((x) => x.id !== id); ST.total = Math.max(0, (ST.total || 1) - 1); ctx.render(); // some na hora
          try { await ctx.api(`/api/reciclagem/${encodeURIComponent(id)}/descartar`, { method: 'POST', body: {} }); } catch (e) { ctx.toast(e.message || 'Não consegui descartar.'); await recarregarLista(ctx); ctx.render(); }
          break;
        }
        case 'rc2-clonar-menu': ST.menuClone = ST.menuClone === id ? null : id; ctx.render(); break;
        case 'rc2-clonar': ST.menuClone = null; await clonar(ctx, id, { modo: el.dataset.modo || 'original', fundo: el.dataset.fundo || 'branco' }); break;
        case 'rc2-reciclar': await reciclar(ctx, id, el.dataset.f, el.dataset.e === '1'); break;
        case 'rc2-fechar': ST.roteiro = null; ctx.render(); break;
        case 'rc2-copiar': { const r = ST.roteiro; if (r) { try { await navigator.clipboard.writeText(r.roteiro); ctx.toast('Roteiro copiado.'); } catch { ctx.toast('Não consegui copiar. Selecione o texto.'); } } break; }
        case 'rc2-gravar': {
          const r = ST.roteiro; if (!r) break;
          if (window.Teleprompter?.abrir) { ST.roteiro = null; ctx.render(); window.Teleprompter.abrir({ roteiro: r.roteiro, roteiro_id: r.id, titulo: r.titulo, ctx }); }
          else { try { await navigator.clipboard.writeText(r.roteiro); ctx.toast('Teleprompter ainda não instalado: roteiro copiado. Ele também está salvo em Vídeos/Aprovar.'); } catch { ctx.toast('Teleprompter ainda não instalado. O roteiro está salvo em Vídeos/Aprovar.'); } }
          break;
        }
        case 'rc2-conta-remover': case 'rc2-conta-restaurar': {
          const cfg = ST.contas?.config; if (!cfg) break; const rede = el.dataset.rede === 'youtube' ? 'youtube' : 'instagram'; const chave = rede === 'youtube' ? 'canal' : 'handle';
          const lista = cfg[rede] = cfg[rede] || { adicionar: [], remover: [] };
          if (a === 'rc2-conta-remover') { if (lista.adicionar.some((x) => x[chave] === id)) lista.adicionar = lista.adicionar.filter((x) => x[chave] !== id); else if (!lista.remover.includes(id)) lista.remover.push(id); }
          else lista.remover = lista.remover.filter((x) => x !== id);
          aplicarConfigLocal(); ST.contasAlterado = true; ctx.render(); break;
        }
        case 'rc2-conta-adicionar': {
          const cfg = ST.contas?.config; if (!cfg) break; const f = ST.contasForm;
          if (el.dataset.rede === 'youtube') {
            const canal = f.canal.trim(); if (!/^(@[\w.-]{3,60}|UC[\w-]{20,24})$/.test(canal)) { ctx.toast('Escreva o @handle do canal (ex.: @primorico) ou o id que começa com UC.'); break; }
            cfg.youtube = cfg.youtube || { adicionar: [], remover: [] }; cfg.youtube.remover = cfg.youtube.remover.filter((x) => x !== canal);
            if (!cfg.youtube.adicionar.some((x) => x.canal === canal)) cfg.youtube.adicionar.push({ canal, nome: f.canal_nome.trim() || canal, pais: f.canal_pais, idioma: f.canal_idioma });
            Object.assign(f, { canal: '', canal_nome: '' });
          } else {
            const handle = f.handle.trim().replace(/^@/, '').toLowerCase(); if (!/^[\w.]{2,30}$/.test(handle)) { ctx.toast('Handle inválido: só letras, números, ponto e sublinhado.'); break; }
            cfg.instagram = cfg.instagram || { adicionar: [], remover: [] }; cfg.instagram.remover = cfg.instagram.remover.filter((x) => x !== handle);
            if (!cfg.instagram.adicionar.some((x) => x.handle === handle)) cfg.instagram.adicionar.push({ handle, nome: f.nome.trim() || handle, pais: f.pais, idioma: f.idioma, por_que: f.por_que.trim() });
            Object.assign(f, { handle: '', nome: '', por_que: '' });
          }
          aplicarConfigLocal(); ST.contasAlterado = true; ctx.render(); break;
        }
        case 'rc2-contas-salvar': await salvarContas(ctx); break;
        // Em alta no Brasil
        case 'rc2-secao': ST.secao = el.dataset.v === 'em_alta' ? 'em_alta' : 'teses'; ST.tela = 'lista'; ctx.render(); if (ST.secao === 'em_alta') await carregarEmAlta(ctx); break;
        case 'rc2-ea-recarregar': await carregarEmAlta(ctx, true); break;
        case 'rc2-ea-coletar': await coletarEmAlta(ctx); break;
        case 'rc2-ea-fonte': ST.ea.fonte = el.dataset.v || ''; ctx.render(); break;
        case 'rc2-ea-menu': ST.ea.menu = ST.ea.menu === id ? null : id; ctx.render(); break;
        case 'rc2-ea-clonar': await reciclarEmAlta(ctx, id, { modo: el.dataset.modo || 'original', fundo: el.dataset.fundo || 'branco' }); break;
        case 'rc2-ea-contas': ST.ea.verContas = !ST.ea.verContas; ctx.render(); if (ST.ea.verContas) await carregarContasEmAlta(ctx); break;
        case 'rc2-ea-conta-add': case 'rc2-ea-conta-remover': case 'rc2-ea-conta-restaurar': {
          const C = ST.ea.contas; if (!C) break; const cfg = { adicionar: [...(C.config?.adicionar || [])], remover: [...(C.config?.remover || [])] };
          if (a === 'rc2-ea-conta-add') {
            const handle = String(ST.ea.novo || '').trim().replace(/^@/, '').toLowerCase(); if (!/^[a-z0-9._]{2,30}$/.test(handle)) { ctx.toast('Handle inválido: só letras, números, ponto e sublinhado.'); break; }
            cfg.remover = cfg.remover.filter((x) => x !== handle); if (!cfg.adicionar.some((x) => x.handle === handle) && !C.contas.some((x) => x.handle === handle)) cfg.adicionar.push({ handle, nome: handle, cat: ST.ea.novoCat || 'outros' });
            ST.ea.novo = '';
          } else if (a === 'rc2-ea-conta-remover') { if (cfg.adicionar.some((x) => x.handle === id)) cfg.adicionar = cfg.adicionar.filter((x) => x.handle !== id); else if (!cfg.remover.includes(id)) cfg.remover.push(id); }
          else cfg.remover = cfg.remover.filter((x) => x !== id);
          await salvarContasEmAlta(ctx, cfg); break;
        }
        default: return false;
      }
    } catch (e) { ctx.toast(e.message || 'Não foi possível concluir.'); }
    return true;
  }
  // Recalcula a lista exibida a partir da configuração local (sem esperar o servidor), do mesmo jeito que contas.js faz.
  function aplicarConfigLocal() {
    const c = ST.contas; if (!c) return; const cfg = c.config;
    const base = c._base || (c._base = { instagram: c.instagram.filter((x) => !x.adicionada), youtube: c.youtube.filter((x) => !x.adicionada), removidas: c.removidas || { instagram: [], youtube: [] } });
    // a base vem do servidor já sem as removidas: uma curada restaurada entra como marcador até o "Salvar" trazer a ficha completa
    const marcador = (chave, v) => ({ [chave]: v, nome: v, pais: '?', idioma: '?', restaurada: true, ...(chave === 'canal' ? { url: v.startsWith('@') ? `https://www.youtube.com/${v}` : `https://www.youtube.com/channel/${v}` } : {}) });
    const curIg = [...base.instagram, ...(base.removidas.instagram || []).filter((h) => !base.instagram.some((x) => x.handle === h)).map((h) => marcador('handle', h))];
    const curYt = [...base.youtube, ...(base.removidas.youtube || []).filter((h) => !base.youtube.some((x) => x.canal === h)).map((h) => marcador('canal', h))];
    const remIg = new Set(cfg.instagram?.remover || []); const remYt = new Set(cfg.youtube?.remover || []);
    const vistos = new Set(); c.instagram = [];
    for (const x of curIg) if (!remIg.has(x.handle) && !vistos.has(x.handle)) { vistos.add(x.handle); c.instagram.push(x); }
    for (const x of cfg.instagram?.adicionar || []) if (!remIg.has(x.handle) && !vistos.has(x.handle)) { vistos.add(x.handle); c.instagram.push({ ...x, adicionada: true }); }
    const vistosYt = new Set(); c.youtube = [];
    for (const x of curYt) if (!remYt.has(x.canal) && !vistosYt.has(x.canal)) { vistosYt.add(x.canal); c.youtube.push(x); }
    for (const x of cfg.youtube?.adicionar || []) if (!remYt.has(x.canal) && !vistosYt.has(x.canal)) { vistosYt.add(x.canal); c.youtube.push({ ...x, adicionada: true, url: x.canal.startsWith('@') ? `https://www.youtube.com/${x.canal}` : `https://www.youtube.com/channel/${x.canal}` }); }
    c.removidas = { instagram: [...remIg], youtube: [...remYt] };
  }

  // Campos do formulário de contas e selects de filtro (o render redesenha o HTML: o estado fica em ST).
  const root = document.getElementById('esteira');
  if (root) {
    root.addEventListener('input', (ev) => { const k = ev.target?.dataset?.rc2Campo; if (k) ST.contasForm[k] = ev.target.value; });
    root.addEventListener('input', (ev) => { const k = ev.target?.dataset?.rc2EaCampo; if (k) ST.ea[k] = ev.target.value; });
    root.addEventListener('change', (ev) => { const k = ev.target?.dataset?.rc2EaCampo; if (k) ST.ea[k] = ev.target.value; });
    root.addEventListener('input', (ev) => { const k = ev.target?.dataset?.rc2Aut; if (k && ev.target.tagName !== 'FORM') ST.autForm[k] = ev.target.value; });
    root.addEventListener('change', (ev) => { const k = ev.target?.dataset?.rc2Aut; if (k && ev.target.tagName === 'SELECT') ST.autForm[k] = ev.target.value; });
    root.addEventListener('change', async (ev) => {
      const t = ev.target; if (!t?.dataset) return;
      if (t.dataset.rc2Campo) ST.contasForm[t.dataset.rc2Campo] = t.value;
      if (t.dataset.action === 'rc2-sel') { ST.filtro[t.dataset.k] = t.value; await recarregarLista(ctxAtual()); }
    });
  }

  // Abrir direto na aba pela notificação (/?tab=reciclagem) e pela mensagem do service worker.
  function abrirAba() {
    const tentar = (n = 0) => {
      if (!window.Mesa?.state?.pronto && n < 100) return setTimeout(() => tentar(n + 1), 100);
      if (!window.Mesa) return;
      window.Mesa.state.tab = 'reciclagem'; carregar(ctxAtual(), { forcar: true }); ctxAtual().render();
    };
    tentar();
  }
  if (new URLSearchParams(location.search).get('tab') === 'reciclagem') abrirAba();
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data && ev.data.tipo === 'abrir-aba' && ev.data.aba === 'reciclagem') abrirAba(); });

  window.Reciclagem = { render, acao, carregar, badge: () => ST.itens.filter((i) => i.em_alta && !(i.reciclado || []).length).length, _st: ST };
})();
