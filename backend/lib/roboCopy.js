// ── Robô de copy (sem IA) ─────────────────────────────────────────────────────
// Gera a ESTRUTURA de um carrossel sem chamar modelo nenhum: framework de copy,
// gancho, ritmo das telas, CTA, legenda e hashtags. Tudo fórmula determinística.
//
// O que ele NÃO faz de propósito: inventar fato, número ou explicação sobre o
// tema. Sem IA não há como saber se seria verdade, e post com dado falso é pior
// que post nenhum. Onde entra o fato específico, o robô deixa um marcador para
// você preencher — o resto vem pronto.
//
// Usado como último degrau da cascata de IA (quando todos os provedores falham)
// e também sob demanda, com `modo: 'robo'`, para economizar cota de propósito.

// ── Aleatoriedade determinística ──────────────────────────────────────────────
// Mesmo tema + mesma variante = mesmo resultado. Trocar a variante gera outra
// versão do mesmo tema, o que permite "gerar de novo" sem repetir.
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function criarSorteio(semente) {
  const rand = mulberry32(semente);
  return {
    rand,
    escolher: (arr) => arr[Math.floor(rand() * arr.length)],
    // Escolhe n itens distintos, preservando variedade entre telas.
    escolherVarios: (arr, n) => {
      const copia = [...arr];
      const out = [];
      while (out.length < n && copia.length) {
        out.push(copia.splice(Math.floor(rand() * copia.length), 1)[0]);
      }
      // Se pedirem mais do que existe, recicla mantendo a ordem embaralhada.
      while (out.length < n) out.push(arr[out.length % arr.length]);
      return out;
    },
  };
}

// ── Extração de tema ──────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','do','da','dos','das','em','no','na','nos','nas',
  'por','para','pra','com','sem','sobre','entre','até','após','ante','e','ou','mas','que','se','como',
  'quando','onde','porque','porquê','qual','quais','quem','meu','minha','seu','sua','nosso','nossa',
  'este','esta','esse','essa','aquele','aquela','isso','isto','aquilo','ao','à','às','aos','é','ser',
  'está','são','foi','tem','ter','mais','menos','muito','pouco','já','ainda','não','sim','você','voce',
]);

// STOPWORDS sem acento, para comparar com o texto já normalizado.
const STOPWORDS_NORM = new Set(
  [...STOPWORDS].map(w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
);

function palavrasChave(texto, limite = 4) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 2 && !STOPWORDS_NORM.has(p))
    .slice(0, limite);
}

// "como vender mais na internet" → "vender mais na internet"
function nucleoDoTema(topic) {
  const limpo = String(topic || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return 'esse assunto';
  return limpo
    .replace(/^(como|o que|por que|porque|quais|qual|quando|onde|dicas de|guia de)\s+/i, '')
    .replace(/[.?!]+$/, '')
    .trim() || limpo;
}

// Conectores que não podem FECHAR um título ("...real de", "...trava na").
// É um conjunto menor que STOPWORDS de propósito: palavras como "mais" são
// stopword para busca, mas carregam sentido no título e devem ficar.
const CONECTORES_FINAIS = new Set([
  'de','do','da','dos','das','em','no','na','nos','nas','ao','à','às','aos',
  'por','pra','para','com','sem','sobre','entre','e','ou','que','a','o',
]);

// Versão curta do tema, para caber em título sem cortar frase no meio.
// "vender mais na internet" → "vender mais"
function nucleoCurto(nucleo, max = 3) {
  const palavras = String(nucleo || '').split(/\s+/).filter(Boolean);
  if (palavras.length <= max) return nucleo;
  const corte = palavras.slice(0, max);
  while (corte.length > 1 && CONECTORES_FINAIS.has(corte[corte.length - 1].toLowerCase())) corte.pop();
  return corte.join(' ');
}

function capitalizar(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// Corta no limite de palavras sem cortar palavra pela metade.
function limitarPalavras(texto, max) {
  const p = String(texto || '').trim().split(/\s+/);
  return p.length <= max ? p.join(' ') : p.slice(0, max).join(' ');
}

// ── Bancos de copy ────────────────────────────────────────────────────────────
const GANCHOS = [
  t => `A verdade sobre ${t}`,
  t => `O que ninguém te conta sobre ${t}`,
  t => `Você está errando em ${t}`,
  t => `${capitalizar(t)} não funciona como te falaram`,
  t => `O erro que trava ${t}`,
  t => `Por que ${t} parece impossível`,
  t => `Ninguém explica ${t} desse jeito`,
  t => `O lado de ${t} que te escondem`,
];

const SUBTITULOS = [
  'Arrasta pro lado',
  'Leia até o fim',
  'O terceiro ponto surpreende',
  'Salva pra não esquecer',
  'Vale os 30 segundos',
];

// Cada framework é uma sequência de papéis. Cada papel sabe montar título e
// corpo a partir do tema — o corpo é conselho estrutural verdadeiro (vale para
// qualquer assunto) mais um marcador para o fato específico.
const FRAMEWORKS = {
  pas: {
    nome: 'Problema → Agitação → Solução',
    papeis: [
      {
        titulo: t => `O problema real de ${t}`,
        corpo: t => `Quase todo mundo trata ${t} como se fosse questão de esforço. Não é. O problema aparece bem antes disso, na forma como a coisa foi montada desde o começo.`,
      },
      {
        titulo: () => 'Por que isso te trava',
        corpo: t => `Enquanto a causa continua ali, cada tentativa nova em ${t} gasta sua energia e devolve o mesmo resultado. É por isso que parece que você anda e não sai do lugar.`,
      },
      {
        titulo: () => 'O erro mais comum',
        corpo: t => `A reação natural é tentar mais forte e mais rápido. Só que fazer mais da mesma coisa em ${t} acelera o problema em vez de resolver.`,
      },
      {
        titulo: () => 'O que muda o jogo',
        corpo: t => `Antes de tentar de novo, olhe o que está causando o travamento em ${t}. Resolver a causa uma vez economiza meses de tentativa e erro.`,
      },
      {
        titulo: () => 'Comece por aqui',
        corpo: t => `Escolha só um ponto de ${t} e ajuste ele essa semana. Um ponto resolvido de verdade rende mais que cinco mudanças pela metade.`,
      },
      {
        titulo: () => 'Como saber que deu certo',
        corpo: t => `O sinal não é sentir motivação, é o esforço diminuir. Quando ${t} começa a exigir menos de você para render igual, o ajuste pegou.`,
      },
      {
        titulo: () => 'O que fazer se travar',
        corpo: t => `Travar no meio de ${t} não significa que você escolheu errado. Na maior parte das vezes significa que o passo atual está grande demais para o momento.`,
      },
      {
        titulo: () => 'O que ninguém te avisa',
        corpo: t => `A parte difícil de ${t} não é começar, é continuar depois que a novidade passa. Quem se prepara para esse trecho chega do outro lado.`,
      },
    ],
  },

  lista: {
    nome: 'Lista de pontos',
    papeis: [
      {
        titulo: t => `O básico de ${t}`,
        corpo: t => `Antes de qualquer técnica, ${t} depende de uma base bem feita. Pular essa parte é o motivo mais comum de o resto não funcionar depois.`,
      },
      {
        titulo: () => 'O que dá resultado rápido',
        corpo: t => `Existe sempre um ajuste em ${t} que rende muito e custa pouco. Ele costuma ser o mais óbvio — e justamente por isso é o mais ignorado.`,
      },
      {
        titulo: () => 'O que só atrapalha',
        corpo: t => `Boa parte do que se fala sobre ${t} é enfeite. Some tempo, some atenção e não move o resultado um centímetro.`,
      },
      {
        titulo: () => 'O detalhe que separa',
        corpo: t => `Quem vai bem em ${t} costuma fazer o mesmo que todo mundo, só que com consistência. A diferença está na repetição, não no segredo.`,
      },
      {
        titulo: () => 'O que fazer ainda hoje',
        corpo: t => `Não espere estar pronto para mexer em ${t}. Comece pequeno, no menor pedaço possível, e ajuste com o que aparecer no caminho.`,
      },
      {
        titulo: () => 'O erro de quem começa',
        corpo: t => `Tentar dominar ${t} inteiro de uma vez é o caminho mais rápido pra desistir. Um pedaço por vez chega mais longe, mesmo parecendo devagar no início.`,
      },
      {
        titulo: () => 'O que dá pra ignorar',
        corpo: t => `Nem tudo em ${t} merece sua atenção agora. Escolher o que deixar de lado é tão importante quanto escolher o que fazer primeiro.`,
      },
      {
        titulo: () => 'Como manter no longo prazo',
        corpo: t => `O que sustenta ${t} não é empolgação, é rotina. Um ritmo que você aguenta em semana ruim vale mais que um ritmo perfeito por três dias.`,
      },
    ],
  },

  mitoVerdade: {
    nome: 'Mito × Verdade',
    papeis: [
      {
        titulo: () => 'O que te falaram',
        corpo: t => `A versão que circula por aí sobre ${t} é simples, redonda e fácil de repetir. É justamente por isso que ela pegou.`,
      },
      {
        titulo: () => 'Por que soa convincente',
        corpo: t => `A explicação fácil de ${t} não é burrice, é atalho. O cérebro prefere uma resposta pronta a uma resposta certa e complicada.`,
      },
      {
        titulo: () => 'O que realmente acontece',
        corpo: t => `Na prática, ${t} tem mais de uma peça envolvida. Quando você olha uma de cada vez, a explicação simples não para em pé.`,
      },
      {
        titulo: () => 'A diferença na prática',
        corpo: t => `Acreditar na versão errada de ${t} faz você investir esforço no lugar errado. O gasto é o mesmo, o retorno não.`,
      },
      {
        titulo: () => 'Como não cair de novo',
        corpo: t => `Toda vez que ouvir algo redondo demais sobre ${t}, pergunte o que sustenta aquilo. Explicação que se apoia em fato aguenta pergunta; a que se apoia em repetição, não.`,
      },
      {
        titulo: () => 'Quem ganha com o mito',
        corpo: t => `Versão simplificada de ${t} costuma servir a alguém: vende mais fácil, ensina mais rápido, rende mais engajamento. Vale perguntar a quem interessa.`,
      },
      {
        titulo: () => 'O meio termo honesto',
        corpo: t => `A resposta real sobre ${t} quase nunca é oito ou oitenta. Depende do contexto, e aceitar isso já te coloca à frente de quem repete slogan.`,
      },
      {
        titulo: () => 'O que fazer com isso',
        corpo: t => `Não precisa jogar fora tudo que você sabia sobre ${t}. Basta parar de tratar a versão simples como regra e começar a testar no seu caso.`,
      },
    ],
  },

  passoAPasso: {
    nome: 'Passo a passo',
    papeis: [
      {
        titulo: () => 'Antes de começar',
        corpo: t => `Defina o que significa dar certo em ${t} pra você. Sem esse alvo, qualquer resultado parece pouco e você desiste no meio.`,
      },
      {
        titulo: () => 'O primeiro passo',
        corpo: t => `Comece pela menor ação possível dentro de ${t} — aquela que dá pra fazer hoje, sem preparar nada. Movimento vale mais que plano perfeito.`,
      },
      {
        titulo: () => 'Onde quase todo mundo para',
        corpo: t => `O ponto de desistência em ${t} chega quando o esforço continua e o resultado ainda não apareceu. É normal, e passa.`,
      },
      {
        titulo: () => 'Como atravessar',
        corpo: t => `Reduza o tamanho do passo em vez de aumentar a força de vontade. Em ${t}, constância pequena vence intensidade curta.`,
      },
      {
        titulo: () => 'Quando acelerar',
        corpo: t => `Só aumente o ritmo em ${t} depois que o passo atual virar automático. Acelerar antes disso quebra o que já estava funcionando.`,
      },
      {
        titulo: () => 'O que manter pra sempre',
        corpo: t => `Guarde o hábito, não a técnica. Técnica de ${t} muda com o tempo, o hábito de revisar e ajustar é o que continua rendendo.`,
      },
      {
        titulo: () => 'O erro de pular etapa',
        corpo: t => `Pular passo em ${t} parece economia de tempo e quase sempre cobra depois, na forma de retrabalho. O caminho curto costuma ser o caminho feito na ordem.`,
      },
      {
        titulo: () => 'Como medir o avanço',
        corpo: t => `Escolha um sinal simples de progresso em ${t} e acompanhe só ele. Medir demais confunde tanto quanto não medir nada.`,
      },
    ],
  },
};

const CTAS = [
  { titulo: 'Você já tinha percebido isso?', corpo: h => `Comenta aqui embaixo e segue ${h} pra ver mais` },
  { titulo: 'Salva pra não esquecer', corpo: h => `Segue ${h}, salva esse post e compartilha com alguém` },
  { titulo: 'Manda pra quem precisa ver', corpo: h => `Compartilha, salva e segue ${h} pra não perder os próximos` },
  { titulo: 'Gostou disso?', corpo: h => `Segue ${h}, salva e compartilha com quem precisa` },
];

const HASHTAGS_BASE = [
  '#dicas', '#conteudo', '#aprendizado', '#brasil', '#foco',
  '#produtividade', '#mentalidade', '#crescimento', '#pratica',
];

// ── Geração ───────────────────────────────────────────────────────────────────

// Marcador que sinaliza onde entra o fato específico do tema.
const MARCADOR = '[troque por um exemplo ou número real]';

function montarLegenda({ tema, nucleo, sorteio, handle, chaves }) {
  const aberturas = [
    `🚀 ${capitalizar(nucleo)}: o que quase ninguém te explica.`,
    `👀 Você provavelmente está errando em ${nucleo}.`,
    `🔥 A parte de ${nucleo} que ninguém comenta.`,
    `💡 ${capitalizar(nucleo)} fica bem mais simples assim.`,
  ];
  const meios = [
    `Separei o essencial em telas curtas. Vale arrastar até o fim — o ponto que mais muda o jogo está lá.`,
    `A ideia aqui não é te dar mais informação, é te dar ordem. Faz diferença.`,
    `Se você já tentou e travou, provavelmente foi em um desses pontos.`,
  ];
  const fechamentos = [
    `Salva pra consultar depois e manda pra alguém que precisa ver isso. 👇`,
    `Comenta o que você faria diferente. Quero ler. 👇`,
    `Segue ${handle} que todo dia tem conteúdo assim por aqui. 👇`,
  ];

  const tags = [
    ...chaves.map(p => '#' + p),
    ...sorteio.escolherVarios(HASHTAGS_BASE, 3),
  ];
  const tagsUnicas = [...new Set(tags)].slice(0, 5);

  return [
    sorteio.escolher(aberturas),
    '',
    sorteio.escolher(meios),
    '',
    sorteio.escolher(fechamentos),
    '',
    tagsUnicas.join(' '),
  ].join('\n');
}

/**
 * Gera um carrossel completo sem usar IA.
 * Devolve o mesmo formato de generateCarouselContent: { topic, caption, slides }.
 *
 * @param {object}  opts
 * @param {string}  opts.topic       tema pedido pelo usuário
 * @param {string}  opts.theme       categoria, usada se não houver topic
 * @param {number}  opts.slideCount  total de telas (5 a 10)
 * @param {string}  opts.handle      @ do perfil, usado no CTA
 * @param {number}  opts.variante    muda o sorteio mantendo o mesmo tema
 * @param {boolean} opts.marcadores  inclui o marcador de fato (padrão: true)
 */
function gerarCarrossel({ topic, theme, slideCount = 7, handle = '@pedro_destrava', variante = 0, marcadores = true } = {}) {
  const tema = (topic || theme || '').trim();
  const nucleo = nucleoDoTema(tema);
  const n = Math.max(5, Math.min(10, Number(slideCount) || 7));
  const qtdConteudo = n - 2; // capa + CTA são fixas

  const sorteio = criarSorteio(hashString(`${tema}|${variante}`));
  const curto = nucleoCurto(nucleo);

  const chavesFramework = Object.keys(FRAMEWORKS);
  const framework = FRAMEWORKS[sorteio.escolher(chavesFramework)];

  // Capa
  const gancho = sorteio.escolher(GANCHOS)(curto);
  const capa = {
    kind: 'cover',
    title: gancho,
    subtitle: sorteio.escolher(SUBTITULOS),
  };

  // Telas de conteúdo — EM ORDEM. O framework tem lógica sequencial
  // (problema antes da agitação, agitação antes da solução); embaralhar
  // destruiria o encadeamento. A variedade vem da escolha do framework.
  // Se o framework tiver menos papéis que o pedido, recicla mantendo a ordem —
  // garante a contagem de telas mesmo que um banco seja encurtado no futuro.
  const papeis = Array.from({ length: qtdConteudo },
    (_, i) => framework.papeis[i % framework.papeis.length]);
  const conteudo = papeis.map((papel, i) => {
    let corpo = papel.corpo(nucleo);
    if (marcadores && i === 0) corpo += ` ${MARCADOR}`;
    return {
      kind: 'content',
      number: String(i + 1).padStart(2, '0'),
      title: papel.titulo(curto),
      body: corpo,
    };
  });

  // CTA
  const cta = sorteio.escolher(CTAS);
  const telaCta = { kind: 'cta', title: cta.titulo, body: cta.corpo(handle) };

  const chaves = palavrasChave(tema, 3);

  return {
    topic: tema ? capitalizar(tema) : capitalizar(nucleo),
    caption: montarLegenda({ tema, nucleo, sorteio, handle, chaves }),
    slides: [capa, ...conteudo, telaCta],
    fonte: 'robo',
    framework: framework.nome,
  };
}

module.exports = {
  gerarCarrossel,
  // exportados para teste e reuso
  nucleoDoTema,
  nucleoCurto,
  palavrasChave,
  limitarPalavras,
  FRAMEWORKS,
  MARCADOR,
};
