// Painel de audiência: pesos reais, notas ponderadas, escolha de capa, calibração e encaixe no pipeline (IA simulada).
// node --test backend/lib/painel/painel.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('../armazem');
const PN = require('./index');
const T = require('../top/pipeline');
const M = require('../../../static/contentModel');
const { ACCOUNT } = require('../account');

const RETRATO = { seguidores: 164000, demografia: {
  age: [{ k: '13-17', v: 5255 }, { k: '18-24', v: 28620 }, { k: '25-34', v: 64031 }, { k: '35-44', v: 38469 }, { k: '45-54', v: 17366 }, { k: '55-64', v: 6922 }, { k: '65+', v: 4126 }],
  gender: [{ k: 'F', v: 31121 }, { k: 'M', v: 117037 }, { k: 'U', v: 16631 }], city: [{ k: 'São Paulo, São Paulo (state)', v: 7436 }] },
  comentarios: [{ t: 'Cadê a vitória fácil no dia 25?', c: 0 }], melhores: [{ legenda: 'pense nisso', curtidas: 5779, comentarios: 364 }], piores: [{ legenda: 'x', curtidas: 3, comentarios: 0 }], avisos: [] };
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));

test('quotas: 1.000 membros, base pela demografia real (18+), alvo 30% em 14 perfis de empreendedor, base por idade × gênero × região', () => {
  const q = PN.quotas(RETRATO, { alvo_peso: 0.3 });
  assert.strictEqual(q.reduce((s, p) => s + p.membros, 0), 1000);
  assert.strictEqual(q.filter((p) => p.grupo === 'alvo').reduce((s, p) => s + p.membros, 0), 300);
  assert.ok(!q.some((p) => p.id.includes('13-17')), 'menores de 18 ficam de fora');
  const m2534 = q.find((p) => p.id === 'b_25-34_M_SE').membros; const f18 = q.find((p) => p.id === 'b_18-24_F_SE').membros;
  assert.ok(m2534 > f18 * 3, 'homem 25-34 pesa bem mais que mulher 18-24, como nos dados');
  assert.strictEqual(q.filter((p) => p.grupo === 'alvo').length, 14);
  const d2 = { ...RETRATO, demografia: { ...RETRATO.demografia, city: [{ k: 'São Paulo, São Paulo (state)', v: 600 }, { k: 'Curitiba, Paraná (state)', v: 400 }] } };
  const q2 = PN.quotas(d2, { alvo_peso: 0.3 }); assert.strictEqual(q2.length, 30); assert.strictEqual(q2.reduce((s, p) => s + p.membros, 0), 1000);
  assert.ok(q2.find((p) => p.id === 'b_25-34_M_SE').membros > q2.find((p) => p.id === 'b_25-34_M_RS').membros);
  assert.strictEqual(PN.quotas(RETRATO, { alvo_peso: 0 }).filter((p) => p.grupo === 'alvo').length, 0);
});

test('montar: pesos vêm dos dados; texto das personas vem da IA; fica guardado', async () => {
  novo();
  const ia = async ({ usuario }) => ({ dados: { personas: [...usuario.matchAll(/^([^\s|]+) \| (base|alvo)/gm)].map((m) => ({ id: m[1], quem: `Persona ${m[1]}`, dor: 'boleto', para_no_feed: 'número', compartilha_quando: 'indignado', ignora_quando: 'jargão' })) } });
  const d = await PN.montar({ ia, retrato: RETRATO });
  assert.strictEqual(d.total, 1000); assert.strictEqual(d.descritas, d.personas.length);
  assert.strictEqual((await PN.personasAtuais()).personas[0].dor, 'boleto');
});

test('avaliar: nota ponderada por peso, melhor capa, objeções dos maiores grupos; IA fraca não vira nota', async () => {
  novo(); await PN.montar({ ia: async () => ({ dados: { personas: [] } }), retrato: RETRATO });
  const doc = await PN.personasAtuais();
  const ia = async () => ({ dados: { vozes: doc.personas.map((p) => ({ id: p.id, capa: p.grupo === 'alvo' ? [3, 8, 4] : [5, 6, 5], interesse: p.grupo === 'alvo' ? 8 : 4, envio: p.grupo === 'alvo' ? 7 : 2, objecao: p.grupo === 'base' ? 'muito número' : '' })) } });
  const r = await PN.avaliar({ capas: ['A', 'B', 'C'], slides: ['um', 'dois'], legenda: 'l', tese: 't' }, { ia });
  assert.ok(r.ok); assert.strictEqual(r.membros, 1000); assert.strictEqual(r.melhor_capa, 1);
  assert.ok(r.nota_alvo > r.nota_base, 'o alvo (empreendedor) gostou mais que a base');
  assert.ok(r.nota > 0 && r.nota < 10); assert.strictEqual(r.objecoes[0].texto, 'muito número');
  const fraca = await PN.avaliar({ capas: ['A'], slides: [] }, { ia: async () => ({ dados: { vozes: [{ id: doc.personas[0].id, capa: [5], interesse: 5, envio: 5 }] } }) });
  assert.strictEqual(fraca.ok, false);
  const sem = await PN.avaliar({ capas: ['A'] }, { ia, personas: { personas: [] } }); assert.strictEqual(sem.ok, false);
});

test('spearman: ordem igual = 1, invertida = -1', () => {
  assert.strictEqual(PN.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.strictEqual(PN.spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
});

test('calibrar: poucos posts → avisa que ainda não dá para dizer se o painel acerta', async () => {
  novo();
  const r = await PN.calibrar({ grafo: async () => ({ like_count: 10, comments_count: 1, timestamp: '2026-10-01T00:00:00Z' }) });
  assert.strictEqual(r.n, 0); assert.strictEqual(r.confiavel, false); assert.match(r.leitura, /poucos posts/);
});

// ── no pipeline ──
const MATERIA = 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026, segundo o relatório divulgado nesta segunda-feira. Em dezembro de 2022, o mesmo índice era de 71,7%. O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta. Analistas ouvidos pela reportagem dizem que o patamar é o maior em cinco anos e que a conta recai sobre quem empreende, com juros mais altos para pequenas empresas.';
const FATOS = { protagonista: 'Fulano de Tal', fatos: [
  { id: 'a', texto: 'O índice chegou a 82,9% em agosto de 2026.', trecho: 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026', tipo: 'fato' },
  { id: 'b', texto: 'Em dezembro de 2022 o índice era de 71,7%.', trecho: 'Em dezembro de 2022, o mesmo índice era de 71,7%.', tipo: 'fato' },
  { id: 'c', texto: 'O ministro afirmou que a alta é temporária.', trecho: 'O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta.', tipo: 'declaracao', quem: 'Fulano de Tal' }] };
const ANGULO = { gatilhos: { contradicao: 3, bolso: 2, numero: 3, personagem: 2, empreendedor: 3 }, tese: 'Quem promete meta e entrega o maior patamar em cinco anos deve explicação a quem paga juros.', por_que_mandaria: 'Olha a diferença.', enviar_para: 'seu sócio', imagem: { pessoa_central: false } };
const roteiro = () => ({ capas: [{ texto: 'Prometeu meta. Entregou o **maior patamar** em cinco anos.', mecanismo: 'contradicao' }, { texto: 'De 71,7% para 82,9%: quem paga essa conta?', mecanismo: 'antes_depois' }, { texto: 'O número que o discurso não mostra', mecanismo: 'ninguem_contou' }],
  telas: [
    { papel: 'gap', layout: 'rep_manchete', titulo: 'O discurso é de controle', texto: 'O ministro diz que a alta é temporária. Os números contam outra história.', fatos: ['c'] },
    { papel: 'prova', layout: 'rep_comparacao', titulo: 'Índice de exemplo', texto: 'Comparação entre dezembro de 2022 e agosto de 2026.', dados: { esquerda: { rotulo: 'DEZ/2022', valor: '71,7%', unidade: 'do total' }, direita: { rotulo: 'AGO/2026', valor: '82,9%', unidade: 'do total' }, faixa: { valor: 'O maior patamar em cinco anos.' }, tom: 'alerta' }, fatos: ['a', 'b'] },
    { papel: 'contradicao', layout: 'rep_manchete', titulo: 'Quem paga é o pequeno', texto: 'Segundo os analistas, os juros sobem primeiro para as pequenas empresas.', fatos: [] },
    { papel: 'leitura', layout: 'rep_manchete', titulo: 'Minha leitura', texto: 'Meta sem resultado é promessa. E promessa não paga boleto de ninguém.', destaque: 'Cobrar resultado não é torcida.', fatos: ['a'] }],
  legenda: 'O índice saiu de 71,7% para 82,9%. O discurso fala em alta temporária; quem empreende sente nos juros.', hashtags: ['economia', 'juros', 'empreendedorismo'], cta_motivo: 'se você também cobra resultado', fechamento: { titulo: 'O resultado está nos números.', texto: 'Quem pede confiança precisa mostrar entrega, não discurso.' } });
const JURI = { versoes: [{ indice: 0, notas: {}, nota: 8.6, defeito: 'capa 2 longa' }, { indice: 1, notas: {}, nota: 8.1, defeito: '' }], vencedora: 0, capas_escolhidas: [0, 1] };
function iaFalsa(painelNota) {
  const chamadas = [];
  const pedirJson = async ({ sistema }) => {
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : /simula um painel/.test(sistema) ? 'painel' : /sala de redação/.test(sistema) ? 'sala' : 'roteiro';
    if (tipo === 'sala') { chamadas.push({ tipo, sistema }); return { dados: { capas: [{ mente: 'bernbach', texto: 'Eu também achava que **82,9%** era exagero.' }] }, llm: { provider: 'simulado' } }; }
    chamadas.push({ tipo, sistema });
    if (tipo === 'painel') return { dados: painelNota(chamadas.filter((c) => c.tipo === 'painel').length), llm: { provider: 'simulado' } };
    return { dados: JSON.parse(JSON.stringify(tipo === 'fatos' ? FATOS : tipo === 'angulo' ? ANGULO : tipo === 'juri' ? JURI : roteiro())), llm: { provider: 'simulado' } };
  };
  return { pedirJson, chamadas };
}
const sharp = require('sharp');
const deps = (ia) => ({ ...ia, lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/m', titulo: 'Índice de exemplo bate 82,9%', veiculo: 'Jornal Exemplo', publicada_em: '2026-10-27T12:00:00Z', texto: MATERIA, legivel: true }), fotoDe: async () => null, buscarFoto: async () => { throw new Error('sem'); } });

async function comPainel(votosPorChamada) {
  novo();
  await PN.montar({ ia: async () => ({ dados: { personas: [] } }), retrato: RETRATO });
  const doc = await PN.personasAtuais();
  const ia = iaFalsa((n) => ({ vozes: doc.personas.map((p) => ({ id: p.id, ...votosPorChamada(n, p) })) }));
  const c = await T.criar({ url: 'https://exemplo.test/m' });
  const r = await T.executarTudo(c.id, { deps: deps(ia) });
  return { r, ia, doc: (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id)).doc };
}

test('pipeline: o painel escolhe a melhor capa e a nota fica no carrossel', async () => {
  const { r, doc } = await comPainel(() => ({ capa: [4, 8, 5], interesse: 7, envio: 6, objecao: '' }));
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  assert.ok(doc.top.painel.nota >= 6 && doc.top.painel.membros === 1000);
  assert.strictEqual(doc.top.painel.melhor_capa, 1);
  assert.strictEqual(M.versaoAtiva(doc).slides[0].texto, 'De 71,7% para 82,9%: quem paga essa conta?', 'a capa B venceu no painel');
});

test('pipeline: nota baixa manda reescrever com as objeções; continuando baixa, descarta', async () => {
  const { r, ia } = await comPainel(() => ({ capa: [1, 1, 1], interesse: 1, envio: 0, objecao: 'parece notícia de jornal' }));
  assert.strictEqual(r.conteudo.top.estado, 'abaixo_da_regua');
  assert.match(r.conteudo.top.motivo, /painel de audiência/);
  assert.strictEqual(ia.chamadas.filter((c) => c.tipo === 'painel').length, 2, 'avaliou, mandou reescrever e avaliou de novo');
  assert.ok(ia.chamadas.some((c) => c.tipo === 'roteiro' && /parece notícia de jornal/.test(c.sistema)), 'o roteiro reescrito recebeu a objeção');
});

test('pipeline: sem painel montado ou painel desligado, a produção segue normal', async () => {
  novo();
  const ia = iaFalsa(() => ({ vozes: [] }));
  const c = await T.criar({ url: 'https://exemplo.test/m' });
  const r = await T.executarTudo(c.id, { deps: deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'concluida'); assert.strictEqual(r.conteudo.top.painel.ativo, false);
  assert.ok(!ia.chamadas.some((x) => x.tipo === 'painel'));
});

test('pipeline: cota da IA esgotada no painel espera a cota voltar (não segue sem a nota)', async () => {
  novo();
  await PN.montar({ ia: async () => ({ dados: { personas: [] } }), retrato: RETRATO });
  const doc = await PN.personasAtuais();
  const base = iaFalsa(() => ({ vozes: doc.personas.map((p) => ({ id: p.id, capa: [6, 6, 6], interesse: 6, envio: 6, objecao: '' })) }));
  const ia = { pedirJson: async (a) => { if (/simula um painel/.test(a.sistema)) throw Object.assign(new Error('429 status code (no body)'), { status: 429 }); return base.pedirJson(a); } };
  const c = await T.criar({ url: 'https://exemplo.test/m' });
  const r = await T.executarTudo(c.id, { deps: { ...deps(ia), provedoresFortes: () => ['gemini'], ultimoErro: () => ({ status: 429 }) }, maxMs: 15000 });
  const top = r.conteudo.top;
  assert.strictEqual(top.estado, 'em_andamento', 'não conclui sem passar pelo painel');
  assert.ok(top.adiar_ate && top.erros.some((e) => e.codigo === 'COTA_IA' && e.etapa === 'painel'));
  assert.ok(!top.painel || !top.painel.falhou);
});

test('pipeline: capa escrita por uma mente vence no painel e fica registrada', async () => {
  // capas na ordem avaliada: [júri 0, júri 1, capa da mente] -> a última recebe a maior nota
  const { r, doc } = await comPainel(() => ({ capa: [3, 3, 9], interesse: 7, envio: 6, objecao: '' }));
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  assert.strictEqual(doc.top.mentes.capa, 'bernbach');
  assert.match(M.versaoAtiva(doc).slides[0].texto, /Eu também achava/);
});
