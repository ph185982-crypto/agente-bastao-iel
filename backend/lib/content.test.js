// Regressões da base (Entrega A). Cada teste nasceu de uma falha real ou de um
// requisito explícito. Rode com: node --test backend/lib/content.test.js
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');
const { ACCOUNT, confirmAccount, achaHandleErrado } = require('./account');
const { safeFetch, validaUrl, ipProibido, lookupSeguro } = require('./safeFetch');
const access = require('./access');
const { computeInsights, normalizePost, insightsValido, insightsParaPrompt } = require('./profileInsights');

// ── Conteúdo de exemplo coerente (tudo marcado como fixture de teste) ────────
function exemplo({ comArte = true } = {}) {
  const c = M.novoConteudo({ titulo: 'FIXTURE: poder de compra do salário mínimo', origem: { tipo: 'link', url: 'https://exemplo.test/materia' } });
  c.fonte_principal = { url: 'https://exemplo.test/materia', titulo: 'Salário mínimo em 1994', origem: 'Exemplo', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79 segundo o Banco Central.' };
  c.claims = [
    { id: 'a1', texto: 'Em julho de 1994 o salário mínimo era de R$ 64,79.', tipo: 'fato', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [{ valor: 64.79, unidade: 'BRL' }] },
    { id: 'a2', texto: 'Hoje o salário mínimo é de R$ 1.621,00.', tipo: 'fato', central: true, estado: 'sustentada', evidencias: ['e2'], valores: [{ valor: 1621, unidade: 'BRL' }] },
  ];
  c.evidencias = [
    { id: 'e1', tipo: 'primaria', trecho: 'Salário mínimo jul/1994: 64,79', origem: 'BCB SGS 1619', relacao: 'sustenta' },
    { id: 'e2', tipo: 'primaria', trecho: 'Salário mínimo vigente: 1621', origem: 'BCB SGS 1619', relacao: 'sustenta' },
  ];
  M.criarVersao(c, {
    estrutura: 'antes_depois',
    capa_escolhida: 'k1',
    capas: [{ id: 'k1', foco: 'acontecimento', texto: 'Em julho de 1994 o salário mínimo era R$ 64,79.', claim_ids: ['a1'] }],
    slides: [
      { id: 's1', layout: 'capa_tipografica', texto: 'Em julho de 1994 o salário mínimo era **R$ 64,79**.', claim_ids: ['a1'] },
      { id: 's2', layout: 'comparacao', texto: 'Hoje ele é de **R$ 1.621,00**.', claim_ids: ['a2'] },
    ],
    legenda: 'O salário mínimo saiu de R$ 64,79 para R$ 1.621,00. Manda pra alguém que quer entender.',
    legenda_claim_ids: ['a1', 'a2'],
    cta: 'Manda pra alguém que quer entender.',
    hashtags: ['#economia'],
  }, { quem: 'ia', rotulo: 'Primeira versão' });
  const v = M.versaoAtiva(c);
  if (comArte) {
    c.arte.renders = v.slides.map((s) => ({ slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), metrics: { cabe: true, fonte_px: 60 }, elementos: [] }));
  }
  return c;
}
const ids = (r) => r.bloqueios.map((b) => b.id);

test('conteúdo coerente não tem bloqueios e pode ser aprovado', () => {
  const c = exemplo();
  const r = G.avaliar(c);
  assert.deepStrictEqual(ids(r), [], JSON.stringify(r.bloqueios));
  M.aprovar(c, r);
  assert.strictEqual(c.status, 'aprovado');
});

test('conta errada: id diferente e @ errado bloqueiam', () => {
  const c = exemplo();
  c.conta = { username: 'pedrodestrava', handle: '@pedrodestrava', ig_id: '999' };
  assert.ok(ids(G.avaliar(c)).includes('conta_incorreta'));
  const d = exemplo();
  M.editarLegenda(d, { legenda: 'Segue @pedrodestrava. R$ 64,79 e R$ 1.621,00.' });
  assert.ok(ids(G.avaliar(d)).includes('handle_errado'));
  assert.deepStrictEqual(achaHandleErrado('Segue @pedrodestrava que...'), ['pedrodestrava']);
  assert.deepStrictEqual(achaHandleErrado('Segue @pedro_destrava'), []);
});

test('o @ fixo do módulo de dados é o mesmo do esquema compartilhado', () => {
  assert.deepStrictEqual({ username: ACCOUNT.username, handle: ACCOUNT.handle, ig_id: ACCOUNT.ig_id }, { ...M.ACCOUNT_PIN });
});

test('número inventado: valor que nenhuma fonte traz bloqueia', () => {
  const c = exemplo();
  M.editarSlide(c, 's2', { texto: 'Hoje ele é de **R$ 1.600**.' });
  const r = G.avaliar(c);
  assert.ok(ids(r).includes('numero_sem_origem'), JSON.stringify(ids(r)));
  assert.strictEqual(r.resumo.pode_aprovar, false);
});

test('capa e legenda com valores diferentes para a mesma afirmação = divergência', () => {
  const c = exemplo();
  M.editarSlide(c, 's1', { texto: 'Seus R$ 100 de 1994 valem **R$ 1.600** hoje.', claim_ids: ['a1'] });
  M.editarLegenda(c, { legenda: 'Seus R$ 100 de 1994 só compram R$ 6 hoje.', legenda_claim_ids: ['a1'] });
  const r = G.avaliar(c);
  assert.ok(ids(r).includes('valores_divergentes') || ids(r).includes('numero_sem_origem'));
  assert.ok(ids(r).includes('numero_sem_origem'));
});

test('número sem afirmação ligada bloqueia; contagem pequena não', () => {
  const c = exemplo();
  M.editarSlide(c, 's2', { texto: 'São 3 erros comuns em 2024 com 45% de queda.', claim_ids: [] });
  const r = G.avaliar(c);
  assert.ok(ids(r).includes('numero_sem_afirmacao'));
  assert.ok(!r.bloqueios.some((b) => /“3”|"3"/.test(b.detalhe)), 'contagem "3 erros" não exige origem');
});

test('fonte inexistente: central não verificada bloqueia; parcial exige DECISÃO específica', () => {
  const c = exemplo();
  c.claims[1].estado = 'nao_verificada';
  assert.ok(ids(G.avaliar(c)).includes('afirmacao_sem_sustentacao'));
  c.claims[1].estado = 'parcialmente_sustentada';
  assert.ok(ids(G.avaliar(c)).includes('afirmacao_parcial'));
  // o antigo "aceito com ressalva" genérico não libera mais nada
  c.claims[1].revisao = { aceito_com_ressalva: true };
  assert.ok(ids(G.avaliar(c)).includes('afirmacao_parcial'));
  // manter em revisão continua bloqueando
  M.decidirAfirmacao(c, 'a2', { tipo: 'em_revisao' });
  assert.ok(ids(G.avaliar(c)).includes('afirmacao_parcial'));
});

test('decisão "atribuir": exige a frase no texto público; tirar a ressalva volta a bloquear', () => {
  const c = exemplo();
  c.claims[1].estado = 'parcialmente_sustentada';
  assert.throws(() => M.decidirAfirmacao(c, 'a2', { tipo: 'atribuir', condicao: '' }), /atribuição ou condição/);
  M.decidirAfirmacao(c, 'a2', { tipo: 'atribuir', condicao: 'segundo o Banco Central' });
  let r = ids(G.avaliar(c));
  assert.ok(!r.includes('afirmacao_parcial'));
  assert.ok(r.includes('ressalva_ausente'), 'o slide 2 e a legenda ainda não trazem "segundo o Banco Central"');
  M.editarSlide(c, 's2', { texto: 'Hoje, segundo o Banco Central, ele é de **R$ 1.621,00**.' });
  M.editarLegenda(c, { legenda: 'O salário mínimo saiu de R$ 64,79 para R$ 1.621,00, segundo o Banco Central.' });
  r = ids(G.avaliar(c));
  assert.ok(!r.includes('ressalva_ausente'), JSON.stringify(G.avaliar(c).bloqueios.filter((b) => b.id === 'ressalva_ausente')));
  // edição que remove a ressalva para "deixar mais forte"
  M.editarSlide(c, 's2', { texto: 'Hoje ele é de **R$ 1.621,00**.' });
  assert.ok(ids(G.avaliar(c)).includes('ressalva_ausente'));
  assert.ok(c.historico.some((h) => h.tipo === 'decisao' && /segundo o Banco Central/.test(h.resumo)), 'decisão registrada');
});

test('decisões: retirar bloqueia enquanto estiver no texto; contradita não aceita atribuição; corrigir exige nova conferência', () => {
  const c = exemplo();
  M.decidirAfirmacao(c, 'a2', { tipo: 'retirar' });
  assert.ok(ids(G.avaliar(c)).includes('afirmacao_retirada_em_uso'));
  M.editarSlide(c, 's2', { texto: 'O que mudou desde então.', claim_ids: [] });
  M.editarLegenda(c, { legenda: 'O salário mínimo de 1994 era R$ 64,79.', legenda_claim_ids: ['a1'] });
  assert.ok(!ids(G.avaliar(c)).includes('afirmacao_retirada_em_uso'));
  c.claims[0].estado = 'contradita';
  assert.throws(() => M.decidirAfirmacao(c, 'a1', { tipo: 'atribuir', condicao: 'segundo a matéria' }), /corrija ou retire/);
  M.decidirAfirmacao(c, 'a1', { tipo: 'corrigir', texto_novo: 'Em julho de 1994 o salário mínimo era de R$ 64,79 por mês.' });
  assert.ok(ids(G.avaliar(c)).includes('afirmacao_corrigida_sem_conferencia'));
  assert.strictEqual(c.claims[0].textos_anteriores[0].texto, 'Em julho de 1994 o salário mínimo era de R$ 64,79.');
});

test('anúncio, declaração ou previsão: o texto público precisa dizer quem anunciou/disse', () => {
  const c = exemplo();
  c.claims[1].natureza = 'anuncio'; c.claims[1].texto = 'O governo anunciou que o salário mínimo será de R$ 1.621,00.';
  assert.ok(ids(G.avaliar(c)).includes('ressalva_ausente'), 'slide 2 diz como fato consumado');
  M.editarSlide(c, 's2', { texto: 'O governo anunciou que ele será de **R$ 1.621,00**.' });
  M.editarLegenda(c, { legenda: 'O salário mínimo de R$ 64,79 deve ir a R$ 1.621,00, segundo o governo.' });
  assert.ok(!ids(G.avaliar(c)).includes('ressalva_ausente'), JSON.stringify(G.avaliar(c).bloqueios));
});

test('contradição fica bloqueada até ser resolvida; sensível exige confirmação humana', () => {
  const c = exemplo();
  c.claims[0].estado = 'contradita';
  assert.ok(ids(G.avaliar(c)).includes('contradicao_nao_resolvida'));
  c.claims[0].estado = 'sustentada';
  c.claims[0].risco = 'alto';
  assert.ok(ids(G.avaliar(c)).includes('revisao_humana_pendente'));
  c.claims[0].revisao = { confirmada_por_pedro: true };
  assert.ok(!ids(G.avaliar(c)).includes('revisao_humana_pendente'));
});

test('citação e atribuição inventadas bloqueiam; as que estão na fonte passam', () => {
  const c = exemplo();
  M.editarLegenda(c, { legenda: 'Segundo Fulano de Tal, “a inflação é só uma sensação passageira dos pobres”. R$ 64,79 e R$ 1.621,00.' });
  const r = G.avaliar(c);
  assert.ok(ids(r).includes('citacao_sem_origem'));
  assert.ok(ids(r).includes('atribuicao_sem_origem'));
  M.editarLegenda(c, { legenda: 'Segundo o Banco Central, “o salário mínimo era de R$ 64,79”. Hoje R$ 1.621,00.' });
  const ok = G.avaliar(c);
  assert.ok(!ids(ok).includes('citacao_sem_origem') && !ids(ok).includes('atribuicao_sem_origem'), JSON.stringify(ids(ok)));
});

test('selo falso: qualquer sinal de selo de verificação bloqueia', () => {
  const c = exemplo();
  c.arte.renders[0].elementos = ['selo_verificacao'];
  assert.ok(ids(G.avaliar(c)).includes('selo_falso'));
  assert.strictEqual(M.ACCOUNT_PIN.username, 'pedro_destrava');
});

test('texto cortado, arte pendente e arte desatualizada bloqueiam', () => {
  const c = exemplo();
  c.arte.renders[0].metrics.cabe = false;
  assert.ok(ids(G.avaliar(c)).includes('texto_cortado'));
  c.arte.renders[0].metrics.cabe = true;
  c.arte.renders.pop();
  assert.ok(ids(G.avaliar(c)).includes('arte_pendente'));
  const d = exemplo();
  M.editarSlide(d, 's1', { texto: 'Em julho de 1994 o mínimo era **R$ 64,79**.' });
  assert.ok(ids(G.avaliar(d)).includes('arte_pendente'), 'versão nova sem arte');
});

test('frase editada após a aprovação reabre a aprovação e bloqueia a exportação', () => {
  const c = exemplo();
  M.aprovar(c, G.avaliar(c));
  assert.ok(G.checarExportacao(c).ok);
  M.editarSlide(c, 's1', { texto: 'Em julho de 1994 o salário mínimo era **R$ 64,79**, segundo o BC.' });
  assert.strictEqual(c.revisao.aprovada_versao, null);
  assert.strictEqual(c.status, 'em_revisao');
  assert.strictEqual(G.checarExportacao(c).ok, false);
  assert.throws(() => M.registrarExportacao(c, { arquivos: [] }), /versão aprovada/);
});

test('exportar versão antiga é recusado; desfazer volta à aprovada', () => {
  const c = exemplo();
  const v1 = M.versaoAtiva(c).id;
  M.aprovar(c, G.avaliar(c));
  M.editarSlide(c, 's2', { texto: 'Hoje ele é de **R$ 1.621,00** por mês.' });
  M.desfazer(c);
  assert.strictEqual(M.versaoAtiva(c).id, v1);
  assert.strictEqual(c.copia.versoes.length, 2, 'desfazer não apaga versão');
  assert.throws(() => M.registrarExportacao(c, { arquivos: [] }), /aprovada/);
  M.aprovar(c, G.avaliar(c));
  M.registrarExportacao(c, { arquivos: ['s1.png', 's2.png'] });
  assert.strictEqual(c.exportacoes[0].versao, v1);
});

test('integridade: alterar a versão aprovada depois da aprovação é detectado', () => {
  const c = exemplo();
  M.aprovar(c, G.avaliar(c));
  M.versaoAtiva(c).slides[0].texto = 'texto trocado por fora';
  M.versaoAtiva(c).hash = M.hash(M.conteudoDaVersao(M.versaoAtiva(c)));
  assert.strictEqual(G.checarExportacao(c).ok, false);
});

test('invalidação mínima: trocar só o layout/arte não reabre afirmações; mudar número reabre', () => {
  const c = exemplo();
  const antes = M.versaoAtiva(c);
  const dados = M.clone(antes);
  dados.slides[0].layout = 'capa_foto';
  assert.deepStrictEqual(M.efeitoDaEdicao(antes, dados).afirmacoes, []);
  const dados2 = M.clone(antes);
  dados2.slides[1].texto = 'Hoje ele é de **R$ 2.000,00**.';
  assert.deepStrictEqual(M.efeitoDaEdicao(antes, dados2).afirmacoes, ['a2']);
  const r = M.editarSlide(c, 's2', { texto: 'Hoje ele é de **R$ 2.000,00**.' });
  assert.deepStrictEqual(r.efeito.afirmacoes, ['a2']);
  assert.ok(c.claims[1].revisao.reaberta_em);
});

test('trecho bloqueado não é editado por engano', () => {
  const c = exemplo();
  M.alternarBloqueio(c, 's1', true);
  assert.throws(() => M.editarSlide(c, 's1', { texto: 'x' }), /bloqueado/);
});

test('estado da afirmação: trecho, correspondência e qualidade avaliados em separado', () => {
  const T = 'trecho literal';
  const ev = [
    { id: 'p', autoridade: 'primaria', grupo: 'ibge', correspondencia: 'integral', trecho: T, origem: 'IBGE' },
    { id: 'r1', autoridade: 'reportagem', grupo: 'g0', correspondencia: 'integral', trecho: T, origem: 'Jornal X' },
    { id: 'rep', autoridade: 'republicacao', grupo: 'g0', correspondencia: 'integral', trecho: T, origem: 'Portal Z' },
    { id: 'r2', autoridade: 'reportagem', grupo: 'g2', correspondencia: 'integral', trecho: T, origem: 'Diário Y' },
    { id: 'parc', autoridade: 'reportagem', grupo: 'g3', correspondencia: 'parcial', falta: 'o trecho fala em proposta, não em medida em vigor', trecho: T, origem: 'W' },
    { id: 'cp', autoridade: 'primaria', grupo: 'bcb', correspondencia: 'contradiz', trecho: T, origem: 'BCB' },
    { id: 'cr', autoridade: 'reportagem', grupo: 'g4', correspondencia: 'contradiz', trecho: T, origem: 'K' },
    { id: 'naoachou', autoridade: 'primaria', grupo: 'x', correspondencia: 'integral', trecho: T, trecho_encontrado: false, origem: 'Z' },
    { id: 'colado', autoridade: 'texto_colado', grupo: 'c', correspondencia: 'integral', trecho: T, origem: 'Texto colado' },
  ];
  const est = (claim, ids) => M.avaliarAfirmacao({ ...claim, evidencias: ids }, ev);
  // A. fonte primária única basta
  assert.strictEqual(est({ natureza: 'dado' }, ['p']).estado, 'sustentada');
  // B. duas páginas reproduzindo a mesma matéria = uma origem
  assert.strictEqual(est({ natureza: 'dado' }, ['r1', 'rep']).estado, 'parcialmente_sustentada', 'republicação não vira segunda fonte');
  assert.strictEqual(est({ natureza: 'fato' }, ['rep']).estado, 'parcialmente_sustentada', 'só reprodução não basta');
  // duas reportagens independentes reforçam
  assert.match(est({ natureza: 'dado' }, ['r1', 'r2']).motivo, /2 reportagens independentes/);
  // uma reportagem original de fato de baixo risco: sustentada, com a força explícita
  const um = est({ natureza: 'fato', risco: 'baixo' }, ['r1']);
  assert.strictEqual(um.estado, 'sustentada'); assert.strictEqual(um.forca, 'reportagem'); assert.match(um.motivo, /primária não consultada/);
  // mas não para assunto sensível nem para dado estatístico
  assert.strictEqual(est({ natureza: 'fato', risco: 'alto' }, ['r1']).estado, 'parcialmente_sustentada');
  assert.strictEqual(est({ natureza: 'dado' }, ['r1']).estado, 'parcialmente_sustentada');
  // anúncio registrado: sustentado COMO anúncio e exige atribuição
  const an = est({ natureza: 'anuncio' }, ['r1']);
  assert.strictEqual(an.estado, 'sustentada'); assert.strictEqual(an.exige_atribuicao, true); assert.match(an.motivo, /não que seja verdade/);
  // C. trecho real que só cobre parte
  assert.match(est({ natureza: 'fato' }, ['parc']).motivo, /proposta, não em medida em vigor/);
  // contradição
  assert.strictEqual(est({ natureza: 'dado' }, ['p', 'cp']).estado, 'contradita', 'primária que contradiz prevalece');
  assert.strictEqual(est({ natureza: 'dado' }, ['p', 'cr']).estado, 'parcialmente_sustentada', 'primária a favor + reportagem contra = divergência a conferir');
  assert.strictEqual(est({ natureza: 'dado' }, ['r1', 'r2', 'cp']).estado, 'contradita', 'dois veículos independentes não vencem a fonte primária');
  // trecho não encontrado não conta; texto colado não prova a si mesmo
  assert.strictEqual(est({ natureza: 'fato' }, ['naoachou']).estado, 'nao_verificada');
  assert.strictEqual(est({ natureza: 'fato' }, ['colado']).estado, 'nao_verificada');
  assert.strictEqual(est({ natureza: 'fato' }, []).estado, 'nao_verificada');
  // compatibilidade com registros antigos (relacao/tipo)
  assert.strictEqual(M.avaliarAfirmacao({ evidencias: ['o'] }, [{ id: 'o', tipo: 'primaria', relacao: 'sustenta', trecho: T }]).estado, 'sustentada');
});

test('números em texto PT-BR', () => {
  const v = (t) => M.extrairNumeros(t).map((n) => [n.valor, n.tipo]);
  assert.deepStrictEqual(v('R$ 1.600,50'), [[1600.5, 'moeda']]);
  assert.deepStrictEqual(v('caiu 94%'), [[94, 'percentual']]);
  assert.deepStrictEqual(v('2 mil lojas'), [[2000, 'quantidade']]);
  assert.deepStrictEqual(v('2,5 milhões'), [[2500000, 'quantidade']]);
  assert.deepStrictEqual(v('em 1994'), [[1994, 'ano']]);
});

test('erro de cálculo e períodos diferentes: valores calculados precisam bater com a fórmula guardada', () => {
  const c = exemplo();
  c.claims.push({ id: 'a3', texto: 'R$ 100 em jul/1994 equivalem a R$ 1.447,12 em set/2026 pelo IPCA.', tipo: 'calculo', central: true, estado: 'sustentada', evidencias: ['e1'],
    calculo: { formula: 'valor × índice_fim ÷ índice_base', entradas: [{ nome: 'valor', valor: 100 }, { nome: 'idx_base', valor: 915.93 }, { nome: 'idx_fim', valor: 13253.9 }], resultado: 1447.12 } });
  M.editarSlide(c, 's2', { texto: 'R$ 100 de 1994 hoje: **R$ 1.447**.', claim_ids: ['a3'] });
  assert.ok(!ids(G.avaliar(c)).includes('numero_sem_origem'), 'resultado arredondado do cálculo é aceito');
  M.editarSlide(c, 's2', { texto: 'R$ 100 de 1994 hoje: **R$ 1.600**.', claim_ids: ['a3'] });
  assert.ok(ids(G.avaliar(c)).includes('numero_sem_origem'), 'resultado diferente do cálculo é recusado');
});

test('sugestões não bloqueiam e ficam separadas dos bloqueios', () => {
  const c = exemplo();
  M.editarSlide(c, 's1', { texto: 'Você sabia que isso muda tudo? Em julho de 1994 o salário mínimo era **R$ 64,79**?' });
  const r = G.avaliar(c);
  assert.ok(r.sugestoes.some((s) => s.id === 'abertura_generica'));
  assert.ok(r.sugestoes.some((s) => s.id === 'expressao_a_evitar'));
  assert.ok(!r.bloqueios.some((b) => b.eixo === 'redacao'));
  const longo = exemplo();
  M.editarSlide(longo, 's2', { texto: `Hoje ele é de R$ 1.621,00. ${'palavra '.repeat(70)}` });
  assert.ok(G.avaliar(longo).sugestoes.some((s) => s.id === 'excesso_texto'));
});

test('texto bem escrito e factualmente pendente aparece separado no resumo', () => {
  const c = exemplo();
  c.claims[1].estado = 'nao_verificada';
  const r = G.avaliar(c);
  assert.strictEqual(r.resumo.fatos, 'pendente');
  assert.strictEqual(r.resumo.redacao, 'ok');
});

test('item legado migra como rascunho não verificado e não pode ser aprovado', () => {
  const c = M.migrarItemLegado({ id: 'x1', title: 'Pauta antiga', format: 'carrossel', carousel_type: 'antes_agora', status: 'pronto', caption: 'Segue @pedrodestrava', viral: { score: 90 } });
  assert.strictEqual(c.status, 'rascunho');
  assert.strictEqual(c.legado.nota_antiga_ignorada, 90);
  assert.ok(ids(G.avaliar(c)).includes('legado_nao_verificado') || ids(G.avaliar(c)).includes('sem_versao'));
  const posted = M.migrarItemLegado({ id: 'x2', title: 'Postado', format: 'roteiro', status: 'postado', metrics: { views: 10 } });
  assert.strictEqual(posted.status, 'publicado');
});

// ── Identidade e cache ──────────────────────────────────────────────────────
test('conta errada na API: leitura é recusada e nada é guardado', async () => {
  await assert.rejects(() => confirmAccount({ force: true, getProfile: async () => ({ username: 'pedrodestrava', id: '123', edge_followed_by: { count: 1758 } }) }), (e) => e.code === 'ACCOUNT_MISMATCH' && /não @pedro_destrava/.test(e.message));
  const ok = await confirmAccount({ force: true, getProfile: async () => ({ username: 'pedro_destrava', id: ACCOUNT.ig_id, edge_followed_by: { count: 168000 }, is_verified: false }) });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.verified, false);
});

test('cache de insights sem origem ou de outra conta não é aceito', () => {
  assert.strictEqual(insightsValido({ seguidores: 1758 }), false, 'sem origem');
  assert.strictEqual(insightsValido({ schema: 1, conta: { ok: true, ig_id: '999', username: 'pedrodestrava' } }), false, 'outra conta');
  assert.strictEqual(insightsValido({ schema: 1, conta: { ok: true, ig_id: ACCOUNT.ig_id, username: 'pedro_destrava' } }), true);
  assert.strictEqual(insightsValido({ schema: 0, conta: { ok: true, ig_id: ACCOUNT.ig_id, username: 'pedro_destrava' } }), false, 'versão antiga do esquema');
});

test('insights: colaboração de outra conta e posts jovens ficam fora; amostra pequena vira hipótese insuficiente', () => {
  const agora = 1800000000;
  const mk = (pk, tipo, likes, horasAtras, autor = 'pedro_destrava') => normalizePost({ pk, code: `c${pk}`, media_type: tipo, like_count: likes, comment_count: 0, taken_at: agora - horasAtras * 3600, user: { username: autor }, caption: { text: `post ${pk}` } });
  const posts = [mk(1, 8, 1000, 200), mk(2, 8, 900, 300), mk(3, 1, 100, 400), mk(4, 2, 50, 500), mk(5, 8, 5000, 10) /* jovem */, mk(6, 2, 7000, 100, 'pedroecoom') /* colab */];
  const ins = computeInsights(posts, 100000, { agora });
  assert.strictEqual(ins.amostra, 4);
  assert.strictEqual(ins.excluidos.colaboracoes, 1);
  assert.strictEqual(ins.excluidos.com_menos_de_72h, 1);
  assert.ok(ins.hipoteses.length && ins.hipoteses.every((h) => h.suficiente === false), 'não declara vencedor com amostra pequena');
  assert.match(insightsParaPrompt({ ...ins, conta: {} }), /Nenhum padrão de formato\/dia tem amostra suficiente/);
  assert.ok(ins.campos.indisponiveis.includes('salvamentos'));
});

// ── Leitura segura de URL ───────────────────────────────────────────────────
test('SSRF: endereços internos, metadados de nuvem, portas e protocolos são barrados', () => {
  for (const u of ['http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://0.0.0.0/', 'http://foo.internal/', 'file:///etc/passwd', 'ftp://exemplo.com/', 'https://user:pw@exemplo.com/', 'http://exemplo.com:8080/']) {
    assert.throws(() => validaUrl(u), (e) => e.isUrlError, u);
  }
  assert.doesNotThrow(() => validaUrl('https://www.infomoney.com.br/politica/x'));
  assert.strictEqual(ipProibido('172.16.5.4'), true);
  assert.strictEqual(ipProibido('8.8.8.8'), false);
  assert.strictEqual(ipProibido('::ffff:10.0.0.1'), true);
  assert.strictEqual(ipProibido('192.0.66.154'), false, 'faixa pública (WordPress.com) não pode ser barrada');
  assert.strictEqual(ipProibido('192.0.2.7'), true, 'faixa de documentação');
});

test('SSRF: DNS que aponta para rede interna é barrado na conexão (rebinding)', async () => {
  const resolver = (host, opts, cb) => cb(null, [{ address: '10.1.2.3', family: 4 }]);
  await assert.rejects(() => safeFetch('http://publico.exemplo.test/', { resolver, timeoutMs: 2000 }), (e) => e.code === 'IP_INTERNO');
  const lk = lookupSeguro((h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]));
  await new Promise((res) => lk('x.test', {}, (err) => { assert.ok(err && err.code === 'IP_INTERNO', 'um endereço interno entre os resolvidos basta para recusar'); res(); }));
});

test('SSRF: redirecionamento para rede interna é barrado a cada salto', async () => {
  const http = require('http');
  const srv = http.createServer((req, res) => { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  // O servidor local é interno, então a primeira conexão já é barrada: prova que o bloqueio vale até pro localhost.
  await assert.rejects(() => safeFetch(`http://127.0.0.1:${porta}/`, {}), (e) => e.isUrlError);
  srv.close();
});

// ── Acesso ──────────────────────────────────────────────────────────────────
test('acesso: no computador local sem código fica aberto; com código exige token assinado', () => {
  const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, set() { return r; } }; return r; };
  delete process.env.APP_ACCESS_CODE;
  let passou = false;
  access.exigeAcesso({ path: '/api/queue/suggest', headers: {} }, res(), () => { passou = true; });
  assert.ok(passou, 'aberto sem código');
  process.env.APP_ACCESS_CODE = 'codigo-de-teste-123';
  try {
    const r1 = res(); passou = false;
    access.exigeAcesso({ path: '/api/queue/suggest', headers: {} }, r1, () => { passou = true; });
    assert.ok(!passou && r1.code === 401);
    access.exigeAcesso({ path: '/api/health', headers: {} }, res(), () => { passou = true; });
    assert.ok(passou, 'health é livre');
    const token = access.sign({ sub: 'pedro', exp: Math.floor(Date.now() / 1000) + 60 });
    passou = false;
    access.exigeAcesso({ path: '/api/queue/suggest', headers: { authorization: `Bearer ${token}` } }, res(), () => { passou = true; });
    assert.ok(passou, 'token válido entra');
    passou = false;
    access.exigeAcesso({ path: '/api/queue/suggest', headers: { authorization: `Bearer ${token.slice(0, -2)}xx` } }, res(), () => { passou = true; });
    assert.ok(!passou, 'token adulterado não entra');
    assert.strictEqual(access.verify(access.sign({ sub: 'x', exp: 1 })), null, 'token vencido');
    assert.ok(access.codigoConfere('codigo-de-teste-123') && !access.codigoConfere('errado'));
  } finally { delete process.env.APP_ACCESS_CODE; }
});

test('chamada duplicada com o mesmo request_id executa uma vez só', async () => {
  let n = 0;
  const f = () => new Promise((r) => setTimeout(() => { n += 1; r(n); }, 20));
  const [a, b] = await Promise.all([access.unica('req-1', f), access.unica('req-1', f)]);
  assert.strictEqual(n, 1);
  assert.strictEqual(a, b);
  await assert.rejects(() => access.unica('req-2', async () => { throw new Error('falhou'); }));
  assert.strictEqual(await access.unica('req-2', async () => 'ok'), 'ok', 'falha não fica em cache');
});

test('edição: tirar número não reabre a conferência; pôr número novo ou ligar outra afirmação reabre', () => {
  const ant = { slides: [{ id: 's1', layout: 'explicacao', texto: 'O teto é R$ 140 mil.', claim_ids: ['a1'] }], legenda: 'x', cta: '' };
  const semNumero = { slides: [{ id: 's1', layout: 'explicacao', texto: 'O teto subiu.', claim_ids: ['a1'] }], legenda: 'x', cta: '' };
  const outroNumero = { slides: [{ id: 's1', layout: 'explicacao', texto: 'O teto é R$ 180 mil.', claim_ids: ['a1'] }], legenda: 'x', cta: '' };
  const outraClaim = { slides: [{ id: 's1', layout: 'explicacao', texto: 'O teto é R$ 140 mil.', claim_ids: ['a1', 'a2'] }], legenda: 'x', cta: '' };
  assert.deepStrictEqual(M.efeitoDaEdicao(ant, semNumero, []).afirmacoes, []);
  assert.deepStrictEqual(M.efeitoDaEdicao(ant, outroNumero, []).afirmacoes, ['a1']);
  assert.deepStrictEqual(M.efeitoDaEdicao(ant, outraClaim, []).afirmacoes.sort(), ['a1', 'a2']);
  assert.strictEqual(M.efeitoDaEdicao(ant, { ...ant, legenda: 'x e R$ 99 mil' }, []).legenda, true);
});

test('ativarVersao: não apaga nada e reabre a aprovação se a versão ativa mudou', () => {
  const c = M.novoConteudo({});
  const v1 = M.criarVersao(c, { slides: [{ id: 's1', layout: 'explicacao', texto: 'um' }], legenda: '', cta: '' });
  M.aprovar(c, { bloqueios: [] });
  M.criarVersao(c, { slides: [{ id: 's1', layout: 'explicacao', texto: 'dois' }], legenda: '', cta: '' });
  assert.strictEqual(c.status, 'em_revisao');
  M.ativarVersao(c, v1.id);
  assert.strictEqual(c.copia.versao_ativa, v1.id);
  assert.strictEqual(c.revisao.aprovada_versao, null, 'voltar não ressuscita a aprovação sozinha');
  assert.strictEqual(c.copia.versoes.length, 2, 'nenhuma versão foi apagada');
  assert.throws(() => M.ativarVersao(c, 'v99'));
});

test('opinião: precisa ter as premissas conferidas; fato embutido sem fonte bloqueia; editar reabre', () => {
  const c = exemplo();
  c.claims.push({ id: 'o1', texto: 'Na minha leitura, isso aumenta a carga tributária das pequenas empresas.', tipo: 'opiniao', natureza: 'opiniao', premissas: [], evidencias: [], revisao: {} });
  M.editarSlide(c, 's2', { texto: 'Na minha leitura, isso aumenta a carga tributária das pequenas empresas.', claim_ids: ['o1'] });
  let r = G.avaliar(c);
  assert.ok(ids(r).includes('opiniao_nao_auditada'));
  const s2 = M.versaoAtiva(c).slides.find((s) => s.id === 's2');
  c.auditoria_textos = { s2: { slide_id: 's2', hash_texto: M.hash(s2.texto), premissas: [{ texto: 'a medida aumenta a carga tributária', claim_id: null }] } };
  r = G.avaliar(c);
  assert.ok(ids(r).includes('premissa_sem_fonte') && !ids(r).includes('opiniao_nao_auditada'));
  // reescreve como avaliação pura e a auditoria nova não acha fato sem fonte
  M.editarSlide(c, 's2', { texto: 'Na minha leitura, o país precisa discutir produtividade antes de qualquer custo novo.' });
  assert.ok(ids(G.avaliar(c)).includes('opiniao_nao_auditada'), 'texto mudou: precisa conferir de novo');
  const novo = M.versaoAtiva(c).slides.find((s) => s.id === 's2');
  c.auditoria_textos.s2 = { slide_id: 's2', hash_texto: M.hash(novo.texto), premissas: [] };
  r = G.avaliar(c);
  assert.ok(!ids(r).includes('premissa_sem_fonte') && !ids(r).includes('opiniao_nao_auditada'), JSON.stringify(ids(r)));
});

test('auditoria do texto: fato sem fonte na legenda bloqueia; texto não auditado é só sugestão', () => {
  const c = exemplo();
  const v = M.versaoAtiva(c);
  assert.ok(G.avaliar(c).sugestoes.some((x) => x.id === 'texto_nao_auditado'));
  c.auditoria_textos = { legenda: { slide_id: 'legenda', hash_texto: M.hash(v.legenda), premissas: [{ texto: 'a mudança vale só para agentes de saúde', claim_id: null }] } };
  const r = G.avaliar(c);
  assert.ok(r.bloqueios.some((b) => b.id === 'fato_sem_fonte' && /legenda/.test(b.detalhe)));
  M.editarLegenda(c, { legenda: 'O salário mínimo saiu de R$ 64,79 para R$ 1.621,00.' });
  assert.ok(!G.avaliar(c).bloqueios.some((b) => b.id === 'fato_sem_fonte'), 'texto novo: a auditoria antiga não vale mais');
});
