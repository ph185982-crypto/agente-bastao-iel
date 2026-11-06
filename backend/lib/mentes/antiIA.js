// Detector de "texto com cara de IA" em português, adaptado das listas anti-slop de skills públicas de copywriting
// (srstomp/copyskills, MIT; ver docs/referencias-copy). Nos 44 carrosséis publicados pela ferramenta até 06/11/2026,
// 30 usavam "mas" de virada, 14 "discurso", 13 "quem paga a conta" e 10 a reversão "não é X. É Y" — a mesma fórmula
// em quase todo post, que o leitor reconhece e rola.

// \b do JavaScript não entende acento ("não", "é"): as fronteiras de palavra usam letras Unicode.
const r = (src) => new RegExp(src.replace(/\\b/g, '(?<![\\p{L}\\p{N}])').replace(/\\B/g, '(?![\\p{L}\\p{N}])'), 'giu');
// \b no começo da palavra, \B no fim (marcador nosso, convertido acima).
const VICIOS = [
  { id: 'reversao', nome: 'reversão "não é X, é Y"', re: r('\\bnão (?:é|são|está|foi|vem|obedece|resolve|fica|paga|se trata)\\B[^.!?\\n]{0,70}[.!?;,]\\s*(?:é|são|o problema é|está|foi|ele é|ela é)\\B') },
  { id: 'nao_so', nome: '"não é só/apenas… é"', re: r('\\bnão (?:é|são) (?:só|apenas|somente)\\B|\\bmais do que (?:um|uma|só|apenas)\\B') },
  { id: 'o_problema', nome: '"o problema (não) é"', re: r('\\bo (?:verdadeiro )?problema (?:não )?é\\B') },
  { id: 'quem_paga', nome: '"quem paga a conta"', re: r('\\bquem paga\\B|\\bpaga(?:r|rá)? (?:a|essa) conta\\B|\\ba conta (?:chega|fica|sobra|cai|vem|bate)\\B|\\bpaga o pato\\B') },
  { id: 'discurso', nome: '"discurso/palanque"', re: r('\\bdiscurso\\B|\\bpalanque\\B') },
  { id: 'jornal', nome: 'jornalês ("entenda", "saiba", "vale lembrar")', re: r('\\bentenda\\B|\\bsaiba (?:mais|como|por que|o que)\\B|\\bvale (?:lembrar|destacar|ressaltar)\\B|\\bé importante (?:notar|destacar|lembrar|ressaltar)\\B') },
  { id: 'cliche', nome: 'clichê ("cenário atual", "cada vez mais")', re: r('\\bno cenário atual\\B|\\bem um mundo\\B|\\bnos dias de hoje\\B|\\bcada vez mais\\B|\\bnão é de hoje\\B|\\bfaz toda a diferença\\B|\\bmais do que nunca\\B') },
  { id: 'travessao', nome: 'travessão', re: /\s[—–]\s/g },
];

// Conta os vícios em um ou mais textos e diz quais frases caíram em cada um.
function vicios(textos) {
  const lista = (Array.isArray(textos) ? textos : [textos]).map((t) => String(t || ''));
  const achados = [];
  for (const v of VICIOS) {
    for (const t of lista) {
      for (const m of t.matchAll(v.re)) achados.push({ id: v.id, nome: v.nome, trecho: t.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim() });
    }
  }
  return achados;
}

// Bloco para os prompts: o que o redator não pode fazer e o que fazer no lugar.
const REGRAS = `ESCREVA COMO GENTE, NÃO COMO IA (o leitor reconhece a fórmula e rola):
- PROIBIDO a reversão "não é X, é Y" / "o problema não é X, o problema é Y" / "X não obedece Y" / "mais do que…". É a marca nº 1 de texto de IA.
- PROIBIDO "quem paga a conta", "a conta chega", "paga o pato", "discurso", "palanque", "entenda", "saiba como", "vale lembrar", "no cenário atual", "cada vez mais", travessão.
- Não abra quase toda frase com "mas". Varie o tamanho das frases: uma bem curta, uma média, nenhuma de 25 palavras.
- O Instagram de política e economia está SATURADO de "o governo gasta e você paga" (Schwartz: mercado no nível 5). Nesse nível, quem para o dedo é IDENTIFICAÇÃO ("isso sou eu"), HISTÓRIA com personagem e cena, e ADMISSÃO inesperada — não mais uma denúncia genérica.
- Uma cena concreta vale mais que um conceito: o boleto, a maquininha, o fornecedor ligando, a nota fiscal, a conversa com o sócio.`;

// Fórmulas de gancho para o 1º slide (adaptadas de srstomp/copyskills "hooks-and-threads", MIT).
const GANCHOS = `FÓRMULAS DE GANCHO PARA O 1º SLIDE (escolha a que o fato sustenta):
1. QUEBRA DE PADRÃO: número seco ou fato nu onde todo mundo posta opinião. Confissão SÓ se for verdade conhecida do Pedro; nunca invente história pessoal.
2. AFIRMAÇÃO OUSADA: contraria o senso comum e o carrossel prova ("Pagar menos imposto quase nunca é o que salva a pequena empresa.").
3. PERGUNTA ESPECÍFICA: a dúvida real que ele tem hoje, nunca genérica ("Por que a sua venda subiu e o seu Pix caiu?").
4. NÚMERO QUE ABRE BURACO: o número mais surpreendente DOS FATOS, sozinho, + a implicação ("[número]. Esse é o tamanho de [coisa concreta].").
5. CENA NO MEIO DA AÇÃO: sem introdução, uma cena típica do empreendedor ligada ao fato ("Você abre o extrato da maquininha e…"). Cena genérica do leitor, nunca fato inventado.
O 1º e o último slide precisam funcionar sozinhos (muita gente só vê esses dois).`;

module.exports = { VICIOS, vicios, REGRAS, GANCHOS };
