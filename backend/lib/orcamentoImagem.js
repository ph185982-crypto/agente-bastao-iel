// Teto de gasto com imagem por IA: por carrossel e por mês (fuso de São Paulo). A reserva é feita ANTES de chamar a
// API (se estourar, nada é gerado nem cobrado) e o gasto real é registrado depois do sucesso.
//
// Onde fica o gasto: no armazém durável (banco), na chave 'imagem_gasto:YYYY-MM' da configuração da conta.
// SEM banco o teto vale só na memória do processo: na Vercel cada instância tem a sua, e ela some quando a função
// é reciclada. Ou seja, sem banco o teto é só um freio de segurança por execução, não um controle de verdade.
// Duas gravações simultâneas em instâncias diferentes podem somar menos que o real (ler-somar-gravar, sem trava
// no banco): por isso o teto mensal padrão é baixo e o limite de gasto também deve ser definido no painel da OpenAI.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const { gerarFundo, custoImagem, ImagemTeto, ImagemSemChave, ImagemDesligada, MODELO_PADRAO } = require('./imagemOpenAI');

const TETO_CARROSSEL_PADRAO = 2.0;
const TETO_MES_PADRAO = 10.0;
const arredonda = (n) => Math.round(n * 1e6) / 1e6;

function numeroEnv(nome, padrao) {
  const v = Number(String(process.env[nome] ?? '').replace(',', '.'));
  return Number.isFinite(v) && v >= 0 && process.env[nome] != null && process.env[nome] !== '' ? v : padrao;
}
const limites = () => ({ carrossel: numeroEnv('IMAGEM_TETO_CARROSSEL_USD', TETO_CARROSSEL_PADRAO), mes: numeroEnv('IMAGEM_TETO_MES_USD', TETO_MES_PADRAO) });

// 'YYYY-MM' no fuso de São Paulo.
function mesSP(agora = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(agora));
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`;
}
const chaveMes = (mes) => `imagem_gasto:${mes}`;

// Memória do processo (sem banco) e reservas em andamento (gastos ainda não confirmados).
const memoria = new Map();
const reservas = new Map();
let seq = 0;

async function ler(mes, deps) {
  const a = deps?.armazem !== undefined ? deps.armazem : armazem();
  if (a?.duravel) {
    const cfg = await a.config.obter(ACCOUNT.ig_id);
    const g = cfg[chaveMes(mes)] || {};
    return { total: Number(g.total) || 0, por_conteudo: { ...(g.por_conteudo || {}) }, duravel: true };
  }
  const g = memoria.get(mes) || { total: 0, por_conteudo: {} };
  return { total: g.total, por_conteudo: { ...g.por_conteudo }, duravel: false };
}
async function gravar(mes, g, deps) {
  const a = deps?.armazem !== undefined ? deps.armazem : armazem();
  const doc = { total: arredonda(g.total), por_conteudo: g.por_conteudo };
  if (a?.duravel) await a.config.salvar(ACCOUNT.ig_id, { [chaveMes(mes)]: doc });
  else memoria.set(mes, doc);
}
const pendente = (mes, conteudo) => [...reservas.values()].filter((r) => r.mes === mes && (conteudo == null || r.conteudo_id === conteudo)).reduce((s, r) => s + r.custo, 0);

/**
 * Reserva o gasto previsto. Recusa com ImagemTeto ANTES de qualquer chamada à API.
 * @returns {Promise<{id:number, mes:string, conteudo_id:string, custo:number}>}
 */
async function reservar({ conteudo_id, custo }, deps = {}) {
  if (!conteudo_id) throw new Error('reservar: falta conteudo_id.');
  if (!(custo >= 0)) throw new Error('reservar: custo inválido.');
  const mes = mesSP(deps.agora);
  const lim = limites();
  const g = await ler(mes, deps);
  const doConteudo = (g.por_conteudo[conteudo_id] || 0) + pendente(mes, conteudo_id);
  if (doConteudo + custo > lim.carrossel + 1e-9) throw new ImagemTeto({ tipo: 'carrossel', gasto: arredonda(doConteudo), teto: lim.carrossel, pedido: custo });
  const doMes = g.total + pendente(mes);
  if (doMes + custo > lim.mes + 1e-9) throw new ImagemTeto({ tipo: 'mes', gasto: arredonda(doMes), teto: lim.mes, pedido: custo });
  const r = { id: ++seq, mes, conteudo_id, custo };
  reservas.set(r.id, r);
  return r;
}

// Confirma o gasto real (pode diferir da reserva) depois do sucesso.
async function registrar(reserva, custoReal, deps = {}) {
  const r = reservas.get(reserva?.id);
  if (!r) return null;
  reservas.delete(r.id);
  const valor = Number.isFinite(custoReal) ? custoReal : r.custo;
  const g = await ler(r.mes, deps);
  g.total += valor;
  g.por_conteudo[r.conteudo_id] = arredonda((g.por_conteudo[r.conteudo_id] || 0) + valor);
  await gravar(r.mes, g, deps);
  return { mes: r.mes, gasto_mes: arredonda(g.total), gasto_conteudo: g.por_conteudo[r.conteudo_id] };
}

// Devolve a reserva quando a geração falhou ou foi recusada (nada foi cobrado).
function liberar(reserva) { reservas.delete(reserva?.id); }

/** Gasto do mês, tetos e restante. */
async function resumo(deps = {}) {
  const mes = mesSP(deps.agora);
  const lim = limites();
  const g = await ler(mes, deps);
  const gasto = arredonda(g.total + pendente(mes));
  return { mes, gasto_mes: gasto, teto_mes: lim.mes, restante_mes: arredonda(Math.max(0, lim.mes - gasto)), teto_carrossel: lim.carrossel, guardado_no_banco: g.duravel };
}

const ligada = () => process.env.IMAGEM_OPENAI_LIGADA === '1';

/**
 * Reserva, gera e registra. Devolve { png, custo_usd, modelo } ou lança ImagemDesligada, ImagemSemChave, ImagemTeto,
 * ImagemRecusada ou ImagemFalhou. Tudo injetável em `deps` (gerarFundo, armazem, agora, ligada, chave, fetcher).
 */
async function fundoComTeto({ conteudo_id, prompt, qualidade = 'medium', tamanho = '1024x1536', modelo, deps = {} } = {}) {
  if (!(deps.ligada ? deps.ligada() : ligada())) throw new ImagemDesligada();
  if (!(deps.chave || process.env.OPENAI_API_KEY)) throw new ImagemSemChave();
  const m = modelo || process.env.OPENAI_IMAGE_MODEL || MODELO_PADRAO;
  const reserva = await reservar({ conteudo_id, custo: custoImagem(m, qualidade) }, deps);
  try {
    const gerar = deps.gerarFundo || gerarFundo;
    const r = await gerar({ prompt, qualidade, tamanho, modelo: m, fetcher: deps.fetcher, chave: deps.chave });
    await registrar(reserva, r.custo_usd, deps);
    return { png: r.png, custo_usd: r.custo_usd, modelo: r.modelo || m };
  } catch (e) {
    liberar(reserva);
    throw e;
  }
}

// Só para teste: zera memória do processo e reservas.
function _zerar() { memoria.clear(); reservas.clear(); }

module.exports = { reservar, registrar, liberar, resumo, fundoComTeto, limites, mesSP, ligada, _zerar, TETO_CARROSSEL_PADRAO, TETO_MES_PADRAO };
