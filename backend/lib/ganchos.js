// Mais ganchos: dez candidatos de capa para o mesmo assunto, filtrados e ordenados pelo CÓDIGO.
// A IA escreve (duas por fórmula nomeada); o código descarta o que copia exemplo ou post recente,
// o que traz número que os fatos não têm, o que repete outro candidato, e ordena por verificações
// objetivas. Não existe "nota de viralização": o júri é uma lista de sim/não que o Pedro vê.
const HG = require('../../static/hookGuard');
const M = require('../../static/contentModel');

const dig = (s) => String(s || '').replace(/[^\d]/g, '');

async function gerarGanchos({ assunto, angulo = '', claims = [], recentes = [], n = 10 }, d0) {
  const d = d0 || { llmJson: require('./llmJson') };
  const fatos = claims.filter((c) => c && c.id && c.texto);
  if (!fatos.length) throw Object.assign(new Error('Não há afirmação sustentada para escrever ganchos. Confira os fatos primeiro.'), { code: 'ENTRADA' });
  const contra = (recentes || []).map((r) => String(r).split(/\n/)[0]).filter(Boolean);
  const ids = new Set(fatos.map((f) => f.id));
  const lista = d.llmJson.dado('FATOS_CONFERIDOS', JSON.stringify(fatos.map((f) => ({ id: f.id, texto: f.texto }))), 6000);
  const rec = d.llmJson.dado('POSTS_RECENTES_DO_PERFIL', contra.slice(0, 6).join('\n'), 900);

  const { dados, llm } = await d.llmJson.pedirJson({
    temperatura: 0.8,
    maxTokens: 1800,
    sistema: `Você escreve ganchos de capa em português do Brasil para um perfil de política, economia e negócios para quem trabalha e empreende.\n\n${d.llmJson.REGRAS_DADOS}`,
    usuario: `Assunto: ${String(assunto || '').slice(0, 200)}${angulo ? `\nÂngulo: ${String(angulo).slice(0, 200)}` : ''}

Escreva ${n} ganchos de capa (até 10 palavras cada), 2 por fórmula, usando SÓ os fatos abaixo. Todo número do gancho precisa estar num fato e o gancho aponta o id (claim_ids). Nada de número, nome ou acontecimento que os fatos não tragam.
Fórmulas: ${Object.entries(HG.FORMULAS).map(([k, f]) => `${k} = ${f.nome} (${f.dica})`).join('; ')}.
NÃO copie nem parafraseie: ${HG.proibidos().map((x) => `“${x.texto}”`).join(' · ')}. Não repita a abertura dos posts recentes.

${lista.bloco}
${rec.bloco}

Responda APENAS JSON: {"ganchos":[{"formula":"numero_grande","texto":"","claim_ids":["a1"]}]}`,
  });

  const descartados = [];
  const aceitos = [];
  for (const g of Array.isArray(dados?.ganchos) ? dados.ganchos : []) {
    const texto = String(g?.texto || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!texto) continue;
    const claimIds = [...new Set((Array.isArray(g.claim_ids) ? g.claim_ids : []).map(String).filter((i) => ids.has(i)))];
    const v = HG.verificar(texto, { contra });
    if (!v.ok) { descartados.push({ texto, motivo: v.motivo }); continue; }
    // Número que os fatos ligados não têm = inventado.
    const permitidos = new Set(claimIds.flatMap((id) => { const f = fatos.find((x) => x.id === id); return M.extrairNumeros(f.texto).map((q) => dig(q.raw)); }));
    const inventado = M.extrairNumeros(texto).map((q) => dig(q.raw)).find((x) => x && !permitidos.has(x));
    if (inventado !== undefined) { descartados.push({ texto, motivo: claimIds.length ? 'Traz um número que os fatos ligados não têm.' : 'Traz número sem apontar o fato de onde vem.' }); continue; }
    if (aceitos.some((a) => HG.similaridade(a.texto, texto) >= HG.LIMITE_PADRAO)) { descartados.push({ texto, motivo: 'Repete outro candidato.' }); continue; }
    const checks = HG.checks(texto, { contra });
    const pedida = HG.FORMULAS[g.formula] ? g.formula : null;
    const formula = pedida && HG.FORMULAS[pedida].teste(texto) ? pedida : HG.detectarFormula(texto);   // a fórmula pedida só vale se o texto tiver essa forma
    aceitos.push({ texto, formula, formula_pedida: pedida, claim_ids: claimIds, checks });
  }

  // Ordem: mais verificações atendidas; empate → mais curto. As 3 primeiras tentam fórmulas diferentes.
  aceitos.sort((a, b) => b.checks.ok - a.checks.ok || a.checks.palavras - b.checks.palavras);
  const top = [];
  const usadas = new Set();
  for (const a of aceitos) { if (top.length < 3 && !usadas.has(a.formula)) { top.push(a); usadas.add(a.formula); } }
  for (const a of aceitos) { if (top.length < 3 && !top.includes(a)) top.push(a); }
  const outros = aceitos.filter((a) => !top.includes(a));
  return {
    top, outros, descartados, llm,
    aviso: 'Ordenado por verificações objetivas (curto, concreto, sem clichê, original). Não é previsão de alcance.',
  };
}

module.exports = { gerarGanchos };
