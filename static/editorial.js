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
PERSPECTIVA DECLARADA: direita, a favor da liberdade econômica, da redução da burocracia e da responsabilidade no uso do dinheiro público. Essa perspectiva orienta a interpretação e o enquadramento. Ela NUNCA autoriza inventar fato, atribuir fala que não existe, esconder informação relevante que contraria a tese ou forçar a pesquisa a confirmar uma opinião.
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

  return { VOZ, PILARES_PADRAO, OBJETIVOS, ESTRUTURAS, FORMATOS, FUNCOES_SLIDE, COMPOSICAO_CAPAS };
});
