// Gasto com IA paga (OpenAI): preço por modelo, registro por chamada e teto mensal. Ao chegar no teto (ou passar do ritmo do
// dia), a ferramenta deixa de chamar a OpenAI e segue com as IAs gratuitas até o mês virar. Nada é cobrado sem estar aqui.
// Teto: IA_TETO_MENSAL_USD (padrão 30). Ritmo do dia: até o dobro da cota diária (teto ÷ 30 × 2), para um dia cheio não
// queimar o mês. Registro em config.gasto_ia = { mes, usd, chamadas, por_dia: { 'AAAA-MM-DD': usd }, por_modelo }.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');

// US$ por milhão de tokens (preços da OpenAI em 11/2026; cached = prefixo repetido do prompt, cobrado a 10%).
const PRECOS = {
  'gpt-5.5': { entrada: 5, cache: 0.5, saida: 30 },
  'gpt-5.4': { entrada: 2.5, cache: 0.25, saida: 15 },
  'gpt-5.4-mini': { entrada: 0.75, cache: 0.075, saida: 4.5 },
  'gpt-4o-mini': { entrada: 0.15, cache: 0.075, saida: 0.6 },
};
const teto = () => (Number(process.env.IA_TETO_MENSAL_USD) > 0 ? Number(process.env.IA_TETO_MENSAL_USD) : 30);
const conta = () => ACCOUNT.ig_id;
const OFFSET_MS = 3 * 3600000; // Brasília
const diaSP = (t) => new Date(t - OFFSET_MS).toISOString().slice(0, 10);
const precoDe = (model) => PRECOS[String(model || '').replace(/-\d{4}-\d{2}-\d{2}$/, '')] || null;

// Custo de uma resposta, pelo uso que a OpenAI devolve (o raciocínio já vem somado em completion_tokens).
function custo(model, usage) {
  const p = precoDe(model); if (!p || !usage) return null;
  const cache = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
  const entrada = Math.max(0, (Number(usage.prompt_tokens) || 0) - cache);
  const saida = Number(usage.completion_tokens) || 0;
  return { usd: (entrada * p.entrada + cache * p.cache + saida * p.saida) / 1e6, entrada, cache, saida };
}

let memo = { em: 0, doc: null };
async function ler({ forcar = false, deps = {} } = {}) {
  if (!forcar && memo.doc && Date.now() - memo.em < 60000) return memo.doc;
  const a = deps.armazem || armazem();
  const doc = a?.duravel ? ((await a.config.obter(conta())).gasto_ia || {}) : (memo.doc || {});
  memo = { em: Date.now(), doc }; return doc;
}
const doMes = (doc, agora) => (doc?.mes === diaSP(agora).slice(0, 7) ? doc : { mes: diaSP(agora).slice(0, 7), usd: 0, chamadas: 0, por_dia: {}, por_modelo: {} });

async function registrar(model, usage, { agora = Date.now(), etapa = null, deps = {} } = {}) {
  const c = custo(model, usage); if (!c) return null;
  const doc = doMes(await ler({ forcar: true, deps }), agora); const dia = diaSP(agora);
  const novo = {
    ...doc, usd: (doc.usd || 0) + c.usd, chamadas: (doc.chamadas || 0) + 1,
    por_dia: { ...Object.fromEntries(Object.entries(doc.por_dia || {}).slice(-40)), [dia]: ((doc.por_dia || {})[dia] || 0) + c.usd },
    por_modelo: { ...(doc.por_modelo || {}), [model]: ((doc.por_modelo || {})[model] || 0) + c.usd },
    tokens_cache: (doc.tokens_cache || 0) + c.cache, tokens_entrada: (doc.tokens_entrada || 0) + c.entrada, tokens_saida: (doc.tokens_saida || 0) + c.saida,
    ...(etapa ? { por_etapa: { ...(doc.por_etapa || {}), [etapa]: ((doc.por_etapa || {})[etapa] || 0) + c.usd } } : {}),
  };
  const a = deps.armazem || armazem();
  if (a?.duravel) await a.config.salvar(conta(), { gasto_ia: novo });
  memo = { em: Date.now(), doc: novo };
  return c;
}

// Pode chamar a OpenAI agora? Não, se o mês chegou no teto ou o dia passou do dobro da cota diária.
async function podeGastar({ agora = Date.now(), deps = {} } = {}) {
  let doc; try { doc = doMes(await ler({ deps }), agora); } catch { return false; } // sem conseguir medir, não gasta
  const t = teto(); const hoje = (doc.por_dia || {})[diaSP(agora)] || 0;
  return (doc.usd || 0) < t && hoje < (t / 30) * 2;
}

async function resumo({ agora = Date.now(), deps = {} } = {}) {
  const doc = doMes(await ler({ forcar: true, deps }), agora); const t = teto();
  const arred = (x) => Math.round((x || 0) * 100) / 100;
  const tokEntrada = (doc.tokens_entrada || 0) + (doc.tokens_cache || 0);
  return {
    mes: doc.mes, usd: arred(doc.usd), teto_usd: t, hoje_usd: arred((doc.por_dia || {})[diaSP(agora)]), teto_dia_usd: arred((t / 30) * 2),
    chamadas: doc.chamadas || 0, por_etapa: Object.fromEntries(Object.entries(doc.por_etapa || {}).map(([k, v]) => [k, arred(v)])),
    por_modelo: Object.fromEntries(Object.entries(doc.por_modelo || {}).map(([k, v]) => [k, arred(v)])),
    cache_pct: tokEntrada ? Math.round(((doc.tokens_cache || 0) / tokEntrada) * 100) : null,
    pode_gastar: await podeGastar({ agora, deps }),
  };
}

module.exports = { PRECOS, teto, custo, registrar, podeGastar, resumo, _zerar: () => { memo = { em: 0, doc: null }; } };
