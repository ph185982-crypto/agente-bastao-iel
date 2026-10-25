// Padrão "Pedro Destrava — Minimalista" (pedro_minimalista_estrategico_v1). Fontes, páginas e IA SIMULADAS; nada acessa a rede.
// node --test backend/lib/padraoMinimalista.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const A = require('./armazem');
const F = require('./radarFixtures');
const HM = require('./radar/historiaManual');
const C2 = require('./radar/carrossel2');
const Metodo = require('./radar/metodo');
const ArteMin = require('./radar/arteMinimalista');
const FotoPedro = require('./radar/fotoPedro');
const Pauta = require('./radar/pauta');
const Pacote = require('./radar/pacote');
const store = require('./radar/store');
const Padrao = require('./padraoCarrossel');

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
async function criarOp() { novoBanco(); return HM.criar(clone(HIST), { deps: { lerFonte } }); }

// Rascunho no formato do padrão v1 para a Casa Verde (briefing completo, campos por tela).
function rascunhoV1(op, { semProblema = false } = {}) {
  const id = (t) => (op.verificacao.claims.find((c) => c.tipo === t && c.usavel) || {}).id;
  const cUso = id('usuarios'); const cMod = id('modelo_receita');
  const telas = [
    { funcao: 'gancho', tipo: 'FATO', base: ['f2'], evidencias: [cMod], informacao_nova: 'a receita vem da assinatura por vaso', relacao_anterior: '', titulo: 'Uma empresa cobra assinatura para cuidar de plantas em escritórios.', corpo: 'A Casa Verde não vende a planta. O escritório paga uma assinatura por vaso e a equipe cuida de tudo.' },
    { funcao: 'problema', tipo: 'FATO', base: ['f3'], informacao_nova: 'o cuidado é o custo escondido', relacao_anterior: 'explica por que alguém pagaria', titulo: 'Planta sem cuidado vira problema no escritório.', corpo: 'Escritório sem planta fica frio, e planta sem cuidado seca. A tarefa cai sempre no mesmo funcionário, que não tem tempo para isso.' },
    { funcao: 'mecanismo_1', tipo: 'ANALISE', base: ['f2', 'f3'], informacao_nova: 'o cliente compra a troca, não o vaso', relacao_anterior: 'responde ao problema', titulo: 'O cliente paga pelo cuidado, não pela planta.', corpo: 'A receita vem da assinatura por vaso, porque o escritório compra a troca e o cuidado. Quando um vaso morre, a equipe troca sem custo extra.' },
    { funcao: 'mecanismo_2', tipo: 'ANALISE', base: ['a1'], informacao_nova: 'a visita fixa segura o cliente', relacao_anterior: 'aprofunda a recorrência', titulo: 'A visita fixa mantém o cliente, porque ele vê o resultado.', corpo: 'A equipe passa com frequência certa e a troca de vasos vira rotina. Essa rotina prende o cliente. Em cidade sem equipe, o deslocamento come a margem.' },
    { funcao: 'conta', tipo: 'FATO', base: ['f1'], evidencias: [cUso], informacao_nova: 'o alcance declarado', relacao_anterior: 'mostra o tamanho', titulo: 'A conta começa com 250 mil pessoas.', corpo: 'Segundo a empresa, mais de 250 mil pessoas usam o serviço. Isso mostra alcance, não quanto sobra no caixa.' },
    { funcao: 'aplicacao', tipo: 'HIPOTESE', base: [], informacao_nova: 'um teste pequeno', relacao_anterior: 'leva ao leitor', titulo: 'Um teste pequeno poderia começar em um prédio só.', corpo: 'Escolha um escritório de um bairro, ofereça três vasos por mês e meça se ele renova. No Brasil, isso seria uma hipótese para testar, não uma promessa.' },
    { funcao: 'encerramento', tipo: 'MISTO', base: [], titulo: 'Tem negócio bom escondido em problema que todo mundo ignora.', apoio: 'Segue @pedro_destrava para ver a estratégia por trás de negócios que funcionam.' },
  ];
  if (semProblema) { telas[1] = { funcao: 'problema', omitir: 'o problema já está no gancho' }; telas[2].relacao_anterior = 'explica o gancho'; }
  return {
    sem_pauta: null,
    briefing: {
      publico: 'quem quer abrir um serviço recorrente', interesse: 'entender onde a recorrência nasce', nivel_conhecimento: 'conhece assinatura, não conhece a operação', aplicacao: 'testar com um escritório', duvidas_abertas: ['Quantos escritórios renovam depois de um ano.'],
      teste_de_valor: { o_que_aprende: 'que o cliente paga pelo cuidado recorrente', por_que_importa: 'mostra como transformar tarefa chata em receita mensal', aprovado: true },
      negocio: { nome: 'Casa Verde', produto: 'aluguel de plantas para escritórios', problema: 'planta sem cuidado seca', para_quem: 'escritórios', quem_paga: 'o escritório', pelo_que_paga: 'a troca e o cuidado', forma_cobranca: 'assinatura mensal por vaso', operacao: 'equipe visita, troca e cuida' },
      fatos: [
        { id: 'f1', texto: 'A Casa Verde tem mais de 250 mil usuários, segundo a empresa.', claim_id: cUso, campo_do_negocio: null },
        { id: 'f2', texto: 'A empresa cobra assinatura mensal por vaso.', claim_id: cMod, campo_do_negocio: null },
        { id: 'f3', texto: 'O escritório sem planta fica frio e a planta sem cuidado seca.', claim_id: null, campo_do_negocio: 'problema' },
      ],
      analises: [{ id: 'a1', texto: 'Uma leitura é que o escritório paga pela troca e pelo cuidado.', base: ['f2', 'f3'], causalidade_demonstrada: false }],
      hipoteses: [{ id: 'h1', texto: 'Poderia ser testado com um escritório de um bairro.' }],
      decisao_especifica: { texto: 'A empresa cobra assinatura mensal por vaso e não vende a planta.', base: ['f2'] },
      mecanismos: [
        { nome: 'Assinatura por vaso', como_funciona: 'O escritório paga todo mês por cada vaso, e a equipe troca e cuida.', exemplo: 'Um vaso que morre é trocado sem custo extra.', vantagem: 'A receita se repete, porque o cliente não cuida de nada.', condicao_de_falha: 'Se a troca demorar, o escritório cancela.', base: ['f2', 'f3'] },
        { nome: 'Visita fixa', como_funciona: 'A equipe passa com frequência fixa.', exemplo: 'Visita semanal com troca de vasos.', vantagem: 'A rotina mantém o cliente, porque ele vê o resultado.', condicao_de_falha: 'Sem equipe na cidade, o deslocamento come a margem.', base: ['a1'] },
      ],
      limitacoes: ['Precisa de equipe em cada cidade.'], aprendizado_leitor: 'Assinatura funciona quando o cliente terceiriza uma tarefa que não quer fazer.',
    },
    ganchos: [
      { angulo: 'oportunidade', titulo: 'Um serviço de plantas para escritório ganha com cuidado, não com vaso.', scores: { clareza: 4, relevancia: 4, especificidade: 4, sustentacao: 4, entregabilidade: 4 } },
      { angulo: 'contradicao', titulo: 'Quem aluga planta para escritório não vende nenhuma planta.', scores: { clareza: 3, relevancia: 3, especificidade: 4, sustentacao: 4, entregabilidade: 3 } },
      { angulo: 'erro', titulo: 'O erro de quem vende planta é esquecer quem cuida dela.', scores: { clareza: 4, relevancia: 3, especificidade: 3, sustentacao: 3, entregabilidade: 3 } },
    ],
    telas,
    legenda: { primeira_linha: 'Quem paga a planta do escritório, na verdade, paga pelo cuidado.', historia: 'A Casa Verde não vende a planta: cobra assinatura e cuida de tudo.', como_ganha: 'Assinatura mensal por vaso, segundo a empresa.', brasil: 'Hipótese para testar: um escritório de um bairro.' },
    hashtags: ['negocios', 'empreendedorismo'],
  };
}

// Caixa delimitadora dos pixels que não são brancos (para medir margens no PNG final).
async function caixaTinta(png, { limiar = 245 } = {}) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width; let y0 = info.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * info.channels; if (data[i] < limiar || data[i + 1] < limiar || data[i + 2] < limiar) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return { x0, y0, x1, y1, w: info.width, h: info.height };
}
const fotoTeste = (w = 1600, h = 1100, cor = '#2b7a6b') => sharp({ create: { width: w, height: h, channels: 3, background: cor } }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#e8c35a"/></svg>`) }]).jpeg().toBuffer();

// ── Renderer: medidas e ausência de decoração ────────────────────────────────────────────────
test('v1 renderer: as quatro composições saem PNG 1080×1350 e passam na medição (margens, tamanhos, entrelinhas, distâncias)', async () => {
  const pedro = await FotoPedro.obter(); const buf = await fotoTeste();
  const recorte = await sharp({ create: { width: 1200, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg width="1200" height="1200"><rect x="300" y="200" width="600" height="800" fill="#b5651d"/></svg>') }]).png().toBuffer();
  const casos = [
    { layout: 'min_foto', textos: { titulo: 'Uma padaria vende o pão que ia para o lixo.', corpo: 'No fim do dia, o comércio monta uma sacola surpresa com o que sobrou. O cliente paga menos.' }, foto: { imagem_id: 'a' } },
    { layout: 'min_texto', textos: { titulo: 'O problema não é o pão. É a hora.', corpo: 'Depois das 18h, o que não vendeu vira custo. Desconto recupera parte do valor.' } },
    { layout: 'min_produto', textos: { titulo: 'A sacola é o produto.', corpo: 'O cliente não escolhe o que vem dentro: paga menos por isso.' }, foto: { imagem_id: 'p' } },
    { layout: 'min_encerramento', textos: { titulo: 'Sobra também é estoque.', apoio: 'Segue @pedro_destrava para ver a estratégia por trás de negócios que funcionam.' } },
  ];
  for (const c of casos) {
    const r = await ArteMin.renderizarTela(c, { n: 2, total: 7, imagens: { a: { buf, papel: 'foto' }, p: { buf: recorte, papel: 'foto' } }, fotoPedro: pedro });
    const m = await sharp(r.png).metadata(); assert.deepStrictEqual([m.width, m.height, m.format], [1080, 1350, 'png'], c.layout);
    assert.strictEqual(r.metrics.cabe, true, `${c.layout}: ${r.metrics.problemas.join('; ')}`);
    const md = r.metrics.medidas;
    assert.ok(md.margem_esquerda >= 88 && md.margem_esquerda <= 100, `${c.layout}: margem ${md.margem_esquerda}`);
    assert.ok(md.topo >= 80 && md.base >= 80, `${c.layout}: topo ${md.topo} base ${md.base}`);
    assert.ok(md.titulo_px >= 64 && md.titulo_px <= 82 && md.titulo_entrelinha >= 1.05 && md.titulo_entrelinha <= 1.15, `${c.layout}: título ${md.titulo_px}`);
    assert.ok(md.corpo_px >= 36 && md.corpo_px <= 44 && md.corpo_entrelinha >= 1.25 && md.corpo_entrelinha <= 1.4, `${c.layout}: corpo ${md.corpo_px}`);
    assert.ok(md.gap_titulo_corpo >= 36 && md.gap_titulo_corpo <= 52, `${c.layout}: gap ${md.gap_titulo_corpo}`);
    if (md.gap_texto_foto != null) assert.ok(md.gap_texto_foto >= 40 && md.gap_texto_foto <= 64, `${c.layout}: texto→foto ${md.gap_texto_foto}`);
    // medição no PNG: tudo o que não é branco fica dentro das margens; nada na faixa da numeração antiga
    const k = await caixaTinta(r.png);
    assert.ok(k.x0 >= 88 && k.x1 <= 1080 - 88 && k.y0 >= 80 && k.y1 <= 1350 - 80, `${c.layout}: tinta em ${JSON.stringify(k)}`);
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true }); const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    assert.deepStrictEqual(px(5, 5), [255, 255, 255], 'fundo #FFFFFF liso');
  }
});

test('v1 renderer: sem numeração visível por padrão; numeração só se pedida', async () => {
  const t = { layout: 'min_texto', textos: { titulo: 'Título curto.', corpo: 'Um corpo curto para testar a base da tela.' } };
  const sem = await ArteMin.renderizarTela(t, { n: 3, total: 7 }); const com = await ArteMin.renderizarTela(t, { n: 3, total: 7, numeracao: true });
  const base = async (png) => (await caixaTinta(await sharp(png).extract({ left: 0, top: 1280, width: 1080, height: 70 }).png().toBuffer())).x1;
  assert.strictEqual(await base(sem.png), -1, 'faixa inferior vazia'); assert.ok(await base(com.png) > 0);
});

test('v1 renderer: texto longo não encolhe abaixo de 64/36 px; imagem pequena demais vira problema', async () => {
  const r = await ArteMin.renderizarTela({ layout: 'min_texto', textos: { titulo: 'Longo '.repeat(60), corpo: 'Texto. '.repeat(300) } }, {});
  assert.strictEqual(r.metrics.cabe, false); assert.ok(r.metrics.fonte_px >= 36);
  const pequena = await fotoTeste(300, 200);
  const r2 = await ArteMin.renderizarTela({ layout: 'min_foto', textos: { titulo: 'Título.', corpo: 'Corpo curto da tela com foto.' }, foto: { imagem_id: 'a' } }, { imagens: { a: { buf: pequena, papel: 'foto' } } });
  assert.ok(r2.metrics.problemas.some((p) => /pequena demais/.test(p)), r2.metrics.problemas.join('; '));
});

test('v1 renderer: o ponto de foco muda o recorte sem deformar; foto muito alta não é cortada no essencial', async () => {
  const buf = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#ffffff' } }).composite([{ input: Buffer.from('<svg width="1600" height="900"><rect x="0" y="0" width="300" height="900" fill="#cc0000"/><rect x="1300" y="0" width="300" height="900" fill="#0000cc"/></svg>') }]).jpeg().toBuffer();
  const t = (foco) => ({ layout: 'min_foto', textos: { titulo: 'Foco.', corpo: 'Teste de recorte com ponto de foco.' }, foto: { imagem_id: 'a', foco } });
  const esq = await ArteMin.renderizarTela(t({ x: 0, y: 0.5 }), { imagens: { a: { buf, papel: 'foto' } } });
  const dir = await ArteMin.renderizarTela(t({ x: 1, y: 0.5 }), { imagens: { a: { buf, papel: 'foto' } } });
  const cx = esq.metrics.caixas.find((c) => c.nome === 'foto');
  const cor = async (png, x) => { const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }); const i = ((cx.y + 20) * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  assert.ok((await cor(esq.png, cx.x + 5))[0] > 150, 'foco à esquerda mostra a faixa vermelha');
  assert.ok((await cor(dir.png, cx.x + cx.w - 5))[2] > 150, 'foco à direita mostra a faixa azul');
  assert.ok(esq.metrics.foto.corte_pct <= 44, 'corte limitado (no máximo 25% por eixo)');
  const alta = await fotoTeste(600, 1800);
  const r = await ArteMin.renderizarTela({ layout: 'min_foto', textos: { titulo: 'Retrato.', corpo: 'Foto vertical não vira tira cortada.' }, foto: { imagem_id: 'a' } }, { imagens: { a: { buf: alta, papel: 'foto' } } });
  const fx = r.metrics.caixas.find((c) => c.nome === 'foto'); assert.ok(fx.w < 888, 'foto vertical ocupa a altura e deixa branco ao lado, sem cortar o essencial'); assert.ok(r.metrics.foto.corte_pct <= 44);
});

test('v1 encerramento: foto aprovada do Pedro retangular (sem círculo), sem foto aprovada sai tipográfico com aviso', async () => {
  const t = { layout: 'min_encerramento', textos: { titulo: 'Sobra também é estoque.', apoio: 'Segue @pedro_destrava para ver a estratégia por trás de negócios.' } };
  const pedro = await FotoPedro.obter(); assert.strictEqual(pedro.origem, 'perfil_do_app');
  const r = await ArteMin.renderizarTela(t, { fotoPedro: pedro });
  const cx = r.metrics.caixas.find((c) => c.nome === 'foto_pedro'); assert.ok(cx && cx.w / cx.h > 0.7 && cx.w / cx.h < 0.9, 'retrato 4:5');
  const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true }); const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  for (const [x, y] of [[cx.x + 2, cx.y + 2], [cx.x + cx.w - 3, cx.y + 2], [cx.x + 2, cx.y + cx.h - 3], [cx.x + cx.w - 3, cx.y + cx.h - 3]]) assert.notDeepStrictEqual(px(x, y), [255, 255, 255], 'cantos com foto: não é avatar circular');
  const sem = await ArteMin.renderizarTela(t, { fotoPedro: null });
  assert.ok(sem.metrics.sem_foto_pedro && sem.metrics.avisos.some((a) => /tipográfico/.test(a)));
});

test('v1 medição: caixas sobrepostas ou fora da margem viram problema', () => {
  const md = ArteMin.medidas({ caixas: [{ nome: 'titulo', x: 60, y: 40, w: 900, h: 100 }, { nome: 'foto', x: 96, y: 120, w: 888, h: 400 }], blocos: [{ nome: 'título', tam: 90, entrelinha: 1.1 }] });
  assert.ok(md.fora_do_padrao.some((p) => /margem esquerda/.test(p))); assert.ok(md.fora_do_padrao.some((p) => /respiro superior/.test(p)));
  assert.ok(md.fora_do_padrao.some((p) => /título com 90/.test(p))); assert.ok(md.fora_do_padrao.some((p) => /se sobrepõem/.test(p)));
});

// ── Imagens: candidatos, sem repetição, metadados ───────────────────────────────────────────
test('v1 imagens: escolhe entre candidatos, não repete foto, recusa IA fora da tela de teste, banner e imagem pequena', () => {
  const telas = Metodo.ORDEM.map((f) => ({ id: `t_${f}`, funcao: f, layout: Metodo.FUNCOES_MIN[f].layout, foto: { imagem_id: null } }));
  const imgs = [
    { id: 'im1', tipo: 'oficial', papel: 'foto', relacao: 'negocio', descricao: 'surprise bag product', largura: 1600 },
    { id: 'im2', tipo: 'loja', papel: 'print', relacao: 'negocio', descricao: 'app screenshot', largura: 1200 },
    { id: 'im3', tipo: 'oficial_pagina', papel: 'foto', relacao: 'negocio', descricao: 'banner', largura: 1800 },
    { id: 'im4', tipo: 'ia_ilustracao', papel: 'ilustracao', relacao: 'ilustrativa', descricao: 'ilustração', largura: 1536 },
    { id: 'im5', tipo: 'commons', papel: 'foto', relacao: 'negocio', descricao: 'store window', largura: 400 },
  ];
  C2.atribuirImagensV1(telas, imgs);
  const usadas = telas.map((t) => t.foto.imagem_id).filter(Boolean);
  assert.strictEqual(new Set(usadas).size, usadas.length, `sem repetição: ${usadas}`);
  assert.ok(!usadas.includes('im3'), 'banner do site não entra'); assert.ok(!usadas.includes('im5'), 'imagem pequena não entra');
  const ia = telas.find((t) => t.foto.imagem_id === 'im4'); assert.ok(!ia || ia.funcao === 'aplicacao', 'IA só na tela de teste');
  assert.strictEqual(telas.find((t) => t.funcao === 'conta').foto.imagem_id, 'im2', 'print verdadeiro vai para a conta');
  const semFoto = telas.filter((t) => Metodo.FUNCOES_MIN[t.funcao].foto && !t.foto.imagem_id);
  semFoto.forEach((t) => assert.match(t.foto.pendente, /Nenhuma imagem pertinente/));
  telas.filter((t) => t.foto.candidatos).forEach((t) => assert.ok(t.foto.candidatos.length >= 3, 'mais de um candidato avaliado'));
});

test('v1 imagens: a cópia de trabalho sai sem EXIF/GPS, o original fica separado e as transformações são registradas', async () => {
  novoBanco();
  const comExif = await sharp(await fotoTeste(2400, 1600)).withMetadata({ exif: { IFD0: { Copyright: 'teste', Artist: 'Fulano' } } }).jpeg().toBuffer();
  assert.ok((await sharp(comExif).metadata()).exif, 'entrada tem EXIF');
  const Fotos = require('./radar/fotos');
  const reg = await Fotos.guardar(store, 'cr_x_v1', { buf: comExif, tipo: 'enviada', papel: 'foto', relacao: 'negocio', descricao: 'x', origem: {} }, 'im1');
  const trab = await store.arquivoObter(reg.arquivo); const orig = await store.arquivoObter(reg.arquivo_original);
  assert.strictEqual((await sharp(trab.dados).metadata()).exif, undefined, 'sem EXIF na cópia de trabalho');
  assert.ok(orig.dados.equals(comExif), 'original guardado igual ao recebido');
  assert.ok(reg.transformacoes.some((t) => /metadados removidos/.test(t)) && reg.transformacoes.some((t) => /reduzida/.test(t)));
  const png = (await ArteMin.renderizarTela({ layout: 'min_foto', textos: { titulo: 'T.', corpo: 'Corpo curto.' }, foto: { imagem_id: 'a' } }, { imagens: { a: { buf: comExif, papel: 'foto' } } })).png;
  const m = await sharp(png).metadata(); assert.strictEqual(m.exif, undefined); assert.ok(!png.includes(Buffer.from('Fulano')), 'nada do EXIF no PNG final');
});

// ── Fluxo completo e edição ──────────────────────────────────────────────────────────────────
test('v1 fluxo: do rascunho ao ZIP — template v1, 7 PNG em ordem, legenda, fontes e créditos, objeto estruturado conferido', async () => {
  const op = await criarOp();
  const doc = await C2.gerar(op.id, { rascunho: rascunhoV1(op), deps: {}, orcamentoMs: 120000 });
  assert.strictEqual(doc.template, Padrao.ID, 'o padrão é o v1 sem pedir'); assert.strictEqual(doc.telas.length, 7);
  assert.strictEqual(doc.validacao.ok, true, doc.validacao.bloqueios.map((b) => b.mensagem).join(' | '));
  doc.telas.slice(0, 6).forEach((t) => { assert.ok(t.briefing_visual?.mostrar, 'briefing visual por tela'); });
  const x = await C2.exportar(doc.id); const itens = Pacote.lerZip(x.zip);
  assert.deepStrictEqual(itens.map((i) => i.nome), ['slide-01.png', 'slide-02.png', 'slide-03.png', 'slide-04.png', 'slide-05.png', 'slide-06.png', 'slide-07.png', 'legenda.txt', 'fontes-e-creditos.md', 'carrossel.json', 'ficha-de-fontes.json', 'LEIA-ME.txt']);
  for (const [i, it] of itens.filter((x2) => x2.nome.endsWith('.png')).entries()) { const m = await sharp(it.dados).metadata(); assert.deepStrictEqual([m.width, m.height, m.format], [1080, 1350, 'png']); assert.strictEqual(require('crypto').createHash('sha256').update(it.dados).digest('hex'), doc.render[i].sha256, 'é a versão atual'); }
  const obj = JSON.parse(itens.find((i) => i.nome === 'carrossel.json').dados);
  assert.strictEqual(obj.template, Padrao.ID); assert.ok(obj.briefing.teste_de_valor && obj.ganchos.length === 3 && obj.telas[0].informacao_nova && obj.telas[0].briefing_visual);
  assert.match(itens.find((i) => i.nome === 'fontes-e-creditos.md').dados.toString(), /Trecho: “Mais de 250\.000 pessoas/);
  assert.ok((doc.legenda.hashtags || []).length <= 3);
  // exportação velha: se o PNG guardado não bate com a versão, o ZIP é recusado
  await store.arquivoSalvar(doc.render[2].arquivo, (await store.arquivoObter(doc.render[3].arquivo)).dados, 'image/png');
  await assert.rejects(() => C2.exportar(doc.id), (e) => e.code === 'VERSAO_DIFERENTE');
});

test('v1 método: menos telas quando falta conteúdo (problema omitido → 6 telas válidas); briefing sem teste de valor bloqueia', async () => {
  const op = await criarOp();
  const m = Metodo.montarDoc(rascunhoV1(op, { semProblema: true }), op, { v1: true });
  assert.strictEqual(m.telas.length, 6); assert.strictEqual(m.omitidas[0].funcao, 'problema');
  const v = Metodo.validarDocMin({ ...m, template: Padrao.ID }, op); assert.strictEqual(v.bloqueios.filter((b) => !/Tela \d: (Fora|dimens)/.test(b.mensagem)).length, 0, v.bloqueios.map((b) => b.mensagem).join(' | '));
  const r = rascunhoV1(op); delete r.briefing.teste_de_valor; delete r.briefing.publico; r.telas[2].informacao_nova = '';
  const v2 = Metodo.validarDocMin({ ...Metodo.montarDoc(r, op, { v1: true }), template: Padrao.ID }, op);
  assert.ok(v2.bloqueios.some((b) => /Teste de valor/.test(b.mensagem))); assert.ok(v2.bloqueios.some((b) => /público/.test(b.mensagem))); assert.ok(v2.bloqueios.some((b) => /informação nova/.test(b.mensagem)));
});

test('v1 edição: só a tela editada muda; trocar o recorte não mexe no texto; texto travado não muda nem regenera', async () => {
  const op = await criarOp();
  const doc = await C2.gerar(op.id, { rascunho: rascunhoV1(op), deps: {}, orcamentoMs: 120000 });
  const antes = doc.render.map((r) => r.sha256);
  const r1 = await C2.editarTela(doc.id, 4, { textos: { corpo: 'A equipe passa com frequência certa e a troca de vasos vira rotina, porque o cliente vê o resultado. Em cidade sem equipe, o deslocamento come a margem.' } });
  r1.doc.render.forEach((x, i) => { if (i !== 3) assert.strictEqual(x.sha256, antes[i], `tela ${i + 1} intacta`); });
  await C2.adicionarImagem(doc.id, { buf: await fotoTeste(1800, 1200, '#334455'), descricao: 'vasos no escritório', papel: 'foto', permissao: true, tela: 1 });
  const textos1 = (await store.obter('carrossel', doc.id)).doc.telas[0].textos;
  const r2 = await C2.editarTela(doc.id, 1, { foto: { foco: { x: 0.2, y: 0.5 } } });
  assert.deepStrictEqual(r2.doc.telas[0].textos, textos1, 'trocar o recorte não regenera a copy');
  await C2.editarTela(doc.id, 3, { travas: { texto: true } });
  await assert.rejects(() => C2.editarTela(doc.id, 3, { textos: { titulo: 'Outro.' } }), (e) => e.code === 'TRAVADA');
  await assert.rejects(() => C2.regenerarTela(doc.id, 3, { deps: { pedirJson: F.fakePedirJson() } }), (e) => e.code === 'TRAVADA');
  await C2.editarTela(doc.id, 1, { travas: { imagem: true } });
  await assert.rejects(() => C2.editarTela(doc.id, 1, { foto: { foco: { x: 0.8, y: 0.5 } } }), (e) => e.code === 'TRAVADA');
});

test('v1 regeneração com imagem travada: a IA reescreve só o texto da tela; imagem e as outras telas ficam iguais', async () => {
  const op = await criarOp();
  const doc = await C2.gerar(op.id, { rascunho: rascunhoV1(op), deps: {}, orcamentoMs: 120000 });
  await C2.adicionarImagem(doc.id, { buf: await fotoTeste(1800, 1200, '#445566'), descricao: 'equipe trocando vasos', papel: 'foto', permissao: true, tela: 3 });
  const base = (await C2.editarTela(doc.id, 3, { travas: { imagem: true } })).doc; const antes = base.render.map((r) => r.sha256);
  const r = await C2.regenerarTela(doc.id, 3, { deps: { pedirJson: F.fakePedirJson() } });
  assert.strictEqual(r.doc.telas[2].foto.imagem_id, base.telas[2].foto.imagem_id, 'imagem travada mantida');
  assert.notDeepStrictEqual(r.doc.telas[2].textos, base.telas[2].textos, 'texto refeito');
  r.doc.render.forEach((x, i) => { if (i !== 2) assert.strictEqual(x.sha256, antes[i], `tela ${i + 1} intacta`); });
});

// ── Compatibilidade com o histórico ─────────────────────────────────────────────────────────
test('histórico: carrossel antigo (minimalista anterior) continua legível e exportável; converter cria versão nova sem tocar no antigo', async () => {
  const op = await criarOp();
  const antigo = await C2.gerar(op.id, { rascunho: (() => { const r = rascunhoV1(op); r.telas.forEach((t) => { delete t.evidencias; }); return r; })(), template: 'minimalista', deps: {}, orcamentoMs: 120000 });
  assert.strictEqual(antigo.template, 'minimalista');
  const zipAntes = Pacote.lerZip((await C2.exportar(antigo.id)).zip).map((i) => i.nome); assert.ok(zipAntes.includes('slide-07.png'));
  const hash = antigo.hash_atual; const shas = antigo.render.map((r) => r.sha256);
  const novo = await C2.converterParaPadrao(antigo.id, { rascunho: rascunhoV1(op) });
  assert.strictEqual(novo.template, Padrao.ID); assert.notStrictEqual(novo.id, antigo.id); assert.strictEqual(novo.convertido_de, antigo.id);
  const depois = (await store.obter('carrossel', antigo.id)).doc;
  assert.strictEqual(depois.hash_atual, hash); assert.deepStrictEqual(depois.render.map((r) => r.sha256), shas, 'PNG do antigo intactos');
  assert.strictEqual(depois.convertido_para, novo.id);
  await assert.rejects(() => C2.converterParaPadrao(novo.id, { rascunho: rascunhoV1(op) }), /já está no padrão/);
});

// ── Pauta, lote, retomada e falhas ──────────────────────────────────────────────────────────
const depsPauta = (extra = {}) => ({ fetcher: F.fakeFetcher(), lerFonte: F.fakeLerFonte, pedirJson: F.fakePedirJson(), loja: false, semEspera: true, ...extra });
test('pauta por link: lê, identifica, verifica e gera no padrão v1 (sem repetir pesquisa ao retomar)', async () => {
  novoBanco(); const deps = depsPauta();
  const p = await Pauta.criar({ url: 'https://techcrunch.com/2026/10/lumenpets' }, { origem: 'estudio', deps });
  const r = await Pauta.executarTudo(p.id, { deps, orcamentoMs: 120000 });
  assert.strictEqual(r.pauta.estado, 'concluida', JSON.stringify(r.pauta.erros)); assert.ok(r.pauta.carrossel_id);
  const c = (await store.obter('carrossel', r.pauta.carrossel_id)).doc; assert.strictEqual(c.template, Padrao.ID); assert.strictEqual(c.estado, 'aguardando_aprovacao', JSON.stringify(c.validacao.bloqueios));
  assert.strictEqual((await store.listar('carrossel')).length, 1);
});

test('pauta: link inválido é recusado; link ilegível e fonte insuficiente param com motivo claro; falha da IA vira erro sem derrubar', async () => {
  novoBanco(); const deps = depsPauta();
  await assert.rejects(() => Pauta.criar({ url: 'ftp://x.com/a' }, { deps }), (e) => e.code === 'LINK_INVALIDO');
  await assert.rejects(() => Pauta.criar({ url: 'http://127.0.0.1/admin' }, { deps }), (e) => e.code === 'LINK_INVALIDO');
  const il = await Pauta.criar({ url: 'https://naoexiste.example/x' }, { deps }); const r1 = await Pauta.executarTudo(il.id, { deps });
  assert.strictEqual(r1.pauta.estado, 'erro'); assert.match(r1.pauta.erro_final.mensagem, /não pôde ser lido/);
  const fi = await Pauta.criar({ url: 'https://piramidex.com' }, { deps }); const r2 = await Pauta.executarTudo(fi.id, { deps });
  assert.strictEqual(r2.pauta.estado, 'insuficiente', JSON.stringify(r2.pauta)); assert.match(r2.pauta.motivo, /insuficientes|Reprovada/);
  const ruim = depsPauta({ pedirJson: F.fakePedirJson({ falharNa: 'v1' }) });
  const pf = await Pauta.criar({ url: 'https://techcrunch.com/2026/10/lumenpets' }, { deps: ruim }); const r3 = await Pauta.executarTudo(pf.id, { deps: ruim, maxMs: 60000 });
  assert.strictEqual(r3.pauta.estado, 'erro'); assert.ok(r3.pauta.erros.length >= 1); assert.ok(r3.pauta.op_id, 'a pesquisa verificada continua salva');
});

test('pauta: retoma depois de interrupção (processo caiu no meio) sem duplicar oportunidade nem carrossel', async () => {
  novoBanco(); const deps = depsPauta();
  const p = await Pauta.criar({ url: 'https://techcrunch.com/2026/10/lumenpets' }, { deps });
  const a = await Pauta.avancar(p.id, { deps, orcamentoMs: 10000 });   // orçamento curto: para no começo
  assert.strictEqual(a.concluida, false);
  // simula queda: lease preso no banco como se o processo tivesse morrido
  await store.atualizar('pauta', p.id, (d) => { d.lease_ate = new Date(Date.now() - 1000).toISOString(); return d; });
  assert.ok((await Pauta.pendentes()).some((x) => x.id === p.id), 'lease vencido: aparece para retomar');
  const r = await Pauta.executarTudo(p.id, { deps, orcamentoMs: 120000 });
  assert.strictEqual(r.pauta.estado, 'concluida');
  assert.strictEqual((await store.listar('carrossel')).length, 1); assert.strictEqual((await store.listar('oportunidade')).length, 1);
});

test('lote: estado e erro por item, um item ruim não derruba os outros; retomável', async () => {
  novoBanco(); const deps = depsPauta();
  const l = await Pauta.criarLote([{ url: 'https://techcrunch.com/2026/10/lumenpets' }, { url: 'nao-e-link' }, { url: 'https://naoexiste.example/y' }, { url: 'https://piramidex.com' }], { deps });
  assert.strictEqual(l.pautas.length, 3); assert.strictEqual(l.recusadas.length, 1); assert.strictEqual(l.recusadas[0].codigo, 'LINK_INVALIDO');
  const r = await Pauta.executarLote(l.id, { deps, orcamentoMs: 120000 });
  assert.strictEqual(r.concluido, true);
  const est = r.lote; assert.strictEqual(est.concluidas, 1); assert.strictEqual(est.com_erro, 1); assert.strictEqual(est.insuficientes, 1);
  assert.ok(est.itens.every((i) => ['concluida', 'erro', 'insuficiente'].includes(i.estado)));
  await assert.rejects(() => Pauta.criarLote(Array.from({ length: 11 }, () => ({ url: 'https://a.com' })), { deps }), /Até 10/);
});

// ── Padrão único e reversão ─────────────────────────────────────────────────────────────────
test('padrão único: criação pelos modelos antigos é recusada; a reversão CARROSSEL_PADRAO=legado devolve o fluxo antigo', async () => {
  assert.strictEqual(Padrao.atual(), Padrao.ID);
  const mw = Padrao.bloquearCriacaoLegada('teste'); let st = 0; let corpo = null; let passou = false;
  mw({}, { status(s) { st = s; return this; }, json(j) { corpo = j; } }, () => { passou = true; });
  assert.strictEqual(st, 409); assert.strictEqual(corpo.codigo, 'PADRAO_V1'); assert.strictEqual(passou, false);
  await assert.rejects(() => require('./studio').criar({ url: 'https://a.com/x', formato: 'carrossel' }), (e) => e.code === 'PADRAO_V1');
  process.env.CARROSSEL_PADRAO = 'legado';
  try { passou = false; mw({}, {}, () => { passou = true; }); assert.strictEqual(passou, true); assert.strictEqual(Padrao.atual(), null); }
  finally { delete process.env.CARROSSEL_PADRAO; }
});

test('pauta com segunda matéria: com o site oficial bloqueado, duas fontes independentes bastam; link extra inválido é recusado', async () => {
  novoBanco();
  const lerFonte = async (u) => (/lumenpets\.com/.test(u) && !/techcrunch|exame/.test(u) ? { legivel: false, acesso: 'negado' } : F.fakeLerFonte(u));
  const deps = depsPauta({ lerFonte });
  await assert.rejects(() => Pauta.criar({ url: 'https://exame.com/2026/10/lumenpets', fontes: ['nao-e-link'] }, { deps }), (e) => e.code === 'LINK_INVALIDO');
  const so = await Pauta.criar({ url: 'https://exame.com/2026/10/lumenpets' }, { deps }); const r1 = await Pauta.executarTudo(so.id, { deps, orcamentoMs: 120000 });
  assert.strictEqual(r1.pauta.estado, 'insuficiente', 'uma matéria só, sem site oficial, não basta');
  novoBanco();
  const p = await Pauta.criar({ url: 'https://exame.com/2026/10/lumenpets', fontes: ['https://techcrunch.com/2026/10/lumenpets'] }, { deps });
  const r = await Pauta.executarTudo(p.id, { deps, orcamentoMs: 120000 });
  assert.strictEqual(r.pauta.estado, 'concluida', JSON.stringify(r.pauta.verificacao)); assert.ok(r.pauta.carrossel_id);
});

test('verificação: número citado pela IA em uma fonte só é procurado pelo código na outra fonte independente (trecho literal)', async () => {
  novoBanco();
  const lerFonte = async (u) => (/lumenpets\.com/.test(u) && !/techcrunch|exame/.test(u) ? { legivel: false, acesso: 'negado' } : F.fakeLerFonte(u));
  const base = F.fakePedirJson();
  const pedirJson = async (o) => { const r = await base(o); if (/Você confere fatos/.test(o.sistema)) { const um = Math.min(...r.dados.afirmacoes.map((a) => a.documento)); r.dados.afirmacoes = r.dados.afirmacoes.filter((a) => a.documento === um); } return r; };
  const deps = depsPauta({ lerFonte, pedirJson });
  const p = await Pauta.criar({ url: 'https://exame.com/2026/10/lumenpets', fontes: ['https://techcrunch.com/2026/10/lumenpets'] }, { deps });
  const r = await Pauta.executarTudo(p.id, { deps, orcamentoMs: 120000 });
  const op = (await store.obter('oportunidade', r.pauta.op_id)).doc;
  const cli = op.verificacao.claims.filter((c) => c.tipo === 'clientes');
  assert.strictEqual(cli.length, 2, 'a segunda fonte foi encontrada pelo código'); assert.ok(cli.every((c) => c.usavel));
  assert.ok(cli.some((c) => c.observacoes.some((o) => /Encontrada pelo código/.test(o))));
  assert.strictEqual(r.pauta.estado, 'concluida');
});

test('método: fato com id de afirmação verificada é reconhecido; proporção por extenso sem fonte é bloqueada', async () => {
  const op = await criarOp(); const r = rascunhoV1(op);
  const cUso = r.briefing.fatos[0].claim_id; r.briefing.fatos[0] = { id: cUso, texto: r.briefing.fatos[0].texto, claim_id: null, campo_do_negocio: null };
  r.telas[4].base = [cUso];
  const m = Metodo.montarDoc(r, op, { v1: true });
  assert.ok(!Metodo.validarBriefing(m.briefing, op, { v1: true }).some((e) => /não tem fonte/.test(e)), 'id de afirmação vira claim_id');
  r.telas[1].corpo = 'Um terço da comida produzida vai para o lixo, e a planta sem cuidado seca. A tarefa cai sempre no mesmo funcionário, que não tem tempo.';
  const v = Metodo.validarDocMin({ ...Metodo.montarDoc(r, op, { v1: true }), template: Padrao.ID }, op);
  assert.ok(v.bloqueios.some((b) => /proporção sem comprovação/.test(b.mensagem)), v.bloqueios.map((b) => b.mensagem).join(' | '));
});

test('método: briefing no formato da IA real (fatos como texto com ids, telas apontando as afirmações) é normalizado sem criar fato sem fonte', async () => {
  const op = await criarOp(); const r = rascunhoV1(op);
  const cUso = r.briefing.fatos[0].claim_id; const cMod = r.briefing.fatos[1].claim_id;
  r.briefing.fatos = [`A Casa Verde tem mais de 250 mil usuários, segundo a empresa (${cUso}).`, `A empresa cobra assinatura mensal por vaso (${cMod}).`, { texto: 'O escritório sem planta fica frio e a planta sem cuidado seca.', campo_do_negocio: 'problema' }, 'Um fato inventado sem nenhuma fonte.'];
  r.briefing.analises = [{ texto: 'Uma leitura é que o escritório paga pela troca e pelo cuidado.', base: [cMod, 'f3'], causalidade_demonstrada: false }];
  r.briefing.mecanismos.forEach((m) => { m.base = [cMod]; }); r.briefing.decisao_especifica.base = [cMod];
  r.telas.forEach((t) => { if (t.base?.length) t.base = [cMod]; }); r.telas[4].base = [cUso];
  const m = Metodo.montarDoc(r, op, { v1: true }); const errs = Metodo.validarBriefing(m.briefing, op, { v1: true });
  assert.ok(m.briefing.fatos.some((f) => f.claim_id === cUso && !/\(c\d/.test(f.texto)), 'fato-texto ligado à afirmação e sem os ids no texto');
  assert.ok(m.briefing.analises[0].id, 'análise ganha id');
  assert.ok(errs.some((e) => /f4 não tem fonte/.test(e)), 'o fato inventado continua bloqueado');
  assert.strictEqual(errs.filter((e) => !/f4 não tem fonte/.test(e)).length, 0, errs.join(' | '));
});

test('método: faixa verificada vale nos dois números; campo do negócio e seções do briefing citados como base são normalizados', async () => {
  const Copy = require('./radar/copy');
  const claims = [{ id: 'c6', tipo: 'preco', numero: 4, texto: 'Os compradores pagam entre US$4 e US$6 por bolsa.', trecho: 'The buyer pays $4 to $6 for the bag', usavel: true }];
  assert.deepStrictEqual(Copy.numerosNaoComprovados('A bolsa custa de US$ 4 a US$ 6.', claims), []);
  assert.deepStrictEqual(Copy.numerosNaoComprovados('A bolsa custa US$ 9.', claims).length, 1, 'número fora da faixa continua bloqueado');
  const op = await criarOp(); const r = rascunhoV1(op);
  r.briefing.analises[0].base = ['negocio.operacao']; r.telas[1].base = ['negocio.problema']; r.telas[5].base = ['hipoteses', 'h1'];
  const m = Metodo.montarDoc(r, op, { v1: true });
  assert.ok(m.briefing.fatos.some((f) => f.id === 'negocio.operacao' && f.campo_do_negocio === 'operacao'));
  assert.deepStrictEqual(m.telas.find((t) => t.funcao === 'aplicacao').base, []);
  const v = Metodo.validarDocMin({ ...m, template: Padrao.ID }, op);
  assert.ok(!v.bloqueios.some((b) => /aponta um fato que não existe|precisa apontar fatos/.test(b.mensagem)), v.bloqueios.map((b) => b.mensagem).join(' | '));
});
