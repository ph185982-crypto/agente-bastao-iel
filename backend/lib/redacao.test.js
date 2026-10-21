// Briefing e copy com IA SIMULADA. node --test backend/lib/redacao.test.js
const test = require('node:test');
const assert = require('node:assert');
const llmReal = require('./llmJson');
const { gerarBriefing, gerarCopia } = require('./redacao');

const fonte = { titulo: 'Senado aprova teto do MEI', veiculo: 'Jornal X', publicada_em: '2026-10-15T15:03:00Z', texto: 'O Senado aprovou o teto de R$ 140 mil para o MEI.' };
const ev = (id, rel = 'sustenta') => ({ id, origem: 'Jornal X', relacao: rel, grupo: 'g0', via: 'artigo', tipo: 'secundaria', url: 'https://jornalx.com.br/mei', trecho: 'x' });
const claims = [
  { id: 'a1', texto: 'O Senado aprovou o teto de R$ 140 mil para o MEI.', tipo: 'fato', central: true, estado: 'sustentada', valores: [{ valor: 140000, unidade: 'BRL', periodo: '' }], evidencias: ['e1'], revisao: {} },
  { id: 'a2', texto: 'O texto prevê parcelamento em 120 meses.', tipo: 'fato', central: false, estado: 'nao_verificada', motivo_estado: 'fonte única', valores: [{ valor: 120, unidade: 'meses', periodo: '' }], evidencias: ['e2'], revisao: {} },
];
const evidencias = [ev('e1'), ev('e2')];
const llmFalso = (respostas) => { let i = 0; const chamadas = []; return { chamadas, ...llmReal, pedirJson: async (p) => { chamadas.push(p.usuario); return { dados: respostas[Math.min(i++, respostas.length - 1)], llm: { provider: 'teste', model: 'falso' } }; } }; };

test('briefing: só fatos sustentados entram em fatos_disponiveis; dúvidas vêm do código', async () => {
  const llm = llmFalso([{ assunto: 'Teto do MEI', objetivo: 'autoridade', tese: 'Mais espaço para crescer', tese_tipo: 'opiniao', fatos_disponiveis: ['a1', 'a2', 'zzz'], estrutura: 'acontecimento', formato: 'reels', duvidas: [] }]);
  const { briefing } = await gerarBriefing({ fonte, claims, evidencias }, { llmJson: llm });
  assert.deepStrictEqual(briefing.fatos_disponiveis, ['a1']);
  assert.ok(briefing.duvidas.some((d) => /120 meses/.test(d) && /não verificada/.test(d)));
  assert.strictEqual(briefing.formato, 'carrossel', 'formato fora do suportado volta ao padrão');
  assert.ok(!('nota' in briefing) && !('score' in briefing));
});

const copiaOk = (cap = 'Senado aprova teto de R$ 140 mil para o MEI') => ({
  estrutura: 'acontecimento',
  capas: [
    { foco: 'acontecimento', texto: cap, explicacao: 'fato direto', claim_ids: ['a1'] },
    { foco: 'consequencia', texto: 'Se você é MEI, pode faturar mais sem trocar de regime', explicacao: 'efeito prático', claim_ids: ['a1'] },
    { foco: 'tensao', texto: 'O teto subiu. Mas o que muda de verdade?', explicacao: 'pergunta', claim_ids: [] },
  ],
  slides: [
    { funcao: 'capa', texto: cap, claim_ids: ['a1'] },
    { funcao: 'prova', texto: 'O Senado aprovou o teto de **R$ 140 mil**.', claim_ids: ['a1'] },
    { funcao: 'opiniao', texto: 'Na minha leitura, é um alívio para quem estava no limite.', opiniao: true, claim_ids: ['a1'] },
    { funcao: 'explicacao', texto: 'O texto segue para sanção.', claim_ids: [] },
  ],
  legenda: 'Segundo o Jornal X, o Senado aprovou o novo teto.', legenda_claim_ids: ['a1'], cta: 'Comente MEI', hashtags: ['#mei', 'invalida'],
});

test('copy: 3 capas, capa não escolhida, opinião vira claim, linha de fonte do registro', async () => {
  const r = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llmFalso([copiaOk()]) });
  assert.strictEqual(r.versao.capas.length, 3);
  assert.strictEqual(r.versao.capa_escolhida, null);
  assert.strictEqual(r.opinioes.length, 1);
  assert.strictEqual(r.opinioes[0].tipo, 'opiniao');
  assert.deepStrictEqual(r.opinioes[0].premissas, ['a1']);
  const prova = r.versao.slides.find((s) => s.layout === 'prova');
  assert.ok(/Jornal X/.test(prova.fonte_linha || ''), 'fonte_linha vem do registro');
  assert.deepStrictEqual(r.versao.hashtags, ['#mei']);
  assert.strictEqual(r.versao.slides.at(-1).layout, 'encerramento');
  assert.strictEqual(r.bloqueios_de_fatos.length, 0);
});

test('copy: número inventado dispara uma segunda tentativa com o erro exato', async () => {
  const ruim = copiaOk();
  ruim.slides[1].texto = 'O Senado aprovou o teto de **R$ 180 mil**.';
  const llm = llmFalso([ruim, copiaOk()]);
  const r = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llm });
  assert.strictEqual(r.tentativas, 2);
  assert.ok(/180/.test(llm.chamadas[1]), 'o feedback cita o número problemático');
  assert.strictEqual(r.bloqueios_de_fatos.length, 0);
});

test('copy: se a segunda tentativa também falha, o bloqueio continua visível', async () => {
  const ruim = copiaOk();
  ruim.slides[1].texto = 'O Senado aprovou o teto de **R$ 180 mil**.';
  const r = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llmFalso([ruim, ruim]) });
  assert.ok(r.bloqueios_de_fatos.length > 0);
});

test('copy: claim_ids inexistentes são descartados e capa faltante é apontada', async () => {
  const d = copiaOk(); d.slides[1].claim_ids = ['a1', 'fantasma']; d.capas = d.capas.slice(0, 2);
  const r = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llmFalso([d, d]) });
  assert.ok(!r.versao.slides[1].claim_ids.includes('fantasma'));
  assert.ok(r.problemas_de_forma.some((p) => /tensao/.test(p)));
});

test('copy: texto público que fala do sistema de checagem é devolvido para reescrita', async () => {
  const meta = copiaOk();
  meta.slides[3].texto = 'As informações ainda são apenas parcialmente sustentadas por uma única fonte.';
  const llm = llmFalso([meta, copiaOk()]);
  const r = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llm });
  assert.strictEqual(r.tentativas, 2);
  assert.ok(/sistema de checagem/.test(llm.chamadas[1]));
  assert.ok(!r.versao.slides.some((s) => /parcialmente sustentad/.test(s.texto)));
});

test('copy: marcadores de citação do modelo são limpos; "parcialmente confirmado" e CTA de uma palavra voltam para correção', async () => {
  const d = copiaOk();
  d.slides[1].texto = 'O Senado aprovou o teto de **R$ 140 mil**【a1】.';
  d.slides[3].texto = 'O texto segue para sanção (parcialmente confirmado).';
  d.cta = 'salvar';
  const llm = llmFalso([d, copiaOk()]);
  const r1 = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llmFalso([d, d]) });
  assert.ok(!r1.versao.slides.some((s) => /【/.test(s.texto)), 'marcador removido');
  assert.ok(r1.problemas_de_forma.some((p) => /checagem/.test(p)));
  assert.ok(r1.problemas_de_forma.some((p) => /chamada final/.test(p)));
  const r2 = await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias }, { llmJson: llm });
  assert.strictEqual(r2.tentativas, 2);
});

test('perfil de voz do Pedro entra no prompt, limitado e sem poder sobrepor as regras de fatos', async () => {
  const { vozDoPedro } = require('./redacao');
  assert.strictEqual(vozDoPedro(''), '');
  const t = vozDoPedro('Direto e informal.\u0000 Máximo de 2 emojis.');
  assert.match(t, /estilo apenas; não autoriza inventar fatos/);
  assert.ok(!t.includes('\u0000'));
  assert.ok(vozDoPedro('x'.repeat(5000)).length < 1800, 'limite de tamanho');
  const chamadas = [];
  const llm = { ...llmReal, pedirJson: async (p) => { chamadas.push(p.sistema); return { dados: copiaOk(), llm: { provider: 'teste', model: 'falso' } }; } };
  await gerarCopia({ briefing: { objetivo: 'autoridade', estrutura: 'acontecimento', duvidas: [] }, fonte, claims, evidencias, voz: 'Fale como um amigo empreendedor.' }, { llmJson: llm });
  assert.match(chamadas[0], /PERFIL DE VOZ DEFINIDO PELO PEDRO[\s\S]*amigo empreendedor/);
  assert.ok(chamadas[0].indexOf('REGRAS DE SEGURANÇA') > chamadas[0].indexOf('amigo empreendedor'), 'as regras de dados vêm depois e valem sobre a voz');
});
