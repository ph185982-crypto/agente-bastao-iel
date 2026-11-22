// Banco de nomes para "Quem é ele?" e "Por trás da marca" (22/11): as notícias dos feeds quase não trazem famoso com dinheiro nem
// marca com decisão de negócio (200 manchetes viraram 1 pauta). Aqui a pauta parte de um NOME conhecido do público e a reportagem
// é buscada sob demanda no Bing Notícias; o pipeline confere os valores na matéria (sem número nos fatos, a peça é barrada).
const PESSOAS = ['Ashton Kutcher', 'Roger Federer', 'Neymar', 'Cristiano Ronaldo', 'Lionel Messi', 'Michael Jordan', 'LeBron James', 'Jay-Z', 'Rihanna', 'Kim Kardashian', 'Kylie Jenner', 'Justin Timberlake', 'Dwayne Johnson', 'Ryan Reynolds', 'Jennifer Lopez', 'Beyoncé', 'Snoop Dogg', 'Will Smith', 'George Clooney', 'Leonardo DiCaprio', 'Serena Williams', 'David Beckham', "Shaquille O'Neal", 'Magic Johnson', 'Tom Brady', 'Anitta', 'Luciano Huck', 'Silvio Santos', 'Gisele Bündchen', 'Ivete Sangalo', 'Xuxa', 'Ronaldo Fenômeno', 'Kaká', 'Ronaldinho', 'Gustavo Kuerten', 'Rafael Nadal', 'Novak Djokovic', 'Lewis Hamilton', 'Tiger Woods', 'Usain Bolt', 'Conor McGregor', 'Floyd Mayweather', 'Drake', 'Taylor Swift', 'Madonna', 'Paris Hilton', 'Jessica Alba', 'Gwyneth Paltrow', 'Reese Witherspoon', 'Selena Gomez', 'Elon Musk', 'Jeff Bezos', 'Bill Gates', 'Warren Buffett', 'Mark Zuckerberg', 'Steve Jobs', 'Oprah Winfrey', 'Richard Branson', 'Jack Ma', 'Abílio Diniz', 'Jorge Paulo Lemann', 'Flávio Augusto da Silva', 'Carlos Wizard', 'Luiza Trajano', 'Marcos Galperin', 'André Street', 'David Vélez', 'Eduardo Saverin', 'Larry Page', 'Sergey Brin', 'Jensen Huang', 'Sam Altman', 'Mark Cuban', 'Peter Thiel', 'Ray Dalio', 'Jim Simons', 'Phil Knight', 'Sara Blakely', 'Martha Stewart', 'Donald Trump Jr.', 'Zico', 'Oscar Schmidt', 'Hortência', 'Bernardinho', 'Rony Meisler', 'Alexandre Birman', 'Rubens Ometto', 'Eike Batista', 'Joesley Batista', 'Walter Salles', 'Chico Buarque'];
const MARCAS = ['Havaianas', 'Cacau Show', 'Coco Bambu', 'Magazine Luiza', 'Natura', 'O Boticário', 'Nubank', 'iFood', 'Mercado Livre', 'Americanas', 'Lojas Renner', 'Riachuelo', 'Zara', 'Shein', 'Nike', 'Adidas', 'Apple', 'Tesla', 'Starbucks', "McDonald's", 'Burger King', 'Coca-Cola', 'Netflix', 'Spotify', 'Uber', 'Airbnb', 'Amazon', 'Lego', 'IKEA', 'Ambev', 'Bauducco', 'Dengo', 'Kopenhagen', 'Reserva', 'Arezzo', 'Farm', 'Vivara', 'Localiza', 'Azul', 'Gol', 'Zé Delivery', 'Madero', 'Outback', "Habib's", 'Giraffas', 'Spoleto', 'Pão de Açúcar', 'Carrefour', 'Assaí', 'Atacadão', 'Casas Bahia', 'Fast Shop', 'Kabum', 'Shopee', 'Temu', 'Samsung', 'Xiaomi', 'Google', 'Meta', 'TikTok', 'Disney', 'Red Bull', 'Monster Energy', 'Prada', 'Louis Vuitton', 'Gucci', 'Rolex', 'Ferrari', 'Porsche', 'BYD', 'Toyota', 'Fiat', 'Volkswagen', 'Embraer', 'Petrobras', 'Vale', 'Itaú', 'Bradesco', 'XP Investimentos', 'PicPay', 'Mercado Pago', 'Inter', 'C6 Bank', 'Stone', 'Hering', 'Marisa', 'Centauro', 'Decathlon', 'Puma', 'Under Armour', 'Lululemon', 'Skechers', 'Vans', 'Crocs', 'Jequiti', 'Avon', 'Granado', 'Quem Disse, Berenice?', 'Sephora', 'Oakley', 'Ray-Ban', 'Chilli Beans', 'Brasil Cacau', 'Kalunga', 'Ri Happy', 'Pernambucanas', 'Leroy Merlin', 'Tok&Stok', 'Camicado', 'Dafiti', 'Netshoes', 'Zattini', 'Boticário', 'Eudora', 'Seara', 'JBS', 'Sadia', 'Perdigão', 'Itambé', 'Nestlé', 'Danone', 'Heinz', 'Pringles', 'Oreo', 'Bis', 'Ouro Branco', 'Garoto', 'Lacta', 'Hershey', 'Ferrero', 'Nutella', 'Magnum', 'Kibon', 'Sorvetes Diletto', 'Frutaria', 'Rappi', '99', 'Loggi', 'Gympass', 'Smart Fit', 'Bodytech', 'Cogna', 'Kroton', 'Estácio', 'Hotmart', 'Eduzz', 'Vtex', 'RD Station', 'Totvs', 'Movile', 'Creditas', 'Loft', 'QuintoAndar'];
const COOLDOWN_DIAS = 45;

const BUSCA = {
  revelacao: (n) => `"${n}" investiu milhões empresa retorno participação`,
  marca: (n) => `${n} estratégia faturamento lojas expansão`,
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const TEM_VALOR = /(R\$|US\$|€)\s?\d|\d[\d.,]*\s*(mil\b|milh|bilh|%)/i;

function pontuar(item, nome) {
  const t = norm(item.titulo); const partes = norm(nome).split(' ').filter((p) => p.length >= 3);
  if (!partes.length || !partes.every((p) => t.includes(p))) return -1; // o nome precisa estar no título
  let p = 1;
  if (TEM_VALOR.test(item.titulo)) p += 3;                            // título com valor em dinheiro
  if (/investiu|investimento|aposta|comprou|vendeu|fatura|valor de mercado|participa/.test(t)) p += 2;
  if (/morre|morte|preso|pris|processo|acus|denunci|polícia|policia|depoimento|crime|escândalo|escandalo/.test(t)) p -= 6;
  if (item.publicada_em && Date.now() - Date.parse(item.publicada_em) > 400 * 86400000) p -= 2;
  return p;
}

// Próximo nome do tipo ('revelacao' = pessoa, 'marca') sem uso nos últimos 45 dias, com reportagem boa achada no Bing Notícias.
// Devolve { id, titulo, url, marca } ou null. Marca o nome como tentado (acertando ou não) para não repetir a tentativa.
async function proximoNome(tipo, est, { agora = Date.now(), deps = {}, restante = () => 60000 } = {}) {
  const lista = tipo === 'marca' ? MARCAS : PESSOAS;
  const usados = ((est.nomes ||= {})[tipo] ||= {});
  const livres = lista.filter((n) => !usados[n] || agora - Date.parse(usados[n]) > COOLDOWN_DIAS * 86400000);
  const feeds = deps.feeds || require('../feeds');
  for (const nome of [...livres].sort(() => (deps.sortear || Math.random)() - 0.5).slice(0, 6)) {
    if (restante() < 15000) break;
    usados[nome] = new Date(agora).toISOString();
    try {
      const url = `https://www.bing.com/news/search?q=${encodeURIComponent(BUSCA[tipo](nome))}&format=rss&setlang=pt-BR&cc=BR`;
      const r = await feeds.lerFeed({ id: `bing_nome_${tipo}`, nome: 'Bing Notícias', url, tipo: 'jornal' }, { force: true });
      const melhor = (r.itens || []).map((it) => ({ it, p: pontuar(it, nome) })).filter((x) => x.p >= 2).sort((a, b) => b.p - a.p)[0];
      if (melhor) return { id: `n_${require('crypto').createHash('sha1').update(melhor.it.url).digest('hex').slice(0, 8)}`, titulo: melhor.it.titulo, url: melhor.it.url, marca: nome, conhecida: 9 };
    } catch { /* tenta o próximo nome */ }
  }
  return null;
}

module.exports = { proximoNome, pontuar, PESSOAS, MARCAS, COOLDOWN_DIAS };
