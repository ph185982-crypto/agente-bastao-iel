// "Minhas histórias e casos": cadastro e as três linhas próprias no pipeline (história, como fazer, caso), com IA simulada.
// node --test backend/lib/historias.test.js
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const arm = require('./armazem');
const H = require('./historias');
const T = require('./top/pipeline');
const P = require('./top/prompts');
const Pi = require('./top/piloto');
const Placar = require('./placar');
const M = require('../../static/contentModel');
const { ACCOUNT } = require('./account');

const novo = () => arm._definir(Object.assign(arm.memoria(), { duravel: true }));
const SP = (dia, hhmm) => Date.parse(`${dia}T${hhmm}:00-03:00`);
const HISTORIA = 'Em 2019 eu abri a maquininha numa terça e vi que sobraram 380 reais. O fornecedor ia ligar na quarta. Eu misturava o dinheiro da loja com o meu e não sabia quanto era de cada um. Naquele dia eu abri uma conta só para a empresa. Demorou três meses para eu parar de tirar dinheiro do caixa sem anotar. Hoje eu só pago o que é meu depois de separar o do fornecedor.';
const ANGULO = { gatilhos: { contradicao: 0, bolso: 2, numero: 1, personagem: 3, empreendedor: 3 }, tese: 'Eu só organizei o caixa quando separei o meu dinheiro do dinheiro da loja.', por_que_mandaria: 'Isso é a cara do meu sócio.', enviar_para: 'quem mistura as contas', formato: 'tweet', imagem: { busca: 'small shop owner counter', pessoa_central: true, lugar_brasil: null } };
const roteiro = (extra = {}) => ({
  capas: [{ texto: 'Eu misturava o **dinheiro da loja** com o meu', mecanismo: 'identificacao' }, { texto: 'Sobraram 380 reais numa terça', mecanismo: 'cena' }, { texto: 'O dia em que abri a maquininha e entendi', mecanismo: 'cena' }],
  telas: [
    { papel: 'gap', texto: 'Abri a maquininha numa terça e vi o que tinha sobrado.', fatos: ['f1'] },
    { papel: 'contradicao', texto: 'Eu misturava o dinheiro da loja com o meu e não sabia quanto era de cada um.', fatos: ['f3'] },
    { papel: 'consequencia', texto: 'O fornecedor ia ligar na quarta.', fatos: ['f2'] },
    { papel: 'consequencia', texto: 'Naquele dia eu abri uma conta só para a empresa.', fatos: ['f4'] },
    { papel: 'leitura', texto: 'Hoje eu só pago o que é meu depois de separar o do fornecedor.', fatos: ['f6'] },
  ],
  legenda: 'Eu levei três meses para parar de tirar dinheiro do caixa sem anotar. Manda pra quem ainda mistura as contas.',
  hashtags: ['empreendedorismo', 'caixa', 'mei'], cta_motivo: 'se você também cuida do próprio caixa', fechamento: { titulo: 'Separar foi o começo.', texto: 'Conta da empresa é da empresa.' }, ...extra,
});
const JURI = { versoes: [{ indice: 0, notas: { honestidade: 9 }, nota: 8.7, defeito: '' }, { indice: 1, notas: { honestidade: 9 }, nota: 8.2, defeito: '' }], vencedora: 0, capas_escolhidas: [0, 1] };
function iaFalsa({ roteiros = [roteiro(), roteiro()], juri = JURI } = {}) {
  let r = 0; const chamadas = [];
  const pedirJson = async ({ sistema, usuario }) => {
    const tipo = /extrai FATOS/.test(sistema) ? 'fatos' : /editor-chefe/.test(sistema) ? 'angulo' : /júri editorial/.test(sistema) ? 'juri' : /sala de redação/.test(sistema) ? 'sala' : 'roteiro';
    chamadas.push({ tipo, sistema, usuario });
    const dados = tipo === 'angulo' ? ANGULO : tipo === 'juri' ? juri : tipo === 'sala' ? { capas: [] } : roteiros[Math.min(r++, roteiros.length - 1)];
    return { dados: JSON.parse(JSON.stringify(dados)), llm: { provider: 'simulado' } };
  };
  return { pedirJson, chamadas };
}
const deps = (ia) => ({ ...ia, placar: null,
  lerFonte: async ({ texto }) => ({ tipo: 'texto', url: null, titulo: '', veiculo: '', publicada_em: null, texto, legivel: true, acessada_em: new Date().toISOString() }),
  fotoDe: async () => ({ dados: await sharp({ create: { width: 900, height: 1100, channels: 3, background: '#a77' } }).jpeg().toBuffer(), meta: { id: 'pexels_teste', tipo: 'banco', autor: 'Fotógrafo Exemplo', licenca: 'Pexels', exige_credito: false, origem: 'https://www.pexels.com/x' } }) });

test('cadastro: valida tipo e tamanho, cria, edita, lista do mais novo para o mais antigo e apaga', async () => {
  novo();
  await assert.rejects(H.criar({ tipo: 'fofoca', texto: HISTORIA }), /Escolha o tipo/);
  await assert.rejects(H.criar({ tipo: 'historia', texto: 'curto demais' }), /pelo menos 200 caracteres \(tem 12\)/);
  const a = await H.criar({ tipo: 'historia', titulo: '', texto: HISTORIA }, { agora: SP('2026-11-10', '10:00') });
  assert.match(a.id, /^hs_[a-f0-9]{16}$/); assert.strictEqual(a.titulo, 'Em 2019 eu abri a maquininha numa terça e vi que sobraram 380 reais.');
  const b = await H.criar({ tipo: 'como_fazer', titulo: 'Separar as contas', texto: HISTORIA }, { agora: SP('2026-11-11', '10:00') });
  assert.deepStrictEqual((await H.listar()).map((x) => x.id), [b.id, a.id]);
  assert.strictEqual((await H.editar(a.id, { titulo: 'A terça da maquininha' })).titulo, 'A terça da maquininha');
  assert.strictEqual((await H.proximaNaoUsada()).id, a.id, 'a mais antiga sem uso');
  await H.marcarUso(a.id, { conteudo_id: 'c_x' });
  assert.strictEqual((await H.proximaNaoUsada()).id, b.id);
  assert.deepStrictEqual(await H.apagar(b.id), { id: b.id, apagada: true });
  await assert.rejects(H.obter(b.id), (e) => e.status === 404);
});

test('história do Pedro: vira carrossel sem extrair fatos por IA, sem rodapé de fonte, com a chamada da linha, e a ficha marca a linha', async () => {
  novo(); const ia = iaFalsa();
  const h = await H.criar({ tipo: 'historia', titulo: 'A terça da maquininha', texto: HISTORIA });
  const g = await H.gerar(h.id);
  assert.strictEqual(g.formato, 'tweet', 'história curta sai em tweet; a comprida (900+ caracteres) sai em ensaio');
  const r = await T.executarTudo(g.id, { deps: deps(ia) });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  assert.ok(!ia.chamadas.some((x) => x.tipo === 'fatos'), 'os fatos são as frases dele, sem IA');
  assert.strictEqual(r.conteudo.top.fatos.length, 6); assert.deepStrictEqual(r.conteudo.top.fatos[0].valores.includes(380), true);
  const rot = ia.chamadas.find((x) => x.tipo === 'roteiro');
  assert.ok(rot.sistema.startsWith('LINHA EDITORIAL DESTA PEÇA: HISTÓRIA DO PEDRO'), 'a linha vem antes do prompt do formato');
  assert.match(rot.usuario, /TEXTO DO PEDRO \(fonte única/); assert.match(rot.usuario, /f1: Em 2019 eu abri a maquininha/);
  assert.match(ia.chamadas.find((x) => x.tipo === 'juri').usuario, /LINHA: HISTÓRIA DO PEDRO/);
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, g.id)).doc; const v = M.versaoAtiva(doc);
  assert.doesNotMatch(v.legenda, /Fonte:/);
  assert.strictEqual(v.slides[v.slides.length - 1].cta, 'Manda pra quem precisa ouvir isso.');
  assert.strictEqual(doc.top.historia.id, h.id);
  assert.strictEqual(Placar.fichaDe(doc).linha, 'historia');
  assert.strictEqual((await H.obter(h.id)).usos[0].conteudo_id, g.id);
});

test('número que não está no texto do Pedro é cortado; a peça não afirma dado de fora', async () => {
  novo();
  const inventa = roteiro({ telas: [...roteiro().telas.slice(0, 4), { papel: 'leitura', texto: 'Depois disso meu lucro subiu 47% em dois meses.', fatos: [] }], legenda: 'Meu faturamento dobrou e cresceu 47%. Manda pra quem ainda mistura as contas.' });
  const ia = iaFalsa({ roteiros: [inventa, inventa, roteiro(), roteiro()] });
  const h = await H.criar({ tipo: 'historia', texto: HISTORIA });
  const g = await H.gerar(h.id);
  const r = await T.executarTudo(g.id, { deps: deps(ia) });
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, g.id)).doc;
  if (r.conteudo.top.estado === 'concluida') {
    const v = M.versaoAtiva(doc); const tudo = [v.legenda, ...v.slides.map((s) => `${s.titulo || ''} ${s.texto || ''}`)].join(' ');
    assert.doesNotMatch(tudo, /47\s?%/, 'o número inventado não chega à peça');
  } else assert.ok(['abaixo_da_regua', 'descartada'].includes(r.conteudo.top.estado));
  assert.ok(doc.top.versoes.every((v) => !/47\s?%/.test(v.legenda)), 'a frase com número de fora sai da legenda');
});

test('como fazer e caso: linha própria no prompt e chamada final de cada uma', async () => {
  novo();
  for (const [tipo, re, cta] of [['como_fazer', /LINHA EDITORIAL DESTA PEÇA: COMO FAZER/, 'Salva esse passo a passo.'], ['caso', /LINHA EDITORIAL DESTA PEÇA: CASO DE CLIENTE/, 'Manda pra quem mistura as contas.']]) {
    const ia = iaFalsa(); const h = await H.criar({ tipo, texto: HISTORIA }); const g = await H.gerar(h.id);
    const r = await T.executarTudo(g.id, { deps: deps(ia) });
    assert.strictEqual(r.conteudo.top.estado, 'concluida', `${tipo}: ${JSON.stringify(r.conteudo.top.erros)}`);
    assert.match(ia.chamadas.find((x) => x.tipo === 'roteiro').sistema, re);
    const v = M.versaoAtiva((await arm.armazem().conteudos.obter(ACCOUNT.ig_id, g.id)).doc);
    assert.strictEqual(v.slides[v.slides.length - 1].cta, cta);
  }
  assert.match(P.LINHAS.caso.roteiro, /NUNCA identifique o cliente/);
});

test('piloto: com história não usada, 1 de cada 3 peças do dia sai dela; sem cadastro, segue só a notícia', async () => {
  novo(); const criadas = []; const usadas = [];
  const fila = [{ id: 'hs_1', tipo: 'historia' }, { id: 'hs_2', tipo: 'caso' }];
  const d = { semLimpeza: true, placar: null,
    proximaHistoria: async () => fila.find((h) => !usadas.includes(h.id)) || null,
    gerarHistoria: async (id) => { usadas.push(id); criadas.push(`H:${id}`); return { id: `c_h${usadas.length}`, titulo: `História ${id}`, formato: 'tweet' }; },
    descobrir: async () => ({ pautas: [{ id: `p${criadas.length}`, titulo: `Pauta ${criadas.length}`, prioridade: 90, fontes: [{ url: `https://agenciabrasil.ebc.com.br/${criadas.length}` }] }] }),
    criar: async (o) => { criadas.push(`N:${o.titulo}`); return { id: `c_n${criadas.length}` }; } };
  const a = arm.armazem();
  for (let i = 0; i < 6; i++) {
    await Pi.rodada({ agora: SP('2026-10-29', `06:${String(10 + i * 5).padStart(2, '0')}`), deps: d });
    const cfg = await a.config.obter(ACCOUNT.ig_id); cfg.piloto_estado.criados.forEach((x) => { x.estado = 'concluida'; }); await a.config.salvar(ACCOUNT.ig_id, { piloto_estado: cfg.piloto_estado });
  }
  assert.deepStrictEqual(criadas.map((x) => x[0]), ['H', 'N', 'N', 'H', 'N', 'N'], criadas.join(' | '));
  const est = (await a.config.obter(ACCOUNT.ig_id)).piloto_estado;
  assert.deepStrictEqual(est.criados.map((x) => x.linha), ['historia', 'noticia', 'noticia', 'caso', 'noticia', 'noticia']);
});

// ── Fotos do Pedro ────────────────────────────────────────────────────────────────────────────────────────────────────
const F = require('./fotosPedro');
const jpeg = (cor, w = 1200, h = 1500) => sharp({ create: { width: w, height: h, channels: 3, background: cor } }).jpeg().toBuffer();

test('fotos do Pedro: envia (corrige e reduz), lista com miniatura, recusa imagem pequena ou inválida, limita a 20 e apaga', async () => {
  novo();
  const a = await F.enviar(await jpeg('#a55', 3000, 4000));
  assert.match(a.id, /^[a-f0-9]{12}$/); assert.match(a.mini, /^data:image\/jpeg;base64,/);
  const guardada = await arm.armazem().arquivos.obter(ACCOUNT.ig_id, `foto_pedro:${a.id}`);
  const meta = await sharp(Buffer.from(guardada.dados)).metadata(); assert.ok(Math.max(meta.width, meta.height) <= 1600, 'reduzida para caber no banco');
  const b = await F.enviar(`data:image/jpeg;base64,${(await jpeg('#5a5')).toString('base64')}`);
  const l = await F.listar(); assert.strictEqual(l.fotos.length, 2); assert.ok(l.fotos.every((f) => f.mini && f.usos === 0)); assert.strictEqual(l.max, 20);
  await assert.rejects(F.enviar(await jpeg('#000', 300, 300)), /pequena demais para a capa/);
  await assert.rejects(F.enviar('data:text/html;base64,PGgxPg=='), /Envie uma imagem/);
  await assert.rejects(F.enviar(Buffer.alloc(5000, 7)), /Não consegui ler/);
  assert.deepStrictEqual(await F.apagar(b.id), { id: b.id, apagada: true });
  await assert.rejects(F.apagar(b.id), (e) => e.status === 404);
  for (let i = 0; i < 19; i++) await F.enviar(await jpeg('#777', 700, 700));
  await assert.rejects(F.enviar(await jpeg('#777', 700, 700)), (e) => e.code === 'LIMITE');
});

test('rodízio: a capa usa a foto menos usada; a limpeza diária não apaga as fotos do Pedro', async () => {
  novo();
  const a = await F.enviar(await jpeg('#a55')); const b = await F.enviar(await jpeg('#5a5'));
  const usadas = []; for (let i = 0; i < 4; i++) usadas.push((await F.proxima()).meta.id);
  assert.strictEqual(usadas.filter((x) => x === `fp_${a.id}`).length, 2); assert.strictEqual(usadas.filter((x) => x === `fp_${b.id}`).length, 2);
  await require('./manutencao').limpar({ agora: Date.now() + 60 * 86400000 });
  assert.strictEqual((await F.listar()).fotos.length, 2, 'fotos do Pedro ficam mesmo depois de 60 dias');
  assert.strictEqual((await F.listar()).fotos.find((f) => f.id === a.id).usos, 2);
});

test('capa com o rosto do Pedro: história usa a foto dele (sem buscar banco de imagens); notícia não usa', async () => {
  novo(); const foto = await F.enviar(await jpeg('#a55'));
  const ia = iaFalsa(); let buscas = 0;
  const h = await H.criar({ tipo: 'historia', texto: HISTORIA }); const g = await H.gerar(h.id);
  const r = await T.executarTudo(g.id, { deps: { ...deps(ia), buscarFoto: async () => { buscas++; throw new Error('não deveria buscar a capa'); } } });
  assert.strictEqual(r.conteudo.top.estado, 'concluida', JSON.stringify(r.conteudo.top.erros));
  const doc = (await arm.armazem().conteudos.obter(ACCOUNT.ig_id, g.id)).doc;
  assert.strictEqual(doc.top.foto_do_pedro, true); assert.strictEqual(doc.top.foto_cena_id, `fp_${foto.id}`);
  assert.strictEqual(M.versaoAtiva(doc).slides[0].imagem_id, `fp_${foto.id}`, 'a capa aponta para a foto dele');
  assert.doesNotMatch(M.versaoAtiva(doc).legenda, /Foto:/, 'foto própria não leva crédito');
  assert.strictEqual((await F.listar()).fotos[0].usos, 1);
  // notícia (matéria com link) não usa a foto dele
  const ia2 = iaFalsa();
  const MATERIA = 'O índice de exemplo do Órgão Fictício chegou a 82,9% em agosto de 2026, segundo o relatório divulgado nesta segunda-feira. Em dezembro de 2022, o mesmo índice era de 71,7%. O ministro Fulano de Tal afirmou que a alta é temporária e que o governo vai cumprir a meta.';
  const c = await T.criar({ url: 'https://exemplo.test/materia' });
  await T.passo(c.id, { deps: { ...deps(ia2), lerFonte: async () => ({ tipo: 'artigo', url: 'https://exemplo.test/materia', titulo: 'Índice bate 82,9%', veiculo: 'Jornal Exemplo', publicada_em: '2026-10-27T12:00:00Z', texto: MATERIA, legivel: true }) }, orcamentoMs: 2000 }).catch(() => {});
  assert.strictEqual((await F.listar()).fotos[0].usos, 1, 'a notícia não consumiu a foto dele');
});
