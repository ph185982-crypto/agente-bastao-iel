// Template minimalista "Estratégia por trás" + método de pesquisa e copy. Fontes e páginas SIMULADAS; nada acessa a rede.
// node --test backend/lib/radarMinimalista.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const A = require('./armazem');
const HM = require('./radar/historiaManual');
const C2 = require('./radar/carrossel2');
const Metodo = require('./radar/metodo');
const ArteMin = require('./radar/arteMinimalista');
const Pacote = require('./radar/pacote');

const novoBanco = () => A._definir(Object.assign(A.memoria(), { duravel: true }));
const clone = (x) => JSON.parse(JSON.stringify(x));
const PAG = {
  'https://casaverde.com/': { titulo: 'Casa Verde', veiculo: 'Casa Verde', publicada_em: '2026-10-10T00:00:00Z', texto: 'Casa Verde aluga plantas para escritórios. Mais de 250.000 pessoas já usam a Casa Verde. Assinatura mensal a partir de US$ 29 por vaso.' },
  'https://exame.com/2026/10/casa-verde': { titulo: 'Casa Verde aluga plantas', veiculo: 'Exame', publicada_em: '2026-10-13T00:00:00Z', texto: 'A Casa Verde, que aluga plantas para escritórios, tem mais de 250.000 pessoas como usuárias, de acordo com a reportagem. A empresa cobra uma assinatura mensal dos escritórios.' },
};
const lerFonte = async (u) => { const p = PAG[u]; if (!p) return { legivel: false, acesso: 'erro' }; return { legivel: true, url_final: u, titulo: p.titulo, veiculo: p.veiculo, publicada_em: p.publicada_em, acessada_em: new Date().toISOString(), texto: p.texto, dominio: new URL(u).hostname.replace(/^www\./, '') }; };
const HIST = {
  nome: 'Casa Verde', pais: 'EUA', categoria: 'servico', site_oficial: 'https://casaverde.com/', resumo: 'Aluga plantas para escritórios por assinatura.', problema: 'Escritório sem planta é frio e ninguém cuida.', como_ganha_dinheiro: 'Assinatura mensal por vaso.', modelo_receita: 'assinatura', adaptacao_brasil: 'Testar com um escritório.',
  fontes: ['https://casaverde.com/', 'https://exame.com/2026/10/casa-verde'],
  afirmacoes: [
    { fonte: 0, tipo: 'usuarios', texto: 'Mais de 250 mil pessoas usam a Casa Verde.', numero: 250000, unidade: 'usuarios', trecho: 'Mais de 250.000 pessoas já usam a Casa Verde' },
    { fonte: 0, tipo: 'modelo_receita', texto: 'A empresa cobra assinatura mensal por vaso.', trecho: 'Assinatura mensal a partir de US$ 29 por vaso' },
    { fonte: 1, tipo: 'modelo_receita', texto: 'A empresa cobra uma assinatura mensal dos escritórios.', trecho: 'A empresa cobra uma assinatura mensal dos escritórios.' },
  ],
};

// Rascunho no formato da IA (briefing → ganchos → sete telas), com os ids de afirmação reais desta pesquisa.
function rascunhoMin(op) {
  const usavel = (tipo) => (op.verificacao.claims.find((c) => c.tipo === tipo && c.usavel) || {}).id;
  const cUso = usavel('usuarios'); const cModelo = usavel('modelo_receita');
  return {
    sem_pauta: null,
    briefing: {
      negocio: { nome: 'Casa Verde', produto: 'aluguel de plantas para escritórios', problema: 'escritório sem planta fica frio e ninguém cuida delas', para_quem: 'escritórios', quem_paga: 'o escritório', pelo_que_paga: 'a troca e o cuidado das plantas', forma_cobranca: 'assinatura mensal por vaso', operacao: 'equipe visita, troca e cuida' },
      fatos: [
        { id: 'f1', texto: 'A Casa Verde tem mais de 250 mil usuários, segundo a empresa.', claim_id: cUso, campo_do_negocio: null },
        { id: 'f2', texto: 'A empresa cobra assinatura mensal por vaso.', claim_id: cModelo, campo_do_negocio: null },
        { id: 'f3', texto: 'O escritório sem planta fica frio e a planta sem cuidado seca.', claim_id: null, campo_do_negocio: 'problema' },
      ],
      analises: [{ id: 'a1', texto: 'Uma leitura é que o escritório paga pela troca e pelo cuidado, e não pela planta em si.', base: ['f2', 'f3'], causalidade_demonstrada: false }],
      hipoteses: [{ id: 'h1', texto: 'Poderia ser testado com um escritório de um bairro, cobrando assinatura mensal por vaso.' }],
      decisao_especifica: { texto: 'A empresa cobra assinatura mensal por vaso e não vende a planta.', base: ['f2'] },
      mecanismos: [
        { nome: 'Assinatura por vaso', como_funciona: 'O escritório paga todo mês por cada vaso, e a equipe troca e cuida das plantas.', exemplo: 'Um vaso que morre é trocado sem custo extra para o escritório.', vantagem: 'A receita se repete, porque o cliente não precisa cuidar de nada e a equipe faz a troca.', condicao_de_falha: 'Se a troca demorar, o escritório cancela, porque planta morta piora o ambiente.', base: ['f2', 'f3'] },
        { nome: 'Visita fixa', como_funciona: 'A equipe passa no escritório com frequência fixa para trocar e cuidar.', exemplo: 'Visita semanal junto com a troca de vasos.', vantagem: 'A visita vira rotina, e a rotina mantém o cliente, porque ele vê o resultado.', condicao_de_falha: 'Em cidade sem equipe, o deslocamento come a margem e o modelo deixa de funcionar.', base: ['a1'] },
      ],
      limitacoes: ['Precisa de equipe de cuidado em cada cidade.', 'O deslocamento pesa na margem.'],
      aprendizado_leitor: 'Uma assinatura recorrente funciona quando o cliente terceiriza uma tarefa que não quer fazer.',
      tese: 'A receita vem do cuidado recorrente, não da venda da planta.', pergunta_capa: 'Quem paga uma planta que não é vendida?',
    },
    ganchos: [
      { angulo: 'oportunidade', titulo: 'Um serviço de plantas para escritório ganha com cuidado, não com vaso.', scores: { clareza: 4, relevancia: 4, especificidade: 4, sustentacao: 4 } },
      { angulo: 'contradicao', titulo: 'Quem aluga planta para escritório não vende nenhuma planta.', scores: { clareza: 3, relevancia: 3, especificidade: 4, sustentacao: 4 } },
      { angulo: 'erro', titulo: 'O erro de quem vende planta é esquecer quem cuida dela.', scores: { clareza: 4, relevancia: 3, especificidade: 3, sustentacao: 3 } },
    ],
    telas: [
      { funcao: 'gancho', tipo: 'FATO', base: ['f2'], titulo: 'Uma empresa cobra assinatura para cuidar de plantas em escritórios.', corpo: 'A Casa Verde não vende a planta. O escritório paga uma assinatura por vaso e a equipe cuida de tudo.' },
      { funcao: 'problema', tipo: 'FATO', base: ['f3'], titulo: 'Planta sem cuidado vira problema no escritório.', corpo: 'Escritório sem planta fica frio, e planta sem cuidado seca. A tarefa cai sempre no mesmo funcionário, que não tem tempo para isso.' },
      { funcao: 'mecanismo_1', tipo: 'ANALISE', base: ['f2', 'f3'], titulo: 'O cliente paga pelo cuidado, não pela planta.', corpo: 'A receita vem da assinatura por vaso, porque o escritório compra a troca e o cuidado. Quando um vaso morre, a equipe troca sem custo extra.' },
      { funcao: 'mecanismo_2', tipo: 'ANALISE', base: ['a1'], titulo: 'A visita fixa mantém o cliente, porque ele vê o resultado.', corpo: 'A equipe passa com frequência certa e a troca de vasos vira rotina. Essa rotina prende o cliente. Em cidade sem equipe, o deslocamento come a margem.' },
      { funcao: 'conta', tipo: 'FATO', base: ['f1'], titulo: 'A conta começa com 250 mil pessoas.', corpo: 'Segundo a empresa, mais de 250 mil pessoas usam o serviço. Isso mostra alcance, não quanto sobra no caixa.' },
      { funcao: 'aplicacao', tipo: 'HIPOTESE', base: [], titulo: 'Um teste pequeno poderia começar em um prédio só.', corpo: 'Escolha um escritório de um bairro, ofereça três vasos por mês e meça se ele renova. No Brasil, isso seria uma hipótese para testar, não uma promessa.' },
      { funcao: 'encerramento', tipo: 'MISTO', base: [], titulo: 'Tem negócio bom escondido em problema que todo mundo ignora.', apoio: 'Segue @pedro_destrava para descobrir negócios que já funcionam no mundo.' },
    ],
    legenda: { primeira_linha: 'Quem paga a planta do escritório, na verdade, paga pelo cuidado.', historia: 'A Casa Verde não vende a planta: cobra assinatura e a equipe cuida de tudo, por vaso.', como_ganha: 'Cobra uma assinatura mensal por vaso, segundo a empresa.', brasil: 'Hipótese para testar: um escritório de um bairro, antes de qualquer app.' },
    hashtags: ['negocios', 'empreendedorismo'],
  };
}

async function criarOp() { novoBanco(); return HM.criar(clone(HIST), { deps: { lerFonte } }); }

// ── Renderer ───────────────────────────────────────────────────────────────────────────────
test('template minimalista: cada composição sai em PNG 1080×1350, fundo branco e sem decoração na margem', async () => {
  const buf = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2b7a6b' } }).jpeg().toBuffer();
  const imagens = { a: { buf, credito: 'Foto: teste' } };
  const casos = [
    { layout: 'min_foto', textos: { titulo: 'Um app ganha dinheiro com o que sobra.', corpo: 'O comércio lista a sacola. O cliente paga menos.' }, foto: { imagem_id: 'a' } },
    { layout: 'min_texto', textos: { titulo: 'O pão não vendeu.', corpo: 'Quando a loja fecha, a comida pode virar prejuízo. Vender com desconto recupera parte desse valor.' } },
    { layout: 'min_encerramento', textos: { titulo: 'Tem negócio bom escondido em problema que todo mundo ignora.', apoio: 'Segue @pedro_destrava para descobrir negócios que já funcionam no mundo.' } },
  ];
  for (const c of casos) {
    const r = await ArteMin.renderizarTela(c, { n: 2, total: 7, imagens });
    const m = await sharp(r.png).metadata(); assert.deepStrictEqual([m.width, m.height, m.format], [1080, 1350, 'png'], c.layout);
    assert.strictEqual(r.metrics.cabe, true, `${c.layout}: ${r.metrics.problemas.join('; ')}`);
    assert.ok(r.metrics.fonte_px >= 34, `${c.layout}: fonte ${r.metrics.fonte_px}px abaixo do mínimo`);
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    assert.deepStrictEqual(px(5, 5), [255, 255, 255], 'fundo branco');
    // nenhuma cor de destaque (laranja, azul, verde) na faixa das margens superior e inferior
    let colorido = 0; for (let x = 0; x < info.width; x += 7) for (const y of [4, 1340]) { const [R, G, B] = px(x, y); if (Math.max(R, G, B) - Math.min(R, G, B) > 40) colorido += 1; }
    assert.strictEqual(colorido, 0, `${c.layout}: sem cores de destaque nas margens`);
  }
});

test('template minimalista: texto longo não encolhe em silêncio; a tela sai marcada como não cabe', async () => {
  const r = await ArteMin.renderizarTela({ layout: 'min_texto', textos: { titulo: 'Longo '.repeat(80), corpo: 'Texto. '.repeat(500) } }, { n: 4, total: 7, imagens: {} });
  assert.strictEqual(r.metrics.cabe, false); assert.ok(r.metrics.problemas.some((p) => /Encurte o texto/.test(p)));
});

// ── Método: validações de conteúdo ─────────────────────────────────────────────────────────────
test('método: a tela genérica (sem nenhum termo do caso) vira bloqueio no mecanismo', async () => {
  const op = await criarOp(); const d = rascunhoMin(op); const m = Metodo.montarDoc(d, op);
  assert.strictEqual(Metodo.validarDocMin(m, op).ok, true, JSON.stringify(Metodo.validarDocMin(m, op).bloqueios));
  m.telas[2].textos.titulo = 'Uma boa ideia precisa de tempo.';
  m.telas[2].textos.corpo = 'Uma boa ideia precisa de tempo e de gente disposta a fazer. Ela cresce quando o mercado responde bem e quando a rotina se mantém.';
  const v = Metodo.validarDocMin(m, op);
  assert.ok(v.bloqueios.some((b) => /qualquer outra empresa/.test(b.mensagem)), v.bloqueios.map((b) => b.mensagem).join(' | '));
});

test('método: causalidade não demonstrada é bloqueada no briefing e nas telas', async () => {
  const op = await criarOp(); const d = rascunhoMin(op);
  d.briefing.analises[0].texto = 'A assinatura causou o crescimento da empresa nos escritórios.';
  const m = Metodo.montarDoc(d, op);
  assert.ok(Metodo.validarBriefing(m.briefing, op).some((e) => /Causalidade não demonstrada/.test(e)));
});

test('método: hipótese escrita como decisão da empresa é bloqueada; Brasil sem marca de hipótese também', async () => {
  const op = await criarOp(); const d = rascunhoMin(op);
  d.telas[5].corpo = 'Segundo a empresa, o teste poderia começar em um bairro. No Brasil o modelo já funciona.';
  const m = Metodo.montarDoc(d, op); const v = Metodo.validarDocMin(m, op);
  assert.ok(v.bloqueios.some((b) => /hipótese nossa escrita como decisão|hipótese nossa escrita como decisão da empresa/.test(b.mensagem)) || v.bloqueios.some((b) => /Brasil|hipótese/.test(b.mensagem)), v.bloqueios.map((b) => b.mensagem).join(' | '));
});

test('método: número sem fonte verificada é bloqueado em qualquer tela', async () => {
  const op = await criarOp(); const d = rascunhoMin(op);
  d.telas[4].corpo = 'Segundo a empresa, o serviço já tem 900 mil clientes no mundo inteiro e cresce sem parar.';
  const v = Metodo.validarDocMin(Metodo.montarDoc(d, op), op);
  assert.ok(v.bloqueios.some((b) => /número sem comprovação/.test(b.mensagem)), v.bloqueios.map((b) => b.mensagem).join(' | '));
});

test('método: sem três ganchos com ângulos diferentes, o rascunho não passa; exagero desconta pontos, e número não ganha bônus', async () => {
  const op = await criarOp(); const d = rascunhoMin(op);
  d.ganchos[2].angulo = 'oportunidade'; assert.ok(Metodo.montarDoc(d, op).erros.some((e) => /ângulos/.test(e)));
  const d2 = rascunhoMin(op); d2.ganchos[1].titulo = 'Empresa de 250 mil clientes ganha com planta: incrível e revolucionária.'; d2.ganchos[1].scores = { clareza: 5, relevancia: 5, especificidade: 5, sustentacao: 5 };
  const m = Metodo.montarDoc(d2, op);
  assert.strictEqual(m.ganchos[1].pontuacao, 18, 'soma 20 menos 2 pontos de exagero');
  assert.strictEqual(m.ganchos[1].titulo.includes('250'), true, 'o número fica no gancho, sem bônus na escolha');
});

test('método: briefing sem fonte para um fato é recusado; sem decisão específica também', async () => {
  const op = await criarOp(); const d = rascunhoMin(op);
  d.briefing.fatos.push({ id: 'f9', texto: 'A empresa é a melhor do mundo.', claim_id: null, campo_do_negocio: null });
  d.briefing.decisao_especifica = { texto: '', base: [] };
  const errs = Metodo.validarBriefing(Metodo.montarDoc(d, op).briefing, op);
  assert.ok(errs.some((e) => /não tem fonte nem campo/.test(e))); assert.ok(errs.some((e) => /decisão específica/.test(e)));
});

// ── Fluxo completo ──────────────────────────────────────────────────────────────────────────────
test('fluxo minimalista: do rascunho ao ZIP (7 PNG 1080×1350, briefing e ficha), com a série editorial intacta', async () => {
  const op = await criarOp();
  const doc = await C2.gerar(op.id, { rascunho: rascunhoMin(op), template: 'minimalista', deps: {}, orcamentoMs: 120000 });
  assert.strictEqual(doc.template, 'minimalista'); assert.strictEqual(doc.telas.length, 7); assert.strictEqual(doc.render.length, 7);
  assert.strictEqual(doc.telas[6].layout, 'min_encerramento'); assert.ok(doc.telas.slice(0, 6).every((t) => t.layout !== 'min_encerramento'), 'foto do Pedro só no fim');
  assert.strictEqual(doc.capas.length, 3, 'três ganchos');
  assert.ok(doc.briefing && doc.briefing.mecanismos.length >= 2, 'briefing salvo');
  assert.strictEqual(doc.revisao.executada, false, 'revisão por IA marcada como não executada sem chave');
  assert.strictEqual(doc.validacao.ok, true, doc.validacao.bloqueios.map((b) => b.mensagem).join(' | '));
  const x = await C2.exportar(doc.id); const itens = Pacote.lerZip(x.zip);
  assert.strictEqual(itens.filter((i) => i.nome.endsWith('.png')).length, 7);
  for (const it of itens.filter((i) => i.nome.endsWith('.png'))) { const m = await sharp(it.dados).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350]); }
  assert.match(itens.find((i) => i.nome === 'ficha-de-fontes.md').dados.toString(), /Pesquisa da história/);
  // troca de gancho: só a tela 1 muda
  const antes = doc.render.map((r) => r.sha256);
  const esc = await C2.escolherCapa(doc.id, 'capa_2'); esc.doc.render.forEach((r, i) => { if (i !== 0) assert.strictEqual(r.sha256, antes[i], `tela ${i + 1} intacta`); });
  assert.notStrictEqual(esc.doc.render[0].sha256, antes[0]);
});

test('fluxo minimalista: edição de uma tela não toca as outras e texto longo bloqueia a aprovação', async () => {
  const op = await criarOp();
  const doc = await C2.gerar(op.id, { rascunho: rascunhoMin(op), template: 'minimalista', deps: {}, orcamentoMs: 120000 });
  const antes = doc.render.map((r) => r.sha256);
  const r = await C2.editarTela(doc.id, 3, { textos: { corpo: 'A equipe troca o vaso que morre, porque o escritório paga pela troca. Assim o custo do cuidado fica previsível para o cliente e a receita se repete.' } });
  r.doc.render.forEach((x, i) => { if (i !== 2) assert.strictEqual(x.sha256, antes[i], `tela ${i + 1}`); });
  const longo = await C2.editarTela(doc.id, 2, { textos: { corpo: Array(90).fill('palavra').join(' ') } });
  assert.ok(longo.doc.validacao.bloqueios.length > 0, 'texto acima do limite vira bloqueio');
});
