// Pontuação 0 a 100. A IA só dá NÍVEIS (0 a 3) com uma justificativa curta; os pontos saem dos pesos, em código, e
// três critérios têm teto imposto pela verificação (o que não está comprovado não ganha ponto de "prova").
const llmJson = require('../llmJson');
const C = require('./config');
const U = require('./util');

const PROMPT = `Você avalia ideias de negócio para um perfil brasileiro de empreendedorismo (@pedro_destrava). Para CADA oportunidade abaixo dê um NÍVEL de 0 a 3 por critério, com uma justificativa de até 18 palavras que use só o que está nos dados.

Critérios (0 = nenhum, 1 = fraco, 2 = bom, 3 = excelente):
- novidade: é recente e pouco conhecido do público brasileiro? (história velha ou conhecida = 0 ou 1)
- demanda: há sinais REAIS de que as pessoas querem isso, nos dados verificados? (sem dado verificado, no máximo 1)
- receita: o modelo de receita é claro e simples de explicar?
- compreensao: um leigo entende a ideia em uma frase?
- brasil: dá para testar uma versão no Brasil (mercado, lei, cultura, pagamento)? Seja crítico.
- investimento: dá para testar com baixo ou médio investimento inicial? (3 = poucos milhares de reais; 0 = exige fábrica, licença ou milhões)
- visual: dá uma boa imagem (produto, loja, tela, foto real)? Considere "tem_imagem_real".
- compartilhamento: um empresário mandaria isso para um amigo?
Também devolva "sinais_de_risco" (códigos: piramide, aposta, renda_garantida, enriquecimento_rapido, ilegal, especulacao, patrocinado, franquia) se houver indício nos dados, e "motivo_geral" (1 frase).

Responda APENAS JSON: {"avaliacoes":[{"id":"op_...","niveis":{"novidade":0,"demanda":0,"receita":0,"compreensao":0,"brasil":0,"investimento":0,"visual":0,"compartilhamento":0},"justificativas":{"novidade":"","demanda":"","receita":"","compreensao":"","brasil":"","investimento":"","visual":"","compartilhamento":""},"sinais_de_risco":[],"motivo_geral":""}]}`;

const nivel = (n) => Math.max(0, Math.min(3, Math.round(Number(n) || 0)));

// Tetos impostos pela verificação. Devolve { nivel, limitado_por } — o texto aparece na tela para o Pedro entender.
function limitar(criterio, n, cand) {
  const v = cand.verificacao || {};
  const img = cand.imagem;
  if (criterio === 'demanda') {
    const k = v.demanda_verificada || 0;
    if (k === 0 && n > 1) return { nivel: 1, limitado_por: 'nenhum dado de demanda foi confirmado por fonte oficial ou duas fontes independentes' };
    if (k === 1 && n > 2) return { nivel: 2, limitado_por: 'só um dado de demanda confirmado' };
  }
  if (criterio === 'receita' && !v.modelo_receita_verificado && n > 2) return { nivel: 2, limitado_por: 'o modelo de cobrança não foi confirmado numa fonte' };
  if (criterio === 'novidade' && v.idade?.antigo) return { nivel: 0, limitado_por: 'história antiga' };
  if (criterio === 'novidade' && v.idade?.ano_fundacao && new Date().getUTCFullYear() - v.idade.ano_fundacao >= 4 && n > 2) return { nivel: 2, limitado_por: `empresa de ${v.idade.ano_fundacao}` };
  if (criterio === 'visual') {
    if (!img?.buf_ok && !img?.tipo) return { nivel: 0, limitado_por: 'não há fotografia real do negócio' };
    if (img?.tipo === 'banco_de_imagens' && n > 1) return { nivel: 1, limitado_por: 'só há imagem de banco, que não mostra o negócio' };
  }
  return { nivel: n, limitado_por: null };
}

function aplicar(cand, avaliacao) {
  const niveis = avaliacao?.niveis || {};
  const justificativas = avaliacao?.justificativas || {};
  const criterios = {}; let total = 0;
  for (const [k, peso] of Object.entries(C.PESOS)) {
    const lim = limitar(k, nivel(niveis[k]), cand);
    const pontos = Math.round((peso * lim.nivel) / 3 * 10) / 10;
    criterios[k] = { nivel: lim.nivel, nivel_ia: nivel(niveis[k]), pontos, max: peso, motivo: U.limita(justificativas[k], 160) || null, limitado_por: lim.limitado_por };
    total += pontos;
  }
  const sinais = (Array.isArray(avaliacao?.sinais_de_risco) ? avaliacao.sinais_de_risco : []).filter((s) => s in C.SINAIS_DESCARTE);
  return { criterios, pontuacao: Math.round(total), pontuacao_exata: Math.round(total * 10) / 10, sinais_da_avaliacao: sinais, motivo_geral: U.limita(avaliacao?.motivo_geral, 200) || null };
}

async function avaliarLote(cands, { deps = {} } = {}) {
  if (!cands.length) return { avaliacoes: new Map(), llm: null };
  const pedir = deps.pedirJson || llmJson.pedirJson;
  const material = cands.map((c) => ({
    id: c.id, nome: c.nome, pais: c.pais, categoria: c.categoria, resumo: c.resumo, como_ganha_dinheiro: c.como_ganha_dinheiro,
    adaptacao_brasil: c.adaptacao_brasil, investimento_para_testar: c.investimento_para_testar, tem_imagem_real: !!(c.imagem?.tipo && c.imagem.tipo !== 'banco_de_imagens'),
    dados_verificados: (c.verificacao?.claims || []).filter((k) => k.usavel).map((k) => ({ tipo: k.tipo, afirmacao: k.texto, atribuicao: k.atribuicao })).slice(0, 8),
    existencia_confirmada: !!c.verificacao?.existencia_confirmada, idade: c.verificacao?.idade ? { ano_fundacao: c.verificacao.idade.ano_fundacao, dias_da_historia: c.verificacao.idade.idade_historia_dias } : null,
  }));
  const d = llmJson.dado('OPORTUNIDADES', JSON.stringify(material), 30000);
  const { dados, llm } = await pedir({ sistema: `${PROMPT}\n\n${llmJson.REGRAS_DADOS}`, usuario: d.bloco, maxTokens: 6000, temperatura: 0.2, budget: deps.budget });
  const mapa = new Map((Array.isArray(dados?.avaliacoes) ? dados.avaliacoes : []).filter((a) => a && cands.some((c) => c.id === a.id)).map((a) => [a.id, a]));
  return { avaliacoes: mapa, llm };
}

// Ordena e escolhe as melhores. Só quem foi verificado entra primeiro; sem 5 verificadas, completa com as não confirmadas (marcadas).
function selecionar(cands, { top = C.TOP_PAUTAS, limiar = C.LIMIAR_CARROSSEL, aprendizado = null } = {}) {
  const boost = (c) => (aprendizado?.[c.categoria]?.pontos || 0);
  const ordem = (a, b) => b.pontuacao - a.pontuacao || (b.verificacao.numeros_usaveis?.length || 0) - (a.verificacao.numeros_usaveis?.length || 0) || boost(b) - boost(a) || b.interesse - a.interesse;
  const elegiveis = cands.filter((c) => c.verificacao && c.verificacao.estado !== 'reprovada' && !c.descartada_motivo);
  const verificadas = elegiveis.filter((c) => c.verificacao.estado === 'verificada').sort(ordem);
  const outras = elegiveis.filter((c) => c.verificacao.estado !== 'verificada').sort(ordem);
  const escolhidas = [...verificadas, ...outras].slice(0, top).map((c, i) => ({ ...c, rank: i + 1 }));
  const auto = escolhidas.find((c) => c.verificacao.estado === 'verificada' && c.pontuacao >= limiar && c.verificacao.numeros_usaveis?.length >= 1) || null;
  return { escolhidas, auto };
}

module.exports = { avaliarLote, aplicar, selecionar, limitar, nivel };
