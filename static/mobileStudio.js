(function(){
  'use strict';
  const original=window.MesaCentral;
  const M=window.ContentModel;
  const x=()=>window.Mesa.ctx();
  const esc=s=>x().esc(s);
  const ui={aba:'prontos',selecionado:null,slides:{},ocupado:null,reprovar:null,motivos:[],detalhe:'',estado:null,experimentos:null,carregando:false,erro:null,source:{modo:'link',url:'',texto:'',formato:'carrossel',estilo:'auto'}};
  const ETAPAS={leitura:'Lendo a matéria',afirmacoes:'Organizando as informações',pesquisa:'Conferindo as fontes',briefing:'Preparando a abordagem',copy:'Escrevendo com a sua voz',auditoria:'Conferindo o conteúdo',foto:'Selecionando as fotos',arte:'Desenhando os slides',motion:'Renderizando o Reel',finalizar:'Finalizando a prévia',publicacao:'Publicando no Instagram'};
  const motivos={texto_longo:'Texto demais',sem_foto:'Quero mais fotos',capa_fraca:'Capa sem impacto',visual:'Mudar o visual',voz:'Não parece comigo',cta:'CTA fraco',tema:'Não gostei do tema',fatos:'Corrigir informação'};
  const estilos={foto_editorial:'Foto editorial',impacto:'Impacto',revista:'Revista'};
  const versao=c=>M.versaoAtiva(c);
  const emProducao=c=>['gerando','publicando'].includes(c.studio?.estado);
  function prontos(){return x().state.contents.filter(c=>!c.legado&&!['publicado','arquivado'].includes(c.status)&&!emProducao(c)&&versao(c));}
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
    return `<div class="st-carousel-wrap"><div class="st-carousel" data-st-carousel="${esc(c.id)}" role="group" aria-label="Carrossel de ${v.slides.length} slides">${renders.map((r,i)=>`<img src="/api/sync/arquivos/${encodeURIComponent(r.blob_key)}" alt="Slide ${i+1}: ${esc(v.slides[i].texto.replace(/\*\*/g,''))}" loading="${i?'lazy':'eager'}" width="1080" height="1350">`).join('')}</div><span class="st-slide-counter" data-st-counter="${esc(c.id)}">${n+1}/${renders.length}</span><div class="st-dots" aria-label="Selecionar slide">${renders.map((_,i)=>`<button data-action="st-slide" data-id="${esc(c.id)}" data-i="${i}" aria-label="Ver slide ${i+1}" aria-current="${n===i?'true':'false'}"><i></i></button>`).join('')}</div></div>`;
  }
  function cartao(c){
    const v=versao(c);const g=revisar(c);const pronto=!g.bloqueios.length && (c.formato!=='reels'||(c.motion?.estado==='pronto'&&c.motion.hash===v.hash));
    const pausado=original._st.config?.publish_paused;
    return `<article class="st-review-card" data-st-card="${esc(c.id)}"><div class="st-card-heading"><span class="st-format">${c.formato==='reels'?'Reel motion':'Carrossel'} ${c.experimento?.estilo?`<i>· ${esc(estilos[c.experimento.estilo])}</i>`:''}</span><h2>${esc(c.titulo)}</h2></div>
      ${preview(c)}
      <div class="st-review-body">${c.studio?.erro?`<p class="st-inline-error" role="status">${esc(c.studio.erro)}</p>`:''}
      ${!pronto?'<p class="st-preparing-note">Vou resolver as pendências e montar uma prévia completa. Você aprova uma única vez, no final.</p>':''}
      <div class="st-decisionbar"><button class="st-reject" data-action="st-rejeitar" data-id="${esc(c.id)}" ${ui.ocupado?'disabled':''}>↻ Refazer</button><button class="st-approve" data-action="${pronto?'st-aprovar':'st-preparar'}" data-id="${esc(c.id)}" ${ui.ocupado||pausado?'disabled':''}>${ui.ocupado===c.id?'<span class="es-spin"></span> Enviando…':pausado?'Publicações pausadas':pronto?'✓ Aprovar e publicar':'Preparar automaticamente'}</button></div>
      <details class="st-caption"><summary>Ver legenda e detalhes</summary><p>${esc([v.legenda,v.cta,(v.hashtags||[]).join(' ')].filter(Boolean).join('\n\n'))}</p><button class="st-text-button" data-action="cn-revisar" data-id="${esc(c.id)}">Ajustar manualmente</button></details></div></article>`;
  }
  function filaProduzindo(){
    const lista=x().state.contents.filter(c=>emProducao(c)||(!c.legado&&!versao(c)&&!['publicado','arquivado'].includes(c.status)));
    if(!lista.length)return '';
    return `<section class="st-production"><h2>Em preparação <span>${lista.length}</span></h2>${lista.map(c=>{const st=c.studio||{},ativo=emProducao(c);return `<div class="st-job">${ativo?'<span class="es-spin"></span>':'<span>↻</span>'}<div><b>${esc(c.titulo)}</b><small>${esc(st.estado==='erro'?st.erro:ativo?st.aviso||ETAPAS[st.etapa]||'Preparando':'Rascunho da sua biblioteca')} ${st.etapa==='arte'?`· slide ${(st.indice||0)+1}`:''}</small>${!ativo?`<button class="st-text-button" data-action="st-preparar" data-id="${esc(c.id)}">${st.estado==='erro'?'Tentar novamente':'Preparar automaticamente'}</button>`:''}</div></div>`;}).join('')}<p>Pode fechar o app. A preparação continua e, com notificações ativas, você recebe o aviso.</p></section>`;
  }
  function modal(){
    if(!ui.reprovar)return '';
    return `<div class="st-modal-backdrop"><section class="st-feedback-sheet" role="dialog" aria-modal="true" aria-labelledby="st-feedback-title"><div class="st-sheet-handle"></div><button class="st-modal-close" data-action="st-fechar" aria-label="Fechar motivos de ajuste">×</button><span class="st-eyebrow">DO SEU JEITO</span><h2 id="st-feedback-title">O que vamos melhorar?</h2><p>Seu retorno orienta esta versão e as próximas criações.</p><div class="st-reasons">${Object.entries(motivos).map(([k,v])=>`<button data-action="st-motivo" data-m="${k}" aria-pressed="${ui.motivos.includes(k)}">${esc(v)}</button>`).join('')}</div><label for="st-feedback-text">Quer explicar melhor? <small>Opcional</small></label><textarea id="st-feedback-text" rows="3" maxlength="500" placeholder="Ex.: menos texto, foto na capa e um CTA mais direto…">${esc(ui.detalhe)}</textarea><p class="st-feedback-error" role="status">${esc(ui.erroFeedback||'')}</p><button class="st-approve" data-action="st-confirmar-refazer" ${ui.ocupado?'disabled':''}>${ui.ocupado?'Salvando seu ajuste…':'Refazer com esse ajuste'}</button><button class="st-text-button" data-action="st-descartar">Só descartar este conteúdo</button></section></div>`;
  }
  function render(){
    const lista=prontos();if(!lista.some(c=>c.id===ui.selecionado))ui.selecionado=lista[0]?.id||null;
    const c=lista.find(c=>c.id===ui.selecionado);const i=lista.findIndex(c=>c.id===ui.selecionado);
    const publicados=x().state.contents.filter(c=>c.status==='publicado'&&!c.legado);
    const pushAtivo=original._st.push?.ativo;
    return `<div class="st-app"><div class="st-page-heading"><div><span class="st-eyebrow">SEU CONTEÚDO, SUA VOZ</span><h1>Pronto para ir ao ar?</h1><p>Deslize. Confira. Aprove ou peça um ajuste.</p></div><button class="st-new" data-action="st-criar">+ Criar</button></div>
      ${!pushAtivo?`<button class="st-push-banner" data-action="${original._st.push?.permissao==='denied'?'st-perfil':'st-notificacoes'}"><span>♧</span><span><b>Receba um aviso no iPhone</b><small>${original._st.push?.permissao==='denied'?'Veja como liberar as notificações.':'Ative para saber quando o conteúdo ficar pronto.'}</small></span><i>›</i></button>`:''}
      ${ui.erro?`<div class="es-warn" role="status">${esc(ui.erro)}</div>`:''}
      <div class="st-feed-tabs" role="group" aria-label="Conteúdos"><button data-action="st-aba" data-aba="prontos" aria-pressed="${ui.aba==='prontos'}">Para aprovar <span>${lista.length}</span></button><button data-action="st-aba" data-aba="publicados" aria-pressed="${ui.aba==='publicados'}">Publicados <span>${publicados.length}</span></button></div>
      ${ui.aba==='prontos'?`${lista.length>1?`<div class="st-card-pagination"><span>Conteúdo ${i+1} de ${lista.length}</span><div><button data-action="st-anterior" aria-label="Conteúdo anterior" ${i<=0?'disabled':''}>‹</button><button data-action="st-proximo" aria-label="Próximo conteúdo" ${i>=lista.length-1?'disabled':''}>›</button></div></div>`:''}${c?cartao(c):`<div class="st-empty-feed"><img src="/logo-app.svg" alt="Pedro Destrava" width="58" height="58"><h2>${x().state.contents.some(emProducao)?'Seu próximo conteúdo está a caminho':'Vamos preparar seu próximo post?'}</h2><p>${x().state.contents.some(emProducao)?'Você verá a prévia completa aqui assim que estiver pronta.':'Comece com uma matéria ou texto. Eu cuido do formato, da capa e da preparação.'}</p><button class="st-approve" data-action="st-criar">Criar conteúdo</button></div>`}${filaProduzindo()}`:`<div class="st-published">${publicados.map(c=>`<article><span>✓ Publicado · ${esc(c.formato==='reels'?'Reel':'Carrossel')}</span><h2>${esc(c.titulo)}</h2>${c.publicacao?.url?`<a href="${esc(c.publicacao.url)}" target="_blank" rel="noopener noreferrer">Ver no Instagram ↗</a>`:'<p>O link ainda não está disponível.</p>'}</article>`).join('')||'<div class="st-empty-feed"><h2>Os próximos resultados começam aqui</h2><p>Quando você aprovar e o Instagram confirmar, o post aparece nesta lista.</p></div>'}</div>`}
      </div>${modal()}`;
  }
  function telaCriar(){
    const s=ui.source;
    return `<div class="st-create"><span class="st-eyebrow">COMECE COM UMA BOA IDEIA</span><h1>O que vamos publicar?</h1><p class="es-sub">Cole uma matéria ou um texto. Receba o conteúdo pronto para conferir.</p><div class="st-format-picker" role="group" aria-label="Formato do conteúdo">${[['carrossel','▧','Carrossel','Fotos, informação e CTA'],['reels','▷','Reel motion','Narração, movimento e legenda']].map(([id,icon,t,d])=>`<button data-action="st-formato" data-f="${id}" aria-pressed="${s.formato===id}"><i>${icon}</i><b>${t}</b><small>${d}</small></button>`).join('')}</div><section class="st-create-form"><div class="st-source-tabs" role="group" aria-label="Tipo de fonte"><button data-action="st-source" data-m="link" aria-pressed="${s.modo==='link'}">Link de matéria</button><button data-action="st-source" data-m="texto" aria-pressed="${s.modo==='texto'}">Colar texto</button></div>${s.modo==='link'?`<label for="st-url">Link da matéria</label><input id="st-url" type="url" inputmode="url" class="es-input" placeholder="https://site.com/materia" value="${esc(s.url)}"><small>Para posts de redes sociais, copie o texto e use “Colar texto”.</small>`:`<label for="st-texto">Texto para desenvolver</label><textarea id="st-texto" rows="7" class="es-input" placeholder="Cole o texto da matéria ou do post…">${esc(s.texto)}</textarea><small>Pelo menos 200 caracteres para preparar o conteúdo.</small>`}<label for="st-estilo">Estilo visual</label><select id="st-estilo" class="es-input"><option value="auto" ${s.estilo==='auto'?'selected':''}>Variar e aprender com meus retornos</option>${Object.entries(estilos).map(([k,l])=>`<option value="${k}" ${s.estilo===k?'selected':''}>${l}</option>`).join('')}</select><p class="st-create-help">${s.formato==='reels'?'Reel vertical com narração em português, legendas e imagens em movimento. Duração próxima de 1 minuto, conforme o texto.':'O sistema escolhe a capa, confere as informações e prepara os slides. Sua aprovação será apenas no resultado final.'}</p><button class="st-approve" data-action="st-gerar" ${ui.ocupado?'disabled':''}>${ui.ocupado==='novo'?'Iniciando a preparação…':s.formato==='reels'?'Preparar meu Reel':'Preparar meu carrossel'}</button></section><details class="st-library"><summary>Minha biblioteca <span>${x().state.contents.length}</span></summary><div class="studio-library-tools"><label class="studio-search"><input id="library-search" type="search" value="${esc(x().state.busca)}" placeholder="Buscar conteúdo" aria-label="Buscar na biblioteca"></label></div><div id="library-results" class="es-stack">${x().state.contents.filter(c=>!c.legado&&c.status!=='arquivado').map(c=>`<button class="es-card mz-item" data-action="st-ver" data-id="${esc(c.id)}"><span class="st-format">${esc(c.status==='publicado'?'Publicado':emProducao(c)?'Em preparação':'Para conferir')}</span><div class="es-title">${esc(c.titulo)}</div></button>`).join('')}</div></details></div>`;
  }
  function perfil(){
    const p=original._st.push||{};const dados=ui.experimentos;
    return `<section class="st-profile-card"><img src="/logo-app.svg" width="54" height="54" alt="Logo do app"><div><b>Pedro Destrava</b><span>@pedro_destrava</span></div><span class="st-account-tag">Seu estúdio</span></section><section class="st-settings-card"><h2>Notificações no iPhone</h2><p>${p.ativo?'Ativas neste aparelho. Você será avisado quando o conteúdo estiver pronto e quando for publicado.':p.permissao==='denied'?'O aparelho bloqueou a permissão. Libere as notificações deste app nos Ajustes do iPhone e volte aqui.':'Abra pelo ícone na Tela de Início, toque em ativar e permita o recebimento.'}</p><button class="st-approve" data-action="st-notificacoes">${p.ativo?'Verificar ativação':'Ativar notificações'}</button>${p.ativo?'<button class="es-btn ghost sm" data-action="st-push-teste">Enviar notificação de teste</button>':''}</section><section class="st-settings-card"><div class="es-between"><h2>Formatos em teste</h2><button class="st-text-button" data-action="st-metricas" ${ui.ocupado==='metricas'?'disabled':''}>${ui.ocupado==='metricas'?'Atualizando…':'Atualizar dados'}</button></div><p>Seu retorno ajusta a criação. As métricas do Instagram ajudam a comparar os formatos publicados.</p><div class="st-experiment-grid">${(dados?.estilos||Object.entries(estilos).map(([id,nome])=>({id,nome}))).map(e=>`<article><b>${esc(e.nome)}</b><span>${e.publicados||0} publicados · ${e.medidos||0} medidos</span><strong>${e.medidos?Number(e.alcance||0).toLocaleString('pt-BR'):'—'}</strong><small>${e.medidos?'contas alcançadas':'Aguardando dados reais'}</small>${e.medidos&&e.alcance?`<small>${((e.interacoes||0)/e.alcance*100).toFixed(1)}% de interações por alcance</small>`:''}<span>${e.aprovacoes||0} aprovações · ${e.ajustes||0} pedidos de ajuste</span></article>`).join('')}</div><small>O Instagram pode não informar seguidores ganhos por post. Não há vencedor definido enquanto faltarem dados comparáveis.</small></section>`;
  }
  async function acao(a,el,ctx){
    if(!a.startsWith('st-'))return original.acao(a,el,ctx);
    const id=el.dataset.id;const c=id?ctx.state.contents.find(c=>c.id===id):null;
    try{
      switch(a){
        case 'st-criar':ctx.state.tab='mesa';ctx.state.sub=null;ctx.render();return true;
        case 'st-perfil':ctx.state.tab='ajustes';ctx.render();return true;
        case 'st-ver':ui.selecionado=id;ui.aba=c.status==='publicado'?'publicados':'prontos';ctx.state.tab='central';ctx.render();return true;
        case 'st-aba':ui.aba=el.dataset.aba;ctx.render();return true;
        case 'st-anterior':case 'st-proximo':{const l=prontos(),i=l.findIndex(c=>c.id===ui.selecionado);ui.selecionado=l[i+(a==='st-proximo'?1:-1)]?.id||ui.selecionado;ctx.render();return true;}
        case 'st-slide':ui.slides[id]=Number(el.dataset.i);aposRender(document.getElementById('esteira'));return true;
        case 'st-source':ui.source.modo=el.dataset.m;ctx.render();return true;
        case 'st-formato':ui.source.formato=el.dataset.f;ctx.render();return true;
        case 'st-gerar':{
          const s=ui.source;if(s.modo==='link'&&!/^https?:\/\/\S+$/.test(s.url.trim())){ctx.toast('Cole um link de matéria que comece com https://');document.getElementById('st-url')?.focus();return true;}
          if(s.modo==='texto'&&s.texto.trim().length<200){ctx.toast('Cole um texto com pelo menos 200 caracteres.');document.getElementById('st-texto')?.focus();return true;}
          if(ui.ocupado)return true;ui.ocupado='novo';ctx.render();
          const reg=await ctx.api('/api/studio/criar',{method:'POST',body:{...(s.modo==='link'?{url:s.url.trim()}:{texto:s.texto.trim()}),formato:s.formato,estilo:s.estilo,voz:ctx.state.config.voice_profile,request_id:crypto.randomUUID()}});await adotar(reg);ui.source.url='';ui.source.texto='';ctx.state.tab='central';ui.aba='prontos';ctx.toast('Preparação iniciada. Pode acompanhar por aqui.');break;
        }
        case 'st-aprovar':case 'st-preparar':{
          if(ui.ocupado)return true;ui.ocupado=id;ctx.render();
          const r=await window.Sync.enviar(c);if(!['igual','enviado'].includes(r.estado))throw new Error('Este conteúdo mudou em outro aparelho. Atualize a lista antes de continuar.');
          const reg=await ctx.api(`/api/studio/${encodeURIComponent(id)}/${a==='st-aprovar'?'decidir':'retomar'}`,{method:'POST',body:{acao:'aprovar',hash:versao(c)?.hash}});await adotar(reg);ui.selecionado=null;ctx.toast(a==='st-aprovar'?'Aprovado! Enviando ao Instagram.':'Vou preparar a versão completa para você conferir.');break;
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
  root.addEventListener('change',e=>{if(e.target.id==='st-estilo')ui.source.estilo=e.target.value;});
  root.addEventListener('scroll',e=>{const el=e.target;if(!el.dataset?.stCarousel)return;const id=el.dataset.stCarousel;const i=Math.round(el.scrollLeft/el.clientWidth);ui.slides[id]=i;const counter=root.querySelector(`[data-st-counter="${CSS.escape(id)}"]`);if(counter)counter.textContent=`${i+1}/${el.children.length}`;el.parentElement.querySelectorAll('.st-dots button').forEach((b,n)=>b.setAttribute('aria-current',String(n===i)));},true);
  root.addEventListener('keydown',e=>{const d=root.querySelector('[role="dialog"]');if(!d)return;if(e.key==='Escape'){ui.reprovar=null;x().render();}if(e.key==='Tab'){const els=[...d.querySelectorAll('button:not(:disabled),textarea')];const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  const oldApos=window.MesaEditor.aposRender;window.MesaEditor.aposRender=(root,...args)=>{oldApos(root,...args);aposRender(root);};
  window.MesaCentral={...original,render,acao,carregar:async(...args)=>{await original.carregar(...args);await atualizar({silencioso:true});},badge:()=>prontos().length};
  window.StudioMobile={telaCriar,perfil,atualizar,ui};
  window.Mesa.state.tab='central';
  setTimeout(()=>{original.carregar(x()).catch(()=>{});atualizar({silencioso:true});x().api('/api/studio/experimentos').then(d=>{ui.experimentos=d;}).catch(()=>{});},1200);
  setInterval(()=>{if(!document.hidden&&!ui.reprovar&&!ui.ocupado)atualizar({silencioso:true});},10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)atualizar({silencioso:true});});
})();
