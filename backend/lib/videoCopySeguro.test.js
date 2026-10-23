const test=require('node:test'),assert=require('node:assert/strict');
const {limparTitulo,daFonte}=require('./videoCopySeguro');
test('OCR do cabeçalho do perfil não vira gancho',()=>{
  assert.equal(limparTitulo('Pedro Martins e Qpedro. destrava E — .—'),'');
  assert.equal(limparTitulo('Pedro Martins @pedro_destrava'),'');
  assert.equal(limparTitulo('O detalhe que mudou essa negociação'),'O detalhe que mudou essa negociação');
});
test('sem IA o texto preserva o sentido da fala e não inventa uma lição',()=>{
  const transcript='Olha como está a Avenida Paulista. Essa imagem foi usada numa crítica à campanha. Eu discordo dessa leitura.';
  const r=daFonte({transcript});assert(r.caption.includes(transcript));assert(!/arte de rua|experiências|complete com|ajuste que rende/i.test(r.caption));assert.equal(r.fonte,'transcricao');
});
test('sem conteúdo lido o editor pede um gancho em vez de queimar uma identidade no vídeo',()=>{
  assert.throws(()=>daFonte({}),{status:422});
  assert.throws(()=>daFonte({transcript:'Música Música Música'}),{status:422});
});
test('gancho manual é preservado e a ação principal respeita o objetivo',()=>{
  const r=daFonte({givenHeadline:'Olha o que uma imagem pode fazer',objetivo:'compartilhar'});
  assert.equal(r.headline,'Olha o que uma imagem pode fazer');assert.match(r.caption,/Envie/);assert(!/Siga/.test(r.caption));
});
