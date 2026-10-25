// Teto de gasto com imagem: por carrossel e por mês, reserva antes da chamada, registro depois, sem gastar quando recusa.
// node --test backend/lib/orcamentoImagem.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const O = require('./orcamentoImagem');
const I = require('./imagemOpenAI');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('x')]);
const duravel = () => Object.assign(arm.memoria(), { duravel: true });
const gerador = (custo = 0.05, contagem = { n: 0 }) => async () => { contagem.n++; return { png: PNG, custo_usd: custo, modelo: 'gpt-image-1.5' }; };
const amb = { IMAGEM_TETO_CARROSSEL_USD: '0.12', IMAGEM_TETO_MES_USD: '0.30', IMAGEM_OPENAI_LIGADA: '1' };
function comAmbiente(vars, fn) {
  const antes = {}; for (const k of Object.keys(vars)) { antes[k] = process.env[k]; process.env[k] = vars[k]; }
  O._zerar();
  const volta = () => { for (const k of Object.keys(vars)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } };
  return Promise.resolve().then(fn).finally(volta);
}
const deps = (extra = {}) => ({ armazem: duravel(), ligada: () => true, chave: 'sk-falsa', gerarFundo: gerador(), ...extra });

test('limites padrão e leitura do ambiente', async () => {
  await comAmbiente({ IMAGEM_TETO_CARROSSEL_USD: '', IMAGEM_TETO_MES_USD: 'abc' }, () => assert.deepStrictEqual(O.limites(), { carrossel: 2, mes: 10 }));
  await comAmbiente({ IMAGEM_TETO_CARROSSEL_USD: '1,5', IMAGEM_TETO_MES_USD: '7' }, () => assert.deepStrictEqual(O.limites(), { carrossel: 1.5, mes: 7 }));
});

test('mês no fuso de São Paulo (virada de mês às 21h de 31/10 no UTC-3)', () => {
  assert.strictEqual(O.mesSP(Date.parse('2026-11-01T01:30:00Z')), '2026-10');
  assert.strictEqual(O.mesSP(Date.parse('2026-11-01T03:30:00Z')), '2026-11');
});

test('gera, registra e acumula por carrossel até o teto; o que estoura nem chama a API', async () => {
  await comAmbiente(amb, async () => {
    const d = deps(); const c = { n: 0 }; d.gerarFundo = gerador(0.05, c);
    const r1 = await O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d });
    assert.ok(r1.png.equals(PNG)); assert.strictEqual(r1.custo_usd, 0.05);
    await O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d });
    // 0,10 gasto + 0,05 pedido > 0,12
    await assert.rejects(O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d }), (e) => e instanceof I.ImagemTeto && e.detalhe.tipo === 'carrossel' && e.detalhe.gasto === 0.1);
    assert.strictEqual(c.n, 2, 'a terceira chamada não aconteceu');
    const r = await O.resumo(d);
    assert.strictEqual(r.gasto_mes, 0.1); assert.strictEqual(r.teto_mes, 0.3); assert.strictEqual(r.restante_mes, 0.2); assert.strictEqual(r.guardado_no_banco, true);
  });
});

test('teto do mês vale entre carrosséis diferentes', async () => {
  await comAmbiente({ ...amb, IMAGEM_TETO_CARROSSEL_USD: '1', IMAGEM_TETO_MES_USD: '0.12' }, async () => {
    const d = deps();
    await O.fundoComTeto({ conteudo_id: 'a', prompt: 'p', deps: d });
    await O.fundoComTeto({ conteudo_id: 'b', prompt: 'p', deps: d });
    await assert.rejects(O.fundoComTeto({ conteudo_id: 'c', prompt: 'p', deps: d }), (e) => e instanceof I.ImagemTeto && e.detalhe.tipo === 'mes');
  });
});

test('o gasto persiste no armazém (chave imagem_gasto:YYYY-MM) e outro processo o enxerga', async () => {
  await comAmbiente(amb, async () => {
    const a = duravel();
    await O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: deps({ armazem: a }) });
    const cfg = await a.config.obter(require('./account').ACCOUNT.ig_id);
    const chave = Object.keys(cfg).find((k) => k.startsWith('imagem_gasto:'));
    assert.match(chave, /^imagem_gasto:\d{4}-\d{2}$/);
    assert.strictEqual(cfg[chave].total, 0.05); assert.strictEqual(cfg[chave].por_conteudo.c1, 0.05);
    O._zerar();   // "outro processo": sem reservas nem memória, só o armazém
    assert.strictEqual((await O.resumo({ armazem: a })).gasto_mes, 0.05);
  });
});

test('recusa e falha liberam a reserva e não contam gasto', async () => {
  await comAmbiente(amb, async () => {
    const a = duravel();
    await assert.rejects(O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: deps({ armazem: a, gerarFundo: async () => { throw new I.ImagemRecusada(); } }) }), I.ImagemRecusada);
    await assert.rejects(O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: deps({ armazem: a, gerarFundo: async () => { throw new I.ImagemFalhou('x'); } }) }), I.ImagemFalhou);
    assert.strictEqual((await O.resumo({ armazem: a })).gasto_mes, 0);
    await O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: deps({ armazem: a }) });   // ainda cabe
  });
});

test('chamadas simultâneas respeitam o teto (reserva em andamento conta)', async () => {
  await comAmbiente({ ...amb, IMAGEM_TETO_CARROSSEL_USD: '0.11' }, async () => {
    const d = deps(); const c = { n: 0 };
    d.gerarFundo = async () => { c.n++; await new Promise((r) => setTimeout(r, 15)); return { png: PNG, custo_usd: 0.05 }; };
    const r = await Promise.allSettled([1, 2, 3].map(() => O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d })));
    assert.strictEqual(r.filter((x) => x.status === 'fulfilled').length, 2);
    assert.strictEqual(c.n, 2);
  });
});

test('desligado por padrão e sem chave: erros tipados, nenhuma chamada', async () => {
  await comAmbiente({ IMAGEM_OPENAI_LIGADA: '' }, async () => {
    const c = { n: 0 };
    await assert.rejects(O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: { gerarFundo: gerador(0.05, c), chave: 'sk-falsa' } }), I.ImagemDesligada);
    const antes = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    try { await assert.rejects(O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: { ligada: () => true, gerarFundo: gerador(0.05, c), armazem: null } }), I.ImagemSemChave); }
    finally { if (antes !== undefined) process.env.OPENAI_API_KEY = antes; }
    assert.strictEqual(c.n, 0);
  });
});

test('sem banco o teto vale na memória do processo', async () => {
  await comAmbiente(amb, async () => {
    const d = { ligada: () => true, chave: 'sk-falsa', armazem: null, gerarFundo: gerador(0.05) };
    await O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d });
    await O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d });
    await assert.rejects(O.fundoComTeto({ conteudo_id: 'c1', prompt: 'p', deps: d }), I.ImagemTeto);
    const r = await O.resumo(d); assert.strictEqual(r.guardado_no_banco, false); assert.strictEqual(r.gasto_mes, 0.1);
  });
});
