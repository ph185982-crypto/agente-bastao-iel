// Biblioteca de recortes e gate dos números dos slides de dados.
// node --test backend/lib/recortes.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const arm = require('./armazem');
const R = require('./recortes');
const M = require('../../static/contentModel');
const G = require('../../static/qualityGates');

const duravel = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const semBanco = () => arm._definir(arm.memoria());
// Silhueta SINTÉTICA com transparência (nada a ver com pessoa real).
const png = (alpha = true, lado = 800) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}"><ellipse cx="${lado / 2}" cy="${lado * 0.4}" rx="${lado * 0.2}" ry="${lado * 0.28}" fill="#999"/>${alpha ? '' : `<rect width="${lado}" height="${lado}" fill="#456"/>`}</svg>`)).png().toBuffer();
const base = { nome: 'Pessoa Exemplo', credito: 'Fotógrafo Exemplo', licenca: 'CC BY 3.0 BR' };

test('recorte válido entra, volta na lista e pode ser lido', async () => {
  duravel();
  const reg = await R.adicionar({ ...base, png: await png() });
  assert.match(reg.id, /^[a-f0-9]{12}$/);
  const l = await R.listar();
  assert.strictEqual(l.guardado, true);
  assert.strictEqual(l.recortes.length, 1);
  assert.ok((await R.obter(reg.id)).length > 100);
});

test('exige fundo transparente, crédito, licença e tamanho mínimo', async () => {
  duravel();
  await assert.rejects(R.adicionar({ ...base, png: await png(false) }), /transparente/);
  await assert.rejects(R.adicionar({ ...base, credito: '', png: await png() }), /crédito/i);
  await assert.rejects(R.adicionar({ ...base, licenca: '', png: await png() }), /licença/i);
  await assert.rejects(R.adicionar({ ...base, png: await png(true, 300) }), /pequeno/);
  await assert.rejects(R.adicionar({ ...base, png: Buffer.from('não é imagem') }), /imagem válida/);
  await assert.rejects(R.adicionar({ ...base, nome: 'x', png: await png() }), /nome/i);
});

test('sem banco de dados no servidor os recortes não são aceitos', async () => {
  semBanco();
  assert.deepStrictEqual(await R.listar(), { guardado: false, recortes: [] });
  await assert.rejects(R.adicionar({ ...base, png: await png() }), /banco de dados/);
});

test('escolhe pelo nome citado na pauta, em palavras inteiras, sem acento', async () => {
  duravel();
  const a = await R.adicionar({ ...base, nome: 'João Exemplo', png: await png() });
  await R.adicionar({ ...base, nome: 'Maria Teste', png: await png(true, 900) }); // imagem diferente: o id vem do conteúdo
  const c = M.novoConteudo({ titulo: 'Joao Exemplo anuncia medida', origem: { tipo: 'link', url: 'https://x.test/a' } });
  c.claims = [{ id: 'a1', texto: 'Mariana Teste não é a mesma pessoa.' }];
  const r = await R.escolherPara(c);
  assert.deepStrictEqual(r.map((x) => x.id), [a.id]);
  const nenhum = M.novoConteudo({ titulo: 'Assunto sem ninguém', origem: { tipo: 'link', url: 'https://x.test/b' } });
  assert.deepStrictEqual(await R.escolherPara(nenhum), []);
});

test('remover tira do índice e a pessoa deixa de ser escolhida', async () => {
  duravel();
  const a = await R.adicionar({ ...base, png: await png() });
  await R.remover(a.id);
  assert.strictEqual((await R.listar()).recortes.length, 0);
});

// ── números dos slides de dados passam pelos mesmos gates dos textos ─────────────────────
function conteudoComDados(dados) {
  const c = M.novoConteudo({ titulo: 'FIXTURE: dados', origem: { tipo: 'link', url: 'https://exemplo.test/m' } });
  c.fonte_principal = { url: 'https://exemplo.test/m', titulo: 'Fixture', origem: 'Exemplo', texto: 'Texto da fonte.' };
  c.claims = [{ id: 'a1', texto: 'O indicador foi de 10 mil em 2022 e de 20 mil em 2026.', tipo: 'fato', central: true, estado: 'sustentada', evidencias: ['e1'], valores: [{ valor: 10000, unidade: 'un' }, { valor: 20000, unidade: 'un' }] }];
  c.evidencias = [{ id: 'e1', tipo: 'primaria', trecho: 'O indicador foi de 10 mil em 2022 e de 20 mil em 2026.', origem: 'Fonte', relacao: 'sustenta' }];
  M.criarVersao(c, { estrutura: 'acontecimento', capa_escolhida: null, capas: [], slides: [
    { id: 's1', funcao: 'capa', layout: 'capa_tipografica', texto: 'Indicador de exemplo dobra', claim_ids: ['a1'] },
    { id: 's2', funcao: 'comparacao', layout: 'comparacao', texto: 'Comparação de exemplo.', dados, claim_ids: ['a1'], fonte_linha: 'Fonte: Exemplo' },
  ], legenda: 'Segundo a fonte, o indicador mudou.', legenda_claim_ids: ['a1'], cta: 'Segue o @pedro_destrava para acompanhar', hashtags: [] }, { quem: 'sistema' });
  return c;
}
const ids = (c) => G.bloqueios(c, {}).map((b) => b.id);
const dadosOk = { esquerda: { rotulo: '2022', valor: '10 mil', unidade: 'itens' }, direita: { rotulo: '2026', valor: '20 mil', unidade: 'itens' }, faixa: { valor: '+100%', texto: 'no período' }, tom: 'neutro' };

test('números dos dados que batem com a fonte, e a variação calculada, não bloqueiam', () => {
  assert.ok(!ids(conteudoComDados(dadosOk)).some((i) => /numero_sem_origem|numero_sem_afirmacao/.test(i)), JSON.stringify(ids(conteudoComDados(dadosOk))));
});

test('número inventado no slide de dados bloqueia', () => {
  const ruim = { ...dadosOk, direita: { rotulo: '2026', valor: '25 mil', unidade: 'itens' } };
  assert.ok(ids(conteudoComDados(ruim)).includes('numero_sem_origem'));
});

test('variação percentual que não é a calculada bloqueia', () => {
  const ruim = { ...dadosOk, faixa: { valor: '+150%', texto: 'no período' } };
  assert.ok(ids(conteudoComDados(ruim)).includes('numero_sem_origem'));
});

// ── Trava de publicação com acesso aberto em produção ───────────────────────────────────
test('publicar é bloqueado em produção com APP_ACCESS_MODE=public, e liberado com código de acesso', () => {
  const P = require('./publicador');
  const antes = { v: process.env.VERCEL, m: process.env.APP_ACCESS_MODE, c: process.env.APP_ACCESS_CODE };
  try {
    process.env.VERCEL = '1'; process.env.APP_ACCESS_MODE = 'public'; delete process.env.APP_ACCESS_CODE;
    assert.throws(() => P.exigirAcessoProtegido(), (e) => e.code === 'ACESSO_ABERTO' && e.status === 403);
    process.env.APP_ACCESS_CODE = 'codigo-de-teste-com-mais-de-10'; delete process.env.APP_ACCESS_MODE;
    assert.doesNotThrow(() => P.exigirAcessoProtegido());
    delete process.env.VERCEL; process.env.APP_ACCESS_MODE = 'public';
    assert.doesNotThrow(() => P.exigirAcessoProtegido(), 'no computador do desenvolvedor o modo aberto segue permitido');
  } finally {
    for (const [k, v] of [['VERCEL', antes.v], ['APP_ACCESS_MODE', antes.m], ['APP_ACCESS_CODE', antes.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
