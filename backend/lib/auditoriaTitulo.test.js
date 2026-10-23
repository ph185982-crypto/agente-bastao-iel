const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');

function fixture(opiniao = false) {
  const c = M.novoConteudo();
  c.claims = opiniao ? [{ id: 'o1', texto: 'Minha opinião', tipo: 'opiniao', premissas: [] }] : [];
  M.criarVersao(c, { slides: [{ id: 's1', layout: 'explicacao', titulo: 'Empresas fecharam', texto: 'Precisamos discutir a medida.', claim_ids: opiniao ? ['o1'] : [] }], legenda: '', hashtags: [] });
  return c;
}
test('título sem fonte participa da auditoria e bloqueia', () => {
  const c = fixture();
  const s = M.versaoAtiva(c).slides[0];
  c.auditoria_textos = { s1: { hash_texto: M.hash(M.textoParaAuditoria(s)), premissas: [{ texto: s.titulo, claim_id: null }] } };
  assert.ok(G.bloqueios(c).some(b => b.id === 'fato_sem_fonte'));
});
test('editar só o título invalida auditoria e exige nova conferência', () => {
  const c = fixture();
  const s = M.versaoAtiva(c).slides[0];
  c.auditoria_textos = { s1: { hash_texto: M.hash(M.textoParaAuditoria(s)), premissas: [] } };
  assert.ok(!G.bloqueios(c).some(b => b.id === 'titulo_nao_auditado'));
  M.editarSlide(c, 's1', { titulo: 'A medida fechou empresas' });
  assert.ok(G.bloqueios(c).some(b => b.id === 'titulo_nao_auditado'));
  assert.ok(G.sugestoes(c).some(b => b.id === 'texto_nao_auditado'));
});
test('auditoria antiga só do corpo não libera título de opinião', () => {
  const c = fixture(true);
  const s = M.versaoAtiva(c).slides[0];
  c.auditoria_textos = { s1: { hash_texto: M.hash(s.texto), premissas: [] } };
  assert.ok(G.bloqueios(c).some(b => b.id === 'opiniao_nao_auditada'));
});
test('slides sem título preservam o hash antigo', () => {
  const s = { titulo: null, texto: 'Texto anterior.' };
  assert.equal(M.hash(M.textoParaAuditoria(s)), M.hash(s.texto));
});

test('novo encerramento e CTA não escapam da conferência factual',()=>{
  const c=M.novoConteudo();
  M.criarVersao(c,{slides:[{id:'s1',design:'editorial_2026',layout:'encerramento',texto:'Siga para saber quando o investimento vai render.'}],cta:'Siga para saber quando o investimento vai render.',legenda:''});
  assert(G.bloqueios(c).some(b=>b.id==='texto_nao_auditado'));
  c.auditoria_textos={s1:{hash_texto:M.hash(M.textoParaAuditoria(M.versaoAtiva(c).slides[0])),premissas:[{texto:'O investimento vai render.',claim_id:null}]},cta:{hash_texto:M.hash(M.versaoAtiva(c).cta),premissas:[{texto:'O investimento vai render.',claim_id:null}]}};
  assert(G.bloqueios(c).some(b=>b.id==='fato_sem_fonte'&&b.onde?.slide==='s1'));
  assert(G.bloqueios(c).some(b=>b.id==='fato_sem_fonte'&&b.onde?.campo==='cta'));
});
test('registro provisório de extração não libera uma versão sem revisão integral',()=>{
  const c=fixture();const s=M.versaoAtiva(c).slides[0];s.design='editorial_2026';
  c.auditoria_textos={s1:{hash_texto:M.hash(M.textoParaAuditoria(s)),premissas:[],extracao_incompleta:true}};
  assert(G.bloqueios(c).some(b=>b.id==='conferencia_integral_pendente'));
  c.auditoria_textos.s1.texto_conferido=true;
  assert(!G.bloqueios(c).some(b=>b.id==='conferencia_integral_pendente'));
});

test('CTA do novo modelo pede uma ação concreta e evita o fechamento genérico antigo',()=>{
  const c=M.novoConteudo();M.criarVersao(c,{slides:[{id:'s1',design:'editorial_2026',layout:'explicacao',texto:'Um fato.'}],cta:'Salve e siga para mais análises rápidas.',legenda:''});
  assert(G.bloqueios(c).some(b=>b.id==='cta_generico'));assert(G.bloqueios(c).some(b=>b.id==='cta_varias_acoes'));
  M.versaoAtiva(c).cta='Siga @pedro_destrava para distinguir o teto do MEI anunciado do limite que já vale.';
  assert(!G.bloqueios(c).some(b=>['cta_generico','cta_varias_acoes'].includes(b.id)));
});
