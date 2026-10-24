// Guarda de ganchos (capas): impede copiar exemplos do playbook ou posts já publicados, e dá
// verificações objetivas (curto, concreto, sem clichê) em vez de uma "nota". Puro e sem rede;
// roda no navegador (revisão) e no servidor (geração de texto).
//
// Semelhança = coeficiente de Dice sobre trigramas de caracteres do texto normalizado
// (minúsculas, sem acento, só letras e números). 1 = igual; limite padrão 0,8.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./viralPlaybook') : root.ViralPlaybook);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HookGuard = api;
})(typeof self !== 'undefined' ? self : this, function (PB) {
  const LIMITE_PADRAO = 0.8;

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => semAcento(s).toLowerCase().replace(/\*\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const palavras = (s) => String(s || '').replace(/\*\*/g, '').trim().split(/\s+/).filter(Boolean);

  function trigramas(s) {
    const t = ` ${norm(s)} `;
    const out = new Set();
    for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
    return out;
  }
  function similaridade(a, b) {
    const na = norm(a); const nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    // Um contém o outro (mudança de pontuação ou de um adjetivo não escapa da guarda).
    if (Math.min(na.length, nb.length) >= 20 && (na.includes(nb) || nb.includes(na))) return 1;
    const A = trigramas(a); const B = trigramas(b);
    let inter = 0;
    A.forEach((x) => { if (B.has(x)) inter += 1; });
    return Math.round(((2 * inter) / (A.size + B.size)) * 1000) / 1000;
  }

  // Ganchos que a ferramenta já publicou e que não renderam nada (0 envios): também não voltam.
  const JA_PUBLICADOS = [
    'Promoção de 50% quase nunca traz economia real',
    'R$100 de 1994 só valem R$11,19 hoje',
  ];
  const exemplosDoPlaybook = () => (PB ? Object.values(PB.GANCHOS || {}).map((g) => g.exemplo) : []);
  const proibidos = () => [...exemplosDoPlaybook().map((texto) => ({ texto, origem: 'exemplo do playbook' })), ...JA_PUBLICADOS.map((texto) => ({ texto, origem: 'gancho já publicado sem resultado' }))];

  // Compara um gancho com os exemplos fixos e com `contra` ([{ texto, origem }] ou strings:
  // posts já publicados, capas recentes). Devolve o mais parecido.
  function verificar(texto, { contra = [], limite = LIMITE_PADRAO, soContra = false } = {}) {
    let pior = { similaridade: 0, texto: null, origem: null };
    for (const c of [...(soContra ? [] : proibidos()), ...contra.map((x) => (typeof x === 'string' ? { texto: x, origem: 'post já publicado' } : x))]) {
      if (!c || !c.texto) continue;
      const s = similaridade(texto, c.texto);
      if (s > pior.similaridade) pior = { similaridade: s, texto: c.texto, origem: c.origem || 'post já publicado' };
    }
    if (pior.similaridade >= limite) return { ok: false, similaridade: pior.similaridade, parecido_com: pior.texto, origem: pior.origem, motivo: `Muito parecido com ${pior.origem}: “${String(pior.texto).slice(0, 80)}”. Escreva um gancho novo para este assunto.` };
    return { ok: true, similaridade: pior.similaridade, parecido_com: pior.similaridade > 0.5 ? pior.texto : null, origem: pior.origem, motivo: null };
  }

  // Fórmulas nomeadas. `teste` só reconhece o formato do texto; não diz se é bom.
  // Ordem = prioridade na detecção: as formas específicas vêm antes de "número grande" (basta ter um dígito).
  const FORMULAS = {
    antes_depois: { nome: 'Antes e depois', dica: 'dois momentos com o mesmo objeto (antes × hoje) e o que mudou', teste: (t) => /\d/.test(t) && /\b(antes|hoje|agora|depois|desde|em (19|20)\d\d)\b/i.test(semAcento(t)) },
    quanto_sobra: { nome: 'Quanto sobra', dica: 'quanto fica no bolso depois de imposto, taxa, juros ou preço', teste: (t) => /\b(sobra|sobrou|sobram|fica com|leva|come|pesa|custa|paga)\b/i.test(semAcento(t)) },
    contraintuitiva: { nome: 'Afirmação contraintuitiva', dica: 'contrarie o que a maioria acha, de forma que dê vontade de conferir', teste: (t) => /\b(nao|nunca|quase nunca|ao contrario|engano|mentira|ilusao)\b/i.test(semAcento(t)) },
    pergunta_que_doi: { nome: 'Pergunta que dói', dica: 'uma pergunta sobre o dinheiro ou o trabalho de quem lê, que ele não sabe responder', teste: (t) => /\?/.test(t) },
    numero_grande: { nome: 'Número grande', dica: 'abra com um número exato (R$, %, ano) e diga o que ele faz com o bolso de quem lê', teste: (t) => /\d/.test(t) },
  };
  const detectarFormula = (texto) => Object.keys(FORMULAS).find((k) => FORMULAS[k].teste(texto)) || null;

  const GENERICO = /^(como|por que|porque|o que|veja|saiba|entenda|confira)\b[^?]*\?*$/i;
  const CLICHES = (PB && PB.CLICHES) || [];

  // Verificações objetivas de uma capa. Não há nota: cada item diz sim ou não.
  function checks(texto, { contra = [], max = 10 } = {}) {
    const n = palavras(texto).length;
    const t = norm(texto);
    const v = verificar(texto, { contra });
    const lista = [
      { id: 'curto', ok: n > 0 && n <= max, label: `Até ${max} palavras (${n})` },
      { id: 'concreto', ok: /\d/.test(texto) || !!detectarFormula(texto), label: 'Tem número ou uma forma clara de gancho' },
      { id: 'sem_cliche', ok: !CLICHES.some((c) => t.includes(norm(c))) && !GENERICO.test(String(texto).replace(/\*\*/g, '').trim()), label: 'Sem clichê nem abertura genérica' },
      { id: 'original', ok: v.ok, label: v.ok ? 'Não copia exemplo nem post já publicado' : v.motivo },
    ];
    return { formula: detectarFormula(texto), palavras: n, itens: lista, ok: lista.filter((x) => x.ok).length, total: lista.length };
  }

  return { similaridade, verificar, checks, detectarFormula, FORMULAS, proibidos, norm, LIMITE_PADRAO, JA_PUBLICADOS };
});
