const express=require('express');
const {waitUntil}=require('@vercel/functions');
const studio=require('../lib/studio');
const {armazem}=require('../lib/armazem');
const {ACCOUNT}=require('../lib/account');
const {limita}=require('../lib/access');
const M=require('../../static/contentModel');
const router=express.Router();
const erro=(res,e)=>res.status(e.status || (e.code==='CONFLITO'?409:500)).json({error:e.message,code:e.code||'STUDIO'});
function segundoPlano(p){if(process.env.VERCEL)waitUntil(p);else p.catch(e=>console.error('[studio]',e.message));}
async function kick(c){
  if(!['gerando','publicando'].includes(c.studio?.estado))return;
  if(!process.env.VERCEL){setTimeout(()=>executar(c.id,c.studio.job),c.studio.etapa==='motion'?4000:100);return;}
  await require('../lib/studioFila').enfileirar(c);
}
async function executar(id,job){
  const c=(await studio.ler(id)).doc;
  if(c.studio?.job!==job)return;
  if(c.studio.etapa==='motion'&&c.motion?.engine!=='local'&&c.motion)await new Promise(r=>setTimeout(r,4500));
  if(c.studio.estado==='publicando'){
    try{return await publicarEmSegundoPlano(c);}catch(e){
      if(e.code==='CONFLITO')return;
      const reg=await studio.ler(id);if(reg.doc.studio?.job!==job)return;
      reg.doc.studio.estado='erro';reg.doc.studio.erro=e.message;
      await armazem().conteudos.salvar(ACCOUNT.ig_id,id,reg.doc,reg.rev);
      // Falha antes de chegar ao Instagram (ex.: trava de publicação): avisa o Pedro em vez de falhar em silêncio.
      await require('../lib/push').notificar({corpo:`A publicação não saiu: ${String(e.message).slice(0,140)}`,tag:`publicacao-${id}`}).catch(()=>{});
      return;
    }
  }
  const atual=await studio.processar(id,job);
  if(atual.studio?.estado==='gerando' && !atual.studio.lease)await kick(atual);
}
async function publicarEmSegundoPlano(c){
  const P=require('../lib/publicador');const st=c.studio;
  const atual=await armazem().publicacoes.obter(ACCOUNT.ig_id,c.id,'instagram');
  let p=atual?await P.avancar(c.id):await P.iniciar(c.id,{hash:c.revisao.hash_aprovado,base:studio.base()});
  if(['iniciada','aguardando_processamento','publicando_final'].includes(p.estado)){
    st.polls=(st.polls||0)+1;
    if(st.polls>50)return;
    const reg=await studio.ler(c.id);if(reg.doc.studio?.job!==st.job)return;
    reg.doc.studio.polls=st.polls;await armazem().conteudos.salvar(ACCOUNT.ig_id,c.id,reg.doc,reg.rev);
    await new Promise(r=>setTimeout(r,3500));await kick(reg.doc);return;
  }
  const reg=await studio.ler(c.id);if(reg.doc.studio?.job!==st.job)return;
  const doc=reg.doc;doc.studio.estado=p.estado==='publicada'?'publicado':'erro';doc.studio.erro=p.erro?.amigavel||null;
  doc.publicacoes=[{network:'instagram',status:p.estado,post_id:p.ig_media_id,permalink:p.permalink,published_at:p.publicada_em,hash_versao:p.hash_versao,versao:p.versao}];
  if(p.estado==='publicada'){doc.status='publicado';doc.publicacao={url:p.permalink,ig_post_id:p.ig_media_id,publicado_em:p.publicada_em,versao_publicada:p.versao};}
  M.registrar(doc,'sistema','publicacao',p.estado==='publicada'?'Publicado no Instagram':doc.studio.erro||'A publicação não terminou.');
  await armazem().conteudos.salvar(ACCOUNT.ig_id,c.id,doc,reg.rev);
  await require('../lib/push').notificar({corpo:p.estado==='publicada'?'Publicado! Seu conteúdo já está no Instagram.':`A publicação precisa de atenção: ${doc.studio.erro||'tente novamente no app'}`,tag:`publicacao-${c.id}`}).catch(()=>{});
}
router.post('/worker/:id',async(req,res)=>{
  try{const {job}=req.body||{};if(!job||!studio.confere(req.params.id,job,req.get('x-studio-token')))return res.status(403).json({error:'Chamada de produção inválida.'});
    const c=(await studio.ler(req.params.id)).doc;if(c.studio?.job!==job)return res.json({encerrado:true});
    res.status(202).json({aceito:true});segundoPlano(executar(c.id,job).catch(e=>console.error('[studio worker]',e.message)));
  }catch(e){if(!res.headersSent)erro(res,e);}
});
router.post('/criar',limita({max:8,janelaMs:60000,nome:'studio-criar'}),async(req,res)=>{
  try{const c=await studio.criar(req.body||{});await kick(c);const reg=await studio.ler(c.id);res.status(202).json(reg);}catch(e){erro(res,e);}
});
router.post('/:id/retomar',limita({max:8,janelaMs:60000,nome:'studio-retomar'}),async(req,res)=>{
  try{let c=(await studio.ler(req.params.id)).doc;
    // Carrossel do piloto ("top") não passa pela preparação antiga: ela troca as afirmações e quebra a ligação número → fonte.
    if(c.top)return res.status(409).json({error:'Este carrossel é do piloto automático e já vem pronto. Use "Refazer" para descartar e o piloto faz outro.',code:'TOP'});
    if(!['gerando','publicando'].includes(c.studio?.estado))c=await studio.reagendar(c.id,{acao:'retomar'});await kick(c);res.status(202).json(await studio.ler(c.id));}catch(e){erro(res,e);}
});
// Aprovação do ROTEIRO (fluxo do monitor de notícias): aprovar libera a geração do carrossel; refazer escreve outro roteiro;
// descartar arquiva. Nada aqui publica: publicar continua exigindo "Aprovar e publicar" no carrossel pronto.
router.post('/:id/roteiro',limita({max:12,janelaMs:60000,nome:'studio-roteiro'}),async(req,res)=>{
  try{
    const {acao,hash,motivos,detalhe}=req.body||{};
    if(acao==='aprovar'){const c=await studio.aprovarRoteiro(req.params.id,{hash});await kick(c);return res.status(202).json(await studio.ler(c.id));}
    if(acao==='refazer'){const c=await studio.reagendar(req.params.id,{acao:'refazer',motivos:Array.isArray(motivos)?motivos:[],detalhe:String(detalhe||'').slice(0,500),hash});await kick(c);return res.status(202).json(await studio.ler(c.id));}
    if(acao==='descartar'){const c=await studio.descartarRoteiro(req.params.id,{hash});return res.json(await studio.ler(c.id));}
    return res.status(400).json({error:'Ação inválida para o roteiro.',code:'ENTRADA'});
  }catch(e){erro(res,e);}
});
router.post('/:id/decidir',limita({max:12,janelaMs:60000,nome:'studio-decidir'}),async(req,res)=>{
  try{
    if(req.body?.acao==='aprovar')try{await require('../lib/publicador').exigirAcessoProtegido();}catch(e){return res.status(e.status||403).json({error:e.message,code:e.code||'ACESSO_ABERTO'});}
    if(req.body?.acao==='aprovar' && (await require('../lib/publicador').config()).publish_paused) return res.status(409).json({error:'As publicações estão pausadas. Libere em Perfil para publicar.',code:'PAUSADO'});
    if(req.body?.acao==='refazer'){const a=(await studio.ler(req.params.id)).doc;if(a.top){
      // "Refazer" no carrossel do piloto = descartar este e liberar a vaga: o piloto produz outro na próxima rodada.
      const reg=await armazem().conteudos.obter(ACCOUNT.ig_id,a.id);const d=reg.doc;d.status='arquivado';d.studio={...(d.studio||{}),estado:'descartado',job:null};delete d.studio.erro;
      M.registrar(d,'pedro','descartado','Pediu outro carrossel no lugar deste.');await armazem().conteudos.salvar(ACCOUNT.ig_id,d.id,d,reg.rev);
      await require('../lib/top/piloto').registrarDecisao(d.id,'descartado').catch(()=>{});return res.json(await studio.ler(d.id));}}
    const c=await studio.decidir(req.params.id,req.body||{});
    // Carrossel "top" (piloto): aprovar AGENDA no próximo horário da grade; "agora:true" publica na hora como antes.
    if(c.top&&['aprovar','descartar'].includes(req.body.acao))await require('../lib/top/piloto').registrarDecisao(c.id,req.body.acao==='aprovar'?'aprovado':'descartado').catch(()=>{});
    if(req.body.acao==='aprovar'&&c.top&&!req.body.agora){await require('../lib/top/piloto').agendar(c.id);return res.status(202).json(await studio.ler(c.id));}
    if(req.body.acao==='aprovar'){
      const P=require('../lib/publicador');const cfg=await P.config();if(cfg.publish_paused)return res.status(409).json({error:'As publicações estão pausadas. Libere em Perfil para publicar.',code:'PAUSADO'});
      const reg=await studio.ler(c.id);reg.doc.studio={...(reg.doc.studio||{}),job:require('crypto').randomUUID(),estado:'publicando',etapa:'publicacao',polls:0};
      await armazem().conteudos.salvar(ACCOUNT.ig_id,c.id,reg.doc,reg.rev);await kick(reg.doc);res.status(202).json(await studio.ler(c.id));
    }else{if(c.studio?.estado==='gerando')await kick(c);res.json(await studio.ler(c.id));}
  }catch(e){erro(res,e);}
});
router.get('/estado',async(req,res)=>{
  try{
    const a=armazem();if(!a?.duravel)return res.status(503).json({error:'O armazenamento não está disponível.'});
    const lista=await a.conteudos.listar(ACCOUNT.ig_id);const produzindo=lista.filter(r=>r.resumo.status==='produzindo'||r.resumo.status==='aprovado').slice(0,8);
    const ativos=await Promise.all(produzindo.map(r=>studio.ler(r.id)));
    const retomar=ativos.map(r=>r.doc).filter(c=>['gerando','publicando'].includes(c.studio?.estado)&&(!c.studio.lease||Date.now()-Date.parse(c.studio.lease)>90000));
    const chave=require('../lib/push');res.json({configurado:true,push:{configurado:chave.configurado(),chave_publica:chave.chavePublica()},ativos:ativos.map(r=>({id:r.doc.id,titulo:r.doc.titulo,studio:r.doc.studio})),estilos:require('../lib/preferencias').ESTILOS,motivos:require('../lib/preferencias').MOTIVOS});
    if(retomar.length)segundoPlano(Promise.all(retomar.map(kick)));
  }catch(e){erro(res,e);}
});
router.get('/experimentos',async(req,res)=>{try{res.json(await studio.panorama());}catch(e){erro(res,e);}});
router.get('/assets/:id/:indice.jpg',async(req,res)=>{
  try{const {doc:c}=await studio.ler(req.params.id);if(!c.studio||!studio.confere(c.id,c.studio.job,req.query.token))return res.status(403).end();const v=M.versaoAtiva(c);const s=v.slides[Number(req.params.indice)];if(!s)return res.status(404).end();
    const r=c.arte.renders.find(r=>r.versao===v.id && r.slide_id===s.id);const arq=r&&await armazem().arquivos.obter(ACCOUNT.ig_id,r.blob_key);if(!arq)return res.status(404).end();
    const jpg=await require('sharp')(Buffer.from(arq.dados)).jpeg({quality:92}).toBuffer();res.set({'Content-Type':'image/jpeg','Cache-Control':'private,no-store'}).end(jpg);
  }catch(e){erro(res,e);}
});
router.post('/metricas',limita({max:2,janelaMs:60000,nome:'studio-metricas'}),async(req,res)=>{
  try{const a=armazem();const pubs=(await require('../lib/publicador').listarPublicacoes()).filter(p=>p.estado==='publicada'&&p.ig_media_id).slice(0,12);let atualizados=0;const indisponiveis=[];
    for(const p of pubs){const reg=await studio.ler(p.content_id);let dados;
      try{dados=await require('../lib/meta').graph('GET',`${p.ig_media_id}/insights`,{metric:'reach,saved,shares,total_interactions'});}catch(e){indisponiveis.push(p.content_id);continue;}
      const m=Object.fromEntries((dados.data||[]).map(d=>[d.name,d.values?.[0]?.value ?? d.total_value?.value ?? null]));
      reg.doc.desempenho={alcance:m.reach ?? null,interacoes:m.total_interactions ?? null,salvos:m.saved ?? null,compartilhamentos:m.shares ?? null,seguidores:null,consultado_em:new Date().toISOString()};
      await a.conteudos.salvar(ACCOUNT.ig_id,p.content_id,reg.doc,reg.rev);atualizados++;
    }res.json({atualizados,indisponiveis,...await studio.panorama()});
  }catch(e){erro(res,e);}
});
module.exports=router;
module.exports._internos={executar,kick};
