// Rota /discover com feeds e IA SIMULADOS: a IA dá níveis, o código tria e descarta com motivo.
// node --test backend/lib/descobrirRota.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const A = require('./armazem');

const agora = Date.now();
const h = (n) => new Date(agora - n * 3600000).toISOString();
let srv; let base; let envAntes; let niveis; let prompts = [];

test.before(async () => {
  envAntes = { ...process.env };
  process.env.GROQ_API_KEY = 'chave-falsa-de-teste';
  const feeds = require('./feeds');
  feeds.lerTodos = async () => ({
    status: [{ nome: 'Veículo X', ok: true, itens: 6 }],
    itens: [
      { titulo: 'Senado aprova teto do MEI de R$ 140 mil para 2027', resumo: 'MEI imposto limite de faturamento anual.', url: 'https://x.test/mei', origem: 'X', publicada_em: h(4), tipo_fonte: 'jornal' },
      { titulo: 'Aluguel sobe 9% em 12 meses e pesa no orçamento', resumo: 'Aluguel imposto custo de vida mensal.', url: 'https://x.test/aluguel', origem: 'X', publicada_em: h(6), tipo_fonte: 'jornal' },
      { titulo: 'Candidato lidera pesquisa eleitoral e imposto vira tema', resumo: 'Eleição imposto campanha segundo turno.', url: 'https://x.test/eleicao', origem: 'X', publicada_em: h(5), tipo_fonte: 'jornal' },
      { titulo: 'Bets proibidas: o que muda para quem aposta e paga imposto', resumo: 'Bets imposto proibição.', url: 'https://x.test/bets', origem: 'X', publicada_em: h(7), tipo_fonte: 'jornal' },
      { titulo: 'Conselho de pesca marinha se reúne e discute imposto', resumo: 'Pesca imposto reunião.', url: 'https://x.test/pesca', origem: 'X', publicada_em: h(8), tipo_fonte: 'jornal' },
    ],
  });
  const llmJson = require('./llmJson');
  llmJson.pedirJson = async ({ usuario }) => {
    prompts.push(usuario);
    const itens = JSON.parse(usuario.match(/<<<DADOS NOTICIAS>>>\n([\s\S]*?)\n<<<FIM DADOS>>>/)?.[1] || '[]');
    return { llm: { provider: 'simulado', model: 'teste' }, dados: { itens: itens.map((x) => ({ i: x.i, ligacao_com_perfil: 'forte', por_que_interessa: 'x', angulo: 'y', objetivo_sugerido: 'alcance', formato_sugerido: 'carrossel', risco: 'baixo', limitacoes: '', repete_recente: false, ...(niveis(x) || {}) })) } };
  };
  for (const k of Object.keys(require.cache)) if (/backend[\\/]routes[\\/]content\.js$/.test(k)) delete require.cache[k];
  A._definir(Object.assign(A.memoria(), { duravel: true }));
  const app = express();
  app.use(express.json());
  app.use('/api/content', require('../routes/content'));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}/api/content`;
});
test.after(() => { srv.close(); for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k]; Object.assign(process.env, envAntes); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });

const nota = (o) => ({ enviabilidade: 2, numero: 2, aderencia: 2, ponte_lojista: 1, mecanismo: 'numero_chocante', por_que_enviaria: 'Manda para o amigo.', angulo_consumidor: 'c', angulo_lojista: 'l', partidario: false, direito_autoral: false, ...o });
// A rota entrega no máximo 3 grupos por pilar: um pilar por assunto mantém o teste previsível.
const corpo = { pilares: ['mei', 'aluguel', 'eleição', 'bets', 'pesca'].map((k) => ({ id: k, nome: k, palavras: [k, 'imposto'] })), dias: 3 };
const descobrir = async (extra = {}) => (await fetch(`${base}/discover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...corpo, ...extra }) })).json();

test('o prompt traz os critérios com níveis e não pede nota; a resposta separa pautas e descartadas', async () => {
  niveis = (x) => (/pesca/i.test(JSON.stringify(x)) ? nota({ aderencia: 0 }) : /Candidato/i.test(JSON.stringify(x)) ? nota({ partidario: true }) : nota());
  prompts = [];
  const r = await descobrir();
  assert.match(prompts[0], /enviabilidade/);
  assert.match(prompts[0], /NÍVEIS de 0 a 3/);
  assert.doesNotMatch(prompts[0], /Não dê pontuação/);
  const ids = r.pautas.map((p) => p.titulo);
  assert.ok(ids.some((t) => /Senado aprova teto do MEI/.test(t)) && ids.some((t) => /Aluguel sobe 9%/.test(t)));
  const motivoDe = (re) => r.descartadas.find((d) => re.test(d.titulo))?.motivo;
  assert.strictEqual(motivoDe(/^Candidato/), 'partidario', 'eleitoral no modo neutro');
  assert.strictEqual(motivoDe(/^Conselho de pesca/), 'fora_do_publico');
  assert.strictEqual(r.estrategia.modo_politico, 'neutral');
  assert.match(r.aviso_prioridade, /não prevê/i);
  assert.ok(r.pautas.every((p) => typeof p.prioridade === 'number' && p.criterios && 'mecanismo' in p));
  assert.ok(r.pautas.every((p, i, a) => i === 0 || a[i - 1].prioridade >= p.prioridade), 'ordenadas por prioridade');
});

test('estratégia editável muda o resultado: tema bloqueado sai e modo "allowed" libera o eleitoral', async () => {
  niveis = () => nota();
  const put = await fetch(`${base}/estrategia`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ temas_bloqueados: ['bets'], modo_politico: 'allowed' }) });
  assert.strictEqual(put.status, 200);
  const r = await descobrir();
  assert.ok(r.descartadas.some((d) => d.motivo === 'tema_bloqueado' && /Bets/.test(d.titulo)));
  assert.ok(r.pautas.some((p) => /Candidato/.test(p.titulo)), 'modo allowed libera pauta eleitoral');
  const ruim = await fetch(`${base}/estrategia`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dias_sem_repetir: 500 }) });
  assert.strictEqual(ruim.status, 400);
  const get = await (await fetch(`${base}/estrategia`)).json();
  assert.strictEqual(get.modo_politico, 'allowed');
  assert.strictEqual(get.dias_sem_repetir, 21);
  await fetch(`${base}/estrategia`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modo_politico: 'neutral', temas_bloqueados: [] }) });
});

test('tema já usado (publicado no Instagram há poucos dias) é descartado com a data', async () => {
  niveis = () => nota();
  await require('./temas').semearDoInstagram([{ id: 'm1', legenda: 'Aumentar o teto do MEI é um avanço. Quem empreende precisa de espaço.', publicado_em: h(24 * 4), da_ferramenta: false }]);
  const r = await descobrir();
  const d = r.descartadas.find((x) => x.motivo === 'tema_usado');
  assert.ok(d && /MEI/.test(d.titulo), JSON.stringify(r.descartadas));
  assert.match(d.detalhe, /há 4 dia/);
  const livre = await descobrir();
  assert.ok(livre.pautas.some((p) => /Aluguel/.test(p.titulo)), 'outros assuntos continuam');
});
