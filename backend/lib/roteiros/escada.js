// Escada de posicionamento dos Reels (decisão do Pedro em 20/11/2026): a base de ~165 mil veio de vídeos virais de
// entretenimento e indignação, não do meio empresarial, e nunca viu um vídeo dele. Então os roteiros começam no topo do
// funil (audiência geral, curiosidade do dia a dia) e sobem um degrau de cada vez até o empreendedor e a prova da consultoria.
// O degrau avança sozinho pelas semanas desde INICIO; ROTEIROS_DEGRAU (1 a 4) fixa um degrau à mão.
const INICIO = Date.parse('2026-11-20T00:00:00-03:00');

const DEGRAUS = {
  1: {
    nome: 'Curiosidade do dia a dia',
    publico: 'audiência geral brasileira (qualquer pessoa que trabalha, compra e paga conta), sem nenhum conhecimento de negócio',
    pauta: 'a estratégia escondida por trás de coisas que todo mundo vive: preço no mercado, promoção, aplicativo de entrega, fila, cartão, assinatura, loja que vive "em liquidação", produto mais caro no meio da prateleira',
    ponte: 'só no fim, numa frase, a leitura do Pedro ("é isso que eu mostro aqui: a estratégia por trás"), sem vender nada e sem falar de consultoria',
    proibido: 'jargão de negócio (escala, margem de contribuição, funil, CAC, ROI, marketplace como tema central), falar com "empresário" ou "dono de loja" no gancho',
  },
  2: {
    nome: 'Dinheiro do bolso',
    publico: 'audiência geral que trabalha e quer ganhar ou guardar mais',
    pauta: 'decisões de dinheiro do dia a dia vistas com olhar de quem vende: juros do parcelado, preço que sobe sem aviso, renda extra, como as empresas te fazem gastar, o que o governo leva em cada compra',
    ponte: 'mostrar que entender o lado de quem vende protege o bolso de quem compra; abrir a ideia de "e se você estivesse do outro lado do balcão?"',
    proibido: 'jargão técnico sem tradução; política partidária sem ponte com o bolso',
  },
  3: {
    nome: 'Do outro lado do balcão',
    publico: 'quem tem ou quer ter um negócio, renda extra ou vende pela internet, falando ainda com a audiência geral',
    pauta: 'o que o dono vê e o cliente não: por que a loja faz X, o erro que quebra pequeno negócio, vender online começando do zero, contas simples de quem vende',
    ponte: 'o Pedro como quem ajuda pequenos negócios a vender mais, com exemplos reais e simples',
    proibido: 'promessa de faturamento; caso de cliente sem autorização',
  },
  4: {
    nome: 'Prova e método',
    publico: 'empreendedor e vendedor de marketplace (o público da consultoria), mantendo a linguagem simples',
    pauta: 'método, bastidor e casos reais da consultoria; erros de quem vende em marketplace; decisões que mudam o resultado da loja',
    ponte: 'chamada leve para o diagnóstico quando fizer sentido',
    proibido: 'números de cliente sem autorização; promessa de resultado',
  },
};

function degrauAtual(agora = Date.now()) {
  const fixo = Number(process.env.ROTEIROS_DEGRAU);
  if (Number.isInteger(fixo) && DEGRAUS[fixo]) return fixo;
  const semanas = Math.floor((agora - INICIO) / (7 * 864e5));
  return semanas < 3 ? 1 : semanas < 6 ? 2 : semanas < 10 ? 3 : 4;
}

/** Bloco para o roteirista e para os fiscais: público, pauta, ponte e o que evitar no degrau atual. */
function bloco(agora = Date.now()) {
  const n = degrauAtual(agora); const d = DEGRAUS[n];
  return `ESCADA DE POSICIONAMENTO: degrau ${n} de 4 · ${d.nome}
A base do @pedro_destrava é de público geral (veio de vídeos virais), não do meio empresarial, e quase ninguém viu um vídeo dele. O vídeo precisa prender quem não conhece o Pedro e posicioná-lo aos poucos como "o cara que mostra a estratégia escondida por trás".
- Público deste degrau: ${d.publico}.
- Como usar a pauta: traduza para ${d.pauta}. Se a pauta for de negócio, conte pelo olhar de quem compra e vive aquilo no dia a dia.
- Ponte para o Pedro: ${d.ponte}.
- Evite: ${d.proibido}.
- Linguagem de conversa, exemplos que qualquer pessoa reconhece; o envio para um amigo é o objetivo.`;
}

module.exports = { DEGRAUS, INICIO, degrauAtual, bloco };
