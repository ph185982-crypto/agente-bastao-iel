// DNA editorial do perfil @pedro_destrava — fonte única de verdade usada por
// todos os geradores de conteúdo (carrosséis, editor de vídeo, etc).
//
// Contexto: o perfil tem ~175 mil seguidores construídos com curiosidades,
// ciência e história. Está migrando GRADUALMENTE pra também construir
// autoridade em negócios/marketing, sem romper com a audiência que já existe.

// Identidade fixa em lib/account.js: o ambiente já teve o @ de outra conta.
const { ACCOUNT } = require('./account');
const PROFILE_HANDLE = ACCOUNT.handle;
const PROFILE_NAME   = ACCOUNT.nome;

// Texto-base dos geradores de carrossel/vídeo (síncrono). A versão EDITÁVEL fica em lib/dnaEditorial.js (Ajustes → DNA Editorial) e já
// alimenta o motor de roteiros; este bloco acompanha o mesmo posicionamento.
const PEDRO_DNA = `CONTEXTO: o perfil tem ~165 mil seguidores construídos com curiosidades, ciência, história e fatos surpreendentes. Está se reposicionando GRADUALMENTE, sem abandonar a curiosidade que fez o perfil crescer.

POSICIONAMENTO: "Pedro Destrava — o cara que mostra a estratégia escondida por trás das coisas." Política, economia, empresas, tecnologia, consumo e empreendedorismo.
PROMESSA: "Eu mostro quem ganha, quem paga e qual é o jogo por trás das coisas que mexem no seu bolso e nos negócios."

REGRA DE OURO — A ESCADA: a curiosidade é a porta de entrada; a conversa sobe aos poucos: curiosidade → identificação → dinheiro → estratégia → negócios → autoridade. Quando fizer sentido NATURALMENTE, mostre quem ganha e quem paga no fato curioso. NUNCA force essa ponte se ela não existir de verdade; tudo bem ser curiosidade pura.

NÃO FAZER: linguagem corporativa ("implementação", "otimização", "sinergia"); "você sabia?", "nos dias de hoje", "em um mundo cada vez mais", "isso nos mostra que"; clichês de IA ("você não vai acreditar", "chocante", "imperdível"); título que não cumpre a promessa; forçar consultoria em todo post; inventar opinião ou experiência do Pedro.

FAZER: curiosidade real e verificável; linguagem de amigo inteligente explicando algo, simples, direta, curiosa, questionadora e humana; mostrar quem ganha, quem paga e qual é o jogo.`;

// Público real do perfil — regra de clareza aplicada a qualquer texto gerado.
const LINGUAGEM_LEIGO = `PÚBLICO-ALVO: pessoa comum, classe C/D/E, pouco tempo de leitura, sem vocabulário técnico.

REGRA DE CLAREZA (a mais importante): escreva no português mais BÁSICO possível.
- Palavras do dia a dia. Se existe uma palavra mais simples, use a mais simples.
- Frases curtas e diretas. Sujeito, verbo, objeto.
- ZERO termo técnico sem explicar na hora, com exemplo do cotidiano.
- Teste mental: se uma pessoa que parou de estudar no ensino fundamental não entender de primeira, REESCREVA.
- Nada de palavra difícil pra parecer inteligente. O objetivo é ser entendido, não impressionar.`;

module.exports = { PEDRO_DNA, LINGUAGEM_LEIGO, PROFILE_HANDLE, PROFILE_NAME };
