// Camada estratégica do Estúdio: Growth Dashboard, Diagnóstico, DNA Editorial, Audiência, Comunidade, Estratégia criativa,
// Growth Lab, Distribuição, Funil e Prioridade da fila. Ver docs/AUDITORIA_ESTUDIO.md.
// Só duas rotas falam com a Meta: a leitura de comentários (com a permissão instagram_manage_comments) e o envio de UMA resposta
// aprovada, com confirmação explícita. Nada é publicado aqui.
const express = require('express');
const C = require('../lib/crescimento');
const Dna = require('../lib/dnaEditorial');
const Placar = require('../lib/placar');
const Com = require('../lib/comunidade');
const Aud = require('../lib/audiencia');
const Cri = require('../lib/criativo');
const Lab = require('../lib/growthLab');
const Funil = require('../lib/funil');
const Dist = require('../lib/distribuicao');
const Pri = require('../lib/prioridade');
const meta = require('../lib/meta');
const { armazem } = require('../lib/armazem');
const { ACCOUNT } = require('../lib/account');
const { limita } = require('../lib/access');

const router = express.Router();
const erroJson = (res, e) => res.status(e.status || (e.meta ? 502 : 500)).json({ error: e.status || e.meta ? (e.meta?.amigavel || e.message) : 'Não consegui agora. Tente de novo em instantes.', code: e.code || 'CRESCIMENTO' });
const rota = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { if (!e.status) console.error('[crescimento]', req.path, e.message); erroJson(res, e); } };
const DIAS = [7, 30, 90];
const conta = () => ACCOUNT.ig_id;

async function dados() {
  const a = armazem(); const cfg = a?.duravel ? await a.config.obter(conta()) : {};
  const snap = cfg.meu_instagram || null; const arquivo = await Placar.lerArquivo(a);
  const leads = a?.duravel ? await Funil.listar().catch(() => []) : null;
  return { a, snap, posts: C.juntarPosts(snap?.posts, arquivo), dms: Array.isArray(cfg.dms_por_palavra) ? cfg.dms_por_palavra : [], guardado: !!a?.duravel, arquivo: arquivo.length, leads };
}

// ── Painel e diagnóstico ──
router.get('/painel', rota(async (req, res) => {
  const d = await dados(); const q = req.query;
  const opc = {}; const de = Date.parse(q.de); const ate = Date.parse(q.ate);
  if (Number.isFinite(de) && Number.isFinite(ate) && ate > de && ate - de <= 366 * 86400000) { opc.de = de; opc.ate = ate + 86400000 - 1; } else opc.dias = DIAS.includes(Number(q.dias)) ? Number(q.dias) : 30;
  res.json({ ...C.painel({ posts: d.posts, serie: d.snap?.serie_conta || null, seguidores: d.snap?.conta?.seguidores ?? null, dms: d.dms, gerado_em: d.snap?.gerado_em || null, leads: d.leads, ...opc }),
    frequencia: Pri.frequencia(d.posts), origem: { snapshot_em: d.snap?.gerado_em || null, posts_no_arquivo: d.arquivo, banco: d.guardado }, vazio: !d.snap && !d.arquivo,
    posts_recentes: d.posts.slice(0, 30).map((p) => ({ id: p.id, tipo: p.tipo, legenda: p.legenda, publicado_em: p.publicado_em, permalink: p.permalink || null, maduro: !!p.maduro })) });
}));
router.get('/diagnostico', rota(async (req, res) => {
  const d = await dados(); const dna = await Dna.ler();
  res.json({ ...C.diagnostico({ posts: d.posts, transicao: dna.transicao, pilares: dna.pilares }), origem: { snapshot_em: d.snap?.gerado_em || null, posts_no_arquivo: d.arquivo, posts_considerados: d.posts.length }, vazio: !d.posts.length });
}));

// ── DNA Editorial ──
router.get('/dna', rota(async (req, res) => res.json({ ...(await Dna.ler()), tipos_banco: Dna.TIPOS_BANCO })));
router.put('/dna', limita({ max: 20, janelaMs: 60000, nome: 'dna-salvar' }), rota(async (req, res) => res.json(await Dna.salvar(req.body || {}))));
router.post('/dna/banco', limita({ max: 20, janelaMs: 60000, nome: 'dna-banco' }), rota(async (req, res) => res.status(201).json(await Dna.adicionarAoBanco(req.body || {}))));
router.delete('/dna/banco/:id', limita({ max: 20, janelaMs: 60000, nome: 'dna-banco-del' }), rota(async (req, res) => res.json(await Dna.apagarDoBanco(String(req.params.id)))));

// ── Séries: histórico e desempenho pelos conteúdos marcados com a série ──
router.get('/series', rota(async (req, res) => {
  const d = await dados(); const dna = await Dna.ler();
  const pubs = await require('../lib/publicador').listarPublicacoes().catch(() => []);
  const porConteudo = new Map(pubs.filter((p) => p.ig_media_id).map((p) => [p.content_id, String(p.ig_media_id)]));
  const conteudos = d.guardado ? await d.a.conteudos.listar(conta()) : [];
  const marcados = [];
  for (const x of conteudos.slice(0, 400)) { try { const doc = (await d.a.conteudos.obter(conta(), x.id))?.doc; if (doc?.serie) marcados.push({ id: doc.id, titulo: doc.titulo, serie: doc.serie, status: doc.status, media: porConteudo.get(doc.id) || null }); } catch { /* ignora */ } }
  const postPorId = new Map(d.posts.map((p) => [String(p.id), p]));
  res.json({ series: dna.series.map((s) => { const cs = marcados.filter((m) => m.serie === s.id); const ps = cs.map((m) => postPorId.get(m.media)).filter(Boolean); return { ...s, episodios: cs, desempenho: C.resumoGrupo(ps.filter((p) => p.maduro)) }; }), geral: C.resumoGrupo(d.posts.filter((p) => p.maduro && p.alcance)) });
}));
router.put('/conteudo/:id', limita({ max: 30, janelaMs: 60000, nome: 'cr-conteudo' }), rota(async (req, res) => {
  const a = armazem(); if (!a?.duravel) return res.status(503).json({ error: 'Precisa do banco de dados no servidor.' });
  const reg = await a.conteudos.obter(conta(), String(req.params.id)); if (!reg) return res.status(404).json({ error: 'Conteúdo não encontrado.' });
  const { objetivo, serie } = req.body || {}; const dna = await Dna.ler(); const doc = { ...reg.doc };
  if (objetivo !== undefined) { if (objetivo !== null && !Funil.OBJETIVOS[objetivo]) return res.status(400).json({ error: 'Objetivo inválido.' }); doc.objetivo = objetivo; }
  if (serie !== undefined) { if (serie !== null && !dna.series.some((s) => s.id === serie)) return res.status(400).json({ error: 'Série desconhecida.' }); doc.serie = serie; }
  await a.conteudos.salvar(conta(), doc.id, doc, reg.rev);
  res.json({ id: doc.id, objetivo: doc.objetivo || null, serie: doc.serie || null });
}));

// ── Comunidade ──
router.get('/comunidade', rota(async (req, res) => {
  const lista = await Com.listar({ classe: req.query.classe || null, estado: req.query.estado || null });
  res.json({ comentarios: lista.slice(0, 150), resumo: Com.resumo(lista), classes: Com.CLASSES, ler_em: await (async () => { const a = armazem(); try { return a?.duravel ? (await a.config.obter(conta())).comunidade_lida_em || null : null; } catch { return null; } })() });
}));
router.post('/comunidade/ler', limita({ max: 3, janelaMs: 60000, nome: 'cr-com-ler' }), rota(async (req, res) => {
  const falta = meta.faltando(); if (falta.length) return res.status(409).json({ error: `A conexão com o Instagram não está configurada (falta ${falta.join(', ')}).`, code: 'META_NAO_CONFIGURADA' });
  const d = await dados();
  const r = await Com.coletar({ grafo: meta.graph, igId: meta.config().igId, posts: d.posts });
  if (d.guardado) await d.a.config.salvar(conta(), { comunidade_lida_em: new Date().toISOString() });
  res.json({ ...r, aviso: r.permissao === false ? 'A Meta recusou a leitura de comentários: o token precisa da permissão instagram_manage_comments (docs/META_SETUP.md).' : null });
}));
router.post('/comunidade/:id/sugerir', limita({ max: 10, janelaMs: 60000, nome: 'cr-com-sug' }), rota(async (req, res) => res.json(await Com.sugerirResposta(String(req.params.id)))));
router.post('/comunidade/:id/acao', limita({ max: 30, janelaMs: 60000, nome: 'cr-com-acao' }), rota(async (req, res) => res.json(await Com.acao(String(req.params.id), req.body || {}))));
router.post('/comunidade/:id/enviar', limita({ max: 10, janelaMs: 60000, nome: 'cr-com-env' }), rota(async (req, res) => res.json(await Com.enviarResposta(String(req.params.id), { confirmar: req.body?.confirmar === true, grafo: meta.graph }))));
router.get('/pautas', rota(async (req, res) => res.json({ pautas: await Com.listarPautas() })));

// ── Audiência (comentários guardados + posts reais + demografia da Meta, quando a conta permite) ──
router.get('/audiencia', rota(async (req, res) => {
  const d = await dados(); const dna = await Dna.ler();
  const cfg = d.guardado ? await d.a.config.obter(conta()) : {};
  res.json({ ...Aud.analisar({ comentarios: await Com.listar({ limite: 2000 }), posts: d.posts, dna }), demografia: cfg.audiencia_demografia || null });
}));
router.post('/audiencia/demografia', limita({ max: 2, janelaMs: 60000, nome: 'cr-demo' }), rota(async (req, res) => {
  const falta = meta.faltando(); if (falta.length) return res.status(409).json({ error: `A conexão com o Instagram não está configurada (falta ${falta.join(', ')}).` });
  const out = { lido_em: new Date().toISOString(), cortes: {}, erros: [] };
  for (const b of ['age', 'gender', 'city']) {
    try {
      const r = await meta.graph('GET', `${meta.config().igId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: b });
      const res0 = r?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      out.cortes[b] = res0.map((x) => ({ valor: (x.dimension_values || []).join(' '), n: x.value })).sort((x, y) => y.n - x.n).slice(0, 10);
    } catch (e) { out.erros.push(`${b}: ${(e.meta?.amigavel || e.message || '').slice(0, 140)}`); }
  }
  const a = armazem(); if (a?.duravel) await a.config.salvar(conta(), { audiencia_demografia: out });
  res.json(out);
}));

// ── Estratégia criativa ──
router.get('/criativo', rota(async (req, res) => res.json({ estrategias: (await Cri.listar()).slice(0, 30), angulos: Cri.ANGULOS, formatos: Cri.FORMATOS, pesos: Cri.PESOS })));
router.post('/criativo', limita({ max: 6, janelaMs: 60000, nome: 'cr-criativo' }), rota(async (req, res) => res.status(201).json(await Cri.gerar({ pauta: req.body?.pauta, origem: req.body?.origem || null }))));
router.post('/criativo/:id/acao', limita({ max: 12, janelaMs: 60000, nome: 'cr-cri-acao' }), rota(async (req, res) => {
  const b = req.body || {};
  const r = await Cri.acao(String(req.params.id), { acao: b.acao, opcao: b.opcao, edicao: b.edicao || {}, combinar: b.combinar || [], serie: b.serie || null });
  // Carrossel ou post único aprovado: o carrossel sai pelo pipeline do Criar (aparece em Aprovar). Falhou? A pauta continua guardada.
  if (b.acao === 'aprovar' && r.escolha && r.escolha.formato !== 'reel') {
    try {
      const T = require('../lib/top/pipeline'); const fmt = r.escolha.formato === 'post_unico' ? 'estatico' : 'tweet';
      const c = await T.criar({ texto: `${r.pauta}\n\nÂNGULO APROVADO: ${r.escolha.titulo}. ${r.escolha.ideia}${r.escolha.opiniao ? `\nOPINIÃO DO PEDRO: ${r.escolha.opiniao}` : ''}`, titulo: r.escolha.titulo, origem: 'estrategia_criativa', formato: fmt, modo: r.escolha.opiniao ? 'opiniao' : undefined });
      c.objetivo = r.escolha.objetivo; if (r.escolha.serie) c.serie = r.escolha.serie;
      const a = armazem(); const reg = await a.conteudos.obter(conta(), c.id); await a.conteudos.salvar(conta(), c.id, c, reg?.rev || 0);
      return res.json({ ...r, conteudo_id: c.id });
    } catch (e) { return res.json({ ...r, aviso: `A pauta foi guardada, mas o carrossel não foi criado agora: ${String(e.message).slice(0, 140)}` }); }
  }
  res.json(r);
}));

// ── Growth Lab ──
router.get('/lab', rota(async (req, res) => {
  const d = await dados(); const exps = await Lab.listar();
  res.json({ experimentos: exps.map((e) => ({ ...e, resultado: Lab.avaliar(e, d.posts) })), variaveis: Lab.VARIAVEIS, indicadores: Lab.INDICADORES, status: Lab.STATUS,
    posts: d.posts.slice(0, 60).map((p) => ({ id: p.id, tipo: p.tipo, legenda: p.legenda, publicado_em: p.publicado_em, maduro: !!p.maduro })) });
}));
router.post('/lab', limita({ max: 20, janelaMs: 60000, nome: 'cr-lab' }), rota(async (req, res) => res.status(201).json(await Lab.criar(req.body || {}))));
router.put('/lab/:id', limita({ max: 30, janelaMs: 60000, nome: 'cr-lab-ed' }), rota(async (req, res) => res.json(await Lab.editar(String(req.params.id), req.body || {}))));
router.post('/lab/:id/decisao', limita({ max: 20, janelaMs: 60000, nome: 'cr-lab-dec' }), rota(async (req, res) => res.json(await Lab.registrarDecisao(String(req.params.id), req.body?.texto))));
router.delete('/lab/:id', limita({ max: 10, janelaMs: 60000, nome: 'cr-lab-del' }), rota(async (req, res) => res.json(await Lab.apagar(String(req.params.id)))));

// ── Funil ──
router.get('/funil', rota(async (req, res) => {
  const leads = await Funil.listar(); const dias = DIAS.includes(Number(req.query.dias)) ? Number(req.query.dias) : 90;
  const a = armazem(); const objetivos = [];
  if (a?.duravel) for (const x of (await a.conteudos.listar(conta())).sort((p, q) => String(q.atualizado_em || '').localeCompare(String(p.atualizado_em || ''))).slice(0, 40)) { try { const doc = (await a.conteudos.obter(conta(), x.id))?.doc; if (doc?.objetivo) objetivos.push(doc.objetivo); } catch { /* ignora */ } }
  res.json({ leads: leads.slice(0, 200), resumo: Funil.resumo(leads, { de: Date.now() - dias * 86400000 }), sequencia: Funil.sequencia(objetivos), estagios: Funil.ROTULO_ESTAGIO, origens: Funil.ORIGENS, objetivos: Funil.OBJETIVOS, dias });
}));
router.post('/funil', limita({ max: 30, janelaMs: 60000, nome: 'cr-funil' }), rota(async (req, res) => res.status(201).json(await Funil.criar(req.body || {}))));
router.post('/funil/:id/estagio', limita({ max: 30, janelaMs: 60000, nome: 'cr-funil-mv' }), rota(async (req, res) => res.json(await Funil.mover(String(req.params.id), req.body?.estagio))));
router.delete('/funil/:id', limita({ max: 10, janelaMs: 60000, nome: 'cr-funil-del' }), rota(async (req, res) => res.json(await Funil.apagar(String(req.params.id)))));

// ── Distribuição de um post publicado ──
router.get('/distribuicao/:postId', rota(async (req, res) => {
  const d = await dados(); const post = d.posts.find((p) => String(p.id) === String(req.params.postId));
  if (!post) return res.status(404).json({ error: 'Post não encontrado entre os lidos. Atualize os números em Resultados.' });
  const series = d.guardado ? (await d.a.radar.listar(conta(), Placar.TIPO_SERIE, { limite: 300 }).catch(() => [])).map((r) => r.doc) : [];
  res.json(Dist.plano({ post, series, comentarios: await Com.listar({ limite: 2000 }), seguidores: d.snap?.conta?.seguidores ?? null }));
}));

// ── Prioridade da fila de aprovação ──
router.get('/prioridades', rota(async (req, res) => {
  const d = await dados(); const dna = await Dna.ler();
  const pain = C.painel({ posts: d.posts, dias: 90 }); const ach = C.achados(d.posts.filter((p) => p.maduro && p.alcance)).achados;
  const aud = Aud.analisar({ comentarios: await Com.listar({ limite: 2000 }), posts: d.posts, dna });
  const pend = []; const objetivosRecentes = [];
  if (d.guardado) {
    for (const x of (await d.a.conteudos.listar(conta())).slice(0, 300)) {
      if (!['rascunho', 'em_revisao'].includes(x.resumo?.status) && !String(x.id).startsWith('vd_')) continue;
      try { const doc = (await d.a.conteudos.obter(conta(), x.id))?.doc; if (!doc || doc.status === 'arquivado') continue; if (doc.objetivo) objetivosRecentes.push(doc.objetivo); if (String(doc.id).startsWith('vd_') && doc.video?.estado !== 'roteiro') continue; pend.push({ id: doc.id, titulo: doc.titulo, origem: doc.top?.origem || doc.origem?.tipo || doc.reciclagem?.origem || null, serie: doc.serie || null, objetivo: doc.objetivo || null, formato: doc.video ? 'reel' : doc.top?.formato || doc.formato || null }); } catch { /* ignora */ }
    }
  }
  res.json({ fila: Pri.ordenar(pend, { achados: ach, sugestoes: aud.sugestoes, pilares: dna.pilares, objetivosRecentes }).slice(0, 40), pesos: Pri.PESOS, frequencia: Pri.frequencia(d.posts), dados_suficientes: pain.decisao.dados_suficientes });
}));

// ── Raio-X do perfil (só leitura, resposta SEMPRE cifrada com a chave pública de quem pediu; ver backend/lib/raioX.js) ──
// Quem chama: o workflow raio-x.yml (token OIDC do runner). O repositório é público, então nada sai em texto aberto.
router.get('/raio-x', limita({ max: 40, janelaMs: 60000, nome: 'cr-raiox' }), rota(async (req, res) => {
  const RX = require('../lib/raioX');
  const chave = String(req.query.chave || ''); if (chave.length < 300) return res.status(400).json({ error: 'Informe a chave pública (SPKI DER em base64) para cifrar a resposta.' });
  const falta = meta.faltando(); if (falta.length) return res.status(409).json({ error: `A conexão com o Instagram não está configurada (falta ${falta.join(', ')}).` });
  const parte = String(req.query.parte || 'posts');
  if (parte === 'conta') return res.json({ parte, cifrado: RX.cifrar({ ...(await RX.conta()), uso_meta: meta.uso() }, chave) });
  const after = /^[\w=-]{1,400}$/.test(String(req.query.after || '')) ? String(req.query.after) : null;
  const r = await RX.posts({ after });
  res.json({ parte: 'posts', n: r.posts.length, proximo: r.proximo, fim: r.fim, limite_atingido: r.limite_atingido, cifrado: RX.cifrar({ posts: r.posts, uso_meta: meta.uso() }, chave) });
}));

// ── Provas do dia: ideias de vídeo com a prova de demanda (backend/lib/provas.js) ──
async function provasDoDia() {
  const Provas = require('../lib/provas'); const a = armazem();
  const analise = await Provas.analiseGuardada().catch(() => null);
  let virais = []; try { const r = await require('../lib/reciclagem/coletar').listar({ dias: 7, limite: 80 }); virais = Array.isArray(r) ? r : (r?.itens || []); } catch { /* radar fora do ar */ }
  const comentarios = await Com.listar({ limite: 2000 }).catch(() => []);
  const perguntas = Aud.agruparPerguntas(comentarios.filter((c) => ['pergunta', 'duvida'].includes(c.classe)));
  const aprovadas = await Com.listarPautas().catch(() => []);
  const cfg = a?.duravel ? await a.config.obter(conta()) : {};
  const usadas = new Set([...((cfg.piloto_estado?.roteiros?.usadas || []).map((u) => u.chave)), ...aprovadas.map((p) => p.origem?.chave).filter(Boolean)]);
  const piloto = await require('../lib/top/piloto').config().catch(() => ({}));
  return { Provas, analise, ideias: Provas.montar({ analise, virais, perguntas, aprovadas, usadas }), piloto };
}
router.get('/provas', rota(async (req, res) => {
  const { Provas, analise, ideias, piloto } = await provasDoDia();
  res.json({ ideias: ideias.map(({ pauta, tese, ...x }) => x), fontes: Provas.FONTES, tem_raio_x: !!analise, raio_x_em: analise?.gerado_em || null,
    plano: Provas.planoRecomendado(analise, piloto.mix || {}), piloto: { mix: piloto.mix || {}, roteiros_dia: piloto.roteiros_dia ?? null, meta_dia: piloto.meta_dia ?? null } });
}));
router.post('/provas/escolher', limita({ max: 12, janelaMs: 60000, nome: 'cr-provas' }), rota(async (req, res) => {
  const { ideias } = await provasDoDia(); const x = ideias.find((i) => i.chave === String(req.body?.chave || ''));
  if (!x) return res.status(404).json({ error: 'Esta ideia não está mais na lista (já virou roteiro ou saiu do radar).' });
  if (x.ja_na_fila) return res.json({ ok: true, ja_na_fila: true });
  const p = await Com.criarPauta({ texto: x.pauta, tema: null, origem: { tipo: 'prova', fonte: x.fonte, evidencia: x.evidencia, forca: x.forca, chave: x.chave, formato: 'reel' }, ideia: x.titulo });
  res.status(201).json({ ok: true, pauta_id: p.id });
}));
// Aplicar o plano de volume recomendado: só com o toque do Pedro (muda o mix do piloto e os roteiros por dia).
router.post('/provas/plano', limita({ max: 4, janelaMs: 60000, nome: 'cr-plano' }), rota(async (req, res) => {
  if (req.body?.confirmar !== true) return res.status(400).json({ error: 'Confirme para aplicar o plano.' });
  const { Provas, analise, piloto } = await provasDoDia(); const plano = Provas.planoRecomendado(analise, piloto.mix || {});
  const P = require('../lib/top/piloto'); await P.salvarConfig({ mix: plano.mix, roteiros_dia: plano.roteiros_dia });
  const novo = await P.config(); res.json({ ok: true, aplicado: plano, piloto: { mix: novo.mix, roteiros_dia: novo.roteiros_dia, meta_dia: novo.meta_dia } });
}));
// Pausar UMA linha do piloto (botão do Raio-X em cada linha que rende abaixo do perfil).
router.post('/provas/pausar-linha', limita({ max: 8, janelaMs: 60000, nome: 'cr-pausar' }), rota(async (req, res) => {
  const k = String(req.body?.mix || ''); if (!['frase', 'noticia', 'marca', 'revelacao'].includes(k)) return res.status(400).json({ error: 'Linha desconhecida.' });
  const P = require('../lib/top/piloto'); const cfg = await P.config(); const mix = { frase: 0, noticia: 0, marca: 0, revelacao: 0, ...(cfg.mix || {}), [k]: 0 };
  if (!Object.values(mix).some((v) => v > 0)) return res.status(409).json({ error: 'Esta é a última linha ligada no piloto. Para parar tudo, desligue o piloto em Ajustes.' });
  await P.salvarConfig({ mix }); const novo = await P.config(); res.json({ ok: true, piloto: { mix: novo.mix, meta_dia: novo.meta_dia } });
}));

// Raio-X DENTRO do app (sessão do dono): lê todos os posts da Meta, guarda a leitura e devolve o diagnóstico por regras
// (backend/lib/raioXAnalise.js) mais o texto para copiar. Sem ?forcar=1 devolve a última leitura guardada.
const RX_TIPO = 'raio_x';
function montarRaioX(doc) {
  const RA = require('../lib/raioXAnalise');
  const analise = RA.analisar({ posts: doc.posts || [], conta: doc.conta || null, agora: Date.parse(doc.gerado_em) });
  return { gerado_em: doc.gerado_em, parcial: doc.parcial || null, analise, texto: RA.texto(analise, doc.posts || []), texto_resumo: RA.texto(analise, doc.posts || [], { completo: false }) };
}
router.get('/raio-x/relatorio', rota(async (req, res) => {
  const a = armazem(); const g = a?.duravel ? (await a.radar.obter(conta(), RX_TIPO, 'ultimo'))?.doc : null;
  res.json(g ? montarRaioX(g) : { vazio: true });
}));
// Leitura em passos curtos (o celular derruba pedido que demora mais de 1 minuto): cada chamada lê UMA página de 50 posts;
// quando os posts acabam, a chamada seguinte lê a conta e fecha o relatório. O app chama em sequência e mostra o andamento.
const RX_PAGINAS_MAX = 12;
router.post('/raio-x/ler', limita({ max: 40, janelaMs: 60000, nome: 'cr-raiox-ler' }), rota(async (req, res) => {
  const a = armazem(); if (!a?.duravel) return res.status(503).json({ error: 'O Raio-X precisa do banco de dados no servidor.' });
  const falta = meta.faltando(); if (falta.length) return res.status(409).json({ error: `A conexão com o Instagram não está configurada (falta ${falta.join(', ')}).` });
  const RX = require('../lib/raioX');
  let st = req.body?.reiniciar === true ? null : (await a.radar.obter(conta(), RX_TIPO, 'leitura'))?.doc;
  if (!st || Date.now() - Date.parse(st.iniciado_em) > 3600000) st = { id: 'leitura', iniciado_em: new Date().toISOString(), posts: [], after: null, paginas: 0, etapa: 'posts', parcial: null };
  if (st.etapa === 'posts') {
    const r = await RX.posts({ after: st.after });
    st.posts.push(...r.posts.map(({ capa, ...x }) => ({ ...x, legenda: String(x.legenda || '').slice(0, 320) }))); st.paginas += 1;
    if (r.limite_atingido) st.parcial = 'A Meta limitou as chamadas no meio da leitura: parte dos posts veio sem métrica. Leia de novo em 1 hora.';
    if (r.fim || r.limite_atingido || st.paginas >= RX_PAGINAS_MAX) st.etapa = 'conta'; else st.after = r.proximo;
    await a.radar.salvar(conta(), RX_TIPO, 'leitura', st);
    return res.json({ continua: true, etapa: st.etapa, lidos: st.posts.length });
  }
  let dadosConta = null; try { dadosConta = await RX.conta(); } catch (e) { dadosConta = { erros: [String(e.message).slice(0, 160)] }; }
  const doc = { id: 'ultimo', gerado_em: new Date().toISOString(), posts: st.posts, conta: dadosConta, parcial: st.parcial || null };
  await a.radar.salvar(conta(), RX_TIPO, 'ultimo', doc);
  try { await a.radar.apagar(conta(), RX_TIPO, 'leitura'); } catch { /* fica para a próxima leitura sobrescrever */ }
  res.json({ continua: false, ...montarRaioX(doc) });
}));

module.exports = router;
