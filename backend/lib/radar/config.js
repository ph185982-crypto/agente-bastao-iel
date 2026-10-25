// Radar de Negócios: constantes editoriais e de pontuação. Tudo que é regra (pesos, limiar, frases proibidas,
// lista de fontes) fica aqui, num lugar só, para o código e os testes lerem a mesma coisa.

// Pontuação 0 a 100. A IA só dá níveis (0 a 3) por critério; os pontos saem destes pesos, em código.
const PESOS = Object.freeze({ novidade: 15, demanda: 20, receita: 15, compreensao: 10, brasil: 15, investimento: 10, visual: 5, compartilhamento: 10 });
const CRITERIOS_ROTULO = Object.freeze({
  novidade: 'Novidade', demanda: 'Prova de demanda', receita: 'Modelo de receita claro', compreensao: 'Facilidade de compreensão',
  brasil: 'Adaptação ao Brasil', investimento: 'Baixo ou médio investimento inicial', visual: 'Potencial visual', compartilhamento: 'Potencial de compartilhamento',
});
const LIMIAR_CARROSSEL = 75;
const TOTAL_SLIDES = 8;
const MIN_CANDIDATOS = 30;
const TOP_PAUTAS = 5;
const MAX_VERIFICAR = 12;       // quantos candidatos passam pela leitura das fontes (cada um custa páginas lidas + uma chamada de IA)
const DIAS_SEM_REPETIR = 120;   // mesma empresa ou mesma história não volta dentro deste prazo
const IDADE_MAX_HISTORIA_DIAS = 45;
const ANOS_NEGOCIO_ANTIGO = 7;
const LIMITE_PESQUISAS_MANUAIS_DIA = 4;

const CATEGORIAS = Object.freeze({
  saas: 'SaaS', startup: 'Startup', produto: 'Produto', servico: 'Serviço', negocio_local: 'Negócio local', ecommerce: 'E-commerce',
});
// Filtros da aba Radar (os 6 primeiros são categorias; os 3 últimos são marcas calculadas).
const FILTROS = Object.freeze([
  ['todos', 'Todos'], ['saas', 'SaaS'], ['startup', 'Startup'], ['produto', 'Produto'], ['servico', 'Serviço'],
  ['negocio_local', 'Negócio local'], ['ecommerce', 'E-commerce'], ['ia', 'Inteligência artificial'],
  ['baixo_investimento', 'Baixo investimento'], ['adaptavel_brasil', 'Adaptável ao Brasil'],
]);

const MODELOS_RECEITA = Object.freeze({
  assinatura: 'assinatura', comissao: 'comissão', venda: 'venda', licenca: 'licença', mensalidade: 'mensalidade',
  publicidade: 'publicidade', marketplace: 'marketplace', servico_recorrente: 'serviço recorrente',
});

// Motivos pelos quais algo NÃO é oportunidade (a IA marca; o código também procura estes sinais no texto).
const SINAIS_DESCARTE = Object.freeze({
  piramide: 'pirâmide ou marketing multinível', aposta: 'apostas', renda_garantida: 'promessa de renda garantida',
  enriquecimento_rapido: 'esquema de enriquecimento rápido', ilegal: 'produto ou prática ilegal', sem_evidencia: 'operação sem evidência',
  especulacao: 'negócio baseado em especulação', patrocinado: 'conteúdo patrocinado disfarçado', franquia: 'franquia sem dados públicos',
  historia_antiga: 'história antiga reapresentada como novidade',
});
const REGEX_DESCARTE = [
  [/\b(pir[aâ]mide financeira|ponzi|multin[ií]vel|multi-level marketing|\bmlm\b)\b/i, 'piramide'],
  [/\b(cassino|casino|apostas? esportivas?|sports ?betting|bet365|jogo do tigrinho|slot machine|gambling)\b/i, 'aposta'],
  [/\b(renda garantida|lucro garantido|guaranteed (income|returns?|profit)|retorno garantido|ganhos? garantidos?)\b/i, 'renda_garantida'],
  [/\b(get rich quick|enrique[cç]a r[aá]pido|fique rico r[aá]pido|ganhe dinheiro f[aá]cil|passive income secret)\b/i, 'enriquecimento_rapido'],
  [/\b(token presale|pr[eé]-?venda de token|memecoin|meme coin|airdrop|pump and dump)\b/i, 'especulacao'],
  [/\b(sponsored content|conte[uú]do patrocinado|publieditorial|paid partnership|advertorial)\b/i, 'patrocinado'],
];

// Frases proibidas na copy (pedido do Pedro) + clichês de texto de IA. Comparação sem acento e em minúsculas.
const FRASES_PROIBIDAS = Object.freeze([
  'em um mundo onde', 'em um mundo em que', 'voce nao vai acreditar', 'isso muda tudo', 'o futuro chegou', 'mais do que', 'nao e apenas', 'nao e so ',
  'revolucionario', 'revolucionaria', 'revolucionando', 'game changer', 'game-changer', 'no cenario atual', 'nos dias de hoje', 'vale ressaltar',
  'e importante destacar', 'mergulhe', 'desbloqueie', 'jornada', 'alavancar', 'descubra como', 'transforme seu', 'nesse sentido', 'em suma',
  'sem dados nao', 'a verdade e que', 'o segredo e', 'ninguem te conta', 'ninguem conta',
]);
// Afirmações de ausência que a ferramenta não consegue provar (não existe fonte que confirme "ninguém faz isso no Brasil").
const ABSOLUTOS_NAO_PROVAVEIS = Object.freeze([
  'ninguem faz isso no brasil', 'quase ninguem faz', 'nenhuma empresa no brasil', 'nao existe no brasil', 'ninguem no brasil', 'nao ha nada igual no brasil', 'ainda nao existe aqui',
  'garantido', 'garantia de', 'sem risco', 'vai funcionar no brasil', 'funciona no brasil', 'vai dar certo', 'dinheiro facil',
]);

// Texto fixo da tela 8 (não passa por IA).
const CTA_FIXO = Object.freeze({
  principal: 'EU PESQUISO NEGÓCIOS QUE ESTÃO DANDO CERTO NO MUNDO.',
  secundario: 'E MOSTRO COMO ESSAS IDEIAS PODERIAM SER TESTADAS NO BRASIL.',
  cta: 'SEGUE @PEDRO_DESTRAVA PARA NÃO PERDER A PRÓXIMA.',
});
const ENCERRAMENTO_LEGENDA = 'Eu pesquiso negócios que estão crescendo no mundo e explico como funcionam. Segue @pedro_destrava para não perder a próxima ideia.';
const SERIE = 'IDEIAS QUE DÃO DINHEIRO';

const COR = Object.freeze({ marfim: '#FBF8F0', azul: '#1457D9', laranja: '#F47A1F', preto: '#171717', mudo: '#6B6860', linha: '#D9D3C4' });

// Termos de pesquisa (pedido do Pedro). Em inglês viram consultas reais na API pública do Hacker News;
// em português e inglês servem para ordenar o que os feeds trazem.
const TERMOS_EN = Object.freeze(['profitable startup', 'bootstrapped SaaS', 'fastest growing startup', 'unusual business idea', 'boring business', 'small business opportunity', 'new consumer product', 'startup revenue', 'startup case study', 'trending Product Hunt']);
const TERMOS_PT = Object.freeze(['negócio lucrativo', 'startup em crescimento', 'produto inovador', 'modelo de negócio', 'oportunidade de negócio']);

// Fontes. `classe`: o que o conteúdo é para fins de verificação.
//  'imprensa'   → veículo jornalístico (independente da empresa)
//  'plataforma' → catálogo de lançamentos/campanhas (as empresas se cadastram: serve de pista, não de prova)
//  'comunidade' → comunidade de profissionais (Hacker News); pontos e comentários são sinal de interesse, não de faturamento
//  'tendencia'  → o que as pessoas pesquisam (Google Trends)
// `inativo`: motivo pelo qual NÃO lemos (a ferramenta respeita bloqueio e não faz raspagem de página).
const FONTES = Object.freeze([
  { id: 'producthunt', nome: 'Product Hunt', url: 'https://www.producthunt.com/feed', idioma: 'en', classe: 'plataforma', pais: 'EUA' },
  { id: 'producthunt_saas', nome: 'Product Hunt (SaaS)', url: 'https://www.producthunt.com/feed?category=saas', idioma: 'en', classe: 'plataforma', pais: 'EUA' },
  { id: 'producthunt_ia', nome: 'Product Hunt (IA)', url: 'https://www.producthunt.com/feed?category=artificial-intelligence', idioma: 'en', classe: 'plataforma', pais: 'EUA' },
  { id: 'kickstarter', nome: 'Kickstarter', url: 'https://www.kickstarter.com/projects/feed.atom', idioma: 'en', classe: 'plataforma', pais: 'EUA' },
  { id: 'ycombinator', nome: 'Y Combinator (blog)', url: 'https://www.ycombinator.com/blog/rss.xml', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'techcrunch', nome: 'TechCrunch', url: 'https://techcrunch.com/category/startups/feed/', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'crunchbase', nome: 'Crunchbase News', url: 'https://news.crunchbase.com/feed/', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'fastcompany', nome: 'Fast Company', url: 'https://www.fastcompany.com/latest/rss', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'forbes', nome: 'Forbes (Innovation)', url: 'https://www.forbes.com/innovation/feed/', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'inc', nome: 'Inc.', url: 'https://www.inc.com/rss', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'entrepreneur', nome: 'Entrepreneur', url: 'https://www.entrepreneur.com/latest.rss', idioma: 'en', classe: 'imprensa', pais: 'EUA' },
  { id: 'eustartups', nome: 'EU-Startups', url: 'https://www.eu-startups.com/feed/', idioma: 'en', classe: 'imprensa', pais: 'Europa' },
  { id: 'sifted', nome: 'Sifted', url: 'https://sifted.eu/feed', idioma: 'en', classe: 'imprensa', pais: 'Europa' },
  { id: 'tnw', nome: 'The Next Web', url: 'https://thenextweb.com/feed', idioma: 'en', classe: 'imprensa', pais: 'Europa' },
  { id: 'inc42', nome: 'Inc42', url: 'https://inc42.com/feed/', idioma: 'en', classe: 'imprensa', pais: 'Índia' },
  { id: 'restofworld', nome: 'Rest of World', url: 'https://restofworld.org/feed/latest', idioma: 'en', classe: 'imprensa', pais: 'Mercados emergentes' },
  { id: 'exame', nome: 'Exame', url: 'https://exame.com/feed/', idioma: 'pt', classe: 'imprensa', pais: 'Brasil' },
  { id: 'startupsbr', nome: 'Startups.com.br', url: 'https://startups.com.br/feed/', idioma: 'pt', classe: 'imprensa', pais: 'Brasil' },
  { id: 'neofeed', nome: 'NeoFeed', url: 'https://neofeed.com.br/feed/', idioma: 'pt', classe: 'imprensa', pais: 'Brasil' },
  { id: 'trends_br', nome: 'Google Trends (Brasil)', url: 'https://trends.google.com/trending/rss?geo=BR', idioma: 'pt', classe: 'tendencia', pais: 'Brasil' },
  { id: 'trends_us', nome: 'Google Trends (EUA)', url: 'https://trends.google.com/trending/rss?geo=US', idioma: 'en', classe: 'tendencia', pais: 'EUA' },
  // Fontes pedidas que NÃO são lidas, com o motivo (testado em 25/10/2026). Não contornamos bloqueio nem raspamos página.
  { id: 'indiehackers', nome: 'Indie Hackers', idioma: 'en', classe: 'comunidade', inativo: 'o site recusa leitura automática (HTTP 403) e não publica feed aberto' },
  { id: 'appsumo', nome: 'AppSumo', idioma: 'en', classe: 'plataforma', inativo: 'não publica feed nem API aberta; páginas só por raspagem, que não fazemos' },
  { id: 'businessinsider', nome: 'Business Insider', idioma: 'en', classe: 'imprensa', inativo: 'o veículo recusa leitura automática do feed (HTTP 403)' },
  { id: 'pegn', nome: 'PEGN', idioma: 'pt', classe: 'imprensa', inativo: 'o veículo recusa leitura automática do feed (HTTP 403)' },
  { id: 'startse', nome: 'StartSe', idioma: 'pt', classe: 'imprensa', inativo: 'não publica feed aberto (a página do feed devolve HTML do site)' },
]);
// Fontes de API pública (não são feeds): entram na contagem de fontes consultadas.
const FONTES_API = Object.freeze([
  { id: 'hn_show', nome: 'Hacker News: Show HN', classe: 'comunidade', pais: 'EUA' },
  { id: 'hn_busca', nome: 'Hacker News: busca por termos', classe: 'comunidade', pais: 'EUA' },
]);

const DOMINIOS_IMPRENSA = /(techcrunch|crunchbase|fastcompany|forbes|inc\.com|entrepreneur|eu-startups|sifted|thenextweb|inc42|restofworld|exame|startups\.com\.br|neofeed|businessinsider|bloomberg|reuters|wsj|ft\.com|theverge|wired|cnbc|bbc|nytimes|washingtonpost|theguardian|medium\.com\/@?[a-z-]*(?:\/|$)|startse|pegn|infomoney|valor\.globo|folha|estadao|g1\.globo|vcnewsletter|axios|semafor|theinformation|businessinsider)/i;
const DOMINIOS_AGREGADORES = /(^|\.)(producthunt\.com|news\.ycombinator\.com|ycombinator\.com|kickstarter\.com|reddit\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|t\.me|github\.com|medium\.com|substack\.com|google\.com|news\.google\.com|apple\.com|play\.google\.com|wikipedia\.org|archive\.org)$/i;

module.exports = {
  PESOS, CRITERIOS_ROTULO, LIMIAR_CARROSSEL, TOTAL_SLIDES, MIN_CANDIDATOS, TOP_PAUTAS, MAX_VERIFICAR, DIAS_SEM_REPETIR, IDADE_MAX_HISTORIA_DIAS, ANOS_NEGOCIO_ANTIGO, LIMITE_PESQUISAS_MANUAIS_DIA,
  CATEGORIAS, FILTROS, MODELOS_RECEITA, SINAIS_DESCARTE, REGEX_DESCARTE, FRASES_PROIBIDAS, ABSOLUTOS_NAO_PROVAVEIS, CTA_FIXO, ENCERRAMENTO_LEGENDA, SERIE, COR,
  TERMOS_EN, TERMOS_PT, FONTES, FONTES_API, DOMINIOS_IMPRENSA, DOMINIOS_AGREGADORES,
};
