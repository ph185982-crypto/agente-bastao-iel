// Radar de Reciclagem: contas vigiadas. Em 13/11/2026 entraram 40 contas que postam CARROSSEL e IMAGEM (formato: 'imagem'),
// porque das 243 publicações coletadas 193 eram reels e a aba Copiar só usa post e carrossel.
// Lista curada a partir da pesquisa de 07/11/2026 (40 contas de Instagram e
// 20 canais de YouTube de empreendedorismo e finanças, em 7 países), mesclada com a configuração editável do Pedro
// (`reciclagem_contas` no armazém: adicionar e remover handles sem mexer no código).
//
// O que importa aqui é a TESE que viralizou, nunca o texto: a coleta lê só números e a legenda entra na IA como dado
// para classificação. Contagens de seguidores são aproximadas (rastreadores de terceiros) e servem só de referência;
// o denominador real do índice de viralidade é o `followers_count` que a Graph devolve na hora da coleta.
const { armazem } = require('../armazem');
const { ACCOUNT } = require('../account');

// pais: ISO-2. idioma: pt | en | es. destaque: entre as 15 mais relevantes para o público do Pedro.
// a_confirmar: handle não confirmado na pesquisa (a Graph recusa handle inexistente; a coleta registra o erro e segue).
const INSTAGRAM = [
  { handle: 'hormozi', nome: 'Alex Hormozi', pais: 'US', idioma: 'en', destaque: true, por_que: 'Tese "oferta + volume" para dono de negócio pequeno; carrosséis de texto e clipes testados antes no X.' },
  { handle: 'garyvee', nome: 'Gary Vaynerchuk', pais: 'US', idioma: 'en', destaque: true, por_que: 'Defesa do pequeno empreendedor e do conteúdo orgânico, alinhada à voz do Pedro.' },
  { handle: 'codiesanchez', nome: 'Codie Sanchez', pais: 'US', idioma: 'en', destaque: true, por_que: '"Negócios chatos" (lavanderia, vending) com números concretos: tese perfeita para MEI e varejo.' },
  { handle: 'leilahormozi', nome: 'Leila Hormozi', pais: 'US', idioma: 'en', destaque: true, por_que: 'Gestão e contratação para quem tem de 2 a 20 funcionários.' },
  { handle: 'danmartell', nome: 'Dan Martell', pais: 'US', idioma: 'en', destaque: true, por_que: '"Compre de volta seu tempo": o dono de pequena empresa que faz tudo sozinho.' },
  { handle: 'grantcardone', nome: 'Grant Cardone', pais: 'US', idioma: 'en', por_que: 'Vendas e escala; mecanismo de polêmica e número grande.' },
  { handle: 'patrickbetdavid', nome: 'Patrick Bet-David', pais: 'US', idioma: 'en', por_que: 'Estratégia de negócio com leitura política de direita; formato de entrevista longa cortada em clipes.' },
  { handle: 'daveramsey', nome: 'Dave Ramsey', pais: 'US', idioma: 'en', por_que: 'Dívida e disciplina financeira; tom de conselho direto.' },
  { handle: 'therealkiyosaki', nome: 'Robert Kiyosaki', pais: 'US', idioma: 'en', por_que: 'Ativo × passivo, crítica ao sistema; mecanismo de polêmica.' },
  { handle: 'mcuban', nome: 'Mark Cuban', pais: 'US', idioma: 'en', por_que: 'Dono de negócio falando de preço, margem e concorrência sem rodeio.' },
  { handle: 'russellbrunson', nome: 'Russell Brunson', pais: 'US', idioma: 'en', por_que: 'Funil e oferta para quem vende online.' },
  { handle: 'myrongolden', nome: 'Myron Golden', pais: 'US', idioma: 'en', por_que: 'Precificação e venda de alto valor com história pessoal.' },
  { handle: 'ryanserhant', nome: 'Ryan Serhant', pais: 'US', idioma: 'en', por_que: 'Vendas e marca pessoal; bastidor com número.' },
  { handle: 'thiago.nigro', nome: 'Thiago Nigro (Primo Rico)', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'Maior audiência de finanças do Brasil; mesmo público que vende em marketplace.' },
  { handle: 'oprimorico', nome: 'O Primo Rico (marca)', pais: 'BR', idioma: 'pt', por_que: 'Cortes e carrosséis da marca; serve de termômetro do que a audiência de finanças compartilha.' },
  { handle: 'pablomarcal1', nome: 'Pablo Marçal', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'Maior referência de direita e empreendedorismo do Brasil; mecanismos de polêmica e identidade.' },
  { handle: 'geracaodevalor', nome: 'Flávio Augusto', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'Liberdade econômica e "empreender é a saída" em voz empresarial sóbria.' },
  { handle: 'joeljota', nome: 'Joel Jota', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'Disciplina e alta performance para empresário; maior engajamento do grupo brasileiro.' },
  { handle: 'tallisgomes', nome: 'Tallis Gomes', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'G4: gestão prática, vendas e e-commerce, literalmente o público do Pedro.' },
  { handle: 'alfredosoares', nome: 'Alfredo Soares', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'G4: vendas e varejo digital para quem tem loja.' },
  { handle: 'bruno_perini', nome: 'Bruno Perini', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'Finanças para empresário "pé no chão", sem hype.' },
  { handle: 'nathaliaarcuri', nome: 'Nathalia Arcuri (Me Poupe!)', pais: 'BR', idioma: 'pt', por_que: 'Educação financeira popular; linguagem de conversa e humor.' },
  { handle: 'geraldoarufino', nome: 'Geraldo Rufino', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'História de superação do catador à JR Diesel: roteiro de bastidor com número.' },
  { handle: 'caiocarneiro', nome: 'Caio Carneiro', pais: 'BR', idioma: 'pt', destaque: true, por_que: 'Vendas e mentalidade para vendedor e empresário pequeno.' },
  { handle: 'camilafarani', nome: 'Camila Farani', pais: 'BR', idioma: 'pt', por_que: 'Investidora-anjo; leitura de negócio e de erro de empreendedor.' },
  { handle: 'thiagofinch', nome: 'Thiago Finch', pais: 'BR', idioma: 'pt', por_que: 'Marketing digital e lançamento; público jovem que quer vender online.' },
  { handle: 'nathfinancas', nome: 'Nath Finanças', pais: 'BR', idioma: 'pt', por_que: 'Finanças para quem ganha pouco; identificação forte com o leitor comum.' },
  { handle: 'mastermunozoficial', nome: 'Carlos "Master" Muñoz', pais: 'MX', idioma: 'es', por_que: 'Negócios e mentalidade em espanhol; anunciou saída das redes (pode não ter post novo).' },
  { handle: 'spencer.hoffmann', nome: 'Spencer Hoffmann', pais: 'MX', idioma: 'es', destaque: true, por_que: 'Versão latina de "dívida boa e negócio online"; bom para reciclar teses em espanhol.' },
  { handle: 'osotrava', nome: 'Oso Trava', pais: 'MX', idioma: 'es', por_que: 'Empreendedor e podcaster mexicano; entrevistas cortadas em clipes.' },
  { handle: 'arturoelias', nome: 'Arturo Elías Ayub', pais: 'MX', idioma: 'es', por_que: 'Executivo falando de negociação e gestão; tom direto.' },
  { handle: 'invertirmejor', nome: 'Juan Diego Gómez (Invertir Mejor)', pais: 'CO', idioma: 'es', a_confirmar: true, por_que: 'Finanças e investimento em espanhol; handle não confirmado na pesquisa.' },
  { handle: 'jorgeserratos', nome: 'Jorge Serratos', pais: 'MX', idioma: 'es', a_confirmar: true, por_que: 'Negócios para pequeno empresário mexicano; handle não confirmado na pesquisa.' },
  { handle: 'steven', nome: 'Steven Bartlett', pais: 'GB', idioma: 'en', por_que: 'Diary of a CEO: clipes de entrevista com frase de identidade.' },
  { handle: 'simonsquibb', nome: 'Simon Squibb', pais: 'GB', idioma: 'en', destaque: true, por_que: 'Entrevista de rua "qual seu sonho?": o formato mais fácil de adaptar para "qual seu negócio?".' },
  { handle: 'imangadzhi', nome: 'Iman Gadzhi', pais: 'GB', idioma: 'en', por_que: 'Agência e renda online para jovens; mecanismo de confissão.' },
  { handle: 'danielpriestley', nome: 'Daniel Priestley', pais: 'GB', idioma: 'en', por_que: 'Posicionamento de especialista e produto de entrada.' },
  { handle: 'judit_cat', nome: 'Judit Català', pais: 'ES', idioma: 'es', por_que: 'Marketing digital em espanhol para pequena empresa.' },
  { handle: 'euge.oller', nome: 'Euge Oller', pais: 'ES', idioma: 'es', por_que: 'Negócios digitais e produtividade em espanhol.' },
  { handle: 'pedrobuerbaum', nome: 'Pedro Buerbaum', pais: 'ES', idioma: 'es', por_que: 'Podcast de negócios; cortes com pergunta única.' },
  { handle: 'thedankoe', nome: 'Dan Koe', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Posts de texto em imagem sobre negócio de uma pessoa só; muito salvo e enviado.' },
  { handle: 'justinwelsh', nome: 'Justin Welsh', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Frases e listas em imagem sobre solopreneur; formato de carrossel de texto.' },
  { handle: 'sahilbloom', nome: 'Sahil Bloom', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Carrosséis de modelos mentais e listas; alto salvamento.' },
  { handle: 'visualizevalue', nome: 'Visualize Value (Jack Butcher)', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Desenho minimalista + frase de negócio: o tipo de post que se copia traduzido.' },
  { handle: 'thefutur', nome: 'The Futur (Chris Do)', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Carrosséis de precificação e venda para quem presta serviço.' },
  { handle: 'chrisdo', nome: 'Chris Do', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Frases de preço e posicionamento em imagem.' },
  { handle: 'foundr', nome: 'Foundr', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Carrosséis e citações de fundadores; página feita de posts de imagem.' },
  { handle: 'entrepreneur', nome: 'Entrepreneur', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Revista de empreendedorismo; carrosséis de lição de negócio.' },
  { handle: 'morningbrew', nome: 'Morning Brew', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Memes e gráficos de negócio e economia; viralizam por envio.' },
  { handle: 'chartr', nome: 'Chartr', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Gráfico único com um dado de negócio: formato de imagem muito compartilhado.' },
  { handle: 'visualcapitalist', nome: 'Visual Capitalist', pais: 'CA', idioma: 'en', formato: 'imagem', por_que: 'Infográficos de economia e dinheiro; carrosséis de dado.' },
  { handle: 'personalfinanceclub', nome: 'Personal Finance Club', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Gráficos simples de dinheiro e juros compostos; carrosséis muito salvos.' },
  { handle: 'ramit', nome: 'Ramit Sethi', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Finanças pessoais com frase forte em imagem.' },
  { handle: 'aliabdaal', nome: 'Ali Abdaal', pais: 'GB', idioma: 'en', formato: 'imagem', por_que: 'Produtividade e negócio online; carrosséis de lista.' },
  { handle: 'naval', nome: 'Naval', pais: 'US', idioma: 'en', formato: 'imagem', a_confirmar: true, por_que: 'Frases sobre riqueza e alavancagem em imagem.' },
  { handle: 'businessinsider', nome: 'Business Insider', pais: 'US', idioma: 'en', formato: 'imagem', por_que: 'Notícia de negócio em carrossel.' },
  { handle: 'fee.org', nome: 'FEE (Foundation for Economic Education)', pais: 'US', idioma: 'en', formato: 'imagem', a_confirmar: true, por_que: 'Liberdade econômica em carrossel e meme: tese idêntica à do Pedro.' },
  { handle: 'mises_brasil', nome: 'Instituto Mises Brasil', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Liberdade econômica em português; carrosséis de tese.' },
  { handle: 'institutoliberal', nome: 'Instituto Liberal', pais: 'BR', idioma: 'pt', formato: 'imagem', a_confirmar: true, por_que: 'Carrosséis e frases liberais.' },
  { handle: 'brasilparalelo', nome: 'Brasil Paralelo', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Carrosséis de economia e história com viés liberal-conservador.' },
  { handle: 'revistaoeste', nome: 'Revista Oeste', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Notícia e opinião de direita em carrossel.' },
  { handle: 'gazetadopovo', nome: 'Gazeta do Povo', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Notícia de economia com leitura liberal; carrosséis.' },
  { handle: 'g4educacao', nome: 'G4 Educação', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Carrosséis de gestão e vendas para empresário.' },
  { handle: 'exame', nome: 'Exame', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Negócios e economia em carrossel.' },
  { handle: 'infomoney', nome: 'InfoMoney', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Mercado e dinheiro em carrossel; muito compartilhado.' },
  { handle: 'investnews', nome: 'InvestNews', pais: 'BR', idioma: 'pt', formato: 'imagem', a_confirmar: true, por_que: 'Notícia de dinheiro explicada em carrossel.' },
  { handle: 'neofeed', nome: 'NeoFeed', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Negócios e startups; carrosséis de caso.' },
  { handle: 'startse', nome: 'StartSe', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Inovação e negócio em carrossel.' },
  { handle: 'sebrae', nome: 'Sebrae', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Dicas para MEI e pequeno negócio em carrossel: o público do Pedro.' },
  { handle: 'contaazul', nome: 'Conta Azul', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Gestão e imposto para pequena empresa em carrossel.' },
  { handle: 'thenews.cc', nome: 'The News', pais: 'BR', idioma: 'pt', formato: 'imagem', a_confirmar: true, por_que: 'Newsletter de notícias em carrossel com humor.' },
  { handle: 'economistasincero', nome: 'Economista Sincero', pais: 'BR', idioma: 'pt', formato: 'imagem', a_confirmar: true, por_que: 'Economia explicada sem rodeio; carrosséis e prints.' },
  { handle: 'primopobre', nome: 'Primo Pobre', pais: 'BR', idioma: 'pt', formato: 'imagem', a_confirmar: true, por_que: 'Finanças para quem ganha pouco; prints e carrosséis de identificação.' },
  { handle: 'ecommercenapratica', nome: 'E-commerce na Prática', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Venda online e marketplace em carrossel.' },
  { handle: 'olist', nome: 'Olist', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Vender em marketplace: carrosséis de dica para lojista.' },
  { handle: 'nubank', nome: 'Nubank', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Dinheiro do dia a dia em carrossel e meme.' },
  { handle: 'xpinvestimentos', nome: 'XP Investimentos', pais: 'BR', idioma: 'pt', formato: 'imagem', por_que: 'Mercado e economia em carrossel.' },
  { handle: 'jurgenklaric', nome: 'Jürgen Klarić', pais: 'MX', idioma: 'es', formato: 'imagem', a_confirmar: true, por_que: 'Venda e neuromarketing em espanhol; frases em imagem.' },
  { handle: 'emprendedores', nome: 'Emprendedores', pais: 'ES', idioma: 'es', formato: 'imagem', a_confirmar: true, por_que: 'Revista espanhola de empreendedorismo; carrosséis.' },
  { handle: 'forbesmexico', nome: 'Forbes México', pais: 'MX', idioma: 'es', formato: 'imagem', a_confirmar: true, por_que: 'Negócios em espanhol; carrosséis de caso.' },
];

// canal: handle (@) ou id UC… aceito por channels.list (forHandle / id). url: página pública do canal.
const YOUTUBE = [
  { canal: '@thediaryofaceo', nome: 'The Diary Of A CEO', pais: 'GB', idioma: 'en', url: 'https://www.youtube.com/@thediaryofaceo' },
  { canal: '@primorico', nome: 'O Primo Rico', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/@primorico' },
  { canal: '@mepoupe', nome: 'Me Poupe!', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/@mepoupe' },
  { canal: '@valuetainment', nome: 'Valuetainment', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@valuetainment' },
  { canal: '@ImanGadzhi', nome: 'Iman Gadzhi', pais: 'GB', idioma: 'en', url: 'https://www.youtube.com/@ImanGadzhi' },
  { canal: '@garyvee', nome: 'GaryVee', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@garyvee' },
  { canal: '@alexhormozi', nome: 'Alex Hormozi', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@alexhormozi' },
  { canal: '@primopobre', nome: 'Primo Pobre', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/@primopobre' },
  { canal: 'UCbroBIg8zvIH8-F4631wJhA', nome: 'Pablo Marçal', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/channel/UCbroBIg8zvIH8-F4631wJhA' },
  { canal: '@GrantCardone', nome: 'Grant Cardone', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@GrantCardone' },
  { canal: '@danmartell', nome: 'Dan Martell', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@danmartell' },
  { canal: '@simonsquibb', nome: 'Simon Squibb', pais: 'GB', idioma: 'en', url: 'https://www.youtube.com/@simonsquibb' },
  { canal: '@codiesanchezct', nome: 'Codie Sanchez', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@codiesanchezct' },
  { canal: '@joeljota', nome: 'Joel Jota', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/@joeljota' },
  { canal: '@brunoperini', nome: 'Bruno Perini – Você MAIS Rico', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/@brunoperini' },
  { canal: '@geracaodevalor', nome: 'O Conselho | Flávio Augusto', pais: 'BR', idioma: 'pt', url: 'https://www.youtube.com/@geracaodevalor' },
  { canal: 'UCnnnKCtPEBqV4UhEm9lQg4A', nome: 'Invertir Mejor', pais: 'CO', idioma: 'es', url: 'https://www.youtube.com/channel/UCnnnKCtPEBqV4UhEm9lQg4A' },
  { canal: '@mastermunozoficial', nome: 'Carlos Muñoz', pais: 'MX', idioma: 'es', url: 'https://www.youtube.com/@mastermunozoficial' },
  { canal: '@EugeOller', nome: 'Euge Oller', pais: 'ES', idioma: 'es', url: 'https://www.youtube.com/@EugeOller' },
  { canal: '@MyFirstMillionPod', nome: 'My First Million', pais: 'US', idioma: 'en', url: 'https://www.youtube.com/@MyFirstMillionPod' },
];

// Mecanismos virais reconhecidos pela pesquisa (classificação da IA cai obrigatoriamente em um deles).
const MECANISMOS = {
  identidade: 'Frase de identidade: a primeira frase nomeia o público ou declara quem fala ("se você tem um negócio pequeno…").',
  nostalgia: 'Nostalgia: antes e depois, "no meu tempo", o que mudou em 10 anos.',
  historia: 'História de bastidor com personagem, cena e número (do catador ao empresário, a lavanderia que fatura X).',
  lista_erros: 'Lista de erros / "o que eu faria diferente": formato de salvamento.',
  numero: 'Número que abre buraco: um dado seco e surpreendente puxa o resto.',
  confissao: 'Confissão: "fiz isso errado por 2 anos", custo do erro assumido em público.',
  polemica: 'Polêmica/confronto com tese econômica ou política; maior alcance e maior risco.',
  pergunta: 'Pergunta única (entrevista de rua, hipotética de alto risco) que o público responde nos comentários.',
  bastidor: 'Bastidor/ritual: rotina, compromisso público, como a coisa é feita por dentro.',
};
const IDIOMAS = ['pt', 'en', 'es'];
const HANDLE_OK = /^[\w.]{2,30}$/;
const CANAL_OK = /^(@[\w.-]{3,60}|UC[\w-]{20,24})$/;
const conta = () => ACCOUNT.ig_id;
const curto = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Normaliza um item vindo do Pedro (formulário ou API). Devolve null se não tiver handle válido.
function normalizarInstagram(x) {
  const handle = curto(x?.handle, 40).replace(/^@/, '').toLowerCase();
  if (!HANDLE_OK.test(handle)) return null;
  return { handle, nome: curto(x?.nome, 80) || handle, pais: curto(x?.pais, 2).toUpperCase() || '??', idioma: IDIOMAS.includes(x?.idioma) ? x.idioma : 'pt', por_que: curto(x?.por_que, 200), adicionada: true };
}
function normalizarYoutube(x) {
  const canal = curto(x?.canal, 70);
  if (!CANAL_OK.test(canal)) return null;
  return { canal, nome: curto(x?.nome, 80) || canal, pais: curto(x?.pais, 2).toUpperCase() || '??', idioma: IDIOMAS.includes(x?.idioma) ? x.idioma : 'pt', url: canal.startsWith('@') ? `https://www.youtube.com/${canal}` : `https://www.youtube.com/channel/${canal}`, adicionada: true };
}

// Configuração editável: { instagram: { adicionar: [...], remover: [handle] }, youtube: { adicionar: [...], remover: [canal] } }.
function normalizarConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const lista = (v) => (Array.isArray(v) ? v : []);
  return {
    instagram: { adicionar: lista(c.instagram?.adicionar).map(normalizarInstagram).filter(Boolean).slice(0, 60), remover: lista(c.instagram?.remover).map((h) => curto(h, 40).replace(/^@/, '').toLowerCase()).filter((h) => HANDLE_OK.test(h)).slice(0, 100) },
    youtube: { adicionar: lista(c.youtube?.adicionar).map(normalizarYoutube).filter(Boolean).slice(0, 30), remover: lista(c.youtube?.remover).map((x) => curto(x, 70)).filter((x) => CANAL_OK.test(x)).slice(0, 60) },
  };
}

// Lista final = curada − removidas + adicionadas (sem duplicar handle). Determinística: a ordem curada vem primeiro.
function contas(cfg) {
  const c = normalizarConfig(cfg);
  const foraIg = new Set(c.instagram.remover); const foraYt = new Set(c.youtube.remover);
  const ig = INSTAGRAM.filter((x) => !foraIg.has(x.handle)).map((x) => ({ ...x, adicionada: false }));
  const vistos = new Set(ig.map((x) => x.handle));
  for (const x of c.instagram.adicionar) if (!vistos.has(x.handle) && !foraIg.has(x.handle)) { vistos.add(x.handle); ig.push(x); }
  const yt = YOUTUBE.filter((x) => !foraYt.has(x.canal)).map((x) => ({ ...x, adicionada: false }));
  const vistosYt = new Set(yt.map((x) => x.canal));
  for (const x of c.youtube.adicionar) if (!vistosYt.has(x.canal) && !foraYt.has(x.canal)) { vistosYt.add(x.canal); yt.push(x); }
  return { instagram: ig, youtube: yt, removidas: { instagram: [...foraIg], youtube: [...foraYt] } };
}

// Leitura e gravação da configuração no armazém (sem banco: só a lista curada).
async function lerConfig() {
  const a = armazem(); if (!a) return normalizarConfig(null);
  try { return normalizarConfig((await a.config.obter(conta())).reciclagem_contas); } catch { return normalizarConfig(null); }
}
async function salvarConfig(cfg) {
  const a = armazem(); if (!a?.duravel) throw Object.assign(new Error('Editar as contas precisa do banco de dados no servidor.'), { code: 'SEM_BANCO', status: 503 });
  const novo = normalizarConfig(cfg);
  await a.config.salvar(conta(), { reciclagem_contas: novo });
  return novo;
}
async function carregar() { const cfg = await lerConfig(); return { ...contas(cfg), config: cfg }; }

module.exports = { INSTAGRAM, YOUTUBE, MECANISMOS, IDIOMAS, contas, normalizarConfig, normalizarInstagram, normalizarYoutube, lerConfig, salvarConfig, carregar };
