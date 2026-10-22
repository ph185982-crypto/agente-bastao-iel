const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const A=require('./armazem');
const M=require('../../static/contentModel');
const G=require('../../static/qualityGates');
const studio=require('./studio');
const prefs=require('./preferencias');
const {ACCOUNT}=require('./account');
const conta=ACCOUNT.ig_id;
let arm;
test('referências internas não aparecem nos slides nem na narração',()=>{
  assert.equal(studio.limparMarcadores('A empresa mudou **(a1, a4)**.'),'A empresa mudou.');
  assert.equal(studio.limparMarcadores('Leitura (o1_2) com contexto (2025).'),'Leitura com contexto (2025).');
});
test('valores abreviados em milhões e bilhões mantêm a mesma escala das fontes',()=>{
  assert.equal(M.extrairNumeros('R$\u202f11,4\u202fmi')[0].valor,11400000);
  assert.equal(M.extrairNumeros('R$ 2,5 bi')[0].valor,2500000000);
  assert.notEqual(M.extrairNumeros('R$ 11,4')[0].valor,11400000);
});
test.beforeEach(()=>{arm=Object.assign(A.memoria(),{duravel:true});A._definir(arm);process.env.PUBLISH_SECRET='segredo-local-studio';delete process.env.VAPID_PUBLIC_KEY;});
function pronto(){
  const c=M.novoConteudo({titulo:'FIXTURE revisão única'});
  c.claims=[{id:'a1',texto:'A empresa anunciou uma mudança.',tipo:'fato',natureza:'fato',estado:'sustentada',central:true,risco:'alto',evidencias:['e1'],revisao:{}}];
  c.evidencias=[{id:'e1',origem:'Empresa',trecho:'A empresa anunciou uma mudança.',relacao:'sustenta',correspondencia:'integral'}];
  M.criarVersao(c,{capas:[],capa_escolhida:'automatica',slides:[{id:'s1',funcao:'capa',layout:'capa_tipografica',estilo:'impacto',texto:'A empresa anunciou uma mudança.',claim_ids:['a1']},{id:'s2',funcao:'encerramento',layout:'encerramento',estilo:'impacto',texto:'Siga para entender a próxima mudança.',claim_ids:[]}],legenda:'A empresa anunciou uma mudança.',legenda_claim_ids:['a1'],cta:'Siga para entender.',hashtags:[]});
  const v=M.versaoAtiva(c);c.arte.renders=v.slides.map(s=>({slide_id:s.id,versao:v.id,texto_hash:M.hashRender(s),metrics:{cabe:true}}));c.studio={job:'fixture',estado:'pronto'};c.status='em_revisao';c.experimento={estilo:'impacto'};return c;
}
test('uma aprovação final cobre revisão humana; versão alterada e contradição continuam bloqueadas',async()=>{
  const c=pronto();assert(G.avaliar(c).bloqueios.some(b=>b.id==='revisao_humana_pendente'));assert.equal(studio.prepararRevisao(c).bloqueios.length,0);
  await arm.conteudos.salvar(conta,c.id,c,0);await assert.rejects(studio.decidir(c.id,{acao:'aprovar',hash:'hash-velho'}),{status:409});
  const r=await studio.decidir(c.id,{acao:'aprovar',hash:M.versaoAtiva(c).hash});assert.equal(r.status,'aprovado');assert.equal(r.claims[0].revisao.confirmada_por_pedro,true);
  assert.equal((await arm.publicacoes.listar(conta)).length,0,'aprovar o documento não inicia um post neste teste');
  const errado=pronto();errado.claims[0].estado='contradita';assert(studio.prepararRevisao(errado).bloqueios.some(b=>b.id==='contradicao_nao_resolvida'));
});
test('feedback durável não duplica; refazer preserva versão anterior e orienta futuras criações',async()=>{
  const c=pronto();await arm.conteudos.salvar(conta,c.id,c,0);const hash=M.versaoAtiva(c).hash;
  await prefs.registrar(c,{acao:'refazer',motivos:['texto_longo','invalido'],detalhe:'Mais direto',versao:hash});await prefs.registrar(c,{acao:'refazer',motivos:['texto_longo'],versao:hash});
  assert.equal((await prefs.listar()).length,1);assert((await prefs.orientacoes()).regras.some(r=>r.includes('12 a 28')));
  const novo=await studio.reagendar(c.id,{motivos:['visual'],detalhe:'Mudar',hash});assert.equal(novo.studio.estado,'gerando');assert.equal(novo.copia.versoes.length,1);assert.equal(novo.revisao.aprovada_versao,null);
});
test('produção concorrente executa uma única etapa e não publica; HMAC não aceita outro conteúdo',async()=>{
  const c=await studio.criar({texto:'Texto de teste '.repeat(30),request_id:'teste-studio-idempotente',estilo:'impacto'});
  const outro=await studio.criar({texto:'Texto de teste '.repeat(30),request_id:'teste-studio-idempotente'});assert.equal(outro.id,c.id);
  let chamadas=0;const deps={research:{lerFonte:async()=>{chamadas++;await new Promise(r=>setTimeout(r,30));return {legivel:true,titulo:'FIXTURE leitura'};}}};
  await Promise.all([studio.processar(c.id,c.studio.job,{deps}),studio.processar(c.id,c.studio.job,{deps})]);assert.equal(chamadas,1);assert.equal((await studio.ler(c.id)).doc.studio.etapa,'afirmacoes');assert.equal((await arm.publicacoes.listar(conta)).length,0);
  const token=studio.assinatura(c.id,c.studio.job);assert(studio.confere(c.id,c.studio.job,token));assert(!studio.confere('outro',c.studio.job,token));
});
test('preparar um rascunho antigo atribui estilo e mantém o histórico',async()=>{
  const c=pronto();delete c.studio;delete c.experimento;c.status='rascunho';
  await arm.conteudos.salvar(conta,c.id,c,0);
  const r=await studio.reagendar(c.id,{acao:'retomar'});
  assert(prefs.ESTILOS[r.experimento.estilo]);assert.equal(r.studio.estado,'gerando');assert.equal(r.copia.versoes.length,1);
});
test('os três formatos geram PNG legível e mudar estilo invalida a arte',async()=>{
  const arte=require('./arte');const img=await sharp({create:{width:1080,height:1350,channels:3,background:'#afcfe0'}}).jpeg().toBuffer();
  for(const estilo of Object.keys(prefs.ESTILOS)){const s={layout:'capa_foto',estilo,texto:'O detalhe que muda o jogo.'};const r=await arte.renderizarSlide(s,{indice:1,total:5,imagem:img});const meta=await sharp(r.png).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1350);assert.equal(r.metrics.cabe,true);}
  assert.notEqual(M.hashRender({texto:'Mesmo texto',estilo:'impacto'}),M.hashRender({texto:'Mesmo texto',estilo:'revista'}));
});
test('Reel tem narração em português, legendas sincronizadas, transições e saída vertical',()=>{
  const c=pronto();const edit=require('./motionStudio').montarTimeline(c,{base:'https://exemplo.test',tokenMidia:'fixture'});assert.deepEqual(edit.output.size,{width:1080,height:1920});
  const clips=edit.timeline.tracks.flatMap(t=>t.clips);assert(clips.some(c=>c.asset.type==='text-to-speech'&&c.asset.language==='pt-BR'));assert(clips.some(c=>c.asset.type==='caption'&&c.asset.src.startsWith('alias://')));assert(clips.some(c=>c.effect==='zoomInSlow'));
});

test('renderização local gera MP4 real, concatena trechos e conserva saída vertical',async()=>{
  const local=require('./motionLocal');const {spawnSync}=require('child_process');const fs=require('fs/promises'),path=require('path'),os=require('os');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pd-video-test-'));
  try{const r=await local.renderSegmento({slide:{texto:'Teste de legenda no vídeo.'},imagem:null,indice:0,total:2,duracao:2});const final=await local.juntar([r.dados,r.dados],null);const p=path.join(dir,'final.mp4');await fs.writeFile(p,final);const out=JSON.parse(spawnSync(require('ffprobe-static').path,['-v','quiet','-show_streams','-show_format','-of','json',p],{encoding:'utf8'}).stdout);assert.equal(out.streams[0].width,1080);assert.equal(out.streams[0].height,1920);assert(Math.abs(Number(out.format.duration)-4)<.1);assert.equal(out.streams[0].codec_name,'h264');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('narração é preparada por cena e o áudio final segue os limites dos quadros',async()=>{
  const c=pronto(),local=require('./motionLocal');const original=global.fetch,key=process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY='fixture-google';const textos=[];
  global.fetch=async(url,opts)=>{textos.push(JSON.parse(opts.body).contents[0].parts[0].text);return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16',data:Buffer.alloc(48010).toString('base64')}}]}}]})};};
  try{
    c.motion=await local.avancar(c);assert.equal(c.motion.indice_voz,1);assert.equal(c.motion.etapa,'vozes');
    c.motion=await local.avancar(c);assert.equal(c.motion.etapa,'juntar_voz');
    c.motion=await local.avancar(c);assert.equal(c.motion.narracao,true);assert.equal(c.motion.etapa,'segmentos');assert.equal(textos.length,2);
    assert(!textos[0].includes('Siga para entender'));assert(textos[1].includes('Siga para entender'));
    const audio=await arm.arquivos.obter(conta,c.motion.audio_key);assert.equal((audio.dados.length-44)%2000,0);
    assert.equal(c.motion.duracao_alvo,(audio.dados.length-44)/48000);
  }finally{global.fetch=original;if(key===undefined)delete process.env.GOOGLE_API_KEY;else process.env.GOOGLE_API_KEY=key;}
});

test('produção completa chega à revisão sem aprovações intermediárias e sem publicar',async()=>{
  const c=await studio.criar({texto:'FIXTURE de produção completa. '.repeat(15),request_id:'fixture-fluxo-completo',estilo:'foto_editorial'});
  const imagem=await sharp({create:{width:1080,height:1350,channels:3,background:'#7e94ae'}}).jpeg().toBuffer();
  const claim={id:'a1',texto:'A empresa anunciou uma mudança.',tipo:'fato',natureza:'fato',estado:'parcialmente_sustentada',central:true,risco:'alto',evidencias:['e1'],revisao:{}};
  const ev={id:'e1',origem:'Empresa',trecho:claim.texto,relacao:'sustenta',correspondencia:'integral',fonte_principal:true};
  const deps={
    research:{lerFonte:async()=>({legivel:true,titulo:'FIXTURE de produção',veiculo:'Empresa',tipo:'artigo',texto:claim.texto}),levantarAfirmacoes:async()=>({claims:[claim],evidencias:[ev]}),verificarAfirmacao:async()=>({claim,evidencias:[ev]})},
    redacao:{gerarBriefing:async()=>({briefing:{assunto:'Mudança da empresa',formato:'carrossel'}}),gerarCopia:async()=>({opinioes:[],versao:{capas:[{id:'k1',foco:'tensao',texto:claim.texto,claim_ids:['a1']}],slides:[{id:'s1',funcao:'capa',layout:'capa_tipografica',texto:claim.texto,claim_ids:['a1']},{id:'s2',funcao:'explicacao',layout:'explicacao',texto:'Entenda a mudança anunciada.',claim_ids:['a1']},{id:'s3',funcao:'encerramento',layout:'encerramento',texto:'Siga para entender a próxima mudança.',claim_ids:[]}],legenda:claim.texto,legenda_claim_ids:['a1'],cta:'Siga para entender a próxima mudança.',hashtags:[]}}),auditarOpinioes:async({slides})=>({auditoria:slides.map(s=>({slide_id:s.id,hash_texto:M.hash(s.texto),premissas:[{texto:claim.texto,claim_id:'a1'}]}))})},
    buscarFoto:async()=>({dados:imagem,meta:{id:'foto-fixture',tipo:'ilustrativa',origem:'https://exemplo.test/foto',licenca:'FIXTURE'}}),
  };
  let atual=c;for(let i=0;i<25&&atual.studio.estado==='gerando';i++)atual=await studio.processar(c.id,c.studio.job,{deps});
  assert.equal(atual.studio.estado,'pronto',atual.studio.erro);assert.equal(atual.status,'em_revisao');assert.equal(studio.prepararRevisao(atual).bloqueios.length,0);assert.equal(atual.revisao.aprovada_versao,null);assert.equal(atual.arte.renders.length,3);assert.equal((await arm.publicacoes.listar(conta)).length,0);
  assert.match(M.versaoAtiva(atual).slides[0].texto,/Segundo Empresa/);assert.match(M.versaoAtiva(atual).legenda,/Segundo Empresa/);
});
