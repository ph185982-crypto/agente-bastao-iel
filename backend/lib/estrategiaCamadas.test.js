// Comunidade, Audiência, Estratégia criativa, Growth Lab, Funil, Distribuição e Prioridade. Dados abaixo são FIXTURES de teste.
// node --test backend/lib/estrategiaCamadas.test.js
const test = require('node:test');
const assert = require('node:assert');
const arm = require('./armazem');
const Com = require('./comunidade');
const Aud = require('./audiencia');
const Cri = require('./criativo');
const Lab = require('./growthLab');
const Funil = require('./funil');
const Dist = require('./distribuicao');
const Pri = require('./prioridade');
const Dna = require('./dnaEditorial');
const R = require('./roteiros');
const { invokeRoute } = require('./invokeRoute');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const AGORA = Date.now(); const DIA = 86400000;
let seq = 0;
const post = (d, o = {}) => ({ id: `m${++seq}`, tipo: 'reel', publicado_em: new Date(AGORA - d * DIA).toISOString(), maduro: true, alcance: 10000, compartilhamentos: 40, salvamentos: 20, legenda: 'Como a loja ganha dinheiro com o preço', ...o });

test('comunidade: classifica por regra (pergunta, crítica, discordância, comercial, sugestão, spam, história)', () => {
  const casos = {
    'Quanto custa a sua consultoria?': 'interesse_comercial', 'Faz um vídeo sobre taxa da Shopee': 'sugestao', 'Isso é mentira, sensacionalismo puro': 'critica',
    'Discordo, não é bem assim no interior': 'discordancia', 'Como eu calculo a margem do meu produto?': 'pergunta', 'Siga @promo ganhe dinheiro https://x.y': 'spam',
    'Eu trabalhei numa loja de roupa por anos e na minha loja o dono dava desconto pra todo mundo e quebrou em dois anos.': 'historia', 'Parabéns, muito bom': 'elogio', '👏': 'spam',
  };
  for (const [t, c] of Object.entries(casos)) assert.strictEqual(Com.classificar(t), c, t);
  assert.strictEqual(Com.sentimento('Que absurdo, ridículo'), 'negativo'); assert.strictEqual(Com.sentimento('Ótimo conteúdo, obrigado'), 'positivo');
});

test('comunidade: coleta pela Graph guarda e classifica; sem permissão para e avisa; resposta só sai aprovada e com confirmação', async () => {
  novo(); const chamadas = [];
  const grafo = async (m, c, p) => { chamadas.push([m, c, p]); if (m === 'POST') return { id: 'r1' }; return { data: [{ id: 'c1', text: 'Como eu calculo a margem?', username: 'ana', timestamp: new Date().toISOString() }, { id: 'c2', text: 'Siga @x https://spam', username: 'bot' }] }; };
  const r = await Com.coletar({ grafo, posts: [post(1, { id: 'm1' })] });
  assert.strictEqual(r.novos, 2); assert.strictEqual((await Com.obter('c1')).classe, 'pergunta');
  const negado = await Com.coletar({ grafo: async () => { throw Object.assign(new Error('x'), { meta: { tipo: 'permissao', amigavel: 'Sem permissão' } }); }, posts: [post(1)] });
  assert.strictEqual(negado.permissao, false);
  await assert.rejects(Com.enviarResposta('c1', { confirmar: true, grafo }), /Aprove a resposta/);
  await Com.acao('c1', { acao: 'aprovar', texto: 'Margem é o que sobra depois de todos os custos.' });
  await assert.rejects(Com.enviarResposta('c1', { confirmar: false, grafo }), /Confirme/);
  const env = await Com.enviarResposta('c1', { confirmar: true, grafo });
  assert.strictEqual(env.estado, 'respondido'); assert.deepStrictEqual(chamadas.at(-1), ['POST', 'c1/replies', { message: 'Margem é o que sobra depois de todos os custos.' }]);
  await assert.rejects(Com.enviarResposta('c1', { confirmar: true, grafo }), /já foi enviada/);
  await Com.acao('c1', { acao: 'pauta' });
  const pautas = await Com.listarPautas(); assert.strictEqual(pautas.length, 1);
  const fontes = await R.pautas({ est: {}, deps: { teses: async () => [], historias: async () => [] } });
  assert.match(fontes.tese[0].texto, /PERGUNTA OU COMENTÁRIO REAL DA AUDIÊNCIA[\s\S]*Como eu calculo a margem/);
});

test('comunidade: sugestão de resposta usa só IA gratuita e não envia nada', async () => {
  let chamada; const doc = { id: 'c9', texto: 'Isso é mentira', classe: 'critica', legenda_post: 'x' };
  const r = await Com.sugerirResposta('c9', { deps: { obter: async () => doc, gravar: async (d) => d, dna: async () => Dna.PADRAO, pedirJson: async (o) => { chamada = o; return { dados: { resposta: 'Entendo. O ponto é que a taxa sai do preço.', tom: 'firme', recomendacao: 'responder', potencial_conteudo: 'alto', pauta: 'Quem paga a taxa' } }; } } });
  assert.strictEqual(chamada.pago, 'nunca'); assert.strictEqual(r.resposta.aprovada, false); assert.ok(!r.resposta.enviada_em);
});

test('audiência: categorias, perguntas recorrentes e oportunidades com evidência; sem comentários, nada é inventado', () => {
  const cs = [...Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, texto: 'Como funciona a taxa da Shopee para vendedor pequeno?', classe: 'pergunta', tema: 'marketplace', sentimento: 'neutro', em: new Date(AGORA - i * DIA).toISOString() })),
    { id: 'k', texto: 'Quanto custa consultoria?', classe: 'interesse_comercial', tema: 'marketplace', sentimento: 'neutro', em: new Date().toISOString() }];
  const a = Aud.analisar({ comentarios: cs, posts: [post(10, { legenda: 'Taxa da Shopee e do Mercado Livre' })], dna: Dna.PADRAO, agora: AGORA });
  assert.strictEqual(a.categorias[0].tema, 'marketplace'); assert.strictEqual(a.radar.perguntas_frequentes[0].n, 4);
  const s = a.sugestoes[0]; assert.strictEqual(s.tema_id, 'marketplace'); assert.match(s.evidencia, /5 comentários/); assert.ok(s.score > 0 && s.score <= 100);
  assert.strictEqual(Aud.analisar({ comentarios: [], posts: [] }).sugestoes.length, 0);
});

test('estratégia criativa: score com os pesos do pedido, ganchos que violam regra saem, 3 opções, opinião do Pedro exigida', async () => {
  novo();
  const notas = { curiosidade: 10, identificacao: 10, compartilhamento: 10, originalidade: 10, clareza: 10, gancho: 10, identidade: 10, conversao: 10 };
  assert.strictEqual(Cri.score(notas), 100); assert.strictEqual(Cri.score({ ...notas, curiosidade: 5 }), 90);
  const resp = { contexto: { o_que: 'Taxa subiu' }, audiencia: { principal: 'vendedores' },
    angulos: Object.keys(Cri.ANGULOS).map((t, i) => ({ tipo: t, titulo: `Ângulo ${t}`, ideia: 'ideia', objetivo: 'descoberta', usa_opiniao_do_pedro: t === 'interpretacao_pedro', notas: Object.fromEntries(Object.keys(notas).map((k) => [k, 9 - i])) })),
    formatos: [{ formato: 'reel', nota: 9, motivo: 'm' }, { formato: 'carrossel', nota: 7, motivo: 'm' }],
    ganchos: [...Cri.TIPOS_GANCHO.map((t) => ({ tipo: t, angulo: 'curiosidade', texto: `A taxa que ninguém vê no ${t}` })), { tipo: 'numero', texto: 'A taxa subiu 37% este mês' }, { tipo: 'pergunta', texto: 'Você sabia que a taxa subiu?' }] };
  let pedido;
  const e = await Cri.gerar({ pauta: 'A taxa de venda do marketplace subiu para 20% em novembro.', deps: { dna: async () => Dna.PADRAO, pedirJson: async (o) => { pedido = o; return { dados: resp, llm: { provider: 'groq' } }; } } });
  assert.strictEqual(pedido.pago, 'nunca'); assert.match(pedido.sistema, /CINCO ÂNGULOS/);
  assert.strictEqual(e.resultado.opcoes.length, 3); assert.strictEqual(e.resultado.opcoes[0].angulo, 'curiosidade'); assert.strictEqual(e.resultado.opcoes[0].score, 90);
  assert.ok(e.resultado.eliminados.some((x) => /número fora da pauta/.test(x))); assert.ok(e.resultado.eliminados.some((x) => /proibida|vício/.test(x)));
  assert.ok(e.resultado.angulos.find((a) => a.tipo === 'interpretacao_pedro').precisa_opiniao_do_pedro);
  const comb = await Cri.acao(e.id, { acao: 'combinar', combinar: ['curiosidade', 'bolso'] }); assert.ok(comb.resultado.opcoes.at(-1).combinada);
  const ap = await Cri.acao(e.id, { acao: 'aprovar', opcao: 1, edicao: { gancho: 'A taxa que ninguém vê' }, serie: 'a_conta_que_ninguem_faz' });
  assert.strictEqual(ap.estado, 'aprovada'); assert.ok(ap.pauta_id);
  const fontes = await R.pautas({ est: {}, deps: { teses: async () => [], historias: async () => [] } });
  assert.match(fontes.tese[0].texto, /PAUTA APROVADA PELO PEDRO/); assert.strictEqual(fontes.tese[0].origem_pauta.serie, 'a_conta_que_ninguem_faz');
  // opção que depende da opinião do Pedro sem opinião escrita: recusada
  const e2 = await Cri.gerar({ pauta: 'Outra pauta de teste com mais de vinte letras.', deps: { dna: async () => Dna.PADRAO, pedirJson: async () => ({ dados: { ...resp, angulos: resp.angulos.map((a) => ({ ...a, notas: Object.fromEntries(Object.keys(notas).map((k) => [k, a.tipo === 'interpretacao_pedro' ? 10 : 1])) })) } }) } });
  await assert.rejects(Cri.acao(e2.id, { acao: 'aprovar', opcao: 1 }), /opinião sua/);
});

test('growth lab: amostra insuficiente não conclui; diferença < 20% é inconclusivo; acima disso é indício, nunca vencedor', async () => {
  novo();
  const A = Array.from({ length: 5 }, (_, i) => post(10 + i, { id: `a${i}`, compartilhamentos: 80 })); const B = Array.from({ length: 5 }, (_, i) => post(20 + i, { id: `b${i}`, compartilhamentos: 40 }));
  const base = { nome: 'Rosto no início', hipotese: 'Rosto nos 3 primeiros segundos aumenta envios', variavel: 'rosto_inicio', indicador: 'envios_mil', amostra_minima: 5 };
  const ex = await Lab.criar({ ...base, grupo_a: { descricao: 'com rosto', posts: A.map((p) => p.id) }, grupo_b: { descricao: 'sem rosto', posts: B.map((p) => p.id) } });
  const r = Lab.avaliar(ex, [...A, ...B]); assert.strictEqual(r.veredito, 'indicio_a'); assert.match(r.texto, /Nos 5 posts do grupo A \(com rosto\), a mediana de compartilhamentos por mil alcançados foi 8/); assert.doesNotMatch(r.texto, /vencedor/i);
  assert.strictEqual(Lab.avaliar(ex, [...A.slice(0, 2), ...B]).veredito, 'amostra_insuficiente');
  const B2 = B.map((p) => ({ ...p, compartilhamentos: 75 })); assert.strictEqual(Lab.avaliar(ex, [...A, ...B2]).veredito, 'inconclusivo');
  assert.throws(() => Lab.validar({ ...base, grupo_a: { posts: ['x'] }, grupo_b: { posts: ['x'] } }), /dois grupos/);
  const d = await Lab.registrarDecisao(ex.id, 'Manter rosto nos próximos 5 Reels'); assert.strictEqual(d.decisoes.length, 1);
});

test('funil: estágios, taxas e sequência editorial; recusa dado pessoal; descoberta sem CTA comercial', async () => {
  novo();
  const l1 = await Funil.criar({ nome: 'Loja de roupas', origem: 'palavra_chave', palavra: 'PRECO' });
  await Funil.criar({ nome: 'Mercado', origem: 'dm' });
  await Funil.mover(l1.id, 'diagnostico'); await Funil.mover(l1.id, 'proposta'); await Funil.mover(l1.id, 'cliente');
  const r = Funil.resumo(await Funil.listar());
  assert.deepStrictEqual(r.contagem, { lead: 2, diagnostico: 1, proposta: 1, cliente: 1 }); assert.strictEqual(r.taxas.lead_diagnostico, 50);
  await assert.rejects(Funil.criar({ nome: 'João 62 99999-1234', origem: 'dm' }), /CPF, telefone ou e-mail/);
  assert.match(Funil.sequencia(['descoberta', 'descoberta', 'identidade', 'descoberta', 'identidade']).recomendacao, /autoridade/);
  assert.match(Funil.sequencia(['conversao', 'conversao', 'descoberta', 'identidade', 'conversao']).recomendacao, /cansa/);
  assert.ok(!Funil.ctaPermitido('descoberta').includes('isca'));
});

test('distribuição: compara com outros posts na mesma idade e monta o ciclo com perguntas reais do post', () => {
  const p = { ...post(1, { id: 'P', alcance: 30000 }), idade_h: 24 };
  const series = [1, 2, 3].map((i) => ({ id: `s${i}`, tipo: 'reel', pontos: [{ idade_h: 23, alcance: 10000 }, { idade_h: 70, alcance: 20000 }] }));
  const cs = [{ id: 'k1', media_id: 'P', texto: 'Como faço isso na minha loja?', classe: 'pergunta', estado: 'novo' }];
  const pl = Dist.plano({ post: p, series, comentarios: cs });
  assert.strictEqual(pl.desempenho.razao, 3); assert.match(pl.desempenho.leitura, /Acima do normal/);
  assert.strictEqual(pl.comentarios.pendentes, 1); assert.strictEqual(pl.pautas.length, 1); assert.match(pl.stories[1].texto, /Como faço isso/);
  assert.match(Dist.plano({ post: { ...p, id: 'Q' }, series: [], comentarios: [] }).desempenho.leitura, /Sem base de comparação/);
});

test('prioridade: ordena pela estratégia com motivo; frequência compara a contagem real com a hipótese', () => {
  const ctx = { achados: [{ dimensao: 'tema', id: 'marketplace', nome: 'Marketplace', amostra: 'suficiente', razao: 2, n: 6 }], sugestoes: [], pilares: Dna.PADRAO.pilares, objetivosRecentes: ['descoberta', 'descoberta', 'descoberta', 'descoberta'] };
  const f = Pri.ordenar([{ id: 'x', titulo: 'Curiosidade sobre a origem do pão', origem: 'reciclagem' }, { id: 'y', titulo: 'A taxa da Shopee que ninguém vê', origem: 'criar', serie: 'por_tras_do_preco', objetivo: 'autoridade' }], ctx);
  assert.strictEqual(f[0].id, 'y'); assert.ok(f[0].prioridade.motivos.some((m) => /audiência comprovada/.test(m))); assert.ok(f[0].prioridade.motivos.some((m) => /Completa o funil/.test(m)));
  const fr = Pri.frequencia([...Array.from({ length: 8 }, (_, i) => post(i * 3)), ...Array.from({ length: 4 }, (_, i) => post(i * 6, { tipo: 'carrossel' }))], { agora: AGORA });
  assert.strictEqual(fr.por_semana.reels, 2); assert.match(fr.leitura[0], /abaixo da hipótese/);
});

test('revisor criativo: 10 perguntas no prompt da banca; alertas lidos e promessa exagerada derruba o critério 4', () => {
  const p = R.promptFiscal('ambos'); assert.match(p, /REVISOR CRIATIVO/); for (const q of R.PERGUNTAS_REVISAO) assert.ok(p.includes(q), q);
  const rv = R.lerRevisao({ revisao: { respostas: ['Porque o gancho é forte', '', 'x'], alertas: ['promessa_exagerada', 'inventado'] } });
  assert.deepStrictEqual(rv.alertas, ['promessa_exagerada']); assert.strictEqual(rv.respostas.length, 2);
  assert.strictEqual(R.lerRevisao({}), null);
});

test('rotas novas respondem (sem Meta): audiência, comunidade, criativo, lab, funil, prioridades, séries', async () => {
  novo(); const Rt = require('../routes/crescimento');
  for (const u of ['/audiencia', '/comunidade', '/criativo', '/lab', '/funil', '/prioridades', '/series', '/pautas']) { const r = await invokeRoute(Rt, 'GET', u); assert.ok(r && typeof r === 'object', u); }
  const lead = await invokeRoute(Rt, 'POST', '/funil', { nome: 'Teste', origem: 'dm' }); assert.ok(lead.id);
  const f = await invokeRoute(Rt, 'GET', '/funil'); assert.strictEqual(f.resumo.contagem.lead, 1);
  const p = await invokeRoute(Rt, 'GET', '/painel?dias=30'); assert.strictEqual(p.kpis.find((k) => k.id === 'leads').valor, 1);
  await assert.rejects(invokeRoute(Rt, 'GET', '/distribuicao/nao-existe'), (e) => e.status === 404);
});
