// ── Robô de copy para Reels (sem IA) ──────────────────────────────────────────
// Escreve o GANCHO (texto que vai queimado em cima do vídeo) e a LEGENDA do post
// sem chamar modelo nenhum. Mesma filosofia do roboCopy: fórmula determinística,
// e onde entraria um fato específico do vídeo o robô deixa um marcador em vez de
// inventar — legenda com dado falso é pior que legenda nenhuma.
//
// Reaproveita o motor de sorteio do roboCopy para não haver duas fontes de
// aleatoriedade: mesmo tema + mesma variante = mesmo resultado, sempre.

const {
  nucleoDoTema, nucleoCurto, palavrasChave, capitalizar, limitarPalavras,
  hashString, criarSorteio,
} = require('./roboCopy');

// Onde entra o fato específico do vídeo. Fica só na legenda (o gancho precisa
// ser publicável do jeito que sai, porque vai queimado na imagem).
const MARCADOR_REEL = '[complete com o detalhe do seu vídeo]';

// ── Gancho ────────────────────────────────────────────────────────────────────
// Regras que estes moldes respeitam, iguais às do modo com IA:
// no máximo 12 palavras, uma frase só, sem emoji, sem hashtag, sem aspas,
// desperta curiosidade e NUNCA entrega a resposta.
const GANCHOS_REEL = [
  t => `O erro que trava ${t}`,
  t => `Ninguém te explica ${t} desse jeito`,
  t => `Por que ${t} não funciona pra você`,
  t => `A parte de ${t} que te escondem`,
  t => `Você está errando em ${t} sem perceber`,
  t => `O detalhe de ${t} que ninguém vê`,
  t => `${capitalizar(t)} não é o que te falaram`,
  t => `O que muda tudo em ${t}`,
  t => `Todo mundo erra a mesma coisa em ${t}`,
  t => `A verdade sobre ${t}`,
];

// ── Legenda ───────────────────────────────────────────────────────────────────
// Primeira linha de impacto, que puxa a leitura.
const ABERTURAS = [
  n => `🚀 Se você trava em ${n}, provavelmente é por isso.`,
  n => `👀 A maioria erra ${n} no mesmo ponto — e nem percebe.`,
  n => `🔥 ${capitalizar(n)} fica bem mais simples quando você vê isso.`,
  n => `💡 Ninguém comenta essa parte de ${n}.`,
];

// Contexto: o QUE é e POR QUE acontece. Conselho estrutural, verdadeiro para
// qualquer assunto — o robô não sabe o conteúdo do vídeo, então não afirma nada
// sobre ele.
const CONTEXTOS = [
  n => `O que acontece com ${n} quase nunca é falta de esforço. Na maioria das vezes o problema já estava na forma como a coisa foi montada, bem antes de você começar a tentar.`,
  n => `Quando ${n} não anda, o instinto é tentar mais forte. Só que repetir o mesmo movimento com mais energia costuma acelerar o problema em vez de resolver.`,
  n => `A explicação que circula por aí sobre ${n} é simples demais. Ela pega justamente por ser fácil de repetir — não por estar certa.`,
  n => `Em ${n} existe quase sempre um ajuste que rende muito e custa pouco. Ele costuma ser tão óbvio que passa batido.`,
];

// Por que importa + o que fazer. É aqui que entra o marcador do fato do vídeo.
const APLICACOES = [
  n => `Na prática isso muda onde você coloca sua energia. Resolver a causa uma vez em ${n} economiza meses de tentativa e erro.`,
  n => `Vale escolher um ponto só de ${n} e ajustar ele essa semana. Um ponto resolvido de verdade rende mais que cinco mudanças pela metade.`,
  n => `O sinal de que pegou não é sentir motivação, é o esforço diminuir. Quando ${n} passa a exigir menos de você para render igual, o ajuste funcionou.`,
  n => `Antes de tentar de novo, olhe o que está causando o travamento em ${n}. O caminho curto quase sempre é o caminho feito na ordem certa.`,
];

const CTAS_REEL = [
  h => `Segue ${h} que todo dia tem um assim por aqui. 👇`,
  h => `Salva pra não esquecer e segue ${h} pra ver os próximos. 👇`,
  h => `Comenta o que você faria diferente e segue ${h}. 👇`,
  h => `Manda pra quem precisa ver isso e segue ${h}. 👇`,
];

const HASHTAGS_REEL = [
  '#dicas', '#conteudo', '#aprendizado', '#foco', '#mentalidade',
  '#crescimento', '#pratica', '#rotina', '#brasil',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// O gancho vai queimado na imagem, então nada de emoji, aspas ou hashtag.
function limparGancho(texto) {
  return String(texto || '')
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/#[\wà-ú]+/gi, '')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
}

// Corta em no máximo `max` palavras sem deixar conector solto no fim.
const CONECTORES = new Set(['de','do','da','dos','das','em','no','na','nos','nas','com','sem','para','pra','por','e','ou','que','a','o']);
function limitarGancho(texto, max = 12) {
  let p = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (p.length > max) p = p.slice(0, max);
  while (p.length > 1 && CONECTORES.has(p[p.length - 1].toLowerCase())) p.pop();
  return p.join(' ');
}

/**
 * Escreve gancho e legenda de um Reel sem usar IA.
 *
 * @param {object}  opts
 * @param {string}  opts.tema        assunto do vídeo, escrito pelo usuário
 * @param {string}  opts.headline    gancho já escrito — se vier, é mantido intacto
 * @param {string}  opts.handle      @ do perfil, usado no CTA (obrigatório na legenda)
 * @param {number}  opts.variante    muda o sorteio mantendo o mesmo tema
 * @param {boolean} opts.marcadores  inclui o marcador de fato na legenda (padrão: true)
 * @returns {{headline: string, caption: string, fonte: 'robo', variante: number}}
 */
function gerarCopyReel({ tema, headline, handle = '@pedro_destrava', variante = 0, marcadores = true } = {}) {
  const ganchoDado = limparGancho(headline);
  // Sem tema e sem gancho não há do que falar — o gancho vira a base do texto.
  // O tema entra nas frases prontas, então precisa ser curto: quem chama pode
  // mandar uma transcrição inteira, e sem este corte ela vazaria pra legenda.
  const base = limitarPalavras(String(tema || '').trim() || ganchoDado, 8);
  const nucleo = nucleoDoTema(base);
  const curto = nucleoCurto(nucleo);

  const sorteio = criarSorteio(hashString(`reel|${base}|${ganchoDado}|${variante}`));

  const gancho = ganchoDado
    ? limitarGancho(ganchoDado, 14)   // do autor: respeita, só apara excesso
    : limitarGancho(sorteio.escolher(GANCHOS_REEL)(curto), 12);

  let aplicacao = sorteio.escolher(APLICACOES)(nucleo);
  if (marcadores) aplicacao += ` ${MARCADOR_REEL}`;

  const chaves = palavrasChave(base, 3);
  const tags = [...new Set([
    ...chaves.map(p => '#' + p),
    ...sorteio.escolherVarios(HASHTAGS_REEL, 5),
  ])].slice(0, 5);

  const caption = [
    sorteio.escolher(ABERTURAS)(nucleo),
    '',
    sorteio.escolher(CONTEXTOS)(nucleo),
    '',
    aplicacao,
    '',
    sorteio.escolher(CTAS_REEL)(handle),
    '',
    tags.join(' '),
  ].join('\n');

  return { headline: gancho, caption, fonte: 'robo', variante };
}

module.exports = {
  gerarCopyReel,
  // exportados para teste
  limparGancho,
  limitarGancho,
  GANCHOS_REEL,
  MARCADOR_REEL,
};
