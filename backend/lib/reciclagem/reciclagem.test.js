// Radar de Reciclagem: métrica (VL com mediana, ER ponderado, maturidade de 72 h), coleta tolerante, classificação
// com IA falsa, dedupe e retenção, reciclagem em carrossel e reel (roteiro com vícios é pedido de novo) e a rota.
// node --test backend/lib/reciclagem/reciclagem.test.js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const arm = require('../armazem');
const { ACCOUNT } = require('../account');
const M = require('../../../static/contentModel');
const C = require('./coletar');
const R = require('./reciclar');
const Contas = require('./contas');

const AGORA = Date.parse('2026-11-08T12:00:00Z');
const h = (n) => new Date(AGORA - n * 3600000).toISOString();
const novo = () => { const a = Object.assign(arm.memoria(), { duravel: true }); arm._definir(a); return a; };
const post = (id, { horas = 100, curtidas = 1000, comentarios = 0, views = null, tipo = 'IMAGE', produto = 'FEED', legenda = `Legenda do post ${id}` } = {}) => ({ permalink: `https://www.instagram.com/p/${id}/`, timestamp: h(horas), like_count: curtidas, comments_count: comentarios, view_count: views, media_type: tipo, media_product_type: produto, caption: legenda });

// Graph falsa: devolve business_discovery por handle; "recusada" simula conta que a Meta não deixa ler.
function graphFalsa(porHandle) {
  const chamadas = [];
  const graph = async (metodo, caminho, params) => {
    const handle = /username\(([^)]+)\)/.exec(params.fields)[1]; chamadas.push({ metodo, caminho, handle, fields: params.fields });
    if (handle === 'recusada') throw Object.assign(new Error('Falta permissão para ler este perfil ou a conta não é Business.'), { meta: { tipo: 'permissao', amigavel: 'Falta permissão para ler este perfil ou a conta não é Business.' } });
    const c = porHandle[handle]; if (!c) throw Object.assign(new Error('handle inexistente'), { meta: { tipo: 'outro', amigavel: 'A Meta recusou.' } });
    return { business_discovery: { username: handle, followers_count: c.seguidores, media: { data: c.posts } } };
  };
  return { graph, chamadas };
}
const contasTeste = (handles) => ({ instagram: handles.map((handle) => ({ handle, nome: handle, pais: 'US', idioma: 'en' })), youtube: [] });

// ── Métrica ──────────────────────────────────────────────────────────────────────
test('VL = ER do post ÷ mediana da conta (mediana, não média: o viral não puxa a base)', () => {
  const posts = [1000, 1000, 1000, 1000, 9000].map((c, i) => ({ permalink: `p${i}`, publicado_em: h(100 + i), curtidas: c, comentarios: 0 }));
  const r = C.pontuar(posts, 1000000, { agora: AGORA });
  assert.strictEqual(r.length, 5);
  assert.strictEqual(r[4].mediana_er, 0.001);
  assert.strictEqual(r[4].vl, 9, 'ER 0,009 ÷ mediana 0,001');
  assert.strictEqual(r[0].vl, 1);
  assert.strictEqual(C.mediana([3, 1, 2]), 2); assert.strictEqual(C.mediana([4, 1, 3, 2]), 2.5); assert.strictEqual(C.mediana([]), null);
});

test('ER pondera comentário ×3; sem seguidores ou sem métrica nenhuma fica null (não vira zero)', () => {
  assert.strictEqual(C.er({ curtidas: 100, comentarios: 300 }, 100000), 0.01);
  assert.strictEqual(C.er({ curtidas: null, comentarios: 50 }, 100000), 0.0015, 'curtidas ocultas: só os comentários contam');
  assert.strictEqual(C.er({ curtidas: null, comentarios: null }, 100000), null);
  assert.strictEqual(C.er({ curtidas: 10, comentarios: 1 }, 0), null);
});

test('posts com menos de 72 h ficam fora da comparação; reels ganham sinal de views por seguidor', () => {
  const posts = [{ permalink: 'novo', publicado_em: h(10), curtidas: 50000 }, { permalink: 'a', publicado_em: h(73), curtidas: 100, visualizacoes: 10000 }, { permalink: 'b', publicado_em: h(200), curtidas: 100, visualizacoes: 10000 }, { permalink: 'c', publicado_em: h(300), curtidas: 100, visualizacoes: 50000 }];
  const r = C.pontuar(posts, 100000, { agora: AGORA });
  assert.deepStrictEqual(r.map((p) => p.permalink), ['a', 'b', 'c']);
  assert.strictEqual(r[2].vl_views, 5);
  assert.strictEqual(r[2].vl, 1, 'VL principal continua pelo ER quando há curtidas');
  const soViews = C.pontuar([{ permalink: 'x', publicado_em: h(100), curtidas: null, comentarios: null, visualizacoes: 1000 }, { permalink: 'y', publicado_em: h(100), curtidas: null, comentarios: null, visualizacoes: 4000 }], 1000, { agora: AGORA });
  assert.strictEqual(soViews[1].vl, 1.6, 'curtidas ocultas: o VL cai para o sinal de views');
});

// ── Coleta ───────────────────────────────────────────────────────────────────────
test('coleta do Instagram: 1 chamada por conta, conta recusada só registra o erro e as outras seguem', async () => {
  const g = graphFalsa({ hormozi: { seguidores: 5000000, posts: [post('h1'), post('h2', { curtidas: 9000 }), post('h3'), post('h4', { horas: 5, curtidas: 90000 })] }, joeljota: { seguidores: 6500000, posts: [post('j1', { comentarios: 100 }), post('j2', { comentarios: 100 }), post('j3', { comentarios: 900, tipo: 'VIDEO', produto: 'REELS', views: 2000000 })] } });
  const r = await C.coletarInstagram({ contas: contasTeste(['hormozi', 'recusada', 'joeljota']).instagram, graph: g.graph, igId: '17841', agora: AGORA });
  assert.strictEqual(g.chamadas.length, 3, 'uma chamada por conta');
  assert.ok(g.chamadas.every((c) => c.caminho === '17841' && /media\.limit\(50\)\{like_count,comments_count,view_count,caption,permalink,media_type,timestamp,media_product_type,media_url,thumbnail_url,children\.limit\(20\)\{media_type,media_url\}\}/.test(c.fields)));
  const recusada = r.contas.find((c) => c.handle === 'recusada');
  assert.strictEqual(recusada.ok, false); assert.match(recusada.erro, /permissão/);
  assert.strictEqual(r.contas.filter((c) => c.ok).length, 2);
  assert.strictEqual(r.itens.length, 6, 'o post de 5 h do hormozi não entra');
  const viral = r.itens.find((i) => i.permalink.includes('h2'));
  assert.strictEqual(viral.vl, 9); assert.strictEqual(viral.conta.handle, 'hormozi'); assert.strictEqual(viral.rede, 'instagram');
  assert.strictEqual(r.itens.find((i) => i.permalink.includes('j3')).tipo, 'reel');
  assert.ok(r.itens.every((i) => i.legenda.length <= 2200), 'legenda original guardada, até 2.200 caracteres');
});

test('coleta para na hora se o token da Meta expirou (não gasta as outras chamadas)', async () => {
  const graph = async () => { throw Object.assign(new Error('token'), { meta: { tipo: 'token', amigavel: 'O acesso ao Instagram expirou.' } }); };
  const r = await C.coletarInstagram({ contas: contasTeste(['a', 'b', 'c', 'd']).instagram, graph, igId: 'x', agora: AGORA, concorrencia: 1 });
  assert.strictEqual(r.chamadas, 1); assert.strictEqual(r.parcial, true);
});

test('YouTube só com chave: sem chave é pulado; com chave usa 3 unidades por canal e pontua os vídeos', async () => {
  const sem = await C.coletarYoutube({ canais: [{ canal: '@x' }], chave: '' });
  assert.deepStrictEqual(sem.itens, []); assert.match(sem.pulado, /YOUTUBE_API_KEY/);
  const urls = [];
  const fetcher = async (u) => {
    const url = new URL(u); urls.push(url.pathname + '?' + url.searchParams.get('part'));
    assert.strictEqual(url.searchParams.get('key'), 'CHAVE');
    const json = (o) => ({ ok: true, json: async () => o });
    if (url.pathname.endsWith('/channels')) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, statistics: { subscriberCount: '1000000' } }] });
    if (url.pathname.endsWith('/playlistItems')) return json({ items: ['v1', 'v2', 'v3'].map((id) => ({ contentDetails: { videoId: id } })) });
    return json({ items: [{ id: 'v1', snippet: { publishedAt: h(100), title: 'A', description: '' }, statistics: { likeCount: '1000', commentCount: '0', viewCount: '100000' }, contentDetails: { duration: 'PT12M' } }, { id: 'v2', snippet: { publishedAt: h(200), title: 'B', description: '' }, statistics: { likeCount: '1000', commentCount: '0', viewCount: '100000' }, contentDetails: { duration: 'PT45S' } }, { id: 'v3', snippet: { publishedAt: h(300), title: 'C', description: '' }, statistics: { likeCount: '5000', commentCount: '0', viewCount: '900000' }, contentDetails: { duration: 'PT8M' } }] });
  };
  const r = await C.coletarYoutube({ canais: [{ canal: '@alexhormozi', nome: 'Alex', pais: 'US', idioma: 'en' }], chave: 'CHAVE', fetcher, agora: AGORA });
  assert.strictEqual(r.unidades, 3); assert.strictEqual(urls.length, 3);
  assert.strictEqual(r.itens.length, 3);
  assert.strictEqual(r.itens[2].vl, 5); assert.strictEqual(r.itens[2].vl_views, 9); assert.strictEqual(r.itens[1].tipo, 'short');
  assert.strictEqual(r.itens[0].permalink, 'https://www.youtube.com/watch?v=v1');
});

test('Google Trends RSS: parse simples com CDATA e tráfego; falha de rede vira lista vazia', async () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Taxa Selic &amp; juros]]></title><ht:approx_traffic>200.000+</ht:approx_traffic><ht:news_item><ht:news_item_title>Copom mant&#233;m juros</ht:news_item_title><ht:news_item_url>https://exemplo.test/n1</ht:news_item_url></ht:news_item></item><item><title>Black Friday</title></item></channel></rss>`;
  const t = C.parseTrendsRss(xml);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual(t[0], { titulo: 'Taxa Selic & juros', trafego: '200.000+', noticias: ['Copom mantém juros'], link: 'https://exemplo.test/n1', publicado_em: null });
  assert.deepStrictEqual(await C.tendencias({ fetcher: async () => { throw new Error('rede'); } }), []);
  assert.deepStrictEqual(await C.tendencias({ fetcher: async () => ({ ok: false }) }), []);
  const cruz = C.cruzar(t, [{ id: 'rc_1', tema: 'juros altos matam margem', tese: '' }, { id: 'rc_2', tema: 'preço errado', tese: '' }]);
  assert.deepStrictEqual(cruz[0].itens, ['rc_1']); assert.deepStrictEqual(cruz[1].itens, []);
});

// ── Classificação ────────────────────────────────────────────────────────────────
test('classificação em lote (15 por chamada): mecanismo normalizado, tese que copia a legenda é descartada', async () => {
  const itens = Array.from({ length: 17 }, (_, i) => ({ id: `rc_${i}`, rede: 'instagram', conta: { handle: 'x', pais: 'US', idioma: 'en' }, tipo: 'reel', curtidas: 10, comentarios: 1, vl: 4, legenda: `Legenda original numero ${i} sobre lavanderia que fatura sessenta e sete mil por ano sem funcionario` }));
  const chamadas = [];
  const pedirJson = async ({ sistema, usuario }) => {
    chamadas.push({ sistema, usuario }); const n = (usuario.match(/^\[\d+\] instagram/gm) || []).length;
    return { dados: { itens: Array.from({ length: n }, (_, i) => ({ i, tema: 'negócio chato dá dinheiro', mecanismo: i === 0 ? 'História' : i === 1 ? 'lista de erros' : 'numero', tese: i === 2 ? `Legenda original numero ${chamadas.length === 1 ? 2 : 17} sobre lavanderia que fatura sessenta e sete mil por ano` : 'Negócios simples e pouco glamourosos sustentam quem os opera com disciplina.', ponte_pedro: 'A lavanderia de bairro paga Simples e maquininha como qualquer MEI.' })) } };
  };
  const r = await C.classificar(itens, { pedirJson });
  assert.strictEqual(chamadas.length, 2, '17 itens = 2 lotes');
  assert.match(chamadas[0].usuario, /<<<DADOS LEGENDAS>>>/, 'legenda entra como dado de terceiro');
  assert.match(chamadas[0].sistema, /NÃO copie, NÃO traduza/);
  assert.strictEqual(r.itens[0].mecanismo, 'historia'); assert.strictEqual(r.itens[1].mecanismo, 'lista_erros'); assert.strictEqual(r.itens[3].mecanismo, 'numero');
  assert.strictEqual(r.itens[2].tese, null, 'tese copiada da legenda não entra'); assert.match(r.itens[2].avisos_ia[0], /copiava/);
  assert.ok(r.itens[0].tese && r.itens[0].classificado_em);
  assert.ok(r.itens.every((i) => typeof i.legenda === 'string'), 'a legenda original continua guardada (o app mostra e a cópia usa)');
  assert.strictEqual(C.normalizarMecanismo('Polêmica'), 'polemica'); assert.strictEqual(C.normalizarMecanismo('qualquer coisa'), null);
});

test('IA fora do ar: o lote fica sem classificação (legenda mantida para a próxima coleta), sem erro', async () => {
  const r = await C.classificar([{ id: 'rc_a', conta: {}, legenda: 'x' }], { pedirJson: async () => { throw new Error('429'); } });
  assert.strictEqual(r.itens[0].classificado_em, undefined); assert.strictEqual(r.itens[0].legenda, 'x'); assert.deepStrictEqual(r.erros, ['429']);
});

// ── Armazém ──────────────────────────────────────────────────────────────────────
test('dedupe por permalink, classificação preservada e retenção de 30 dias', async () => {
  novo();
  const item = (vl, extra = {}) => ({ rede: 'instagram', conta: { handle: 'x' }, permalink: 'https://www.instagram.com/p/ABC/', publicado_em: h(100), tipo: 'reel', curtidas: 10, comentarios: 2, vl, vl_er: vl, legenda: 'leg', ...extra });
  let r = await C.guardar([item(4), item(4, { permalink: 'https://www.instagram.com/p/abc' }), item(0.5, { permalink: 'https://www.instagram.com/p/fraco/' }), item(6, { permalink: 'https://www.instagram.com/p/velho/', publicado_em: h(31 * 24) })], { agora: AGORA });
  assert.deepStrictEqual(r, { novos: 1, atualizados: 0, removidos: 0, guardados: 2 }, 'permalink igual (maiúsculas/barra) é o mesmo item; VL < 1,5 e post de 31 dias não entram');
  const id = C.idDe('https://www.instagram.com/p/ABC/');
  let doc = await C.obter(id); assert.strictEqual(doc.legenda, 'leg');
  doc.tema = 'tema'; doc.tese = 'tese'; doc.classificado_em = h(1); doc.legenda = null; await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, id, doc);
  r = await C.guardar([item(5)], { agora: AGORA });
  assert.deepStrictEqual(r, { novos: 0, atualizados: 1, removidos: 0, guardados: 1 });
  doc = await C.obter(id);
  assert.strictEqual(doc.vl, 5, 'métrica atualizada'); assert.strictEqual(doc.tese, 'tese', 'classificação preservada'); assert.strictEqual(doc.legenda, 'leg', 'a legenda volta na próxima coleta');
  // 31 dias depois o item sai sozinho
  r = await C.guardar([], { agora: AGORA + 31 * 86400000 });
  assert.strictEqual(r.removidos, 1); assert.strictEqual(await C.obter(id), null);
});

test('coleta completa: guarda, classifica, avisa no celular UMA vez por dia e registra o estado', async () => {
  novo();
  const g = graphFalsa({ hormozi: { seguidores: 5000000, posts: [post('h1'), post('h2', { curtidas: 9000 }), post('h3')] } });
  const avisos = []; const notificar = async (o) => { avisos.push(o); return { enviadas: 1 }; };
  const pedirJson = async ({ usuario }) => ({ dados: { itens: Array.from({ length: (usuario.match(/^\[\d+\] instagram/gm) || []).length }, (_, i) => ({ i, tema: 'oferta boa vende sozinha', mecanismo: 'numero', tese: 'Uma oferta forte importa mais que o anúncio bonito.', ponte_pedro: 'Quem vende no marketplace briga por preço porque a oferta é igual à do vizinho.' })) } });
  const deps = { graph: g.graph, igId: '17841', contas: contasTeste(['hormozi', 'recusada']), youtubeKey: '', fetcher: async () => ({ ok: false }), pedirJson, notificar };
  const r1 = await C.coletar({ deps, origem: 'cron', agora: AGORA });
  assert.strictEqual(r1.instagram.contas_lidas, 1); assert.strictEqual(r1.instagram.recusadas[0].handle, 'recusada');
  assert.strictEqual(r1.youtube.pulado, 'sem YOUTUBE_API_KEY');
  assert.strictEqual(r1.novos, 1, 'só o viral (VL 9) vira candidato'); assert.strictEqual(r1.classificados, 1); assert.strictEqual(r1.em_alta, 1);
  assert.strictEqual(avisos.length, 1); assert.deepStrictEqual({ corpo: avisos[0].corpo, url: avisos[0].url }, { corpo: 'Reciclagem: 1 tese em alta hoje', url: '/?tab=reciclagem' });
  const r2 = await C.coletar({ deps, origem: 'manual', agora: AGORA + 3600000 });
  assert.strictEqual(avisos.length, 1, 'segunda coleta no mesmo dia não avisa de novo'); assert.strictEqual(r2.atualizados, 1); assert.strictEqual(r2.chamadas_ia, 0, 'já classificado: não gasta IA');
  const est = await C.lerEstado(); assert.strictEqual(est.ultima_coleta.origem, 'manual'); assert.ok(est.lidas_em.hormozi);
  const lista = await C.listar({ dias: 7, min_vl: 3, agora: AGORA });
  assert.strictEqual(lista.total, 1); assert.strictEqual(lista.itens[0].tema, 'oferta boa vende sozinha'); assert.ok(typeof lista.itens[0].legenda === 'string', 'a API devolve a legenda original para o card');
  assert.strictEqual((await C.listar({ mecanismo: 'historia', agora: AGORA })).total, 0);
  assert.strictEqual((await C.listar({ idioma: 'en', agora: AGORA })).total, 1);
});

// ── Reciclagem ───────────────────────────────────────────────────────────────────
const ITEM = { id: 'rc_0123456789abcdef', rede: 'instagram', conta: { handle: 'codiesanchez', nome: 'Codie Sanchez', pais: 'US', idioma: 'en' }, permalink: 'https://www.instagram.com/p/XYZ/', publicado_em: h(100), tipo: 'reel', curtidas: 50000, comentarios: 1200, visualizacoes: 900000, seguidores: 3300000, er: 0.016, vl: 4.2, tema: 'negócio chato dá dinheiro', mecanismo: 'historia', tese: 'Negócios simples e pouco glamourosos sustentam quem os opera com disciplina.', ponte_pedro: 'A lavanderia de bairro paga Simples, aluguel e maquininha como qualquer MEI brasileiro.' };

test('reciclar como carrossel: chama criar com origem reciclagem, briefing com tese e ponte (nunca o texto original) e grava reciclado_de', async () => {
  novo(); const chamadas = [];
  const criar = async (args) => { chamadas.push(args); const c = M.novoConteudo({ titulo: args.titulo, origem: { tipo: 'texto' } }); c.top = { estado: 'em_andamento', etapa: 'ler', origem: args.origem }; await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, c, 0); return c; };
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, ITEM);
  const r = await R.reciclar(ITEM.id, { formato: 'carrossel', deps: { criar } });
  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(chamadas[0].origem, 'reciclagem'); assert.strictEqual(chamadas[0].formato, null);
  assert.ok(chamadas[0].texto.length >= 300, 'o pipeline exige 300 caracteres');
  assert.match(chamadas[0].texto, /TESE \(neutra/); assert.match(chamadas[0].texto, /SEM FATOS/); assert.match(chamadas[0].texto, /OPINIÃO/); assert.strictEqual(chamadas[0].modo, 'opiniao');
  assert.ok(!/codiesanchez|Codie/.test(chamadas[0].texto), 'o briefing não cita a conta de origem');
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, r.id)).doc;
  assert.strictEqual(doc.top.reciclado_de.permalink, ITEM.permalink); assert.strictEqual(doc.top.reciclado_de.vl, undefined); assert.strictEqual(doc.top.reciclado_de.metricas.vl, 4.2);
  assert.strictEqual(doc.top.reciclagem_formato, 'carrossel');
  const item = await C.obter(ITEM.id); assert.strictEqual(item.reciclado[0].conteudo_id, r.id);
  const e = await R.reciclar(ITEM.id, { formato: 'estatico', deps: { criar } });
  assert.strictEqual(chamadas[1].formato, 'estatico'); assert.strictEqual(e.formato, 'estatico');
  await assert.rejects(R.reciclar(ITEM.id, { formato: 'tiktok', deps: { criar } }), /Formato inválido/);
});

const RUIM = { titulo: 'Negócio chato', publico: 'dono de negócio pequeno', gancho: 'Dono de negócio pequeno, para o scroll.', corpo: 'Isso não é sorte. É método. Todo mundo quer o negócio bonito e quem paga a conta é o caixa.', fechamento: 'Manda pro seu sócio.' };
const BOM = { titulo: 'Negócio chato paga boleto', publico: 'dono de negócio pequeno', gancho: 'Se você tem um negócio pequeno, presta atenção nisso.', corpo: 'A lavanderia da esquina abre às sete e fecha às dez. Ninguém posta foto dela. Ninguém chama de startup. Só que a maquininha roda o dia inteiro e o dono paga o Simples sem atraso, paga o aluguel e ainda sobra para a família. Eu vejo gente desprezando esse tipo de negócio porque ele parece pequeno demais. Na minha leitura, é o contrário. O negócio simples sobrevive a crise, a juro alto e a governo que muda regra todo ano, porque a conta dele é curta e o cliente volta toda semana. Antes de sonhar com o aplicativo milionário, olha para o serviço que o seu bairro precisa todo dia e ninguém quer fazer direito.', fechamento: 'Manda esse vídeo para quem tem CNPJ e acha que precisa de ideia genial para ganhar dinheiro.' };

test('reel: roteiro com 2 ou mais vícios de texto de IA é reprovado e pedido de novo com o motivo', async () => {
  novo(); const chamadas = []; const respostas = [RUIM, BOM];
  const pedirJson = async ({ sistema, usuario }) => { chamadas.push({ sistema, usuario }); return { dados: respostas[Math.min(chamadas.length - 1, respostas.length - 1)] }; };
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, ITEM);
  const r = await R.reciclar(ITEM.id, { formato: 'reel', deps: { pedirJson, sortear: () => 0 } });
  assert.strictEqual(chamadas.length, 2, 'a primeira versão (reversão + "quem paga a conta") foi reprovada');
  assert.match(chamadas[1].sistema, /REESCREVA DO ZERO.*cara de IA/);
  assert.match(chamadas[0].sistema, /MENTE DO REDATOR DESTA VERSÃO: David Ogilvy/, 'mente sorteada entra no prompt');
  assert.match(chamadas[0].sistema, /ESCREVA COMO GENTE, NÃO COMO IA/); assert.match(chamadas[0].sistema, /NÃO deve citar, mencionar, imitar/);
  assert.ok(!/Legenda|instagram\.com/.test(chamadas[0].usuario), 'a IA recebe só tese, mecanismo, ponte e números');
  assert.match(r.roteiro, /^Se você tem um negócio pequeno/); assert.match(r.roteiro, /Manda esse vídeo/);
  assert.ok(r.duracao_estimada_s >= 45 && r.duracao_estimada_s <= 75, `duração estimada ${r.duracao_estimada_s}s`);
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, r.id)).doc;
  assert.strictEqual(doc.formato, 'reels'); assert.strictEqual(doc.origem.tipo, 'reciclagem'); assert.strictEqual(doc.video.estado, 'roteiro'); assert.strictEqual(doc.video.roteiro_texto, r.roteiro); assert.strictEqual(doc.video.tentativas, 2);
  assert.strictEqual(doc.reciclagem.reciclado_de.handle, 'codiesanchez');
});

test('reel: três versões ruins seguidas viram erro 422 (não sai roteiro com cara de IA)', async () => {
  novo(); let n = 0;
  await assert.rejects(R.roteiroReel(ITEM, { deps: { pedirJson: async () => { n++; return { dados: RUIM }; }, sortear: () => 0 } }), (e) => e.code === 'ROTEIRO_REPROVADO' && e.status === 422);
  assert.strictEqual(n, 3);
  const cita = R.problemasDoRoteiro({ ...BOM, corpo: `${BOM.corpo} Como diz a Codie Sanchez.` }, ITEM);
  assert.ok(cita.problemas.some((p) => /cita a conta/.test(p)));
});

test('item sem tese não recicla; contas: curadas + adicionadas − removidas, handle inválido ignorado', async () => {
  novo();
  await assert.rejects(R.reciclar({ id: 'rc_x', conta: {} }, { formato: 'reel', deps: { pedirJson: async () => ({ dados: BOM }) } }), /ainda não foi classificado/);
  const c = Contas.contas({ instagram: { adicionar: [{ handle: '@NovaConta', pais: 'br', idioma: 'pt' }, { handle: 'inválido!' }, { handle: 'hormozi' }], remover: ['garyvee'] }, youtube: { adicionar: [{ canal: '@canalnovo' }, { canal: 'lixo' }], remover: ['@garyvee'] } });
  assert.ok(c.instagram.some((x) => x.handle === 'novaconta' && x.adicionada && x.pais === 'BR'));
  assert.ok(!c.instagram.some((x) => x.handle === 'garyvee')); assert.ok(!c.instagram.some((x) => x.handle === 'inválido!'));
  assert.strictEqual(c.instagram.filter((x) => x.handle === 'hormozi').length, 1, 'não duplica');
  assert.strictEqual(c.instagram.length, Contas.INSTAGRAM.length, '74 − 1 removida + 1 nova');
  assert.ok(c.youtube.some((x) => x.canal === '@canalnovo')); assert.ok(!c.youtube.some((x) => x.canal === '@garyvee' || x.canal === 'lixo'));
  assert.strictEqual(Contas.INSTAGRAM.length, 74); assert.strictEqual(Contas.YOUTUBE.length, 20);
  await Contas.salvarConfig({ instagram: { remover: ['hormozi'] } });
  assert.ok(!(await Contas.carregar()).instagram.some((x) => x.handle === 'hormozi'));
});

// ── Rota ─────────────────────────────────────────────────────────────────────────
test('rota: lista ordenada por VL, tendências, contas e reciclar reel pela API', async () => {
  novo(); process.env.TESTE_RECICLAGEM = '1'; delete process.env.VERCEL;
  global.__RECICLAGEM_DEPS__ = { pedirJson: async () => ({ dados: BOM }), sortear: () => 0 };
  const a = arm.armazem();
  // A rota filtra pelo relógio de verdade: os posts do teste são sempre de 2 dias atrás (data fixa vencia o filtro de 7 dias).
  const recente = new Date(Date.now() - 48 * 3600000).toISOString();
  await a.radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, publicado_em: recente });
  await a.radar.salvar(ACCOUNT.ig_id, C.TIPO, 'rc_fedcba9876543210', { ...ITEM, publicado_em: recente, id: 'rc_fedcba9876543210', permalink: 'https://www.instagram.com/p/OUTRO/', vl: 7.5, mecanismo: 'polemica', conta: { ...ITEM.conta, idioma: 'pt' }, legenda: 'texto de terceiro' });
  await a.radar.salvar(ACCOUNT.ig_id, C.TIPO_ESTADO, 'estado', { tendencias: { em: h(1), itens: [{ titulo: 'lavanderia', trafego: '20.000+', noticias: [], link: null }] } });
  const app = express(); app.use(express.json()); app.use('/api/reciclagem', require('../../routes/reciclagem'));
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api/reciclagem`;
  try {
    let r = await (await fetch(`${base}?dias=7&min_vl=3`)).json();
    assert.strictEqual(r.total, 2); assert.strictEqual(r.itens[0].vl, 7.5); assert.strictEqual(r.itens[0].legenda, 'texto de terceiro'); assert.ok(r.estado.mecanismos.historia);
    r = await (await fetch(`${base}?mecanismo=polemica&idioma=pt`)).json(); assert.strictEqual(r.total, 1);
    r = await (await fetch(`${base}/tendencias`)).json(); assert.strictEqual(r.tendencias[0].titulo, 'lavanderia'); assert.ok(r.tendencias[0].itens.includes(ITEM.id), 'tendência cruzada com o item pela ponte ("lavanderia de bairro")');
    r = await (await fetch(`${base}/contas`)).json(); assert.strictEqual(r.instagram.length, 74);
    const put = await fetch(`${base}/contas`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instagram: { remover: ['garyvee'] } }) });
    assert.strictEqual(put.status, 200); assert.strictEqual((await put.json()).instagram.length, 73);
    const rec = await fetch(`${base}/${ITEM.id}/reciclar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formato: 'reel' }) });
    assert.strictEqual(rec.status, 201); const j = await rec.json(); assert.ok(j.id && /Se você tem um negócio pequeno/.test(j.roteiro)); assert.strictEqual(j.rotulo, 'reel');
    assert.strictEqual((await fetch(`${base}/${ITEM.id}/reciclar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formato: 'x' }) })).status, 400);
    assert.strictEqual((await fetch(`${base}/rc_0000000000000000`)).status, 404);
    assert.strictEqual((await fetch(`${base}/nao-e-id`)).status, 400);
  } finally { srv.close(); delete global.__RECICLAGEM_DEPS__; delete process.env.TESTE_RECICLAGEM; }
});

test('índice de viralidade: feed de cauda longa usa o p75 como base (sem 50× para todo post bom)', () => {
  const agora = Date.parse('2026-11-08T12:00:00Z');
  const h = (n) => new Date(agora - n * 3600000).toISOString();
  // 20 posts: 15 fracos (200 curtidas) e 5 fortes (de 4 mil a 20 mil), 1 milhão de seguidores
  const posts = [...Array.from({ length: 15 }, (_, i) => ({ permalink: `f${i}`, publicado_em: h(100 + i), curtidas: 200, comentarios: 5, visualizacoes: null })),
    ...[4000, 6000, 9000, 14000, 20000].map((c, i) => ({ permalink: `v${i}`, publicado_em: h(200 + i), curtidas: c, comentarios: 50, visualizacoes: null }))];
  const r = C.pontuar(posts, 1000000, { agora });
  const melhor = r.find((p) => p.permalink === 'v4'); const fraco = r.find((p) => p.permalink === 'f0');
  assert.ok(melhor.vl > 3 && melhor.vl < 50, `melhor com ${melhor.vl}`);
  assert.ok(fraco.vl < 1.5, `fraco com ${fraco.vl}`);
});

test('reciclar na mesma estrutura: o briefing leva o nº de slides e o mecanismo, sem texto do original', async () => {
  novo(); const chamadas = [];
  const criar = async (args) => { chamadas.push(args); const c = M.novoConteudo({ titulo: args.titulo, origem: { tipo: 'texto' } }); c.top = { estado: 'em_andamento', etapa: 'ler', origem: args.origem }; await arm.armazem().conteudos.salvar(ACCOUNT.ig_id, c.id, c, 0); return c; };
  await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, ITEM.id, { ...ITEM, n_slides: 10, mecanismo: 'lista_erros' });
  await R.reciclar(ITEM.id, { formato: 'carrossel', mesmaEstrutura: true, deps: { criar } });
  assert.match(chamadas[0].texto, /MESMA ESTRUTURA DO POST ORIGINAL/); assert.match(chamadas[0].texto, /10 slides/); assert.match(chamadas[0].texto, /8 telas de conteúdo/);
  await R.reciclar(ITEM.id, { formato: 'carrossel', deps: { criar } });
  assert.doesNotMatch(chamadas[1].texto, /MESMA ESTRUTURA/, 'sem o botão, nada muda');
  assert.ok(chamadas[0].texto.length >= 300);
});

test('lista "pendentes": reciclado e descartado saem; descartado não volta numa coleta nova; leitura leve lê 1 conta sem IA', async () => {
  const arm = require('../armazem'); arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const C = require('./coletar'); const { ACCOUNT } = require('../account');
  const agora = Date.now(); const pub = new Date(agora - 4 * 86400000).toISOString();
  const base = (id, extra = {}) => ({ id, rede: 'instagram', tipo: 'carrossel', permalink: `https://www.instagram.com/p/${id}/`, publicado_em: pub, coletado_em: pub, vl: 5, conta: { handle: 'x' }, reciclado: [], ...extra });
  for (const d of [base('rc_aa'), base('rc_bb', { reciclado: [{ formato: 'clone' }] }), base('rc_cc')]) await arm.armazem().radar.salvar(ACCOUNT.ig_id, C.TIPO, d.id, d);
  await C.descartar('rc_cc');
  assert.deepStrictEqual((await C.listar({ dias: 30, pendentes: true })).itens.map((i) => i.id), ['rc_aa']);
  assert.strictEqual((await C.listar({ dias: 30 })).total, 3, 'sem o filtro, tudo continua guardado');
  let chamadas = 0;
  const graph = async () => { chamadas++; return { business_discovery: { followers_count: 1000, media: { data: [] } } }; };
  const r = await C.coletarAlgumas({ deps: { graph, igId: '1', contas: { instagram: [{ handle: 'a' }, { handle: 'b' }] } }, n: 1 });
  assert.strictEqual(chamadas, 1); assert.deepStrictEqual(r.contas, ['a']);
  const r2 = await C.coletarAlgumas({ deps: { graph, igId: '1', contas: { instagram: [{ handle: 'a' }, { handle: 'b' }] } }, n: 1 });
  assert.deepStrictEqual(r2.contas, ['b'], 'rodízio: a próxima é a lida há mais tempo');
});

test('leitura leve: freia pela cota da Meta, lê hashtag a cada 4 rodadas e bloqueia 1 dia se a Meta negar a hashtag', async () => {
  const arm = require('../armazem'); arm._definir(Object.assign(arm.memoria(), { duravel: true }));
  const C = require('./coletar');
  const contas = { instagram: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((handle) => ({ handle })) };
  const agora = Date.now(); const ts = new Date(agora - 3600000).toISOString();
  const graph = async (m, caminho) => {
    if (caminho === 'ig_hashtag_search') return { data: [{ id: 'h1' }] };
    if (caminho === 'h1/top_media') return { data: [{ permalink: 'https://www.instagram.com/p/T1/', timestamp: ts, media_type: 'CAROUSEL_ALBUM', like_count: 9000, comments_count: 10, children: { data: [{ media_type: 'IMAGE', media_url: 'https://x/1.jpg' }] } }, { permalink: 'https://www.instagram.com/p/T2/', timestamp: ts, media_type: 'IMAGE', media_url: 'https://x/2.jpg', like_count: 1000, comments_count: 1 }] };
    return { business_discovery: { followers_count: 1000, media: { data: [] } } };
  };
  let uso = { pct: 10 };
  const r1 = await C.coletarAlgumas({ deps: { graph, igId: '1', contas, uso: () => uso }, agora });
  assert.strictEqual(r1.contas.length, 2); assert.strictEqual(r1.proximas, 3, 'com folga, lê mais na próxima');
  uso = { pct: 70 };
  const r2 = await C.coletarAlgumas({ deps: { graph, igId: '1', contas, uso: () => uso }, agora: agora + 31000 });
  assert.strictEqual(r2.contas.length, 3); assert.strictEqual(r2.proximas, 1, 'cota alta: 1 conta por rodada');
  uso = { pct: 20 };
  await C.coletarAlgumas({ deps: { graph, igId: '1', contas, uso: () => uso }, agora: agora + 62000 });
  const r4 = await C.coletarAlgumas({ deps: { graph, igId: '1', contas, uso: () => uso }, agora: agora + 93000 });
  assert.ok(r4.hashtag, 'quarta rodada lê uma hashtag'); assert.strictEqual(r4.novos, 2);
  const lista = await C.listar({ dias: 30, soImagens: true });
  assert.ok(lista.itens.some((i) => i.conta.handle.startsWith('#')));
  uso = { pct: 90, regain_min: 15 };
  const r5 = await C.coletarAlgumas({ deps: { graph, igId: '1', contas, uso: () => uso }, agora: agora + 124000 });
  assert.ok(r5.pausa_ate, 'acima de 85%: pausa');
  const r6 = await C.coletarAlgumas({ deps: { graph, igId: '1', contas, uso: () => uso }, agora: agora + 155000 });
  assert.strictEqual(r6.lidas, 0); assert.ok(r6.pausado_ate);
});
