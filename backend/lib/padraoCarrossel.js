// Padrão único de criação de carrosséis: "Pedro Destrava — Minimalista" (pedro_minimalista_estrategico_v1).
// Toda criação NOVA de carrossel (estúdio, mesa, lote, esteira, Radar, regeneração) passa por aqui para saber o modelo.
// Os modelos antigos continuam LEGÍVEIS (histórico, edição dos já criados, exportação), mas não criam carrossel novo.
//
// Reversão técnica (sem mexer em código nem em dados): CARROSSEL_PADRAO=legado no ambiente do servidor
// devolve as rotas e telas antigas de criação. Nada criado no padrão novo é apagado ou convertido na reversão.
const ID = 'pedro_minimalista_estrategico_v1';
const NOME = 'Pedro Destrava — Minimalista';
const LEGADOS = Object.freeze({ editorial: 'Negócios que você não viu (editorial)', minimalista: 'Estratégia por trás (minimalista anterior)', ideias: 'Ideias de negócio (série antiga)' });

const legado = () => String(process.env.CARROSSEL_PADRAO || '').trim().toLowerCase() === 'legado';
const atual = () => (legado() ? null : ID);
const ehV1 = (template) => template === ID;

function info() {
  return { id: ID, nome: NOME, ativo: !legado(), reversao: legado() ? 'ativa: CARROSSEL_PADRAO=legado' : 'desligada', legados: LEGADOS };
}

// Erro padronizado para rotas de criação dos modelos antigos.
function erroLegado(rota = '') {
  return Object.assign(new Error(`Os modelos antigos de carrossel foram substituídos pelo ${NOME}. Crie a partir de uma pauta ou link (Radar → Nova pauta).`), {
    status: 409, code: 'PADRAO_V1', padrao: ID, rota, nova_rota: '/api/radar/pautas',
  });
}

// Middleware: bloqueia a criação pelos modelos antigos enquanto o padrão novo está ativo.
function bloquearCriacaoLegada(rota) {
  return (req, res, next) => {
    if (legado()) return next();
    const e = erroLegado(rota);
    res.status(409).json({ error: e.message, erro: e.message, codigo: e.code, padrao: ID, nome: NOME, nova_rota: e.nova_rota });
  };
}

module.exports = { ID, NOME, LEGADOS, atual, ehV1, legado, info, erroLegado, bloquearCriacaoLegada };
