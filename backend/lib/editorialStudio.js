// A story has a visual rhythm: photograph, evidence, number, position, conversation.
// Only existing, audited copy is drawn here. A typeset source card is never a fake screenshot.
const sharp = require('sharp');
const path = require('path');
const { ACCOUNT } = require('./account');
const W = 1080, H = 1350, X = 80, WIDTH = 920;
const INK = '#0A0D14', PAPER = '#F7F6F2', BLUE = '#0052FF', GRAY = '#A0A6B0';
const esc = s => String(s || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const plain = s => String(s || '').replace(/\*\*/g,'').trim();
const norm = s => plain(s).toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

function copy(s) {
  let title = s.titulo || '', body = s.texto || '';
  if (norm(title) === norm(body)) title = '';
  else if (title && norm(body).startsWith(norm(title))) {
    const n = plain(title).length;
    if (plain(body).slice(0,n).toLocaleLowerCase('pt-BR') === plain(title).toLocaleLowerCase('pt-BR')) body = plain(body).slice(n).replace(/^[\s.:;—–-]+/,'');
  }
  return {title,body};
}
function source(s) {
  const t = String(s.fonte_linha || '').split(' · ').filter(p=>!/^consultad|^“/.test(p)).join(' · ');
  return t.length > 130 ? t.slice(0,127).replace(/\s+\S*$/,'')+'…' : t;
}
function composition(s,ctx) {
  if (ctx.indice===1) return 'capa';
  if (s.layout==='encerramento') return 'encerramento';
  if (s.layout==='comparacao'&&s.dados?.esquerda&&s.dados?.direita) return 'comparacao';
  if (['numero','recorte','pergunta','foto','manifesto','texto'].includes(s.composicao)) return s.composicao;
  if (s.funcao==='prova') return /\d/.test(s.titulo||'') ? 'numero' : 'recorte';
  if (s.funcao==='opiniao') return 'manifesto';
  return ctx.indice%2===0?'texto':'foto';
}
async function renderizar(s,ctx,imagem) {
  const A = require('./arte'); // lazy: avoids the renderer import cycle
  const kind = composition(s,ctx), {title,body} = copy(s);
  const dark = ['capa','manifesto','encerramento'].includes(kind);
  const bg = kind==='encerramento'?'#0A1B33':dark ? INK : PAPER, fg = dark ? '#FFFFFF' : INK;
  const accent = s.estilo==='revista'?'#B9492C':BLUE;
  const blocks=[], layers=[];
  let parts = `<rect width="1080" height="1350" fill="${bg}"/>`;
  function label(t,x,y,color=fg,size=23,spacing=1.5) {
    return `<text x="${x}" y="${y}" font-family="Poppins" font-weight="700" font-size="${size}" letter-spacing="${spacing}" fill="${color}">${esc(t)}</text>`;
  }
  function text(t,{x=X,y,width=WIDTH,height,max=72,min=40,k='semi',color=fg,name='texto',line=1.22}={}) {
    if(!t)return '';
    const papel=name==='fonte'?'fonte_linha':['detalhe','conclusao'].includes(name)?'texto_comparacao':k==='display'?'titulo':'corpo';
    const b=A.ajustar({texto:t,k,larg:width,alt:height,max,min,entrelinha:line,papel});
    blocks.push({nome:name,...A.resumo(b,height)});
    parts+=A.textoSvg(b,{x,y,k,cor:color,corDestaque:dark?'#92B4FF':accent});
    return b.altura;
  }
  async function photo({x=0,y,width=W,height,position='attention'}) {
    if(!imagem)return;
    const input=await sharp(imagem).rotate().resize(width,height,{fit:'cover',position}).png().toBuffer();
    layers.push({input,left:x,top:y});
  }
  const footer=(hint='DESLIZE →')=>{
    parts+=`<line x1="80" y1="1235" x2="1000" y2="1235" stroke="${dark?'#2B303A':'#D7D9DD'}"/>`;
    parts+=label(hint,X,1290,dark?'#D5D9E1':'#5C626E',22,.5);
    parts+=label(`${String(ctx.indice).padStart(2,'0')} / ${String(ctx.total).padStart(2,'0')}`,900,1290,fg,22,1);
  };
  const smallSource=()=>{const f=source(s);if(f)text(f,{y:1134,height:72,max:24,min:20,k:'semi',color:dark?GRAY:'#626875',name:'fonte',line:1.35});};
  parts+=label('PEDRO DESTRAVA',X,83,fg,24,2.3);
  parts+=`<rect x="80" y="108" width="54" height="7" fill="${accent}"/>`;

  if(kind==='capa') {
    if(imagem){
      await photo({y:150,height:540});
      parts+=`<rect y="690" width="1080" height="660" fill="${INK}"/>`;
      text(body,{y:748,height:410,max:88,min:58,k:'display',line:1.12,name:'gancho'});
      parts+=label('FOTO ILUSTRATIVA',X,665,'#FFFFFF',19,1);
    }else{
      text(body,{y:285,height:800,max:112,min:60,k:'display',line:1.09,name:'gancho'});
    }
    footer('O QUE ESSA HISTÓRIA REVELA →');
  }else if(kind==='numero'){
    const value=/\d/.test(title)?title:(plain(body).match(/(?:R\$|US\$)?\s*\d[\d.,]*(?:\s*(?:milh[õo]es|milh[ãa]o|bilh[õo]es|mil|mi|bi|%))?/i)?.[0]||title);
    parts+=label('O DADO QUE IMPORTA',X,235,accent,23);
    text(value,{y:300,height:275,max:154,min:60,k:'display',name:'dado',line:1.05});
    parts+=`<rect x="80" y="606" width="920" height="5" fill="${accent}"/>`;
    text(body,{y:672,height:375,max:57,min:38,k:'semi',line:1.32});
    smallSource();footer();
  }else if(kind==='recorte'){
    text(title,{y:196,height:220,max:72,min:44,k:'display',name:'titulo',line:1.14});
    const cardY=title?460:245;
    parts+=`<rect x="80" y="${cardY}" width="920" height="585" rx="3" fill="#FFFFFF" stroke="#DADCE1" stroke-width="2"/><rect x="80" y="${cardY}" width="8" height="585" fill="${accent}"/>`;
    parts+=label('O QUE A MATÉRIA DIZ',126,cardY+62,'#626875',21,1.2);
    text(body,{x:126,y:cardY+110,width:820,height:415,max:58,min:38,k:'corpo',name:'trecho',line:1.32});
    smallSource();footer();
  }else if(kind==='comparacao'){
    text(title,{y:192,height:230,max:72,min:44,k:'display',name:'titulo',line:1.12});
    const y=title?470:255;
    for(const [i,d] of [s.dados.esquerda,s.dados.direita].entries()){
      const top=y+i*235;
      parts+=`<rect x="80" y="${top}" width="920" height="210" rx="4" fill="${i?INK:'#FFFFFF'}" stroke="#DADCE1"/>`;
      const color=i?'#FFFFFF':INK;
      parts+=label(String(d.rotulo||'').toUpperCase(),110,top+47,i?'#92B4FF':accent,23);
      text(String(d.valor||''),{x:110,y:top+67,width:400,height:110,max:74,min:44,k:'display',color,name:'valor'});
      text(String(d.detalhe||''),{x:555,y:top+70,width:405,height:110,max:34,min:34,color,name:'detalhe',line:1.2});
    }
    text(body,{y:y+500,height:145,max:39,min:34,name:'conclusao',line:1.28});
    smallSource();footer();
  }else if(kind==='pergunta'){
    parts+=label('QUERO SABER A SUA LEITURA',X,235,accent,23);
    text(title||body,{y:315,height:440,max:88,min:50,k:'display',name:'pergunta',line:1.13});
    if(title)text(body,{y:795,height:270,max:47,min:38,line:1.35});
    parts+=`<line x1="80" y1="1110" x2="1000" y2="1110" stroke="${accent}" stroke-width="4"/>`;
    footer('ME CONTA NOS COMENTÁRIOS');
  }else if(kind==='encerramento'){
    text(body,{y:215,height:500,max:78,min:48,k:'display',name:'convite',line:1.16});
    // The existing, user-supplied portrait is integrated into the page, never generated.
    const {data:portraitPixels,info:portraitInfo}=await sharp(path.join(__dirname,'..','assets','template-editor-viral.png')).extract({left:0,top:1182,width:450,height:524}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    // The first 96px are the original portrait's hair against white. Keep the face
    // unchanged and remove only that known background, as the original video editor does.
    for(let y=0;y<96;y++)for(let x=0;x<450;x++){const j=(y*450+x)*4;if(portraitPixels[j]>225&&portraitPixels[j+1]>225&&portraitPixels[j+2]>225)portraitPixels[j+3]=0;}
    const portrait=await sharp(portraitPixels,{raw:portraitInfo}).png().toBuffer();
    layers.push({input:portrait,left:630,top:711});
    parts+=label('PEDRO',X,928,'#FFFFFF',44,2);
    parts+=label('DESTRAVA',X,987,'#FFFFFF',44,2);
    parts+=label(ACCOUNT.handle,X,1055,'#92B4FF',29,0);
    footer('ESTRATÉGIA POR TRÁS DA NOTÍCIA');
  }else if(kind==='foto'&&imagem){
    text(title||body,{y:190,height:330,max:76,min:46,k:'display',name:'titulo',line:1.13});
    await photo({x:80,y:550,width:920,height:365});
    parts+=label('FOTO ILUSTRATIVA',100,884,'#FFFFFF',18,1);
    if(title)text(body,{y:958,height:252,max:44,min:38,line:1.3});
    footer();
  }else{
    const serif=s.estilo==='revista'||kind==='manifesto';
    parts+=label(kind==='manifesto'?'MINHA LEITURA':'OLHA O QUE ESTÁ EM JOGO',X,230,dark?'#92B4FF':accent,23);
    let y=315;
    if(title){const h=text(title,{y,height:350,max:83,min:44,k:serif?'corpoNegrito':'display',name:'titulo',line:1.15});y+=h+65;}
    text(body,{y,height:Math.max(230,1065-y),max:title?51:72,min:38,k:serif?'corpo':'semi',line:1.3});
    smallSource();footer();
  }
  // Place photography underneath vector copy, in the exact boxes allocated above.
  const base=await sharp({create:{width:W,height:H,channels:3,background:bg}}).composite(layers).png().toBuffer();
  // Background is already painted by the base. Do not paint over the photographs.
  parts=parts.replace(/^<rect width="1080" height="1350" fill="[^"]+"\/>/,'');
  const png=await sharp(base).composite([{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${parts}</svg>`)}]).png().toBuffer();
  return {png,metrics:{layout:s.layout,composicao:kind,cabe:blocks.every(b=>b.cabe!==false),fonte_px:Math.min(...blocks.map(b=>b.tam)),blocos:blocks,elementos:['editorial_2026',`composicao_${kind}`,`experimento_${s.estilo}`,...(imagem?['foto_ilustrativa_licenciada']:[]),...(kind==='encerramento'?['retrato_original_integrado']:[])],problemas:blocks.filter(b=>!b.cabe).map(b=>b.motivo)}};
}
module.exports={renderizar,composition,copy,source};
