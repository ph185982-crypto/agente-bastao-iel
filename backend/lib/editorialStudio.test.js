const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const A=require('./arte');
const E=require('./editorialStudio');
const M=require('../../static/contentModel');
const G=require('../../static/qualityGates');

test('atribuição aceita artigo português sem duplicar nem apagar a condição',()=>{
  assert.equal(M.normalizarAtribuicao('Segundo a Agência Brasil,'),M.normalizarAtribuicao('segundo Agência Brasil'));
  assert.notEqual(M.normalizarAtribuicao('Ainda depende de aprovação'),M.normalizarAtribuicao('Não depende de aprovação'));
  const c=M.novoConteudo({titulo:'Teste de atribuição'});
  c.claims=[{id:'a1',texto:'A decisão foi mantida.',tipo:'fato',estado:'parcialmente_sustentada',central:true,decisao:{tipo:'atribuir',condicao:'segundo Agência Brasil'},evidencias:['e1']}];
  c.evidencias=[{id:'e1',origem:'Agência Brasil',trecho:'A decisão foi mantida.'}];
  M.criarVersao(c,{slides:[{id:'s1',layout:'explicacao',texto:'Segundo a Agência Brasil, a decisão foi mantida.',claim_ids:['a1']}],legenda:'',cta:''});
  assert(!G.bloqueios(c).some(b=>b.id==='ressalva_ausente'));
  M.versaoAtiva(c).slides[0].texto='A decisão foi mantida.';
  assert(G.bloqueios(c).some(b=>b.id==='ressalva_ausente'));
});

test('a frase seguinte não vira parte do nome da fonte na atribuição',()=>{
  const c=M.novoConteudo({titulo:'Duas frases'});c.fonte_principal={veiculo:'Agência Brasil',origem:'Agência Brasil',texto:'O Brent recuou.'};
  M.criarVersao(c,{slides:[{id:'s1',layout:'explicacao',texto:'Segundo Agência Brasil. O Brent recuou.',claim_ids:[]}],cta:''});
  assert(!G.bloqueios(c).some(b=>b.id==='atribuicao_sem_origem'));
  M.versaoAtiva(c).slides[0].texto='Segundo Fulano Inventado. O Brent recuou.';
  assert(G.bloqueios(c).some(b=>b.id==='atribuicao_sem_origem'));
});

test('hash distingue composição e preserva versões anteriores ao novo desenho',()=>{
  const s={id:'s1',layout:'prova',texto:'Um dado da fonte.',estilo:'impacto'};
  assert.notEqual(M.hashRender(s),M.hashRender({...s,design:'editorial_2026',composicao:'numero'}));
  const a={slides:[{...s,design:'editorial_2026',composicao:'numero'}]},b={slides:[{...s,design:'editorial_2026',composicao:'recorte'}]};
  assert.notEqual(M.hash(M.conteudoDaVersao(a)),M.hash(M.conteudoDaVersao(b)));
  assert(!('design' in M.conteudoDaVersao({slides:[s]}).slides[0]));
});

test('texto, dado, matéria, pergunta e foto cabem com fontes medidas no celular',async()=>{
  const foto=await sharp({create:{width:1200,height:1600,channels:3,background:'#636e78'}}).jpeg().toBuffer();
  const casos=[
    {titulo:'A multa não encerra a conversa.',texto:'Segundo a Agência Brasil, apagões deixaram consumidores sem energia. O valor da penalidade conta só uma parte da história.',composicao:'foto'},
    {titulo:'R$ 11,4 mi',texto:'É a penalidade mantida pelo Procon paulistano após recurso da Enel, segundo a Agência Brasil.',composicao:'numero',fonte_linha:'Fonte: Agência Brasil · “Título comprido da matéria” · publicada em 21/10/2026 · consultada em 22/10/2026'},
    {titulo:'A decisão foi mantida.',texto:'Segundo a Agência Brasil, a decisão administrativa confirmou a penalidade após recurso da empresa.',composicao:'recorte',fonte_linha:'Fonte: Agência Brasil · publicada em 21/10/2026'},
    {titulo:'O que você cobraria primeiro?',texto:'Uma multa maior ou um prazo para melhorar o serviço? Me conta o que faria diferença no seu dia a dia.',composicao:'pergunta'},
    {titulo:'Punição precisa virar cobrança.',texto:'Na minha leitura, cobrar investimento é tão importante quanto cobrar a multa.',composicao:'manifesto'},
    {layout:'encerramento',texto:'Siga @pedro_destrava para conectar decisões de empresas e governo ao dia a dia de quem empreende.'}
  ];
  for(const s of casos){const r=await A.renderizarSlide({layout:'explicacao',estilo:'foto_editorial',design:'editorial_2026',...s},{indice:3,total:7,imagem:foto});const m=await sharp(r.png).metadata();assert.deepEqual([m.width,m.height],[1080,1350]);assert(r.metrics.cabe,JSON.stringify({s,r:r.metrics}));assert(r.metrics.elementos.includes('editorial_2026'));}
});

test('redação repetida não é desenhada duas vezes; fonte não mostra instruções internas',()=>{
  assert.deepEqual(E.copy({titulo:'A decisão foi mantida.',texto:'A decisão foi mantida. O recurso foi negado.'}),{title:'A decisão foi mantida.',body:'O recurso foi negado.'});
  const source=E.source({fonte_linha:'Fonte: Agência Brasil · “Matéria longa” · publicada em 21/10/2026 · consultada em 22/10/2026'});
  assert.equal(source,'Fonte: Agência Brasil · publicada em 21/10/2026');
});

test('o novo desenho bloqueia densidade excessiva em vez de cortar a informação',()=>{
  const c=M.novoConteudo({titulo:'Texto longo'});M.criarVersao(c,{slides:[{id:'s1',design:'editorial_2026',layout:'explicacao',texto:'palavra '.repeat(50)}]});
  assert(G.bloqueios(c).some(b=>b.id==='texto_denso'));
});

test('modelo viral remove o selo que já estava gravado na imagem antiga',async()=>{
  const fs=require('fs/promises'),os=require('os'),path=require('path');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pedro-header-test-'));
  try{
    const file=path.join(dir,'viral.png');await require('../routes/videoEditor')._internals.buildViralEditorOverlay('Um gancho para conferir',file);
    const {data,info}=await sharp(file).extract({left:690,top:110,width:80,height:80}).raw().toBuffer({resolveWithObject:true});
    let azul=0;for(let i=0;i<data.length;i+=info.channels)if(data[i+2]>190&&data[i+1]>100&&data[i]<70)azul++;
    assert.equal(azul,0,'o selo azul embutido no PNG não pode aparecer na saída');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
