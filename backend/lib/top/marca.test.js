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

function iaFalsa({ roteiros, angulo = ANGULO, juri = JURI, casar = () => ({ slides: [] }), handles = ['vacamimosa'] } = {}) {
  let r = 0; const chamadas = [];
  const pedirJson = async (args) => {
    const { sistema, usuario } = args;
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : /sala de redação/i.test(sistema) ? 'sala' : /revisor de honestidade/.test(sistema) ? 'revisor' : /editor de fotografia do carrossel/.test(sistema) ? 'casar' : /perfil OFICIAL no Instagram/.test(sistema) ? 'handles' : 'roteiro';
    chamadas.push({ tipo, sistema, usuario, args });
    const dados = tipo === 'fatos' ? FATOS : tipo === 'angulo' ? angulo : tipo === 'juri' ? juri : tipo === 'sala' ? SALA : tipo === 'revisor' ? { capas: [] } : tipo === 'casar' ? casar(usuario) : tipo === 'handles' ? { handles } : roteiros[Math.min(r++, roteiros.length - 1)];
    return { dados: JSON.parse(JSON.stringify(dados)), llm: { provider: 'simulado' } };
  };
  return { pedirJson, chamadas };
}
const jpeg = (cor, w = 1200, h = 1500) => sharp({ create: { width: w, height: h, channels: 3, background: cor } }).jpeg().toBuffer();
// Foto "única" (padrão de blocos sorteado pela semente): fotos lisas teriam o mesmo dHash e virariam repetidas.
function foto(semente, { w = 1200, h = 1500, claro = false } = {}) {
  let x = 0; for (const ch of String(semente)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const bw = 12; const bh = 15; const raw = Buffer.alloc(bw * bh * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = claro ? 200 + Math.floor(rnd() * 55) : Math.floor(rnd() * 200);
  return sharp(raw, { raw: { width: bw, height: bh, channels: 3 } }).resize(w, h, { kernel: 'nearest' }).jpeg().toBuffer();
}
const sha12 = (s) => require('crypto').createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const PEDRO = () => jpeg('#FF6A1F', 1200, 1500);
function deps(ia, extra = {}) {
  const log = { carregar: [], commons: [], pexels: [], fotoDe: [] };
  const d = {
    ...ia,
    lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/materia', url_final: 'https://exemplo.test/materia', titulo: 'Vaca Mimosa mira R$ 1 bilhão', veiculo: 'Revista Exemplo', publicada_em: '2026-11-10T12:00:00Z', texto: MATERIA, legivel: true }),
    fotoPedro: async () => ({ dados: await PEDRO(), meta: { id: 'fp_teste', tipo: 'foto_pedro', autor: null, licenca: 'Foto do próprio Pedro', exige_credito: false, origem: 'Acervo do Pedro' } }),
    carregar: async (url) => { log.carregar.push(url); return { status: 200, url_final: url, corpo: await foto(url) }; },
    fotosDaMarca: async (nome, o) => { log.commons.push({ nome, max: o.max, soLivre: o.soLivre }); return [{ dados: await foto('commons-loja'), meta: { id: 'commons_loja1', tipo: 'foto_real', titulo: 'File:Vaca Mimosa loja.jpg', origem: 'https://commons.wikimedia.org/wiki/File:Vaca_Mimosa_loja.jpg', autor: 'Fulano', licenca: 'CC0', exige_credito: false, alt: 'Loja da Vaca Mimosa' } }]; },
    fotoDe: async (nome, o) => { log.fotoDe.push({ nome, soLivre: o?.soLivre }); return null; },
    fotosDoConceito: async (q, o) => { log.conceito = [...(log.conceito || []), { q, soLivre: o.soLivre }]; return []; },
    buscarFoto: async (q, o) => { log.pexels.push(q); if (/chocolate syrup/.test(q)) throw new Error('sem resultado'); const id = `pexels_${log.pexels.length}`; if ((o?.excluir || []).includes(id)) throw new Error('repetida'); return { dados: await foto(`pexels-${q}`, { w: 1080, h: 1350 }), meta: { id, tipo: 'ilustrativa', autor: `Fotógrafa ${log.pexels.length}`, licenca: 'Pexels License', origem: `https://www.pexels.com/photo/${log.pexels.length}`, alt: `Foto de ${q}` } }; },
    lerHtml: async () => '<html><head><title>x</title></head><body><p>sem fotos</p></body></html>',
    graph: null, visao: null, ocr: async () => '',
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

test('pipeline: formato marca vira 7 slides (capa, contexto, 3 estratégias, lição, final do Pedro); sem Instagram nem visão, fotos por palavras em comum → busca → cor; portões liberados', async () => {
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
  // fotos: a enviada pelo Pedro entra (sem texto que combine, vai no 1º slide livre); a loja do Commons vai na tela que fala de lojas;
  // as demais saem da busca de cada tela (Commons vazio → Pexels); a da calda falhou → cor da marca; lição sem busca → busca do ângulo
  assert.deepStrictEqual(log.carregar, ['https://exemplo.test/foto-capa.jpg']);
  assert.strictEqual(v.slides[0].imagem_id, `dada_${require('crypto').createHash('sha1').update('https://exemplo.test/foto-capa.jpg').digest('hex').slice(0, 12)}`);
  assert.strictEqual(v.slides[1].imagem_id, 'commons_loja1');
  assert.deepStrictEqual(log.fotoDe, [{ nome: 'João Exemplo', soLivre: true }], 'tentou o fundador no Commons, só CC0/domínio público');
  assert.ok(log.commons.every((x) => x.soLivre === true) && (log.conceito || []).every((x) => x.soLivre === true));
  assert.deepStrictEqual(doc.top.foto_por_slide.s2.por, 'tags');
  assert.ok(/^pexels_/.test(v.slides[2].imagem_id), 'conceito (copo) vem do banco de imagens');
  assert.strictEqual(v.slides[3].imagem_id, undefined, 'lugar ("street shop") nunca vem do banco: sem foto oficial sobrando, cor da marca');
  assert.strictEqual(v.slides[4].imagem_id, undefined, 'calda sem foto: fundo na cor da marca');
  assert.strictEqual(v.slides[5].imagem_id, undefined); assert.ok(!log.pexels.some((q) => /shop/.test(q)), 'busca de loja não vai ao banco de imagens');
  assert.ok(!log.carregar.some((u) => /materia/.test(u)), 'nunca baixa a foto da matéria');
  // origem e licença de cada imagem
  const img = (id) => doc.imagens.find((i) => i.id === id);
  const dada = img(v.slides[0].imagem_id);
  assert.strictEqual(dada.tipo, 'foto_fornecida'); assert.strictEqual(dada.origem, 'https://exemplo.test/foto-capa.jpg'); assert.match(dada.licenca, /Fornecida pelo Pedro/); assert.strictEqual(dada.fornecida_por, 'pedro');
  assert.strictEqual(img('commons_loja1').licenca, 'CC0');
  assert.ok(v.slides.filter((s) => s.imagem_id).every((s) => img(s.imagem_id)?.origem), 'toda imagem usada tem origem');
  // último slide: a foto do Pedro e a chamada para seguir
  const fim = v.slides.at(-1);
  assert.strictEqual(fim.imagem_id, 'fp_teste'); assert.strictEqual(fim.titulo, T.FINAL_MARCA.titulo); assert.match(fim.texto, /Segue @pedro_destrava pra ver a próxima/);
  assert.strictEqual(v.cta, 'Segue o @pedro_destrava pra ver a estratégia da próxima marca.');
  // legenda: corpo + fonte, SEM linha de crédito de foto (decisão do Pedro); origem e licença ficam em c.imagens
  assert.match(v.legenda, /Fonte: Revista Exemplo/); assert.ok(!/Fotos?:|Fotos ilustrativas|Pexels|Wikimedia|Divulgação/.test(v.legenda), v.legenda);
  assert.ok(v.slides.filter((s) => s.imagem_id).every((s) => img(s.imagem_id)?.licenca));
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
    const rs = doc.top.fotos_marca_resumo; assert.deepStrictEqual([rs.total, rs.com_foto, rs.cor_da_marca, rs.candidatas, rs.falhas], [6, 0, 6, 0, []]);
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

// ── Fotos escolhidas pelo conteúdo (fotosCandidatas.js) ──────────────────────
const FC = require('./fotosCandidatas');
const HTML_MATERIA = `<html><head><meta property="og:image" content="https://exemplo.test/img/og-fachada.jpg"></head><body>
<figure><img src="https://exemplo.test/img/og-fachada.jpg" alt=""><figcaption>Fachada de uma loja da rede (Divulgação)</figcaption></figure>
<figure><img data-src="https://exemplo.test/img/calda.jpg"><figcaption>Fábrica de caldas. Foto: Divulgação/Vaca Mimosa</figcaption></figure>
<figure><img src="https://exemplo.test/img/reuters.jpg"><figcaption>Movimento na loja. Foto: Fulano/Reuters</figcaption></figure></body></html>`;
function graphFalso(log, { seguidores = 250000 } = {}) {
  return async (metodo, caminho, params) => {
    log.graph.push(params.fields);
    const h = params.fields.match(/username\(([^)]+)\)/)[1];
    if (h !== 'vacamimosa') throw Object.assign(new Error('não existe'), { meta: { tipo: 'outro' } });
    const p2 = /media\.after\(/.test(params.fields);
    const data = p2 ? [{ id: 'm9', media_type: 'IMAGE', media_url: 'https://cdn.test/fundador.jpg', caption: 'Nosso fundador na fábrica', permalink: 'https://www.instagram.com/p/9/', like_count: 300 }] : [
      { id: 'm1', media_type: 'IMAGE', media_url: 'https://cdn.test/balcao.jpg', caption: 'Nosso balcão', permalink: 'https://www.instagram.com/p/1/', like_count: 900 },
      { id: 'm2', media_type: 'CAROUSEL_ALBUM', permalink: 'https://www.instagram.com/p/2/', caption: 'O copo', like_count: 800, children: { data: [{ id: 'm2a', media_type: 'IMAGE', media_url: 'https://cdn.test/copo.jpg' }, { id: 'm2b', media_type: 'VIDEO', media_url: 'https://cdn.test/video.mp4' }] } },
      { id: 'm3', media_type: 'VIDEO', media_url: 'https://cdn.test/reel.mp4', permalink: 'https://www.instagram.com/p/3/' },
      { id: 'm4', media_type: 'IMAGE', media_url: 'https://cdn.test/cartaz.jpg', caption: 'Promoção', permalink: 'https://www.instagram.com/p/4/', like_count: 700 },
      { id: 'm5', media_type: 'IMAGE', media_url: 'https://cdn.test/balcao-copia.jpg', caption: 'repost', permalink: 'https://www.instagram.com/p/5/', like_count: 100 },
      { id: 'm6', media_type: 'IMAGE', media_url: 'https://cdn.test/entrega.jpg', caption: 'Delivery', permalink: 'https://www.instagram.com/p/6/', like_count: 50 },
    ];
    return { business_discovery: { username: 'vacamimosa', name: 'Vaca Mimosa', biography: 'Milkshakes de verdade', followers_count: seguidores, media: { data, paging: p2 ? {} : { cursors: { after: 'CUR' } } } } };
  };
}
const igId = (m) => `ig_${sha12(m)}`; const matId = (u) => `mat_${sha12(u)}`;
const DESC = {
  [igId('m1')]: { descricao: 'balcão de loja de rua com clientes', tags: ['balcão', 'loja', 'rua'], impacto: 7 },
  [igId('m2a')]: { descricao: 'copo gigante de milkshake com cobertura', tags: ['copo', 'milkshake'], impacto: 9 },
  [igId('m4')]: { descricao: 'cartaz de promoção', tags: ['cartaz'], impacto: 3, tem_texto: true },
  [igId('m6')]: { descricao: 'entregador com bolsa de delivery na moto', tags: ['entrega', 'delivery'], impacto: 6 },
  [igId('m9')]: { descricao: 'fundador na fábrica', tags: ['fundador'], impacto: 6 },
  [matId('https://exemplo.test/img/og-fachada.jpg')]: { descricao: 'fachada de loja da rede', tags: ['fachada'], impacto: 8 },
  [matId('https://exemplo.test/img/calda.jpg')]: { descricao: 'caldas de chocolate na fábrica', tags: ['calda', 'fábrica'], impacto: 7 },
};

test('fotos por conteúdo: Instagram oficial (vídeo fora, repetida e foto com texto descartadas) + Divulgação da matéria + visão + casamento validado; foto do Pedro sempre entra; lacuna pelo Commons CC0; legenda sem crédito', async () => {
  novo();
  const og = matId('https://exemplo.test/img/og-fachada.jpg'); const calda = matId('https://exemplo.test/img/calda.jpg');
  const casar = () => ({ slides: [
    { slide: 's1', foto: og, motivo: 'fachada marcante para a capa sobre a rede' }, { slide: 's2', foto: igId('m1'), motivo: 'loja de rua' },
    { slide: 's3', foto: igId('m2a'), motivo: 'o copo que faz o marketing' }, { slide: 's4', foto: igId('m4'), motivo: 'inválida: tem texto' },
    { slide: 's5', foto: 'c999', motivo: 'id inexistente' }, { slide: 's6', foto: null, busca: 'franchise owner' }] });
  const ia = iaFalsa({ roteiros: [roteiro(), roteiro()], casar, handles: ['vacamimosa_oficial', 'vacamimosa'] });
  const { d, log } = deps(ia); log.graph = []; log.visao = [];
  const pedroUrl = 'https://exemplo.test/fundador-pedro.jpg';
  Object.assign(d, {
    graph: graphFalso(log), igId: '1789', metaUso: () => ({ pct: 10 }), lerHtml: async () => HTML_MATERIA, fotosDaMarca: async () => [],
    carregar: async (url) => { log.carregar.push(url); return { status: 200, url_final: url, corpo: await foto(url === 'https://cdn.test/balcao-copia.jpg' ? 'https://cdn.test/balcao.jpg' : url) }; },
    visao: async (imgs) => { log.visao.push(imgs.map((i) => i.id)); return { modelo: 'gemini-falso', itens: imgs.map((i) => ({ id: i.id, tem_texto: false, marca_dagua: false, ...(DESC[i.id] || { descricao: 'fundador sorrindo', tags: ['fundador'], impacto: 5 }) })) }; },
    fotosDoConceito: async (q, o) => { log.conceito = [...(log.conceito || []), { q, soLivre: o.soLivre }]; return /franchise/.test(q) ? [{ dados: await foto('commons-franquia'), meta: { id: 'commons_franquia', tipo: 'foto_real', titulo: 'File:Franchise owner.jpg', origem: 'https://commons.wikimedia.org/wiki/File:Franchise_owner.jpg', autor: 'Fulana', licenca: 'CC0', exige_credito: false, alt: 'Dono de franquia no balcão' } }] : []; },
  });
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', marca: 'Vaca Mimosa', fotos: [pedroUrl] });
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify([r.conteudo.top.motivo, r.conteudo.top.erros]));
  const doc = await ler(c.id); const v = M.versaoAtiva(doc); const C = doc.top.fotos_candidatas;
  // Instagram: @ sugerido pela IA conferido no business_discovery (o 1º não existe), 2 páginas, sem vídeo
  assert.ok(/username\(vacamimosa_oficial\)/.test(log.graph[0]) && /username\(vacamimosa\)/.test(log.graph[1]) && /media\.after\(CUR\)/.test(log.graph[2]));
  assert.strictEqual(doc.top.fotos_marca_estado.ig.handle, 'vacamimosa');
  assert.ok(!log.carregar.some((u) => /\.mp4|reuters/.test(u)), 'nem vídeo nem foto de agência');
  assert.ok(C.some((x) => x.id === igId('m9')), 'leu a 2ª página');
  assert.match(C.find((x) => x.id === igId('m5')).descartada, /repetida/);
  assert.ok(!C.some((x) => x.id === igId('m4')) && !log.carregar.includes('https://cdn.test/cartaz.jpg'), 'post de promoção (arte com texto) nem é baixado');
  assert.ok(!log.visao.flat().includes(igId('m5')), 'repetida nem vai para a visão');
  // casamento: escolhas válidas da IA; inválidas trocadas; foto do Pedro entra; lacunas por palavras e pelo Commons
  const fps = doc.top.foto_por_slide; const dada = `dada_${sha12(pedroUrl)}`;
  assert.deepStrictEqual([fps.s1.id, fps.s2.id, fps.s3.id], [og, igId('m1'), igId('m2a')]); assert.strictEqual(fps.s1.por, 'ia'); assert.match(fps.s1.motivo, /fachada/);
  assert.deepStrictEqual([fps.s4.id, fps.s4.por], [dada, 'pedro']);
  assert.deepStrictEqual([fps.s5.id, fps.s5.por], [calda, 'tags']);
  assert.deepStrictEqual([fps.s6.id, fps.s6.por], ['commons_franquia', 'busca']); assert.deepStrictEqual(log.conceito, [{ q: 'franchise owner', soLivre: true }]);
  const ids = v.slides.slice(0, 6).map((s) => s.imagem_id); assert.deepStrictEqual(ids, [og, igId('m1'), igId('m2a'), dada, calda, 'commons_franquia']);
  assert.strictEqual(new Set(ids).size, ids.length, 'sem repetir');
  const casou = ia.chamadas.find((x) => x.tipo === 'casar'); assert.strictEqual(casou.args.pago, 'nunca'); assert.match(casou.usuario, /entregador com bolsa de delivery/);
  // metadados de origem/licença em c.imagens; legenda sem crédito
  const img = (id) => doc.imagens.find((i) => i.id === id);
  assert.match(img(igId('m1')).licenca, /^Divulgação\/Vaca Mimosa \(perfil oficial @vacamimosa no Instagram\)$/); assert.strictEqual(img(igId('m1')).origem, 'https://www.instagram.com/p/1/');
  assert.match(img(calda).licenca, /^Divulgação\/Vaca Mimosa/); assert.strictEqual(img(og).relevancia, 'alta');
  assert.ok(!doc.imagens.some((i) => i.id === igId('m6')), 'candidata não usada fica só no acervo');
  assert.ok(!/Fotos?:|Divulgação|Pexels|Commons/.test(v.legenda), v.legenda);
  assert.deepStrictEqual(require('../studio').prepararRevisao(doc).bloqueios.map((b) => b.id), []);
  const rs = doc.top.fotos_marca_resumo; assert.deepStrictEqual([rs.com_foto, rs.instagram, rs.visao], [6, '@vacamimosa', 'ok']);
  assert.ok(await arm.armazem().arquivos.obter(ACCOUNT.ig_id, `mini:${igId('m6')}`), 'miniatura guardada para a troca manual');
});

test('fotos sem visão e com a Meta no limite: Instagram pulado, legenda da matéria vira descrição, OCR barra foto com texto, casamento por palavras sem IA', async () => {
  novo();
  const html = `<html><body><figure><img src="https://exemplo.test/img/calda.jpg"><figcaption>Fábrica de caldas da rede (Divulgação)</figcaption></figure>
<figure><img src="https://exemplo.test/img/cartaz.jpg"><figcaption>Cartaz da promoção do copo (Divulgação)</figcaption></figure></body></html>`;
  const ia = iaFalsa({ roteiros: [roteiro(), roteiro()], casar: () => { throw new Error('IA fora do ar'); } });
  const { d, log } = deps(ia); log.graph = [];
  Object.assign(d, {
    graph: graphFalso(log), igId: '1789', metaUso: () => ({ pct: 90 }), lerHtml: async () => html, fotosDaMarca: async () => [],
    carregar: async (url) => { log.carregar.push(url); return { status: 200, url_final: url, corpo: await foto(url, { claro: /cartaz/.test(url) }) }; },
    visao: null, agora: (() => { let t = Date.parse('2026-11-21T12:00:00Z'); return () => (t += 2 * 3600e3); })(), // a cota não volta em 6 h

    ocr: async (png) => { const s = await sharp(png).stats(); return s.channels[0].mean > 190 ? Array.from({ length: 20 }, () => 'promoção').join(' ') : 'ok'; },
  });
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', marca: 'Vaca Mimosa' });
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const doc = await ler(c.id); const C = doc.top.fotos_candidatas; const st = doc.top.fotos_marca_estado;
  assert.deepStrictEqual(log.graph, [], 'cota da Meta acima de 85%: nenhuma chamada');
  assert.ok(st.ig.pausado && /cota da Meta/.test(st.ig.erro));
  assert.ok(st.falhas.some((f) => /várias horas/.test(f)), 'esperou a cota e só então seguiu sem o Instagram');
  assert.ok(!ia.chamadas.some((x) => x.tipo === 'handles'));
  const caldaC = C.find((x) => x.id === matId('https://exemplo.test/img/calda.jpg'));
  assert.deepStrictEqual([caldaC.descrita_por, caldaC.descricao, caldaC.impacto], ['legenda', 'Fábrica de caldas da rede (Divulgação)', null]);
  assert.match(C.find((x) => x.id === matId('https://exemplo.test/img/cartaz.jpg')).descartada, /texto gravado na foto \(20 palavras\)/);
  assert.strictEqual(st.visao, 'indisponivel'); assert.match(st.casou_por, /sem IA/);
  // a tela da calda recebe a foto da calda (palavras em comum), mesmo sem IA
  assert.deepStrictEqual([doc.top.foto_por_slide.s5.id, doc.top.foto_por_slide.s5.por], [caldaC.id, 'tags']);
});

test('troca manual: GET /fotos lista candidatas e motivos; POST /foto troca um slide e redesenha só ele; aprovado recusa', async () => {
  novo(); const ia = iaFalsa({ roteiros: [roteiro(), roteiro()] });
  const { d } = deps(ia);
  const c = await T.criar({ url: 'https://exemplo.test/materia', formato: 'marca', marca: 'Vaca Mimosa', fotos: ['https://exemplo.test/foto-capa.jpg'] });
  await T.executarTudo(c.id, { deps: d });
  const envAntes = { ...process.env };
  Object.assign(process.env, { VERCEL: '1', APP_ACCESS_CODE: 'codigo-de-teste-marca-2' }); delete process.env.APP_ACCESS_MODE;
  const access = require('../access');
  const app = express(); app.use(express.json()); app.use('/api', access.exigeAcesso); app.use('/api/top', require('../../routes/top'));
  let srv; await new Promise((ok) => { srv = app.listen(0, ok); });
  const base = `http://127.0.0.1:${srv.address().port}/api/top/carrosseis/${c.id}`;
  const token = access.sign({ sub: 'pedro', exp: Math.floor(Date.now() / 1000) + 60 });
  const pedir = async (rota, corpo, tk = token) => { const r = await fetch(`${base}${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}) }); return { status: r.status, json: await r.json() }; };
  try {
    assert.strictEqual((await pedir('/fotos', null, null)).status, 401);
    assert.strictEqual((await pedir('/foto', { slide_id: 's3', candidata_id: 'x' }, null)).status, 401);
    const g = await pedir('/fotos');
    assert.strictEqual(g.status, 200, JSON.stringify(g.json));
    assert.strictEqual(g.json.slides.length, 6); assert.ok(g.json.candidatas.length >= 3 && g.json.candidatas.every((x) => !x.mini || x.mini.startsWith('/api/sync/arquivos/mini%3A')));
    assert.strictEqual(g.json.slides[1].foto.id, 'commons_loja1'); assert.match(g.json.slides[1].foto.motivo, /palavras em comum/);
    const antes = await ler(c.id); const vAntes = M.versaoAtiva(antes);
    // a) link novo no slide 3: só ele é redesenhado
    // (link novo pela função, com o download falso; a rota chama a mesma função)
    const t = await T.trocarFoto(c.id, { slide_id: 's3', url: 'https://exemplo.test/nova.jpg' }, { deps: d });
    assert.strictEqual(t.redesenhados, 1);
    const doc = await ler(c.id); const v = M.versaoAtiva(doc);
    assert.notStrictEqual(v.id, vAntes.id); assert.strictEqual(v.slides[2].imagem_id, `dada_${sha12('https://exemplo.test/nova.jpg')}`);
    assert.deepStrictEqual(doc.top.foto_por_slide.s3, { id: v.slides[2].imagem_id, motivo: 'escolhida por você', por: 'manual', origem: 'pedro' });
    const rs = doc.arte.renders.filter((x) => x.versao === v.id); assert.strictEqual(rs.length, 7);
    const chaveAntes = (sid) => antes.arte.renders.find((x) => x.versao === vAntes.id && x.slide_id === sid).blob_key;
    assert.ok(rs.filter((x) => x.blob_key !== chaveAntes(x.slide_id)).map((x) => x.slide_id).join() === 's3');
    assert.strictEqual(doc.status, 'em_revisao'); assert.strictEqual(v.legenda, vAntes.legenda, 'legenda não muda (sem crédito de foto)');
    assert.ok(doc.imagens.some((i) => i.id === v.slides[2].imagem_id && i.tipo === 'foto_fornecida'));
    // b) candidata que já está em outro slide: sai de lá (sem repetir) e os dois slides são redesenhados
    const t2 = await pedir('/foto', { slide_id: 's4', candidata_id: 'commons_loja1' });
    assert.strictEqual(t2.status, 200, JSON.stringify(t2.json)); assert.strictEqual(t2.json.redesenhados, 2);
    const v2 = M.versaoAtiva(await ler(c.id)); assert.strictEqual(v2.slides[3].imagem_id, 'commons_loja1'); assert.strictEqual(v2.slides[1].imagem_id, undefined);
    assert.strictEqual((await pedir('/foto', { slide_id: 's7', candidata_id: 'commons_loja1' })).status, 400, 'último slide (Pedro) não troca');
    assert.strictEqual((await pedir('/foto', { slide_id: 's2' })).status, 400);
    const reg = await arm.armazem().conteudos.obter(ACCOUNT.ig_id, c.id); reg.doc.status = 'aprovado'; await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, reg.doc, reg.rev);
    assert.strictEqual((await pedir('/foto', { slide_id: 's2', candidata_id: 'commons_loja1' })).status, 409);
  } finally {
    await new Promise((ok) => srv.close(ok));
    for (const k of Object.keys(process.env)) if (!(k in envAntes)) delete process.env[k];
    Object.assign(process.env, envAntes);
  }
});

test('unidades: casamento pelo conteúdo (delivery listado por último), sem repetir; Instagram respeita o freio e confere o perfil; matéria só Divulgação; dHash acha a repetida', async () => {
  const slides = [{ sid: 's1', i: 0, texto: 'O quiosque que virou rede' }, { sid: 's2', i: 1, texto: 'O delivery paga a conta — o entregador leva o copo de bairro em bairro' }, { sid: 's3', i: 2, texto: 'O volume vem do celular' }];
  const cands = [
    { id: 'c1', origem: 'instagram', descricao: 'balcão do quiosque com clientes', tags: ['quiosque', 'balcão'], impacto: 8 },
    { id: 'c2', origem: 'instagram', descricao: 'cliente feliz tirando foto com o celular', tags: ['celular', 'cliente'], impacto: 7 },
    { id: 'c3', origem: 'materia', descricao: 'cartaz', tags: [], impacto: 9, descartada: 'texto gravado na foto' },
    { id: 'c4', origem: 'commons', descricao: 'entregador com bolsa de delivery', tags: ['delivery', 'entregador'], impacto: 5 },
  ];
  // IA: escolhas certas (inclusive a última candidata), uma repetida e uma descartada viram lacuna preenchida pelo conteúdo
  const a = FC.validarCasamento(slides, cands, { slides: [{ slide: 's1', foto: 'c1' }, { slide: 's2', foto: 'c4', motivo: 'entregador' }, { slide: 's3', foto: 'c1' }] }, { marca: 'Milky Moo' });
  assert.deepStrictEqual(Object.fromEntries(Object.entries(a.atrib).map(([k, x]) => [k, x.id])), { s1: 'c1', s2: 'c4', s3: 'c2' });
  assert.strictEqual(a.atrib.s3.por, 'tags');
  // sem IA nenhuma: o conteúdo decide
  const b = FC.validarCasamento(slides, cands, null, { marca: 'Milky Moo' });
  assert.deepStrictEqual([b.atrib.s1.id, b.atrib.s2.id, b.atrib.s3.id], ['c1', 'c4', 'c2']);
  const c = FC.validarCasamento(slides, cands, { slides: [{ slide: 's1', foto: 'c3' }] });
  assert.notStrictEqual(c.atrib.s1?.id, 'c3', 'descartada nunca entra');
  // Instagram: freio da cota (mesmo da Reciclagem) e conferência do perfil
  const chamadas = []; const graph = async (m, cam, p) => { chamadas.push(p.fields); return { business_discovery: { username: 'milkymoo', name: 'Milky Moo', followers_count: 900000, media: { data: [{ id: '1', media_type: 'IMAGE', media_url: 'https://cdn.test/1.jpg' }], paging: { cursors: { after: 'X' } } } } }; };
  const meta = require('../meta');
  const pausado = await FC.lerInstagram({ marca: 'Milky Moo', handles: ['milkymoo'], graph, igId: '1', freio: () => meta.freio({ pct: 86 }) });
  assert.ok(pausado.pausado && chamadas.length === 0);
  const leve = await FC.lerInstagram({ marca: 'Milky Moo', handles: ['milkymoo'], graph, igId: '1', freio: () => meta.freio({ pct: 65 }) });
  assert.strictEqual(chamadas.length, 1, 'acima de 60%: uma página só'); assert.strictEqual(leve.handle, 'milkymoo');
  assert.strictEqual(FC.confereMarca({ username: 'milkymoo_fake', name: 'fã', followers_count: 1200 }, 'Milky Moo'), false, 'poucos seguidores');
  assert.strictEqual(FC.confereMarca({ username: 'cacaushow', name: 'Cacau Show', followers_count: 5e6 }, 'Cacau Show'), true);
  assert.strictEqual(FC.confereMarca({ username: 'chocolatesbr', name: 'Chocolates', biography: 'tudo de chocolate', followers_count: 5e6 }, 'Cacau Show'), false, 'nome da marca não aparece');
  // matéria: og:image sem crédito de agência + figura "Divulgação"; foto de agência fica de fora
  const m = FC.imagensDaMateria(HTML_MATERIA, 'https://exemplo.test/materia');
  assert.deepStrictEqual(m.map((x) => [x.url, x.credito]), [['https://exemplo.test/img/og-fachada.jpg', 'divulgacao'], ['https://exemplo.test/img/calda.jpg', 'divulgacao']]);
  assert.strictEqual(FC.imagensDaMateria('<meta property="og:image" content="https://x.test/a.jpg"><figure><img src="https://x.test/a.jpg"><figcaption>Foto: Fulano/Folhapress</figcaption></figure>', 'https://x.test/').length, 0);
  // dHash: mesma foto reduzida = repetida; foto diferente = longe
  const f1 = await foto('a'); const f1menor = await sharp(f1).resize(600, 750).jpeg({ quality: 60 }).toBuffer(); const f2 = await foto('b');
  assert.ok(FC.distancia(await FC.dHash(f1), await FC.dHash(f1menor)) <= 6); assert.ok(FC.distancia(await FC.dHash(f1), await FC.dHash(f2)) > 6);
  // Commons para o conceito: só CC0/domínio público
  const pagina = (title, lic) => ({ title, imageinfo: [{ thumburl: `https://upload.wikimedia.org/x/${encodeURIComponent(title)}`, descriptionurl: 'https://commons.wikimedia.org/wiki/x', width: 2000, height: 1400, extmetadata: { LicenseShortName: { value: lic }, Artist: { value: 'A' } } }] });
  const fetcher = async (url) => (/api\.php/.test(url) ? { ok: true, json: async () => ({ query: { pages: { 1: pagina('File:Delivery courier bag 2020.jpg', 'CC BY 4.0'), 2: pagina('File:Delivery courier motorcycle.jpg', 'CC0') } } }) } : { ok: true, arrayBuffer: async () => Buffer.alloc(30000, 1) });
  const fc = await Fotos.fotosDoConceito('delivery courier', { fetcher });
  assert.deepStrictEqual(fc.map((x) => [x.meta.titulo, x.meta.exige_credito]), [['File:Delivery courier motorcycle.jpg', false]]);
});

test('Meta no limite: a etapa de fotos espera a cota voltar (sem banco de imagens) e busca de lugar usa foto oficial', async () => {
  const FC = require('./fotosCandidatas');
  assert.ok(FC.LUGAR.test('restaurant chain storefront') && FC.LUGAR.test('huge restaurant building') && FC.LUGAR.test('large restaurant interior'));
  assert.ok(!FC.LUGAR.test('delivery courier bag') && !FC.LUGAR.test('smartphone photo food'));
  const c = { top: { angulo: { marca: 'Coco Bambu' }, entrada: {}, fotos_marca_estado: { fase: 'instagram', tentadas: [], falhas: [] }, fotos_candidatas: [] } };
  let t = Date.parse('2026-11-21T12:00:00Z'); let lidas = 0;
  const ctx = { restante: () => 60000, deps: { graph: async () => { lidas++; return {}; }, igId: '1', metaUso: () => ({ pct: 90, regain_min: 30 }), agora: () => t } };
  const io = { salvarArquivo: async () => {}, lerArquivo: async () => null, slots: 6 };
  const r1 = await FC.etapa(c, ctx, io);
  const st = c.top.fotos_marca_estado;
  assert.deepStrictEqual([r1.concluida, st.fase], [false, 'instagram']);
  assert.strictEqual(st.ig_espera_ate, t + 30 * 60000); assert.match(st.ig.aguardando, /nova tentativa/);
  t += 10 * 60000; assert.strictEqual((await FC.etapa(c, ctx, io)).concluida, false, 'antes da hora: nem tenta');
  assert.strictEqual(lidas, 0);
});

// ── "Quem é ele?" (estilo revelacao do formato marca) ─────────────────────────────────────────────────────────────────
// Matéria FICTÍCIA (pessoa e números inventados para o teste).
const MAT_REV = 'O ator Fulano Exemplo pôs US$ 500 mil na Rodaki em 2011 e a fatia passou a valer US$ 60 milhões. Na Casinha, ele investiu US$ 2,5 milhões, que viraram US$ 90 milhões. Ele montou um fundo com dois sócios e espalhou o dinheiro em mais de 70 apostas.';
const FATOS_REV = { protagonista: 'Fulano Exemplo', fatos: [
  { id: 'a', texto: 'Fulano Exemplo pôs US$ 500 mil na Rodaki e a fatia passou a valer US$ 60 milhões.', trecho: 'pôs US$ 500 mil na Rodaki em 2011 e a fatia passou a valer US$ 60 milhões', tipo: 'fato' },
  { id: 'b', texto: 'Na Casinha, ele investiu US$ 2,5 milhões, que viraram US$ 90 milhões.', trecho: 'Na Casinha, ele investiu US$ 2,5 milhões, que viraram US$ 90 milhões.', tipo: 'fato' },
  { id: 'c', texto: 'Ele espalhou o dinheiro em mais de 70 apostas.', trecho: 'espalhou o dinheiro em mais de 70 apostas', tipo: 'fato' },
] };
const ROT_REV = {
  quem: 'Fulano Exemplo',
  capas: [{ texto: 'Ele botou US$ 2,5 milhões na Casinha.', mecanismo: 'numero' }, { texto: 'Ele pôs US$ 2,5 milhões numa empresa de casas.', mecanismo: 'curiosidade' }],
  telas: [
    { papel: 'aposta', empresa: 'Casinha', cor_empresa: '#FF5A5F', titulo: 'Botou US$ 2,5 milhões na Casinha.', texto: 'Virou US$ 90 milhões.', fatos: ['b'] },
    { papel: 'aposta', empresa: 'Rodaki', cor_empresa: '#000000', titulo: 'Na Rodaki ele botou US$ 500 mil.', texto: 'Virou US$ 60 milhões.', fatos: ['a'] },
    { papel: 'revelacao', titulo: 'O investidor é o **Fulano Exemplo**, o ator.', texto: 'Ele montou um fundo com dois sócios.\n\nE espalhou o dinheiro em mais de 70 apostas.', fatos: ['c'] },
    { papel: 'estrategia', titulo: 'Foram mais de 70 apostas', texto: 'As que deram certo pagaram as que viraram pó. Quem copia só o acerto copia sorte.', fatos: ['c'] },
    { papel: 'licao', texto: 'Na minha leitura, a lição é tirar parte do que você ganha trabalhando e pôr pra render sem você.', fatos: [] },
  ],
  legenda: 'Ganhar bem e ficar rico são coisas diferentes. De quem você quer ver as apostas?', hashtags: ['negocios', 'investimento', 'dinheiro'], cta_motivo: 'pra ver onde o próximo famoso pôs dinheiro',
};

test('Quem é ele?: apostas sem o nome, revelação, explicação e lição; logo da empresa no painel; última tela do Pedro', async () => {
  novo();
  const chamadas = [];
  const pedirJson = async ({ sistema, usuario }) => {
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : /revisor de honestidade/.test(sistema) ? 'revisor' : /editor de fotografia/.test(sistema) ? 'casar' : /perfil OFICIAL no Instagram/.test(sistema) ? 'handles' : /sala de redação/i.test(sistema) ? 'sala' : 'roteiro';
    chamadas.push({ tipo, sistema, usuario });
    const dados = tipo === 'fatos' ? FATOS_REV : tipo === 'angulo' ? { marca: 'Fulano Exemplo', gatilhos: { curiosidade: 3, mecanismo: 3, marca_conhecida: 3, numero: 3 }, tese: 'O ator ficou rico pondo o cachê pra render em empresas.', por_que_mandaria: 'Olha onde esse cara pôs dinheiro.', enviar_para: 'quem quer investir', cor_marca: null } : tipo === 'juri' ? JURI : tipo === 'revisor' ? { capas: [] } : tipo === 'casar' ? { slides: [] } : tipo === 'handles' ? { handles: [] } : tipo === 'sala' ? SALA : ROT_REV;
    return { dados: JSON.parse(JSON.stringify(dados)), llm: { provider: 'simulado' } };
  };
  const logos = [];
  const { d } = deps({ pedirJson }, {
    lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/ator', url_final: 'https://exemplo.test/ator', titulo: 'As apostas do ator', veiculo: 'Revista Exemplo', publicada_em: '2026-11-10T12:00:00Z', texto: MAT_REV, legivel: true }),
    logoDe: async (empresa) => { logos.push(empresa); return empresa === 'Casinha' ? { dados: await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect x="0" y="0" width="120" height="120" fill="#FF5A5F"/><rect x="160" y="40" width="240" height="40" fill="#FF5A5F"/></svg>')).png().toBuffer() } : null; },
  });
  const c = await T.criar({ url: 'https://exemplo.test/ator', formato: 'marca', estilo: 'revelacao' });
  assert.strictEqual(c.top.entrada.estilo, 'revelacao');
  const r = await T.executarTudo(c.id, { deps: d });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify([r.conteudo.top.motivo, r.conteudo.top.erros, r.conteudo.top.versoes?.map((v) => v.checagem)]));
  const doc = await ler(c.id); const v = M.versaoAtiva(doc);
  assert.deepStrictEqual(v.slides.map((s) => s.layout), ['rev_aposta', 'rev_aposta', 'rev_foto_texto', 'rev_texto_foto', 'rev_escuro', 'marca_final']);
  assert.strictEqual(v.slides[0].funcao, 'capa'); assert.strictEqual(v.estrutura, 'quem_e_ele');
  assert.deepStrictEqual([v.slides[0].dados.empresa, v.slides[0].dados.cor, v.slides[0].dados.resultado], ['Casinha', '#FF5A5F', 'Virou US$ 90 milhões.']);
  assert.ok(!/Fulano/.test(`${v.slides[0].titulo} ${v.slides[1].titulo} ${v.slides[0].texto} ${v.slides[1].texto}`), 'as apostas não dizem quem é');
  assert.deepStrictEqual(logos.sort(), ['Casinha', 'Rodaki']);
  assert.ok(v.slides[0].dados.logo_id && !v.slides[1].dados.logo_id, 'Casinha tem logo; Rodaki sai com o nome');
  assert.ok(!chamadas.some((x) => x.tipo === 'sala'), 'sem sala de manchetes: a capa é a 1ª aposta');
  assert.ok(chamadas.some((x) => x.tipo === 'roteiro' && /QUEM É ELE/.test(x.sistema)) && chamadas.some((x) => x.tipo === 'juri' && /QUEM É ELE/.test(`${x.sistema} ${x.usuario}`)));
  const els = doc.arte.renders.filter((x) => x.versao === v.id).sort((a, b) => a.indice - b.indice).map((x) => x.elementos);
  assert.ok(els[0].includes('rev_aposta') && els[0].includes('logo_silhueta'), JSON.stringify(els[0]));
  assert.ok(els[1].includes('logo_texto'));
  assert.ok(doc.arte.renders.filter((x) => x.versao === v.id).every((x) => x.metrics.cabe !== false), 'tudo cabe');
  // aposta sem valor não passa na checagem
  const semNumero = K.checarRoteiro({ capa: 'Ele botou dinheiro no Uber.', telas: [{ papel: 'aposta', empresa: 'Uber', titulo: 'Ele entrou no Uber em 2011.', texto: 'Está no portfólio dele.' }, { papel: 'aposta', empresa: 'Rodaki', titulo: 'Botou US$ 500 mil na Rodaki.', texto: 'Virou US$ 60 milhões.' }, { papel: 'revelacao', titulo: 'É ele', texto: 'x' }, { papel: 'estrategia', titulo: 't', texto: 'x' }, { papel: 'leitura', texto: 'x' }], legenda: '' }, FATOS_REV.fatos, { formato: 'marca', estilo: 'revelacao' });
  assert.ok(semNumero.problemas.some((p) => /tela 1: aposta sem valor/.test(p)) && !semNumero.problemas.some((p) => /tela 2: aposta sem valor/.test(p)));
});

test('Google Imagens: só foto grande de site de notícia/marca (banco pago e rede social fora); vira candidata "google" na etapa de fotos', async () => {
  const G = require('./googleImagens');
  const fetcher = async (url, o) => { assert.ok(/real-time-image-search/.test(url) && o.headers['x-rapidapi-key'] !== undefined); return { status: 200, ok: true, text: async () => JSON.stringify({ status: 'OK', data: [
    { url: 'https://exame.com/img/loja-vaca.jpg', title: 'Loja da Vaca Mimosa', source: 'Exame', source_url: 'https://exame.com/x', width: 1600, height: 1000 },
    { url: 'https://media.gettyimages.com/foto.jpg', title: 'Getty', width: 2000, height: 1300 },
    { url: 'https://scontent.cdninstagram.com/a.jpg', title: 'Insta', width: 1080, height: 1350 },
    { url: 'https://site.com/pequena.jpg', title: 'Pequena', width: 400, height: 300 },
  ] }) }; };
  const r = await G.buscar('Vaca Mimosa loja', { fetcher });
  assert.deepStrictEqual(r.map((x) => x.url), ['https://exame.com/img/loja-vaca.jpg']);
  await assert.rejects(G.buscar('x', { fetcher: async () => ({ status: 403, ok: false, text: async () => 'You are not subscribed to this API.' }) }), (e) => e.semAssinatura === true);
  // na etapa de fotos
  const FC = require('./fotosCandidatas');
  novo();
  const c = { id: 'c_g', top: { angulo: { marca: 'Vaca Mimosa' }, entrada: {}, fotos_marca_estado: { fase: 'google', tentadas: [], falhas: [] }, fotos_candidatas: [], versoes: [{ capas: [{ texto: 'Capa' }], telas: [] }], escolha: { versao: 0, capas: [0] } }, fonte_principal: {} };
  const consultas = [];
  const ctx = { restante: () => 60000, ia: async () => ({ dados: { slides: [] } }), deps: { google: { buscar: async (q) => { consultas.push(q); return q === 'Vaca Mimosa loja' ? [{ url: 'https://exame.com/img/loja-vaca.jpg', titulo: 'Loja da Vaca Mimosa', pagina: 'https://exame.com/x', fonte: 'Exame' }] : []; } }, carregar: async (url) => ({ status: 200, url_final: url, corpo: await foto(url) }), visao: null, ocr: async () => '', fotosDaMarca: async () => [], fotoDe: async () => null, fotosDoConceito: async () => [], buscarFoto: async () => { throw new Error('sem'); } } };
  const io = { salvarArquivo: async () => {}, lerArquivo: async () => null, slots: 1 };
  await FC.etapa(c, ctx, io);
  assert.deepStrictEqual(consultas, ['Vaca Mimosa loja', 'Vaca Mimosa']);
  const g = c.top.fotos_candidatas.find((x) => x.origem === 'google');
  assert.ok(g && g.pagina === 'https://exame.com/x');
  assert.match(FC.metaDe(c, g, null).licenca, /Google Imagens \(Exame\)/);
});
