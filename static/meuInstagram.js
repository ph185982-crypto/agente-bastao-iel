// Aba "Resultados": painel "Meu Instagram" com as métricas REAIS de cada post (via servidor → Meta).
// Só leitura. Número ausente aparece como "—", nunca como zero; formato com poucos posts vem
// marcado como "amostra pequena"; nenhuma tela declara "vencedor".
(function () {
  const st = { carregando: false, atualizando: false, dados: null, erro: null, jaCarregou: false };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const linkSeguro = (u) => (typeof u === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(u) ? u : null);
  const ha = (iso) => {
    const h = (Date.now() - Date.parse(iso)) / 3600000;
    if (!Number.isFinite(h)) return '';
    if (h < 1) return 'agora mesmo';
    if (h < 48) return `há ${Math.round(h)} h`;
    return `há ${Math.round(h / 24)} dias`;
  };

  async function carregar(ctx, { forcar = false } = {}) {
    if (st.carregando || (st.jaCarregou && !forcar)) return;
    st.carregando = true; ctx.render();
    try { st.dados = await ctx.api('/api/instagram/painel'); st.erro = null; } catch (e) { st.erro = e.message || 'Não consegui abrir o painel.'; }
    st.carregando = false; st.jaCarregou = true; ctx.render();
  }

  async function atualizar(ctx) {
    if (st.atualizando) return;
    st.atualizando = true; st.erro = null; ctx.render();
    try { st.dados = await ctx.api('/api/instagram/atualizar', { method: 'POST', body: {} }); ctx.toast('Números atualizados pela Meta.'); } catch (e) { st.erro = e.message || 'Não consegui ler o Instagram agora.'; }
    st.atualizando = false; ctx.render();
  }

  const chip = (cls, t) => `<span class="mz-chip ${cls}">${esc(t)}</span>`;

  function cartaoFormato(g) {
    const aviso = g.amostra === 'pequena' ? chip('warn', `amostra pequena (${g.n})`) : chip('ok', `${g.n} posts`);
    const seg = g.seguidores_ganhos_total == null ? '— (a Meta não informa para este formato)' : `${num(g.seguidores_ganhos_total)} em ${g.n_com_seguidores} posts com dado`;
    return `<article class="ig-card"><div class="es-between"><b>${esc(g.rotulo)}</b>${aviso}</div>
      <dl class="ig-dl">
        <div><dt>Alcance (mediana)</dt><dd>${num(g.alcance_mediana)}</dd></div>
        <div><dt>Envios por mil alcançados</dt><dd>${num(g.compartilhamentos_por_mil_mediana, 1)}</dd></div>
        <div><dt>Salvamentos por mil</dt><dd>${num(g.salvamentos_por_mil_mediana, 1)}</dd></div>
        <div><dt>Visitas ao perfil por mil</dt><dd>${num(g.visitas_por_mil_mediana, 1)}</dd></div>
      </dl><div class="es-text ig-mudo">Seguidores ganhos: ${esc(seg)}</div></article>`;
  }

  function linhaPost(p) {
    const url = linkSeguro(p.permalink);
    const titulo = esc(p.legenda || 'Sem legenda');
    return `<li class="ig-post"><div class="es-between"><span class="ig-tipo">${esc(p.tipo)}</span>${p.da_ferramenta ? chip('neutro', 'pela ferramenta') : ''}</div>
      <div class="ig-leg">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${titulo}</a>` : titulo}</div>
      <div class="ig-nums"><span><b>${num(p.alcance)}</b> alcance</span><span><b>${num(p.compartilhamentos_por_mil, 1)}</b> envios/mil</span><span><b>${num(p.salvamentos_por_mil, 1)}</b> salv./mil</span><span><b>${num(p.seguidores_ganhos)}</b> seguidores</span></div></li>`;
  }

  // Placar da ferramenta: resultado real por jeito de fazer (backend/lib/placar.js). Grupo com menos de 3 posts é só indício.
  const ROTULO_DIM = { linha: 'Linha de conteúdo', formato: 'Formato', redator: 'Quem escreveu o roteiro', capa_de: 'Quem escreveu a capa', gancho: 'Tipo de gancho', origem: 'De onde veio', estilo_video: 'Estilo do vídeo' };
  const NOME_VALOR = { noticia: 'Notícia com tese', opiniao: 'Opinião', video: 'Vídeo', outro: 'Outro', reel: 'Reel', tweet: 'Tweet', reportagem: 'Reportagem', estatico: 'Post único', ensaio: 'Ensaio', juri: 'Roteirista (júri)', piloto: 'Piloto automático', reciclagem: 'Reciclagem', manual: 'Criado por você' };
  function tabelaDim(nome, grupos) {
    if (!grupos?.length) return '';
    const linhas = grupos.map((g) => `<tr><th scope="row">${esc(NOME_VALOR[g.valor] || String(g.valor).charAt(0).toUpperCase() + String(g.valor).slice(1))}${g.amostra === 'pequena' ? ' <span class="ig-mudo">(indício)</span>' : ''}</th><td>${num(g.n)}</td><td>${num(g.alcance)}</td><td>${num(g.envios_mil, 1)}</td><td>${num(g.salvos_mil, 1)}</td><td>${g.contra_os_seus == null ? '—' : `${num(g.contra_os_seus, 2)}×`}</td></tr>`).join('');
    return `<div class="es-label">${esc(ROTULO_DIM[nome] || nome)}</div><div class="ig-tabela-wrap"><table class="ig-tabela"><thead><tr><th scope="col"></th><th scope="col">Posts</th><th scope="col">Alcance</th><th scope="col">Envios<br>/mil</th><th scope="col">Salvos<br>/mil</th><th scope="col">× os<br>seus</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  }
  function blocoPlacar(pl) {
    if (!pl) return '';
    const f = pl.ferramenta || {}; const s = pl.seus || {};
    let h = `<div class="es-card"><div class="es-label">Placar da ferramenta</div><div class="es-text">Resultado real de cada jeito de fazer, medido por <b>envios e salvos por mil alcançados</b> (só posts com mais de 48 h). É isso que decide o que o piloto produz mais.</div>
      <div class="es-text" style="margin-top:8px">Seus posts: alcance <b>${num(s.alcance)}</b> · envios/mil <b>${num(s.envios_mil, 1)}</b> (${num(s.n)} posts). Da ferramenta: alcance <b>${num(f.alcance)}</b> · envios/mil <b>${num(f.envios_mil, 1)}</b> (${num(f.n)} posts).</div></div>`;
    if (!f.n) return `${h}<div class="es-text ig-mudo">Ainda não há post da ferramenta com mais de 48 h medido. O placar se enche sozinho a cada post publicado; a leitura é feita todo dia de manhã.</div>`;
    h += Object.keys(ROTULO_DIM).map((k) => tabelaDim(k, pl.por?.[k])).join('');
    const pf = pl.pesos?.formato;
    h += `<div class="es-card"><div class="es-label">O que o placar está decidindo</div><div class="es-text">${pf ? `Formatos do piloto: 80% das vagas seguem o resultado (${Object.entries(pf).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(NOME_VALOR[k] || k)} ${num(v * 100)}%`).join(' · ')}) e 20% são repartidas por igual entre os quatro formatos, para continuar testando.` : 'Formatos: ainda sem dado suficiente (3 posts por formato em pelo menos 2 formatos). Até lá o piloto faz rodízio.'}</div>
      <div class="es-text" style="margin-top:6px">${pl.pesos?.redator ? 'Redatores: quem rende mais envios escreve mais vezes.' : 'Redatores: ainda em rodízio, por falta de dado.'}</div>
      <div class="es-text" style="margin-top:6px"><b>Nota do júri:</b> ${esc(pl.calibracao?.juri?.leitura || '—')}</div>
      <div class="es-text" style="margin-top:6px"><b>Nota do painel de 30 perfis:</b> ${esc(pl.calibracao?.painel?.leitura || '—')}</div></div>`;
    if (pl.sem_ficha) h += `<div class="es-text ig-mudo">${num(pl.sem_ficha)} post(s) da ferramenta sem registro de como foram feitos (conteúdo apagado ou de antes deste banco).</div>`;
    return h;
  }

  function seguidores30(snap) {
    const s = snap?.serie_conta?.follower_count;
    if (!s || !s.length) return null;
    const v = s.map((x) => x.valor).filter((x) => x != null);
    if (!v.length) return null;
    const total = v.reduce((a, b) => a + b, 0);
    return { total, porDia: total / v.length, dias: v.length };
  }

  function render(ctx) {
    const d = st.dados;
    const botao = `<button class="es-btn dark sm" data-action="ig-atualizar" ${st.atualizando || st.carregando ? 'disabled' : ''}>${st.atualizando ? 'Lendo a Meta…' : 'Atualizar números'}</button>`;
    let corpo = '';
    if (st.erro) corpo += `<div class="es-warn">${esc(st.erro)}</div>`;
    if (!d && !st.erro) corpo += '<div class="es-empty-day">Abrindo seus resultados…</div>';
    if (d) {
      if (d.configurado === false) corpo += `<div class="es-warn"><b>Falta ligar o Instagram no servidor.</b> Faltam: ${esc((d.faltando || []).join(', '))}. Veja o passo a passo em docs/META_SETUP.md. Para ler métricas, o token precisa da permissão <code>instagram_manage_insights</code>.</div>`;
      if (d.vazio) corpo += `<div class="es-card"><div class="es-text">Ainda não li seus posts. Toque em <b>Atualizar números</b>: a leitura traz os últimos 90 dias direto da Meta (só leitura, não publica nada).${d.historico ? '' : ' Sem banco de dados no servidor, a leitura não fica guardada.'}</div></div>`;
      if (d.snapshot) {
        const sn = d.snapshot; const a = d.analise; const s30 = seguidores30(sn);
        corpo += `<div class="es-card hero"><div class="es-between"><div><div class="es-label" style="color:#fff">${esc(sn.conta?.usuario ? '@' + sn.conta.usuario : 'Conta')}</div><div class="ig-grande">${num(sn.conta?.seguidores)}</div><div class="es-text" style="color:#fff">seguidores agora</div></div><div class="ig-lado">${s30 ? `<b>${num(s30.total)}</b> novos em ${s30.dias} ${s30.dias === 1 ? 'dia' : 'dias'}<br><small>${num(s30.porDia, 0)} por dia</small>` : '<small>Seguidores novos por dia: indisponível</small>'}</div></div>
          <div class="es-text" style="color:#fff;margin-top:8px">Atualizado ${esc(ha(sn.gerado_em))}${d.velho ? ' · números velhos, atualize' : ''}${sn.parcial ? ' · leitura incompleta' : ''}</div></div>`;
        (sn.avisos || []).forEach((av) => { corpo += `<div class="es-warn">${esc(av)}</div>`; });
        if (a) {
          corpo += `<div class="es-card"><div class="es-label">O que os números mostram</div><div class="es-text">Mediana de alcance por post: <b>${num(a.alcance_mediana)}</b> · ${num(a.n_comparaveis)} posts comparáveis de ${num(a.n_posts)} lidos.</div>${a.observacoes.length ? `<ul class="ig-obs">${a.observacoes.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div>`;
          const tipos = Object.values(a.por_tipo || {});
          if (tipos.length) corpo += `<div class="es-label">Por formato (medianas, posts com mais de 72 h)</div><div class="ig-grid">${tipos.map(cartaoFormato).join('')}</div>`;
          (a.comparacoes || []).forEach((c) => { corpo += `<div class="es-text ig-mudo">${esc(c.leitura)}</div>`; });
          const orig = Object.values(a.por_origem || {});
          if (orig.length > 1) corpo += `<div class="es-label">Ferramenta × fora dela</div><div class="ig-grid">${orig.map(cartaoFormato).join('')}</div>`;
          corpo += blocoPlacar(d.placar);
          if (a.concentracao_seguidores) { const c = a.concentracao_seguidores; corpo += `<div class="es-card"><div class="es-label">Quem traz seguidores (só posts de feed)</div><div class="es-text">${num(c.total)} seguidores atribuídos a ${num(c.n_posts)} posts; ${c.posts_sem_seguidor} não trouxeram nenhum. Os 2 maiores concentram <b>${num(c.pct_top2)}%</b>.</div></div>`; }
          if (a.melhores_por_envios?.length) corpo += `<div class="es-label">Mais enviados (por mil alcançados)</div><ul class="ig-lista">${a.melhores_por_envios.map(linhaPost).join('')}</ul>`;
          if (a.menores_por_envios?.length) corpo += `<div class="es-label">Menos enviados</div><ul class="ig-lista">${a.menores_por_envios.map(linhaPost).join('')}</ul>`;
          corpo += `<details class="ig-limites"><summary>Como ler estes números</summary><ul>${(a.limitacoes || []).map((l) => `<li>${esc(l)}</li>`).join('')}<li>Ranking descreve o que aconteceu; não prova a causa. Curtidas e comentários não entram.</li></ul></details>`;
        }
      }
    }
    return `<div class="ig-topo"><div class="es-h1">Resultados</div>${botao}</div>${corpo}`;
  }

  async function acao(a, el, ctx) {
    if (a === 'ig-atualizar') { await atualizar(ctx); return true; }
    return false;
  }

  window.MeuInstagram = { render, acao, carregar, _st: st };
})();
