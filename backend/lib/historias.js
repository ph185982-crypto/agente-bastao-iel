// "Minhas histórias e casos": o material do Pedro que vira conteúdo. Ele escreve (ou dita pelo teclado do celular) uma
// história dele, um caso de cliente ou um passo a passo; a ferramenta só usa o que estiver escrito ali
// (backend/lib/top/pipeline.js, modos 'historia' | 'caso' | 'como_fazer'). Guardado em pico_radar, tipo 'historia'.
const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const TIPO = 'historia';
const TIPOS = { historia: 'História minha', caso: 'Caso de cliente', como_fazer: 'Como fazer' };
const MIN_TEXTO = 200; const MAX_TEXTO = 6000; const MAX_TITULO = 120; const MAX_ITENS = 300;
const conta = () => ACCOUNT.ig_id;
const erro = (msg, status = 400, code = 'HISTORIA') => Object.assign(new Error(msg), { status, code });
const db = () => { const a = armazem(); if (!a?.duravel) throw erro('O cadastro precisa do banco de dados no servidor.', 503, 'SEM_BANCO'); return a; };
const limpo = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

function validar({ tipo, titulo, texto } = {}) {
  if (!TIPOS[tipo]) throw erro(`Escolha o tipo: ${Object.values(TIPOS).join(', ')}.`);
  const t = limpo(texto, MAX_TEXTO + 1);
  if (t.length < MIN_TEXTO) throw erro(`Conte um pouco mais: o texto precisa de pelo menos ${MIN_TEXTO} caracteres (tem ${t.length}). A ferramenta só usa o que você escrever.`);
  if (t.length > MAX_TEXTO) throw erro(`O texto passou de ${MAX_TEXTO} caracteres. Divida em duas histórias.`);
  const tit = limpo(titulo, MAX_TITULO) || t.split(/(?<=[.!?])\s+/)[0].slice(0, 80);
  return { tipo, titulo: tit, texto: t };
}

async function listar() {
  const a = armazem(); if (!a?.duravel) return [];
  return (await a.radar.listar(conta(), TIPO, { limite: MAX_ITENS })).map((r) => r.doc).sort((p, q) => String(q.criado_em).localeCompare(String(p.criado_em)));
}
async function obter(id) { const r = await db().radar.obter(conta(), TIPO, String(id)); if (!r) throw erro('História não encontrada.', 404, 'NAO_ENCONTRADA'); return r.doc; }

async function criar(dados, { agora = Date.now() } = {}) {
  const a = db(); const v = validar(dados);
  if ((await listar()).length >= MAX_ITENS) throw erro(`O cadastro tem o limite de ${MAX_ITENS} itens. Apague os que já foram usados.`, 409);
  const doc = { id: `hs_${crypto.randomBytes(8).toString('hex')}`, ...v, criado_em: new Date(agora).toISOString(), usos: [] };
  await a.radar.salvar(conta(), TIPO, doc.id, doc);
  return doc;
}
async function editar(id, dados) {
  const atual = await obter(id); const v = validar({ tipo: dados.tipo ?? atual.tipo, titulo: dados.titulo ?? atual.titulo, texto: dados.texto ?? atual.texto });
  const doc = { ...atual, ...v, editado_em: new Date().toISOString() };
  await db().radar.salvar(conta(), TIPO, doc.id, doc);
  return doc;
}
async function apagar(id) { await obter(id); await db().radar.apagar(conta(), TIPO, String(id)); return { id, apagada: true }; }

async function marcarUso(id, uso) {
  const atual = await obter(id);
  const doc = { ...atual, usos: [...(atual.usos || []), { em: new Date().toISOString(), ...uso }].slice(-10) };
  await db().radar.salvar(conta(), TIPO, doc.id, doc);
  return doc;
}
// A mais antiga que ainda não virou conteúdo (o piloto usa uma por vez).
async function proximaNaoUsada() { return [...(await listar())].reverse().find((h) => !(h.usos || []).length) || null; }

// Formato que combina com cada linha: história comprida vira ensaio (crônica); o resto, tweet (uma ideia por slide).
const formatoPara = (h) => (h.tipo === 'historia' && h.texto.length >= 900 ? 'ensaio' : 'tweet');

// Cria o conteúdo no pipeline "top" a partir do item cadastrado e registra o uso.
async function gerar(id, { formato = null, origem = 'historia', deps = {} } = {}) {
  const h = await obter(id);
  const T = require('./top/pipeline');
  const fmt = T.FORMATOS.includes(formato) ? formato : formatoPara(h);
  const c = await (deps.criar || T.criar)({ texto: h.texto, titulo: h.titulo, origem, formato: fmt, modo: h.tipo });
  c.top = c.top || {}; c.top.historia = { id: h.id, tipo: h.tipo, titulo: h.titulo };
  if (!deps.criar) { const a = db(); const reg = await a.conteudos.obter(conta(), c.id); await a.conteudos.salvar(conta(), c.id, c, reg?.rev || 0); }
  await marcarUso(h.id, { conteudo_id: c.id, formato: fmt });
  return { id: c.id, formato: fmt, titulo: c.titulo, historia_id: h.id, tipo: h.tipo };
}

module.exports = { TIPO, TIPOS, MIN_TEXTO, MAX_TEXTO, validar, listar, obter, criar, editar, apagar, marcarUso, proximaNaoUsada, formatoPara, gerar };
