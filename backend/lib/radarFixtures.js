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
    const tipo = /padrão "Pedro Destrava — Minimalista"/.test(sistema) ? 'v1' : /revisor editorial/.test(sistema) ? 'revisor' : /identifica o negócio principal/.test(sistema) ? 'pauta' : /reescreve UMA tela do carrossel/.test(sistema) ? 'tela_v1' : /pesquisadora do perfil/.test(sistema) ? 'extrair' : /Você confere fatos/.test(sistema) ? 'afirmacoes' : /Você avalia ideias/.test(sistema) ? 'avaliar' : /redator e diretor de arte/.test(sistema) ? 'serie' : /reescreve UMA tela/.test(sistema) ? 'tela' : /escreve carrosséis/.test(sistema) ? 'copy' : /roteiro de um Reels/.test(sistema) ? 'reels' : 'outro';
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
        const seg = (i) => (usuario.split(/\[DOCUMENTO /).find((x) => x.startsWith(`${i}]`)) || '');
        const noDoc = (i, re) => { const m = re.exec(seg(i)); return m ? m[0] : null; };
        docs.forEach((d) => { const t = d.classe === 'imprensa' ? noDoc(d.i, /more than 120,000 customers|atende mais de 120\.000 clientes/) : noDoc(d.i, /mais de 120\.000 clientes usam o Lumen Pets/); if (t) afs.push({ documento: d.i, tipo: 'clientes', texto: 'O Lumen Pets tem mais de 120 mil clientes.', numero: 120000, unidade: 'clientes', trecho: t }); });
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
      return { llm, dados: { site_oficial: nome === 'Lumen Pets' && !docs.some((d) => d.classe === 'oficial') ? 'https://lumenpets.com' : null, afirmacoes: afs } };
    }
    if (tipo === 'avaliar') {
      const ops = JSON.parse(usuario.split('\n')[1]);
      return { llm, dados: { avaliacoes: semPontuacao ? [] : ops.map((o) => ({ id: o.id, niveis: o.nome === 'Lumen Pets' ? { novidade: 3, demanda: 3, receita: 3, compreensao: 3, brasil: 3, investimento: 3, visual: 3, compartilhamento: 3 } : { novidade: 2, demanda: 2, receita: 2, compreensao: 2, brasil: 2, investimento: 2, visual: 2, compartilhamento: 2 }, justificativas: { demanda: 'Dados confirmados.' }, sinais_de_risco: [], motivo_geral: 'Ideia simples.' })) } };
    }
    if (tipo === 'copy') {
      const dv = JSON.parse(usuario.split('\n')[1]).DADOS_VERIFICADOS || [];
      const idDe = (...tipos) => (dv.find((d) => tipos.includes(d.tipo)) || {}).id;
      const itens5 = [{ claim_id: idDe('clientes', 'usuarios'), rotulo: 'clientes' }, { claim_id: idDe('receita'), rotulo: 'de receita anual' }].filter((i) => i.claim_id);
      return { llm, dados: { slides: [
        { n: 1, texto: 'Segundo a empresa, esse serviço de **banho para cães** em casa já tem 120 mil clientes' },
        { n: 2, problema: 'dar banho no cachorro em casa vira bagunça e o pet shop vive lotado' },
        { n: 3, produto: 'um serviço que leva o banhista até a porta', resultado: 'o cachorro ficar limpo sem você sair' },
        { n: 4, modelo: 'assinatura', explicacao: 'o cliente paga uma mensalidade fixa e recebe visitas toda semana' },
        { n: 5, titulo: 'O que a empresa mostra', itens: itens5 },
        { n: 6, dor: 'dor de todo dono', facilidade: 'serviço na porta', recorrencia: 'cobrança mensal' },
        { n: 7, publico_inicial: 'donos de cães', produto_minimo: 'banho em domicílio', canal_de_vendas: 'grupos de condomínio', forma_de_cobranca: 'pacote mensal', teste_baixo_custo: 'cinco clientes' },
      ], legenda: { primeira_linha: 'Esse serviço leva o banho do cachorro até a sua porta.', resumo: 'O Lumen Pets, dos EUA, manda um banhista à casa do cliente.', como_ganha: 'Cobra uma assinatura mensal, segundo a empresa.', brasil: 'No Brasil, a ideia poderia ser testada em condomínios.' }, hashtags: ['negocios', 'empreendedorismo', 'ideiasquedaodinheiro'] } };
    }
    if (tipo === 'serie') {
      const dado = JSON.parse(usuario.split('\n')[1]); const dv = dado.DADOS_VERIFICADOS || []; const nome = dado.negocio.nome;
      const pessoas = (dv.find((d) => ['clientes', 'usuarios'].includes(d.tipo) && d.numero !== null) || dv.find((d) => d.numero !== null) || {}).id;
      return { llm, dados: {
        ficha: { problema: 'Dar banho no cachorro dá trabalho e o pet shop vive lotado.', quem_compra: 'Donos de cães que não têm tempo.', por_que_compra: 'O serviço chega até a porta de casa.', como_cobra: 'Assinatura mensal, segundo a empresa.', evidencia: [{ claim_id: pessoas, nota: 'Número de clientes informado pela empresa.' }], surpresa: 'O banho vai até o cliente, e não o contrário.', dificuldades: ['Precisa de banhistas confiáveis em cada bairro.'], inspiracao_brasil: 'Hipótese: testar com condomínios.', imagens_necessarias: [{ funcao: 'descoberta', mostrar: 'o banhista em ação' }], ilustracao: { consulta: 'dog bath', descricao: 'cachorro no banho' } },
        capas: [{ angulo: 'contradicao', titulo: `Este serviço ganha dinheiro **lavando cachorro** na porta da sua casa.`, apoio: 'E o cliente nem sai do sofá.' }, { angulo: 'situacao', titulo: 'Sábado de manhã, o dono sai com o cachorro sujo e **volta sem ele**.', apoio: 'Alguém criou um jeito de resolver isso.' }, { angulo: 'descoberta', titulo: `${nome} levou o **banho do cachorro** para a porta do cliente.`, apoio: 'Sem pet shop no meio.' }],
        capa_escolhida: 1, omitir: null,
        telas: [
          { funcao: 'descoberta' },
          { funcao: 'tensao', rotulo: 'A conta que ninguém vê', titulo: 'O dono perde a manhã.', linha2: 'O pet shop perde o horário.', apoio: 'Levar o cachorro para o banho toma tempo, e a loja lotada não consegue atender todo mundo.', palavra: 'Tempo' },
          { funcao: 'revelacao', rotulo: `Aí entra a **${nome}**`, titulo: 'Ela leva o **banhista** até a porta.', apoio: 'O cliente marca o horário pelo aplicativo e o profissional chega com tudo o que precisa.' },
          { funcao: 'dinheiro', rotulo: 'Onde está o dinheiro?', titulo: 'O cliente economiza tempo. O banhista trabalha. E **a empresa cobra.**', apoio: 'A receita vem de uma assinatura mensal paga pelo cliente.' },
          { funcao: 'evidencia', rotulo: 'A ideia pegou', claim_id: pessoas, legenda: 'clientes, segundo a empresa.', apoio: 'Número informado pela própria empresa. Clientes cadastrados não são clientes ativos.' },
          { funcao: 'estrategia', rotulo: 'O detalhe que importa', titulo: 'A ideia parece **simples**. A operação é o desafio.', apoio: 'Encontrar banhistas confiáveis em cada bairro, no horário certo, é o que decide se o cliente volta.' },
          { funcao: 'licao', rotulo: 'A lição para quem quer começar', titulo: 'Antes de criar um app, **converse com quem tem o problema.**', apoio: 'No Brasil, a ideia poderia ser testada em um condomínio: veja se os moradores querem o serviço.', nota: 'Não é promessa de lucro. É uma hipótese para testar.', palavra: 'Antes' },
          { funcao: 'pedro', titulo: 'Tem negócio bom escondido em **problema que todo mundo ignora.**', apoio: 'para descobrir negócios que já funcionam no mundo.' },
        ],
        legenda: { primeira_linha: 'O banho do cachorro foi até a porta do cliente.', historia: 'A empresa resolveu um problema comum e transformou o tempo perdido do dono em serviço recorrente.', como_ganha: 'O cliente paga uma assinatura mensal.', brasil: 'Hipótese para testar: começar por um condomínio, antes de investir.' }, hashtags: ['negocios', 'empreendedorismo'] } };
    }
    if (tipo === 'v1') { const dado = JSON.parse(usuario.split('\n')[1]); return { llm, dados: rascunhoV1(dado.negocio?.nome || 'Lumen Pets', dado.DADOS_VERIFICADOS || []) }; }
    if (tipo === 'revisor') return { llm, dados: { telas: Array.from({ length: 7 }, () => ({ problema: 'nenhum' })) } };
    if (tipo === 'tela_v1') return { llm, dados: { titulo: 'O banhista vai até a porta, porque o tempo do dono vale mais que o deslocamento.', corpo: 'O cliente marca pelo aplicativo e o banhista chega com tudo. Assim o dono não perde a manhã e a assinatura mensal se repete toda semana.', apoio: 'Segue @pedro_destrava para ver a estratégia por trás de negócios que funcionam.' } };
    if (tipo === 'pauta') {
      const m = /"titulo":"([^"]*)"/.exec(usuario); const nome = NEG.find((n) => usuario.includes(n.nome))?.nome || null;
      if (!nome) return { llm, dados: { nome: null, motivo: 'o texto não fala de um negócio específico' } };
      const n = NEG.find((x) => x.nome === nome);
      return { llm, dados: { nome, site_oficial: `https://${n.dominio}`, pais: n.pais, categoria: n.cat, resumo: `${nome} oferece um serviço recorrente.`, problema: 'levar o cachorro ao pet shop toma tempo', solucao: 'o banhista vai até a casa do cliente', como_ganha_dinheiro: 'assinatura mensal', modelo_receita: 'assinatura', titulo_lido: m ? m[1] : '' } };
    }
    if (tipo === 'tela') {
      const dado = JSON.parse(usuario.split('\n')[1]); const nome = dado.negocio.nome;
      return { llm, dados: { rotulo: 'Texto refeito', titulo: `${nome} mostra que **simples** também vende.`, apoio: 'Uma frase nova e curta, escrita para esta tela, sem repetir o que as outras já dizem aos leitores.' } };
    }
    if (tipo === 'reels') return { llm, dados: { gancho: 'Esse serviço leva o banho do cachorro até você', blocos: [{ tempo: '3-10s', fala: 'O problema é simples: levar o cachorro ao pet shop dá trabalho.', tela: 'O problema' }, { tempo: '10-18s', fala: 'A empresa cobra uma assinatura mensal.', tela: 'Como ganha' }, { tempo: '18-26s', fala: 'Segundo a empresa, são mais de 120 mil clientes.', tela: 'A prova' }, { tempo: '26-34s', fala: 'No Brasil, a ideia poderia ser testada em condomínios.', tela: 'Hipótese' }], fechamento: 'Segue @pedro_destrava para não perder a próxima ideia.' } };
    return { llm, dados: {} };
  };
  fn.chamadas = chamadas;
  return fn;
}

// Rascunho simulado do padrão v1 (Lumen Pets). Usa só os ids das afirmações verificadas recebidas.
function rascunhoV1(nome, dv) {
  const id = (...t) => (dv.find((d) => t.includes(d.tipo)) || {}).id || null;
  const cCli = id('clientes', 'usuarios'); const cMod = id('modelo_receita'); const cRec = id('receita');
  return {
    sem_pauta: null,
    briefing: {
      publico: 'quem quer abrir um serviço local recorrente', interesse: 'entender como um serviço simples vira receita mensal', nivel_conhecimento: 'sabe o que é assinatura, não conhece a operação', aplicacao: 'testar banho em domicílio com cinco clientes de um condomínio', duvidas_abertas: ['Quantos clientes continuam ativos depois de três meses.'],
      teste_de_valor: { o_que_aprende: 'que a assinatura funciona quando o serviço vai até o cliente', por_que_importa: 'mostra onde a recorrência nasce e onde ela quebra', aprovado: true },
      negocio: { nome, produto: 'banho para cães em casa', problema: 'levar o cachorro ao pet shop toma a manhã do dono', para_quem: 'donos de cães', quem_paga: 'o dono do cachorro', pelo_que_paga: 'o banho sem sair de casa', forma_cobranca: 'assinatura mensal', operacao: 'banhista vai até a casa com o equipamento' },
      fatos: [
        { id: 'f1', texto: `O ${nome} tem mais de 120 mil clientes, segundo a empresa.`, claim_id: cCli, campo_do_negocio: null },
        { id: 'f2', texto: 'A empresa cobra assinatura mensal.', claim_id: cMod, campo_do_negocio: null },
        { id: 'f3', texto: 'O banhista vai até a casa do cliente.', claim_id: null, campo_do_negocio: 'operacao' },
        ...(cRec ? [{ id: 'f4', texto: 'A empresa informa receita anual.', claim_id: cRec, campo_do_negocio: null }] : []),
      ],
      analises: [{ id: 'a1', texto: 'Uma leitura é que o cliente paga pelo tempo que deixa de perder, não só pelo banho.', base: ['f2', 'f3'], causalidade_demonstrada: false }],
      hipoteses: [{ id: 'h1', texto: 'Poderia ser testado em um condomínio com cinco clientes.' }],
      decisao_especifica: { texto: 'O banho vai até o cliente, e não o contrário, com cobrança mensal.', base: ['f2', 'f3'] },
      mecanismos: [
        { nome: 'Banhista na porta', como_funciona: 'O banhista vai até a casa com o equipamento, então o dono não se desloca.', exemplo: 'O cliente marca pelo aplicativo e recebe o banhista no sábado.', vantagem: 'A visita toda semana vira rotina, porque o dono não perde a manhã.', condicao_de_falha: 'Sem banhista confiável no bairro, o horário atrasa e o cliente cancela.', base: ['f3'] },
        { nome: 'Assinatura mensal', como_funciona: 'O dono paga uma mensalidade fixa e recebe as visitas.', exemplo: 'Quatro banhos por mês pelo mesmo valor.', vantagem: 'A receita se repete, assim a empresa planeja a agenda dos banhistas.', condicao_de_falha: 'Se o cachorro não precisa de banho toda semana, a mensalidade parece cara.', base: ['f2', 'a1'] },
      ],
      limitacoes: ['Precisa de banhistas em cada bairro.', 'Deslocamento pesa no custo.'], aprendizado_leitor: 'A assinatura funciona quando o serviço vai até o cliente e vira rotina.', tese: 'A recorrência nasce da visita na porta.', pergunta_capa: 'Quem paga para o banho ir até a casa?',
    },
    ganchos: [
      { angulo: 'oportunidade', titulo: 'Um serviço cobra todo mês para levar o banho do cachorro até a casa.', scores: { clareza: 4, relevancia: 4, especificidade: 4, sustentacao: 4, entregabilidade: 4 } },
      { angulo: 'contradicao', titulo: 'O pet shop que mais atende não tem loja: o banhista vai até a porta.', scores: { clareza: 3, relevancia: 3, especificidade: 3, sustentacao: 3, entregabilidade: 3 } },
      { angulo: 'erro', titulo: 'O dono perde a manhã no pet shop, e alguém transformou isso em assinatura.', scores: { clareza: 3, relevancia: 4, especificidade: 3, sustentacao: 3, entregabilidade: 3 } },
    ],
    telas: [
      { funcao: 'gancho', tipo: 'FATO', base: ['f2', 'f3'], evidencias: [cMod].filter(Boolean), informacao_nova: 'o banho vai até o cliente e é cobrado por mês', relacao_anterior: '', titulo: 'Um serviço cobra por mês para dar banho no cachorro em casa.', corpo: `O ${nome} manda um banhista até a porta do cliente. O dono paga uma assinatura mensal e não precisa levar o cachorro a lugar nenhum.` },
      { funcao: 'problema', tipo: 'FATO', base: ['f3'], informacao_nova: 'o custo invisível é a manhã do dono', relacao_anterior: 'explica por que alguém pagaria', titulo: 'O problema não é o banho. É a manhã perdida.', corpo: 'Levar o cachorro ao pet shop toma o sábado: ir, esperar e voltar. A loja lotada também perde horários, porque não atende todo mundo.' },
      { funcao: 'mecanismo_1', tipo: 'ANALISE', base: ['f3'], informacao_nova: 'o deslocamento muda de lado', relacao_anterior: 'mostra a resposta ao problema', titulo: 'O banhista vai até a porta, então o dono não se desloca.', corpo: 'O cliente marca pelo aplicativo e o banhista chega com o equipamento. Assim a visita vira rotina, porque o dono não perde a manhã.' },
      { funcao: 'mecanismo_2', tipo: 'ANALISE', base: ['f2', 'a1'], informacao_nova: 'a mensalidade organiza a agenda', relacao_anterior: 'aprofunda como a receita se repete', titulo: 'A assinatura mensal deixa a agenda previsível.', corpo: 'Com mensalidade fixa, a empresa sabe quantas visitas terá. Quando o cachorro não precisa de banho toda semana, porém, a assinatura parece cara.' },
      { funcao: 'conta', tipo: 'FATO', base: ['f1'], evidencias: [cCli].filter(Boolean), informacao_nova: 'o tamanho declarado da base', relacao_anterior: 'mostra o alcance do mecanismo', titulo: 'A empresa diz que tem mais de 120 mil clientes.', corpo: 'Segundo a empresa, são mais de 120 mil clientes. O número mostra alcance, não quantos continuam pagando depois de alguns meses.' },
      { funcao: 'aplicacao', tipo: 'HIPOTESE', base: [], informacao_nova: 'um teste pequeno e barato', relacao_anterior: 'leva o aprendizado para o leitor', titulo: 'Um teste poderia começar em um condomínio.', corpo: 'Ofereça banho em casa para cinco moradores, com preço mensal, e veja quantos renovam. No Brasil seria uma hipótese para testar, com custo de deslocamento e de equipamento.' },
      { funcao: 'encerramento', tipo: 'MISTO', base: [], titulo: 'A recorrência nasce quando o serviço vai até o cliente.', apoio: 'Segue @pedro_destrava para ver a estratégia por trás de negócios que funcionam.' },
    ],
    legenda: { primeira_linha: 'O banho do cachorro foi até a casa do cliente, e virou assinatura.', historia: `O ${nome} manda o banhista até a porta e cobra por mês.`, como_ganha: 'Assinatura mensal, segundo a empresa.', brasil: 'Hipótese para testar: cinco clientes de um condomínio, antes de investir.' },
    hashtags: ['negocios', 'empreendedorismo'],
  };
}

module.exports = { rascunhoV1, imagemFake, NEG, PAGINAS, fakeFetcher, fakeLerFonte, fakePedirJson, rss, itensDoFeed };
