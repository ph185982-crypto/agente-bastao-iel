const M = require('../../static/contentModel');
const { ACCOUNT } = require('./account');
const esc = s => String(s || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const config = (sandbox = false) => ({ base:sandbox?'https://api.shotstack.io/edit/stage':'https://api.shotstack.io/edit/v1',key:sandbox?process.env.SHOTSTACK_SANDBOX_KEY:process.env.SHOTSTACK_PROD_KEY });
async function chamada(path, { sandbox=false, body, fetcher=fetch }={}) {
  const cfg=config(sandbox);
  if (!cfg.key) throw new Error('O serviço de vídeo não está configurado.');
  const r=await fetcher(`${cfg.base}${path}`,{method:body?'POST':'GET',headers:{'x-api-key':cfg.key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const d=await r.json().catch(()=>({}));
  if (!r.ok || d.success === false) throw new Error(`Serviço de vídeo: ${String(d.message || d.response?.error || r.status).slice(0,300)}`);
  return d.response || d;
}
function montarTimeline(c, { base, tokenMidia, sandbox=false }={}) {
  const v=M.versaoAtiva(c);
  const slides=v.slides.slice(0,10);
  const voz=[], textos=[], fotos=[], captions=[];
  slides.forEach((s,i)=>{
    const alias=`voz${i}`;
    const fala=[s.titulo,s.texto].filter(Boolean).join('. ').replace(/\*\*/g,'');
    voz.push({alias,asset:{type:'text-to-speech',text:fala,voice:'Camila',language:'pt-BR'},start:i===0?0:'auto',length:'auto'});
    const titulo=s.layout==='encerramento'?'SIGA PARA ENTENDER O PRÓXIMO':s.titulo || (i===0?c.titulo:'ENTENDA A ESTRATÉGIA');
    textos.push({asset:{type:'html',html:`<div class="headline">${esc(titulo)}</div>`,css:'.headline{font-family:Montserrat;font-weight:800;font-size:58px;line-height:1.12;color:#fff;text-align:left;padding:45px;background:rgba(8,21,43,.8);border-left:10px solid #80b3ff;}',width:920,height:430},start:`alias://${alias}`,length:`alias://${alias}`,position:'top',offset:{y:-.12},transition:{in:'slideRight',out:'fade'}});
    captions.push({asset:{type:'caption',src:`alias://${alias}`,font:{family:'Montserrat',size:42,color:'#ffffff',stroke:'#08152b',strokeWidth:2},background:{color:'#08152b',opacity:.85,padding:16,borderRadius:12}},start:`alias://${alias}`,length:`alias://${alias}`,position:'bottom',offset:{y:.18}});
    fotos.push({asset:{type:'image',src:`${base}/api/studio/assets/${encodeURIComponent(c.id)}/${i}.jpg?token=${tokenMidia}`},start:`alias://${alias}`,length:`alias://${alias}`,fit:'cover',effect:i%2?'zoomOutSlow':'zoomInSlow',transition:{in:'fade',out:'fade'}});
  });
  return {timeline:{background:'#08152b',tracks:[{clips:captions},{clips:textos},{clips:[{asset:{type:'html',html:`<div>${ACCOUNT.handle}</div>`,css:'div{font-family:Montserrat;font-size:34px;font-weight:700;color:#fff;}',width:800,height:70},start:0,length:'end',position:'top',offset:{y:-.035}}]},{clips:fotos},{clips:voz}]},output:{format:'mp4',size:{width:1080,height:1920},fps:30,poster:{capture:1},thumbnail:{capture:1,scale:.3}}, ...(sandbox?{}:{})};
}
async function iniciar(c,opts) {
  const timeline=montarTimeline(c,opts);
  const r=await chamada('/render',{sandbox:opts.sandbox,body:timeline});
  if (!r.id) throw new Error('O serviço de vídeo não devolveu um identificador.');
  return {id:r.id,estado:'renderizando',sandbox:!!opts.sandbox,hash:M.versaoAtiva(c).hash,iniciado_em:new Date().toISOString(),url:null,formato:'1080x1920',voz:'Camila · português brasileiro'};
}
async function consultar(motion) {
  const r=await chamada(`/render/${encodeURIComponent(motion.id)}`,{sandbox:motion.sandbox});
  if (r.status === 'failed') throw new Error(String(r.error || 'O vídeo não pôde ser renderizado.').slice(0,300));
  if (r.status !== 'done') return {...motion,estado:'renderizando',etapa:r.status};
  if (!/^https:\/\//.test(r.url || '')) throw new Error('O serviço de vídeo não devolveu o arquivo.');
  return {...motion,estado:'pronto',url:r.url,poster:r.poster || r.thumbnail || null,duracao:r.duration || null,concluido_em:new Date().toISOString()};
}
module.exports={montarTimeline,iniciar,consultar,chamada};
