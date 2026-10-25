// Material de teste do Radar: feeds, páginas e respostas de IA SIMULADOS. Nada aqui acessa a rede nem usa chave real.
const C = require('./radar/config');

const NEG = [
  { nome: 'Lumen Pets', dominio: 'lumenpets.com', cat: 'servico', pais: 'EUA' },
  { nome: 'FundOnly', dominio: 'fundonly.io', cat: 'startup', pais: 'Reino Unido' },
  { nome: 'VelhoNegocio', dominio: 'velhonegocio.com', cat: 'ecommerce', pais: 'EUA' },
  { nome: 'PiramideX', dominio: 'piramidex.com', cat: 'servico', pais: 'EUA' },
  { nome: 'FantasmaApp', dominio: 'fantasmaapp.com', cat: 'saas', pais: 'EUA' },
];
for (let i = 1; i <= 34; i++) NEG.push({ nome: `Negocio${i}`, dominio: `negocio${i}.com`, cat: ['saas', 'startup', 'produto', 'servico', 'ecommerce', 'negocio_local'][i % 6], pais: 'EUA' });

const FEED_DE = (fonteId) => ({ producthunt: 0, techcrunch: 1, fastcompany: 2, inc: 3, exame: 4, eustartups: 5, kickstarter: 6, entrepreneur: 7 }[fonteId] ?? null);
const rss = (itens) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${itens.map((i) => `<item><title>${i.titulo}</title><link>${i.url}</link><pubDate>${new Date(i.data).toUTCString()}</pubDate><description>${i.resumo}</description></item>`).join('')}</channel></rss>`;

const HOST_FEED = { producthunt: 'producthunt.com', techcrunch: 'techcrunch.com', fastcompany: 'fastcompany.com', inc: 'inc.com', exame: 'exame.com', eustartups: 'eu-startups.com', kickstarter: 'kickstarter.com', entrepreneur: 'entrepreneur.com' };
function itensDoFeed(fonteId, agora) {
  const k = FEED_DE(fonteId); if (k === null) return [];
  return NEG.filter((n, i) => i % 8 === k || (n.nome === 'Lumen Pets' && [1, 4].includes(k))).map((n) => ({ titulo: `${n.nome} lança serviço novo para donos de pequenos negócios (via ${fonteId})`, url: `https://${HOST_FEED[fonteId]}/2026/10/${n.dominio.split('.')[0]}`, data: agora - 2 * 86400000, resumo: `${n.nome} (${n.pais}) mostra como funciona um negócio com receita recorrente.` }));
}

// Páginas lidas na verificação. Cada uma devolve { legivel, texto, ... } como research.lerFonte.
const PAGINAS = {
  'lumenpets.com': { titulo: 'Lumen Pets — banho para cães em casa', veiculo: 'Lumen Pets', publicada_em: '2026-10-20T00:00:00Z', texto: 'Lumen Pets leva um banhista profissional até a sua porta. Assinatura mensal a partir de US$ 39. Segundo nosso último balanço, mais de 120.000 clientes usam o Lumen Pets e a receita anual chegou a US$ 5 milhões em 2025. Lançamos o serviço em 2024 nos Estados Unidos.' },
  'techcrunch.com/2026/10/lumenpets': { titulo: 'Lumen Pets wants to bathe your dog at home', veiculo: 'TechCrunch', publicada_em: '2026-10-21T10:00:00Z', texto: 'Lumen Pets, a startup that sends groomers to customers’ homes, says it has more than 120,000 customers. The company, launched in 2024, charges a monthly subscription. Investors have not been disclosed.' },
  'exame.com/2026/10/lumenpets': { titulo: 'Startup de banho para cães atrai 120 mil clientes', veiculo: 'Exame', publicada_em: '2026-10-22T10:00:00Z', texto: 'A Lumen Pets atende mais de 120.000 clientes nos Estados Unidos com banho a domicílio cobrado por assinatura mensal. A empresa foi lançada em 2024.' },
  'fundonly.io': { titulo: 'FundOnly', veiculo: 'FundOnly', publicada_em: '2026-10-19T00:00:00Z', texto: 'FundOnly é uma plataforma para fundos. We raised $20 million in a Series B round led by Acme Capital. The company is valued at $200 million. FundOnly is the new way to manage funds.' },
  'velhonegocio.com': { titulo: 'VelhoNegocio — desde 2009', veiculo: 'VelhoNegocio', publicada_em: '2026-10-10T00:00:00Z', texto: 'VelhoNegocio was founded in 2009 and sells garden tools online. More than 300,000 customers have bought from VelhoNegocio. Our annual sales reached $12 million.' },
  'piramidex.com': { titulo: 'PiramideX', veiculo: 'PiramideX', publicada_em: '2026-10-10T00:00:00Z', texto: 'PiramideX paga renda garantida de 10% ao mês. Ganhe dinheiro fácil recrutando amigos. Marketing multinível com lucro garantido. PiramideX tem 50.000 membros.' },
};
const paginaPara = (url) => { const k = Object.keys(PAGINAS).find((x) => url.includes(x)); return k ? PAGINAS[k] : null; };

let _img;
async function imagemFake() {
  if (_img) return _img;
  const sharp = require('sharp');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#cfd8e3"/><rect y="520" width="1200" height="280" fill="#7a9a6b"/><circle cx="880" cy="190" r="90" fill="#f4d35e"/><rect x="250" y="260" width="420" height="330" fill="#b5651d"/><polygon points="220,270 460,110 700,270" fill="#8c3b2a"/><rect x="420" y="400" width="90" height="190" fill="#3b2a20"/></svg>';
  _img = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  return _img;
}

function fakeFetcher({ agora = Date.now(), falhar = [], lento = [] } = {}) {
  return async (url) => {
    if (lento.some((x) => url.includes(x))) { const e = new Error('A página demorou demais para responder.'); e.code = 'TIMEOUT'; throw e; }
    if (falhar.some((x) => url.includes(x))) return { status: 403, acesso_negado: true, corpo: '', url_final: url, tipo: 'text/html' };
    const feed = C.FONTES.find((f) => f.url === url);
    if (feed) {
      if (feed.classe === 'tendencia') return { status: 200, corpo: '<rss><channel><item><title>lumen pets</title><ht:approx_traffic>200+</ht:approx_traffic></item></channel></rss>', url_final: url, tipo: 'text/xml' };
      return { status: 200, corpo: rss(itensDoFeed(feed.id, agora)), url_final: url, tipo: 'application/rss+xml' };
    }
    if (url.includes('hn.algolia.com')) {
      const hits = url.includes('show_hn') ? [{ objectID: '1', title: 'Show HN: Lumen Pets, banho para cães em casa', url: 'https://lumenpets.com', points: 150, num_comments: 40, created_at: new Date(agora - 86400000).toISOString(), story_text: 'Hi HN, we are the founders of Lumen Pets. We send groomers to your door.' }] : [];
      return { status: 200, corpo: JSON.stringify({ hits }), url_final: url, tipo: 'application/json' };
    }
    if (/\/og\.jpg$/.test(url)) { if (!url.includes('lumenpets')) return { status: 404, corpo: '', url_final: url, tipo: 'text/html' }; return { status: 200, corpo: await imagemFake(), url_final: url, tipo: 'image/jpeg' }; }
    if (url.includes('itunes.apple.com')) return { status: 200, corpo: JSON.stringify({ results: [] }), url_final: url, tipo: 'application/json' };
    const p = paginaPara(url);
    if (p) return { status: 200, corpo: `<html><head><title>${p.titulo}</title><meta property="og:image" content="https://${new URL(url).hostname}/og.jpg"></head><body>${p.texto}</body></html>`, url_final: url, tipo: 'text/html' };
    return { status: 404, corpo: '', url_final: url, tipo: 'text/html' };
  };
}

// lerFonte simulado (devolve a página pelo domínio)
const fakeLerFonte = async (url) => {
  const p = paginaPara(url);
  if (!p) return { legivel: false, acesso: 'erro', url_final: url, texto: '' };
  return { legivel: true, acesso: 'ok', url_final: url, dominio: new URL(url).hostname.replace(/^www\./, ''), titulo: p.titulo, veiculo: p.veiculo, publicada_em: p.publicada_em, texto: p.texto, acessada_em: new Date().toISOString() };
};

// IA simulada: responde pelo conteúdo do prompt.
function fakePedirJson({ falharNa = null, semPontuacao = false } = {}) {
  const chamadas = [];
  const fn = async ({ sistema, usuario }) => {
    const tipo = /pesquisadora do perfil/.test(sistema) ? 'extrair' : /Você confere fatos/.test(sistema) ? 'afirmacoes' : /Você avalia ideias/.test(sistema) ? 'avaliar' : /escreve carrosséis/.test(sistema) ? 'copy' : /roteiro de um Reels/.test(sistema) ? 'reels' : 'outro';
    chamadas.push(tipo);
    if (falharNa === tipo) throw Object.assign(new Error('IA indisponível (teste)'), { status: 500 });
    const llm = { provider: 'simulado', model: 'teste', tokens: { entrada: 100, saida: 50, total: 150 } };
    if (tipo === 'extrair') {
      const itens = JSON.parse(usuario.split('\n')[1]);
      const porNome = new Map();
      for (const it of itens) { const n = NEG.find((x) => it.titulo.startsWith(x.nome)); if (!n) continue; (porNome.get(n.nome) || porNome.set(n.nome, { n, ids: [] }).get(n.nome)).ids.push(it.id); }
      return { llm, dados: { candidatos: [...porNome.values()].map(({ n, ids }) => ({ nome: n.nome, pais: n.pais, categoria: n.cat, ia: false, resumo: `${n.nome} oferece um serviço simples para pequenos negócios.`, problema: 'um problema comum que todo mundo ignora', solucao: `${n.nome} resolve o problema com um serviço recorrente.`, como_ganha_dinheiro: 'cobra uma assinatura mensal', modelo_receita: 'assinatura', prova_demanda_citada: 'não informado', investimento_para_testar: { nivel: 'baixo', texto: 'Dá para testar com poucos clientes.' }, adaptacao_brasil: 'Testar com um grupo pequeno de clientes pagantes.', url_oficial: null, site_provavel: `https://${n.dominio}`, itens: ids, interesse: n.nome === 'Lumen Pets' ? 3 : n.nome === 'PiramideX' ? 1 : 2, sinais_de_risco: [] })) } };
    }
    if (tipo === 'afirmacoes') {
      const nome = /Empresa\/produto: (.+)/.exec(usuario)[1].trim();
      const docs = [...usuario.matchAll(/\[DOCUMENTO (\d+)\] veículo=(.*?) · classe=(\w+)/g)].map((m) => ({ i: Number(m[1]), classe: m[3] }));
      const afs = [];
      const trecho = (re) => { const m = re.exec(usuario); return m ? m[0] : null; };
      if (nome === 'Lumen Pets') {
        docs.forEach((d) => { const t = d.classe === 'imprensa' ? trecho(/more than 120,000 customers|atende mais de 120\.000 clientes/) : trecho(/mais de 120\.000 clientes usam o Lumen Pets/); if (t) afs.push({ documento: d.i, tipo: 'clientes', texto: 'O Lumen Pets tem mais de 120 mil clientes.', numero: 120000, unidade: 'clientes', trecho: t }); });
        const rec = trecho(/a receita anual chegou a US\$ 5 milhões em 2025/); const oficial = docs.find((d) => d.classe === 'oficial'); if (rec && oficial) afs.push({ documento: oficial.i, tipo: 'receita', texto: 'A receita anual chegou a US$ 5 milhões.', numero: 5000000, unidade: 'USD', periodo: '2025', trecho: rec });
        const preco = trecho(/Assinatura mensal a partir de US\$ 39/); if (preco && oficial) afs.push({ documento: oficial.i, tipo: 'modelo_receita', texto: 'A empresa cobra assinatura mensal.', numero: null, trecho: preco });
        const fund = trecho(/Lançamos o serviço em 2024/); if (fund && oficial) afs.push({ documento: oficial.i, tipo: 'lancamento', texto: 'O serviço foi lançado em 2024.', numero: 2024, trecho: fund });
      } else if (nome === 'FundOnly') {
        afs.push({ documento: 0, tipo: 'receita', texto: 'A empresa fatura US$ 20 milhões.', numero: 20000000, unidade: 'USD', trecho: 'We raised $20 million in a Series B round led by Acme Capital' });
        afs.push({ documento: 0, tipo: 'valuation', texto: 'A empresa vale US$ 200 milhões.', numero: 200000000, unidade: 'USD', trecho: 'The company is valued at $200 million' });
      } else if (nome === 'VelhoNegocio') {
        afs.push({ documento: 0, tipo: 'clientes', texto: 'Mais de 300 mil clientes.', numero: 300000, unidade: 'clientes', trecho: 'More than 300,000 customers have bought from VelhoNegocio' });
        afs.push({ documento: 0, tipo: 'fundacao', texto: 'Fundada em 2009.', numero: 2009, trecho: 'VelhoNegocio was founded in 2009' });
      } else if (nome === 'PiramideX') {
        afs.push({ documento: 0, tipo: 'usuarios', texto: 'Tem 50 mil membros.', numero: 50000, unidade: 'usuarios', trecho: 'PiramideX tem 50.000 membros' });
      }
      return { llm, dados: { afirmacoes: afs } };
    }
    if (tipo === 'avaliar') {
      const ops = JSON.parse(usuario.split('\n')[1]);
      return { llm, dados: { avaliacoes: semPontuacao ? [] : ops.map((o) => ({ id: o.id, niveis: o.nome === 'Lumen Pets' ? { novidade: 3, demanda: 3, receita: 3, compreensao: 3, brasil: 3, investimento: 3, visual: 3, compartilhamento: 3 } : { novidade: 2, demanda: 2, receita: 2, compreensao: 2, brasil: 2, investimento: 2, visual: 2, compartilhamento: 2 }, justificativas: { demanda: 'Dados confirmados.' }, sinais_de_risco: [], motivo_geral: 'Ideia simples.' })) } };
    }
    if (tipo === 'copy') {
      return { llm, dados: { slides: [
        { n: 1, texto: 'Segundo a empresa, esse serviço de **banho para cães** em casa já tem 120 mil clientes' },
        { n: 2, problema: 'dar banho no cachorro em casa vira bagunça e o pet shop vive lotado' },
        { n: 3, produto: 'um serviço que leva o banhista até a porta', resultado: 'o cachorro ficar limpo sem você sair' },
        { n: 4, modelo: 'assinatura', explicacao: 'o cliente paga uma mensalidade fixa e recebe visitas toda semana' },
        { n: 5, titulo: 'O que a empresa mostra', itens: [{ claim_id: 'c1', rotulo: 'clientes' }, { claim_id: 'c2', rotulo: 'de receita anual' }] },
        { n: 6, dor: 'dor de todo dono', facilidade: 'serviço na porta', recorrencia: 'cobrança mensal' },
        { n: 7, publico_inicial: 'donos de cães', produto_minimo: 'banho em domicílio', canal_de_vendas: 'grupos de condomínio', forma_de_cobranca: 'pacote mensal', teste_baixo_custo: 'cinco clientes' },
      ], legenda: { primeira_linha: 'Esse serviço leva o banho do cachorro até a sua porta.', resumo: 'O Lumen Pets, dos EUA, manda um banhista à casa do cliente.', como_ganha: 'Cobra uma assinatura mensal, segundo a empresa.', brasil: 'No Brasil, a ideia poderia ser testada em condomínios.' }, hashtags: ['negocios', 'empreendedorismo', 'ideiasquedaodinheiro'] } };
    }
    if (tipo === 'reels') return { llm, dados: { gancho: 'Esse serviço leva o banho do cachorro até você', blocos: [{ tempo: '3-10s', fala: 'O problema é simples: levar o cachorro ao pet shop dá trabalho.', tela: 'O problema' }, { tempo: '10-18s', fala: 'A empresa cobra uma assinatura mensal.', tela: 'Como ganha' }, { tempo: '18-26s', fala: 'Segundo a empresa, são mais de 120 mil clientes.', tela: 'A prova' }, { tempo: '26-34s', fala: 'No Brasil, a ideia poderia ser testada em condomínios.', tela: 'Hipótese' }], fechamento: 'Segue @pedro_destrava para não perder a próxima ideia.' } };
    return { llm, dados: {} };
  };
  fn.chamadas = chamadas;
  return fn;
}

module.exports = { imagemFake, NEG, PAGINAS, fakeFetcher, fakeLerFonte, fakePedirJson, rss, itensDoFeed };
