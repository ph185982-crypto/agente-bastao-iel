// Render small segments, checkpoint each one, then concatenate. No render credits.
const fs=require('fs/promises');
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');
const sharp=require('sharp');
const M=require('../../static/contentModel');
const {armazem}=require('./armazem');
const {ACCOUNT}=require('./account');
const arte=require('./arte');
const ASSETS=path.join(__dirname,'..','assets');
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fala=s=>[s.titulo,s.texto].filter(Boolean).join('. ').replace(/\*\*/g,'');
const palavras=s=>String(s||'').split(/\s+/).filter(Boolean);
const conta=ACCOUNT.ig_id;
function wav(pcm,rate=24000){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
async function gerarVoz(texto){
  const key=process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;if(!key)throw new Error('A narração não está disponível nesta configuração.');
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:`Leia apenas o texto a seguir, em português brasileiro, com ritmo natural e direto, como uma conversa. Não acrescente nada.\n\n${texto}`}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Charon'}}}}}),signal:AbortSignal.timeout(40000)});
  const d=await r.json().catch(()=>({}));const a=d.candidates?.[0]?.content?.parts?.find(p=>p.inlineData)?.inlineData;
  if(!r.ok || !a)throw new Error(r.status===429?'A narração está sem cota disponível.':'O serviço de narração não conseguiu gerar a voz.');
  const dados=Buffer.from(a.data,'base64');
  if(String(a.mimeType).includes('wav'))return{dados,duracao:(dados.length-44)/48000};
  return{dados:wav(dados),duracao:dados.length/48000};
}
function ass(texto,duracao){
  const ws=palavras(texto);const grupos=[];for(let i=0;i<ws.length;i+=5)grupos.push(ws.slice(i,i+5).join(' ').replace(/[{}\\]/g,''));
  const time=t=>{const cs=Math.round(t*100);return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;};
  const eventos=grupos.map((t,i)=>`Dialogue: 0,${time(i*duracao/grupos.length)},${time((i+1)*duracao/grupos.length)},Default,,0,0,0,,{\\fad(90,80)}${t}`).join('\n');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Poppins,64,&H00FFFFFF,&H0080B3FF,&H002B1508,&H902B1508,-1,0,0,0,100,100,0,0,3,16,0,2,80,80,310,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${eventos}\n`;
}
async function quadro(slide,imagem,indice,total){
  const bg=imagem?await sharp(imagem).resize(1080,1920,{fit:'cover'}).png().toBuffer():await sharp({create:{width:1080,height:1920,channels:3,background:indice%2?'#1747d1':'#14243e'}}).png().toBuffer();
  const ws=palavras(slide.texto.replace(/\*\*/g,''));let curto=ws.slice(0,9);while(curto.length>1&&/^(de|do|da|dos|das|e|para|pra|em|com|a|o|uma?|que)$/i.test(curto.at(-1)))curto.pop();
  const titulo=slide.titulo || curto.join(' ')+(ws.length>curto.length?'…':'');
  const q=arte.quebrar(titulo,'display',82,870);const linhas=q.linhas.slice(0,6).map((l,i)=>`<text x="92" y="${470+i*100}" font-family="Poppins ExtraBold, Poppins" font-size="82" font-weight="800" fill="white">${esc(l.map(w=>w.t).join(' '))}</text>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="d" x2="0" y2="1"><stop stop-color="#061329" stop-opacity=".55"/><stop offset=".4" stop-color="#061329" stop-opacity=".25"/><stop offset="1" stop-color="#061329" stop-opacity=".93"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#d)"/><rect x="90" y="205" width="70" height="8" fill="#80b3ff"/><text x="90" y="280" font-family="Poppins" font-size="31" font-weight="700" fill="white">PEDRO DESTRAVA</text><text x="990" y="280" text-anchor="end" font-family="Poppins" font-size="24" fill="white">${indice+1}/${total}</text>${linhas}<text x="90" y="1750" font-family="Poppins" font-size="30" fill="#80b3ff">${ACCOUNT.handle}</text>${imagem?'<text x="90" y="1810" font-family="Poppins" font-size="19" fill="#ccd8e8">Imagem ilustrativa</text>':''}</svg>`;
  return sharp(bg).composite([{input:Buffer.from(svg)}]).png().toBuffer();
}
function executar(args,timeout=48000){return new Promise((resolve,reject)=>{const p=spawn(require('ffmpeg-static'),['-hide_banner','-loglevel','error',...args],{stdio:['ignore','ignore','pipe']});let err='';const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('Este trecho levou mais tempo que o esperado. Tente retomar a preparação.'));},timeout);p.stderr.on('data',b=>{err=(err+b.toString()).slice(-1800);});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error('Não consegui renderizar o trecho do vídeo: '+err.slice(-300)));});});}
async function renderSegmento({slide,imagem,indice,total,duracao}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pd-motion-'));
  try{const frame=await quadro(slide,imagem,indice,total);await fs.writeFile(path.join(dir,'frame.png'),frame);await fs.writeFile(path.join(dir,'caption.ass'),ass(fala(slide),duracao));const frames=Math.ceil(duracao*24);
    const filtro=`zoompan=z='min(zoom+0.00025,1.06)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${frames}:s=1080x1920:fps=24,ass=${dir}/caption.ass:fontsdir=${ASSETS},fade=t=in:d=0.18`;
    await executar(['-y','-threads','1','-i',path.join(dir,'frame.png'),'-vf',filtro,'-frames:v',String(frames),'-an','-c:v','libx264','-preset','ultrafast','-crf','27','-maxrate','650k','-bufsize','1300k','-pix_fmt','yuv420p','-threads','1',path.join(dir,'part.mp4')]);
    return {dados:await fs.readFile(path.join(dir,'part.mp4')),duracao:frames/24,poster:await sharp(frame).resize(540,960).jpeg({quality:85}).toBuffer()};
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function juntar(partes,audio,{duracao}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pd-final-'));
  try{for(let i=0;i<partes.length;i++)await fs.writeFile(path.join(dir,`p${i}.mp4`),partes[i]);await fs.writeFile(path.join(dir,'list.txt'),partes.map((_,i)=>`file '${dir}/p${i}.mp4'`).join('\n'));if(audio)await fs.writeFile(path.join(dir,'voice.wav'),audio);
    await executar(['-y','-f','concat','-safe','0','-i',path.join(dir,'list.txt'),...(audio?['-i',path.join(dir,'voice.wav'),'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','64k','-shortest']:['-an']),'-c:v','copy','-movflags','+faststart',path.join(dir,'final.mp4')]);
    let dados=await fs.readFile(path.join(dir,'final.mp4'));
    // Function responses are capped at 4.5 MB. Keep room for delivery overhead.
    if(dados.length>4000000){
      const segundos=duracao || (audio?(audio.length-44)/48000:0);if(!segundos)throw new Error('Não consegui calcular o tamanho do vídeo. Retome a preparação.');
      const kbps=Math.max(110,Math.floor(3400000*8/segundos/1000)-(audio?64:0));
      await executar(['-y','-threads','1','-i',path.join(dir,'final.mp4'),'-c:v','libx264','-preset','ultrafast','-b:v',`${kbps}k`,'-maxrate',`${kbps}k`,'-bufsize',`${kbps*2}k`,'-threads','1',...(audio?['-c:a','copy']:['-an']),'-movflags','+faststart',path.join(dir,'compact.mp4')]);
      dados=await fs.readFile(path.join(dir,'compact.mp4'));if(dados.length>4100000)throw new Error('O vídeo ainda ficou grande demais. Peça uma versão mais curta.');
    }
    return dados;
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function avancar(c){
  const a=armazem(),v=M.versaoAtiva(c);let m=c.motion;
  if(!m || m.engine!=='local' || m.hash!==v.hash){m=c.motion={engine:'local',estado:'renderizando',etapa:'vozes',hash:v.hash,segmentos:[],audio_partes:[],indice_voz:0,indice:0,formato:'1080x1920',iniciado_em:new Date().toISOString(),narracao:false};}
  if(m.etapa==='voz'){m.etapa='vozes';m.audio_partes=[];m.indice_voz=0;}
  if(m.etapa==='vozes'){
    try{
      const voz=await gerarVoz(fala(v.slides[m.indice_voz]));if(voz.duracao>30||voz.duracao<.5)throw new Error('A narração deste trecho não ficou na duração esperada.');
      const pcm=voz.dados.subarray(44);const alinhado=Buffer.concat([pcm,Buffer.alloc(Math.ceil(pcm.length/2000)*2000-pcm.length)]);
      const key=`motion:${c.id}:${v.id}:voz${m.indice_voz}`;await a.arquivos.salvar(conta,key,wav(alinhado),'audio/wav');
      m.audio_partes.push({key,duracao:alinhado.length/48000});m.indice_voz++;m.tentativas_voz=0;
      if(m.indice_voz>=v.slides.length)m.etapa='juntar_voz';
    }catch(e){
      m.tentativas_voz=(m.tentativas_voz||0)+1;if(m.tentativas_voz<2)return m;
      m.aviso=(/abort|timeout/i.test(e.message)?'A narração demorou mais que o esperado.':e.message)+' O vídeo será preparado com legendas, sem voz.';m.duracao_alvo=60;m.narracao=false;m.etapa='segmentos';
    }
    return m;
  }
  if(m.etapa==='juntar_voz'){
    const vozes=await Promise.all(m.audio_partes.map(async p=>(await a.arquivos.obter(conta,p.key)).dados));
    m.duracao_alvo=m.audio_partes.reduce((n,p)=>n+p.duracao,0);if(m.duracao_alvo>90)throw new Error('A narração ficou longa demais. Peça uma versão mais curta.');
    m.audio_key=`motion:${c.id}:${v.id}:voz`;await a.arquivos.salvar(conta,m.audio_key,wav(Buffer.concat(vozes.map(b=>Buffer.from(b).subarray(44)))),'audio/wav');
    m.narracao=true;m.voz='Charon · português brasileiro';delete m.aviso;m.etapa='segmentos';return m;
  }
  if(m.etapa==='segmentos'){
    const s=v.slides[m.indice];const n=palavras(fala(s)).length;const total=v.slides.reduce((n,s)=>n+palavras(fala(s)).length,0);const duracao=m.narracao&&m.audio_partes?.[m.indice]?m.audio_partes[m.indice].duracao:Math.max(2,m.duracao_alvo*n/Math.max(total,1));
    const imgId=s.imagem_id||c.imagens?.[0]?.id;const imagem=imgId?(await a.arquivos.obter(conta,`img:${imgId}`))?.dados:null;
    const r=await renderSegmento({slide:s,imagem,indice:m.indice,total:v.slides.length,duracao});const key=`motion:${c.id}:${v.id}:parte${m.indice}`;await a.arquivos.salvar(conta,key,r.dados,'video/mp4');
    if(m.indice===0){m.poster_key=`motion:${c.id}:${v.id}:poster`;await a.arquivos.salvar(conta,m.poster_key,r.poster,'image/jpeg');}
    m.segmentos.push({key,duracao:r.duracao});m.indice++;if(m.indice>=v.slides.length)m.etapa='juntar';return m;
  }
  if(m.etapa==='juntar'){
    const partes=await Promise.all(m.segmentos.map(async s=>(await a.arquivos.obter(conta,s.key)).dados));const audio=m.audio_key?(await a.arquivos.obter(conta,m.audio_key))?.dados:null;m.duracao=m.segmentos.reduce((n,s)=>n+s.duracao,0);const final=await juntar(partes,audio,{duracao:m.duracao});m.blob_key=`motion:${c.id}:${v.id}:final`;await a.arquivos.salvar(conta,m.blob_key,final,'video/mp4');m.estado='pronto';m.bytes=final.length;
    const base=String(process.env.PUBLIC_BASE_URL||'').replace(/\/$/,'');const token=require('./meta').assinarMidia({conteudo:c.id,hash:v.hash,indice:0,ttlS:30*86400});m.url=`${base}/api/publico/video/${token}.mp4`;m.poster=`${base}/api/sync/arquivos/${encodeURIComponent(m.poster_key)}`;m.concluido_em=new Date().toISOString();return m;
  }
  return m;
}
module.exports={avancar,gerarVoz,renderSegmento,juntar,ass,wav,quadro};
