(function(){
  'use strict';
  const original=window.MesaCentral;
  const M=window.ContentModel;
  const x=()=>window.Mesa.ctx();
  const esc=s=>x().esc(s);
  const ui={aba:'prontos',selecionado:null,slides:{},ocupado:null,reprovar:null,motivos:[],detalhe:'',estado:null,experimentos:null,carregando:false,erro:null,source:{modo:'link',url:'',texto:'',formato:'carrossel',estilo:'auto',objetivo:'seguidores'}};
  const ETAPAS={leitura:'Lendo a matéria',afirmacoes:'Organizando as informações',pesquisa:'Conferindo as fontes',briefing:'Preparando a abordagem',copy:'Escrevendo com a sua voz',auditoria:'Conferindo o conteúdo',foto:'Selecionando as fotos',arte:'Desenhando os slides',motion:'Renderizando o Reel',finalizar:'Finalizando a prévia',publicacao:'Publicando no Instagram'};
  const motivos={texto_longo:'Texto demais',sem_foto:'Quero mais fotos',capa_fraca:'Capa sem impacto',visual:'Mudar o visual',voz:'Não parece comigo',cta:'CTA fraco',tema:'Não gostei do tema',fatos:'Corrigir informação'};
  const padraoNovo=()=>ui.source.formato==='carrossel'&&window.RadarUI?._st?.padrao?.ativo!==false;
  const estilos={foto_editorial:'Foto + história',impacto:'Dados + contraste',revista:'Editorial + opinião'};
  const versao=c=>M.versaoAtiva(c);
  const emProducao=c=>['gerando','publicando'].includes(c.studio?.estado);
  const emRoteiro=c=>c.studio?.estado==='aguardando_roteiro'&&c.status!=='arquivado';
  function prontos(){return x().state.contents.filter(c=>!c.legado&&!['publicado','arquivado'].includes(c.status)&&!emProducao(c)&&!emRoteiro(c)&&!agendado(c)&&versao(c));}
  function agendado(c){return !!c.agenda?.publicar_em&&c.status==='aprovado'&&c.studio?.estado==='agendado';}
  function agendados(){return x().state.contents.filter(c=>!c.legado&&agendado(c)).sort((a,b)=>a.agenda.publicar_em.localeCompare(b.agenda.publicar_em));}
  const horaDe=iso=>{const d=new Date(iso);const hoje=new Date();const mesmoDia=d.toDateString()===hoje.toDateString();return `${mesmoDia?'hoje':d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit'})} às ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'})}`;};
  function roteiros(){return x().state.contents.filter(c=>!c.legado&&emRoteiro(c)&&versao(c));}
  function revisar(c){const clone=M.clone(c);clone.claims.forEach(k=>k.revisao={...(k.revisao||{}),confirmada_por_pedro:true});return window.QualityGates.avaliar(clone,{conta:M.ACCOUNT_PIN});}
  async function adotar(reg){await window.Sync.adotar(reg);const i=x().state.contents.findIndex(c=>c.id===reg.doc.id);if(i<0)x().state.contents.unshift(reg.doc);else x().state.contents[i]=reg.doc;x().state.syncMeta[reg.doc.id]=await window.Sync.meta(reg.doc.id);}
  async function atualizar({silencioso=false}={}){
    if(ui.carregando)return;ui.carregando=true;
    const antes=JSON.stringify(x().state.contents),erroAntes=ui.erro;
    try{ui.estado=await x().api('/api/studio/estado');await window.Sync.puxar();x().state.contents=await window.Store.listar();ui.erro=null;}
    catch(e){ui.erro=e.message;if(!silencioso)x().toast(e.message);}
    finally{ui.carregando=false;const mudou=antes!==JSON.stringify(x().state.contents)||erroAntes!==ui.erro;
      const video=document.querySelector('.st-video video');
      if(mudou&&!document.hidden&&!ui.reprovar&&['central','ajustes'].includes(x().state.tab)){
        if(video&&!video.paused&&!video.ended)ui.renderPendente=true;else x().render();
      }
    }
  }
  function preview(c){
    const v=versao(c);
    if(c.formato==='reels'&&c.motion?.estado==='pronto')return `<div class="st-video"><video controls playsinline preload="metadata" ${c.motion.poster?`poster="${esc(c.motion.poster)}"`:''} src="${esc(c.motion.url)}" aria-label="Prévia do Reel de ${esc(c.titulo)}"></video><span class="st-media-tag">REEL · ${c.motion.narracao===false?'LEGENDAS · SEM VOZ':'NARRAÇÃO + LEGENDAS'}</span></div>${c.motion.aviso?`<p class="st-inline-error">${esc(c.motion.aviso)}</p>`:''}`;
    const renders=v.slides.map(s=>c.arte.renders.find(r=>r.slide_id===s.id&&r.versao===v.id));
    if(renders.some(r=>!r))return `<div class="st-no-preview"><b>A prévia está sendo preparada</b><p>O sistema cuida da capa, dos textos e da conferência.</p></div>`;
    const n=ui.slides[c.id]||0;
    return `<div class="st-carousel-wrap"><div class="st-carousel" data-st-carousel="${esc(c.id)}" role="group" aria-label="Carrossel de ${v.slides.length} slides">${renders.map((r,i)=>`<img src="/api/sync/arquivos/${encodeURIComponent(r.blob_key)}" alt="Slide ${i+1}: ${esc(v.slides[i].texto.replace(/\*\*/g,''))}" loading="${i?'lazy':'eager'}" width="1080" height="1350">`).join('')}</div><div class="st-carousel-toolbar"><button data-action="st-voltar-slide" data-id="${esc(c.id)}" aria-label="Slide anterior">‹</button><span class="st-position" data-st-counter="${esc(c.id)}" aria-live="polite">${n+1}/${renders.length}</span><button data-action="st-avancar-slide" data-id="${esc(c.id)}" aria-label="Próximo slide">›</button></div><div class="st-dots" aria-label="Selecionar slide">${renders.map((_,i)=>`<button data-action="st-slide" data-id="${esc(c.id)}" data-i="${i}" aria-label="Ver slide ${i+1}" aria-current="${n===i?'true':'false'}"><i></i></button>`).join('')}</div></div>`;
  }
  function rotuloEstilo(c){
    const tv=(versao(c)?.slides||[]).find(s=>s.tema_visual)?.tema_visual;if(tv)return tv==='tweet'?'<i>· Tweet</i>':'<i>· Reportagem</i>';
    return c.experimento?.estilo&&estilos[c.experimento.estilo]?`<i>· ${esc(estilos[c.experimento.estilo])}</i>`:'';
  }
  function creditos(c){
    const rec=(c.imagens||[]).filter(i=>i.tipo==='recorte');
    const aviso=c.studio&&c.studio.foto_aviso&&/recorte/i.test(c.studio.foto_aviso)?`<p class="st-inline-error" role="status">${esc(c.studio.foto_aviso)}</p>`:'';
    const fundo=c.studio&&c.studio.aviso_fundo?`<p class="st-inline-error" role="status">${esc(c.studio.aviso_fundo)}</p>`:'';
    const lista=rec.length?`<p class="st-creditos"><b>Créditos das fotos:</b> ${rec.map(i=>`${esc(i.alt||'Foto')}, ${esc(i.autor||'')} (${esc(i.licenca||'')})${i.exige_credito?' · cite o crédito na legenda':''}`).join(' · ')}</p>`:'';
    return aviso+fundo+lista;
  }
  function cartao(c){
    const v=versao(c);const g=revisar(c);const pronto=!g.bloqueios.length && (c.formato!=='reels'||(c.motion?.estado==='pronto'&&c.motion.hash===v.hash));
    const pausado=original._st.config?.publish_paused;
    return `<article class="st-review-card" data-st-card="${esc(c.id)}"><div class="st-card-heading"><span class="st-format">${c.formato==='reels'?'Reel motion':c.formato==='estatico'?'Post único':'Carrossel'} ${rotuloEstilo(c)}</span><h2>${esc(c.titulo)}</h2></div>
      ${preview(c)}${diagnostico(c)}
      ${c.top?`<p class="st-juri"><b>Júri ${esc(Number(c.top.escolha?.nota||0).toFixed(1).replace('.',','))}</b> · ${esc(c.top.angulo?.tese||'')}</p>`:''}
      <div class="st-review-body">${c.studio?.erro?`<p class="st-inline-error" role="status">${esc(c.studio.erro)}</p>`:''}
      ${c.top?barraTop(c,pronto,g,pausado):`${!pronto?'<p class="st-preparing-note">Vou resolver as pendências e montar uma prévia completa. Você aprova uma única vez, no final.</p>':''}
      <div class="st-decisionbar"><button class="st-reject" data-action="st-rejeitar" data-id="${esc(c.id)}" ${ui.ocupado?'disabled':''}>↻ Refazer</button><button class="st-approve" data-action="${pronto?'st-aprovar':'st-preparar'}" data-id="${esc(c.id)}" ${ui.ocupado||pausado?'disabled':''}>${ui.ocupado===c.id?'<span class="es-spin"></span> Enviando…':pausado?'Publicações pausadas':pronto?(c.top?'✓ Aprovar e agendar':'✓ Aprovar e publicar'):'Preparar automaticamente'}</button></div>${c.top&&pronto?'<p class="st-agenda-nota">Aprovado, entra no próximo horário livre da grade. Nada sai antes.</p>':''}`}
      <details class="st-caption"><summary>Ver legenda e detalhes</summary><p>${esc([v.legenda,v.cta,(v.hashtags||[]).join(' ')].filter(Boolean).join('\n\n'))}</p>${creditos(c)}<button class="st-text-button" data-action="cn-revisar" data-id="${esc(c.id)}">Ajustar manualmente</button></details></div></article>`;
  }
  // Carrossel do piloto: publicar agora ou agendar no próximo horário livre. Nunca passa pela preparação antiga.
  function barraTop(c,pronto,g,pausado){
    const oc=ui.ocupado?'disabled':'';
    if(!pronto){const b=g.bloqueios[0]||{};return `<p class="st-inline-error" role="status"><b>${esc(b.titulo||'Falta um ajuste')}</b>${b.detalhe?` · ${esc(b.detalhe)}`:''}</p><div class="st-decisionbar"><button class="st-reject" data-action="st-rejeitar" data-id="${esc(c.id)}" ${oc}>↻ Refazer</button><button class="st-approve" data-action="st-reparar" data-id="${esc(c.id)}" ${oc}>${ui.ocupado===c.id?'<span class="es-spin"></span> Consertando…':'Consertar'}</button></div>`;}
    if(pausado)return `<div class="st-decisionbar"><button class="st-approve" disabled>Publicações pausadas</button></div>`;
    return `<div class="st-decisionbar st-decisionbar-top"><button class="st-approve" data-action="st-publicar-agora" data-id="${esc(c.id)}" ${oc}>${ui.ocupado===c.id?'<span class="es-spin"></span> Enviando…':'✓ Publicar agora'}</button><button class="st-agendar" data-action="st-aprovar" data-id="${esc(c.id)}" ${oc}>${ui.ocupado===c.id?'<span class="es-spin"></span>':'🕒 Agendar'}</button><button class="st-reject st-descartar-btn" data-action="st-descartar-direto" data-id="${esc(c.id)}" ${oc}>${ui.ocupado===c.id?'<span class="es-spin"></span>':'✕ Descartar'}</button></div><p class="st-agenda-nota">Agendar: entra no próximo horário livre da grade (${esc((original._st.piloto?.config?.horarios||[]).join(' · ')||'09:00 · 11:00 · 12:30 · 15:00 · 17:00 · 18:30 · 20:00 · 21:30')}).</p><button class="st-text-button" data-action="st-rejeitar" data-id="${esc(c.id)}" ${oc}>↻ Refazer com um ajuste</button>`;
  }
  function cartaoRoteiro(c){
    const v=versao(c),m=c.monitor||{};
    const limpa=t=>esc(String(t||'').replace(/\*\*/g,''));
    const fontes=(m.fontes&&m.fontes.length?m.fontes:[{url:c.fonte_principal?.url,origem:c.fonte_principal?.veiculo}]).filter(f=>f&&/^https?:\/\//.test(f.url||''));
    const ocupado=ui.ocupado===c.id;
    return `<article class="st-review-card st-roteiro" data-st-roteiro="${esc(c.id)}"><div class="st-card-heading"><span class="st-format">ROTEIRO${m.veiculos?' · EM ALTA':''}</span><h2>${esc(c.titulo)}</h2></div>
      ${m.veiculos?`<p class="st-alta">Coberto por <b>${esc(m.veiculos)} veículos</b>${m.horas!=null?` · a mais nova há ${esc(m.horas)} h`:''}${(m.veiculos_nomes||[]).length?` (${esc(m.veiculos_nomes.join(', '))})`:''}. É um sinal de cobertura, não de audiência.</p>`:''}
      ${m.por_que_enviaria?`<p class="st-alta"><b>Por que alguém mandaria:</b> ${esc(m.por_que_enviaria)}</p>`:''}
      <ol class="st-roteiro-slides">${v.slides.map((sl,i)=>`<li><span>${i+1}</span><div>${sl.titulo?`<b>${limpa(sl.titulo)}</b> `:''}${limpa(sl.texto)}</div></li>`).join('')}</ol>
      <details class="st-caption" open><summary>Legenda e chamada final</summary><p>${esc([v.legenda,v.cta].filter(Boolean).join('\n\n'))}</p></details>
      ${fontes.length?`<p class="st-alta">Fonte: ${fontes.map(f=>`<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.origem||'matéria')}</a>`).join(' · ')}</p>`:''}
      <p class="st-preparing-note">O carrossel só é gerado depois que você aprovar este roteiro. Nada vai ao Instagram sem o seu toque em “Aprovar e publicar”.</p>
      <div class="st-decisionbar"><button class="st-reject" data-action="st-roteiro-refazer" data-id="${esc(c.id)}" ${ui.ocupado?'disabled':''}>↻ Outro roteiro</button><button class="st-approve" data-action="st-roteiro-aprovar" data-id="${esc(c.id)}" ${ui.ocupado?'disabled':''}>${ocupado?'<span class="es-spin"></span> Enviando…':'✓ Aprovar roteiro e gerar carrossel'}</button></div>
      <button class="st-text-button" data-action="st-roteiro-descartar" data-id="${esc(c.id)}" ${ui.ocupado?'disabled':''}>Descartar este assunto</button></article>`;
  }
  // Com o app aberto, também dá uma rodada do piloto a cada 5 min (o agendador do GitHub às vezes atrasa).
  async function rodarPiloto(){
    if(ui.pilotoEmCurso||document.hidden)return;const agora=Date.now();if(ui.pilotoChecado&&agora-ui.pilotoChecado<300000)return;ui.pilotoChecado=agora;
    ui.pilotoEmCurso=true;try{const r=await x().api('/api/top/piloto/rodada',{method:'POST',body:{}});if(r.publicados?.length||r.avancados?.some(a=>a.estado==='concluida'))await atualizar({silencioso:true});}catch(e){/* sem acesso ou sem banco: tenta na próxima */}finally{ui.pilotoEmCurso=false;}
  }
  async function monitorar(){
    if(ui.monitorEmCurso||document.hidden)return;
    const agora=Date.now();if(ui.monitorChecado&&agora-ui.monitorChecado<60000)return;ui.monitorChecado=agora;
    try{
      const e=await x().api('/api/monitor/estado');ui.monitor=e;
      if(!e.config?.ativo||!e.guardado)return;
      const ult=e.ultimo_tick?Date.parse(e.ultimo_tick):0;if(agora-ult<e.config.intervalo_min*60000)return;
      ui.monitorEmCurso=true;const r=await x().api('/api/monitor/tick',{method:'POST',body:{}});
      if(r.alertas?.length){x().toast(`Em alta: ${r.alertas[0].titulo}`);await atualizar({silencioso:true});}
    }catch(e){/* sem rede ou sem acesso: tenta de novo na próxima volta */}
    finally{ui.monitorEmCurso=false;}
  }
  function filaProduzindo(){
    const lista=x().state.contents.filter(c=>emProducao(c)||(!c.legado&&!versao(c)&&!['publicado','arquivado'].includes(c.status)));
    if(!lista.length)return '';
    return `<section class="st-production"><h2>Em preparação <span>${lista.length}</span></h2>${lista.map(c=>{const st=c.studio||{},ativo=emProducao(c);return `<div class="st-job">${ativo?'<span class="es-spin"></span>':'<span>↻</span>'}<div><b>${esc(c.titulo)}</b>${c.monitor?.veiculos?`<small>Em alta · ${esc(c.monitor.veiculos)} veículos${st.roteiro_primeiro&&!st.roteiro_aprovado?' · montando o roteiro':''}</small>`:''}<small>${esc(st.estado==='erro'?st.erro:ativo?st.aviso||ETAPAS[st.etapa]||'Preparando':'Rascunho da sua biblioteca')} ${st.etapa==='arte'?`· slide ${(st.indice||0)+1}`:''}</small>${!ativo?`<button class="st-text-button" data-action="st-preparar" data-id="${esc(c.id)}">${st.estado==='erro'?'Tentar novamente':'Preparar automaticamente'}</button>`:''}</div></div>`;}).join('')}<p>Pode fechar o app. A preparação continua e, com notificações ativas, você recebe o aviso.</p></section>`;
  }
  function modal(){
    if(!ui.reprovar)return '';
    return `<div class="st-modal-backdrop"><section class="st-feedback-sheet" role="dialog" aria-modal="true" aria-labelledby="st-feedback-title"><div class="st-sheet-handle"></div><button class="st-modal-close" data-action="st-fechar" aria-label="Fechar motivos de ajuste">×</button><span class="st-eyebrow">DO SEU JEITO</span><h2 id="st-feedback-title">O que vamos melhorar?</h2><p>Seu retorno orienta esta versão e as próximas criações.</p><div class="st-reasons">${Object.entries(motivos).map(([k,v])=>`<button data-action="st-motivo" data-m="${k}" aria-pressed="${ui.motivos.includes(k)}">${esc(v)}</button>`).join('')}</div><label for="st-feedback-text">Quer explicar melhor? <small>Opcional</small></label><textarea id="st-feedback-text" rows="3" maxlength="500" placeholder="Ex.: menos texto, foto na capa e um CTA mais direto…">${esc(ui.detalhe)}</textarea><p class="st-feedback-error" role="status">${esc(ui.erroFeedback||'')}</p><button class="st-approve" data-action="st-confirmar-refazer" ${ui.ocupado?'disabled':''}>${ui.ocupado?'Salvando seu ajuste…':'Refazer com esse ajuste'}</button><button class="st-text-button" data-action="st-descartar">Só descartar este conteúdo</button></section></div>`;
  }
  function trilho(nValidar,nRoteiros,nPublicados){
    const nPrep=x().state.contents.filter(c=>emProducao(c)||(!c.legado&&!versao(c)&&!['publicado','arquivado'].includes(c.status))).length;
    const passos=[['Roteiros para aprovar',nRoteiros,'prontos'],['Em preparação',nPrep,'prontos'],['Carrosséis para validar',nValidar,'prontos'],['Publicados',nPublicados,'publicados']];
    const vez=passos.findIndex((p,i)=>i<3&&p[1]>0);
    return `<nav class="st-trilho" aria-label="Andamento do conteúdo">${passos.map(([t,n,aba],i)=>`<button data-action="st-aba" data-aba="${aba}" class="${i===vez?'vez':''} ${n?'':'vazio'}"><span class="n">${n}</span><span class="t">${t}</span></button>`).join('')}</nav>`;
  }
  function linhaMonitor(){
    const e=ui.monitor;if(!e)return '';
    const ligado=e.config?.ativo;
    if(!ligado)return '<p class="st-monitor off"><i></i><span><b>Monitor desligado.</b> Ligue em Perfil para receber as pautas em alta.</span></p>';
    if(!e.guardado)return '<p class="st-monitor off"><i></i><span><b>Monitor ligado, mas sem banco de dados no servidor.</b> Veja docs/ATIVACAO.md.</span></p>';
    const ult=e.ultimo_tick?Math.max(0,Math.round((Date.now()-Date.parse(e.ultimo_tick))/60000)):null;
    const quando=ult==null?'ainda não buscou':ult<1?'buscou agora':ult<120?`buscou há ${ult} min`:`buscou há ${Math.round(ult/60)} h`;
    return `<p class="st-monitor"><i></i><span><b>Monitor ligado</b> · ${quando} · ${e.roteiros_hoje||0} de ${e.config.max_roteiros_dia} roteiros hoje</span></p>`;
  }
  function render(){
    const lista=prontos();const listaRoteiros=roteiros();if(!lista.some(c=>c.id===ui.selecionado))ui.selecionado=lista[0]?.id||null;
    const c=lista.find(c=>c.id===ui.selecionado);const i=lista.findIndex(c=>c.id===ui.selecionado);
    const publicados=x().state.contents.filter(c=>c.status==='publicado'&&!c.legado);
    const pushAtivo=original._st.push?.ativo;
    return `<div class="st-app"><div class="st-page-heading"><div><span class="st-eyebrow">SEU CONTEÚDO, SUA VOZ</span><h1>Pronto para <span class="br">ir ao ar</span>?</h1><p>Deslize. Confira. Aprove ou peça um ajuste.</p></div><button class="st-new" data-action="st-criar">+ Criar</button></div>
      ${trilho(lista.length,listaRoteiros.length,publicados.length)}${linhaMonitor()}${!pushAtivo?`<button class="st-push-banner" data-action="${original._st.push?.permissao==='denied'?'st-perfil':'st-notificacoes'}"><span>♧</span><span><b>Receba um aviso no iPhone</b><small>${original._st.push?.permissao==='denied'?'Veja como liberar as notificações.':'Ative para saber quando o conteúdo ficar pronto.'}</small></span><i>›</i></button>`:''}
      ${ui.erro?`<div class="es-warn" role="status">${esc(ui.erro)}</div>`:''}
      <div class="st-feed-tabs" role="group" aria-label="Conteúdos"><button data-action="st-aba" data-aba="prontos" aria-pressed="${ui.aba==='prontos'}">Para aprovar <span>${lista.length+listaRoteiros.length}</span></button><button data-action="st-aba" data-aba="publicados" aria-pressed="${ui.aba==='publicados'}">Publicados <span>${publicados.length}</span></button></div>
      ${ui.aba==='prontos'&&agendados().length?`<section class="st-agendados"><h2>Agendados <span>${agendados().length}</span></h2><ul>${agendados().map(c=>`<li><span class="st-hora">${esc(horaDe(c.agenda.publicar_em))}</span><b>${esc(c.titulo)}</b><button class="st-text-button" data-action="st-desagendar" data-id="${esc(c.id)}">Desagendar</button></li>`).join('')}</ul></section>`:''}${ui.aba==='prontos'&&listaRoteiros.length?`<section class="st-roteiros"><h2>Roteiros para aprovar <span>${listaRoteiros.length}</span></h2>${listaRoteiros.map(cartaoRoteiro).join('')}</section>`:''}${ui.aba==='prontos'?`${lista.length>1?`<div class="st-card-pagination"><span>Conteúdo ${i+1} de ${lista.length}</span><div><button data-action="st-anterior" aria-label="Conteúdo anterior" ${i<=0?'disabled':''}>‹</button><button data-action="st-proximo" aria-label="Próximo conteúdo" ${i>=lista.length-1?'disabled':''}>›</button></div></div>`:''}${c?cartao(c):`<div class="st-empty-feed"><img src="/logo-app.svg" alt="Pedro Destrava" width="58" height="58"><h2>${x().state.contents.some(emProducao)?'Seu próximo conteúdo está a caminho':'Vamos preparar seu próximo post?'}</h2><p>${x().state.contents.some(emProducao)?'Você verá a prévia completa aqui assim que estiver pronta.':'Comece com uma matéria ou texto. Eu cuido do formato, da capa e da preparação.'}</p><button class="st-approve" data-action="st-criar">Criar conteúdo</button></div>`}${filaProduzindo()}`:`<div class="st-published">${publicados.map(c=>`<article><span>✓ Publicado · ${esc(c.formato==='reels'?'Reel':'Carrossel')}</span><h2>${esc(c.titulo)}</h2>${c.publicacao?.url?`<a href="${esc(c.publicacao.url)}" target="_blank" rel="noopener noreferrer">Ver no Instagram ↗</a>`:'<p>O link ainda não está disponível.</p>'}</article>`).join('')||'<div class="st-empty-feed"><h2>Os próximos resultados começam aqui</h2><p>Quando você aprovar e o Instagram confirmar, o post aparece nesta lista.</p></div>'}</div>`}
      </div>${modal()}`;
  }
  function modeloCriacao(){
    const gm=window.GrowthModel,s=ui.source,p=gm.plano(s.formato,s.objetivo);
    return `<section class="st-growth"><div class="st-growth-heading"><span class="st-eyebrow">MODELO DE VIRALIZAÇÃO</span><b>Método Destrava</b><p>Prender a atenção. Entregar valor. Dar motivo para voltar.</p></div><label for="st-objetivo">Objetivo principal</label><select id="st-objetivo" class="es-input">${Object.entries(gm.OBJETIVOS).map(([id,o])=>`<option value="${id}" ${s.objetivo===id?'selected':''}>${esc(o.nome)}</option>`).join('')}</select><details><summary>Como o modelo funciona</summary><ol>${gm.PASSOS.map(p=>`<li><b>${esc(p.nome)}</b><span>${esc(p.texto)}</span></li>`).join('')}</ol><p class="st-growth-sequence">${s.formato==='video_link'?'No vídeo por link, o modelo orienta gancho e legenda. O áudio e a sequência original do vídeo são preservados.':esc(p.sequencia.join(' → '))}</p><small>Um método de criação e teste. Viralização depende da resposta real do público.</small></details></section>`;
  }
  function diagnostico(c){
    const d=window.GrowthModel.diagnosticar(c);if(!d.checks.length)return '';
    return `<details class="st-growth-review"><summary>Método Destrava · ver construção do conteúdo</summary><p>Objetivo: ${esc(window.GrowthModel.OBJETIVOS[d.objetivo]?.nome||'Ganhar seguidores')}</p><ul>${d.checks.map(k=>`<li class="${k.ok?'ok':'adjust'}"><b>${k.ok?'✓':'↗'} ${esc(k.nome)}</b>${!k.ok?`<span>${esc(k.dica)}</span>`:''}</li>`).join('')}</ul><small>${esc(d.aviso)}</small></details>`;
  }
  function telaCriar(){
    const s=ui.source;
    const formats=[['carrossel','▧','Carrossel','História visual e conversa'],['estatico','□','Post único','Uma ideia que vale compartilhar'],['video_link','▶','Vídeo por link','Viral ou Tradicional'],['reels','▷','Reel motion','Narração e animações']];
    const form=s.formato==='video_link'?window.StudioVideo.render():`<section class="st-create-form"><div class="st-source-tabs" role="group" aria-label="Tipo de fonte"><button data-action="st-source" data-m="link" aria-pressed="${s.modo==='link'}">Link de matéria</button><button data-action="st-source" data-m="texto" aria-pressed="${s.modo==='texto'}">Colar texto</button></div>${s.modo==='link'?`<label for="st-url">Link da matéria</label><input id="st-url" type="url" inputmode="url" class="es-input" placeholder="https://site.com/materia" value="${esc(s.url)}"><small>Para transformar um vídeo do Instagram, escolha “Vídeo por link” acima.</small>`:`<label for="st-texto">Texto para desenvolver</label><textarea id="st-texto" rows="7" class="es-input" placeholder="Cole o texto da matéria ou do post…">${esc(s.texto)}</textarea><small>Pelo menos 200 caracteres para preparar o conteúdo.</small>`}${padraoNovo()?'':`<label for="st-estilo">Direção visual</label><select id="st-estilo" class="es-input"><option value="auto" ${s.estilo==='auto'?'selected':''}>Variar e aprender com meus retornos</option>${Object.entries(estilos).map(([k,l])=>`<option value="${k}" ${s.estilo===k?'selected':''}>${l}</option>`).join('')}</select>`}<p class="st-create-help">${s.formato==='reels'?'Reel vertical com narração em português, legendas e imagens em movimento. Duração próxima de 1 minuto, conforme o texto.':padraoNovo()?'Modelo Pedro Destrava — Minimalista: pesquisa e confere as fontes, monta o briefing, três ganchos e as telas, procura imagens pertinentes e passa por revisão. O carrossel aparece no Radar para você editar e aprovar.':'Capa curta, fotos, dados em destaque e uma pergunta para abrir conversa. Você confere o resultado e aprova uma vez.'}</p><button class="st-approve" data-action="st-gerar" ${ui.ocupado?'disabled':''}>${ui.ocupado==='novo'?'Iniciando a preparação…':s.formato==='reels'?'Preparar meu Reel motion':s.formato==='estatico'?'Preparar meu post':'Preparar meu carrossel'}</button></section>`;
    return `<div class="st-create"><span class="st-eyebrow">DO LINK AO CONTEÚDO</span><h1>O que vamos <span class="br">criar</span>?</h1><p class="es-sub">Escolha o formato e traga a sua fonte.</p><div class="st-format-picker" role="group" aria-label="Formato do conteúdo">${formats.map(([id,icon,t,d])=>`<button data-action="st-formato" data-f="${id}" aria-pressed="${s.formato===id}"><i>${icon}</i><b>${t}</b><small>${d}</small></button>`).join('')}</div>${modeloCriacao()}${form}<button class="st-text-button" data-action="st-ferramentas">Abrir todas as ferramentas →</button><button class="st-text-button" data-action="ca-abrir">Prova com número real (Conta aberta) →</button><details class="st-library"><summary>Minha biblioteca <span>${x().state.contents.length}</span></summary><div class="studio-library-tools"><label class="studio-search"><input id="library-search" type="search" value="${esc(x().state.busca)}" placeholder="Buscar conteúdo" aria-label="Buscar na biblioteca"></label></div><div id="library-results" class="es-stack">${x().state.contents.filter(c=>!c.legado&&c.status!=='arquivado').map(c=>`<button class="es-card mz-item" data-action="st-ver" data-id="${esc(c.id)}"><span class="st-format">${esc(c.status==='publicado'?'Publicado':emProducao(c)?'Em preparação':'Para conferir')}</span><div class="es-title">${esc(c.titulo)}</div></button>`).join('')}</div></details></div>`;
  }
  function perfil(){
    const p=original._st.push||{};const dados=ui.experimentos;
    const aberto=window.__picoAuth&&window.__picoAuth.estado==='aberto_publico'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1';
    const avisoAcesso=aberto?'<section class="st-settings-card st-alerta-acesso" role="alert"><h2>Acesso aberto ao público</h2><p>Qualquer pessoa com o endereço deste app pode usá-lo. Por segurança, <b>publicar no Instagram fica bloqueado</b> até você criar o seu código de acesso. Leva 10 segundos e não precisa mexer na Vercel.</p><button class="st-approve" data-action="st-criar-codigo">Criar meu código</button></section>':'';
    return avisoAcesso+`<section class="st-profile-card"><img src="/logo-app.svg" width="54" height="54" alt="Logo do app"><div><b>Pedro Destrava</b><span>@pedro_destrava</span></div><span class="st-account-tag">Seu estúdio</span></section><section class="st-settings-card"><h2>Notificações no iPhone</h2><p>${p.ativo?'Ativas neste aparelho. Você será avisado quando o conteúdo estiver pronto e quando for publicado.':p.permissao==='denied'?'O aparelho bloqueou a permissão. Libere as notificações deste app nos Ajustes do iPhone e volte aqui.':'Abra pelo ícone na Tela de Início, toque em ativar e permita o recebimento.'}</p><button class="st-approve" data-action="st-notificacoes">${p.ativo?'Verificar ativação':'Ativar notificações'}</button>${p.ativo?'<button class="es-btn ghost sm" data-action="st-push-teste">Enviar notificação de teste</button>':''}</section><section class="st-settings-card"><div class="es-between"><h2>Formatos em teste</h2><button class="st-text-button" data-action="st-metricas" ${ui.ocupado==='metricas'?'disabled':''}>${ui.ocupado==='metricas'?'Atualizando…':'Atualizar dados'}</button></div><p>Seu retorno ajusta a criação. Compare compartilhamentos e salvamentos por mil contas alcançadas. Os testes variam a abordagem; seu retorno continua orientando a criação.</p><div class="st-experiment-grid">${(dados?.estilos||Object.entries(estilos).map(([id,nome])=>({id,nome}))).map(e=>`<article><b>${esc(e.nome)}</b><span>${e.publicados||0} publicados · ${e.medidos||0} medidos</span><strong>${e.medidos?Number(e.alcance||0).toLocaleString('pt-BR'):'—'}</strong><small>${e.medidos?'contas alcançadas':'Aguardando dados reais'}</small>${e.medidos&&e.alcance?`<small>${((e.interacoes||0)/e.alcance*100).toFixed(1)}% de interações por alcance</small>`:''}<small>${e.compartilhamentos_por_mil!=null?`${Number(e.compartilhamentos_por_mil).toLocaleString('pt-BR')} compartilhamentos / mil alcançados`:'Compartilhamentos: aguardando dados'}</small><small>${e.salvos_por_mil!=null?`${Number(e.salvos_por_mil).toLocaleString('pt-BR')} salvamentos / mil alcançados`:'Salvamentos: aguardando dados'}</small><small>${e.seguidores_por_mil!=null?`${Number(e.seguidores_por_mil).toLocaleString('pt-BR')} seguidores / mil alcançados`:'Seguidores por post: não informado'}</small><span>${e.aprovacoes||0} aprovações · ${e.ajustes||0} pedidos de ajuste</span></article>`).join('')}</div><small>O Instagram pode não informar seguidores ganhos por post. Não há vencedor definido enquanto faltarem dados comparáveis.</small></section>`;
  }
  async function acao(a,el,ctx){
    if(!a.startsWith('st-'))return original.acao(a,el,ctx);
    if(a.startsWith('st-link-'))return window.StudioVideo.action(a,el);
    const id=el.dataset.id;const c=id?ctx.state.contents.find(c=>c.id===id):null;
    try{
      switch(a){
        case 'st-criar':ctx.state.tab='mesa';ctx.state.sub=null;ctx.render();return true;
        case 'st-ferramentas':ctx.state.tab='criar';ctx.state.criarModulo='editor';ctx.render();return true;
        case 'st-perfil':ctx.state.tab='ajustes';ctx.render();return true;
        case 'st-ver':ui.selecionado=id;ui.aba=c.status==='publicado'?'publicados':'prontos';ctx.state.tab='central';ctx.render();return true;
        case 'st-aba':ui.aba=el.dataset.aba;ctx.render();return true;
        case 'st-anterior':case 'st-proximo':{const l=prontos(),i=l.findIndex(c=>c.id===ui.selecionado);ui.selecionado=l[i+(a==='st-proximo'?1:-1)]?.id||ui.selecionado;ctx.render();return true;}
        case 'st-voltar-slide':case 'st-avancar-slide':{const item=ctx.state.contents.find(c=>c.id===id);ui.slides[id]=Math.max(0,Math.min(versao(item).slides.length-1,(ui.slides[id]||0)+(a==='st-avancar-slide'?1:-1)));aposRender(document.getElementById('esteira'));return true;}
        case 'st-slide':ui.slides[id]=Number(el.dataset.i);aposRender(document.getElementById('esteira'));return true;
        case 'st-source':ui.source.modo=el.dataset.m;ctx.render();return true;
        case 'st-formato':ui.source.formato=el.dataset.f;ctx.render();return true;
        case 'st-gerar':{
          const s=ui.source;if(s.modo==='link'&&!/^https?:\/\/\S+$/.test(s.url.trim())){ctx.toast('Cole um link de matéria que comece com https://');document.getElementById('st-url')?.focus();return true;}
          if(s.modo==='texto'&&s.texto.trim().length<200){ctx.toast('Cole um texto com pelo menos 200 caracteres.');document.getElementById('st-texto')?.focus();return true;}
          if(ui.ocupado)return true;ui.ocupado='novo';ctx.render();
          // Carrossel novo: padrão único "Pedro Destrava — Minimalista" (pauta no Radar). Reels e post único seguem pelo estúdio.
          if(s.formato==='carrossel'){const pd=await ctx.api('/api/radar/padrao').catch(()=>null);if(!pd||pd.ativo!==false){try{const r=await ctx.api('/api/radar/pautas',{method:'POST',body:{...(s.modo==='link'?{url:s.url.trim()}:{texto:s.texto.trim()}),origem:'estudio'}});ui.source.url='';ui.source.texto='';ctx.state.tab='radar';if(window.RadarUI){window.RadarUI._st.pautas.unshift(r.pauta);await window.RadarUI.carregar(ctx,{forcar:true});}ctx.toast('Pauta enviada ao Radar: pesquisa, texto e imagens no padrão Pedro Destrava — Minimalista.');}finally{ui.ocupado=null;ctx.render();}break;}}
          const reg=await ctx.api('/api/studio/criar',{method:'POST',body:{...(s.modo==='link'?{url:s.url.trim()}:{texto:s.texto.trim()}),formato:s.formato,estilo:s.estilo,objetivo:s.objetivo,voz:ctx.state.config.voice_profile,request_id:crypto.randomUUID()}});await adotar(reg);ui.source.url='';ui.source.texto='';ctx.state.tab='central';ui.aba='prontos';ctx.toast('Preparação iniciada. Pode acompanhar por aqui.');break;
        }
        case 'st-publicar-agora':{
          if(ui.ocupado)return true;ui.ocupado=id;ctx.render();
          const r=await window.Sync.enviar(c);if(!['igual','enviado'].includes(r.estado))throw new Error('Este conteúdo mudou em outro aparelho. Atualize a lista antes de continuar.');
          const reg=await ctx.api(`/api/studio/${encodeURIComponent(id)}/decidir`,{method:'POST',body:{acao:'aprovar',hash:versao(c)?.hash,agora:true}});await adotar(reg);ui.selecionado=null;ctx.toast('Aprovado! Publicando no Instagram agora.');break;
        }
        case 'st-reparar':{
          if(ui.ocupado)return true;ui.ocupado=id;ctx.render();
          try{await ctx.api(`/api/top/carrosseis/${encodeURIComponent(id)}/reparar`,{method:'POST',body:{}});await atualizar({silencioso:true});ctx.toast('Consertado. Confira e aprove.');}finally{ui.ocupado=null;ctx.render();}return true;
        }
        case 'st-descartar-direto':{
          if(ui.ocupado)return true;ui.ocupado=id;ctx.render();
          const r=await window.Sync.enviar(c);if(!['igual','enviado'].includes(r.estado))throw new Error('Atualize a lista antes de descartar.');
          const reg=await ctx.api(`/api/studio/${encodeURIComponent(id)}/decidir`,{method:'POST',body:{acao:'descartar',motivos:[],detalhe:'',hash:versao(c)?.hash}});await adotar(reg);ui.selecionado=null;ctx.toast(c.top?'Descartado. O piloto faz outro no lugar.':'Conteúdo descartado.');break;
        }
        case 'st-aprovar':case 'st-preparar':{
          if(ui.ocupado)return true;ui.ocupado=id;ctx.render();
          const r=await window.Sync.enviar(c);if(!['igual','enviado'].includes(r.estado))throw new Error('Este conteúdo mudou em outro aparelho. Atualize a lista antes de continuar.');
          const reg=await ctx.api(`/api/studio/${encodeURIComponent(id)}/${a==='st-aprovar'?'decidir':'retomar'}`,{method:'POST',body:{acao:'aprovar',hash:versao(c)?.hash}});await adotar(reg);ui.selecionado=null;ctx.toast(a==='st-aprovar'?(reg.doc?.agenda?.publicar_em?`Aprovado! Vai ao ar ${horaDe(reg.doc.agenda.publicar_em)}.`:'Aprovado! Enviando ao Instagram.'):'Vou preparar a versão completa para você conferir.');break;
        }
        case 'st-criar-codigo':{window.PicoAuth?.criarCodigo?.();return true;}
        case 'st-desagendar':{if(ui.ocupado)return true;ui.ocupado=id;ctx.render();try{await ctx.api(`/api/top/carrosseis/${encodeURIComponent(id)}/desagendar`,{method:'POST',body:{}});await atualizar({silencioso:true});ctx.toast('Desagendado. Ele volta para "Para aprovar".');}finally{ui.ocupado=null;ctx.render();}return true;}
        case 'st-roteiro-aprovar':case 'st-roteiro-refazer':case 'st-roteiro-descartar':{
          if(ui.ocupado)return true;
          if(a==='st-roteiro-descartar'&&!confirm('Descartar este assunto?'))return true;
          ui.ocupado=id;ctx.render();
          const r=await window.Sync.enviar(c);if(!['igual','enviado'].includes(r.estado))throw new Error('Este conteúdo mudou em outro aparelho. Atualize a lista antes de continuar.');
          const acaoApi=a==='st-roteiro-aprovar'?'aprovar':a==='st-roteiro-refazer'?'refazer':'descartar';
          const reg=await ctx.api(`/api/studio/${encodeURIComponent(id)}/roteiro`,{method:'POST',body:{acao:acaoApi,hash:versao(c)?.hash,...(acaoApi==='refazer'?{motivos:['voz'],detalhe:'Outro roteiro para o mesmo assunto.'}:{})}});await adotar(reg);
          ctx.toast(acaoApi==='aprovar'?'Roteiro aprovado. Gerando o carrossel; aviso quando ficar pronto.':acaoApi==='refazer'?'Escrevendo outro roteiro.':'Assunto descartado.');break;
        }
        case 'st-rejeitar':ui.reprovar=id;ui.motivos=[];ui.detalhe='';ui.erroFeedback=null;ctx.render();return true;
        case 'st-fechar':ui.reprovar=null;ctx.render();return true;
        case 'st-motivo':ui.motivos=ui.motivos.includes(el.dataset.m)?ui.motivos.filter(k=>k!==el.dataset.m):[...ui.motivos,el.dataset.m];ctx.render();return true;
        case 'st-confirmar-refazer':case 'st-descartar':{
          if(ui.ocupado)return true;
          if(a==='st-confirmar-refazer'&&!ui.motivos.length&&!ui.detalhe.trim()){ui.erroFeedback='Escolha um motivo ou conte o que deseja mudar.';ctx.render();return true;}
          const alvo=ctx.state.contents.find(c=>c.id===ui.reprovar);ui.ocupado=alvo.id;ctx.render();
          const r=await window.Sync.enviar(alvo);if(!['igual','enviado'].includes(r.estado))throw new Error('Atualize a lista antes de pedir o ajuste.');
          const reg=await ctx.api(`/api/studio/${encodeURIComponent(alvo.id)}/decidir`,{method:'POST',body:{acao:a==='st-descartar'?'descartar':'refazer',motivos:ui.motivos,detalhe:ui.detalhe,hash:versao(alvo).hash}});await adotar(reg);ui.reprovar=null;ui.selecionado=null;ctx.toast(a==='st-descartar'?'Conteúdo descartado.':'Seu retorno foi salvo. Estou preparando outra versão.');break;
        }
        case 'st-notificacoes':return await original.acao('cn-push',el,ctx);
        case 'st-push-teste':{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(!sub)throw new Error('Ative as notificações primeiro.');const r=await ctx.api('/api/push/teste',{method:'POST',body:{endpoint:sub.endpoint}});ctx.toast(r.enviadas?'Teste enviado ao seu aparelho.':'Não consegui enviar o teste.');return true;}
        case 'st-metricas':ui.ocupado='metricas';ctx.render();ui.experimentos=await ctx.api('/api/studio/metricas',{method:'POST',body:{}});ctx.toast(ui.experimentos.atualizados?`${ui.experimentos.atualizados} post(s) com métricas atualizadas.`:'Ainda não há métricas disponíveis para os formatos em teste.');break;
        default:return false;
      }
    }catch(e){ctx.toast(e.message);if(ui.reprovar)ui.erroFeedback=e.message;}
    finally{ui.ocupado=null;ctx.render();}
    return true;
  }
  function aposRender(root){
    root.querySelectorAll('[data-st-carousel]').forEach(el=>{const i=ui.slides[el.dataset.stCarousel]||0;el.scrollLeft=i*el.clientWidth;});
    const dialog=root.querySelector('[role="dialog"]');if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector('button')?.focus({preventScroll:true});
  }
  const root=document.getElementById('esteira');
  ['pause','ended'].forEach(tipo=>root.addEventListener(tipo,e=>{if(e.target.tagName==='VIDEO'&&ui.renderPendente){ui.renderPendente=false;x().render();}},true));
  root.addEventListener('input',e=>{if(e.target.id==='st-url')ui.source.url=e.target.value;if(e.target.id==='st-texto')ui.source.texto=e.target.value;if(e.target.id==='st-feedback-text')ui.detalhe=e.target.value;});
  root.addEventListener('input',e=>window.StudioVideo?.input(e.target));
  root.addEventListener('change',e=>{if(e.target.id==='st-estilo')ui.source.estilo=e.target.value;if(e.target.id==='st-objetivo')ui.source.objetivo=e.target.value;});
  root.addEventListener('scroll',e=>{const el=e.target;if(!el.dataset?.stCarousel)return;const id=el.dataset.stCarousel;const i=Math.round(el.scrollLeft/el.clientWidth);ui.slides[id]=i;const counter=root.querySelector(`[data-st-counter="${CSS.escape(id)}"]`);if(counter)counter.textContent=`${i+1}/${el.children.length}`;el.parentElement.querySelectorAll('.st-dots button').forEach((b,n)=>b.setAttribute('aria-current',String(n===i)));},true);
  root.addEventListener('keydown',e=>{const d=root.querySelector('[role="dialog"]');if(!d)return;if(e.key==='Escape'){ui.reprovar=null;x().render();}if(e.key==='Tab'){const els=[...d.querySelectorAll('button:not(:disabled),textarea')];const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  const oldApos=window.MesaEditor.aposRender;window.MesaEditor.aposRender=(root,...args)=>{oldApos(root,...args);aposRender(root);};
  window.MesaCentral={...original,render,acao,carregar:async(...args)=>{await original.carregar(...args);await atualizar({silencioso:true});},badge:()=>prontos().length+roteiros().length};
  window.StudioMobile={telaCriar,perfil,atualizar,ui,monitorar,roteiros};
  window.Mesa.state.tab='central';
  setTimeout(()=>{original.carregar(x()).catch(()=>{});atualizar({silencioso:true});x().api('/api/studio/experimentos').then(d=>{ui.experimentos=d;}).catch(()=>{});},1200);
  setTimeout(()=>monitorar(),4000);
  setInterval(()=>{if(!document.hidden&&!ui.reprovar&&!ui.ocupado){atualizar({silencioso:true});monitorar();rodarPiloto();}},10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)atualizar({silencioso:true});});
})();
