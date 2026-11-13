// Fábrica de roteiros de Reels: roteirista + fiscais (código, retenção, verdade e voz), com IA simulada.
// node --test backend/lib/roteiros/roteiros.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('../armazem');
const R = require('./index');
const S = require('./skill');
const Pi = require('../top/piloto');
const { ACCOUNT } = require('../account');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const DIA = '2026-11-13'; const AGORA = Date.parse(`${DIA}T10:00:00-03:00`);

const BOM = {
  titulo: 'O sócio que não trabalha', publico: 'dono de loja', gancho: 'Para de chamar isso de imposto. É um sócio que nunca aparece na loja.',
  tela_gancho: 'O SÓCIO INVISÍVEL', visual: 'Pedro segurando uma nota fiscal no balcão',
  foreshadow: 'E ele fica com a parte boa antes de você ver o dinheiro.',
  blocos: [
    { fala: 'Você vende, a maquininha apita e você acha que aquele valor é seu. Não é. Antes de cair na conta, ele já tirou a parte dele.', tela: 'ELE RECEBE PRIMEIRO' },
    { fala: 'Ele não abre a loja às sete. Ele não liga para o fornecedor. Ele não segura o funcionário quando o mês aperta.', tela: 'NÃO TRABALHA' },
    { fala: 'Mas no fim do mês ele cobra como se tivesse feito tudo isso. E se você atrasar, ele ainda manda multa.', tela: 'E COBRA MULTA' },
    { fala: 'Na minha leitura, enquanto a gente chamar isso de imposto, ninguém faz a conta de quanto custa esse sócio por ano.', tela: 'FAÇA A CONTA' },
  ],
  payoff: 'Então olha o seu extrato hoje e separa o que é seu do que é dele, antes de gastar.',
  cta: 'Manda pra quem tem loja e acha que fatura bem.', cta_tipo: 'envio',
};
const NOTAS_RET = { notas: { 1: 9, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8, 7: 8, 11: 8, 12: 9, 13: 9 }, problemas: [] };
const NOTAS_VER = { notas: { 8: 9, 9: 9, 10: 9, 14: 8, 15: 8 }, problemas: [] };
const TESE = { id: 'rc1', tese: 'Imposto funciona como um sócio que não trabalha.', tema: 'Imposto como sócio', ponte_pedro: 'O dono de loja sente no caixa.', mecanismo: 'reenquadramento', vl: 5 };

// IA simulada: responde conforme o prompt (roteirista ou fiscal) e registra a ordem das chamadas.
function iaFalsa({ roteiro = BOM, ret = NOTAS_RET, ver = NOTAS_VER } = {}) {
  const chamadas = [];
  const pedirJson = async ({ sistema, pago, etapa }) => {
    chamadas.push({ etapa, pago });
    if (/FISCAL DE RETENÇÃO/.test(sistema)) return { dados: typeof ret === 'function' ? ret(chamadas) : ret, llm: { provider: 'teste' } };
    if (/FISCAL DE VERDADE/.test(sistema)) return { dados: typeof ver === 'function' ? ver(chamadas) : ver, llm: { provider: 'teste' } };
    return { dados: typeof roteiro === 'function' ? roteiro(chamadas, sistema) : roteiro, llm: { provider: 'teste' } };
  };
  return { pedirJson, chamadas };
}

test('skill: 12 formatos e checklist de 15 critérios com 6 eliminatórios', () => {
  assert.strictEqual(Object.keys(S.FORMATOS).length, 12);
  assert.strictEqual(S.CRITERIOS.length, 15);
  assert.deepStrictEqual(S.CRITERIOS.filter((c) => c.el).map((c) => c.n), [1, 2, 4, 6, 8, 10]);
  assert.ok(!/—/.test(S.SKILL), 'a skill não pode ensinar travessão');
});

test('fiscal do código: roteiro bom passa; saudação, número inventado e CTA genérico reprovam', () => {
  const pauta = { texto: TESE.tese };
  assert.deepStrictEqual(R.fiscalCodigo(R.normalizar(BOM), pauta).problemas, []);
  const ruim = R.normalizar({ ...BOM, gancho: 'Oi pessoal, hoje vou falar de imposto.', cta: 'Curte e segue para mais.', blocos: [...BOM.blocos, { fala: 'Isso custa 37 mil reais por ano para quem fatura pouco.', tela: '37 MIL' }] });
  const p = R.fiscalCodigo(ruim, pauta).problemas;
  assert.ok(p.some((x) => x.criterio === 1), 'saudação no gancho');
  assert.ok(p.some((x) => x.criterio === 13), 'CTA genérico');
  assert.ok(p.some((x) => x.criterio === 8 && x.eliminar), 'número fora da pauta');
  // O mesmo número vindo da pauta é permitido.
  assert.ok(!R.fiscalCodigo(ruim, { texto: 'O custo médio é de 37 mil por ano.' }).problemas.some((x) => x.criterio === 8));
});

test('fiscal do código: nome de político no gancho perde alcance', () => {
  const p = R.fiscalCodigo(R.normalizar({ ...BOM, gancho: 'O Lula acabou de mudar o imposto da sua loja.' }), { texto: '' }).problemas;
  assert.ok(p.some((x) => x.criterio === 14));
});

test('veredito: média ≥ 7,5 sem eliminatório baixo aprova; nota faltando ou eliminatório < 7 reprova', () => {
  const ok = R.veredito({ retencao: R.lerNotas(NOTAS_RET, 'retencao'), verdade: R.lerNotas(NOTAS_VER, 'verdade'), codigo: { problemas: [] } });
  assert.strictEqual(ok.aprovado, true); assert.ok(ok.media >= 7.5);
  const elim = R.veredito({ retencao: R.lerNotas({ notas: { ...NOTAS_RET.notas, 1: 6 } }, 'retencao'), verdade: R.lerNotas(NOTAS_VER, 'verdade'), codigo: { problemas: [] } });
  assert.strictEqual(elim.aprovado, false); assert.deepStrictEqual(elim.eliminatorios, [1]);
  const sem = R.veredito({ retencao: R.lerNotas(NOTAS_RET, 'retencao'), verdade: null, codigo: { problemas: [] } });
  assert.strictEqual(sem.aprovado, false);
});

test('escolherFormato: usa formatos que a fonte sustenta e prefere o menos usado do dia', () => {
  const f = R.escolherFormato({ tipo: 'noticia', texto: 'Manchete sem número' }, {}, () => 0);
  assert.ok(S.FORMATOS[f].tipos.includes('noticia'));
  const h = R.escolherFormato({ tipo: 'historia', texto: 'x' }, { F6: 3 }, () => 0);
  assert.strictEqual(h, 'F5');
});

test('avancar: escreve, passa nos dois fiscais e salva o roteiro na aba Vídeos (IA gratuita apenas)', async () => {
  novo();
  const ia = iaFalsa(); const salvos = [];
  const est = {};
  const r = await R.avancar(est, { agora: AGORA, dia: DIA, meta: 1, orcamentoMs: 600000, deps: { pedirJson: ia.pedirJson, teses: async () => ({ itens: [TESE], total: 1 }), historias: async () => [], noticias: [], salvar: async (c) => { salvos.push(c); return c; } } });
  assert.strictEqual(r.salvos.length, 1);
  assert.deepStrictEqual(ia.chamadas.map((c) => c.etapa), ['roteiro_video', 'fiscal_retencao', 'fiscal_verdade']);
  assert.ok(ia.chamadas.every((c) => c.pago === 'nunca'), 'nenhuma chamada paga');
  const c = salvos[0];
  assert.ok(c.id.startsWith('vd_')); assert.strictEqual(c.video.estado, 'roteiro');
  assert.match(c.video.roteiro_texto, /^Para de chamar isso de imposto\./);
  assert.ok(c.video.roteiro_texto.includes('\n'), 'uma frase por linha para o teleprompter');
  assert.strictEqual(c.video.roteiro.formato && S.FORMATOS[c.video.roteiro.formato].tipos.includes('tese'), true);
  assert.strictEqual(est.roteiros.feitos, 1); assert.strictEqual(est.roteiros.rascunho, null);
  assert.ok(est.roteiros.usadas.some((u) => u.chave === 'rc:rc1'));
  // A mesma tese não volta no mesmo mês.
  const r2 = await R.avancar(est, { agora: AGORA, dia: DIA, meta: 2, orcamentoMs: 600000, deps: { pedirJson: ia.pedirJson, teses: async () => [TESE], historias: async () => [], noticias: [], salvar: async (x) => x } });
  assert.strictEqual(r2.sem_pauta, true);
});

test('avancar: reprovado reescreve uma vez com o parecer; reprovado de novo é descartado', async () => {
  novo();
  const ia = iaFalsa({ ret: { notas: { ...NOTAS_RET.notas, 4: 3 }, problemas: [{ criterio: 4, trecho: 'x', sugestao: 'entregue a promessa' }] } });
  const est = {};
  const r = await R.avancar(est, { agora: AGORA, dia: DIA, meta: 1, orcamentoMs: 600000, deps: { pedirJson: ia.pedirJson, teses: async () => [TESE], historias: async () => [], noticias: [], salvar: async (x) => x } });
  assert.strictEqual(r.salvos.length, 0);
  assert.strictEqual(est.roteiros.descartados, 1);
  // retenção derrubou (eliminatório < 5): o fiscal de verdade nem é chamado; reescreve uma vez.
  assert.deepStrictEqual(ia.chamadas.map((c) => c.etapa), ['roteiro_video', 'fiscal_retencao', 'roteiro_video', 'fiscal_retencao']);
});

test('avancar: número inventado reprova no código sem gastar os fiscais de IA', async () => {
  novo();
  const inventado = { ...BOM, blocos: [...BOM.blocos, { fala: 'São 4.800 reais por ano jogados fora.', tela: 'R$ 4.800' }] };
  let n = 0; const ia = iaFalsa({ roteiro: () => (n++ === 0 ? inventado : BOM) });
  const salvos = []; const est = {};
  await R.avancar(est, { agora: AGORA, dia: DIA, meta: 1, orcamentoMs: 600000, deps: { pedirJson: ia.pedirJson, teses: async () => [TESE], historias: async () => [], noticias: [], salvar: async (c) => { salvos.push(c); return c; } } });
  assert.deepStrictEqual(ia.chamadas.map((c) => c.etapa), ['roteiro_video', 'roteiro_video', 'fiscal_retencao', 'fiscal_verdade']);
  assert.strictEqual(salvos.length, 1); assert.strictEqual(salvos[0].video.roteiro.tentativas, 2);
});

test('avancar: sem cota na IA gratuita pausa 45 min e guarda o rascunho', async () => {
  novo();
  const est = {};
  const pedirJson = async () => { throw Object.assign(new Error('429 rate limit'), { code: 'COTA' }); };
  const r = await R.avancar(est, { agora: AGORA, dia: DIA, meta: 1, orcamentoMs: 600000, deps: { pedirJson, teses: async () => [TESE], historias: async () => [], noticias: [], salvar: async (x) => x } });
  assert.strictEqual(r.pausado, true);
  assert.ok(Date.parse(est.roteiros.pausa_ate) > AGORA);
  assert.ok(est.roteiros.rascunho, 'o rascunho continua para a próxima rodada');
  const r2 = await R.avancar(est, { agora: AGORA + 60000, dia: DIA, meta: 1, orcamentoMs: 600000, deps: { pedirJson, teses: async () => [TESE], salvar: async (x) => x } });
  assert.strictEqual(r2.pausado, true);
});

test('roteiro salvo aparece na lista de vídeos e sai dela ao gravar', async () => {
  novo();
  const ia = iaFalsa(); const est = {};
  const r = await R.avancar(est, { agora: AGORA, dia: DIA, meta: 1, orcamentoMs: 600000, deps: { pedirJson: ia.pedirJson, teses: async () => [TESE], historias: async () => [], noticias: [] } });
  const id = r.salvos[0].id;
  const V = require('../videos');
  const lista = await V.listar();
  const item = lista.find((x) => x.id === id);
  assert.ok(item, 'o roteiro está na aba Vídeos'); assert.strictEqual(item.estado, 'roteiro');
  assert.ok(item.roteiro_texto.length > 100); assert.ok(item.roteiro.nota >= 7.5);
  assert.strictEqual(await R.arquivar(id, 'gravado'), true);
  assert.ok(!(await V.listar()).some((x) => x.id === id));
});

test('piloto: rodada chama a fábrica de roteiros e o resumo do dia mostra a meta', async () => {
  novo();
  let chamou = null;
  await Pi.salvarConfig({ ativo: true });
  const r = await Pi.rodada({ agora: AGORA, orcamentoMs: 60000, deps: { semLimpeza: true, semHistorias: true, descobrir: async () => ({ pautas: [] }), roteiros: async (est, o) => { chamou = o; est.roteiros = { dia: o.dia, feitos: 1, descartados: 0, comecados: 1, formatos: {}, usadas: [], rascunho: null }; return { salvos: [{ id: 'vd_x' }], descartados: [], fases: ['x'] }; } } });
  assert.ok(chamou, 'a rodada avançou os roteiros'); assert.strictEqual(chamou.meta, 10);
  assert.strictEqual(r.roteiros.salvos, 1);
  const res = await Pi.resumoDoDia({ agora: AGORA });
  assert.strictEqual(res.roteiros.meta, 10); assert.strictEqual(res.roteiros.feitos, 1);
  assert.throws(() => Pi.validar({ roteiros_dia: 40 }));
  void ACCOUNT;
});

test('pausa: limite por minuto volta em 4 min; cota do dia em 45', () => {
  assert.strictEqual(R.pausaMin(new Error('429 Rate limit reached on tokens per minute (TPM): Limit 8000')), 4);
  assert.strictEqual(R.pausaMin(new Error('429 Rate limit reached on tokens per day (TPD)')), 45);
  assert.strictEqual(R.pausaMin(new Error('429 rate limit')), 45);
});
