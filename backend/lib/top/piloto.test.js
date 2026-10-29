// Piloto automático: produção diária, janela de aviso, agenda e publicação no horário (sem publicar nada sem aprovação).
// node --test backend/lib/top/piloto.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('../armazem');
const Pi = require('./piloto');
const M = require('../../../static/contentModel');
const { ACCOUNT } = require('../account');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const SP = (dia, hhmm) => Date.parse(`${dia}T${hhmm}:00-03:00`);
const ler = async (id) => (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, id)).doc;

test('próximo horário: depois de agora + 10 min, pulando ocupados, e vira o dia', () => {
  const cfg = { ...Pi.PADRAO, horarios: ['09:00', '12:30', '20:00'] };
  assert.strictEqual(Pi.proximoHorario(cfg, [], SP('2026-10-29', '08:55')), new Date(SP('2026-10-29', '12:30')).toISOString());
  assert.strictEqual(Pi.proximoHorario(cfg, [new Date(SP('2026-10-29', '12:30')).toISOString()], SP('2026-10-29', '10:00')), new Date(SP('2026-10-29', '20:00')).toISOString());
  assert.strictEqual(Pi.proximoHorario(cfg, [], SP('2026-10-29', '21:00')), new Date(SP('2026-10-30', '09:00')).toISOString());
});

test('configuração valida horários e limites', async () => {
  novo();
  await assert.rejects(Pi.salvarConfig({ horarios: ['25:00'] }), /HH:MM/);
  await assert.rejects(Pi.salvarConfig({ meta_dia: 40 }), /1 a 15/);
  const c = await Pi.salvarConfig({ meta_dia: 6, horarios: ['18:00', '09:00'] });
  assert.deepStrictEqual([c.meta_dia, c.horarios], [6, ['09:00', '18:00']]);
});

test('rodada na janela de produção: escolhe a pauta de maior prioridade com link legível e cria o carrossel', async () => {
  novo(); const criados = [];
  const deps = {
    descobrir: async () => ({ pautas: [
      { id: 'p1', titulo: 'Baixa', prioridade: 40, fontes: [{ url: 'https://agenciabrasil.ebc.com.br/a' }] },
      { id: 'p2', titulo: 'Alta', prioridade: 90, fontes: [{ url: 'https://paywall.example/x' }, { url: 'https://agenciabrasil.ebc.com.br/b' }] },
      { id: 'p3', titulo: 'Sem link', prioridade: 99, fontes: [] }] }),
    criar: async (o) => { criados.push(o); return { id: `c_${criados.length}` }; },
  };
  const r = await Pi.rodada({ agora: SP('2026-10-29', '06:00'), deps });
  assert.strictEqual(r.criado.titulo, 'Alta');
  assert.deepStrictEqual(criados[0], { url: 'https://agenciabrasil.ebc.com.br/b', titulo: 'Alta', origem: 'piloto' });
  // fora da janela de produção não cria
  const r2 = await Pi.rodada({ agora: SP('2026-10-29', '23:30'), deps });
  assert.strictEqual(r2.criado, null);
});

test('janela de aprovação: um aviso só, com a contagem de prontos', async () => {
  novo(); const avisos = [];
  const cfg = await Pi.config();
  await arm.armazem().config.salvar(ACCOUNT.ig_id, { piloto_estado: { dia: '2026-10-29', criados: [{ id: 'x1', dia: '2026-10-29', em: new Date(SP('2026-10-29', '05:00')).toISOString(), estado: 'concluida' }, { id: 'x2', dia: '2026-10-29', em: new Date(SP('2026-10-29', '05:30')).toISOString(), estado: 'concluida' }] } });
  const deps = { notificar: async (o) => { avisos.push(o); }, descobrir: async () => ({ pautas: [] }) };
  await Pi.rodada({ agora: SP('2026-10-29', '08:05'), deps });
  await Pi.rodada({ agora: SP('2026-10-29', '08:20'), deps });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].corpo, /2 carrosséis prontos/);
  assert.ok(cfg.janelas_aprovacao.includes('08:00'));
});

async function aprovado() {
  const c = M.novoConteudo({ titulo: 'Aprovado de teste' });
  M.criarVersao(c, { slides: [{ id: 's1', funcao: 'capa', layout: 'rep_capa', texto: 'x', claim_ids: [] }], legenda: '', cta: '', hashtags: [] }, { quem: 'sistema' });
  c.top = { estado: 'concluida' }; c.status = 'aprovado'; c.revisao = { ...(c.revisao || {}), aprovada_versao: M.versaoAtiva(c).id, hash_aprovado: M.versaoAtiva(c).hash };
  await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, c, 0);
  return c;
}

test('aprovar agenda no próximo horário; no horário a rodada entrega para publicação', async () => {
  novo(); const c = await aprovado(); const enviados = [];
  const ag = await Pi.agendar(c.id, { agora: SP('2026-10-29', '10:00') });
  assert.strictEqual(ag.agenda.publicar_em, new Date(SP('2026-10-29', '11:00')).toISOString());
  assert.strictEqual((await ler(c.id)).studio.estado, 'agendado');
  const antes = await Pi.rodada({ agora: SP('2026-10-29', '10:30'), deps: { enfileirar: async (x) => enviados.push(x.id), descobrir: async () => ({ pautas: [] }) } });
  assert.deepStrictEqual(antes.publicados, []);
  const r = await Pi.rodada({ agora: SP('2026-10-29', '11:01'), deps: { enfileirar: async (x) => enviados.push(x.id), descobrir: async () => ({ pautas: [] }) } });
  assert.deepStrictEqual(r.publicados, [c.id]);
  assert.deepStrictEqual(enviados, [c.id]);
  assert.strictEqual((await ler(c.id)).studio.estado, 'publicando');
});

test('publicação pausada segura o item na agenda (não publica, não perde)', async () => {
  novo(); const c = await aprovado();
  await arm.armazem().config.salvar(ACCOUNT.ig_id, { publish_paused: true });
  await Pi.agendar(c.id, { agora: SP('2026-10-29', '10:00') });
  const r = await Pi.rodada({ agora: SP('2026-10-29', '11:05'), deps: { enfileirar: async () => { throw new Error('não deveria'); }, descobrir: async () => ({ pautas: [] }) } });
  assert.deepStrictEqual(r.publicados, []);
  assert.ok(r.avisos.some((a) => /pausadas/.test(a)));
  assert.strictEqual((await Pi.resumoDoDia({ agora: SP('2026-10-29', '11:05') })).agenda.length, 1);
});

test('conteúdo que não está aprovado nunca é publicado pela agenda', async () => {
  novo(); const c = await aprovado();
  await Pi.agendar(c.id, { agora: SP('2026-10-29', '10:00') });
  const doc = await ler(c.id); doc.status = 'em_revisao'; doc.revisao.aprovada_versao = null;
  const reg = await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id); await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, doc, reg.rev);
  const r = await Pi.rodada({ agora: SP('2026-10-29', '11:05'), deps: { enfileirar: async () => { throw new Error('não deveria'); }, descobrir: async () => ({ pautas: [] }) } });
  assert.deepStrictEqual(r.publicados, []);
  assert.strictEqual((await Pi.resumoDoDia({ agora: SP('2026-10-29', '11:05') })).agenda.length, 0);
});

test('piloto desligado: não cria nada, mas publica o que já foi aprovado e agendado', async () => {
  novo(); const c = await aprovado(); const criados = []; const enviados = [];
  await Pi.salvarConfig({ ativo: false });
  await Pi.agendar(c.id, { agora: SP('2026-10-29', '10:00') });
  const r = await Pi.rodada({ agora: SP('2026-10-29', '11:02'), deps: { criar: async (o) => { criados.push(o); return { id: 'n' }; }, enfileirar: async (x) => enviados.push(x.id), descobrir: async () => ({ pautas: [{ id: 'p', titulo: 't', fontes: [{ url: 'https://agenciabrasil.ebc.com.br/x' }] }] }) } });
  assert.deepStrictEqual(enviados, [c.id]); assert.strictEqual(criados.length, 0); assert.match(r.motivo, /desligado/);
});
