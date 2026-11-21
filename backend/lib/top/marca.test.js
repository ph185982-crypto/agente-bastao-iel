// Formato "Por trás da marca" (pipeline top, formato 'marca'): arte, fotos (enviadas → Commons → Pexels → cor da marca),
// foto do Pedro no último slide, rotas com login e a régua de números. IA, Commons, Pexels e downloads são FALSOS.
// node --test backend/lib/top/marca.test.js   (MARCA_DUMP=/pasta grava os PNGs dos slides)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const express = require('express');
const sharp = require('sharp');
const arm = require('../armazem');
const T = require('./pipeline');
const K = require('./checagem');
const P = require('./prompts');
const Fotos = require('./fotos');
const AM = require('../arteMarca');
const A = require('../arte');
const M = require('../../../static/contentModel');
const { ACCOUNT } = require('../account');

// Matéria FICTÍCIA (marca e números inventados para o teste; não são dados reais de nenhuma empresa).
const MATERIA = 'A rede de milkshakes Vaca Mimosa chegou a 640 lojas em 2026 e mira faturar R$ 1 bilhão no ano que vem, segundo a empresa. O fundador, João Exemplo, disse que a rede "já nasceu para ser grande". A marca vende copos de 500 ml com cobertura exagerada, pensados para render foto nas redes sociais. As lojas ficam em ruas de bairro, e não em shopping, para pagar aluguel menor. A rede cresce por franquias: o franqueado paga a montagem da loja e a marca fica com a fábrica das caldas.';
const FATOS = { protagonista: 'João Exemplo', fatos: [
  { id: 'a', texto: 'A Vaca Mimosa chegou a 640 lojas em 2026.', trecho: 'A rede de milkshakes Vaca Mimosa chegou a 640 lojas em 2026', tipo: 'fato' },
  { id: 'b', texto: 'A empresa mira faturar R$ 1 bilhão no ano que vem.', trecho: 'mira faturar R$ 1 bilhão no ano que vem, segundo a empresa', tipo: 'previsao', quem: 'a empresa' },
  { id: 'c', texto: 'A marca vende copos de 500 ml com cobertura exagerada, pensados para render foto.', trecho: 'A marca vende copos de 500 ml com cobertura exagerada, pensados para render foto nas redes sociais.', tipo: 'fato' },
  { id: 'd', texto: 'As lojas ficam em ruas de bairro, e não em shopping, para pagar aluguel menor.', trecho: 'As lojas ficam em ruas de bairro, e não em shopping, para pagar aluguel menor.', tipo: 'fato' },
  { id: 'e', texto: 'A rede cresce por franquias e fica com a fábrica das caldas.', trecho: 'A rede cresce por franquias: o franqueado paga a montagem da loja e a marca fica com a fábrica das caldas.', tipo: 'fato' },
] };
const ANGULO = { marca: 'Vaca Mimosa', fundador: 'João Exemplo', gatilhos: { curiosidade: 3, mecanismo: 3, marca_conhecida: 2, numero: 2 }, tese: 'A Vaca Mimosa ganha dinheiro com a calda que vende ao franqueado, e o copo gigante faz o marketing de graça.', por_que_mandaria: 'Olha o truque do milkshake.', enviar_para: 'quem tem loja', cor_marca: '#7B3FA0', imagem: { busca: 'milkshake shop counter' } };
const JURI = { versoes: [{ indice: 0, notas: { honestidade: 9 }, nota: 8.7, defeito: '' }, { indice: 1, notas: { honestidade: 9 }, nota: 8.0, defeito: '' }], vencedora: 0, capas_escolhidas: [0, 1] };
const SALA = { capas: [{ mente: 'halbert', texto: 'O milkshake gigante da Vaca Mimosa é a propaganda dela.' }] };
const roteiro = (extra = {}) => ({
  capas: [{ texto: 'A Vaca Mimosa mira **R$ 1 bilhão** vendendo calda para os próprios franqueados', mecanismo: 'numero' }, { texto: 'Por que a Vaca Mimosa foge do shopping', mecanismo: 'pergunta' }],
  telas: [
    { papel: 'contexto', titulo: 'Uma rede de milkshake com 640 lojas', texto: 'A Vaca Mimosa chegou a 640 lojas em 2026, quase todas abertas por franqueados.', imagem_busca: 'milkshake shop', fatos: ['a'] },
    { papel: 'estrategia', titulo: 'O copo faz o marketing', texto: 'O copo de 500 ml com cobertura exagerada foi pensado para render foto. Cada cliente posta e a marca aparece de graça.', imagem_busca: 'big milkshake cup', fatos: ['c'] },
    { papel: 'estrategia', titulo: 'Rua de bairro, aluguel menor', texto: 'As lojas ficam na rua, longe do shopping. O aluguel cai e o preço do copo cabe no bolso de quem passa.', imagem_busca: 'street shop brazil', fatos: ['d'] },
    { papel: 'estrategia', titulo: 'O lucro está na calda', texto: 'O franqueado paga a montagem da loja. A marca fica com a fábrica das caldas e vende para a própria rede.', imagem_busca: 'chocolate syrup', fatos: ['e'] },
    { papel: 'licao', titulo: 'O que isso ensina', texto: 'Na minha leitura, a lição é simples: quem controla o insumo que todo mundo precisa ganha em cada venda, mesmo sem ter a loja.', imagem_busca: null, fatos: ['e'] },
  ],
  legenda: 'Copo grande, loja de rua e calda própria. Qual marca você quer que eu destrinche na próxima?',
  hashtags: ['negocios', 'franquias', 'marketing'], cta_motivo: 'pra ver a estratégia da próxima marca', ...extra,
});

function iaFalsa({ roteiros, angulo = ANGULO, juri = JURI } = {}) {
  let r = 0; const chamadas = [];
  const pedirJson = async ({ sistema, usuario }) => {
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : /sala de redação/i.test(sistema) ? 'sala' : /revisor de honestidade/.test(sistema) ? 'revisor' : 'roteiro';
    chamadas.push({ tipo, sistema, usuario });
    const dados = tipo === 'fatos' ? FATOS : tipo === 'angulo' ? angulo : tipo === 'juri' ? juri : tipo === 'sala' ? SALA : tipo === 'revisor' ? { capas: [] } : roteiros[Math.min(r++, roteiros.length - 1)];
    return { dados: JSON.parse(JSON.stringify(dados)), llm: { provider: 'simulado' } };
  };
  return { pedirJson, chamadas };
}
const jpeg = (cor, w = 1200, h = 1500) => sharp({ create: { width: w, height: h, channels: 3, background: cor } }).jpeg().toBuffer();
const PEDRO = () => jpeg('#FF6A1F', 1200, 1500);
function deps(ia, extra = {}) {
  const log = { carregar: [], commons: [], pexels: [], fotoDe: [] };
  const d = {
    ...ia,
    lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/materia', url_final: 'https://exemplo.test/materia', titulo: 'Vaca Mimosa mira R$ 1 bilhão', veiculo: 'Revista Exemplo', publicada_em: '2026-11-10T12:00:00Z', texto: MATERIA, legivel: true }),
    fotoPedro: async () => ({ dados: await PEDRO(), meta: { id: 'fp_teste', tipo: 'foto_pedro', autor: null, licenca: 'Foto do próprio Pedro', exige_credito: false, origem: 'Acervo do Pedro' } }),
    carregar: async (url) => { log.carregar.push(url); return { status: 200, url_final: url, corpo: await jpeg('#335577') }; },
    fotosDaMarca: async (nome, o) => { log.commons.push({ nome, max: o.max }); return [{ dados: await jpeg('#AA7733'), meta: { id: 'commons_loja1', tipo: 'foto_real', titulo: 'File:Vaca Mimosa loja.jpg', origem: 'https://commons.wikimedia.org/wiki/File:Vaca_Mimosa_loja.jpg', autor: 'Fulano', licenca: 'CC BY 4.0', exige_credito: true } }]; },
    fotoDe: async (nome) => { log.fotoDe.push(nome); return null; },
    buscarFoto: async (q, o) => { log.pexels.push(q); if (/chocolate syrup/.test(q)) throw new Error('sem resultado'); const id = `pexels_${log.pexels.length}`; if ((o?.excluir || []).includes(id)) throw new Error('repetida'); return { dados: await jpeg('#557755'), meta: { id, tipo: 'ilustrativa', autor: `Fotógrafa ${log.pexels.length}`, licenca: 'Pexels License', origem: `https://www.pexels.com/photo/${log.pexels.length}` } }; },
    ...extra,
  };
  return { d, log };
}
const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const ler = async (id) => (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, id)).doc;
const DUMP = process.env.MARCA_DUMP || null;
const pixel = async (png, left, top) => { const { data } = await sharp(png).extract({ left, top, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true }); return [...data].slice(0, 3); };

test('arte: capa, tela e final em 1080×1350; capa com foto sangrada e "deslize"; final com a foto do Pedro e a chamada para seguir', async () => {
  const foto = await jpeg('#2266AA');
  const capa = await A.renderizarSlide({ layout: 'marca_capa', tema_visual: 'marca', funcao: 'capa', texto: 'A Vaca Mimosa mira **R$ 1 bilhão** com calda própria', dados: { marca: 'Vaca Mimosa', kicker: 'POR TRÁS DA MARCA' } }, { indice: 1, total: 7, imagem: foto });
  const tela = await A.renderizarSlide({ layout: 'marca_tela', tema_visual: 'marca', funcao: 'explicacao', titulo: 'O copo faz o marketing', texto: 'O copo de 500 ml foi pensado para render foto. Cada cliente posta e a marca aparece de graça.', dados: { marca: 'Vaca Mimosa', rotulo: 'A estratégia 1' } }, { indice: 3, total: 7, imagem: foto });
  const fim = await A.renderizarSlide({ layout: 'marca_final', tema_visual: 'marca', funcao: 'encerramento', titulo: T.FINAL_MARCA.titulo, texto: T.FINAL_MARCA.texto }, { indice: 7, total: 7, imagem: await PEDRO() });
  for (const r of [capa, tela, fim]) { const m = await sharp(r.png).metadata(); assert.deepStrictEqual([m.width, m.height], [1080, 1350]); assert.strictEqual(r.metrics.cabe, true, JSON.stringify(r.metrics.problemas)); assert.strictEqual(r.metrics.tema, 'marca'); }
  assert.ok(capa.metrics.elementos.includes('foto_sangrada') && capa.metrics.elementos.includes('capa_marca'));
  assert.ok(capa.metrics.blocos[0].tam >= 64, 'manchete grande');
  // embaixo da capa o degradê escurece a foto (texto branco legível)
  const [r1, g1, b1] = await pixel(capa.png, 1040, 1330); assert.ok(r1 < 40 && g1 < 40 && b1 < 40, `rodapé ${[r1, g1, b1]}`);
  assert.ok(tela.metrics.elementos.includes('foto_topo') && tela.metrics.blocos.some((b) => b.nome === 'titulo') && tela.metrics.blocos.some((b) => b.nome === 'texto'));
  // a foto ocupa o topo da tela (cor da foto), o texto fica no fundo escuro embaixo
  const [tr, tg, tb] = await pixel(tela.png, 540, 300); assert.ok(Math.abs(tr - 0x22) < 12 && Math.abs(tg - 0x66) < 12 && Math.abs(tb - 0xAA) < 12, `topo ${[tr, tg, tb]}`);
  assert.ok(fim.metrics.elementos.includes('foto_do_pedro') && fim.metrics.elementos.includes('chamada_seguir'));
  assert.ok(fim.metrics.blocos.some((b) => b.nome === 'cta_seguir' && b.tam >= 52), 'chamada em letra grande');
  const [pr, pg, pb] = await pixel(fim.png, 540, 200); assert.ok(pr > 230 && pg > 80 && pg < 130 && pb < 60, `retrato do Pedro no topo ${[pr, pg, pb]}`);
  if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(`${DUMP}/arte-capa.png`, capa.png); fs.writeFileSync(`${DUMP}/arte-tela.png`, tela.png); fs.writeFileSync(`${DUMP}/arte-final.png`, fim.png); }
});

test('arte: sem foto usa o fundo na cor da marca; sem a foto do Pedro, retrato provisório; texto longo e final sem @ saem cabe:false', async () => {
  const capa = await AM.renderizar({ layout: 'marca_capa', funcao: 'capa', texto: 'Manchete curta', dados: { marca: 'Vaca Mimosa', cor: '#7B3FA0' } }, { indice: 1, total: 7 }, null);
  assert.ok(capa.metrics.elementos.includes('fundo_cor_marca'));
  const [r, g, b] = await pixel(capa.png, 20, 300); assert.ok(r > g && b > g, `fundo roxo da marca ${[r, g, b]}`);
  const tela = await AM.renderizar({ layout: 'marca_tela', titulo: 'Título', texto: 'Texto curto.', dados: { cor: 'não é cor' } }, { indice: 2, total: 7 }, null);
  assert.ok(tela.metrics.cabe && tela.metrics.elementos.includes('fundo_cor_marca'));
  const fim = await AM.renderizar({ layout: 'marca_final', titulo: T.FINAL_MARCA.titulo, texto: T.FINAL_MARCA.texto }, { indice: 7, total: 7 }, null);
  assert.ok(fim.metrics.cabe && fim.metrics.elementos.includes('retrato_provisorio'));
  const longo = await AM.renderizar({ layout: 'marca_tela', titulo: 'Um título comprido que ocupa bastante espaço na tela toda', texto: Array.from({ length: 6 }, () => 'Uma frase longa que se repete para encher o bloco de texto além do que cabe no tamanho mínimo legível.').join(' ') }, { indice: 2, total: 7 }, null);
  assert.strictEqual(longo.metrics.cabe, false); assert.ok(longo.metrics.problemas.some((p) => /mínimo legível/.test(p)));
  const capaLonga = await AM.renderizar({ layout: 'marca_capa', texto: Array.from({ length: 30 }, () => 'palavra').join(' ') }, { indice: 1, total: 7 }, null);
  assert.strictEqual(capaLonga.metrics.cabe, false);
  const semAt = await AM.renderizar({ layout: 'marca_final', titulo: 'Eu mostro a estratégia.', texto: 'Obrigado por ler.' }, { indice: 7, total: 7 }, null);
  assert.strictEqual(semAt.metrics.cabe, false, 'último slide sem a chamada para seguir o @ não passa');
});

test('pipeline: formato marca vira 7 slides (capa, contexto, 3 estratégias, lição, final do Pedro), fotos na ordem enviadas → Commons → Pexels → cor; portões liberados', async () => {
  novo(); const ia = iaFalsa({ roteiros: [roteiro(), roteiro()] });
  const { d, log } = deps(ia);
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', marca: 'Vaca Mimosa', fotos: ['https://exemplo.test/foto-capa.jpg'], foco: 'o lucro da calda' });
  assert.strictEqual(c.top.entrada.formato, 'marca'); assert.deepStrictEqual(c.top.entrada.fotos, ['https://exemplo.test/foto-capa.jpg']);
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify([r.conteudo.top.motivo, r.conteudo.top.erros]));
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  assert.strictEqual(doc.top.formato, 'marca'); assert.strictEqual(v.formato, 'marca'); assert.strictEqual(doc.formato, 'carrossel');
  assert.strictEqual(v.slides.length, 7);
  assert.deepStrictEqual(v.slides.map((s) => s.layout), ['marca_capa', 'marca_tela', 'marca_tela', 'marca_tela', 'marca_tela', 'marca_tela', 'marca_final']);
  assert.deepStrictEqual(v.slides.map((s) => s.funcao), ['capa', 'contexto', 'explicacao', 'explicacao', 'explicacao', 'opiniao', 'encerramento']);
  assert.deepStrictEqual(v.slides.slice(1, 6).map((s) => s.dados.rotulo), ['O contexto', 'A estratégia 1', 'A estratégia 2', 'A estratégia 3', 'O que isso ensina']);
  assert.ok(v.slides.every((s) => s.tema_visual === 'marca' && s.dados.marca === 'Vaca Mimosa' && s.dados.cor === '#7B3FA0'));
  assert.strictEqual(v.slides[0].dados.kicker, 'POR TRÁS DA MARCA');
  // fotos: capa = enviada pelo Pedro; tela 1 = Commons; telas seguintes = Pexels; a da calda falhou → cor da marca; lição sem busca → Pexels com a busca do ângulo
  assert.deepStrictEqual(log.carregar, ['https://exemplo.test/foto-capa.jpg']);
  assert.strictEqual(v.slides[0].imagem_id, `dada_${require('crypto').createHash('sha1').update('https://exemplo.test/foto-capa.jpg').digest('hex').slice(0, 12)}`);
  assert.strictEqual(v.slides[1].imagem_id, 'commons_loja1');
  assert.deepStrictEqual(log.fotoDe, ['João Exemplo'], 'tentou o fundador no Commons');
  assert.ok(/^pexels_/.test(v.slides[2].imagem_id) && /^pexels_/.test(v.slides[3].imagem_id));
  assert.strictEqual(v.slides[4].imagem_id, undefined, 'calda sem foto: fundo na cor da marca');
  assert.ok(/^pexels_/.test(v.slides[5].imagem_id)); assert.ok(log.pexels.includes('milkshake shop counter'), 'lição sem busca própria usa a busca do ângulo');
  assert.ok(!log.carregar.some((u) => /materia/.test(u)), 'nunca baixa a foto da matéria');
  // origem e licença de cada imagem
  const img = (id) => doc.imagens.find((i) => i.id === id);
  const dada = img(v.slides[0].imagem_id);
  assert.strictEqual(dada.tipo, 'foto_fornecida'); assert.strictEqual(dada.origem, 'https://exemplo.test/foto-capa.jpg'); assert.match(dada.licenca, /Fornecida pelo Pedro/); assert.strictEqual(dada.fornecida_por, 'pedro');
  assert.strictEqual(img('commons_loja1').licenca, 'CC BY 4.0');
  assert.ok(v.slides.filter((s) => s.imagem_id).every((s) => img(s.imagem_id)?.origem), 'toda imagem usada tem origem');
  // último slide: a foto do Pedro e a chamada para seguir
  const fim = v.slides.at(-1);
  assert.strictEqual(fim.imagem_id, 'fp_teste'); assert.strictEqual(fim.titulo, T.FINAL_MARCA.titulo); assert.match(fim.texto, /Segue @pedro_destrava pra ver a próxima/);
  assert.strictEqual(v.cta, 'Segue o @pedro_destrava pra ver a estratégia da próxima marca.');
  // legenda: corpo + fonte + crédito do Commons + crédito do Pexels
  assert.match(v.legenda, /Fonte: Revista Exemplo/); assert.match(v.legenda, /Foto: Fulano \(CC BY 4\.0\), via Wikimedia Commons\./); assert.match(v.legenda, /Fotos ilustrativas: .*\(Pexels\)\./);
  // usou o prompt e o júri do formato
  assert.ok(ia.chamadas.some((x) => x.tipo === 'angulo' && /POR TRÁS DA MARCA/.test(x.sistema) && /FOCO PEDIDO PELO PEDRO: o lucro da calda/.test(x.usuario)));
  assert.ok(ia.chamadas.some((x) => x.tipo === 'roteiro' && /série "POR TRÁS DA MARCA"/.test(x.sistema) && /\(Vaca Mimosa\)/.test(x.sistema)));
  assert.ok(ia.chamadas.some((x) => x.tipo === 'juri' && /FORMATO: POR TRÁS DA MARCA/.test(x.usuario)));
  // arte: todos os slides desenhados e cabendo; portões sem nenhum bloqueio
  const renders = doc.arte.renders.filter((x) => x.versao === v.id);
  assert.strictEqual(renders.length, 7); assert.ok(renders.every((x) => x.metrics.cabe && x.metrics.tema === 'marca'));
  assert.ok(renders.find((x) => x.slide_id === fim.id).elementos.includes('foto_do_pedro'));
  assert.ok(renders.find((x) => x.slide_id === v.slides[4].id).elementos.includes('fundo_cor_marca'));
  assert.deepStrictEqual(require('../studio').prepararRevisao(doc).bloqueios.map((b) => `${b.id}: ${b.detalhe}`), []);
  assert.strictEqual(T.resumo(doc).marca, 'Vaca Mimosa'); assert.strictEqual(T.resumo(doc).foto_do_pedro, true);
  if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); for (const x of renders) fs.writeFileSync(`${DUMP}/pipeline-${x.slide_id}.jpg`, (await arm.armazem().arquivos.obter(ACCOUNT.ig_id, x.blob_key)).dados); }
});

test('números: só os dos fatos verificados — versão com número inventado é reprovada e reescrita; frase da legenda com número solto sai', async () => {
  novo();
  const inventado = roteiro();
  inventado.telas[2] = { ...inventado.telas[2], texto: 'O aluguel na rua custa 40% menos que no shopping e sobra R$ 9 mil por mês.' };
  const limpo = roteiro({ legenda: 'Copo grande e calda própria. A margem chega a 70% em cada copo. Qual marca você quer ver na próxima?' });
  const ia = iaFalsa({ roteiros: [inventado, inventado, limpo, limpo] });
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca' });
  const r = await T.executarTudo(c.id, { deps: deps(ia).d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const reescritas = ia.chamadas.filter((x) => x.tipo === 'roteiro');
  assert.ok(reescritas.length >= 3 && /“40%” não está em nenhum fato verificado/.test(reescritas[2].sistema), 'a reescrita recebeu o número apontado');
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  const tudo = [...v.slides.map((s) => `${s.titulo || ''} ${s.texto || ''}`), v.legenda].join(' ');
  assert.ok(!/40%|9 mil|70%/.test(tudo), 'nenhum número fora dos fatos chega ao carrossel');
  assert.match(v.legenda, /Qual marca você quer ver na próxima\?/);
  // os números que ficaram estão ligados a fatos com fonte
  const numeros = M.extrairNumeros(v.slides.map((s) => `${s.titulo || ''} ${s.texto || ''}`).join(' ')).filter(M.exigeOrigem);
  assert.ok(numeros.length > 0 && numeros.every((n) => doc.top.fatos.some((f) => f.valores.some((x) => M.igual(x, n.valor)))));
  // checagem pura do formato: sem tela de prova não é problema; sem estratégia ou sem lição é
  const ok = K.checarRoteiro({ ...T.normalizarRoteiro(roteiro(), 'marca'), capa: 'Por que a Vaca Mimosa foge do shopping' }, doc.top.fatos, { formato: 'marca' });
  assert.deepStrictEqual(ok.problemas, []);
  const ruim = T.normalizarRoteiro(roteiro({ telas: [roteiro().telas[0], roteiro().telas[1], roteiro().telas[0], roteiro().telas[0]] }), 'marca');
  const pr = K.checarRoteiro({ ...ruim, capa: 'Capa' }, doc.top.fatos, { formato: 'marca' }).problemas;
  assert.ok(pr.some((p) => /1 tela\(s\) de estratégia/.test(p)) && pr.some((p) => /última tela deve ser a lição/.test(p)), pr.join(' | '));
});

test('sem fotos de lugar nenhum: todos os slides saem na cor da marca; sem foto do Pedro, retrato provisório e aviso', async () => {
  novo(); const ia = iaFalsa({ roteiros: [roteiro(), roteiro()] });
  const antes = process.env.PEXELS_API_KEY; delete process.env.PEXELS_API_KEY;
  try {
    const { d } = deps(ia, { fotoPedro: async () => null, fotosDaMarca: async () => [], fotoDe: async () => null });
    delete d.buscarFoto;
    const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca' });
    const r = await T.executarTudo(c.id, { deps: d });
    assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
    const doc = await ler(c.id); const v = M.versaoAtiva(doc);
    assert.ok(v.slides.every((s) => !s.imagem_id));
    assert.match(doc.top.aviso_foto, /retrato provisório/);
    const renders = doc.arte.renders.filter((x) => x.versao === v.id);
    assert.ok(renders.slice(0, -1).every((x) => x.elementos.includes('fundo_cor_marca')));
    assert.ok(renders.at(-1).elementos.includes('retrato_provisorio'));
    assert.deepStrictEqual(doc.top.fotos_marca_resumo, { total: 6, com_foto: 0, cor_da_marca: 6, falhas: [] });
    assert.deepStrictEqual(require('../studio').prepararRevisao(doc).bloqueios.map((b) => b.id), []);
  } finally { if (antes === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = antes; }
});

test('ângulo: matéria sem decisão de negócio explicável é descartada; entrada valida links de fotos', async () => {
  novo();
  const ia = iaFalsa({ roteiros: [roteiro()], angulo: { ...ANGULO, gatilhos: { curiosidade: 3, mecanismo: 1, marca_conhecida: 3, numero: 3 } } });
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca' });
  const r = await T.executarTudo(c.id, { deps: deps(ia).d });
  assert.strictEqual(r.conteudo.top.estado, 'descartada'); assert.match(r.conteudo.top.motivo, /decisão de negócio/);
  await assert.rejects(T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', fotos: ['ftp://x/y.jpg'] }), (e) => e.code === 'ENTRADA');
  await assert.rejects(T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', fotos: ['http://127.0.0.1/foto.jpg'] }), (e) => e.code === 'ENTRADA');
  await assert.rejects(T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', fotos: Array.from({ length: 9 }, (_, i) => `https://exemplo.test/${i}.jpg`) }), (e) => e.code === 'ENTRADA');
  const ok = T.entradaMarca({ marca: ' Vaca  <b>Mimosa ', fotos: 'https://exemplo.test/a.jpg', foco: 'calda' });
  assert.deepStrictEqual(ok, { marca: 'Vaca Mimosa', fotos: ['https://exemplo.test/a.jpg'], foco: 'calda' });
});

test('Commons da marca: várias fotos, só licença aceita (sem CC BY-SA), sem logotipo, só do host do Commons', async () => {
  const pagina = (title, lic, url = `https://upload.wikimedia.org/x/${encodeURIComponent(title)}`) => ({ title, imageinfo: [{ thumburl: url, descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, width: 1400, height: 1000, extmetadata: { LicenseShortName: { value: lic }, Artist: { value: '<a>Autora</a>' } } }] });
  const busca = { query: { pages: { 1: pagina('File:Vaca Mimosa loja centro 2025.jpg', 'CC BY 4.0'), 2: pagina('File:Vaca Mimosa logo.png', 'Public domain'), 3: pagina('File:Vaca Mimosa quiosque.jpg', 'CC BY-SA 4.0'), 4: pagina('File:Vaca Mimosa fachada.jpg', 'CC0'), 5: pagina('File:Outra marca.jpg', 'CC BY 4.0'), 6: pagina('File:Vaca Mimosa produto.jpg', 'CC BY 4.0', 'https://evil.test/x.jpg') } } };
  const grande = Buffer.alloc(30000, 1); const pedidos = [];
  const fetcher = async (url) => { pedidos.push(url); if (/api\.php/.test(url)) return { ok: true, json: async () => busca }; return { ok: true, arrayBuffer: async () => grande }; };
  const fotos = await Fotos.fotosDaMarca('Vaca Mimosa', { fetcher, max: 4 });
  assert.deepStrictEqual(fotos.map((f) => f.meta.titulo).sort(), ['File:Vaca Mimosa fachada.jpg', 'File:Vaca Mimosa loja centro 2025.jpg']);
  assert.ok(fotos.every((f) => f.meta.origem.startsWith('https://commons.wikimedia.org/') && f.meta.autor === 'Autora'));
  assert.strictEqual(fotos.find((f) => /loja/.test(f.meta.titulo)).meta.exige_credito, true);
  assert.strictEqual(fotos.find((f) => /fachada/.test(f.meta.titulo)).meta.exige_credito, false);
  assert.ok(!pedidos.some((u) => /evil\.test/.test(u)), 'host fora do Commons nunca é baixado');
});

test('rotas: /api/carrosseis/marca e /api/top/carrosseis com formato marca exigem login e criam o carrossel (assíncrono)', async () => {
  const a = novo();
  const envAntes = { ...process.env };
  Object.assign(process.env, { VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-marca-1' });
  delete process.env.APP_ACCESS_MODE;
  const access = require('../access');
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api', access.exigeAcesso); app.use('/api/carrosseis', require('../../routes/carrosseis')); app.use('/api/top', require('../../routes/top'));
  let srv; await new Promise((ok) => { srv = app.listen(0, ok); });
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const post = async (rota, corpo, token) => { const r = await fetch(`${base}/${rota}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) }); return { status: r.status, json: await r.json() }; };
  const corpo = { link: 'https://exemplo.test/materia', marca: 'Vaca Mimosa', fotos: ['https://exemplo.test/capa.jpg'], foco: 'a calda' };
  try {
    assert.strictEqual((await post('carrosseis/marca', corpo)).status, 401, 'sem login');
    assert.strictEqual((await post('carrosseis/marca', corpo, 'abc.def')).status, 401, 'token falso');
    assert.strictEqual((await post('top/carrosseis', { url: corpo.link, formato: 'marca' })).status, 401);
    const token = access.sign({ sub: 'pedro', exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await post('carrosseis/marca', corpo, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    assert.ok(r.json.id && r.json.estado === 'em_andamento' && r.json.formato === 'marca' && r.json.passo.endsWith('/passo'));
    const doc = await ler(r.json.id);
    assert.deepStrictEqual([doc.top.entrada.formato, doc.top.entrada.marca, doc.top.entrada.fotos, doc.top.entrada.foco], ['marca', 'Vaca Mimosa', ['https://exemplo.test/capa.jpg'], 'a calda']);
    const t = await post('top/carrosseis', { url: corpo.link, formato: 'marca', marca: 'Vaca Mimosa' }, token);
    assert.strictEqual(t.status, 201, JSON.stringify(t.json)); assert.strictEqual((await ler(t.json.id)).top.entrada.formato, 'marca');
    const ruim = await post('carrosseis/marca', { marca: 'Vaca Mimosa' }, token);
    assert.strictEqual(ruim.status, 400); assert.strictEqual(ruim.json.code, 'ENTRADA');
    const fotoRuim = await post('carrosseis/marca', { ...corpo, fotos: ['http://10.0.0.1/x.jpg'] }, token);
    assert.strictEqual(fotoRuim.status, 400); assert.strictEqual(fotoRuim.json.code, 'ENTRADA');
    void a;
  } finally {
    await new Promise((ok) => srv.close(ok));
    for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k];
    Object.assign(process.env, envAntes);
    arm._definir(undefined);
  }
});

test('prompts do formato: roteiro pede 6–8 slides com contexto, 2–4 estratégias e lição; número só dos fatos', () => {
  const p = P.roteiro({ tese: 't', porQue: 'p', formato: 'marca', marca: 'Vaca Mimosa', foco: 'a calda' });
  assert.match(p, /6 a 8 slides/); assert.match(p, /"contexto"/); assert.match(p, /"estrategia" \(2 a 4 telas\)/); assert.match(p, /"licao"/);
  assert.match(p, /Se os fatos não têm o número, a tela fica SEM número/); assert.match(p, /O PEDRO PEDIU FOCO EM: a calda/);
  assert.match(P.ANGULO_MARCA, /"mecanismo"/);
  assert.ok(T.FORMATOS.includes('marca'));
});
