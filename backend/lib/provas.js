// Provas do dia: o mecanismo de criação que parte de PROVA DE DEMANDA, não de "saiu uma notícia".
// Toda ideia de vídeo traz o número que mostra que as pessoas querem aquilo:
//   1. aprovada por você (Estratégia criativa ou comentário que você mandou virar pauta);
//   2. conteúdo SEU que rendeu acima do normal (do Raio-X: novo episódio, outro ângulo, nunca repetir o texto);
//   3. tese que viralizou no mercado nos últimos dias (radar da Reciclagem: quantas vezes passou a mediana da própria conta);
//   4. pergunta que a audiência repete nos comentários.
// Saída padrão: roteiro de Reel com o Pedro falando (é vídeo com rosto que chega a quem não segue e dá motivo para seguir).
// Pura nas contas (sem IA, sem custo). Quem escreve o roteiro continua sendo o motor de roteiros (IA gratuita).
const crypto = require('crypto');

const FONTES = { aprovada: 'Aprovada por você', seu_vencedor: 'Seu conteúdo que funcionou', viral: 'Viralizou no mercado', pergunta: 'Pergunta da audiência' };
const DIA = 86400000;
const n = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const limpo = (s, k) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, k);
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const chavesDe = (t) => new Set(norm(t).split(' ').filter((w) => w.length >= 5));
const parecidos = (a, b) => { const x = chavesDe(a); const y = chavesDe(b); if (x.size < 2 || y.size < 2) return false; let c = 0; for (const w of x) if (y.has(w)) c++; return c / Math.min(x.size, y.size) >= 0.6; };

// Conteúdo próprio acima do normal (frase famosa e clone de outra conta não contam: a ideia não é do Pedro).
function dosVencedores(analise, { agora = Date.now(), max = 6 } = {}) {
  if (!analise?.melhores?.length) return [];
  return analise.melhores.filter((p) => !['frase', 'reciclagem'].includes(p.linha) && agora - Date.parse(p.em) <= 180 * DIA && (p.vezes_mediana ?? 0) >= 1.5 && String(p.legenda || '').length >= 30).slice(0, max).map((p) => ({
    chave: `pv:${p.id}`, fonte: 'seu_vencedor', titulo: limpo(p.legenda, 90),
    evidencia: `Seu ${p.tipo} de ${p.em.slice(8, 10)}/${p.em.slice(5, 7)}: alcance ${n(p.alcance)} (${n(p.vezes_mediana)}× a sua mediana)${p.envios_mil != null ? `, ${n(p.envios_mil)} envios por mil` : ''}${p.seguidores ? `, ${n(p.seguidores)} seguidores` : ''}.`,
    forca: Math.min(100, Math.round(55 + Math.min(35, ((p.vezes_mediana || 1) - 1) * 8) + ((p.envios_mil ?? 0) >= (analise.geral?.envios_mil ?? Infinity) * 2 ? 10 : 0))),
    pauta: `CONTEÚDO DO PRÓPRIO PEDRO QUE FUNCIONOU (prova: alcance ${n(p.vezes_mediana)}× a mediana do perfil). Faça um EPISÓDIO NOVO sobre o mesmo assunto: outro ângulo, outro exemplo ou a consequência seguinte. Não repita o texto e não diga "parte 2": o vídeo se entende sozinho.\nLEGENDA DO POST ORIGINAL (só o assunto; os fatos precisam estar aqui ou serem cena do dia a dia): ${limpo(p.legenda, 300)}`,
  }));
}

// Teses virais do radar da Reciclagem: a prova é o índice (quantas vezes o post passou a mediana da própria conta).
function dosVirais(itens = [], { agora = Date.now(), max = 8 } = {}) {
  return (itens || []).filter((it) => it?.tese && (it.vl ?? 0) >= 2 && !it.descartado_em).sort((a, b) => (b.vl ?? 0) - (a.vl ?? 0)).slice(0, max).map((it) => {
    const dias = Math.max(0, Math.round((agora - Date.parse(it.publicado_em || it.coletado_em || agora)) / DIA));
    const num = it.visualizacoes ? `${n(it.visualizacoes)} visualizações` : it.curtidas ? `${n(it.curtidas)} curtidas` : null;
    return {
      chave: `rc:${it.id}`, fonte: 'viral', titulo: limpo(it.tema || it.tese, 90),
      evidencia: `${it.tipo === 'reel' ? 'Reel' : 'Post'} de ${it.conta?.handle ? `@${String(it.conta.handle).replace(/^@/, '')}` : 'outra conta'}${it.conta?.pais ? ` (${it.conta.pais})` : ''} há ${dias} dia(s): ${n(it.vl)}× a mediana da própria conta${num ? `, ${num}` : ''}.`,
      forca: Math.min(95, Math.round(40 + Math.min(45, (it.vl || 0) * 5) + (it.tipo === 'reel' ? 5 : 0))),
      pauta: [`TESE QUE VIRALIZOU EM OUTRA CONTA (não cite a origem; faça a versão ORIGINAL do Pedro, com a leitura dele): ${it.tese}`, it.ponte_pedro ? `PONTE PARA O PÚBLICO DO PEDRO: ${it.ponte_pedro}` : '', it.analise?.motivo ? `POR QUE FUNCIONOU: ${it.analise.motivo}` : '', it.analise?.angulo_pedro ? `ÂNGULO SUGERIDO: ${it.analise.angulo_pedro}` : ''].filter(Boolean).join('\n'),
      tese: limpo(it.tese, 240),
    };
  });
}

function dasPerguntas(grupos = [], { max = 4 } = {}) {
  return (grupos || []).filter((g) => g.n >= 2).slice(0, max).map((g) => ({
    chave: `pq:${crypto.createHash('sha1').update(norm(g.exemplo)).digest('hex').slice(0, 12)}`, fonte: 'pergunta', titulo: limpo(g.exemplo, 90),
    evidencia: `${g.n} pessoas perguntaram a mesma coisa nos comentários dos seus posts.`, forca: Math.min(90, 45 + g.n * 10),
    pauta: `PERGUNTA QUE A AUDIÊNCIA REPETE NOS COMENTÁRIOS (${g.n} vezes; responda com o conteúdo, sem citar quem perguntou): ${limpo(g.exemplo, 300)}`,
  }));
}

function dasAprovadas(pautas = [], { max = 6 } = {}) {
  return (pautas || []).filter((p) => !p.usada && p.origem?.tipo !== 'prova').slice(0, max).map((p) => ({
    chave: `pc:${p.id}`, fonte: 'aprovada', titulo: limpo(p.ideia || p.texto, 90), evidencia: p.origem?.tipo === 'estrategia_criativa' ? 'Você aprovou este ângulo na Estratégia criativa.' : 'Você mandou este comentário virar pauta.', forca: 100, pauta: null, ja_na_fila: true,
  }));
}

// Junta tudo, tira o que já virou roteiro e o que é assunto repetido, e não deixa uma fonte só dominar o topo.
function montar({ analise = null, virais = [], perguntas = [], aprovadas = [], usadas = new Set(), agora = Date.now(), max = 12 } = {}) {
  const todas = [...dasAprovadas(aprovadas), ...dosVencedores(analise, { agora }), ...dosVirais(virais, { agora }), ...dasPerguntas(perguntas)].filter((x) => !usadas.has(x.chave)).sort((a, b) => b.forca - a.forca);
  const out = []; const porFonte = {};
  for (const x of todas) {
    if (out.some((y) => parecidos(y.titulo, x.titulo))) continue;
    if (out.length < 6 && (porFonte[x.fonte] || 0) >= 2 && x.fonte !== 'aprovada' && todas.some((y) => y.fonte !== x.fonte && !out.includes(y))) { (porFonte._espera ||= []).push(x); continue; }
    porFonte[x.fonte] = (porFonte[x.fonte] || 0) + 1; out.push({ ...x, rotulo_fonte: FONTES[x.fonte] });
  }
  for (const x of porFonte._espera || []) if (out.length < max && !out.some((y) => parecidos(y.titulo, x.titulo))) out.push({ ...x, rotulo_fonte: FONTES[x.fonte] });
  return out.slice(0, max);
}

// O que os números do perfil mandam o roteirista seguir (só com amostra; sem dado, nada entra no prompt).
function dnaDosVencedores(analise) {
  if (!analise || (analise.maduros || 0) < 12) return '';
  const L = [];
  for (const p of (analise.padroes?.repetir || []).slice(0, 4)) L.push(`- Funciona: ${p.texto}`);
  for (const p of (analise.padroes?.parar || []).slice(0, 3)) L.push(`- Não funciona: ${p.texto}`);
  if (analise.retencao?.pulou_3s_pct != null && analise.retencao.n_pulou >= 5) L.push(`- ${analise.retencao.pulou_3s_pct}% das visualizações dos Reels saem antes de 3 segundos: a primeira frase precisa dizer o assunto e a promessa.`);
  if (analise.geral?.coment_mil != null && analise.geral.coment_mil < 0.5) L.push('- Quase ninguém comenta: termine com uma pergunta de escolha (A ou B) ligada à opinião do Pedro.');
  return L.length ? `O QUE OS NÚMEROS REAIS DESTE PERFIL MOSTRAM (medido nos posts publicados; use como direção):\n${L.join('\n')}` : '';
}

// Plano de volume recomendado a partir do Raio-X: linha que rende abaixo do perfil sai; as outras ficam em 1 por dia;
// 3 roteiros de vídeo por dia para o Pedro escolher. Só devolve a proposta: quem aplica é o Pedro, com um toque.
function planoRecomendado(analise, mixAtual = {}) {
  const fracas = new Set((analise?.achados || []).filter((a) => a.mix).map((a) => a.mix));
  const mix = {}; const motivos = [];
  for (const k of ['frase', 'noticia', 'marca', 'revelacao']) {
    const atual = Number(mixAtual[k]) || 0;
    if (fracas.has(k)) { mix[k] = 0; if (atual > 0) motivos.push(`${k}: de ${atual} para 0 (rende abaixo do perfil no Raio-X)`); } else { mix[k] = Math.min(atual, 1); if (atual > 1) motivos.push(`${k}: de ${atual} para 1 por dia`); }
  }
  if (!Object.values(mix).some((v) => v > 0)) { mix.marca = 1; motivos.push('marca: 1 por dia (o piloto precisa de pelo menos uma linha ligada)'); }
  return { mix, roteiros_dia: 3, motivos, com_dado: !!analise && (analise.maduros || 0) >= 12 };
}

// Análise do último Raio-X guardado (lido pelo Pedro na aba Raio-X). Sem leitura guardada: null (nada é inventado).
async function analiseGuardada({ deps = {} } = {}) {
  if (deps.analise !== undefined) return deps.analise;
  const { armazem } = require('./armazem'); const { ACCOUNT } = require('./account');
  const a = armazem(); if (!a?.duravel) return null;
  const doc = (await a.radar.obter(ACCOUNT.ig_id, 'raio_x', 'ultimo'))?.doc; if (!doc?.posts?.length) return null;
  return require('./raioXAnalise').analisar({ posts: doc.posts, conta: doc.conta || null, agora: Date.parse(doc.gerado_em) });
}

module.exports = { analiseGuardada, FONTES, dosVencedores, dosVirais, dasPerguntas, dasAprovadas, montar, dnaDosVencedores, planoRecomendado, parecidos };
