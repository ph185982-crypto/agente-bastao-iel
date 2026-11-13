// Radar de Reciclagem: transforma uma TESE que viralizou em conteúdo do Pedro. Nunca o texto: a IA recebe só
// tema, tese neutra, mecanismo, ponte e os números do post; nada do original é citado, traduzido ou imitado.
//
//  - carrossel / estatico → entra no pipeline "top" (backend/lib/top/pipeline.js) como texto de briefing. O pipeline
//    com `modo: 'opiniao'`: não há matéria nem fatos a conferir, então o conteúdo sai como OPINIÃO do Pedro, marcada
//    como leitura dele, sem nenhum número e sem rodapé de "Fonte". A origem fica em c.top.reciclado_de.
//  - reel → roteiro falado de 45 a 75 s, na voz do Pedro, com uma mente da sala de redação sorteada e as regras
//    anti-IA. Roteiro com 2 ou mais vícios de texto de IA é reprovado e pedido de novo (até 3 tentativas).
const M = require('../../../static/contentModel');
const llmJson = require('../llmJson');
const Mentes = require('../mentes');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const Contas = require('./contas');
const Coletar = require('./coletar');

const conta = () => ACCOUNT.ig_id;
const erro = (msg, code, status = 400) => Object.assign(new Error(msg), { code, status });
const FORMATOS = ['carrossel', 'estatico', 'reel'];
const PALAVRAS_MIN = 100; const PALAVRAS_MAX = 200; // 45–75 s a ~2,5 palavras por segundo
const PALAVRAS_POR_S = 2.5;
const TENTATIVAS_REEL = 3;
const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const ROTULO = { carrossel: 'carrossel', estatico: 'post estático', reel: 'reel' };

// Registro da origem que acompanha o conteúdo (auditável; nunca vai para a arte nem para a legenda).
function fonteDe(item) {
  return {
    item_id: item.id, rede: item.rede, handle: item.conta?.handle || null, nome: item.conta?.nome || null, pais: item.conta?.pais || null, idioma: item.conta?.idioma || null,
    permalink: item.permalink, publicado_em: item.publicado_em, tipo: item.tipo,
    metricas: { curtidas: item.curtidas ?? null, comentarios: item.comentarios ?? null, visualizacoes: item.visualizacoes ?? null, seguidores: item.seguidores ?? null, er: item.er ?? null, vl: item.vl ?? null },
    tema: item.tema || null, mecanismo: item.mecanismo || null, tese: item.tese || null, ponte_pedro: item.ponte_pedro || null, reciclado_em: new Date().toISOString(),
  };
}

// Briefing que entra no pipeline como "texto colado": tese, ponte, mecanismo e a instrução de escrever como opinião, sem número.
// "Mesma estrutura": o app só enxerga o tipo do post, a quantidade de slides e o MECANISMO que o fez viralizar (nunca as
// imagens nem o texto). A estrutura vira instrução de ritmo: mesmo número de telas, mesmo tipo de gancho e de virada.
function blocoEstrutura(item) {
  const n = Number(item.n_slides) || null; const telas = n ? Math.max(4, Math.min(8, n - 2)) : null;
  const mec = item.mecanismo ? `${item.mecanismo}: ${Contas.MECANISMOS[item.mecanismo] || ''}` : null;
  return ['MESMA ESTRUTURA DO POST ORIGINAL (a ordem e o ritmo, não as palavras):',
    n ? `- O original tem ${n} slides: capa, ${n - 2} de desenvolvimento e fechamento. Faça o mesmo ritmo, com ${telas} telas de conteúdo entre a capa e o fechamento.` : '- Número de slides do original desconhecido: use o padrão do formato.',
    mec ? `- Mecanismo que sustentou o original: ${mec}. A capa abre com o mesmo tipo de gancho e o meio repete o tipo de virada.` : null,
    '- Texto, exemplos, números e fotos são do Pedro, escritos do zero em português; nada do original é citado, traduzido nem imitado de perto.'].filter(Boolean).join('\n');
}

function briefing(item, { mesmaEstrutura = false } = {}) {
  const mec = item.mecanismo ? `${item.mecanismo}: ${Contas.MECANISMOS[item.mecanismo] || ''}` : 'não identificado';
  return [
    `Briefing de reciclagem: ${item.tema || 'tese em alta'}`,
    '',
    `TESE (neutra, extraída de um post que viralizou fora do perfil): ${item.tese || '(sem tese classificada)'}`,
    `PONTE PARA O EMPREENDEDOR BRASILEIRO: ${item.ponte_pedro || '(sem ponte classificada)'}`,
    `MECANISMO QUE FEZ O POST ORIGINAL VIRALIZAR: ${mec}`,
    `SINAL DE VIRALIDADE: índice ${item.vl ?? '?'} vezes a mediana da conta de origem (${item.conta?.pais || '?'}, ${item.conta?.idioma || '?'}); o conteúdo original não é citado nem traduzido.`,
    '',
    'INSTRUÇÕES PARA A REDAÇÃO: escreva do zero, na voz do Pedro (direita assumida, liberdade econômica, responsabilidade fiscal, crítica ao PT e ao governo quando o assunto pede), para quem empreende no Brasil: dono de empresa, MEI, quem vende em marketplace, autônomo. Reaproveite a TESE e o MECANISMO, nunca o texto, o exemplo ou a história do autor original; não cite nem imite a conta de origem.',
    ...(mesmaEstrutura ? ['', blocoEstrutura(item), ''] : []),
    'SEM FATOS: este conteúdo é OPINIÃO do Pedro sobre a tese, marcada como leitura dele ( "na minha leitura", "pra mim" ), sem nenhum número, porcentagem, data, pesquisa ou estatística. Use cenas do dia a dia do empreendedor brasileiro (maquininha, boleto, fornecedor, nota fiscal, funcionário) no lugar de dados.',
  ].join('\n');
}

async function salvarConteudo(c) {
  const a = armazem(); if (!a?.duravel) throw erro('A reciclagem precisa do banco de dados no servidor.', 'SEM_BANCO', 503);
  const atual = await a.conteudos.obter(conta(), c.id);
  return a.conteudos.salvar(conta(), c.id, c, atual?.rev || 0);
}

// Carrossel ou post estático: entra no pipeline "top" com origem 'reciclagem'.
async function reciclarCarrossel(item, { formato = 'carrossel', deps = {}, mesmaEstrutura = false } = {}) {
  const criar = deps.criar || require('../top/pipeline').criar;
  const texto = briefing(item, { mesmaEstrutura });
  const c = await criar({ texto, titulo: `Reciclagem: ${item.tema || 'tese em alta'}`.slice(0, 140), origem: 'reciclagem', formato: formato === 'estatico' ? 'estatico' : null, modo: 'opiniao' });
  c.top = c.top || {};
  c.top.reciclado_de = fonteDe(item);
  c.top.reciclagem_formato = formato; c.top.reciclagem_mesma_estrutura = !!mesmaEstrutura;
  await (deps.salvarConteudo || salvarConteudo)(c);
  return { id: c.id, formato, titulo: c.titulo, etapa: c.top.etapa || null };
}

// ── Reel ────────────────────────────────────────────────────────────────────────
function promptReel({ mente, feedback = '' }) {
  return `Você escreve o ROTEIRO FALADO de um Reel do @pedro_destrava (Pedro Martins), gravado por ele olhando para a câmera, para quem empreende no Brasil: dono de empresa, MEI, quem vende em marketplace, autônomo, quem paga folha, imposto e fornecedor.
VOZ DO PEDRO: direita assumida, liberdade econômica, responsabilidade fiscal, iniciativa privada; crítica dura ao PT e ao governo quando o assunto pede; fatos com fonte; sem ataque pessoal a quem não é figura pública; sem propaganda nem elogio a governo.
O QUE VOCÊ RECEBE: uma TESE neutra que viralizou em outra conta (outro país ou outra audiência), o MECANISMO que a fez viralizar e a PONTE para o empreendedor brasileiro. Você NÃO recebe o texto original e NÃO deve citar, mencionar, imitar nem traduzir o autor ou a conta de origem: escreva do zero, como o Pedro falaria.
REGRAS DO ROTEIRO (45 a 75 segundos falados: ${PALAVRAS_MIN} a ${PALAVRAS_MAX} palavras no total):
- GANCHO nos 2 primeiros segundos (até 12 palavras) NOMEANDO O PÚBLICO: "Se você tem loja…", "Dono de negócio pequeno…", "Quem vende na Shopee…".
- UMA ideia só, do começo ao fim. Uma CENA concreta do dia a dia do empreendedor brasileiro (maquininha, boleto, fornecedor ligando, nota fiscal, funcionário pedindo aumento), nunca conceito solto.
- FECHAMENTO pedindo o envio: "manda esse vídeo pra…" (seu sócio, quem tem CNPJ, quem vende online), 1 frase.
- NÚMERO só se for fato público conhecido e com a fonte dita na própria fala ("segundo o IBGE"). Na dúvida, sem número: opinião assumida em primeira pessoa ("eu acho", "na minha leitura").
- Português falado, frases curtas, primeira pessoa, sem jargão de jornal, sem hashtag, sem emoji, sem indicação de câmera.
${Mentes.paraRoteiro(mente)}
${Mentes.AI.REGRAS}
${feedback ? `\nREESCREVA DO ZERO. A versão anterior foi reprovada por: ${feedback}` : ''}
Responda APENAS JSON: {"titulo":"até 8 palavras","publico":"quem o gancho nomeia","gancho":"","corpo":"","fechamento":""}`;
}

function problemasDoRoteiro({ gancho, corpo, fechamento }, item) {
  const problemas = [];
  const vic = Mentes.AI.vicios([gancho, corpo, fechamento]);
  if (vic.length >= 2) problemas.push(`texto com cara de IA (${vic.length} vícios): ${vic.slice(0, 4).map((x) => `${x.nome} em "${x.trecho}"`).join('; ')}`);
  if (!gancho || palavras(gancho) > 16) problemas.push('gancho ausente ou com mais de 12 palavras');
  const total = palavras(`${gancho} ${corpo} ${fechamento}`);
  if (total < PALAVRAS_MIN * 0.7) problemas.push(`roteiro curto demais (${total} palavras; mínimo ${PALAVRAS_MIN})`);
  if (total > PALAVRAS_MAX * 1.3) problemas.push(`roteiro longo demais (${total} palavras; máximo ${PALAVRAS_MAX})`);
  if (!/\b(manda|mande|envia|envie|compartilha|compartilhe|marca|marque)\b/i.test(fechamento || '')) problemas.push('fechamento sem pedido de envio');
  const alvo = [item.conta?.handle, item.conta?.nome].filter((x) => x && String(x).length >= 4).map((x) => String(x).toLowerCase().replace(/^@/, ''));
  const texto = `${gancho} ${corpo} ${fechamento}`.toLowerCase();
  if (alvo.some((a) => texto.includes(a))) problemas.push('cita a conta ou o autor original');
  return { problemas, vicios: vic.length, palavras: total };
}

async function roteiroReel(item, { deps = {} } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson;
  if (!deps.pedirJson && !llmJson.hasLlmKey()) throw erro('Nenhuma IA está configurada no servidor: o roteiro não pode ser escrito.', 'SEM_IA', 503);
  const mente = deps.mente || Mentes.MENTES[Math.floor((deps.sortear || Math.random)() * Mentes.MENTES.length)];
  const usuario = `TEMA: ${item.tema || '(sem tema)'}\nTESE (neutra): ${item.tese || '(sem tese)'}\nMECANISMO QUE FEZ VIRALIZAR: ${item.mecanismo || '?'} (${Contas.MECANISMOS[item.mecanismo] || ''})\nPONTE PARA O EMPREENDEDOR BRASILEIRO: ${item.ponte_pedro || '(sem ponte)'}\nORIGEM: post em ${item.conta?.idioma || '?'} (${item.conta?.pais || '?'}), com índice de viralidade ${item.vl ?? '?'} vezes a mediana da conta. Não cite a origem.`;
  let feedback = ''; let ultimo = null;
  for (let t = 1; t <= TENTATIVAS_REEL; t++) {
    const { dados } = await pedir({ sistema: promptReel({ mente, feedback }), usuario, maxTokens: 900, temperatura: t === 1 ? 0.7 : 0.9, preferirMelhor: true });
    const r = { titulo: String(dados?.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 90), publico: String(dados?.publico || '').replace(/\s+/g, ' ').trim().slice(0, 60), gancho: String(dados?.gancho || '').trim().slice(0, 300), corpo: String(dados?.corpo || '').trim().slice(0, 2400), fechamento: String(dados?.fechamento || '').trim().slice(0, 400) };
    const chk = problemasDoRoteiro(r, item);
    ultimo = { ...r, ...chk, tentativa: t, mente: mente.id };
    if (!chk.problemas.length) break;
    feedback = chk.problemas.join('; ');
  }
  if (ultimo.problemas.length) throw erro(`O roteiro não passou na revisão depois de ${TENTATIVAS_REEL} tentativas: ${ultimo.problemas[0]}`, 'ROTEIRO_REPROVADO', 422);
  const roteiro_texto = [ultimo.gancho, ultimo.corpo, ultimo.fechamento].filter(Boolean).join('\n\n');
  return { ...ultimo, roteiro_texto, duracao_estimada_s: Math.round(ultimo.palavras / PALAVRAS_POR_S) };
}

async function reciclarReel(item, { deps = {} } = {}) {
  const r = await roteiroReel(item, { deps });
  const fonte = fonteDe(item);
  const c = M.novoConteudo({ titulo: (r.titulo || `Reel: ${item.tema || 'tese em alta'}`).slice(0, 140), formato: 'reels', origem: { tipo: 'reciclagem', reciclado_de: fonte } });
  c.video = { estado: 'roteiro', roteiro_texto: r.roteiro_texto, titulo: r.titulo || null, publico: r.publico || null, duracao_estimada_s: r.duracao_estimada_s, palavras: r.palavras, mente: r.mente, vicios: r.vicios, tentativas: r.tentativa, origem: 'reciclagem', gerado_em: new Date().toISOString() };
  c.reciclagem = { origem: 'reciclagem', formato: 'reel', reciclado_de: fonte };
  M.registrar(c, 'sistema', 'roteiro', `Roteiro de Reel reciclado da tese "${item.tema || ''}" (mente ${r.mente}, ${r.tentativa} tentativa${r.tentativa > 1 ? 's' : ''})`);
  await (deps.salvarConteudo || salvarConteudo)(c);
  return { id: c.id, formato: 'reel', titulo: c.titulo, roteiro: r.roteiro_texto, duracao_estimada_s: r.duracao_estimada_s, mente: r.mente, tentativas: r.tentativa };
}

// Entrada única da rota: acha o item, recicla no formato pedido e registra no item.
async function reciclar(itemOuId, { formato, deps = {}, mesmaEstrutura = false } = {}) {
  if (!FORMATOS.includes(formato)) throw erro(`Formato inválido. Use ${FORMATOS.join(', ')}.`, 'ENTRADA');
  const item = typeof itemOuId === 'string' ? await (deps.obter || Coletar.obter)(itemOuId) : itemOuId;
  if (!item) throw erro('Item não encontrado.', 'NAO_ENCONTRADO', 404);
  if (!item.tese && !item.tema) throw erro('Este item ainda não foi classificado pela IA (sem tese). Atualize a coleta e tente de novo.', 'SEM_TESE', 409);
  const r = formato === 'reel' ? await reciclarReel(item, { deps }) : await reciclarCarrossel(item, { formato, deps, mesmaEstrutura });
  try { await (deps.marcarReciclado || Coletar.marcarReciclado)(item.id, { formato, conteudo_id: r.id }); } catch { /* registro no item é cortesia */ }
  return { ...r, rotulo: ROTULO[formato] };
}

module.exports = { FORMATOS, PALAVRAS_MIN, PALAVRAS_MAX, TENTATIVAS_REEL, fonteDe, briefing, promptReel, problemasDoRoteiro, roteiroReel, reciclarCarrossel, reciclarReel, reciclar };
