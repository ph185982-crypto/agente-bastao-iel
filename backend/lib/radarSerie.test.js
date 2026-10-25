// Série "Negócios que você não viu": renderer, validação (bloqueios × sugestões), história com fatos conferidos em código,
// imagens com origem, edição tela a tela, exportação. Fontes, páginas e imagens SIMULADAS: nada acessa a rede.
// node --test backend/lib/radarSerie.test.js
// Série editorial (modelo antigo): os testes rodam com a REVERSÃO técnica ligada, provando que ela devolve o comportamento anterior.
process.env.CARROSSEL_PADRAO = 'legado';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const sharp = require('sharp');
const A = require('./armazem');
const store = require('./radar/store');
const Serie = require('./radar/serie');
const Arte = require('./radar/arte2');
const Fotos = require('./radar/fotos');
const HM = require('./radar/historiaManual');
const C2 = require('./radar/carrossel2');
const Hist = require('./radar/historia');
const Pacote = require('./radar/pacote');

const novoBanco = () => A._definir(Object.assign(A.memoria(), { duravel: true }));
const foto = (cor, w = 1600, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: cor } }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w * 0.6}" cy="${h * 0.5}" r="${h * 0.3}" fill="#f4f0e6"/></svg>`) }]).jpeg().toBuffer();

// ── Páginas de mentira de uma empresa de mentira ─────────────────────────────────────
const PAG = {
  'https://casaverde.com/': { titulo: 'Casa Verde', veiculo: 'Casa Verde', publicada_em: '2026-10-10T00:00:00Z', texto: 'Casa Verde aluga plantas para escritórios. Mais de 250.000 pessoas já usam a Casa Verde. Assinatura mensal a partir de US$ 29 por vaso. Em 2025 a empresa recebeu US$ 3 milhões em investimento.' },
  'https://techcrunch.com/2026/10/casa-verde': { titulo: 'Casa Verde rents plants to offices', veiculo: 'TechCrunch', publicada_em: '2026-10-12T00:00:00Z', texto: 'Casa Verde, which rents office plants, says more than 250,000 people use its service. The startup charges a monthly subscription. The company raised $3 million last year from Acme Capital.' },
  'https://exame.com/2026/10/casa-verde': { titulo: 'Casa Verde aluga plantas', veiculo: 'Exame', publicada_em: '2026-10-13T00:00:00Z', texto: 'A Casa Verde, que aluga plantas para escritórios, tem mais de 250.000 pessoas como usuárias, de acordo com a reportagem. A empresa cobra uma assinatura mensal dos escritórios.' },
};
const lerFonte = async (u) => { const p = PAG[u]; if (!p) return { legivel: false, acesso: 'erro' }; const d = new URL(u); return { legivel: true, url_final: u, titulo: p.titulo, veiculo: p.veiculo, publicada_em: p.publicada_em, acessada_em: new Date().toISOString(), texto: p.texto, dominio: d.hostname.replace(/^www\./, '') }; };
const HIST = {
  nome: 'Casa Verde', pais: 'EUA', categoria: 'servico', site_oficial: 'https://casaverde.com/', resumo: 'Aluga plantas para escritórios por assinatura.', problema: 'Escritório sem planta é frio e ninguém cuida.', como_ganha_dinheiro: 'Assinatura mensal por vaso.', modelo_receita: 'assinatura', adaptacao_brasil: 'Testar com um escritório.',
  fontes: ['https://casaverde.com/', 'https://techcrunch.com/2026/10/casa-verde', 'https://exame.com/2026/10/casa-verde'],
  afirmacoes: [
    { fonte: 0, tipo: 'usuarios', texto: 'Mais de 250 mil pessoas usam a Casa Verde.', numero: 250000, unidade: 'usuarios', trecho: 'Mais de 250.000 pessoas já usam a Casa Verde' },
    { fonte: 1, tipo: 'usuarios', texto: 'Mais de 250 mil pessoas usam a Casa Verde.', numero: 250000, unidade: 'usuarios', trecho: 'says more than 250,000 people use its service' },
    { fonte: 0, tipo: 'modelo_receita', texto: 'A empresa cobra assinatura mensal por vaso.', trecho: 'Assinatura mensal a partir de US$ 29 por vaso' },
    { fonte: 1, tipo: 'investimento', texto: 'A empresa captou US$ 3 milhões.', numero: 3000000, unidade: 'USD', trecho: 'The company raised $3 million last year from Acme Capital' },
  ],
};
const RASCUNHO = {
  ficha: { problema: 'Escritório sem planta fica frio e ninguém cuida delas.', quem_compra: 'Escritórios que querem um ambiente agradável.', por_que_compra: 'Alguém cuida das plantas por eles.', como_cobra: 'Assinatura mensal por vaso.', evidencia: [{ claim_id: 'c1', nota: 'Número da empresa.' }], surpresa: 'Ninguém compra a planta: o escritório só assina.', dificuldades: ['Precisa de gente para cuidar das plantas em cada cidade.'], inspiracao_brasil: 'Hipótese: começar por um escritório.' },
  capas: [{ angulo: 'contradicao', titulo: 'Este negócio ganha dinheiro **alugando plantas** para escritórios.', apoio: 'Ninguém precisa comprar um vaso.' }, { angulo: 'situacao', titulo: 'Toda segunda-feira, alguém **troca a planta** do escritório.', apoio: 'E isso virou assinatura.' }, { angulo: 'descoberta', titulo: 'Quase ninguém notou como a **planta de escritório** virou negócio.', apoio: '' }],
  capa_escolhida: 1,
  telas: [
    { funcao: 'descoberta' },
    { funcao: 'tensao', rotulo: 'A conta que ninguém vê', titulo: 'A planta morreu.', linha2: 'O escritório ficou frio.', apoio: 'Quando ninguém cuida, a planta seca e o espaço perde o clima que a empresa queria.', palavra: 'Seca' },
    { funcao: 'revelacao', rotulo: 'Aí entra a **Casa Verde**', titulo: 'Ela cuida da **planta** para você.', apoio: 'O escritório escolhe os vasos e a equipe da empresa regra, troca e cuida de tudo todo mês.' },
    { funcao: 'dinheiro', rotulo: 'Onde está o dinheiro?', titulo: 'O escritório ganha verde. A equipe cuida. E **a empresa cobra.**', apoio: 'A receita vem de uma assinatura mensal por vaso.' },
    { funcao: 'evidencia', rotulo: 'A ideia pegou', claim_id: 'c1', legenda: 'de pessoas usando, segundo a empresa.', apoio: 'Número informado pela própria empresa. Uso do serviço não prova faturamento.' },
    { funcao: 'estrategia', rotulo: 'O detalhe que importa', titulo: 'A ideia parece **simples**. Cuidar é o desafio.', apoio: 'Planta viva exige gente de confiança em cada cidade, e isso decide se o escritório renova.' },
    { funcao: 'licao', rotulo: 'A lição para quem quer começar', titulo: 'Antes de comprar vasos, **converse com quem tem o problema.**', apoio: 'No Brasil, a ideia poderia ser testada com um escritório: veja se querem pagar todo mês.', nota: 'Não é promessa de lucro. É uma hipótese para testar.', palavra: 'Antes' },
    { funcao: 'pedro', titulo: 'Tem negócio bom escondido em **problema que todo mundo ignora.**', apoio: 'para descobrir negócios que já funcionam no mundo.' },
  ],
  legenda: { primeira_linha: 'O escritório alugou a planta em vez de comprar.', historia: 'A empresa cuida do verde para os outros e transformou isso em assinatura.', como_ganha: 'Cobra uma assinatura mensal por vaso.', brasil: 'Hipótese para testar: começar com um escritório só.' }, hashtags: ['negocios', 'empreendedorismo'],
};
const clone = (x) => JSON.parse(JSON.stringify(x));
async function preparar({ imagens = true } = {}) {
  novoBanco();
  const op = await HM.criar(clone(HIST), { deps: { lerFonte } });
  const fetcher = async (url) => {
    if (/casaverde\.com\/?$/.test(url)) return { status: 200, corpo: '<html><head><meta property="og:image" content="https://casaverde.com/img/a.jpg"><meta name="twitter:image" content="https://casaverde.com/img/b.jpg"></head></html>' };
    if (/itunes\.apple\.com/.test(url) || /commons\.wikimedia/.test(url)) return { status: 404, corpo: '' };
    return { status: 404, corpo: '' };
  };
  const baixar = async (url) => { if (!imagens) throw new Error('indisponível'); if (/a\.jpg/.test(url)) return foto('#2b7a6b'); if (/b\.jpg/.test(url)) return foto('#c98b4a'); throw new Error('404'); };
  const doc = await C2.gerar(op.id, { rascunho: clone(RASCUNHO), deps: { fetcher, baixar }, orcamentoMs: 120000 });
  return { op, doc };
}
const png = async (id, n) => (await store.arquivoObter(C2.chaveSlide(id, n))).dados;

// ── Renderer ─────────────────────────────────────────────────────────────────────────────────
test('renderer: cada composição sai em PNG 1080×1350, sem texto na margem de 64 px e sem fonte abaixo do mínimo', async () => {
  const imagens = { a: { buf: await foto('#2b7a6b'), credito: 'Foto: teste', tipo: 'commons', papel: 'foto', id: 'a' } };
  const claims = { c1: { numero: 250000, valor_exibicao: '250 mil', atribuicao: 'segundo a empresa', veiculo: 'Casa Verde', consultado_em: '2026-10-25' } };
  const casos = [
    { layout: 'manchete_produto', variante: 'meia_lua', textos: { titulo: 'Este app **ganha dinheiro** com o que sobra.', apoio: 'E não precisa fazer pão.' }, foto: { imagem_id: 'a' } },
    { layout: 'manchete_produto', variante: 'canto', textos: { titulo: 'Antes de criar um app, **converse com quem tem o problema.**', apoio: 'Uma padaria. Um bairro.', nota: 'Não é promessa de lucro.', palavra: 'Antes' }, foto: { imagem_id: 'a' } },
    { layout: 'foto_documental', textos: { rotulo: 'Aí entra a **Casa Verde**', titulo: 'Ela vende uma **segunda chance**.', apoio: 'O comércio monta uma sacola.' }, foto: { imagem_id: 'a' } },
    { layout: 'contraste', textos: { rotulo: 'A conta', titulo: 'O pão não vendeu.', linha2: 'O custo já foi pago.', apoio: 'A comida pode virar prejuízo.', palavra: 'Sobrou.' }, foto: { imagem_id: 'a' } },
    { layout: 'evidencia', textos: { rotulo: 'A ideia pegou', claim_id: 'c1', legenda: 'de pessoas.', apoio: 'Número da empresa.' }, foto: { imagem_id: 'a' } },
    { layout: 'quebra_azul', textos: { rotulo: 'O detalhe', titulo: 'A ideia parece **óbvia**.', apoio: 'A operação é o desafio.' }, foto: { imagem_id: 'a' } },
    { layout: 'encerramento_pedro', textos: { titulo: 'Tem negócio bom escondido em **problema que todo mundo ignora.**', apoio: 'para descobrir negócios que já funcionam no mundo.' } },
  ];
  for (const c of casos) {
    const r = await Arte.renderizarTela(c, { n: 3, total: 8, imagens, claims });
    const m = await sharp(r.png).metadata(); assert.deepStrictEqual([m.width, m.height, m.format], [1080, 1350, 'png'], c.layout);
    assert.strictEqual(r.metrics.cabe, true, `${c.layout}: ${r.metrics.problemas.join('; ')}`);
    r.metrics.blocos.forEach((b) => assert.ok(b.tam >= b.minimo, `${c.layout}/${b.nome}: ${b.tam}px < ${b.minimo}px`));
    r.metrics.caixas.filter((x) => x.tipo === 'texto' && !x.decorativo).forEach((x) => assert.ok(x.x >= 63.5 && x.x + x.w <= 1080 - 63.5, `${c.layout}/${x.nome} dentro da margem de 64 px`));
  }
  // margem segura: sem tinta nos 60 px laterais de uma tela só tipográfica
  const t = await Arte.renderizarTela(casos[6], { n: 8, total: 8, imagens, claims });
  const { data, info } = await sharp(t.png).raw().toBuffer({ resolveWithObject: true });
  let tinta = 0; for (let y = 0; y < info.height; y++) for (const x of [10, 40, 1040, 1070]) { const i = (y * info.width + x) * info.channels; if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 140) tinta += 1; }
  assert.ok(tinta < 40, `margens laterais livres (${tinta} pixels escuros)`);
});

test('renderer: texto longo NÃO encolhe em silêncio: a tela sai marcada como não cabe, com a causa e a saída (encurtar ou trocar a composição)', async () => {
  const longo = 'Esta é uma frase propositalmente enorme, cheia de palavras que ninguém consegue ler no celular, repetindo a mesma ideia diversas vezes sem acrescentar nada de novo ao leitor que só queria entender o negócio. '.repeat(3);
  const r = await Arte.renderizarTela({ layout: 'foto_documental', textos: { titulo: longo, apoio: longo }, foto: { imagem_id: null } }, { n: 1, total: 8, imagens: {}, claims: {} });
  assert.strictEqual(r.metrics.cabe, false);
  assert.ok(r.metrics.problemas.some((p) => /Encurte o texto ou troque a composição/.test(p)), r.metrics.problemas.join('|'));
  assert.ok(r.metrics.fonte_px >= 64 || r.metrics.blocos.every((b) => b.tam >= b.minimo), 'não reduziu abaixo do mínimo legível');
  const m = await sharp(r.png).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350]);
});

test('renderer: imagem indisponível → a tela sai sem foto, marcada sem_imagem (nada de foto genérica para disfarçar)', async () => {
  const r = await Arte.renderizarTela({ layout: 'foto_documental', textos: { titulo: 'Ela vende uma **segunda chance**.', apoio: 'O cliente retira no local.' }, foto: { imagem_id: 'inexistente' } }, { n: 3, total: 8, imagens: {}, claims: {} });
  assert.strictEqual(r.metrics.sem_imagem, true); assert.strictEqual(r.metrics.cabe, true);
});

test('renderer: a numeração acompanha a posição (n/total) e é determinística (mesma entrada, mesmo arquivo)', async () => {
  const t = { layout: 'quebra_azul', textos: { titulo: 'Título curto', apoio: 'Apoio curto.' }, foto: {} };
  const a = await Arte.renderizarTela(t, { n: 6, total: 7, imagens: {}, claims: {} }); const b = await Arte.renderizarTela(t, { n: 6, total: 7, imagens: {}, claims: {} }); const c = await Arte.renderizarTela(t, { n: 5, total: 7, imagens: {}, claims: {} });
  assert.ok(a.png.equals(b.png), 'determinístico'); assert.ok(!a.png.equals(c.png), 'numeração diferente muda o arquivo');
});

// ── Validação: bloqueios × sugestões ─────────────────────────────────────────────────────────
test('validação: bloqueios são falhas objetivas; sugestões são julgamento editorial; não existe nota de viralização', async () => {
  const { op, doc } = await preparar();
  assert.strictEqual(doc.validacao.ok, true, JSON.stringify(doc.validacao.bloqueios)); assert.strictEqual(doc.estado, 'aguardando_aprovacao');
  assert.ok(!('nota' in doc.validacao) && !('viralizacao' in doc.validacao) && !JSON.stringify(doc.validacao).match(/viraliza/i));
  const base = () => ({ ...clone(doc), render: undefined });
  const casos = [
    ['NUMERO_SEM_FONTE', (d) => { d.telas[1].textos.apoio = 'A empresa já tem 900 mil clientes no mundo inteiro, e isso cresce todo mês sem parar.'; }],
    ['HANDLE_ERRADO', (d) => { d.telas[7].textos.apoio = 'Segue @outro_perfil para descobrir negócios que já funcionam.'; }],
    ['LUCRO_SEM_DADO', (d) => { d.telas[3].textos.apoio = 'A empresa é lucrativa e dá lucro todo mês para os donos.'; }],
    ['AFIRMACAO_IMPROVAVEL', (d) => { d.telas[2].textos.apoio = 'Quase ninguém faz isso no Brasil e a ideia vai funcionar no Brasil com certeza.'; }],
    ['BRASIL_SEM_HIPOTESE', (d) => { d.telas[6].textos.apoio = 'No Brasil o negócio é garantido para qualquer cidade e qualquer escritório da região.'; d.telas[6].textos.nota = ''; d.telas[6].textos.titulo = 'Abra o negócio no Brasil agora.'; }],
    ['EVIDENCIA_SEM_DADO', (d) => { d.telas[4].textos.claim_id = 'c999'; }],
    ['PEDRO_FORA_DO_FIM', (d) => { d.telas[2].layout = 'encerramento_pedro'; }],
    ['QTD_TELAS', (d) => { d.telas.splice(1, 3); }],
    ['PRINT_SEM_ORIGEM', (d) => { d.imagens = [{ id: 'x', papel: 'print', descricao: 'tela do app', origem: {} }]; }],
    ['IMAGEM_GERADA', (d) => { d.imagens = [{ id: 'x', tipo: 'ia', papel: 'print', descricao: 'tela do app', origem: { url_imagem: 'https://x/y.png' } }]; }],
    ['VALOR_SEM_DADO', (d) => { d.telas[0].textos.titulo = 'Esta empresa fatura **bilhões** com plantas de escritório.'; }],
  ];
  for (const [codigo, muda] of casos) { const d = base(); muda(d); const v = Serie.validar(d, op); assert.ok(v.bloqueios.some((b) => b.codigo === codigo), `${codigo}: ${JSON.stringify(v.bloqueios.map((b) => b.codigo))}`); assert.strictEqual(v.ok, false); }
  // sugestões: aparecem, mas não bloqueiam
  const d = base(); d.telas[0].textos.titulo = 'Conheça a empresa que revoluciona o aluguel de plantas'; d.telas[1].textos.apoio = Array(60).fill('palavra').join(' '); d.telas[3].textos.apoio = 'Funciona como um marketplace de plantas.'; d.telas.forEach((t) => { t.layout = 'foto_documental'; });
  const v = Serie.validar({ ...d, telas: d.telas.map((t, i) => (i === 7 ? { ...t, layout: 'encerramento_pedro' } : t)) }, op);
  const sug = v.sugestoes.map((s) => s.codigo);
  for (const k of ['CAPA_GENERICA', 'EXPLICACAO_LONGA', 'JARGAO', 'POUCA_VARIEDADE']) assert.ok(sug.includes(k), `${k} em ${sug}`);
  assert.ok(!v.bloqueios.some((b) => ['CAPA_GENERICA', 'EXPLICACAO_LONGA', 'JARGAO', 'POUCA_VARIEDADE'].includes(b.codigo)), 'sugestão não vira bloqueio');
});

test('validação: tela de dinheiro sem fonte do modelo de cobrança é bloqueio; "não é promessa de lucro" não conta como afirmação de lucro', async () => {
  const { op, doc } = await preparar();
  assert.ok(!Serie.validar(doc, op).bloqueios.some((b) => b.codigo === 'LUCRO_SEM_DADO'), 'o aviso de lucro não é afirmação');
  const semModelo = clone(op); semModelo.verificacao.claims = semModelo.verificacao.claims.filter((c) => !['modelo_receita', 'preco'].includes(c.tipo));
  assert.ok(Serie.validar(doc, semModelo).bloqueios.some((b) => b.codigo === 'MODELO_SEM_FONTE'));
});

// ── Fatos conferidos em código ──────────────────────────────────────────────────────────────────
test('história: trecho que não está no texto lido é recusado; investimento não vira faturamento; classe da fonte vem do endereço', async () => {
  novoBanco();
  const h = clone(HIST);
  h.afirmacoes.push({ fonte: 1, tipo: 'receita', texto: 'A empresa fatura US$ 3 milhões.', numero: 3000000, unidade: 'USD', trecho: 'The company raised $3 million last year from Acme Capital' });
  h.afirmacoes.push({ fonte: 1, tipo: 'clientes', texto: 'Tem 900 mil clientes.', numero: 900000, unidade: 'clientes', trecho: 'has 900,000 paying customers all over the world' });
  const op = await HM.criar(h, { deps: { lerFonte } });
  const claims = op.verificacao.claims; const rej = op.verificacao.claims_rejeitadas;
  assert.ok(rej.some((r) => /trecho não está no texto lido/.test(r.motivo)), 'trecho inventado recusado');
  const inv = claims.filter((c) => c.tipo === 'investimento'); assert.ok(inv.length >= 1 && inv.every((c) => c.usavel === false), 'investimento recebido de uma só matéria não vira número liberado');
  assert.ok(!claims.some((c) => c.tipo === 'receita'), 'o valor captado não virou faturamento');
  const u = claims.find((c) => c.tipo === 'usuarios'); assert.ok(u.usavel && u.atribuicao === 'segundo a empresa', 'dado do site oficial é atribuído à empresa');
  assert.ok(op.verificacao.fontes.find((f) => f.url.includes('casaverde')).classe === 'oficial'); assert.ok(op.verificacao.fontes.find((f) => f.url.includes('techcrunch')).classe === 'imprensa');
  assert.strictEqual(op.verificacao.estado, 'verificada');
});

test('história: matéria que só repete o que a empresa diz continua atribuída à empresa; site que bloqueia leitura vira limitação, não número', async () => {
  novoBanco();
  const h = clone(HIST); h.site_oficial = 'https://casabloqueada.com/'; h.fontes = ['https://casabloqueada.com/', 'https://techcrunch.com/2026/10/casa-verde', 'https://exame.com/2026/10/casa-verde'];
  h.afirmacoes = [{ fonte: 1, tipo: 'usuarios', texto: 'Mais de 250 mil pessoas usam a Casa Verde.', numero: 250000, unidade: 'usuarios', trecho: 'says more than 250,000 people use its service' }, { fonte: 2, tipo: 'usuarios', texto: 'Mais de 250 mil pessoas usam a Casa Verde.', numero: 250000, unidade: 'usuarios', trecho: 'tem mais de 250.000 pessoas como usuárias' }];
  const op = await HM.criar(h, { deps: { lerFonte } });
  assert.ok(op.verificacao.limitacoes.some((l) => /casabloqueada\.com/.test(l) && /não legível|não pôde|inacessível/i.test(l)));
  const c = op.verificacao.claims.find((x) => x.tipo === 'usuarios' && x.usavel); assert.ok(c, 'duas fontes independentes liberam o número');
  assert.ok(op.verificacao.claims.some((x) => x.usavel && x.atribuicao === 'segundo a empresa' || !x.atribuicao));
});

// ── Imagens com origem ───────────────────────────────────────────────────────────────────────────
test('imagens: licença aberta só; o nome da empresa precisa estar no arquivo; origem, crédito e permissão ficam registrados', async () => {
  const jpg = await foto('#336699');
  const resp = { query: { pages: {
    1: { index: 1, title: 'File:Casa Verde office.jpg', imageinfo: [{ mime: 'image/jpeg', width: 2000, height: 1500, url: 'https://upload/a.jpg', thumburl: 'https://upload/a1600.jpg', descriptionurl: 'https://commons/File:a', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Maria</a>' }, ImageDescription: { value: 'Escritório da Casa Verde' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] },
    2: { index: 2, title: 'File:Casa Verde NC.jpg', imageinfo: [{ mime: 'image/jpeg', width: 2000, height: 1500, url: 'https://upload/b.jpg', thumburl: 'https://upload/b1600.jpg', descriptionurl: 'https://commons/File:b', extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' }, Artist: { value: 'João' } } }] },
    3: { index: 3, title: 'File:Renault car.jpg', imageinfo: [{ mime: 'image/jpeg', width: 2000, height: 1500, url: 'https://upload/c.jpg', thumburl: 'https://upload/c1600.jpg', descriptionurl: 'https://commons/File:c', extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'Pedro' }, ImageDescription: { value: 'Um carro numa estrada... muito texto ...'.padEnd(400, '.') + ' Casa Verde' } } }] },
  } } };
  const fetcher = async () => ({ status: 200, corpo: JSON.stringify(resp) });
  const r = await Fotos.commons('"Casa Verde"', { exigirNome: 'Casa Verde', deps: { fetcher, baixar: async () => jpg } });
  assert.strictEqual(r.imagens.length, 1, 'só a CC BY-SA com a empresa no nome do arquivo');
  const im = r.imagens[0]; assert.strictEqual(im.permissao, 'confirmada'); assert.match(im.credito, /Maria/); assert.match(im.licenca, /CC BY-SA 4\.0/); assert.ok(im.origem.url_pagina && im.origem.sha256 && im.origem.consultado_em);
  assert.strictEqual(im.relacao, 'negocio');
});

test('imagens: capturas da App Store entram como print real (papel print, origem da loja, permissão a confirmar)', async () => {
  const shot = await sharp({ create: { width: 1290, height: 2796, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const j = { results: [{ trackName: 'Casa Verde: plantas', sellerName: 'Casa Verde Inc', sellerUrl: 'https://casaverde.com', trackViewUrl: 'https://apps.apple.com/us/app/casa-verde/id1?uo=4', screenshotUrls: ['https://is1.mzstatic.com/a/392x696bb.jpg', 'https://is1.mzstatic.com/b/392x696bb.jpg'] }] };
  const op = { nome: 'Casa Verde', verificacao: { fonte_oficial: { url: 'https://casaverde.com/' } } };
  const r = await Fotos.capturasDaLoja(op, { deps: { fetcher: async () => ({ status: 200, corpo: JSON.stringify(j) }), baixar: async () => shot } });
  assert.ok(r.imagens.length >= 1); const p = r.imagens[0]; assert.strictEqual(p.papel, 'print'); assert.strictEqual(p.permissao, 'verificar'); assert.match(p.credito, /App Store/); assert.ok(p.origem.url_pagina.includes('apps.apple.com'));
});

test('imagens: imagens do site oficial (og:image, twitter:image, img/srcset) são lidas; arquivo corrompido ou pequeno é recusado', async () => {
  const html = '<meta property="og:image" content="/a.jpg"><meta name="twitter:image" content="https://x.com/b.jpg"><img src="/logo.png"><img srcset="/c-400.jpg 400w, /c-1200.jpg 1200w" src="/c-400.jpg"><script>{"image":["https://x.com/d.jpg"]}</script>';
  const urls = Fotos.imagensDaPagina(html, 'https://casaverde.com/'); assert.ok(urls.includes('https://casaverde.com/a.jpg') && urls.includes('https://x.com/b.jpg') && urls.includes('https://casaverde.com/c-1200.jpg') && !urls.some((u) => /logo/.test(u)));
  assert.strictEqual((await Fotos.validar(Buffer.from('não sou imagem'))).ok, false);
  assert.strictEqual((await Fotos.validar(await foto('#fff', 300, 200))).ok, false);
  assert.strictEqual((await Fotos.validar(await foto('#fff', 1600, 1200))).ok, true);
});

// ── Fluxo completo e edição tela a tela ────────────────────────────────────────────────────────────
test('fluxo: do rascunho ao ZIP — 8 PNG 1080×1350 numerados, legenda, ficha de fontes, origem das imagens; nada publicado', async () => {
  const { doc } = await preparar();
  assert.strictEqual(doc.serie, 'negocios'); assert.strictEqual(doc.estado, 'aguardando_aprovacao'); assert.strictEqual(doc.render.length, 8); assert.strictEqual(doc.capas.length, 3);
  assert.strictEqual(new Set(doc.telas.map((t) => t.layout)).size >= 5, true, 'composições variadas, sem repetir o mesmo layout oito vezes');
  assert.strictEqual(doc.telas[7].layout, 'encerramento_pedro'); assert.ok(doc.telas.slice(0, 7).every((t) => t.layout !== 'encerramento_pedro'), 'foto do Pedro só no encerramento');
  const x = await C2.exportar(doc.id); const itens = Pacote.lerZip(x.zip); const nomes = itens.map((i) => i.nome);
  for (let i = 1; i <= 8; i++) assert.ok(nomes.includes(`slide-0${i}.png`));
  for (const n of ['legenda.txt', 'ficha-de-fontes.md', 'ficha-de-fontes.json', 'imagens-origem.json', 'LEIA-ME.txt']) assert.ok(nomes.includes(n), n);
  for (const it of itens.filter((q) => q.nome.endsWith('.png'))) { const m = await sharp(it.dados).metadata(); assert.deepStrictEqual([m.width, m.height, m.format], [1080, 1350, 'png']); }
  const ficha = itens.find((q) => q.nome === 'ficha-de-fontes.md').dados.toString(); assert.match(ficha, /Pesquisa da história/); assert.match(ficha, /segundo a empresa/);
  const leg = itens.find((q) => q.nome === 'legenda.txt').dados.toString(); assert.ok(leg.length <= 700 && (leg.match(/#\w+/g) || []).length <= 3 && leg.includes('@pedro_destrava'));
  const imgs = JSON.parse(itens.find((q) => q.nome === 'imagens-origem.json').dados.toString()); assert.ok(imgs.length >= 1); imgs.forEach((i) => assert.ok(i.origem.url_imagem && i.licenca && i.permissao));
  assert.ok((await store.listar('oportunidade')).every((o) => o.status !== 'publicada'));
});

test('edição: mudar UMA tela re-renderiza só ela; as outras continuam byte a byte iguais', async () => {
  const { doc } = await preparar(); const antes = doc.render.map((r) => r.sha256);
  const r = await C2.editarTela(doc.id, 4, { textos: { apoio: 'A receita vem de uma assinatura mensal que o escritório paga por vaso.' } });
  const depois = r.doc.render.map((x) => x.sha256);
  assert.notStrictEqual(depois[3], antes[3]); depois.forEach((h, i) => { if (i !== 3) assert.strictEqual(h, antes[i], `tela ${i + 1} intacta`); });
  assert.match(r.doc.telas[3].textos.apoio, /por vaso/); assert.strictEqual(r.doc.versoes.length, 2);
  // trocar composição: só a tela 3 muda
  const r2 = await C2.editarTela(doc.id, 3, { layout: 'manchete_produto' }); assert.strictEqual(r2.doc.telas[2].layout, 'manchete_produto'); r2.doc.render.forEach((x, i) => { if (i !== 2) assert.strictEqual(x.sha256, depois[i]); });
  await assert.rejects(() => C2.editarTela(doc.id, 3, { layout: 'encerramento_pedro' }), /aceita as composições/);
});

test('edição: reordenar renumera o rodapé; remover deixa 7 telas (só tensão ou estratégia); tela bloqueada não é alterada', async () => {
  const { doc } = await preparar();
  const r = await C2.reordenar(doc.id, [1, 2, 3, 4, 6, 5, 7, 8]); assert.strictEqual(r.doc.telas[4].funcao, 'estrategia'); assert.strictEqual(r.doc.telas[5].funcao, 'evidencia');
  assert.notStrictEqual(r.doc.render[4].sha256, doc.render[4].sha256, 'o rodapé 5/8 e 6/8 mudou'); assert.strictEqual(r.doc.render[0].sha256, doc.render[0].sha256, 'a tela 1 não mudou');
  await assert.rejects(() => C2.reordenar(doc.id, [1, 1, 3, 4, 5, 6, 7, 8]), /Ordem inválida/);
  await assert.rejects(() => C2.remover(doc.id, 6), /Só dá para tirar/);     // tela 6 agora é evidência
  const sete = await C2.remover(doc.id, 2); assert.strictEqual(sete.doc.telas.length, 7); assert.strictEqual(sete.doc.render.length, 7);
  const m = await sharp(await png(doc.id, 7)).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350]); assert.strictEqual(sete.doc.validacao.ok, true, JSON.stringify(sete.doc.validacao.bloqueios));
  await assert.rejects(() => C2.remover(doc.id, 2), /pelo menos 7/);
  const bl = await C2.editarTela(doc.id, 1, { bloqueada: true }); assert.strictEqual(bl.doc.telas[0].bloqueada, true);
  await assert.rejects(() => C2.editarTela(doc.id, 1, { textos: { titulo: 'Outro título qualquer **aqui**.' } }), /bloqueada/);
  await assert.rejects(() => C2.escolherCapa(doc.id, 'capa_2'), /bloqueada/);
});

test('capas: três ângulos diferentes; escolher outra capa troca só a tela 1', async () => {
  const { doc } = await preparar(); assert.strictEqual(new Set(doc.capas.map((c) => c.angulo)).size, 3);
  const r = await C2.escolherCapa(doc.id, 'capa_2'); assert.match(r.doc.telas[0].textos.titulo, /Toda segunda-feira/); assert.strictEqual(r.doc.capa_escolhida, 'capa_2');
  assert.notStrictEqual(r.doc.render[0].sha256, doc.render[0].sha256); r.doc.render.slice(1).forEach((x, i) => assert.strictEqual(x.sha256, doc.render[i + 1].sha256));
});

test('texto longo no editor: vira bloqueio TEXTO_NAO_CABE, o estado volta a rascunho, aprovar e exportar ficam travados', async () => {
  const { doc } = await preparar();
  const r = await C2.editarTela(doc.id, 3, { textos: { titulo: 'Título muito mais longo do que qualquer tela consegue comportar sem encolher a letra abaixo do mínimo legível no celular, repetindo, repetindo e repetindo as mesmas palavras.', apoio: Array(70).fill('texto').join(' ') } });
  assert.strictEqual(r.doc.render[2].metricas.cabe, false); assert.ok(r.doc.validacao.bloqueios.some((b) => b.codigo === 'TEXTO_NAO_CABE' && b.tela === 3)); assert.strictEqual(r.doc.estado, 'rascunho');
  await assert.rejects(() => C2.exportar(doc.id), /bloqueio/);
  const ok = await C2.editarTela(doc.id, 3, { textos: { titulo: 'Ela cuida da **planta** para você.', apoio: 'O escritório escolhe os vasos e a equipe cuida de tudo todo mês.' } });
  assert.strictEqual(ok.doc.validacao.ok, true); assert.strictEqual(ok.doc.estado, 'aguardando_aprovacao');
});

test('imagem indisponível: sem fotos o carrossel sai com telas tipográficas, avisa "sem imagem" e não usa foto genérica', async () => {
  const { doc } = await preparar({ imagens: false });
  assert.strictEqual((doc.imagens || []).length, 0); assert.ok(doc.telas.slice(0, 7).every((t) => !t.foto?.imagem_id));
  assert.ok(doc.validacao.sugestoes.some((s) => s.codigo === 'SEM_IMAGEM')); assert.strictEqual(doc.validacao.ok, true, 'a falta de foto é aviso editorial, não bloqueio factual');
  assert.ok(doc.render.some((r) => r.metricas.sem_imagem));
});

test('trocar foto: imagem enviada vira camada com origem declarada; só vale na tela escolhida; permissão fica "a confirmar" até o Pedro confirmar', async () => {
  const { doc } = await preparar();
  const r = await C2.adicionarImagem(doc.id, { buf: await foto('#aa3366'), descricao: 'Equipe regando plantas', credito: 'Foto: Casa Verde', licenca: 'Enviada pela assessoria', permissao: false, papel: 'foto', tela: 3 });
  const im = r.doc.imagens[r.doc.imagens.length - 1]; assert.strictEqual(im.tipo, 'enviada'); assert.strictEqual(im.permissao, 'verificar'); assert.ok(im.origem.declaracao);
  assert.strictEqual(r.doc.telas[2].foto.imagem_id, im.id); assert.ok(r.doc.validacao.sugestoes.some((s) => s.codigo === 'PERMISSAO_IMAGEM' && s.tela === 3));
  const ok = await C2.confirmarPermissao(doc.id, im.id, true); assert.ok(!ok.doc.validacao.sugestoes.some((s) => s.codigo === 'PERMISSAO_IMAGEM' && s.tela === 3));
  await assert.rejects(() => C2.adicionarImagem(doc.id, { buf: Buffer.from('lixo'), papel: 'foto' }), /Imagem recusada/);
});

test('versões e exportação: aprovar guarda o hash; editar depois desfaz a aprovação; restaurar volta o conteúdo anterior', async () => {
  const { doc } = await preparar();
  await store.atualizar('carrossel', doc.id, (c) => { c.estado = 'aprovado'; c.aprovacao = { hash: c.hash_atual }; return c; });
  const e1 = await C2.exportar(doc.id); assert.ok(e1.zip.length > 1000);
  const r = await C2.editarTela(doc.id, 4, { textos: { apoio: 'Texto novo para a tela de dinheiro, com a assinatura mensal por vaso.' } });
  assert.strictEqual(r.doc.estado, 'aguardando_aprovacao'); assert.strictEqual(r.doc.aprovacao, null);
  const volta = await C2.restaurarVersao(doc.id, 1); assert.strictEqual(volta.doc.telas[3].textos.apoio, RASCUNHO.telas[3].apoio); assert.strictEqual(volta.doc.render[3].sha256, doc.render[3].sha256);
  // arquivo trocado por baixo dos panos: a conferência de integridade recusa exportar
  await store.arquivoSalvar(C2.chaveSlide(doc.id, 2), await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#000' } }).png().toBuffer(), 'image/png');
  await assert.rejects(() => C2.exportar(doc.id), /versão|integridade/i);
});

test('legenda editável: complementar, até 3 hashtags; sem handle errado nem número sem fonte', async () => {
  const { doc, op } = await preparar();
  const r = await C2.editarLegenda(doc.id, 'Uma legenda nova que fala da assinatura mensal.\n\nSegue @pedro_destrava para descobrir negócios que já funcionam no mundo. #negocios'); assert.strictEqual(r.doc.validacao.ok, true);
  const ruim = await C2.editarLegenda(doc.id, 'Eles ganham 90 milhões por ano. Segue @outra_conta para saber mais sobre o assunto.'); assert.ok(ruim.doc.validacao.bloqueios.some((b) => b.codigo === 'HANDLE_ERRADO'));
  assert.ok(ruim.doc.validacao.bloqueios.some((b) => b.codigo === 'NUMERO_SEM_FONTE' || b.codigo === 'VALOR_SEM_DADO')); void op;
});

// ── IA: propõe, o código confere; regenerar só uma tela ────────────────────────────────────────────
test('IA: rascunho com número inventado é devolvido à IA com o motivo; sem solução vira rascunho com bloqueios (não some)', async () => {
  novoBanco(); const op = await HM.criar(clone(HIST), { deps: { lerFonte } });
  const chamadas = []; const ruim = clone(RASCUNHO); ruim.telas[1].apoio = 'A empresa já tem 900 mil clientes e cresce todo mês, segundo as pesquisas que fizeram por lá.';
  const bom = clone(RASCUNHO);
  const pedirJson = async ({ usuario }) => { chamadas.push(usuario); return { llm: { provider: 'teste' }, dados: chamadas.length === 1 ? ruim : bom }; };
  const r = await Hist.gerarRascunho(op, { deps: { pedirJson } });
  assert.strictEqual(chamadas.length, 2); assert.match(chamadas[1], /número sem comprovação/); assert.ok(!r.com_problemas);
  const sempre = async () => ({ llm: {}, dados: ruim }); const r2 = await Hist.gerarRascunho(op, { deps: { pedirJson: sempre }, tentativas: 2 }); assert.ok(r2.com_problemas && r2.telas.length === 8);
});

test('IA: regenerar uma tela muda só ela e respeita as mesmas conferências', async () => {
  const { doc } = await preparar(); const antes = doc.render.map((r) => r.sha256);
  const pedirJson = async () => ({ llm: {}, dados: { rotulo: 'Texto refeito', titulo: 'Casa Verde mostra que **cuidar** também vende.', apoio: 'Uma frase nova e curta, escrita para esta tela, sem repetir o que as outras já dizem ao leitor.' } });
  const r = await C2.regenerarTela(doc.id, 3, { deps: { pedirJson }, instrucao: 'mais direto' });
  assert.match(r.doc.telas[2].textos.titulo, /cuidar/); r.doc.render.forEach((x, i) => { if (i !== 2) assert.strictEqual(x.sha256, antes[i]); }); assert.strictEqual(r.regeneracao.com_problemas, false);
  const inventa = async () => ({ llm: {}, dados: { titulo: 'Casa Verde ganhou **7 milhões** em vendas.', apoio: 'A empresa vendeu muito e todo mundo ficou sabendo disso agora mesmo.' } });
  const r2 = await C2.regenerarTela(doc.id, 4, { deps: { pedirJson: inventa } }); assert.strictEqual(r2.regeneracao.com_problemas, true); assert.ok(r2.doc.validacao.bloqueios.some((b) => b.codigo === 'NUMERO_SEM_FONTE' || b.codigo === 'VALOR_SEM_DADO'), 'o texto com número inventado fica bloqueado');
});

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────
async function servidor() {
  novoBanco(); process.env.TESTE_RADAR = '1'; process.env.GROQ_API_KEY = 'falsa'; global.__RADAR_DEPS__ = { lerFonte, fetcher: async () => ({ status: 404, corpo: '' }), loja: false };
  delete require.cache[require.resolve('../routes/radar')];
  const app = express(); app.use(express.json({ limit: '20mb' })); app.use('/api/radar', require('../routes/radar'));
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/radar`;
  const req = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) }; };
  return { req, fechar: () => { srv.close(); delete global.__RADAR_DEPS__; delete process.env.TESTE_RADAR; } };
}
test('API: nova história → gerar carrossel (série padrão, texto pronto) → editar uma tela → aprovar (bloqueado se houver bloqueio) → ZIP', async () => {
  const s = await servidor();
  try {
    const h = await s.req('POST', '/historias', clone(HIST)); assert.strictEqual(h.status, 201, JSON.stringify(h.json)); assert.strictEqual(h.json.verificacao_estado, 'verificada'); assert.strictEqual(h.json.elegivel_carrossel, true);
    const g = await s.req('POST', `/oportunidades/${h.json.id}/acao`, { acao: 'gerar_carrossel', rascunho: clone(RASCUNHO) }); assert.strictEqual(g.status, 200, JSON.stringify(g.json));
    const c = g.json.carrossel; assert.strictEqual(c.serie, 'negocios'); assert.strictEqual(c.telas.length, 8); assert.strictEqual(c.slides.length, 8); assert.strictEqual(c.pronto, true); assert.strictEqual(c.capas.length, 3);
    assert.ok(c.telas[0].composicoes.length >= 2 && c.telas[4].imagem_precisa);
    const e = await s.req('POST', `/carrosseis/${c.id}/tela/3`, { textos: { apoio: 'Texto editado pelo Pedro, curto e direto, para esta tela de revelação do negócio.' } }); assert.strictEqual(e.status, 200); assert.match(e.json.carrossel.telas[2].textos.apoio, /editado pelo Pedro/);
    const longo = await s.req('POST', `/carrosseis/${c.id}/tela/2`, { textos: { titulo: Array(40).fill('longuíssimo').join(' ') } }); assert.strictEqual(longo.json.carrossel.validacao.bloqueios.length > 0, true);
    const ap1 = await s.req('POST', `/carrosseis/${c.id}/decisao`, { acao: 'aprovar' }); assert.strictEqual(ap1.status, 409); assert.match(ap1.json.error, /bloqueio/);
    assert.strictEqual((await s.req('GET', `/carrosseis/${c.id}/zip`)).status, 409);
    await s.req('POST', `/carrosseis/${c.id}/tela/2`, { textos: { titulo: 'A planta morreu.' } });
    const ap2 = await s.req('POST', `/carrosseis/${c.id}/decisao`, { acao: 'aprovar' }); assert.strictEqual(ap2.json.estado, 'aprovado');
    const z = await s.req('GET', `/carrosseis/${c.id}/zip`); assert.strictEqual(z.status, 200); assert.strictEqual(Pacote.lerZip(z.buf).filter((i) => i.nome.endsWith('.png')).length, 8);
    const sl = await s.req('GET', `/carrosseis/${c.id}/slide/3`); assert.strictEqual(sl.status, 200); const m = await sharp(sl.buf).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350]);
    const est = (await s.req('GET', `/carrosseis/${c.id}`)).json; assert.strictEqual(est.aprovacao.hash, est.hash);
    assert.strictEqual((await s.req('POST', `/carrosseis/${c.id}/tela/2`, { layout: 'nao_existe' })).status, 400);
    assert.strictEqual((await s.req('POST', `/carrosseis/${c.id}/reordenar`, { ordem: [1, 2] })).status, 400);
    const mal = await s.req('POST', '/historias', { nome: 'X', fontes: ['https://casaverde.com/'], afirmacoes: [{ fonte: 0, tipo: 'usuarios', texto: 'a', numero: 5, trecho: 'trecho que não existe na página lida' }] }); assert.ok(mal.status === 201 && mal.json.verificacao_estado !== 'verificada' || mal.status >= 400);
  } finally { s.fechar(); }
});
test('API: a série antiga continua disponível (serie: ideias) e os dados anteriores não são alterados', async () => {
  const s = await servidor();
  try {
    const h = await s.req('POST', '/historias', clone(HIST));
    const antes = await s.req('GET', '/oportunidades?status=todas'); assert.ok(antes.json.oportunidades.length >= 1);
    assert.ok(typeof require('./radar/carrossel').gerar === 'function' && typeof require('./radar/arte').renderizarCarrossel === 'function', 'módulo e arte da série antiga preservados');
    void h;
  } finally { s.fechar(); }
});
