// Plano visual do formato "Destrava" (editor de vídeo, tools/reels/lib_destrava.py): para cada frase falada, a cena que
// ilustra o SENTIDO dela — nome da ideia no título, tipo de cena e a busca da imagem em inglês. Antes, o editor
// escolhia por uma palavra solta ("americana" trazia uma estrela com a bandeira dos EUA numa frase sobre uma designer
// de joias, e o título da cena era só "Americana").
//
// Custo: uma chamada de IA GRATUITA por vídeo (pago: 'nunca'), guardada no documento do vídeo; refazer o mesmo vídeo
// não chama de novo. Sem IA ou com resposta ruim, o editor segue com as regras automáticas (nada trava a edição).
// Quem chama: o editor no GitHub Actions, por POST /api/videos/worker/plano (token OIDC do runner ou CRON_SECRET).
const crypto = require('crypto');
const llmJson = require('../llmJson');

const TIPOS = ['imagem', 'numero', 'lista', 'comparacao', 'grafico', 'frase', 'rosto', 'broll', 'icone', 'fim'];
const ICONES = ['dinheiro', 'seta', 'x', 'alvo', 'lampada', 'check', 'relogio', 'estrela', 'pergunta', 'cadeado', 'pessoa', 'grafico'];
const ROTULOS = ['LIÇÃO', 'REGRA', 'VERDADE', 'ERRO', 'SEGREDO', 'DICA'];
const MAX_FRASES = 60;

const limpa = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hashDe = (titulo, frases) => crypto.createHash('sha1').update(`${titulo}\n${frases.join('\n')}`).digest('hex').slice(0, 16);

const SISTEMA = `Você é o diretor de arte dos Reels do @pedro_destrava (empreendedorismo para dono de pequena empresa).
O formato: fundo escuro, um gráfico animado na parte de cima e o Pedro falando numa janela embaixo, legenda de uma palavra.
Para CADA frase, escolha a cena que ilustra o SENTIDO da frase (não uma palavra solta dela). Tipos:
- imagem: vídeo de banco (Pexels) numa moldura. Para algo concreto: objeto, lugar, profissão, ação, cena do dia a dia.
  "busca" = 2 a 4 palavras EM INGLÊS, concretas e filmáveis (ex.: "jewelry designer workshop", "empty cash register", "small shop owner counting money"). Nada abstrato ("success", "freedom", "growth").
- numero: a frase diz um número, valor, porcentagem ou ano. "destaque" = o número como foi dito (ex.: "R$ 2 milhões", "70%", "2012").
- lista: a frase enumera 2 a 4 coisas. "itens" = rótulos curtos (até 4 palavras cada), na ordem em que são ditos.
- comparacao: a frase opõe duas coisas (A em vez de B, A x B, antes x depois). "esquerda" = o lado ruim/antigo, "direita" = o lado bom/novo (até 3 palavras cada).
- grafico: a frase fala de crescer, cair, acumular, evoluir. "direcao" = "sobe" ou "desce"; "rotulo" opcional (até 3 palavras).
- frase: frase de efeito, lição, regra ou verdade forte (até 20 palavras). "rotulo" = LIÇÃO, REGRA, VERDADE, ERRO, SEGREDO ou DICA.
- rosto: frase pessoal, emocional ou de ênfase curta: close no rosto do Pedro, sem gráfico. Use poucas vezes.
- broll: cena forte em tela cheia (no máximo 1 a cada 15 segundos), com "busca" em inglês.
- icone: ideia abstrata sem número nem objeto concreto. "icone" = um de: ${ICONES.join(', ')}.
- fim: só a última frase, se for a chamada final (salva, comenta, manda para alguém).
Para todas as cenas: "titulo" = o NOME DA IDEIA em 1 a 3 palavras (ex.: "Sem investidor", "Lucro paga tudo", "2 pilares", "Dono do estoque"); nunca uma palavra solta sem sentido sozinha; não repita título.
"rotulo" na imagem (opcional): até 3 palavras que ACRESCENTAM informação (um nome, um ano, um número), nunca repetindo o título.
Regras: a 1ª frase é a abertura: tipo "imagem" com uma "busca" que represente o tema do vídeo inteiro. Varie os tipos (não repita o mesmo tipo 3 vezes seguidas). Não invente número que a frase não diz.
Responda APENAS JSON: {"cenas":[{"i":0,"tipo":"imagem","titulo":"","busca":"","rotulo":"","destaque":"","itens":[],"esquerda":"","direita":"","direcao":"","icone":""}]} com exatamente uma cena por frase, na mesma ordem.`;

function usuario({ titulo, frases }) {
  return `TÍTULO DO VÍDEO: ${limpa(titulo, 140) || '(sem título)'}\nFRASES (uma cena por frase, na ordem):\n${frases.map((f, i) => `${i}. ${f}`).join('\n')}`;
}

// Só o que o editor sabe desenhar, com tamanhos que cabem na tela. Cena estranha vira {} (o editor decide sozinho).
function normalizarCena(c, frase) {
  if (!c || typeof c !== 'object' || !TIPOS.includes(c.tipo)) return {};
  const out = { tipo: c.tipo };
  const titulo = limpa(c.titulo, 28); if (titulo && titulo.split(' ').length <= 4) out.titulo = titulo;
  const busca = limpa(c.busca, 60).replace(/[^A-Za-z0-9 '-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (busca && busca.split(' ').length >= 1 && busca.split(' ').length <= 6) out.busca = busca;
  const rotulo = limpa(c.rotulo, 24); if (rotulo && rotulo.split(' ').length <= 4) out.rotulo = rotulo;
  if (c.tipo === 'numero') {
    const d = limpa(c.destaque, 16);
    // o número precisa estar na frase (a IA não inventa número na tela)
    const digitos = (d.match(/\d+/g) || []);
    if (d && digitos.length && digitos.every((n) => String(frase || '').replace(/\./g, '').includes(n))) out.destaque = d; else return { tipo: 'icone', ...(out.titulo ? { titulo: out.titulo } : {}) };
  }
  if (c.tipo === 'lista') {
    const itens = (Array.isArray(c.itens) ? c.itens : []).map((x) => limpa(x, 40)).filter(Boolean).slice(0, 4);
    if (itens.length >= 2) out.itens = itens; else return out.titulo ? { tipo: 'icone', titulo: out.titulo } : {};
  }
  if (c.tipo === 'comparacao') {
    const e = limpa(c.esquerda, 28); const d = limpa(c.direita, 28);
    if (e && d) { out.esquerda = e; out.direita = d; } else return out.titulo ? { tipo: 'icone', titulo: out.titulo } : {};
  }
  if (c.tipo === 'grafico') out.direcao = c.direcao === 'desce' ? 'desce' : 'sobe';
  if (c.tipo === 'frase') { const r = limpa(c.rotulo, 12).toUpperCase(); if (ROTULOS.includes(r)) out.rotulo = r; else delete out.rotulo; }
  if (c.tipo === 'icone' && ICONES.includes(c.icone)) out.icone = c.icone;
  if ((c.tipo === 'imagem' || c.tipo === 'broll') && !out.busca) return out.titulo ? { tipo: 'icone', titulo: out.titulo } : {};
  return out;
}

function normalizarPlano(d, frases) {
  const lista = Array.isArray(d?.cenas) ? d.cenas : [];
  const porIndice = new Map();
  lista.forEach((c, k) => { const i = Number.isInteger(c?.i) ? c.i : k; if (i >= 0 && i < frases.length && !porIndice.has(i)) porIndice.set(i, c); });
  const cenas = frases.map((f, i) => normalizarCena(porIndice.get(i), f));
  // títulos repetidos: fica o primeiro
  const vistos = new Set();
  for (const c of cenas) { const k = (c.titulo || '').toLowerCase(); if (!k) continue; if (vistos.has(k)) delete c.titulo; else vistos.add(k); }
  const uteis = cenas.filter((c) => c.tipo).length;
  return { cenas, uteis };
}

async function gerar({ titulo, frases }, { pedir } = {}) {
  const chamar = pedir || ((args) => llmJson.comPrazo(45000, () => llmJson.pedirJson(args)));
  const { dados, llm } = await chamar({ sistema: SISTEMA, usuario: usuario({ titulo, frases }), maxTokens: Math.min(3500, 300 + frases.length * 110), temperatura: 0.4, pago: 'nunca', etapa: 'plano_video', preferirMelhor: true });
  const p = normalizarPlano(dados, frases);
  return { ...p, ia: llm?.provider || null };
}

// Plano do vídeo `id`: devolve o guardado se as frases são as mesmas; senão gera e guarda no documento.
async function planoDoVideo(id, { titulo, frases } = {}, { deps = {} } = {}) {
  const fr = (Array.isArray(frases) ? frases : []).map((f) => limpa(f, 400)).filter(Boolean).slice(0, MAX_FRASES);
  if (!fr.length) throw Object.assign(new Error('Envie as frases do vídeo.'), { status: 400, code: 'ENTRADA' });
  const tit = limpa(titulo, 140);
  const hash = hashDe(tit, fr);
  const V = deps.V || require('./index');
  let reg = null;
  if (id) { try { reg = await V._ler(id); } catch { reg = null; } }
  const salvo = reg?.doc?.video?.plano;
  if (salvo && salvo.hash === hash && Array.isArray(salvo.cenas) && salvo.cenas.length === fr.length) return { cenas: salvo.cenas, fonte: 'guardado' };
  if (!deps.pedir && !llmJson.hasLlmKey()) throw Object.assign(new Error('Nenhuma IA gratuita configurada no servidor.'), { status: 503, code: 'SEM_IA' });
  const p = await gerar({ titulo: tit, frases: fr }, { pedir: deps.pedir });
  if (p.uteis < Math.ceil(fr.length / 3)) throw Object.assign(new Error('A IA devolveu um plano vazio.'), { status: 502, code: 'PLANO_VAZIO' });
  if (reg) {
    try { reg.doc.video.plano = { hash, cenas: p.cenas, ia: p.ia, em: new Date().toISOString() }; await V._gravar(reg.doc, reg.rev); } catch { /* conflito de revisão: o plano volta mesmo assim */ }
  }
  return { cenas: p.cenas, fonte: p.ia || 'ia' };
}

module.exports = { SISTEMA, TIPOS, ICONES, normalizarCena, normalizarPlano, gerar, planoDoVideo, hashDe, usuario };
