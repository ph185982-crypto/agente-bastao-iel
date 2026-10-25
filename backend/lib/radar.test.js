// Radar de Negócios: regras de verificação, pontuação, copy, imagens, arte, ZIP e persistência (sem rede, IA simulada).
// node --test backend/lib/radar.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const A = require('./armazem');
const F = require('./radarFixtures');
const C = require('./radar/config');
const V = require('./radar/verificacao');
const N = require('./radar/numeros');
const Cand = require('./radar/candidatos');
const Pont = require('./radar/pontuacao');
const Copy = require('./radar/copy');
const Img = require('./radar/imagens');
const Arte = require('./radar/arte');
const Pacote = require('./radar/pacote');
const Fontes = require('./radar/fontes');
const U = require('./radar/util');

const novoBanco = () => A._definir(Object.assign(A.memoria(), { duravel: true }));

// ── Dinheiro: investimento ≠ faturamento, valuation ≠ caixa, crescimento ≠ lucro ─────────────
test('faturamento confundido com investimento: o número vira investimento (ou é recusado), nunca receita', () => {
  const r = V.conferirTipo({ tipo: 'receita', texto: 'A empresa fatura US$ 20 milhões.', trecho: 'We raised $20 million in a Series B round led by Acme Capital', numero: 20000000, unidade: 'USD' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.tipo, 'investimento'); assert.ok(r.corrigido);
  const v = V.conferirTipo({ tipo: 'receita', texto: 'Fatura US$ 200 milhões.', trecho: 'The company is valued at $200 million', numero: 200000000, unidade: 'USD' });
  assert.strictEqual(v.tipo, 'valuation');
  const n = V.conferirTipo({ tipo: 'receita', texto: 'Fatura US$ 5 milhões.', trecho: 'The team has $5 million to spend on hiring', numero: 5000000, unidade: 'USD' });
  assert.strictEqual(n.ok, false);
  const ok = V.conferirTipo({ tipo: 'receita', texto: 'Receita de US$ 5 milhões.', trecho: 'annual revenue reached $5 million in 2025', numero: 5000000, unidade: 'USD' });
  assert.deepStrictEqual([ok.ok, ok.tipo], [true, 'receita']);
});
test('não afirma lucrativo só porque cresceu ou recebeu investimento', () => {
  assert.strictEqual(V.conferirTipo({ tipo: 'crescimento', texto: 'A empresa é lucrativa e cresceu 300%.', trecho: 'revenue grew 300% last year', numero: 300, unidade: '%' }).ok, false);
  assert.strictEqual(V.conferirTipo({ tipo: 'investimento', texto: 'Empresa lucrativa que captou US$ 5 milhões.', trecho: 'raised $5 million from investors', numero: 5e6, unidade: 'USD' }).ok, false);
  assert.strictEqual(V.conferirTipo({ tipo: 'lucro', texto: 'É lucrativa.', trecho: 'The company has been profitable since 2024', numero: null }).ok, true);
});
test('valuation não é dinheiro disponível: a afirmação carrega o aviso', () => {
  const claims = V.decidirUso([{ id: 'c1', tipo: 'valuation', texto: 'Vale US$ 200 milhões', numero: 2e8, unidade: 'USD', documento: 0, observacoes: [] }], [{ classe: 'oficial', dominio: 'x.com', texto: 'a' }]);
  assert.ok(claims[0].observacoes.some((o) => /não é dinheiro em caixa/.test(o)));
});
test('número sem comprovação: o número da afirmação precisa estar no trecho', () => {
  const docs = [{ indice: 0, classe: 'oficial', url: 'https://x.com', veiculo: 'X', texto: 'Temos mais de 40.000 clientes ativos em todo o país.', acessada_em: '2026-10-25' }];
  const r = V.conferirAfirmacoes([
    { documento: 0, tipo: 'clientes', texto: '80 mil clientes', numero: 80000, unidade: 'clientes', trecho: 'Temos mais de 40.000 clientes ativos em todo o país.' },
    { documento: 0, tipo: 'clientes', texto: '40 mil clientes', numero: 40000, unidade: 'clientes', trecho: 'Temos mais de 40.000 clientes ativos em todo o país.' },
    { documento: 0, tipo: 'clientes', texto: 'inventado', numero: 40000, unidade: 'clientes', trecho: 'Frase que não está na página original do site.' },
    { documento: 7, tipo: 'clientes', texto: 'doc fantasma', numero: 1, trecho: 'Temos mais de 40.000 clientes ativos' },
  ], docs);
  assert.strictEqual(r.aceitas.length, 1); assert.strictEqual(r.aceitas[0].numero, 40000);
  assert.deepStrictEqual(r.rejeitadas.map((x) => /não aparece|não está no texto|não existe/.test(x.motivo)), [true, true, true]);
});
test('números em inglês e português são lidos e formatados sem estimar', () => {
  assert.strictEqual(N.extrair('raised $5M')[0].valor, 5e6);
  assert.strictEqual(N.extrair('1.2 million users')[0].valor, 1.2e6);
  assert.strictEqual(N.extrair('1.200.000 clientes')[0].valor, 1.2e6);
  assert.strictEqual(N.formatar(5e6, 'USD'), 'US$ 5 milhões');
  assert.strictEqual(N.formatar(120000, null), '120 mil');
});

// ── Idade e sinais ─────────────────────────────────────────────────────────────────────
test('negócio antigo apresentado como novo é barrado; lançamento recente salva a empresa antiga', () => {
  const agora = Date.parse('2026-10-25T12:00:00Z');
  const velho = V.avaliarIdade({ itens: [{ publicada_em: '2026-10-20' }], docs: [{ classe: 'oficial', texto: 'Founded in 2009 we sell tools.' }], claims: [{ tipo: 'fundacao', numero: 2009 }], agora });
  assert.strictEqual(velho.antigo, true); assert.match(velho.motivo, /2009/);
  const comLancamento = V.avaliarIdade({ itens: [{ publicada_em: '2026-10-20' }], docs: [], claims: [{ tipo: 'fundacao', numero: 2009 }, { tipo: 'lancamento', numero: 2026 }], agora });
  assert.strictEqual(comLancamento.antigo, false);
  const historiaVelha = V.avaliarIdade({ itens: [{ publicada_em: '2026-05-01' }], docs: [], claims: [], agora });
  assert.strictEqual(historiaVelha.antigo, true);
  assert.strictEqual(V.avaliarIdade({ itens: [{ publicada_em: '2026-10-22' }], docs: [], claims: [], agora }).antigo, false);
});
test('pirâmide, aposta e renda garantida não viram oportunidade', () => {
  assert.ok(V.sinaisNoTexto('Marketing multinível com lucro garantido').includes('piramide'));
  assert.ok(V.sinaisNoTexto('apostas esportivas online').includes('aposta'));
  assert.ok(V.sinaisNoTexto('renda garantida de 10% ao mês').includes('renda_garantida'));
  assert.deepStrictEqual(V.sinaisNoTexto('uma loja de cadeiras'), []);
});

// ── Fontes: oficial ou duas independentes ──────────────────────────────────────────────
async function verificarFixture(nome) {
  const cand = Cand.normalizar({ nome, pais: 'EUA', categoria: 'servico', resumo: 'x', itens: ['it_1'], site_provavel: `https://${F.NEG.find((n) => n.nome === nome).dominio}`, interesse: 2 }, new Map([['it_1', { id: 'it_1', titulo: `${nome} lança`, url: `https://techcrunch.com/2026/10/${nome.toLowerCase().replace(/ /g, '')}`, resumo: '', fonte_id: 'techcrunch', fonte_nome: 'TechCrunch', fonte_classe: 'imprensa', publicada_em: '2026-10-22T00:00:00Z' }]]));
  return V.verificar(cand, { deps: { lerFonte: F.fakeLerFonte, pedirJson: F.fakePedirJson(), loja: false }, agora: Date.parse('2026-10-25T12:00:00Z') });
}
test('fonte oficial ou duas fontes independentes: Lumen Pets passa, com atribuição "segundo a empresa"', async () => {
  const { verificacao: v } = await verificarFixture('Lumen Pets');
  assert.strictEqual(v.estado, 'verificada'); assert.ok(v.fonte_oficial);
  const rec = v.claims.find((c) => c.tipo === 'receita');
  assert.strictEqual(rec.usavel, true); assert.strictEqual(rec.atribuicao, 'segundo a empresa'); assert.strictEqual(rec.valor_exibicao, 'US$ 5 milhões');
  const cli = v.claims.filter((c) => c.tipo === 'clientes' && c.numero === 120000);
  assert.ok(cli.some((c) => c.confirmado_por.length >= 1), 'clientes confirmados por fonte independente');
  for (const c of v.claims) { assert.ok(c.url && c.veiculo && c.trecho && c.consultado_em && c.confianca, 'cada afirmação traz url, veículo, trecho, data da consulta e confiança'); }
});
test('fonte inexistente: sem página lida não há verificação', async () => {
  const { verificacao: v } = await verificarFixture('FantasmaApp');
  assert.strictEqual(v.estado, 'insuficiente'); assert.strictEqual(v.claims.length, 0); assert.ok(v.limitacoes.length > 0);
  assert.strictEqual(v.numeros_usaveis.length, 0);
});
test('uma matéria só não libera número; reclassifica investimento; reprova pirâmide e negócio antigo', async () => {
  const fund = (await verificarFixture('FundOnly')).verificacao;
  assert.ok(!fund.claims.some((c) => c.tipo === 'receita'), 'nenhuma receita inventada para a FundOnly');
  assert.ok(fund.claims.some((c) => c.tipo === 'investimento' && c.observacoes.some((o) => /Reclassificada/.test(o))));
  const pir = (await verificarFixture('PiramideX')).verificacao; assert.strictEqual(pir.estado, 'reprovada'); assert.ok(['piramide', 'renda_garantida'].includes(pir.descartar.codigo)); assert.ok(pir.sinais.includes('renda_garantida') && pir.sinais.includes('piramide'));
  const velho = (await verificarFixture('VelhoNegocio')).verificacao; assert.strictEqual(velho.estado, 'reprovada'); assert.strictEqual(velho.descartar.codigo, 'historia_antiga');
  const so1 = V.decidirUso([{ id: 'c1', tipo: 'clientes', texto: 'a', numero: 5000, documento: 0, observacoes: [] }], [{ classe: 'imprensa', dominio: 'a.com', texto: 'um texto qualquer sobre isso' }]);
  assert.strictEqual(so1[0].usavel, false, 'um único veículo não basta');
  const dois = V.decidirUso([{ id: 'c1', tipo: 'clientes', texto: 'a', numero: 5000, documento: 0, observacoes: [] }, { id: 'c2', tipo: 'clientes', texto: 'b', numero: 5000, documento: 1, observacoes: [] }], [{ classe: 'imprensa', dominio: 'a.com', texto: 'alpha beta gamma delta epsilon zeta eta theta iota kappa' }, { classe: 'imprensa', dominio: 'b.com', texto: 'um outro texto totalmente diferente sobre outro assunto qualquer aqui' }]);
  assert.ok(dois[0].usavel && dois[1].usavel, 'duas fontes independentes liberam');
  const copia = V.decidirUso([{ id: 'c1', tipo: 'clientes', texto: 'a', numero: 5000, documento: 0, observacoes: [] }, { id: 'c2', tipo: 'clientes', texto: 'b', numero: 5000, documento: 1, observacoes: [] }], [{ classe: 'imprensa', dominio: 'a.com', texto: 'a mesma matéria copiada palavra por palavra para o outro site' }, { classe: 'imprensa', dominio: 'b.com', texto: 'a mesma matéria copiada palavra por palavra para o outro site' }]);
  assert.strictEqual(copia[0].usavel, false, 'republicação não conta como segunda fonte');
});

// ── Coleta, duplicados, repetição ──────────────────────────────────────────────────────
test('timeout da fonte: a fonte lenta fica registrada e as outras seguem', async () => {
  const r = await Fontes.coletar({ deps: { fetcher: F.fakeFetcher({ lento: ['techcrunch.com'] }) } });
  const tc = r.status.find((s) => s.id === 'techcrunch'); assert.strictEqual(tc.ok, false); assert.match(tc.erro, /tempo esgotado/);
  assert.ok(r.status.filter((s) => s.ok).length >= 5);
  const bloqueada = r.status.find((s) => s.id === 'businessinsider'); assert.ok(bloqueada.inativo && bloqueada.erro, 'fonte bloqueada fica com o motivo');
});
test('remoção de duplicados: o mesmo negócio em itens diferentes vira um só, e a coleta tira links repetidos', () => {
  const base = (id, url) => ({ id, titulo: 'Lumen Pets lança', url, resumo: '', fonte_id: 'a', fonte_nome: 'A', fonte_classe: 'imprensa', publicada_em: '2026-10-20' });
  const a = Cand.normalizar({ nome: 'Lumen Pets', itens: ['i1'], site_provavel: 'https://lumenpets.com', interesse: 2 }, new Map([['i1', base('i1', 'https://a.com/x')]]));
  const b = Cand.normalizar({ nome: 'LUMEN PETS Inc.', itens: ['i2'], site_provavel: 'https://lumenpets.com', interesse: 3 }, new Map([['i2', base('i2', 'https://b.com/y')]]));
  const juntos = Cand.juntar([a, b]); assert.strictEqual(juntos.length, 1); assert.strictEqual(juntos[0].fontes_itens.length, 2); assert.strictEqual(juntos[0].interesse, 3);
  const p = Fontes.preparar([{ ...base('1', 'https://a.com/x?utm=1'), publicada_em: new Date().toISOString() }, { ...base('2', 'https://a.com/x'), publicada_em: new Date().toISOString() }]);
  assert.strictEqual(p.itens.length, 1); assert.strictEqual(p.duplicados, 1);
});
test('repetição de pauta: empresa já sugerida, usada ou descartada por você não volta', () => {
  const c = Cand.normalizar({ nome: 'Lumen Pets', itens: ['i1'], site_provavel: 'https://lumenpets.com' }, new Map([['i1', { id: 'i1', titulo: 't', url: 'https://a.com/x', resumo: '', fonte_id: 'a', fonte_nome: 'A', fonte_classe: 'imprensa', publicada_em: '2026-10-20' }]]));
  const agora = Date.parse('2026-10-25T12:00:00Z');
  const antes = (status, dias, extra = {}) => ({ id: 'op_x', chave: c.chave, status, encontrada_em: new Date(agora - dias * 86400000).toISOString(), fontes_itens: [], decisoes: [], run_id: 'r0', ...extra });
  assert.strictEqual(Cand.barrarRepetidos([c], [antes('pauta', 10)], { agora }).barrados.length, 1);
  assert.strictEqual(Cand.barrarRepetidos([c], [antes('usada', 100)], { agora }).barrados.length, 1);
  assert.strictEqual(Cand.barrarRepetidos([c], [antes('descartada_usuario', 60)], { agora }).barrados.length, 1);
  assert.strictEqual(Cand.barrarRepetidos([c], [antes('descartada', 20)], { agora }).barrados.length, 0, 'descartada pela máquina por falta de prova pode voltar depois de 14 dias');
  assert.strictEqual(Cand.barrarRepetidos([c], [antes('pauta', 200)], { agora }).barrados.length, 0, 'passou a janela');
  const outroNome = { ...antes('pauta', 2), chave: { nome: 'outra', dominio: '' }, fontes_itens: [{ url: 'https://a.com/x?utm=2' }] };
  assert.strictEqual(Cand.barrarRepetidos([c], [outroNome], { agora }).barrados.length, 1, 'mesma história (mesmo link) também é barrada');
});

// ── Pontuação ──────────────────────────────────────────────────────────────────────────
test('pontuação: pesos somam 100; sem prova verificada a demanda é limitada; só 75+ vira carrossel', async () => {
  assert.strictEqual(Object.values(C.PESOS).reduce((a, b) => a + b, 0), 100);
  const max = { novidade: 3, demanda: 3, receita: 3, compreensao: 3, brasil: 3, investimento: 3, visual: 3, compartilhamento: 3 };
  const semProva = { verificacao: { estado: 'verificada', demanda_verificada: 0, modelo_receita_verificado: true, idade: {} }, imagem: { tipo: 'oficial_pagina', buf_ok: true } };
  const a = Pont.aplicar(semProva, { niveis: max });
  assert.strictEqual(a.criterios.demanda.nivel, 1); assert.ok(a.criterios.demanda.limitado_por); assert.strictEqual(a.pontuacao, 100 - 13);  // demanda: 20 → 6.7 (arredonda para 7)
  const comProva = Pont.aplicar({ ...semProva, verificacao: { ...semProva.verificacao, demanda_verificada: 2 } }, { niveis: max });
  assert.strictEqual(comProva.pontuacao, 100);
  const semImagem = Pont.aplicar({ ...semProva, imagem: null, verificacao: { ...semProva.verificacao, demanda_verificada: 2 } }, { niveis: max });
  assert.strictEqual(semImagem.criterios.visual.nivel, 0);
  const baixos = [{ id: 'a', nome: 'A', interesse: 1, categoria: 'saas', pontuacao: 74, verificacao: { estado: 'verificada', numeros_usaveis: ['c1'] } }];
  assert.strictEqual(Pont.selecionar(baixos).auto, null, '74 pontos não gera carrossel automático');
  assert.ok(Pont.selecionar([{ ...baixos[0], pontuacao: 75 }]).auto);
  assert.strictEqual(Pont.selecionar([{ ...baixos[0], pontuacao: 90, verificacao: { estado: 'verificada', numeros_usaveis: [] } }]).auto, null, 'sem número comprovado não há tela de prova');
});

// ── Copy ───────────────────────────────────────────────────────────────────────────────
const opLumen = () => ({ id: 'op_x', nome: 'Lumen Pets', pais: 'EUA', categoria: 'servico', verificacao: { claims: [{ id: 'c1', tipo: 'clientes', numero: 120000, unidade: 'clientes', valor_exibicao: '120 mil', usavel: true, atribuicao: 'segundo a empresa', veiculo: 'Lumen Pets', url: 'https://lumenpets.com', data_publicacao: '2026-10-20' }, { id: 'c2', tipo: 'receita', numero: 5e6, unidade: 'USD', valor_exibicao: 'US$ 5 milhões', usavel: true, atribuicao: 'segundo a empresa', veiculo: 'Lumen Pets', url: 'https://lumenpets.com', data_publicacao: '2026-10-20' }] } });
test('copy: o modelo de IA simulado gera 8 telas de 8 a 25 palavras (capa até 18) e legenda de até 700 caracteres', async () => {
  const r = await Copy.gerarCopia(opLumen(), { deps: { pedirJson: F.fakePedirJson() } });
  assert.strictEqual(r.slides.length, 8);
  r.slides.slice(0, 7).forEach((s) => { assert.ok(s.palavras >= 8 && s.palavras <= (s.n === 1 ? 18 : 25), `tela ${s.n}: ${s.palavras} palavras`); });
  assert.strictEqual(r.slides[7].principal, 'EU PESQUISO NEGÓCIOS QUE ESTÃO DANDO CERTO NO MUNDO.'); assert.strictEqual(r.slides[7].cta, 'SEGUE @PEDRO_DESTRAVA PARA NÃO PERDER A PRÓXIMA.');
  assert.ok(r.legenda.length <= 700 && r.legenda.endsWith(r.hashtags.join(' ')) && r.hashtags.length <= 3);
  assert.ok(r.legenda.includes('Eu pesquiso negócios que estão crescendo no mundo e explico como funcionam. Segue @pedro_destrava para não perder a próxima ideia.'));
  assert.ok(/garantia/.test(r.legenda));
  assert.ok(r.slides[0].texto.length > 0 && r.slides[4].prova[0].valor === '120 mil');
});
test('texto longo, frase proibida, emoji, exclamação e número inventado são recusados', () => {
  const op = opLumen();
  const base = () => JSON.parse(JSON.stringify({ slides: [{ n: 1, texto: 'Segundo a empresa, esse serviço de banho já tem 120 mil clientes' }, { n: 2, problema: 'dar banho no cachorro em casa vira bagunça e o pet shop vive lotado' }, { n: 3, produto: 'um serviço que leva o banhista até a porta', resultado: 'o cachorro ficar limpo sem você sair' }, { n: 4, modelo: 'assinatura', explicacao: 'o cliente paga uma mensalidade fixa e recebe visitas toda semana' }, { n: 5, titulo: 'O que a empresa mostra', itens: [{ claim_id: 'c1', rotulo: 'clientes' }] }, { n: 6, dor: 'dor de todo dono', facilidade: 'serviço na porta', recorrencia: 'cobrança mensal' }, { n: 7, publico_inicial: 'donos de cães', produto_minimo: 'banho em domicílio', canal_de_vendas: 'grupos de condomínio', forma_de_cobranca: 'pacote mensal', teste_baixo_custo: 'cinco clientes' }] }));
  const erros = (mut, o = op) => { const j = base(); mut(j); const m = Copy.montarTelas(j, o); return [...m.erros, ...Copy.validarTelas(m.slides, o)]; };
  const semReceita = { ...op, verificacao: { claims: op.verificacao.claims.filter((c) => c.tipo !== 'receita') } };
  assert.deepStrictEqual(erros(() => {}), []);
  assert.ok(erros((j) => { j.slides[1].problema = 'palavra '.repeat(40); }).some((e) => /máximo 25/.test(e)), 'texto longo');
  assert.ok(erros((j) => { j.slides[1].problema = 'curto'; }).some((e) => /mínimo 8/.test(e)));
  assert.ok(erros((j) => { j.slides[0].texto = 'Em um mundo onde cães precisam de banho todo mês e as famílias não têm tempo'; }).some((e) => /proibida/.test(e)));
  assert.ok(erros((j) => { j.slides[0].texto = 'Isso muda tudo no banho dos cachorros de quem mora em apartamento'; }).some((e) => /proibida/.test(e)));
  assert.ok(erros((j) => { j.slides[1].problema = 'dar banho no cachorro em casa vira bagunça 🐶 e o pet shop vive lotado'; }).some((e) => /emoji/.test(e)));
  assert.ok(erros((j) => { j.slides[0].texto = 'Esse serviço de banho já tem 120 mil clientes!'; }).some((e) => /! nem \?/.test(e)));
  assert.ok(erros((j) => { j.slides[1].problema = 'o cachorro fica sujo e o dono gasta R$ 900 por mês no pet shop do bairro'; }).some((e) => /sem comprovação/.test(e)));
  assert.ok(erros((j) => { j.slides[0].texto = 'Essa empresa fatura milhões resolvendo um problema que todo mundo ignora'; }, semReceita).some((e) => /milhões sem afirmação verificada/.test(e)), 'dinheiro na capa exige faturamento verificado ≥ 1 milhão');
  assert.ok(!erros((j) => { j.slides[0].texto = 'Segundo a empresa, essa empresa fatura milhões resolvendo um problema que todo mundo ignora'; }).some((e) => /milhões/.test(e)), 'com faturamento verificado de US$ 5 milhões a capa pode falar em milhões');
  assert.ok(!erros((j) => { j.slides[0].texto = 'Esse serviço de banho em casa já tem 120 mil clientes no mundo todo'; }).some((e) => /atribuição/.test(e)), 'a capa sem "segundo a empresa" é consertada pelo código');
  assert.ok(erros((j) => { j.slides[1].problema = 'o dono de 120 mil clientes não consegue organizar o banho do cachorro dele'; }).some((e) => /atribuição/.test(e)), 'nas demais telas a IA precisa escrever a atribuição');
  assert.ok(erros((j) => { j.slides[0].texto = 'Quase ninguém faz isso no Brasil e esse banho em casa já fatura alto'; }).some((e) => /não dá para provar/.test(e)));
  assert.ok(erros((j) => { j.slides[4].itens = [{ claim_id: 'c9', rotulo: 'clientes' }]; }).some((e) => /não está liberada/.test(e)), 'prova só com afirmação liberada');
  assert.ok(erros((j) => { j.slides[4].itens = [{ claim_id: 'c1', rotulo: 'de receita anual' }]; }).some((e) => /fala de receita/.test(e)), 'o rótulo não pode trocar o tipo do número');
  assert.ok(erros((j) => { j.slides[4].itens = [{ claim_id: 'c2', rotulo: 'clientes' }]; }).some((e) => /fala de pessoas/.test(e)), 'faturamento não vira clientes');
  assert.ok(erros((j) => { j.slides[4].itens = [{ claim_id: 'c1', rotulo: 'clientes' }, { claim_id: 'c1', rotulo: 'usuários' }]; }).some((e) => /duas vezes/.test(e)));
  assert.ok(erros((j) => { j.slides[1].problema = 'o cachorro fica sujo, e provavelmente o dono perde tempo demais no pet shop'; }).some((e) => /hipótese ou dúvida só pode aparecer na tela 7/.test(e)));
});
test('erro da IA: copy que nunca passa nas regras falha com os motivos (nada é inventado como plano B)', async () => {
  const ruim = async () => ({ llm: {}, dados: { slides: [{ n: 1, texto: 'curto' }] } });
  await assert.rejects(() => Copy.gerarCopia(opLumen(), { deps: { pedirJson: ruim }, tentativas: 2 }), (e) => e.code === 'COPY_INVALIDA' && e.erros.length > 0);
  await assert.rejects(() => Copy.gerarCopia(opLumen(), { deps: { pedirJson: async () => { throw new Error('boom'); } } }), /boom/);
  await assert.rejects(() => Copy.gerarCopia({ ...opLumen(), verificacao: { claims: [] } }, { deps: { pedirJson: ruim } }), (e) => e.code === 'SEM_PROVA');
});
test('legenda: máximo 700 caracteres, três hashtags e aviso de que oportunidade não é garantia', () => {
  const j = { legenda: { primeira_linha: 'x'.repeat(95), resumo: 'y'.repeat(125), como_ganha: 'z'.repeat(125), brasil: 'w'.repeat(125) }, hashtags: ['a1b', 'c2d', 'e3f', 'g4h'] };
  const l = Copy.montarLegenda(j, opLumen()); assert.ok(l.texto.length <= 700, `${l.texto.length}`); assert.strictEqual(l.tags.length, 3);
  const longa = Copy.montarLegenda({ ...j, legenda: { ...j.legenda, resumo: 'y'.repeat(400) } }, opLumen()); assert.ok(longa.erros.some((e) => /máximo/.test(e)));
});

// ── Imagens ────────────────────────────────────────────────────────────────────────────
test('imagem sem relação com o negócio é recusada; stock nunca representa o negócio', async () => {
  const tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.strictEqual((await Img.validar(tiny)).ok, false);
  const faixa = await sharp({ create: { width: 2400, height: 300, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  assert.strictEqual((await Img.validar(faixa)).ok, false, 'faixa não é fotografia');
  assert.strictEqual((await Img.validar(await F.imagemFake())).ok, true);
  const op = { verificacao: { fontes: [{ classe: 'oficial', papel: 'oficial', dominio: 'lumenpets.com', url: 'https://lumenpets.com' }] } };
  assert.strictEqual(Img.relacionada({ arquivo: 'a', tipo: 'banco_de_imagens' }, op, { slide: 1 }).ok, false);
  assert.strictEqual(Img.relacionada({ arquivo: 'a', tipo: 'banco_de_imagens' }, op, { slide: 2 }).ilustrativa, true);
  assert.strictEqual(Img.relacionada({ arquivo: 'a', tipo: 'oficial_pagina', origem: { dominio: 'outrosite.com' } }, op).ok, false);
  assert.strictEqual(Img.relacionada({ arquivo: 'a', tipo: 'oficial_pagina', origem: { dominio: 'lumenpets.com' } }, op).ok, true);
  const html = '<meta property="og:image" content="/og.jpg"><meta name="twitter:image" content="https://cdn.x.com/t.png">';
  assert.deepStrictEqual(Img.imagensDeDivulgacao(html, 'https://lumenpets.com/a'), ['https://lumenpets.com/og.jpg', 'https://cdn.x.com/t.png']);
});
test('imagem: só do site oficial confirmado, com origem registrada (página, endereço, data, hash)', async () => {
  const cand = { verificacao: { fontes: [{ classe: 'oficial', papel: 'oficial', dominio: 'lumenpets.com', url: 'https://lumenpets.com' }] } };
  const r = await Img.buscar(cand, { deps: { fetcher: F.fakeFetcher() } });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.imagem.tipo, 'oficial_pagina');
  assert.ok(r.imagem.origem.url_imagem && r.imagem.origem.url_pagina && r.imagem.origem.consultado_em && /^[0-9a-f]{64}$/.test(r.imagem.origem.sha256));
  const sem = await Img.buscar({ verificacao: { fontes: [] } }, { deps: { fetcher: F.fakeFetcher() } });
  assert.strictEqual(sem.ok, false);
  assert.strictEqual((await Img.buscar({ verificacao: { fontes: [{ classe: 'oficial', papel: 'oficial', dominio: 'negocio3.com', url: 'https://negocio3.com' }] } }, { deps: { fetcher: F.fakeFetcher() } })).ok, false, 'a imagem do site de outro negócio não aparece');
});

// ── Arte: 8 imagens 1080×1350 ─────────────────────────────────────────────────────────
test('geração das oito imagens: 1080×1350, texto cabe, o rosto do Pedro só na tela 8, sem selo', async () => {
  const op = opLumen(); const c = await Copy.gerarCopia(op, { deps: { pedirJson: F.fakePedirJson() } });
  const foto = { buf: await F.imagemFake(), tipo: 'oficial_pagina', credito: 'Foto: lumenpets.com' };
  const telas = await Arte.renderizarCarrossel(c.slides, { nome: 'Lumen Pets', pais: 'EUA', categoria: 'servico', fotos: { negocio: foto, produto: foto } });
  assert.strictEqual(telas.length, 8);
  for (const [i, t] of telas.entries()) { const m = await sharp(t.png).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350], `tela ${i + 1}`); assert.ok(t.metrics.cabe, `tela ${i + 1}: ${t.metrics.problemas}`); }
  telas.slice(0, 7).forEach((t) => assert.ok(!t.metrics.elementos.includes('foto_do_pedro_so_aqui')));
  assert.ok(telas[7].metrics.elementos.includes('foto_do_pedro_so_aqui') && telas[7].metrics.elementos.includes('sem_selo'));
  const semFoto = await Arte.renderizarCarrossel(c.slides, { nome: 'Lumen Pets', pais: 'EUA', categoria: 'servico', fotos: {} });
  assert.ok(semFoto[0].metrics.elementos.includes('sem_foto'), 'sem foto real a capa é tipográfica, não genérica');
});
test('texto que não cabe bloqueia a arte (cabe:false) em vez de ser espremido', async () => {
  const c = await Copy.gerarCopia(opLumen(), { deps: { pedirJson: F.fakePedirJson() } });
  const s = JSON.parse(JSON.stringify(c.slides)); s[1].corpo = 'palavra comprida demais '.repeat(60);
  const [t] = (await Arte.renderizarCarrossel([s[1]], { nome: 'x' }));
  assert.strictEqual(t.metrics.cabe, false); assert.ok(t.metrics.problemas.length);
});

// ── ZIP e ficha ────────────────────────────────────────────────────────────────────────
test('ZIP: o pacote lê de volta com CRC conferido', () => {
  const z = Pacote.montarZip([{ nome: 'slide-01.png', dados: Buffer.from('png') }, { nome: 'legenda.txt', dados: 'olá ✓' }]);
  const l = Pacote.lerZip(z); assert.deepStrictEqual(l.map((x) => x.nome), ['slide-01.png', 'legenda.txt']); assert.strictEqual(l[1].dados.toString(), 'olá ✓');
  z[43] ^= 0xff; assert.throws(() => Pacote.lerZip(z), /CRC|corromp|inválido/);
});
test('ficha de fontes traz URL, veículo, data, trecho, consulta, confiança e limitações de cada afirmação', async () => {
  const { verificacao } = await verificarFixture('Lumen Pets');
  const f = Pacote.fichaDeFontes({ nome: 'Lumen Pets', pais: 'EUA', pontuacao: 100, verificacao }, { criado_em: '2026-10-25T10:00:00Z', imagens: [] });
  for (const trecho of ['https://lumenpets.com', 'Trecho que comprova', 'consultada em', 'Confiança:', 'segundo a empresa', 'Data da publicação']) assert.ok(f.markdown.includes(trecho), trecho);
  assert.ok(f.json.verificacao.claims.length > 0);
});

// ── Cron, fuso e agenda ────────────────────────────────────────────────────────────────
test('cron diário: 07:00 de Brasília = 10:00 UTC, uma vez por dia', () => {
  const vercel = require('../../vercel.json');
  const c = vercel.crons.find((x) => x.path === '/api/radar/cron'); assert.strictEqual(c.schedule, '0 10 * * *');
  assert.strictEqual(U.proximaExecucao(Date.parse('2026-10-25T09:59:00Z')), '2026-10-25T10:00:00.000Z');
  assert.strictEqual(U.proximaExecucao(Date.parse('2026-10-25T10:00:00Z')), '2026-10-26T10:00:00.000Z');
  assert.strictEqual(U.proximaExecucao(Date.parse('2026-12-31T23:00:00Z')), '2027-01-01T10:00:00.000Z');
  assert.strictEqual(U.diaBRT(Date.parse('2026-10-25T02:30:00Z')), '2026-10-24', 'às 23:30 de Brasília ainda é o dia anterior');
  assert.ok(vercel.functions['api/radar-worker.js'].experimentalTriggers.some((t) => t.topic === 'pedro-radar'));
  assert.match(require('fs').readFileSync(require('path').join(__dirname, 'access.js'), 'utf8'), /radar\\\/cron/);
});
test('nada é publicado automaticamente: o Radar não importa publicador, Meta nem Facebook', () => {
  const fs = require('fs'); const path = require('path');
  const arquivos = [...fs.readdirSync(path.join(__dirname, 'radar')).map((f) => path.join(__dirname, 'radar', f)), path.join(__dirname, '..', 'routes', 'radar.js'), path.join(__dirname, '..', '..', 'api', 'radar-worker.js')];
  for (const a of arquivos) { const t = fs.readFileSync(a, 'utf8'); assert.ok(!/require\([^)]*(publicador|\/meta|publishers|routes\/publish)/.test(t), `${path.basename(a)} importa código de publicação`); assert.ok(!/graph\.facebook|media_publish/.test(t)); }
});

// ── Persistência ───────────────────────────────────────────────────────────────────────
test('persistência: documentos do Radar ficam no armazém com controle de revisão', async () => {
  novoBanco(); const store = require('./radar/store');
  await store.salvar('oportunidade', 'op_1', { nome: 'A' }, 0);
  await assert.rejects(() => store.salvar('oportunidade', 'op_1', { nome: 'B' }, 0), (e) => e.code === 'CONFLITO');
  const { rev } = await store.obter('oportunidade', 'op_1'); await store.salvar('oportunidade', 'op_1', { nome: 'C' }, rev);
  assert.strictEqual((await store.obter('oportunidade', 'op_1')).doc.nome, 'C');
  await store.arquivoSalvar('x.png', Buffer.from([1, 2, 3]), 'image/png'); assert.deepStrictEqual([...(await store.arquivoObter('x.png')).dados], [1, 2, 3]);
  assert.strictEqual((await A.armazem().conteudos.listar(store.conta())).length, 0, 'nada do Radar aparece na biblioteca da Mesa');
  A._definir(null); assert.strictEqual(store.disponivel(), false);
  await assert.rejects(() => store.listar('oportunidade'), (e) => e.code === 'SEM_BANCO');
});

test('só matéria: o site oficial citado nas matérias é aberto, conferido e passa a valer como fonte oficial', async () => {
  const item = (id, url, fonte) => ({ id, titulo: 'Lumen Pets lança', url, resumo: '', fonte_id: fonte, fonte_nome: fonte, fonte_classe: 'imprensa', publicada_em: '2026-10-22T00:00:00Z' });
  const cand = Cand.normalizar({ nome: 'Lumen Pets', itens: ['a', 'b'], interesse: 3 }, new Map([['a', item('a', 'https://techcrunch.com/2026/10/lumenpets', 'techcrunch')], ['b', item('b', 'https://exame.com/2026/10/lumenpets', 'exame')]]));
  assert.strictEqual(cand.url_oficial, null); assert.strictEqual(cand.url_sugerida, null);
  const { verificacao: v } = await V.verificar(cand, { deps: { lerFonte: F.fakeLerFonte, pedirJson: F.fakePedirJson(), loja: false }, agora: Date.parse('2026-10-25T12:00:00Z') });
  assert.strictEqual(v.estado, 'verificada'); assert.ok(v.fonte_oficial && /lumenpets\.com/.test(v.fonte_oficial.url));
  assert.ok(v.claims.some((c) => c.tipo === 'receita' && c.usavel && c.atribuicao === 'segundo a empresa'));
  // o endereço inventado pela IA, que não está nas matérias e não leva o nome da empresa, é recusado
  const pedirMentiroso = async (o) => { const r = await F.fakePedirJson()(o); if (/Você confere fatos/.test(o.sistema)) r.dados.site_oficial = 'https://site-aleatorio.com'; return r; };
  const { verificacao: v2 } = await V.verificar(cand, { deps: { lerFonte: F.fakeLerFonte, pedirJson: pedirMentiroso, loja: false }, agora: Date.parse('2026-10-25T12:00:00Z') });
  assert.ok(!v2.fonte_oficial); assert.ok(v2.limitacoes.some((l) => /não está escrito/.test(l)));
});
test('segunda fonte sem busca nova: matérias de outros veículos que citam o negócio pelo nome são juntadas', () => {
  const it = (id, host, titulo) => ({ id, titulo, url: `https://${host}/x/${id}`, resumo: '', fonte_id: host, fonte_nome: host, fonte_classe: 'imprensa', publicada_em: '2026-10-20' });
  const cand = Cand.normalizar({ nome: 'Quiva', itens: ['i1'] }, new Map([['i1', it('i1', 'startups.com.br', 'Quiva reúne surfistas')]]));
  const pool = [it('i1', 'startups.com.br', 'Quiva reúne surfistas'), it('i2', 'exame.com', 'Como a Quiva quer dominar o surfe'), it('i3', 'neofeed.com.br', 'Outra startup qualquer'), it('i4', 'startups.com.br', 'Quiva de novo no mesmo site')];
  const r = Cand.reforcarFontes(cand, pool);
  assert.deepStrictEqual(r.fontes_itens.map((f) => f.id), ['i1', 'i2']); assert.strictEqual(r.fontes_reforcadas, 1);
  assert.strictEqual(Cand.reforcarFontes(Cand.normalizar({ nome: 'Data', itens: ['i1'] }, new Map([['i1', pool[0]]])), pool).fontes_itens.length, 1, 'nome genérico não é usado para juntar fontes');
});
test('coleta: catálogo (Product Hunt, Show HN) não afoga as reportagens e a nota prévia prefere quem tem dado', () => {
  const mk = (i, classe) => ({ id: `i${i}${classe}`, titulo: `Produto numero ${i} ${classe} lançamento especial`, url: `https://s${i}${classe}.com/a`, resumo: '', fonte_id: `${classe}${i % 3}`, fonte_nome: classe, fonte_classe: classe, publicada_em: new Date().toISOString(), pontos: classe === 'comunidade' ? 80 : null });
  const itens = [...Array.from({ length: 80 }, (_, i) => mk(i, 'plataforma')), ...Array.from({ length: 40 }, (_, i) => mk(i, 'comunidade')), ...Array.from({ length: 30 }, (_, i) => mk(i, 'imprensa'))];
  const p = Fontes.preparar(itens, { porFonte: 100 });
  const por = (c) => p.itens.filter((i) => i.fonte_classe === c).length;
  assert.ok(por('plataforma') <= 40 && por('comunidade') <= 24 && por('imprensa') === 30, `${por('plataforma')}/${por('comunidade')}/${por('imprensa')}`);
  const base = { interesse: 2, sinais_de_risco: [], investimento_para_testar: { nivel: 'medio' } };
  const comDado = { ...base, dados_no_material: true, url_oficial: null, url_sugerida: null, fontes_itens: [{ fonte_classe: 'imprensa', url: 'https://a.com/1' }, { fonte_classe: 'imprensa', url: 'https://b.com/1' }] };
  const catalogo = { ...base, dados_no_material: false, url_oficial: null, url_sugerida: 'https://x.com', fontes_itens: [{ fonte_classe: 'plataforma', url: 'https://producthunt.com/x' }] };
  assert.ok(Cand.notaPrevia(comDado) > Cand.notaPrevia(catalogo) + 8);
});

test('copy: a atribuição entra na tela de prova, metas de contagem da hipótese são aceitas e as falhas ficam gravadas para a próxima chamada', async () => {
  const op = opLumen();
  const base = (mut) => { const j = JSON.parse(JSON.stringify({ slides: [{ n: 1, texto: 'Segundo a empresa, esse serviço de banho já tem 120 mil clientes' }, { n: 2, problema: 'dar banho no cachorro em casa vira bagunça e o pet shop vive lotado' }, { n: 3, produto: 'um serviço que leva o banhista até a porta', resultado: 'o cachorro ficar limpo sem você sair' }, { n: 4, modelo: 'assinatura', explicacao: 'o cliente paga uma mensalidade fixa e recebe visitas toda semana' }, { n: 5, titulo: 'O que a empresa mostra', itens: [{ claim_id: 'c1', rotulo: 'clientes' }] }, { n: 6, dor: 'dor de todo dono', facilidade: 'serviço na porta', recorrencia: 'cobrança mensal' }, { n: 7, publico_inicial: 'donos de cães', produto_minimo: 'banho em domicílio', canal_de_vendas: 'grupos de condomínio', forma_de_cobranca: 'pacote mensal', teste_baixo_custo: '30 clientes' }] })); mut(j); const m = Copy.montarTelas(j, op); return { m, erros: [...m.erros, ...Copy.validarTelas(m.slides, op)] }; };
  const r = base(() => {}); assert.deepStrictEqual(r.erros, []);
  assert.ok(r.m.slides[4].texto.includes('segundo a empresa') && r.m.slides[4].palavras >= 8, 'a atribuição faz parte da tela de prova');
  assert.ok(base((j) => { j.slides[6].teste_baixo_custo = 'R$ 500 de teste'; }).erros.some((e) => /sem comprovação/.test(e)), 'dinheiro na hipótese continua proibido');
  const falhas = [];
  const ruim = async () => ({ llm: {}, dados: { slides: [{ n: 1, texto: 'curto' }] } });
  await assert.rejects(() => Copy.gerarCopia(op, { deps: { pedirJson: ruim, aoFalhar: async (i) => { falhas.push(i); } }, tentativas: 2 }), /COPY_INVALIDA|não passou/);
  assert.strictEqual(falhas.length, 2); assert.ok(falhas[1].feedback.length > 20);
});

test('copy: a frase de abertura repetida pela IA é removida e "que faz" não duplica', () => {
  const op = opLumen();
  const j = { slides: [{ n: 1, texto: 'x' }, { n: 2, problema: 'Tudo começou com um problema comum: o pet shop vive lotado e ninguém tem tempo.' }, { n: 3, produto: 'criar um serviço de banho em casa', resultado: 'faz o cachorro ficar limpo sem sair' }, { n: 4, modelo: 'assinatura', explicacao: 'O dinheiro entra assim: o cliente paga uma mensalidade fixa por semana' }, { n: 5, titulo: 't', itens: [] }, { n: 6, dor: 'dor', facilidade: 'f', recorrencia: 'r' }, { n: 7 }] };
  const m = Copy.montarTelas(j, op);
  assert.strictEqual(m.slides[1].texto, 'Tudo começou com um problema comum: o pet shop vive lotado e ninguém tem tempo.');
  assert.strictEqual(m.slides[2].texto, 'A solução foi criar um serviço de banho em casa que faz o cachorro ficar limpo sem sair.');
  assert.strictEqual(m.slides[3].texto, 'O dinheiro entra assim: o cliente paga uma mensalidade fixa por semana.');
});

test('copy: "que faz" seguido de outro verbo conjugado é recusado', () => {
  const op = opLumen();
  const j = (res) => ({ slides: [{ n: 1, texto: 'x' }, { n: 2, problema: 'dar banho no cachorro em casa vira bagunça e o pet shop vive lotado' }, { n: 3, produto: 'um aplicativo de gestão que faz', resultado: res }, { n: 4, modelo: 'assinatura', explicacao: 'o cliente paga uma mensalidade fixa e recebe visitas toda semana' }, { n: 5, titulo: 't', itens: [] }, { n: 6, dor: 'dor', facilidade: 'f', recorrencia: 'r' }, { n: 7 }] });
  const erros = (res) => { const m = Copy.montarTelas(j(res), op); return Copy.validarTelas(m.slides, op); };
  assert.ok(erros('rastreia referências e paga comissões').some((e) => /Tela 3: depois de/.test(e)));
  assert.ok(!erros('os pagamentos de comissão acontecerem sozinhos').some((e) => /Tela 3: depois de/.test(e)));
});

test('copy: item solto de uma palavra na tela 6 é recusado', () => {
  const op = opLumen(); const j = (a) => ({ slides: [{ n: 1, texto: 'x' }, { n: 2, problema: 'dar banho no cachorro em casa vira bagunça e o pet shop vive lotado' }, { n: 3, produto: 'um serviço de banho', resultado: 'o cachorro ficar limpo sem sair' }, { n: 4, modelo: 'assinatura', explicacao: 'o cliente paga uma mensalidade fixa e recebe visitas toda semana' }, { n: 5, titulo: 't', itens: [] }, { n: 6, dor: a, facilidade: 'serviço na porta', recorrencia: 'cobrança mensal' }, { n: 7 }] });
  const e = (a) => Copy.validarTelas(Copy.montarTelas(j(a), op).slides, op);
  assert.ok(e('mensal').some((x) => /Tela 6/.test(x))); assert.ok(!e('dor de todo dono').some((x) => /Tela 6: cada/.test(x)));
});

test('copy: atribuição esquecida pela IA é acrescentada na frase do número (a fonte, nunca o dado)', () => {
  const claims = opLumen().verificacao.claims;
  assert.strictEqual(Copy.repararAtribuicao('Esse serviço tem 120 mil clientes e cresce.', claims), 'Esse serviço tem 120 mil clientes e cresce, segundo a empresa.');
  assert.strictEqual(Copy.repararAtribuicao('Já são 120 mil clientes, segundo a empresa.', claims), 'Já são 120 mil clientes, segundo a empresa.');
  assert.strictEqual(Copy.repararAtribuicao('Sem número nenhum aqui.', claims), 'Sem número nenhum aqui.');
  const l = Copy.montarLegenda({ legenda: { primeira_linha: 'Mais de 120 mil clientes usam o serviço.', resumo: 'Banho em casa.', como_ganha: 'Assinatura mensal.', brasil: 'Dá para testar em condomínios.' }, hashtags: ['negocios', 'saas'] }, opLumen());
  assert.deepStrictEqual(l.erros.filter((e) => /atribuição/.test(e)), []); assert.match(l.texto, /120 mil clientes usam o serviço, segundo a empresa\./);
});
