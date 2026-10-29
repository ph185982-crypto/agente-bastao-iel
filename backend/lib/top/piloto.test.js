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

test('aprovação durante a rodada não some da agenda; rodada simultânea é recusada', async () => {
  novo(); const c = await aprovado(); let segunda;
  const deps = { descobrir: async () => {
    await Pi.agendar(c.id, { agora: SP('2026-10-29', '10:00') }); // Pedro aprova enquanto a rodada roda
    segunda = await Pi.rodada({ agora: SP('2026-10-29', '10:00'), deps: { descobrir: async () => ({ pautas: [] }) } });
    return { pautas: [] };
  } };
  await Pi.rodada({ agora: SP('2026-10-29', '10:00'), deps });
  assert.strictEqual(segunda.executou, false);
  assert.deepStrictEqual((await Pi.resumoDoDia({ agora: SP('2026-10-29', '10:01') })).agenda.map((x) => x.id), [c.id]);
  const outra = await Pi.rodada({ agora: SP('2026-10-29', '10:05'), deps: { descobrir: async () => ({ pautas: [] }) } });
  assert.strictEqual(outra.executou, true); // a trava foi liberada no fim
});

test('relógio: 1 min com produção, 10 min parado, e correntes simultâneas caem na mesma chave', async () => {
  const R = require('./relogio'); const t = Date.parse('2026-10-29T10:00:05Z');
  const ativo = R.proximo({ avancados: [{ id: 'x', estado: 'em_andamento' }] }, t);
  assert.strictEqual(ativo.alvo, Date.parse('2026-10-29T10:01:00Z'));
  assert.strictEqual(R.proximo({ avancados: [{ id: 'x', estado: 'em_andamento' }] }, t + 20000).chave, ativo.chave);
  assert.strictEqual(R.proximo({ avancados: [] }, t).alvo, Date.parse('2026-10-29T10:10:00Z'));
  assert.strictEqual(R.proximo(null, t).alvo, Date.parse('2026-10-29T10:10:00Z'));
  const enviados = []; await R.agendarProxima({ criado: { id: 'n' } }, { agora: t, enviar: async (m, o) => enviados.push(o) });
  assert.strictEqual(enviados[0].delaySeconds, 55);
  assert.ok(await R.agendarProxima({}, { agora: t, enviar: async () => { throw new Error('fila fora'); } }) === null);
});

test('pauta de serviço fica fora da fila; descarte do Pedro abre vaga na meta', async () => {
  assert.ok(Pi.deServico('Saiba quais indicadores e balanços saem nesta 5ª feira'));
  assert.ok(Pi.deServico('Governo Lula: leia a agenda de ministros do governo nesta 5ª feira'));
  assert.ok(!Pi.deServico('TCU calcula alíquota da CBS em 11,3% para 2027'));
  novo(); const criados = [];
  await Pi.salvarConfig({ meta_dia: 1, reserva: 0 });
  await arm.armazem().config.salvar(ACCOUNT.ig_id, { piloto_estado: { dia: '2026-10-29', criados: [{ id: 'x1', dia: '2026-10-29', em: new Date(SP('2026-10-29', '05:00')).toISOString(), estado: 'concluida' }] } });
  const deps = { criar: async (o) => { criados.push(o); return { id: `n${criados.length}` }; }, descobrir: async () => ({ pautas: [{ id: 's', titulo: 'Saiba quais balanços saem hoje', fontes: [{ url: 'https://agenciabrasil.ebc.com.br/s' }] }, { id: 'p', titulo: 'Gasto público sobe 9%', fontes: [{ url: 'https://agenciabrasil.ebc.com.br/p' }] }] }) };
  assert.strictEqual((await Pi.rodada({ agora: SP('2026-10-29', '07:00'), deps })).criado, null); // meta cheia
  await Pi.registrarDecisao('x1', 'descartado');
  const r = await Pi.rodada({ agora: SP('2026-10-29', '07:10'), deps });
  assert.strictEqual(r.criado.titulo, 'Gasto público sobe 9%');
});

test('limpeza do banco: apaga prévias de descartados e de versões antigas e fotos sem uso; mantém o que está vivo', async () => {
  novo(); const a = arm.armazem(); const conta = ACCOUNT.ig_id; const L = require('../manutencao');
  const vivo = M.novoConteudo({ titulo: 'vivo' }); M.criarVersao(vivo, { slides: [{ id: 's1', funcao: 'capa', layout: 'rep_capa', texto: 'x', imagem_id: 'f1', claim_ids: [] }], legenda: '', cta: '', hashtags: [] }, { quem: 'sistema' });
  M.criarVersao(vivo, { slides: [{ id: 's1', funcao: 'capa', layout: 'rep_capa', texto: 'y', imagem_id: 'f1', claim_ids: [] }], legenda: '', cta: '', hashtags: [] }, { quem: 'sistema' });
  vivo.imagens = [{ id: 'f1' }]; await a.conteudos.salvar(conta, vivo.id, vivo, 0);
  const morto = M.novoConteudo({ titulo: 'morto' }); morto.status = 'arquivado'; await a.conteudos.salvar(conta, morto.id, morto, 0);
  const ativa = M.versaoAtiva(vivo).id;
  for (const ch of [`render:${vivo.id}:${ativa}:s1:h`, `render:${vivo.id}:v_antiga:s1:h`, `render:${morto.id}:v1:s1:h`, `render:c_sumiu:v1:s1:h`, 'img:f1', 'img:f_orfa', 'upload:encerramento']) await a.arquivos.salvar(conta, ch, Buffer.from('x'.repeat(10)), 'image/png');
  // prévia reaproveitada: a versão ativa referencia a imagem gravada com o id da versão anterior
  vivo.arte = { renders: [{ slide_id: 's1', versao: ativa, blob_key: `render:${vivo.id}:v_antiga:s1:reusa` }, { slide_id: 's1', versao: ativa, blob_key: `render:${vivo.id}:${ativa}:s1:h` }] };
  const regV = await a.conteudos.obter(conta, vivo.id); await a.conteudos.salvar(conta, vivo.id, vivo, regV.rev);
  await a.arquivos.salvar(conta, `render:${vivo.id}:v_antiga:s1:reusa`, Buffer.from('x'), 'image/jpeg');
  const r = await L.limpar();
  const resta = (await a.arquivos.listar(conta)).map((f) => f.chave).sort();
  assert.deepStrictEqual(resta, [`render:${vivo.id}:${ativa}:s1:h`, `render:${vivo.id}:v_antiga:s1:reusa`, 'img:f1', 'upload:encerramento'].sort());
  assert.strictEqual(r.apagados, 4);
});
