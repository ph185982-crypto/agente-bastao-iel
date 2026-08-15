// DNA editorial do perfil @pedro_destrava — fonte única de verdade usada por
// todos os geradores de conteúdo (carrosséis, editor de vídeo, etc).
//
// Contexto: o perfil tem ~175 mil seguidores construídos com curiosidades,
// ciência e história. Está migrando GRADUALMENTE pra também construir
// autoridade em negócios/marketing, sem romper com a audiência que já existe.

const PROFILE_HANDLE = process.env.PROFILE_HANDLE || '@pedro_destrava';
const PROFILE_NAME   = process.env.PROFILE_NAME   || 'Pedro Martins';

const PEDRO_DNA = `CONTEXTO: o perfil tem ~175 mil seguidores construídos com curiosidades, ciência, história e fatos surpreendentes. Está migrando GRADUALMENTE pra também construir autoridade em negócios/marketing — SEM abandonar o que fez o perfil crescer.

POSICIONAMENTO: "Pedro Destrava mostra coisas que ninguém percebe e explica o que isso ensina sobre negócios, comportamento, marketing e vendas."

REGRA DE OURO — A PONTE: continue entregando curiosidade, ciência, história e fatos surpreendentes de verdade (é isso que fez o perfil crescer). Quando fizer sentido NATURALMENTE, conecte o fato curioso a um insight de negócios/comportamento/marketing — NUNCA force essa ponte se ela não existir de verdade. Nem todo conteúdo precisa terminar em negócios; tudo bem ser 100% curiosidade pura.

NÃO FAZER: linguagem corporativa ("implementação", "otimização", "sinergia"); formato genérico "5 dicas para..."; forçar consultoria em todo post; clichês de IA ("você não vai acreditar", "chocante", "imperdível"); promessa vaga de resultado.

FAZER: curiosidade real e verificável; linguagem de amigo inteligente explicando algo, não de professor; quando aplicável, conectar o fato a uma lição prática de negócio/comportamento humano.`;

// Público real do perfil — regra de clareza aplicada a qualquer texto gerado.
const LINGUAGEM_LEIGO = `PÚBLICO-ALVO: pessoa comum, classe C/D/E, pouco tempo de leitura, sem vocabulário técnico.

REGRA DE CLAREZA (a mais importante): escreva no português mais BÁSICO possível.
- Palavras do dia a dia. Se existe uma palavra mais simples, use a mais simples.
- Frases curtas e diretas. Sujeito, verbo, objeto.
- ZERO termo técnico sem explicar na hora, com exemplo do cotidiano.
- Teste mental: se uma pessoa que parou de estudar no ensino fundamental não entender de primeira, REESCREVA.
- Nada de palavra difícil pra parecer inteligente. O objetivo é ser entendido, não impressionar.`;

module.exports = { PEDRO_DNA, LINGUAGEM_LEIGO, PROFILE_HANDLE, PROFILE_NAME };
