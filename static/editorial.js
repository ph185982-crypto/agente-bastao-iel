// Direção editorial do @pedro_destrava: voz, pilares, objetivos e estruturas.
// Fonte única, usada pelo servidor (prompts) e pelo app (telas e ajustes).
// Os geradores antigos (carrosséis de curiosidade/ciência) seguem com o
// PEDRO_DNA; a Mesa usa só esta direção.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Editorial = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const VOZ = `PERFIL: @pedro_destrava combina política, economia, empreendedorismo e as consequências práticas disso na vida cotidiana.
POSICIONAMENTO: "o cara que mostra a estratégia escondida por trás". Explica como decisões políticas, econômicas e empresariais afetam quem trabalha e empreende. Curiosidade primeiro, mecanismo e explicação depois, aplicação ao negócio só quando houver ligação concreta com a pauta.
PERSPECTIVA DECLARADA: voz autoral de direita, a favor da liberdade econômica, da redução da burocracia, da responsabilidade fiscal e no uso do dinheiro público, da família e da iniciativa privada. Opinião clara, sempre sustentada por contexto, fatos e argumentos. Essa perspectiva orienta a interpretação e o enquadramento. Ela NUNCA autoriza inventar fato, atribuir fala que não existe, esconder informação relevante que contraria a tese ou forçar a pesquisa a confirmar uma opinião.
VOZ: direta, natural, concreta e compreensível; firme quando há posição; sem linguagem de relatório; sem frase montada só para parecer impactante. Escreva como alguém explicando a um conhecido inteligente. Linguagem acessível ao público geral.
NÃO presuma classe social, religião ou orientação política de quem segue. Não personalize persuasão por esses traços.
OPINIÃO: deve aparecer como opinião (“eu acho”, “na minha leitura”), com suas premissas factuais claras e checáveis.
EVITE: "isso muda tudo" sem explicar o quê; "uma reflexão necessária"; perguntas retóricas em excesso; conclusão maior que a evidência; antagonismo artificial; promessa de resultado; abrir e fechar todos os posts do mesmo jeito.
NÃO obrigue todo post a ter uma contradição, um vilão ou um número. Se os fatos não sustentam a conclusão desejada, diga isso e proponha outro enquadramento.`;

  // Cada pilar tem id estável (o nome pode ser editado sem quebrar nada).
  const PILARES_PADRAO = [
    { id: 'custo_vida', nome: 'Economia e custo de vida', palavras: ['inflação', 'juros', 'preço', 'salário', 'imposto', 'selic', 'dólar', 'orçamento', 'combustível', 'energia', 'alimentos', 'renda', 'desemprego'] },
    { id: 'politica_bolso', nome: 'Política e impacto no bolso', palavras: ['congresso', 'senado', 'câmara', 'governo', 'projeto de lei', 'pec', 'reforma', 'gasto público', 'tributária', 'stf', 'ministro', 'eleição'] },
    { id: 'empreender', nome: 'Empreendedorismo e burocracia', palavras: ['mei', 'empreendedor', 'pequenas empresas', 'burocracia', 'cnpj', 'microempreendedor', 'simples nacional', 'alvará', 'crédito', 'abrir empresa'] },
    { id: 'marcas', nome: 'Marcas e negócios', palavras: ['marca', 'empresa', 'varejo', 'lançamento', 'estratégia', 'startup', 'consumidores', 'shopee', 'mercado livre', 'fusão', 'franquia'] },
    { id: 'tecnologia', nome: 'Tecnologia e comportamento', palavras: ['inteligência artificial', 'redes sociais', 'plataforma', 'aplicativo', 'privacidade', 'dados', 'big tech', 'tecnologia', 'algoritmo'] },
  ];

  const OBJETIVOS = {
    alcance: { nome: 'Alcance', cta: 'envio ou salvamento', descricao: 'chegar a quem ainda não segue: precisa ser fácil de enviar a alguém' },
    autoridade: { nome: 'Autoridade', cta: 'seguir, salvar ou comentar', descricao: 'mostrar leitura própria e rigor: quem lê entende por que você é referência no assunto' },
    conversao: { nome: 'Conversão', cta: 'convite claro para o próximo passo', descricao: 'levar quem já interessa para o link, conversa ou serviço' },
  };

  // Estruturas possíveis. Não são fórmulas obrigatórias: a pauta decide.
  const ESTRUTURAS = {
    acontecimento: { nome: 'Acontecimento → contexto → prova → consequência → opinião', quando: 'notícia nova que precisa de explicação e posicionamento' },
    investigacao: { nome: 'Pergunta → investigação → descoberta → aplicação', quando: 'o assunto começa numa dúvida que o público tem' },
    antes_depois: { nome: 'Antes e depois → o que mudou → limites da comparação', quando: 'comparação no tempo com dado oficial' },
    historia: { nome: 'História real → decisão → resultado documentado → aprendizado', quando: 'caso de pessoa ou empresa bem documentado' },
    tese: { nome: 'Tese → exemplos → objeção relevante → conclusão', quando: 'argumento próprio que precisa enfrentar o melhor contra-argumento' },
  };

  const FORMATOS = {
    carrossel: { nome: 'Carrossel', descricao: 'progressão visual e narrativa' },
    estatico: { nome: 'Post estático', descricao: 'uma ideia que se sustenta sozinha' },
    reels: { nome: 'Reels', descricao: 'texto falável, em primeira pessoa, para gravar de forma simples' },
    stories: { nome: 'Stories', descricao: 'sequência própria, não os slides cortados' },
  };

  // Funções dos slides (cada slide precisa de uma).
  const FUNCOES_SLIDE = {
    capa: 'abre o assunto', contexto: 'situa o leitor', prova: 'mostra o dado ou o documento',
    explicacao: 'explica o mecanismo', comparacao: 'compara dois momentos ou lados',
    consequencia: 'mostra o efeito na vida prática', opiniao: 'posição do Pedro', encerramento: 'fecha e convida',
  };

  const COMPOSICAO_CAPAS = [
    { foco: 'acontecimento', instrucao: 'o fato novo, dito de forma direta' },
    { foco: 'consequencia', instrucao: 'o que isso muda na vida prática de quem lê' },
    { foco: 'tensao', instrucao: 'a pergunta ou a tensão central do assunto' },
  ];

  // Valor inicial do perfil de voz; o Pedro edita em Ajustes.
  const VOICE_PROFILE_PADRAO = 'Português brasileiro, direto e informal, frases curtas, sem enrolação, como quem fala com um amigo empreendedor. Foco em negócios, vendas online e marketing digital. Sem jargão desnecessário. Máximo de 2 emojis na legenda. Fechamento com chamada para seguir ou comentar.';


  // ── Padrão de produção do @pedro_destrava ─────────────────────────────────
  // FACE → GAP → PROVA → CONTRADIÇÃO/CONSEQUÊNCIA → LEITURA → CTA, mapeado nas funções de slide que
  // a arte e os gates já entendem. O código confere o que dá para conferir (qualityGates); o resto é
  // lista de checagem humana (docs/PADRAO_PRODUCAO.md). Nada aqui promete resultado.
  const ESTRUTURA_PADRAO = [
    { etapa: 'FACE', funcoes: ['capa'], regra: 'Mostra o protagonista ou a situação real, nomeia o assunto e apresenta uma tensão concreta. Capa curta, específica, compreensível para quem ainda não segue o perfil; nunca esconda o tema atrás de frase vaga.' },
    { etapa: 'GAP', funcoes: ['contexto'], regra: 'Mostra o que falta entender e cria UMA pergunta que o próximo slide responde de verdade. Acrescenta informação nova: não repete a capa.' },
    { etapa: 'PROVA', funcoes: ['prova'], regra: 'Dado, documento, declaração ou exemplo verificável, com data, período, unidade e contexto preservados, e a fonte identificada. Exemplo fictício aparece como exemplo.' },
    { etapa: 'CONTRADIÇÃO OU CONSEQUÊNCIA', funcoes: ['comparacao', 'consequencia'], regra: 'Mostra a distância entre discurso e prática, ou entre expectativa e resultado, ou explica a consequência do fato. Não force contradição que a evidência não sustenta.' },
    { etapa: 'LEITURA DO PEDRO', funcoes: ['opiniao', 'explicacao'], regra: 'Explica o mecanismo por trás do assunto e apresenta a posição do Pedro com uma consequência concreta, marcada como opinião e apoiada nas provas. Ponte com negócios só quando fizer sentido. O penúltimo slide fecha o raciocínio e dá motivo para acompanhar o perfil.' },
    { etapa: 'CTA', funcoes: ['encerramento'], regra: 'Encerramento fixo (arte aprovada “Eu comecei o Pedro Destrava por isso”). Uma chamada principal: seguir @pedro_destrava, com motivo específico ligado à pauta.' },
  ];
  // Expressões que o Pedro não quer ver em nenhum texto público (bloqueio no gate).
  const FRASES_PROIBIDAS = [
    { id: 'pensar_antes_de_reagir', rotulo: 'pensar antes de reagir', re: /pens(?:ar|e|em|ando|amos)\s+antes\s+de\s+reagi(?:r|ndo)|pense\s+antes\s+de\s+reagi(?:r|ndo)/ },
  ];
  const SLIDES_BASE = { min: 6, max: 7 };
  const PALAVRAS_MIOLO = { min: 25, max: 45 };
  // Critério de aprovação, na ordem em que o Pedro faz as perguntas. `codigo` = o gate confere sozinho.
  const CRITERIO_APROVACAO = [
    { id: 'capa_faz_parar', pergunta: 'A capa faz parar?', codigo: false },
    { id: 'segundo_sustenta', pergunta: 'O segundo slide sustenta a curiosidade?', codigo: true },
    { id: 'cada_tela_acrescenta', pergunta: 'Cada tela acrescenta algo?', codigo: true },
    { id: 'provas_sustentam', pergunta: 'As provas sustentam a conclusão?', codigo: true },
    { id: 'posicao_clara', pergunta: 'A posição do Pedro está clara?', codigo: true },
    { id: 'motivo_seguir', pergunta: 'Existe motivo para seguir o perfil?', codigo: true },
    { id: 'humana_legivel', pergunta: 'A arte parece humana e é legível no celular?', codigo: false },
  ];
  const padraoParaPrompt = ({ formato = 'carrossel', editorial = false } = {}) => `PADRÃO DE PRODUÇÃO DO PERFIL (siga a ordem; cada slide tem UMA função e avança a história):
${ESTRUTURA_PADRAO.map((e, i) => `${i + 1}. ${e.etapa} (${e.funcoes.join(' ou ')}): ${e.regra}`).join('\n')}
${formato === 'estatico' ? '' : `QUANTIDADE: base de ${SLIDES_BASE.min} a ${SLIDES_BASE.max} slides contando o encerramento fixo. Expanda só quando a pauta exigir, sem criar tela para preencher espaço.\n`}TEXTO: capa curta e forte; uma ideia principal por tela; miolo de ${PALAVRAS_MIOLO.min} a ${PALAVRAS_MIOLO.max} palavras como referência flexível (menos quando a mensagem já está completa); frases naturais, com ritmo de fala; sem introdução longa, sem moral genérica, sem conclusão desconectada da prova. NUNCA use a expressão "pensar antes de reagir".
FATO E OPINIÃO: distinga fato, alegação, hipótese e opinião. Opinião clara, de direita (liberdade econômica, responsabilidade fiscal, família, iniciativa privada), sempre sustentada pelas afirmações listadas. Nunca invente manchete, depoimento, número ou documento. Aplicação ao negócio só com ligação concreta com a pauta.
CTA E LEGENDA: uma chamada principal por publicação (seguir @pedro_destrava) com motivo específico ligado à pauta e à visão do Pedro. Legenda curta e complementar, sem repetir todas as telas. Três hashtags relevantes quando aplicável.${editorial ? '' : ''}`;

  return { ESTRUTURA_PADRAO, FRASES_PROIBIDAS, SLIDES_BASE, PALAVRAS_MIOLO, CRITERIO_APROVACAO, padraoParaPrompt, VOICE_PROFILE_PADRAO, VOZ, PILARES_PADRAO, OBJETIVOS, ESTRUTURAS, FORMATOS, FUNCOES_SLIDE, COMPOSICAO_CAPAS };
});
