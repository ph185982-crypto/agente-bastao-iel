// Carrossel "top" do @pedro_destrava: notícia com tese, no visual da referência (marinho/amarelo/vermelho, foto real em P&B).
// Etapas retomáveis (cada chamada de `passo` cabe no limite da função):
//   ler → fatos → angulo → roteiro (2 versões) → juri → foto → arte (slide a slide) → fim
// A IA escreve; o CÓDIGO confere (checagem.js): trecho de cada fato tem de estar na matéria, todo número do carrossel tem de
// ser de um fato conferido. O júri dá nota e escolhe; abaixo da régua o carrossel não vai para a aprovação.
// No fim vira um conteúdo da Mesa "Para aprovar" (status em_revisao): o Pedro aprova e o fluxo de publicação existente publica.
// Nada é publicado aqui.
const crypto = require('crypto');
const M = require('../../../static/contentModel');
const llmJson = require('../llmJson');
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');
const P = require('./prompts');
const K = require('./checagem');

const conta = () => ACCOUNT.ig_id;
const agoraISO = () => new Date().toISOString();
const erro = (msg, code, status = 400) => Object.assign(new Error(msg), { code, status });
const ETAPAS = ['ler', 'fatos', 'angulo', 'roteiro', 'juri', 'foto', 'arte', 'fim'];
const ROTULO = { ler: 'Lendo a matéria', fatos: 'Separando os fatos e conferindo na matéria', angulo: 'Testando se a pauta vale (teste do grupo)', roteiro: 'Escrevendo as versões', juri: 'Júri escolhendo a melhor', foto: 'Buscando foto real com licença', arte: 'Desenhando os slides', fim: 'Pronto para aprovar' };
// nucleo_min: bolso OU contradição precisa pesar (número e personagem sozinhos dão post de cotação, não de tese).
const REGUA = { gatilhos_min: 5, nota_min: 7.5, nucleo_min: 2 };
const LEASE_MS = 70000; const MAX_TENTATIVAS = 3;

function regua() {
  const n = Number(process.env.TOP_NOTA_MINIMA); const g = Number(process.env.TOP_GATILHOS_MINIMO);
  return { nota_min: Number.isFinite(n) && n > 0 ? n : REGUA.nota_min, gatilhos_min: Number.isFinite(g) && g >= 0 ? g : REGUA.gatilhos_min, nucleo_min: REGUA.nucleo_min };
}

async function vozDoPedro() {
  // Legendas reais dos posts que mais foram compartilhados (painel Resultados). Sem painel, segue sem exemplos.
  try {
    const cfg = await armazem().config.obter(conta());
    const posts = (cfg.meu_instagram?.posts || []).filter((p) => !p.da_ferramenta && String(p.legenda || '').length > 80 && p.alcance);
    return posts.map((p) => ({ p, envios: (p.compartilhamentos || 0) / p.alcance }))
      .sort((a, b) => b.envios - a.envios).slice(0, 5).map(({ p }) => String(p.legenda).replace(/\s+/g, ' ').slice(0, 420));
  } catch { return []; }
}

// ── Criação ─────────────────────────────────────────────────────────────────────
async function criar({ url = null, texto = null, titulo = '', origem = 'manual' } = {}) {
  const a = armazem(); if (!a?.duravel) throw erro('O carrossel precisa do banco de dados no servidor.', 'SEM_BANCO', 503);
  const u = url ? require('../radar/pauta').urlValida(url) : null;
  if (url && !u) throw erro('Link inválido.', 'LINK_INVALIDO');
  if (!u && String(texto || '').trim().length < 300) throw erro('Envie o link da matéria ou cole um texto com pelo menos 300 caracteres.', 'ENTRADA');
  const c = M.novoConteudo({ titulo: String(titulo || '').slice(0, 140) || 'Carrossel em preparação', origem: u ? { tipo: 'link', url: u } : { tipo: 'texto' } });
  c.top = { versao_motor: 1, estado: 'em_andamento', etapa: 'ler', origem, entrada: { url: u, texto: u ? null : String(texto).slice(0, 30000) }, tentativas: {}, erros: [], criado_em: agoraISO() };
  await a.conteudos.salvar(conta(), c.id, c, 0);
  return c;
}

// ── Etapas ──────────────────────────────────────────────────────────────────────
const E = {};
E.ler = async (c, ctx) => {
  const f = await (ctx.deps.lerFonte || require('../research').lerFonte)({ url: c.top.entrada.url, texto: c.top.entrada.texto });
  if (!f?.legivel) throw Object.assign(erro(f?.acesso === 'negado' ? 'O site recusou a leitura automática. Cole o texto da matéria.' : 'A matéria não tem texto legível.', 'LINK_ILEGIVEL', 422), { terminal: true });
  c.fonte_principal = { tipo: f.tipo, url: f.url_final || f.url || null, titulo: f.titulo || '', veiculo: f.veiculo || '', publicada_em: f.publicada_em || null, texto: String(f.texto || '').slice(0, 30000), acessada_em: f.acessada_em || agoraISO() };
  if (f.titulo) c.titulo = String(f.titulo).slice(0, 140);
};

E.fatos = async (c, ctx) => {
  const d = llmJson.dado('MATERIA', `${c.fonte_principal.titulo}\n\n${c.fonte_principal.texto}`, 18000);
  const { dados } = await ctx.ia({ sistema: `${P.FATOS}\n\n${llmJson.REGRAS_DADOS}`, usuario: d.bloco, maxTokens: 2600, temperatura: 0.1 });
  const r = K.verificarFatos(dados?.fatos, c.fonte_principal.texto);
  // A manchete lida da página também é fato do veículo: o número dela (ex.: "CBS em 11,3%") às vezes não volta da extração.
  const manchete = String(c.fonte_principal.titulo || '').trim(); const nManchete = M.extrairNumeros(manchete).filter(M.exigeOrigem).map((n) => n.valor);
  if (nManchete.length && !r.fatos.some((f) => f.trecho === manchete)) r.fatos.push({ id: `f${r.fatos.length + 1}`, id_ia: 'manchete', texto: manchete.slice(0, 400), trecho: manchete.slice(0, 600), tipo: 'fato', quem: null, valores: M.extrairNumeros(manchete).map((n) => n.valor), origem: 'manchete' });
  c.top.fatos = r.fatos; c.top.fatos_descartados = r.descartados.slice(0, 12);
  c.top.protagonista = dados?.protagonista ? String(dados.protagonista).slice(0, 80) : null;
  if (r.fatos.length < 2) throw Object.assign(erro('A matéria não tem fatos suficientes que deu para conferir palavra por palavra.', 'SEM_FATOS', 422), { terminal: true, fim: 'descartada' });
};

E.angulo = async (c, ctx) => {
  const { dados } = await ctx.ia({ sistema: P.ANGULO, usuario: `TÍTULO: ${c.fonte_principal.titulo}\nVEÍCULO: ${c.fonte_principal.veiculo}\nFATOS VERIFICADOS:\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}`, maxTokens: 700, temperatura: 0.3, preferirMelhor: true });
  const g = dados?.gatilhos || {}; const n = (k) => Math.max(0, Math.min(3, Number(g[k]) || 0));
  c.top.angulo = { gatilhos: { contradicao: n('contradicao'), bolso: n('bolso'), numero: n('numero'), personagem: n('personagem') }, tese: String(dados?.tese || '').slice(0, 260), por_que_mandaria: String(dados?.por_que_mandaria || '').slice(0, 240), risco: String(dados?.risco || '').slice(0, 240), imagem: { busca: String(dados?.imagem?.busca || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().slice(0, 80), pessoa_central: dados?.imagem?.pessoa_central === true, lugar_brasil: dados?.imagem?.lugar_brasil ? String(dados.imagem.lugar_brasil).slice(0, 80) : null } };
  c.top.angulo.soma = Object.values(c.top.angulo.gatilhos).reduce((x, y) => x + y, 0);
  const nucleo = Math.max(c.top.angulo.gatilhos.bolso, c.top.angulo.gatilhos.contradicao);
  if (c.top.angulo.soma >= regua().gatilhos_min && c.top.angulo.tese && nucleo < regua().nucleo_min) throw Object.assign(erro(`Sem bolso nem contradição (máximo ${nucleo}/3; mínimo ${regua().nucleo_min}): vira post de cotação, não de tese.`, 'PAUTA_FRACA', 422), { terminal: true, fim: 'descartada' });
  if (c.top.angulo.soma < regua().gatilhos_min || !c.top.angulo.tese) throw Object.assign(erro(`Não passou no teste do grupo (${c.top.angulo.soma}/12 nos gatilhos; mínimo ${regua().gatilhos_min}).`, 'PAUTA_FRACA', 422), { terminal: true, fim: 'descartada' });
};

E.roteiro = async (c, ctx) => {
  c.top.versoes ||= [];
  const voz = c.top.voz || (c.top.voz = await vozDoPedro());
  const fatos = `FATOS VERIFICADOS (fonte: ${c.fonte_principal.veiculo}${c.fonte_principal.publicada_em ? `, ${String(c.fonte_principal.publicada_em).slice(0, 10)}` : ''}):\n${c.top.fatos.map((f) => `${f.id} [${f.tipo}${f.quem ? `, ${f.quem}` : ''}]: ${f.texto}`).join('\n')}`;
  while (c.top.versoes.length < 2 && ctx.restante() > 22000) {
    const anterior = c.top.versoes[c.top.versoes.length - 1];
    const feedback = anterior && !anterior.checagem.ok ? anterior.checagem.problemas.slice(0, 8).join('\n') : '';
    const { dados } = await ctx.ia({ sistema: P.roteiro({ voz, tese: c.top.angulo.tese, porQue: c.top.angulo.por_que_mandaria, feedback }), usuario: `${fatos}\n\nTÍTULO DA MATÉRIA: ${c.fonte_principal.titulo}`, maxTokens: 3800, temperatura: c.top.versoes.length ? 0.85 : 0.6, preferirMelhor: true });
    const v = normalizarRoteiro(dados);
    // Data também sai: o portão de publicação trata "27/10/2026" como número que precisa de fonte.
    const DATA = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2} de (?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;
    const limparFrases = (txt) => String(txt || '').split(/(?<=[.!?])\s+/).filter((f) => !K.numerosSemFonte(f, c.top.fatos).length && !DATA.test(f)).join(' ').trim();
    v.legenda = limparFrases(v.legenda); v.cta_motivo = K.numerosSemFonte(v.cta_motivo, c.top.fatos).length ? '' : v.cta_motivo;
    v.fechamento = { titulo: K.numerosSemFonte(v.fechamento.titulo, c.top.fatos).length ? '' : v.fechamento.titulo, texto: limparFrases(v.fechamento.texto).replace(/eu comecei o pedro destrava por isso\.?/i, '').trim() };
    v.checagem = K.checarRoteiro({ ...v, capa: v.capas[0]?.texto || '', telas: [...v.telas], legenda: `${v.legenda}\n${v.fechamento.titulo}\n${v.fechamento.texto}\n${v.cta_motivo}` }, c.top.fatos);
    // capas com número fora dos fatos saem da lista (não derrubam a versão inteira)
    v.capas = v.capas.filter((k) => K.checarRoteiro({ capa: k.texto, telas: v.telas, legenda: '' }, c.top.fatos).problemas.every((p) => !p.startsWith('capa')));
    c.top.versoes.push(v);
  }
  if (c.top.versoes.length < 2) return { concluida: false };
  if (!c.top.versoes.some((v) => v.checagem.ok && v.capas.length)) {
    c.top.reescritas = (c.top.reescritas || 0) + 1;
    if (c.top.reescritas > 2) throw Object.assign(erro(`As versões não passaram na checagem: ${c.top.versoes[1].checagem.problemas.slice(0, 2).join(' ')}`, 'CHECAGEM', 422), { terminal: true, fim: 'abaixo_da_regua' });
    c.top.versoes = c.top.versoes.slice(-1); return { concluida: false };
  }
};

// Campo vazio, "null" ou só códigos internos ("f1,f2") não vai para a arte.
function limpaCampo(v, n) {
  const x = String(v ?? '').trim();
  if (!x || /^(null|none|n\/a|-)$/i.test(x) || /^\s*\[?\s*[a-z]?\d+(\s*[,;]\s*[a-z]?\d+)*\s*\]?\s*$/i.test(x) || /^(f\d+[\s,;]*)+$/i.test(x)) return null;
  return x.slice(0, n);
}

// Tira referências internas que a IA às vezes escreve no texto: "(f1)", "[f2, f3]", "f1,f2".
const semIds = (x) => (x == null ? x : String(x).replace(/\s*[\[(]\s*f\d+(?:\s*[,;]\s*f\d+)*\s*[\])]/gi, '').replace(/\s{2,}/g, ' ').trim());
// "Segue o @pedro_destrava" já é fixo na faixa: o motivo vem sem repetir a chamada.
const semChamada = (x) => String(x || '').replace(/^\s*(segue|siga)\s+(o\s+)?@?pedro_destrava[\s,:–-]*/i, '').trim();

function normalizarRoteiro(d) {
  const capas = (Array.isArray(d?.capas) ? d.capas : []).map((k) => ({ texto: String(k?.texto || k || '').replace(/\s+/g, ' ').trim().slice(0, 140), mecanismo: String(k?.mecanismo || '').slice(0, 40) })).filter((k) => k.texto && K.palavras(k.texto) <= 14).slice(0, 10);
  const LAY = ['rep_manchete', 'rep_comparacao', 'rep_numero'];
  const telas = (Array.isArray(d?.telas) ? d.telas : []).slice(0, 7).map((t) => ({
    papel: ['gap', 'prova', 'contradicao', 'consequencia', 'leitura'].includes(t?.papel) ? t.papel : 'gap',
    layout: LAY.includes(t?.layout) ? t.layout : 'rep_manchete',
    titulo: t?.titulo ? semIds(String(t.titulo)).slice(0, 90) : null, texto: t?.texto ? semIds(String(t.texto)).slice(0, 320) : null,
    destaque: limpaCampo(t?.destaque, 80), apoio: limpaCampo(t?.apoio, 200),
    dados: t?.dados && typeof t.dados === 'object' ? limpaDados(t.dados) : null, fatos: Array.isArray(t?.fatos) ? t.fatos.map(String).slice(0, 6) : [],
  })).filter((t) => t.titulo || t.texto || t.dados).map(repararTela);
  return { capas, telas, legenda: semIds(String(d?.legenda || '')).slice(0, 900), hashtags: (Array.isArray(d?.hashtags) ? d.hashtags : []).map((h) => `#${String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2).slice(0, 3), cta_motivo: semChamada(semIds(d?.cta_motivo)).slice(0, 90), fechamento: { titulo: semIds(String(d?.fechamento?.titulo || '')).slice(0, 70), texto: semIds(String(d?.fechamento?.texto || '')).slice(0, 200) } };
}
// Conserta por código o que dá para consertar sem inventar: tela de número sem número e comparação sem os dois lados
// viram manchete (o texto continua; o desenho muda). Assim um detalhe de formato não derruba a versão inteira.
function repararTela(t) {
  if (t.layout === 'rep_numero' && !t.dados?.numero?.valor) return { ...t, layout: 'rep_manchete', dados: null };
  if (t.layout === 'rep_comparacao') {
    const tem = (l) => !!(l?.valor && /\d/.test(l.valor));
    const e = tem(t.dados?.esquerda); const d = tem(t.dados?.direita);
    // comparação só vale com número dos dois lados; com um só, vira "número gigante"; sem nenhum, manchete
    if (!e && !d) return { ...t, layout: 'rep_manchete', dados: null };
    if (!e || !d) { const l = e ? t.dados.esquerda : t.dados.direita; return { ...t, layout: 'rep_numero', dados: { numero: { valor: String(l.valor).slice(0, 16), rotulo: String(l.rotulo || t.titulo || '').slice(0, 22) } } }; }
  }
  if (t.layout === 'rep_manchete' && t.dados && !t.dados.numero && !t.dados.esquerda) return { ...t, dados: null };
  return t;
}

function limpaDados(d) {
  const curto = (v, n) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  // texto de apoio cortado em palavra inteira (nunca "não ligad", "de varej")
  const palavra = (v, n) => { const t = curto(v, 400); if (t.length <= n) return t; return t.slice(0, n + 1).replace(/\s+\S*$/, '').replace(/[,;:\-–]+$/, '').trim(); };
  const lado = (l) => (l && l.valor ? { rotulo: palavra(l.rotulo, 18), valor: curto(l.valor, 14), ...(l.unidade ? { unidade: palavra(l.unidade, 26) } : {}) } : null);
  // rótulo cortado em palavra inteira, sem parêntese aberto pela metade
  const rotulo = (v) => { let r = curto(v, 60); if (r.length > 22) { r = r.slice(0, 23).replace(/\s+\S*$/, ''); } return r.replace(/\s*\([^)]*$/, '').trim(); };
  if (d.numero) { const n = typeof d.numero === 'object' ? d.numero : { valor: d.numero, rotulo: d.rotulo }; return { numero: { valor: curto(n.valor, 16), rotulo: rotulo(n.rotulo) } }; }
  const out = { esquerda: lado(d.esquerda), direita: lado(d.direita), tom: d.tom === 'alerta' ? 'alerta' : 'neutro' };
  if (d.faixa?.valor) out.faixa = { valor: curto(d.faixa.valor, 32), ...(d.faixa.texto ? { texto: palavra(d.faixa.texto, 30) } : {}) };
  return out;
}

E.juri = async (c, ctx) => {
  const vs = c.top.versoes;
  const usuario = `FATOS VERIFICADOS:\n${c.top.fatos.map((f) => `${f.id}: ${f.texto}`).join('\n')}\n\n` + vs.map((v, i) => `VERSÃO ${i}${v.checagem.ok ? '' : ' (reprovada na checagem: ' + v.checagem.problemas.slice(0, 2).join(' ') + ')'}\nCAPAS:\n${v.capas.map((k, j) => `  [${j}] ${k.texto}`).join('\n')}\nTELAS:\n${v.telas.map((t, j) => `  ${j + 2}. (${t.papel}) ${[t.titulo, t.texto, t.destaque, t.dados ? JSON.stringify(t.dados) : ''].filter(Boolean).join(' | ')}`).join('\n')}\nLEGENDA: ${v.legenda}`).join('\n\n');
  const { dados } = await ctx.ia({ sistema: P.JURI, usuario, maxTokens: 900, temperatura: 0.1, preferirMelhor: true });
  const notas = Array.isArray(dados?.versoes) ? dados.versoes : [];
  let melhor = -1; let nota = -1;
  vs.forEach((v, i) => {
    const j = notas.find((x) => Number(x.indice) === i) || notas[i] || {};
    const hon = Number(j.notas?.honestidade);
    v.juri = { notas: j.notas || {}, nota: Math.max(0, Math.min(10, Number(j.nota) || 0)), defeito: String(j.defeito || '').slice(0, 200) };
    // Veto: afirmação além dos fatos (ex.: chamar de "novo imposto" o que os fatos não dizem que é novo) derruba a versão.
    if (Number.isFinite(hon) && hon < 7) { v.juri.nota = Math.min(v.juri.nota, hon); v.juri.defeito = `Honestidade ${hon}: ${String(j.honestidade_motivo || v.juri.defeito || 'afirma mais do que os fatos sustentam')}`.slice(0, 220); }
    if (v.checagem.ok && v.capas.length && v.juri.nota > nota) { nota = v.juri.nota; melhor = i; }
  });
  if (melhor < 0) throw Object.assign(erro('Nenhuma versão passou na checagem.', 'CHECAGEM', 422), { terminal: true, fim: 'abaixo_da_regua' });
  const v = vs[melhor];
  const esc = (Array.isArray(dados?.capas_escolhidas) ? dados.capas_escolhidas : [0, 1]).map(Number).filter((n) => n >= 0 && n < v.capas.length);
  c.top.escolha = { versao: melhor, nota, capas: [...new Set([...esc, 0, 1])].filter((n) => n < v.capas.length).slice(0, 2), defeito: v.juri.defeito };
  if (nota < regua().nota_min) {
    c.top.reprovacoes_juri = (c.top.reprovacoes_juri || 0) + 1;
    if (c.top.reprovacoes_juri > 1) throw Object.assign(erro(`O júri deu ${nota.toFixed(1)} (mínimo ${regua().nota_min}). Defeito: ${v.juri.defeito || 'sem detalhe'}`, 'ABAIXO_DA_REGUA', 422), { terminal: true, fim: 'abaixo_da_regua' });
    // mais uma rodada de roteiro com o defeito apontado
    c.top.reescritas = 0;
    c.top.versoes = [{ ...v, checagem: { ok: false, problemas: [`O júri deu ${nota.toFixed(1)}: ${v.juri.defeito}`] } }];
    return { voltar: 'roteiro' };
  }
};

// Foto da CAPA, nesta ordem: a PESSOA central (Wikimedia Commons, licença aberta); o LUGAR/instituição brasileira
// (Commons, foto real: plenário do Senado, STF…); a CENA ilustrativa ligada ao assunto (Pexels). Uma foto só, na capa.
E.foto = async (c, ctx) => {
  const lugar = c.top.angulo?.imagem?.lugar_brasil;
  if (lugar && !c.top.foto_lugar_id && !(c.top.protagonista && c.top.angulo?.imagem?.pessoa_central === true)) {
    try {
      const f = await (ctx.deps.fotoDe || require('./fotos').fotoDe)(lugar, { modo: 'lugar' });
      if (f) { await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg'); c.imagens = [...(c.imagens || []).filter((i) => i.id !== f.meta.id), f.meta]; c.top.foto_lugar_id = f.meta.id; }
    } catch { /* segue para a cena */ }
  }
  // Instituição brasileira sem foto real disponível: capa tipográfica. Banco de imagens traria um parlamento estrangeiro.
  if (!lugar && !c.top.foto_lugar_id && !c.top.fotos_cena && (ctx.deps.buscarFoto || process.env.PEXELS_API_KEY)) {
    c.top.fotos_cena = [];
    try {
      const FS = require('../fotosStudio');
      // a busca específica do ângulo primeiro; a genérica só se ela falhar (nunca foto aleatória de "negócios")
      const consultas = [c.top.angulo?.imagem?.busca, ...(c.top.angulo?.imagem?.busca ? [] : FS.consultasPara(c.titulo || '').slice(0, 1))].filter(Boolean);
      for (const q of consultas) {
        if (c.top.fotos_cena.length >= 1) break;
        try {
          const f = await (ctx.deps.buscarFoto || FS.buscarFoto)(q, { excluir: c.top.fotos_cena });
          await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg');
          c.imagens = [...(c.imagens || []).filter((i) => i.id !== f.meta.id), { ...f.meta, exige_credito: false }];
          c.top.fotos_cena.push(f.meta.id);
        } catch { /* próxima consulta */ }
      }
      c.top.foto_cena_id = c.top.fotos_cena[0] || null;
    } catch { /* sem foto de cena: segue com as formas */ }
  }
  // Foto de pessoa só quando o ângulo confirma que a notícia gira em torno DELA e o nome parece de gente (não "Senado Federal").
  const INSTITUICAO = /\b(senado|c[âa]mara|congresso|supremo|tribunal|minist[ée]rio|governo|banco|prefeitura|assembleia|partido|federal|nacional|empresa|grupo|companhia|ag[êe]ncia)\b/i;
  if (!c.top.protagonista || c.top.angulo?.imagem?.pessoa_central !== true || INSTITUICAO.test(c.top.protagonista)) return;
  try {
    const f = await (ctx.deps.fotoDe || require('./fotos').fotoDe)(c.top.protagonista);
    if (!f) { c.top.aviso_foto = `Não achei foto de ${c.top.protagonista} com licença que permita uso: o carrossel sai só com as formas.`; return; }
    await armazem().arquivos.salvar(conta(), `img:${f.meta.id}`, f.dados, 'image/jpeg');
    c.imagens = [...(c.imagens || []).filter((i) => i.id !== f.meta.id), f.meta];
    c.top.foto_id = f.meta.id;
  } catch (e) { c.top.aviso_foto = `A busca de foto falhou (${String(e.message).slice(0, 80)}): o carrossel sai só com as formas.`; }
};

const MARCA_ATRIBUICAO = /(?<!\p{L})(segundo|de acordo com|conforme|diz|dizem|disse|disseram|afirma|afirmou|declarou|anuncia|anunciou|prev[êe]|estima|promete|prometeu|deve|pode|poder[áa]|aponta|apontam|apontou|avalia|avaliam|alerta|alertam|alertou|calcula|calculam|projeta|projetam|recomenda|recomendam|v[êe]|veem|criticou|critica|criticam|lembrou|lembra|defendeu|defende|defendem|cobrou|cobra|cobram|classificou|classifica|chamou|falou|ressaltou|destacou|explicou|reconheceu|reconhece|argumenta|argumentou|avaliou)(?!\p{L})/iu;
// Monta a versão no modelo de conteúdo (claims, evidências, auditoria) a partir da versão vencedora.
function montarVersao(c) {
  const v = c.top.versoes[c.top.escolha.versao];
  const fonte = c.fonte_principal;
  const data = fonte.publicada_em ? new Date(fonte.publicada_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
  // Sem data na linha de fonte: o portão de publicação trata "29/10/2026" como número sem fonte.
  const linhaFonte = `Fonte: ${fonte.veiculo || 'matéria'}`; void data;
  const porIa = new Map(c.top.fatos.map((f) => [f.id_ia, f.id])); const ids = new Set(c.top.fatos.map((f) => f.id));
  const mapa = (arr) => [...new Set((arr || []).map((x) => (ids.has(x) ? x : porIa.get(x))).filter(Boolean))];
  const numsDe = (txt) => M.extrairNumeros(txt).filter(M.exigeOrigem);
  // Cada número liga ao FATO que o traz; declaração/previsão só quando nenhum fato puro tem aquele número (senão a tela
  // passa a exigir "quem disse" à toa).
  const fatosComNumeros = (txt) => [...new Set(numsDe(txt).flatMap((n) => {
    const cand = c.top.fatos.filter((f) => f.valores.some((x) => M.igual(x, n.valor)));
    const puros = cand.filter((f) => !['declaracao', 'previsao'].includes(f.tipo));
    return (puros.length ? puros : cand).map((f) => f.id);
  }))];
  c.claims = c.top.fatos.map((f) => ({ id: f.id, texto: f.texto, tipo: 'fato', natureza: f.tipo === 'declaracao' ? 'declaracao' : f.tipo === 'previsao' ? 'previsao' : 'fato', central: true, estado: 'sustentada', evidencias: [`e_${f.id}`], valores: f.valores.map((x) => ({ valor: x })), risco: 'baixo', revisao: {}, origem: 'top' }));
  c.evidencias = c.top.fatos.map((f) => ({ id: `e_${f.id}`, tipo: 'secundaria', autoridade: 'imprensa', correspondencia: 'integral', relacao: 'sustenta', trecho: f.trecho, origem: fonte.veiculo || 'matéria', titulo: fonte.titulo, url: fonte.url, consultada_em: fonte.acessada_em, fonte_principal: true }));
  const capa = v.capas[c.top.escolha.capas[0] ?? 0]?.texto || v.capas[0].texto;
  const cenas = c.top.fotos_cena || (c.top.foto_cena_id ? [c.top.foto_cena_id] : []);
  const foto = c.top.foto_id || c.top.foto_lugar_id || cenas[0] || null; // capa: pessoa > lugar > cena
  const internas = []; // telas internas sem foto: o layout de texto fica limpo (foto espremida piorava a leitura)
  const telasTexto = v.telas.map((t, i) => (!['leitura', 'prova'].includes(t.papel) && !['rep_comparacao', 'rep_numero'].includes(t.layout) ? i : -1)).filter((i) => i >= 0);
  const fotoDaTela = new Map(internas.map((id, j) => [telasTexto[j], id]).filter(([i]) => i !== undefined));
  const cena = internas[0] || null;
  const slides = [{ id: 's1', funcao: 'capa', layout: 'rep_capa', tema_visual: 'reportagem', texto: capa, titulo: null, subtitulo: null, claim_ids: fatosComNumeros(capa), ...(foto ? { imagem_id: foto } : {}), dados: null }];
  const opinioes = [];
  v.telas.forEach((t, i) => {
    const funcao = { gap: 'contexto', prova: 'prova', contradicao: 'consequencia', consequencia: 'consequencia', leitura: 'opiniao' }[t.papel] || 'explicacao';
    const texto = [t.texto, t.apoio, t.destaque].filter(Boolean).join(' ');
    let claim_ids = mapa(t.fatos); for (const id of fatosComNumeros(`${t.titulo || ''} ${texto} ${K.textosDaTela({ dados: t.dados })}`)) if (!claim_ids.includes(id)) claim_ids.push(id);
    if (t.papel === 'leitura') { const oid = `o${opinioes.length + 1}`; opinioes.push({ id: oid, texto: [t.titulo, t.texto, t.destaque].filter(Boolean).join(' ').slice(0, 400), tipo: 'opiniao', natureza: 'opiniao', central: false, estado: 'nao_verificada', premissas: claim_ids, evidencias: [], risco: 'baixo', origem: 'top', revisao: {} }); claim_ids = [oid]; }
    const prova = ['rep_comparacao', 'rep_numero'].includes(t.layout);
    // Declaração/previsão apresentada na tela precisa dizer quem disse (portão "Falta a atribuição").
    const aAtribuir = c.top.fatos.find((f) => claim_ids.includes(f.id) && ['declaracao', 'previsao'].includes(f.tipo));
    if (aAtribuir && !MARCA_ATRIBUICAO.test(`${t.titulo || ''} ${texto}`)) t.texto = `Segundo ${aAtribuir.quem || fonte.veiculo || 'a reportagem'}: ${t.texto || ''}`.trim();
    slides.push({ id: `s${i + 2}`, funcao, layout: t.layout, tema_visual: 'reportagem', titulo: t.titulo, texto: t.texto || '', destaque: t.destaque, apoio: t.apoio, dados: t.dados ? { ...t.dados, ...(t.destaque || t.apoio ? { extra: { destaque: t.destaque, apoio: t.apoio } } : {}) } : (t.destaque || t.apoio ? { extra: { destaque: t.destaque, apoio: t.apoio } } : null), fonte_linha: prova ? linhaFonte : null, fundo: t.papel === 'contradicao' ? 'marinho' : null, claim_ids, ...(fotoDaTela.has(i) ? { imagem_id: fotoDaTela.get(i) } : {}) });
  });
  c.claims.push(...opinioes);
  void cena; const creditos = (c.imagens || []).filter((i) => [foto, ...internas].includes(i.id) && i.exige_credito).map((i) => `Foto: ${i.autor} (${i.licenca}), via Wikimedia Commons.`);
  // A data fica na tela de prova; na legenda só o veículo (data solta na legenda vira "número sem fonte" nos portões).
  // Legenda: só frases cujos números estão nos fatos (com a mesma régua do portão, que não perdoa data solta).
  const fraseOk = (f) => numsDe(f).every((n) => c.top.fatos.some((x) => x.valores.some((y) => M.igual(y, n.valor))));
  const corpo = String(v.legenda || '').split(/(?<=[.!?])\s+/).filter(fraseOk).join(' ').trim();
  const legenda = [corpo, `Fonte: ${fonte.veiculo || 'matéria'} (informações segundo a reportagem).`, ...creditos].filter(Boolean).join('\n\n').slice(0, 2000);
  const motivo = (v.cta_motivo || 'se você também cobra resultado').replace(/^[,:\s]+/, '').replace(/[.!]+$/, '');
  const cta = `Segue o @pedro_destrava ${motivo}.`.slice(0, 160);
  // Fechamento no desenho da peça de referência: frase de impacto, posição, "Eu comecei o Pedro Destrava por isso." e a faixa de chamada.
  // Se houver a arte original aprovada (upload:encerramento), ela substitui este slide no desenho (renderizarSlide).
  slides.push({ id: `s${slides.length + 1}`, funcao: 'encerramento', layout: 'encerramento', tema_visual: 'reportagem', titulo: v.fechamento?.titulo || 'O resultado está nos números.', texto: v.fechamento?.texto || '', destaque: 'Eu comecei o Pedro Destrava por isso.', cta: 'Segue o @pedro_destrava', cta_apoio: motivo, claim_ids: fatosComNumeros(`${v.fechamento?.titulo || ''} ${v.fechamento?.texto || ''}`), dados: { extra: { destaque: 'Eu comecei o Pedro Destrava por isso.', cta_apoio: motivo } } });
  return { capas: v.capas.map((k, j) => ({ id: `k${j + 1}`, foco: k.mecanismo || 'gancho', texto: k.texto, claim_ids: fatosComNumeros(k.texto) })), capa_escolhida: 'k' + ((c.top.escolha.capas[0] ?? 0) + 1), estrutura: 'acontecimento', slides, legenda, legenda_claim_ids: fatosComNumeros(legenda), cta, hashtags: v.hashtags };
}

function auditar(c) {
  const v = M.versaoAtiva(c);
  c.auditoria_textos = {};
  for (const s of v.slides) {
    const premissas = (s.claim_ids || []).flatMap((id) => { const k = c.claims.find((q) => q.id === id); return k?.tipo === 'opiniao' ? (k.premissas || []).map((p) => ({ texto: c.claims.find((q) => q.id === p)?.texto || '', claim_id: p })) : [{ texto: k?.texto || '', claim_id: id }]; });
    c.auditoria_textos[s.id] = { slide_id: s.id, hash_texto: M.hash(M.textoParaAuditoria(s)), premissas, conferido_por: 'codigo:top', em: agoraISO() };
  }
  c.auditoria_textos.legenda = { slide_id: 'legenda', hash_texto: M.hash(v.legenda), premissas: (v.legenda_claim_ids || []).map((id) => ({ texto: c.claims.find((q) => q.id === id)?.texto || '', claim_id: id })), conferido_por: 'codigo:top', em: agoraISO() };
}

E.arte = async (c, ctx) => {
  if (!c.top.versao_montada) {
    const dados = montarVersao(c);
    M.criarVersao(c, dados, { quem: 'sistema', rotulo: `top: nota ${c.top.escolha.nota.toFixed(1)}` });
    auditar(c); c.top.versao_montada = M.versaoAtiva(c).id; c.top.arte_indice = 0;
    c.arte = c.arte || { renders: [] }; c.arte.renders = c.arte.renders || [];
  }
  const v = M.versaoAtiva(c); const arte = ctx.deps.arte || require('../arte');
  const enc = (await armazem().arquivos.obter(conta(), 'upload:encerramento'))?.dados || null;
  while (c.top.arte_indice < v.slides.length && ctx.restante() > 9000) {
    const s = v.slides[c.top.arte_indice];
    if (c.arte.renders.some((q) => q.versao === v.id && q.slide_id === s.id && q.texto_hash === M.hashRender(s))) { c.top.arte_indice += 1; continue; }
    const imagem = s.imagem_id ? (await armazem().arquivos.obter(conta(), `img:${s.imagem_id}`))?.dados : null;
    const r = await arte.renderizarSlide(s, { indice: c.top.arte_indice + 1, total: v.slides.length, imagem, arquivoEncerramento: s.layout === 'encerramento' ? enc : null });
    const key = `render:${c.id}:${v.id}:${s.id}:${M.hashRender(s)}`;
    // Prévia em JPEG (~5× menor que PNG): a publicação redesenha o slide a partir do texto, a prévia é só para ver no app.
    const previa = await require('sharp')(r.png).flatten({ background: '#FAF7F0' }).jpeg({ quality: 84 }).toBuffer().catch(() => null);
    await armazem().arquivos.salvar(conta(), key, previa || r.png, previa ? 'image/jpeg' : 'image/png');
    c.arte.renders = [...c.arte.renders.filter((q) => q.versao !== v.id || q.slide_id !== s.id), { slide_id: s.id, versao: v.id, texto_hash: M.hashRender(s), blob_key: key, indice: c.top.arte_indice + 1, total: v.slides.length, metrics: r.metrics, elementos: r.metrics.elementos || [] }];
    c.top.arte_indice += 1;
  }
  if (c.top.arte_indice < v.slides.length) return { concluida: false };
  const naoCabe = c.arte.renders.filter((r) => r.versao === v.id && r.metrics?.cabe === false);
  // Texto que não cabe: uma tentativa de encurtar sem IA (fica a 1ª frase, sai o apoio) e desenhar de novo esses slides.
  if (naoCabe.length && !c.top.encurtado) {
    c.top.encurtado = true;
    const dados = JSON.parse(JSON.stringify(v)); const ids = new Set(naoCabe.map((r) => r.slide_id));
    for (const s of dados.slides) {
      if (!ids.has(s.id)) continue;
      // Número/comparação grande demais para o desenho: vira manchete (o número vai para o título).
      if (s.layout === 'rep_numero' && s.dados?.numero) { s.titulo = `${s.dados.numero.valor} ${s.dados.numero.rotulo || ''}`.trim(); s.layout = 'rep_manchete'; s.dados = null; s.texto = [s.texto, s.apoio].filter(Boolean).join(' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' '); s.apoio = null; continue; }
      else if (s.layout === 'rep_comparacao' && s.dados?.esquerda && s.dados?.direita) { const e = s.dados.esquerda; const d = s.dados.direita; s.texto = `${e.rotulo}: ${e.valor} ${e.unidade || ''}. ${d.rotulo}: ${d.valor} ${d.unidade || ''}.`.replace(/\s+/g, ' ').trim(); s.layout = 'rep_manchete'; s.dados = null; continue; }
      const primeira = String(s.texto || '').split(/(?<=[.!?])\s+/)[0] || '';
      s.texto = primeira; s.apoio = null; if (s.dados?.extra) s.dados.extra.apoio = null;
      if (s.layout === 'encerramento') { s.texto = ''; }
    }
    M.criarVersao(c, dados, { quem: 'sistema', rotulo: 'top: texto encurtado para caber' });
    auditar(c); const nova = M.versaoAtiva(c);
    // os slides que já cabiam aproveitam o desenho (mesmo texto → mesma chave de render)
    c.arte.renders = [...c.arte.renders, ...c.arte.renders.filter((r) => r.versao === v.id && !ids.has(r.slide_id)).map((r) => ({ ...r, versao: nova.id }))];
    c.top.versao_montada = nova.id; c.top.arte_indice = 0;
    return { concluida: false };
  }
  if (naoCabe.length) c.top.aviso_arte = `${naoCabe.length} slide(s) com texto acima do tamanho legível: encurte antes de aprovar.`;
};

// Os mesmos portões da tela de aprovação (fatos ligados à fonte, atribuição, texto que cabe…). Carrossel que não passa
// não vai para "Para aprovar": o Pedro só vê o que dá para publicar com um toque.
function portoes(c) {
  const G = require('../../../static/qualityGates');
  const cl = M.clone(c); (cl.claims || []).forEach((k) => { k.revisao = { ...(k.revisao || {}), confirmada_por_pedro: true }; });
  return G.avaliar(cl, { conta: M.ACCOUNT_PIN }).bloqueios;
}
const motivoPortoes = (bl) => `Não passou nos portões de publicação: ${bl.slice(0, 2).map((b) => `${b.titulo}${b.detalhe ? ` (${String(b.detalhe).slice(0, 140)})` : ''}`).join(' · ')}`;

E.fim = async (c) => {
  const bl = portoes(c);
  if (bl.length) throw Object.assign(erro(motivoPortoes(bl), 'PORTOES', 422), { terminal: true, fim: 'abaixo_da_regua' });
  c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: agoraISO(), origem: 'top' };
  c.top.estado = 'concluida'; c.top.concluido_em = agoraISO();
  M.registrar(c, 'sistema', 'pronto', `Carrossel pronto (nota do júri ${c.top.escolha.nota.toFixed(1)}): confira e aprove.`);
  // No piloto/monitor o aviso é um só por janela de aprovação (piloto.js); só a criação manual avisa na hora.
  return { notificar: !['piloto', 'monitor'].includes(c.top.origem) };
};

// ── Motor ───────────────────────────────────────────────────────────────────────
async function passo(id, { deps = {}, orcamentoMs = 44000 } = {}) {
  const a = armazem(); const inicio = Date.now();
  let reg = await a.conteudos.obter(conta(), id); if (!reg || !reg.doc.top) throw erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  let c = reg.doc; let rev = reg.rev;
  if (c.top.estado !== 'em_andamento') return { conteudo: c, concluido: true };
  if (c.top.adiar_ate && Date.parse(c.top.adiar_ate) > Date.now()) return { conteudo: c, ocupado: true, adiado: true, concluido: false };
  if (c.top.lease_ate && Date.parse(c.top.lease_ate) > Date.now()) return { conteudo: c, ocupado: true, concluido: false };
  c.top.lease_ate = new Date(Date.now() + LEASE_MS).toISOString();
  try { rev = (await a.conteudos.salvar(conta(), id, c, rev)).rev; } catch (e) { if (e.code === 'CONFLITO') return { conteudo: c, ocupado: true, concluido: false }; throw e; }
  const ctx = {
    deps, restante: () => orcamentoMs - (Date.now() - inicio),
    ia: (args) => { const pedir = deps.pedirJson || llmJson.pedirJson; if (deps.pedirJson) return pedir(args); return llmJson.comConsumo(() => llmJson.comPrazo(Math.max(12000, ctx.restante() - 2000), () => pedir(args))).then(({ resultado, consumo }) => { c.top.chamadas_ia = (c.top.chamadas_ia || 0) + (consumo?.chamadas?.length || 0); return resultado; }); },
  };
  const gravar = async () => { c.updated_at = agoraISO(); c.top.lease_ate = new Date(Date.now() + LEASE_MS).toISOString(); rev = (await a.conteudos.salvar(conta(), id, c, rev)).rev; };
  let notificar = false;
  while (c.top.estado === 'em_andamento' && ctx.restante() > 9000) {
    const etapa = c.top.etapa;
    try {
      const r = (await E[etapa](c, ctx)) || {};
      if (r.concluida === false) { await gravar(); break; }
      if (r.notificar) notificar = true;
      c.top.tentativas[etapa] = 0;
      c.top.etapa = r.voltar || ETAPAS[ETAPAS.indexOf(etapa) + 1] || 'fim';
      if (etapa === 'fim') break;
      await gravar();
    } catch (e) {
      if (e.code === 'CONFLITO') return { conteudo: c, ocupado: true, concluido: false };
      // Cota da IA esgotada (429): não é defeito do carrossel. Espera a cota voltar em vez de descartar.
      if (e.status === 429 || /\b429\b|rate.?limit|tokens per (day|minute)|\bTP[DM]\b/i.test(String(e.message))) {
        const dia = /per day|\bTPD\b/i.test(String(e.message));
        c.top.adiar_ate = new Date(Date.now() + (dia ? 60 : 2) * 60000).toISOString(); c.top.cota_dia = dia;
        c.top.erros.push({ etapa, em: agoraISO(), mensagem: String(e.message).slice(0, 240), codigo: 'COTA_IA', tentativa: 0 });
        await gravar(); break;
      }
      const n = (c.top.tentativas[etapa] = (c.top.tentativas[etapa] || 0) + 1);
      c.top.erros.push({ etapa, em: agoraISO(), mensagem: String(e.message).slice(0, 240), codigo: e.code || null, tentativa: n });
      if (e.terminal || e.code === 'SEM_IA' || n >= MAX_TENTATIVAS) {
        c.top.estado = e.fim || 'erro'; c.top.motivo = String(e.message).slice(0, 300);
        c.status = 'arquivado'; M.registrar(c, 'sistema', 'top_' + c.top.estado, c.top.motivo);
        // descartado: as prévias não servem para nada e ocupam o banco
        const chaves = (c.arte?.renders || []).map((r) => r.blob_key).filter(Boolean);
        if (chaves.length && a.arquivos.apagar) { await a.arquivos.apagar(conta(), chaves).catch(() => {}); c.arte.renders = []; }
      }
      await gravar(); break;
    }
  }
  try { c.top.lease_ate = null; rev = (await a.conteudos.salvar(conta(), id, c, rev)).rev; } catch { /* lease expira */ }
  if (notificar) await require('../push').notificar({ corpo: `Carrossel pronto para aprovar: ${String(c.titulo).slice(0, 90)}`, tag: `top-${c.id}` }).catch(() => {});
  return { conteudo: c, concluido: c.top.estado !== 'em_andamento' };
}

async function executarTudo(id, { deps = {}, maxMs = 10 * 60000 } = {}) {
  const t0 = Date.now(); let r;
  do { r = await passo(id, { deps }); if (r.concluido) break; if (r.ocupado) await new Promise((x) => setTimeout(x, 500)); } while (Date.now() - t0 < maxMs);
  return r;
}

function resumo(c) {
  const t = c.top || {};
  return { id: c.id, titulo: c.titulo, estado: t.estado, etapa: t.etapa, rotulo: ROTULO[t.etapa] || t.etapa, motivo: t.motivo || null, nota: t.escolha?.nota ?? null, gatilhos: t.angulo?.gatilhos || null, tese: t.angulo?.tese || null, fatos: (t.fatos || []).length, fatos_descartados: (t.fatos_descartados || []).length, protagonista: t.protagonista || null, aviso_foto: t.aviso_foto || null, aviso_arte: t.aviso_arte || null, chamadas_ia: t.chamadas_ia || 0, erros: (t.erros || []).slice(-3) };
}

// Conserta um carrossel pronto cujas afirmações foram trocadas por fora (ex.: a preparação antiga rodou nele): recompõe
// afirmações, evidências e auditoria a partir dos fatos verificados. A versão (slides, textos, arte) não muda.
async function reparar(id) {
  const a = armazem(); const reg = await a.conteudos.obter(conta(), id);
  if (!reg?.doc?.top) throw erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const c = reg.doc; if (c.top.estado !== 'concluida') throw erro('Só dá para consertar carrossel pronto.', 'TOP', 409);
  montarVersao(c); auditar(c);
  if (!['aprovado', 'publicado', 'arquivado'].includes(c.status)) { c.status = 'em_revisao'; c.studio = { estado: 'pronto', concluido_em: c.top.concluido_em || agoraISO(), origem: 'top' }; }
  M.registrar(c, 'sistema', 'reparo', 'Afirmações e fontes recompostas a partir dos fatos verificados.');
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  return c;
}

// Confere de novo um carrossel já pronto: se não passa nos portões, sai de "Para aprovar" (arquivado, abaixo da régua).
async function revalidar(id) {
  const a = armazem(); const reg = await a.conteudos.obter(conta(), id);
  if (!reg?.doc?.top) throw erro('Carrossel não encontrado.', 'NAO_ENCONTRADO', 404);
  const c = reg.doc; if (c.top.estado !== 'concluida' || ['aprovado', 'publicado'].includes(c.status)) return { conteudo: c, bloqueios: [] };
  const bl = portoes(c); if (!bl.length) return { conteudo: c, bloqueios: [] };
  c.top.estado = 'abaixo_da_regua'; c.top.motivo = motivoPortoes(bl); c.status = 'arquivado'; c.studio = { ...(c.studio || {}), estado: 'descartado', job: null }; delete c.studio.erro;
  M.registrar(c, 'sistema', 'top_abaixo_da_regua', c.top.motivo);
  await a.conteudos.salvar(conta(), id, c, reg.rev);
  return { conteudo: c, bloqueios: bl };
}

module.exports = { revalidar, portoes, reparar, criar, passo, executarTudo, resumo, montarVersao, auditar, normalizarRoteiro, ETAPAS, ROTULO, REGUA, regua, hashEntrada: (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10) };
