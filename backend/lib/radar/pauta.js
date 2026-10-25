// Entrada ÚNICA de carrossel novo no padrão "Pedro Destrava — Minimalista": uma pauta (link ou texto) percorre
//   ler → identificar → verificar → gerar
// e cada etapa grava o ponto de retomada (o servidor pode cair no meio; a próxima chamada continua dali, sem repetir o
// que já foi salvo). Usada pelo estúdio, pela mesa, pelo lote, pela esteira e pelo Radar.
// O lote é uma lista de pautas processadas UMA de cada vez, com estado e erro por item; um item que falha não derruba os outros.
// Nada é publicado: o carrossel termina em rascunho ou aguardando aprovação.
const llmJson = require('../llmJson');
const store = require('./store');
const Cand = require('./candidatos');
const Verif = require('./verificacao');
const Carrossel = require('./carrossel2');
const Padrao = require('../padraoCarrossel');
const C = require('./config');
const U = require('./util');

const ETAPAS = ['ler', 'identificar', 'verificar', 'gerar'];
const ROTULO = { ler: 'Lendo a pauta', identificar: 'Identificando o negócio', verificar: 'Pesquisando e conferindo as fontes', gerar: 'Escrevendo e desenhando o carrossel', fim: 'Concluído' };
const TERMINAIS = ['concluida', 'erro', 'insuficiente', 'sem_negocio'];
const LEASE_MS = 75000; const MAX_TENTATIVAS = 3; const MAX_LOTE = 10;
const agoraDe = (deps) => (deps.agora ? deps.agora() : Date.now());

function urlValida(x) {
  try { const u = new URL(String(x).trim()); if (!/^https?:$/.test(u.protocol)) return null; if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname) || /\.local$|\.internal$/i.test(u.hostname)) return null; return u.toString(); } catch { return null; }
}

function novaPauta({ url = null, texto = null, titulo = '', nome = '', fontes = [], origem = 'radar', lote_id = null, agora = Date.now() }) {
  const chave = U.sha(`${url || ''}|${String(texto || '').slice(0, 2000)}|${nome}|${agora}`, 12);
  return { id: `pt_${chave}`, tipo: 'pauta', entrada: { url, texto: texto ? String(texto).slice(0, 60000) : null, titulo: U.limita(titulo, 200), nome: U.limita(nome, 80), fontes }, origem, lote_id, padrao: Padrao.atual() || 'editorial', estado: 'em_andamento', etapa: 'ler', tentativas: {}, erros: [], avisos: [], consumo: { chamadas: 0, tokens_entrada: 0, tokens_saida: 0, custo_usd_estimado: 0, provedores: [] }, criada_em: new Date(agora).toISOString(), atualizada_em: new Date(agora).toISOString() };
}

// Validação da entrada (link inválido e texto curto são recusados antes de gravar qualquer coisa).
function validarEntrada(e = {}) {
  const url = e.url ? urlValida(e.url) : null;
  if (e.url && !url) throw U.erro('Link inválido: use um endereço público que comece com http:// ou https://.', 'LINK_INVALIDO', 400);
  const texto = e.texto ? String(e.texto).trim() : '';
  if (!url && texto.length < 200 && !e.nome) throw U.erro('Envie um link, o nome do negócio ou um texto com pelo menos 200 caracteres.', 'ENTRADA', 400);
  // outras matérias sobre o MESMO negócio (até 2): viram fontes independentes na verificação
  const extras = (Array.isArray(e.fontes) ? e.fontes : []).map((x) => String(x || '').trim()).filter(Boolean);
  const fontes = []; for (const x of extras.slice(0, 2)) { const u = urlValida(x); if (!u) throw U.erro(`Link de fonte inválido: ${U.limita(x, 80)}`, 'LINK_INVALIDO', 400); if (u !== url) fontes.push(u); }
  return { url, texto: texto || null, titulo: e.titulo || '', nome: e.nome || '', fontes };
}

async function criar(entrada, { origem = 'radar', lote_id = null, deps = {}, agora = agoraDe(deps) } = {}) {
  const e = validarEntrada(entrada);
  const p = novaPauta({ ...e, origem, lote_id, agora });
  await store.salvar('pauta', p.id, p, 0);
  return p;
}

// ── Etapas ──────────────────────────────────────────────────────────────────────
const SISTEMA = `Você identifica o negócio principal de uma pauta (matéria, página ou texto) para o perfil @pedro_destrava.
Use SOMENTE o texto recebido. Se o texto não falar de UM negócio específico (empresa, produto ou serviço com nome), responda {"nome": null, "motivo": "..."}.
Não invente site, números nem fatos. "site_oficial" só se o endereço aparecer no texto ou for o próprio link lido.
Responda APENAS JSON: {"nome":"","site_oficial":null,"pais":"","categoria":"startup|servico|produto|app|loja|outro","resumo":"","problema":"","solucao":"","como_ganha_dinheiro":"","modelo_receita":null}`;

const E = {};
E.ler = async (p, ctx) => {
  if (!p.entrada.url) { p.leitura = { tipo: 'texto', titulo: p.entrada.titulo || String(p.entrada.texto || p.entrada.nome).split('\n')[0].slice(0, 140), texto: p.entrada.texto || '', legivel: true }; return { concluida: true }; }
  const ler = ctx.deps.lerFonte || ((u) => require('../research').lerFonte({ url: u }));
  let f; try { f = await U.comTimeout(ler(p.entrada.url), 20000, 'a leitura do link'); } catch (e) { throw U.erro(`O link não abriu: ${U.limita(e.message, 120)}`, 'LINK', 422); }
  if (!f?.legivel) throw Object.assign(U.erro(`O link não pôde ser lido (${f?.acesso === 'negado' ? 'o site recusa leitura automática' : 'sem texto legível'}). Envie outro link ou cole o texto.`, 'LINK_ILEGIVEL', 422), { terminal: true });
  p.leitura = { tipo: 'link', url: f.url_final || p.entrada.url, titulo: f.titulo || '', veiculo: f.veiculo || U.host(p.entrada.url), publicada_em: f.publicada_em || null, texto: String(f.texto || '').slice(0, 30000), legivel: true };
  return { concluida: true };
};

E.identificar = async (p, ctx) => {
  const pedir = ctx.deps.pedirJson || llmJson.pedirJson;
  const d = llmJson.dado('PAUTA', JSON.stringify({ titulo: p.leitura.titulo, url: p.leitura.url || null, nome_indicado: p.entrada.nome || null, texto: String(p.leitura.texto || p.entrada.nome).slice(0, 14000) }), 16000);
  const { dados } = await ctx.comIA(() => pedir({ sistema: `${SISTEMA}\n\n${llmJson.REGRAS_DADOS}`, usuario: d.bloco, maxTokens: 900, temperatura: 0.1, budget: ctx.deps.budget }));
  const nome = U.limita(p.entrada.nome || dados?.nome, 80);
  if (!nome || nome.length < 2) { p.estado = 'sem_negocio'; p.motivo = U.limita(dados?.motivo || 'a pauta não fala de um negócio específico', 200); return { concluida: true, fim: true }; }
  const site = urlValida(dados?.site_oficial || '') || null;
  const chave = Cand.chaveEmpresa(nome, site);
  const doLink = p.leitura.url ? Verif.classeDoc(p.leitura.url, { chave }) : null;
  p.negocio = {
    id: `op_${U.sha(chave.nome || chave.dominio || nome, 12)}`, nome, chave, pais: U.limita(dados?.pais || 'não informado', 40), categoria: Object.keys(C.CATEGORIAS).includes(dados?.categoria) ? dados.categoria : 'startup',
    resumo: U.limita(dados?.resumo, 220), problema: U.limita(dados?.problema, 260), solucao: U.limita(dados?.solucao, 260), como_ganha_dinheiro: U.limita(dados?.como_ganha_dinheiro, 260), modelo_receita: C.MODELOS_RECEITA[dados?.modelo_receita] ? dados.modelo_receita : null,
    url_oficial: doLink === 'oficial' ? p.leitura.url : null, url_sugerida: site,
    fontes_itens: p.leitura.url && doLink !== 'oficial' ? [{ id: `${p.id}_link`, titulo: p.leitura.titulo, url: p.leitura.url, fonte_id: 'pauta', fonte_nome: p.leitura.veiculo, fonte_classe: 'imprensa', publicada_em: p.leitura.publicada_em }] : [],
    sinais_de_risco: [], ia: false, max_imprensa: 3,
  };
  // fontes extras indicadas pelo Pedro entram como matérias (a classe real vem do endereço; o site oficial é reconhecido)
  for (const [k, u] of (p.entrada.fontes || []).entries()) {
    const cl = Verif.classeDoc(u, { chave });
    if (cl === 'oficial') { p.negocio.url_oficial ||= u; continue; }
    p.negocio.fontes_itens.push({ id: `${p.id}_extra${k}`, titulo: '', url: u, fonte_id: 'pauta', fonte_nome: U.host(u), fonte_classe: 'imprensa', publicada_em: null });
  }
  return { concluida: true };
};

E.verificar = async (p, ctx) => {
  const cand = p.negocio;
  const { verificacao } = await ctx.comIA(() => Verif.verificar(cand, { deps: ctx.deps, agora: ctx.agora }));
  // história escolhida pelo Pedro: a idade não descarta (só a pesquisa diária filtra por idade)
  let v = verificacao;
  if (v.descartar?.codigo === 'historia_antiga') v = { ...v, descartar: null, estado: v.existencia_confirmada ? 'verificada' : 'insuficiente', motivos: v.motivos.filter((m) => !/História antiga/.test(m)) };
  const existente = await store.obter('oportunidade', cand.id);
  const op = { ...cand, tipo: 'oportunidade', origem: 'pauta', pauta_id: p.id, status: v.estado === 'reprovada' ? 'descartada' : 'pauta', encontrada_em: new Date(ctx.agora).toISOString(), run_id: null, pontuacao: null, verificacao: v, verificada_em: new Date(ctx.agora).toISOString(), decisoes: [...(existente?.doc.decisoes || []), { em: new Date(ctx.agora).toISOString(), acao: 'pauta', por: p.origem }], carrosseis: existente?.doc.carrosseis || [], carrossel_id: existente?.doc.carrossel_id || null };
  await store.salvar('oportunidade', op.id, op, existente ? existente.rev : 0);
  p.op_id = op.id; p.verificacao = { estado: v.estado, motivos: (v.motivos || []).slice(0, 6), limitacoes: (v.limitacoes || []).slice(0, 8), numeros_usaveis: (v.numeros_usaveis || []).length };
  if (v.estado !== 'verificada' || !(v.numeros_usaveis || []).length) {
    p.estado = 'insuficiente';
    p.motivo = v.estado === 'reprovada' ? `Reprovada na verificação: ${v.descartar?.motivo || v.motivos?.[0] || 'sinal de risco'}.` : `Fontes insuficientes: ${(v.motivos || []).slice(0, 2).join(' ') || 'não há fonte oficial nem duas fontes independentes com número conferido'}. Indique outra fonte (site oficial ou matéria) e tente de novo.`;
    return { concluida: true, fim: true };
  }
  return { concluida: true };
};

E.gerar = async (p, ctx) => {
  if (ctx.restante() < 26000) return { concluida: false };
  const doc = await ctx.comIA(() => Carrossel.gerar(p.op_id, { deps: ctx.deps, origem: `pauta:${p.origem}`, permitirBaixa: true, agora: ctx.agora, orcamentoMs: Math.max(20000, ctx.restante() - 6000), template: p.padrao || Padrao.atual() || 'editorial', versao: p.carrossel_versao || null }));
  p.carrossel_versao = doc.versao; p.carrossel_id = doc.id;
  if (doc.etapa !== 'pronto' && doc.estado !== 'erro') return { concluida: false };
  p.carrossel_estado = doc.estado; p.bloqueios = doc.validacao?.bloqueios?.length || 0;
  return { concluida: true };
};

// ── Motor (mesmo desenho do pipeline: lease, ponto de retomada, tentativas) ──────────────
async function avancar(id, { deps: d0 = {}, orcamentoMs = 44000 } = {}) {
  const deps = { ...U.depsDeTeste(), ...d0 }; const inicio = Date.now();
  let reg = await store.obter('pauta', id); if (!reg) throw U.erro('Pauta não encontrada.', 'NAO_ENCONTRADA', 404);
  let p = reg.doc; let rev = reg.rev;
  if (p.estado !== 'em_andamento') return { pauta: p, concluida: true };
  const a0 = agoraDe(deps);
  if (p.lease_ate && Date.parse(p.lease_ate) > a0) return { pauta: p, ocupado: true, concluida: false };
  if (p.esperar_ate && !deps.semEspera && Date.parse(p.esperar_ate) > a0) return { pauta: p, concluida: false, esperar_s: Math.ceil((Date.parse(p.esperar_ate) - a0) / 1000) };
  p.lease_ate = new Date(a0 + LEASE_MS).toISOString();
  try { rev = (await store.salvar('pauta', id, p, rev)).rev; } catch (e) { if (e.code === 'CONFLITO') return { pauta: p, ocupado: true, concluida: false }; throw e; }
  const ctx = {
    deps, agora: a0, restante: () => orcamentoMs - (Date.now() - inicio),
    comIA: async (fn) => { if (deps.pedirJson) return fn(); const { resultado, consumo } = await llmJson.comConsumo(() => llmJson.comPrazo(Math.max(12000, ctx.restante() - 2000), fn)); require('./pipeline').somarConsumo(p, consumo.chamadas); return resultado; },
  };
  const gravar = async () => { p.atualizada_em = new Date(agoraDe(deps)).toISOString(); p.lease_ate = new Date(agoraDe(deps) + LEASE_MS).toISOString(); rev = (await store.salvar('pauta', id, p, rev)).rev; };
  let esperar = 0;
  try {
    while (p.estado === 'em_andamento' && ctx.restante() > 9000) {
      const etapa = p.etapa;
      try {
        const r = await E[etapa](p, ctx);
        if (!r.concluida) break;
        if (r.fim) { p.etapa = 'fim'; p.finalizada_em = new Date(agoraDe(deps)).toISOString(); await gravar(); break; }
        const prox = ETAPAS[ETAPAS.indexOf(etapa) + 1];
        if (!prox) { p.estado = 'concluida'; p.etapa = 'fim'; p.finalizada_em = new Date(agoraDe(deps)).toISOString(); } else p.etapa = prox;
        p.tentativas[etapa] = 0; await gravar();
      } catch (e) {
        if (e.code === 'CONFLITO') return { pauta: p, ocupado: true, concluida: false };
        const n = (p.tentativas[etapa] = (p.tentativas[etapa] || 0) + 1);
        p.erros.push({ etapa, em: new Date(agoraDe(deps)).toISOString(), mensagem: U.limita(e.message, 240), codigo: e.code || null, tentativa: n });
        const temporario = ['LIMITE'].includes(e.code) || U.erroTemporario(e);
        if (e.terminal || ['SEM_IA', 'SEM_BANCO', 'LINK_ILEGIVEL', 'NAO_VERIFICADA', 'SEM_PROVA', 'SEM_PAUTA'].includes(e.code) || (!temporario && n >= MAX_TENTATIVAS) || n >= MAX_TENTATIVAS + 2) {
          p.estado = 'erro'; p.finalizada_em = new Date(agoraDe(deps)).toISOString();
          p.erro_final = { etapa, codigo: e.code || null, mensagem: e.code === 'SEM_IA' ? 'Nenhuma chave de IA está configurada no servidor: a pauta foi lida, mas não há como escrever o carrossel.' : U.limita(e.message, 240) };
          await gravar(); break;
        }
        esperar = Math.min(120, 15 * n); p.esperar_ate = new Date(agoraDe(deps) + esperar * 1000).toISOString(); await gravar(); break;
      }
    }
  } catch (e) { return { pauta: p, concluida: false, erro_banco: U.limita(e.message, 160) }; }
  try { p.lease_ate = null; p.atualizada_em = new Date(agoraDe(deps)).toISOString(); await store.salvar('pauta', id, p, rev); } catch { /* lease expira sozinho */ }
  if (TERMINAIS.includes(p.estado) && p.lote_id) await anotarLote(p).catch(() => {});
  return { pauta: p, concluida: p.estado !== 'em_andamento', esperar_s: esperar || undefined };
}

async function executarTudo(id, { deps = {}, maxMs = 15 * 60000, orcamentoMs = 44000 } = {}) {
  const t0 = Date.now(); let r;
  do { r = await avancar(id, { deps, orcamentoMs }); if (r.concluida) break; if (r.esperar_s && deps.semEspera !== true) await new Promise((x) => setTimeout(x, Math.min(r.esperar_s, 5) * 1000)); else if (r.ocupado) await new Promise((x) => setTimeout(x, 300)); } while (Date.now() - t0 < maxMs);
  return r;
}

// Retoma o que parou (processo morreu no meio): lease vencido e atualização recente.
async function pendentes({ agora = Date.now() } = {}) {
  if (!store.disponivel()) return [];
  return (await store.listar('pauta', 60)).filter((p) => p.estado === 'em_andamento' && (!p.lease_ate || Date.parse(p.lease_ate) < agora) && agora - Date.parse(p.atualizada_em) < 12 * 3600000);
}

function resumo(p) {
  const i = Math.max(0, ETAPAS.indexOf(p.etapa));
  return { id: p.id, estado: p.estado, etapa: p.etapa, rotulo: ROTULO[p.etapa] || p.etapa, percentual: p.estado === 'em_andamento' ? Math.round((i / ETAPAS.length) * 100) : 100, entrada: { url: p.entrada.url, titulo: p.entrada.titulo || p.leitura?.titulo || '', nome: p.negocio?.nome || p.entrada.nome || null }, origem: p.origem, padrao: p.padrao, motivo: p.motivo || null, erro: p.erro_final || null, op_id: p.op_id || null, carrossel_id: p.carrossel_id || null, carrossel_estado: p.carrossel_estado || null, bloqueios: p.bloqueios ?? null, verificacao: p.verificacao || null, lote_id: p.lote_id || null, criada_em: p.criada_em, atualizada_em: p.atualizada_em };
}

// ── Lote ───────────────────────────────────────────────────────────────────────
async function criarLote(itens, { origem = 'lote', deps = {}, agora = agoraDe(deps) } = {}) {
  const lista = (Array.isArray(itens) ? itens : []).slice(0, MAX_LOTE + 1);
  if (!lista.length) throw U.erro('O lote está vazio.', 'ENTRADA', 400);
  if (lista.length > MAX_LOTE) throw U.erro(`Até ${MAX_LOTE} pautas por lote.`, 'ENTRADA', 400);
  const id = `lt_${U.sha(`${agora}${Math.random()}`, 10)}`;
  const pautas = []; const recusadas = [];
  for (const [i, it] of lista.entries()) {
    try { const p = await criar(it, { origem, lote_id: id, deps, agora: agora + i }); pautas.push(p.id); } catch (e) { recusadas.push({ indice: i, entrada: { url: it?.url || null, titulo: it?.titulo || '' }, erro: e.message, codigo: e.code || null }); }
  }
  const lote = { id, tipo: 'lote', origem, pautas, recusadas, estado: pautas.length ? 'em_andamento' : 'concluido', criado_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString() };
  await store.salvar('lote', id, lote, 0);
  return lote;
}
async function anotarLote(p) {
  await store.atualizar('lote', p.lote_id, (l) => { l.atualizado_em = new Date().toISOString(); return l; });
}
// Avança o lote: um item de cada vez, na ordem. Retoma do item que estava em andamento.
async function avancarLote(id, { deps = {}, orcamentoMs = 44000 } = {}) {
  const reg = await store.obter('lote', id); if (!reg) throw U.erro('Lote não encontrado.', 'NAO_ENCONTRADO', 404);
  const t0 = Date.now(); let ultimo = null;
  for (const pid of reg.doc.pautas) {
    const r = await store.obter('pauta', pid); if (!r || r.doc.estado !== 'em_andamento') continue;
    ultimo = await avancar(pid, { deps, orcamentoMs: Math.max(15000, orcamentoMs - (Date.now() - t0)) });
    if (!ultimo.concluida) return { lote: await estadoLote(id), concluido: false, esperar_s: ultimo.esperar_s, ocupado: ultimo.ocupado };
    if (orcamentoMs - (Date.now() - t0) < 20000) return { lote: await estadoLote(id), concluido: false };
  }
  const l = await estadoLote(id);
  if (l.concluido) await store.atualizar('lote', id, (x) => { x.estado = 'concluido'; x.concluido_em = x.concluido_em || new Date().toISOString(); return x; });
  return { lote: l, concluido: l.concluido };
}
async function executarLote(id, { deps = {}, maxMs = 30 * 60000, orcamentoMs = 44000 } = {}) {
  const t0 = Date.now(); let r;
  do { r = await avancarLote(id, { deps, orcamentoMs }); if (r.concluido) break; if (r.esperar_s && deps.semEspera !== true) await new Promise((x) => setTimeout(x, Math.min(r.esperar_s, 5) * 1000)); } while (Date.now() - t0 < maxMs);
  return r;
}
async function estadoLote(id) {
  const reg = await store.obter('lote', id); if (!reg) throw U.erro('Lote não encontrado.', 'NAO_ENCONTRADO', 404);
  const itens = []; for (const pid of reg.doc.pautas) { const r = await store.obter('pauta', pid); if (r) itens.push(resumo(r.doc)); }
  const cont = (e) => itens.filter((x) => x.estado === e).length;
  return { id, origem: reg.doc.origem, criado_em: reg.doc.criado_em, itens, recusadas: reg.doc.recusadas || [], total: itens.length, concluidas: cont('concluida'), com_erro: cont('erro'), insuficientes: cont('insuficiente') + cont('sem_negocio'), em_andamento: cont('em_andamento'), concluido: itens.every((x) => TERMINAIS.includes(x.estado)) };
}

module.exports = { criar, avancar, executarTudo, pendentes, resumo, validarEntrada, urlValida, criarLote, avancarLote, executarLote, estadoLote, ETAPAS, ROTULO, TERMINAIS, MAX_LOTE, SISTEMA };
