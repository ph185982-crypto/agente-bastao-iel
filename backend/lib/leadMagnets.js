// Porta de entrada: cada isca (lead magnet) tem uma palavra-chave para comentar e um LINK que o Pedro
// preenche. Sem link, a isca não gera chamada: nada de promessa vazia. DMs recebidas por palavra são
// digitadas à mão (não existe integração e nada é inventado).
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

const PADRAO = [
  { id: 'calculadora_preco', nome: 'Calculadora de preço', palavra: 'PRECO', link: '' },
  { id: 'raiox_dependencia', nome: 'Raio-X de Dependência', palavra: 'RAIOX', link: '' },
];
const erro = (m) => Object.assign(new Error(m), { code: 'ENTRADA', status: 400 });
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

function validar(lista) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 8) throw erro('Envie de 1 a 8 iscas.');
  const ids = new Set(); const palavras = new Set();
  return lista.map((x) => {
    const id = String(x?.id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
    const nome = String(x?.nome || '').trim().slice(0, 60);
    const palavra = semAcento(x?.palavra).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const link = String(x?.link || '').trim();
    if (!id || !nome) throw erro('Cada isca precisa de id e nome.');
    if (palavra.length < 3) throw erro(`A palavra-chave de “${nome}” precisa de pelo menos 3 letras.`);
    if (link && !/^https:\/\/[^\s]+$/i.test(link)) throw erro(`O link de “${nome}” precisa começar com https://.`);
    if (ids.has(id)) throw erro('Há iscas com o mesmo id.');
    if (palavras.has(palavra)) throw erro(`A palavra ${palavra} está em duas iscas.`);
    ids.add(id); palavras.add(palavra);
    return { id, nome, palavra, link };
  });
}

async function ler() {
  const a = armazem();
  const g = a?.duravel ? (await a.config.obter(ACCOUNT.ig_id)).lead_magnets : null;
  return Array.isArray(g) && g.length ? g : PADRAO.map((x) => ({ ...x }));
}
async function salvar(lista) {
  const ok = validar(lista);
  const a = armazem();
  if (a?.duravel) await a.config.salvar(ACCOUNT.ig_id, { lead_magnets: ok });
  return { iscas: ok, guardada: !!a?.duravel };
}

// Chamada final com a palavra-chave. Sem link, não gera (devolve o que falta).
function chamada(isca) {
  if (!isca) return { cta: '', falta: 'Nenhuma isca escolhida.' };
  if (!isca.link) return { cta: '', falta: `Falta o link de “${isca.nome}” (Conta aberta → Porta de entrada).` };
  return { cta: `Comenta ${isca.palavra} que eu te mando: ${isca.nome}.`, falta: null };
}

// ── DMs por palavra-chave, digitadas por semana ──
const semanaDe = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ano = t.getUTCFullYear();
  const sem = Math.ceil((((t - Date.UTC(ano, 0, 1)) / 86400000) + 1) / 7);
  return `${ano}-W${String(sem).padStart(2, '0')}`;
};
async function lerDms() {
  const a = armazem();
  const g = a?.duravel ? (await a.config.obter(ACCOUNT.ig_id)).dms_por_palavra : null;
  return Array.isArray(g) ? g : [];
}
async function registrarDms({ semana, palavra, dms, qualificadas = null }, agora = new Date()) {
  const sem = /^\d{4}-W\d{2}$/.test(String(semana || '')) ? semana : semanaDe(agora);
  const p = semAcento(palavra).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const n = Number(dms);
  const q = qualificadas === null || qualificadas === '' || qualificadas === undefined ? null : Number(qualificadas);
  if (p.length < 3) throw erro('Informe a palavra-chave.');
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw erro('O número de DMs deve ser um inteiro de 0 a 100000.');
  if (q !== null && (!Number.isInteger(q) || q < 0 || q > n)) throw erro('As DMs qualificadas devem ser um inteiro entre 0 e o total de DMs.');
  const lista = (await lerDms()).filter((x) => !(x.semana === sem && x.palavra === p));
  lista.push({ semana: sem, palavra: p, dms: n, qualificadas: q, registrado_em: agora.toISOString() });
  lista.sort((x, y) => y.semana.localeCompare(x.semana) || x.palavra.localeCompare(y.palavra));
  const a = armazem();
  const recorte = lista.slice(0, 120);
  if (a?.duravel) await a.config.salvar(ACCOUNT.ig_id, { dms_por_palavra: recorte });
  return { dms: recorte, guardada: !!a?.duravel };
}

module.exports = { PADRAO, validar, ler, salvar, chamada, lerDms, registrarDms, semanaDe };
