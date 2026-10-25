// The original video editor, available directly from Create on the phone.
// One click runs analysis then the existing Viral/Traditional compositor.
(function(){
  'use strict';
  const v={link:'',modelo:'viral',gancho:'',fase:'idle',erro:null,url:null,blob:null,caption:'',duracao:null,aviso:null,loaded:false};
  const ctx=()=>window.Mesa.ctx(),esc=s=>ctx().esc(s);
  const busy=()=>['analyzing','rendering','saving'].includes(v.fase);
  const redraw=()=>{if(ctx().state.tab==='mesa'&&window.StudioMobile.ui.source.formato==='video_link')ctx().render();};
  const labels={analyzing:'Lendo o vídeo e preparando o gancho',rendering:'Montando seu vídeo no modelo escolhido',saving:'Guardando o vídeo neste aparelho'};
  async function init(){
    if(v.loaded)return;v.loaded=true;
    try{const saved=await window.Store.cfgGet('video_link_ultimo');if(saved&&!v.blob&&!busy()){
      const b=await window.Store.obterBlob('video-link:ultimo');
      if(b){v.blob=b.blob||b;v.url=URL.createObjectURL(v.blob);v.caption=saved.caption||'';v.aviso=saved.aviso||null;v.link=saved.link||'';v.modelo=saved.modelo==='padrao'?'padrao':'viral';v.fase='done';redraw();}
    }}catch{/* Creation still works if reading the previous result fails. */}
  }
  function render(){
    init();
    if(busy())return `<section class="st-link-progress" role="status" aria-live="polite"><div class="st-link-film"><span class="es-spin"></span></div><span class="st-eyebrow">${v.modelo==='viral'?'MODELO VIRAL':'MODELO TRADICIONAL'}</span><h2>${labels[v.fase]}</h2><p>${v.fase==='rendering'?'O áudio original é preservado. O vídeo recebe o enquadramento e a identidade do seu perfil.':'Estou lendo o título, o áudio e o enquadramento do vídeo.'}</p><ol><li class="${v.fase!=='analyzing'?'done':'active'}">Ler o vídeo</li><li class="${v.fase==='rendering'?'active':v.fase==='saving'?'done':''}">Aplicar o modelo</li><li class="${v.fase==='saving'?'active':''}">Salvar a prévia</li></ol><small>Mantenha esta tela aberta até terminar.</small></section>`;
    const result=v.url?`<section class="st-link-result"><div class="es-between"><span class="st-eyebrow">SEU VÍDEO ESTÁ PRONTO</span><span class="st-link-model">${v.modelo==='viral'?'Viral':'Tradicional'}</span></div><video controls playsinline preload="metadata" src="${esc(v.url)}" aria-label="Vídeo no modelo ${v.modelo==='viral'?'Viral':'Tradicional'}"></video><div class="st-link-result-body"><div class="st-link-save"><button class="st-approve" data-action="st-link-share">Salvar ou compartilhar</button><a class="st-reject" href="${esc(v.url)}" download="pedro-destrava-${v.modelo}.mp4">Baixar MP4</a></div>${v.aviso?`<p class="st-create-help">${esc(v.aviso)}</p>`:''}<label for="st-link-caption">Legenda do post</label><textarea id="st-link-caption" class="es-input" rows="6">${esc(v.caption)}</textarea><button class="st-text-button" data-action="st-link-copy">Copiar legenda</button><button class="st-text-button st-link-again" data-action="st-link-new">Criar outro vídeo</button></div></section>`:'';
    return `${v.erro?`<div class="st-link-error" role="alert">${esc(v.erro)}</div>`:''}${v.fase==='done'?result:`<section class="st-create-form st-link-form"><h2>Link → vídeo pronto</h2><p class="st-link-intro">O editor que você já usava, com os dois modelos.</p><div class="st-video-models" role="group" aria-label="Modelo do vídeo">${[['viral','Viral','Foto integrada e gancho em destaque'],['padrao','Tradicional','Cabeçalho do perfil e vídeo central']].map(([id,t,d])=>`<button data-action="st-link-model" data-model="${id}" aria-pressed="${v.modelo===id}"><span class="st-model-mini ${id}" aria-hidden="true"><i></i><b></b></span><strong>${t}</strong><small>${d}</small></button>`).join('')}</div><label for="st-video-link">Cole o link do vídeo</label><input id="st-video-link" class="es-input" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" value="${esc(v.link)}"><small>Reels ou vídeo público do Instagram/Facebook, ou link direto para o arquivo.</small><details class="st-link-options"><summary>Usar meu próprio gancho</summary><label for="st-video-hook">Gancho <small>Opcional</small></label><textarea id="st-video-hook" class="es-input" rows="2" maxlength="140" placeholder="Deixe em branco para ler o título do vídeo…">${esc(v.gancho)}</textarea></details><p class="st-create-help">O editor lê o vídeo e aplica seu modelo. O áudio original é mantido. Vídeos longos usam os primeiros 45 segundos.</p><button class="st-approve" data-action="st-link-generate">Gerar vídeo ${v.modelo==='viral'?'Viral':'Tradicional'}</button></section>`}`;
  }
  async function json(url,body){
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Não consegui ler o vídeo. Tente novamente.');return d;
  }
  async function generate(){
    if(busy())return;
    let u;try{u=new URL(v.link.trim());if(!['http:','https:'].includes(u.protocol))throw new Error();}catch{v.erro='Cole um link completo que comece com https://';redraw();document.getElementById('st-video-link')?.focus();return;}
    const fonte=/(^|\.)(instagram\.com|facebook\.com|fb\.watch)$/i.test(u.hostname)?{instagramUrl:u.href}:{videoUrl:u.href};
    v.erro=null;v.fase='analyzing';redraw();
    try{
      const data=await json('/api/video-editor/analyze',{...fonte,headline:v.gancho.trim(),objetivo:window.StudioMobile.ui.source.objetivo});
      v.fase='rendering';redraw();
      const r=await fetch('/api/video-editor/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fonte,headline:v.gancho.trim()||data.headline,caption:data.caption,crop:data.crop,template:v.modelo}),signal:AbortSignal.timeout(90000)});
      if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Não consegui montar o vídeo. Tente novamente.');}
      if(!String(r.headers.get('content-type')).includes('video/'))throw new Error('O servidor não devolveu um vídeo. Tente novamente.');
      const blob=await r.blob();if(!blob.size)throw new Error('O vídeo voltou vazio. Tente novamente.');
      if(v.url)URL.revokeObjectURL(v.url);v.blob=blob;v.url=URL.createObjectURL(blob);v.caption=data.caption||'';v.aviso=data.aviso||null;v.duracao=Math.min(45,data.durationSec||45);v.fase='saving';redraw();
      try{await window.Store.salvarBlob('video-link:ultimo',blob,{nome:`pedro-destrava-${v.modelo}.mp4`});await window.Store.cfgSet('video_link_ultimo',{link:v.link,modelo:v.modelo,caption:v.caption,aviso:v.aviso,em:new Date().toISOString()});}catch{ctx().toast('Vídeo pronto. Salve o MP4 para guardá-lo no aparelho.');}
      v.fase='done';redraw();
    }catch(e){v.erro=e.name==='TimeoutError'?'A geração demorou mais que o esperado. Tente novamente com um vídeo mais curto.':e.message;v.fase='idle';redraw();}
  }
  async function action(a,el){
    if(!a.startsWith('st-link-'))return false;
    if(a==='st-link-model'){if(!busy()){v.modelo=el.dataset.model==='padrao'?'padrao':'viral';redraw();}}
    if(a==='st-link-generate')await generate();
    if(a==='st-link-new'){v.fase='idle';v.erro=null;redraw();}
    if(a==='st-link-copy'){try{await navigator.clipboard.writeText(v.caption);ctx().toast('Legenda copiada.');}catch{document.getElementById('st-link-caption')?.select();ctx().toast('Selecione e copie a legenda.');}}
    if(a==='st-link-share'&&v.blob){const file=new File([v.blob],`pedro-destrava-${v.modelo}.mp4`,{type:'video/mp4'});
      try{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'Pedro Destrava'});else document.querySelector('.st-link-save a')?.click();}catch(e){if(e.name!=='AbortError')ctx().toast('Use Baixar MP4 para salvar o vídeo.');}
    }
    return true;
  }
  function input(el){if(el.id==='st-video-link')v.link=el.value;if(el.id==='st-video-hook')v.gancho=el.value;if(el.id==='st-link-caption'){v.caption=el.value;window.Store.cfgSet('video_link_ultimo',{link:v.link,modelo:v.modelo,caption:v.caption,aviso:v.aviso,em:new Date().toISOString()}).catch(()=>{});}}
  window.StudioVideo={render,action,input,_state:v};
})();
