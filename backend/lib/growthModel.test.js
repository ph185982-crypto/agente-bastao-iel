const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../../static/growthModel');
const M=require('../../static/contentModel');

test('plano tem percursos próprios para carrossel, post e Reel',()=>{
  const a=P.plano('carrossel'),b=P.plano('estatico'),c=P.plano('reels');
  assert(a.sequencia.some(s=>s.includes('Tela 2')));assert.equal(b.sequencia.length,3);assert(c.sequencia[0].startsWith('0–3s'));
  assert.equal(P.plano('carrossel','invalido').objetivo,'seguidores');
  assert.match(P.instrucoes({objetivo:'compartilhar'}),/situação concreta/);
  assert.match(P.instrucoes({objetivo:'salvar'}),/consultar depois/);
  assert.match(P.instrucoes(),/sem promessa de viralização/);
});
test('capa concreta supera fórmula genérica sem premiar número inventado',()=>{
  const capas=[{foco:'tensao',texto:'Será que multas pesadas realmente fazem alguma diferença?',claim_ids:['a1']},{foco:'acontecimento',texto:'Enel recorreu. A multa foi mantida.',claim_ids:['a1']}];
  assert.equal(P.escolherCapa(capas,'tensao'),capas[1]);
});
test('diagnóstico mostra critérios e não calcula probabilidade de viralizar',()=>{
  const c=M.novoConteudo();c.crescimento=P.plano('carrossel','seguidores');
  M.criarVersao(c,{slides:[{id:'s1',layout:'capa_foto',composicao:'foto',texto:'Enel recorreu. A multa foi mantida.',claim_ids:['a1']},{id:'s2',layout:'prova',composicao:'numero',texto:'Uma decisão com efeito concreto.',claim_ids:['a1']},{id:'s3',layout:'explicacao',composicao:'pergunta',texto:'O que você cobraria primeiro?',claim_ids:[]}],cta:'Siga para entender decisões que afetam sua conta de luz.'});
  const d=P.diagnosticar(c);assert.equal(d.checks.length,5);assert(d.checks.every(k=>k.ok));assert(!('score'in d)&&!('probabilidade'in d));assert.match(d.aviso,/Não estima/);
});
test('taxas usam alcance, não visualizações; zero real difere de dado ausente',()=>{
  assert.deepEqual(P.medir({alcance:1000,compartilhamentos:30,salvos:0}),{compartilhamentos_por_mil:30,salvos_por_mil:0,seguidores_por_mil:null});
  assert.equal(P.medir({alcance:0,compartilhamentos:50}).compartilhamentos_por_mil,null);
  assert.equal(P.medir({views:10000,compartilhamentos:50}).compartilhamentos_por_mil,null);
});
test('comparação pondera alcance e exclui só o dado que não foi devolvido',()=>{
  const m=P.consolidar([{desempenho:{alcance:1000,compartilhamentos:30,salvos:null}},{desempenho:{alcance:9000,compartilhamentos:90,salvos:45}}]);
  assert.equal(m.compartilhamentos_por_mil,12);assert.equal(m.salvos_por_mil,5);assert.equal(m.seguidores_por_mil,null);
});

test('criação guarda formato post único e objetivo escolhido na tarefa durável',async()=>{
  const A=require('./armazem'),studio=require('./studio');const a=Object.assign(A.memoria(),{duravel:true});A._definir(a);
  const c=await studio.criar({texto:'Texto da fonte para produzir um post único. '.repeat(10),request_id:'fixture-growth-post',formato:'estatico',objetivo:'compartilhar'});
  assert.equal(c.formato,'estatico');assert.equal(c.crescimento.objetivo,'compartilhar');assert.equal(c.crescimento.versao,P.VERSION);assert.equal(c.studio.estado,'gerando');
  assert.equal((await a.publicacoes.listar(M.ACCOUNT_PIN.ig_id)).length,0);
});
