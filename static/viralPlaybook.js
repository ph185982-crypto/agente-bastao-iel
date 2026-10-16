// Playbook de viralização do @pedro_destrava: o que a pesquisa de mercado
// (22 perfis, ~520 posts, out/2026) e o próprio perfil mostraram que funciona.
// Fonte única pras regras: o redator usa no prompt, a nota de viralização
// usa pra avaliar, o front mostra as dicas. Roda no navegador e no Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ViralPlaybook = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Modelos de post estático. telas = [mín, máx] recomendados.
  const TEMPLATES = {
    antes_agora: {
      nome: 'Antes × Agora', telas: [4, 7], numero: true,
      quando: 'comparação com número concreto que mexe no bolso (preço, salário, inflação, antes e hoje)',
      referencia: 'seu recorde: nota de R$ 100 de 1994 vale R$ 11,19 hoje (9,99% dos seguidores)',
    },
    print: {
      nome: 'Print do Pedro', telas: [1, 6], numero: false,
      quando: 'uma frase que contraria o senso comum sobre dinheiro, negócio ou comportamento',
      referencia: 'Thiago Nigro: 158 mil curtidas numa frase; Justin Welsh 1,34% de mediana',
    },
    noticia: {
      nome: 'Notícia humana', telas: [1, 1], numero: true,
      quando: 'história real de uma pessoa ou empresa, com emoção e um número',
      referencia: 'Fatos Desconhecidos: 0,75% de mediana, 212 mil curtidas no topo',
    },
    lista: {
      nome: 'Lista editorial', telas: [4, 7], numero: false,
      quando: 'lições, erros ou sinais numerados, com caso real em cada item',
      referencia: 'Sahil Bloom: 452 mil curtidas num carrossel de 9 telas',
    },
  };

  // Como o Instagram distribui (sinais públicos do próprio Instagram + dados
  // de mercado). Vai no prompt do redator e das pautas.
  const ALGORITMO = [
    'Envio por DM ("manda pra alguém") é o sinal mais forte pra alcançar quem não te segue.',
    'Carrossel ganha segunda chance: quem não arrastou vê a tela 2 de novo no feed. A tela 2 precisa prender sozinha.',
    'Salvamento pesa mais que curtida: conteúdo de referência (número, lista, comparação) é salvo.',
    'Os 2 primeiros segundos decidem: gancho com número concreto ou contradição, até 14 palavras.',
    'Uma ideia por tela, letra grande, leitura no celular.',
    'Comentário com palavra-chave ("comenta X") multiplica comentários e conversa.',
    'Hashtag quase não distribui mais: os líderes usam 0 a 3.',
    'Notícia seca não viraliza; fato com emoção humana ou com o bolso da pessoa, sim.',
  ];

  const GANCHOS = {
    numero_choque: { nome: 'Número que choca', exemplo: 'Seus R$ 100 de 1994 valem R$ 11,19 hoje.' },
    contradicao: { nome: 'Contradição', exemplo: 'Promoção de 50% quase nunca é desconto.' },
    bastidor: { nome: 'Bastidor', exemplo: 'O que a Shopee não te conta sobre o frete grátis.' },
    pergunta_bolso: { nome: 'Pergunta do bolso', exemplo: 'Por que o mercado fica mais caro toda semana?' },
    historia_humana: { nome: 'História humana', exemplo: 'Recusada por 70 famílias, ela virou dona de 3 lojas.' },
    autoridade: { nome: 'Pesquisa própria', exemplo: 'Analisei 30 marcas que quebraram. 8 erros se repetem.' },
  };

  const CTAS = {
    envio: 'Manda pra alguém que precisa ver isso.',
    salvar: 'Salva pra mostrar pra alguém depois.',
    comentario: (palavra) => `Comenta ${palavra} que eu te mando a parte 2.`,
    seguir: 'Segue o @pedro_destrava pra ver a estratégia por trás das coisas.',
  };

  const CLICHES = [
    'você não vai acreditar', 'descubra', 'incrível', 'confira', 'dicas para', 'dicas pra',
    'neste post', 'nesse post', 'segredo do sucesso', 'mude sua vida', 'vem comigo',
  ];

  const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
  const temNumero = (s) => /\d|r\$|%/i.test(String(s || ''));
  const temCta = (s) => /\b(manda|envia|compartilha|marca|comenta|salva|segue)\b/i.test(String(s || ''));

  // Nota de viralização 0-100 com o porquê de cada ponto. Determinística:
  // não depende de IA, então dá pra mostrar e testar.
  // content = { template, hook, slides: [{ texto }], caption, hashtags, fontes }
  function viralScore(content) {
    const tpl = TEMPLATES[content.template] || { telas: [1, 10], numero: false };
    const hook = String(content.hook || '');
    const slides = (content.slides || []).map((s) => String(s.texto || s || ''));
    const caption = String(content.caption || '');
    const hashtags = content.hashtags || (caption.match(/#[\p{L}\p{N}_]+/gu) || []);
    const tudo = [hook, ...slides, caption].join(' ').toLowerCase();
    const n = slides.length || 1;
    const final = `${slides[slides.length - 1] || ''} ${caption}`;
    const precisaFonte = temNumero(hook) || slides.some(temNumero);

    const checks = [
      { peso: 20, ok: temNumero(hook) || !tpl.numero && /\?|não|nunca|ninguém|quase/i.test(hook), label: 'Gancho com número ou contradição', dica: 'Comece com um número exato (R$, %, ano) ou contrarie o senso comum.' },
      { peso: 10, ok: palavras(hook).length > 0 && palavras(hook).length <= 14, label: 'Gancho curto (até 14 palavras)', dica: 'Corte o gancho até caber em 2 segundos de leitura.' },
      { peso: 10, ok: !CLICHES.some((c) => tudo.includes(c)), label: 'Sem clichê de IA', dica: 'Troque "descubra/incrível/dicas pra" por um fato específico.' },
      { peso: 15, ok: n >= tpl.telas[0] && n <= tpl.telas[1], label: `Telas no tamanho certo (${tpl.telas[0]}–${tpl.telas[1]})`, dica: `Esse modelo rende melhor com ${tpl.telas[0]} a ${tpl.telas[1]} telas.` },
      { peso: 10, ok: slides.every((s) => palavras(s).length <= 40), label: 'Uma ideia por tela (até 40 palavras)', dica: 'Divida a tela que está longa demais.' },
      { peso: 15, ok: temCta(final), label: 'CTA de envio, salvamento ou comentário', dica: 'Feche com "Manda pra alguém que…" ou "Comenta PALAVRA".' },
      { peso: 5, ok: hashtags.length <= 3, label: 'No máximo 3 hashtags', dica: 'Hashtag quase não distribui mais; deixe 0 a 3.' },
      { peso: 5, ok: caption.length > 0 && caption.length <= 700, label: 'Legenda enxuta', dica: 'Legenda até ~700 caracteres, primeira linha forte.' },
      { peso: 10, ok: !precisaFonte || (content.fontes || []).length > 0, label: 'Fonte do número citada', dica: 'Cite de onde vem o número (IBGE, Banco Central, empresa…).' },
    ];
    const total = checks.reduce((s, c) => s + c.peso, 0);
    const score = Math.round((checks.filter((c) => c.ok).reduce((s, c) => s + c.peso, 0) / total) * 100);
    return { score, checks: checks.map(({ ok, label, dica, peso }) => ({ ok, label, dica, peso })) };
  }

  // Mistura semanal que o redator de pautas deve buscar (5 posts).
  const MIX_SEMANAL = [
    'antes_agora', 'print', 'lista', 'noticia', 'roteiro',
  ];

  const exemplosDeGancho = () => Object.values(GANCHOS).map((g) => g.exemplo.toLowerCase());

  function resumoParaPrompt() {
    const tpls = Object.entries(TEMPLATES).map(([k, t]) => `- ${k} (${t.nome}, ${t.telas[0]}-${t.telas[1]} telas): ${t.quando}. Referência: ${t.referencia}.`).join('\n');
    const gs = Object.values(GANCHOS).map((g) => `- ${g.nome}: "${g.exemplo}"`).join('\n');
    return `(Os exemplos abaixo só ilustram o mecanismo: NUNCA copie um exemplo como gancho.)\n\nCOMO O ALGORITMO DISTRIBUI:\n${ALGORITMO.map((a) => `- ${a}`).join('\n')}\n\nMODELOS QUE VIRALIZAM:\n${tpls}\n\nTIPOS DE GANCHO:\n${gs}\n\nPROIBIDO: ${CLICHES.join(', ')}.`;
  }

  return { TEMPLATES, ALGORITMO, GANCHOS, CTAS, CLICHES, MIX_SEMANAL, viralScore, resumoParaPrompt, temNumero, exemplosDeGancho };
});
