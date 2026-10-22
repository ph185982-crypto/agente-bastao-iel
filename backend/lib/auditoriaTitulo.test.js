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
