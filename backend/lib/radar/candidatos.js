// De "itens de feed" a "candidatos a oportunidade": a IA LÊ os títulos e resumos e propõe quais negócios existem neles;
// o código valida cada campo, junta duplicados e barra o que já foi usado. A IA não inventa negócio: cada candidato
// precisa apontar para itens reais da coleta (e o link do site oficial só vale se aparece no material).
const llmJson = require('../llmJson');
const C = require('./config');
const U = require('./util');
const { dominioRegistravel } = require('../evidence');

const TAMANHO_LOTE = 70;

const SUFIXOS = /\b(inc|llc|ltd|gmbh|sa|s\.a|ag|co|corp|labs?|ai|app|hq|io|technologies|tecnologia|brasil|the)\b/g;
function chaveEmpresa(nome, urlOficial) {
  const base = U.norm(nome).replace(SUFIXOS, ' ').replace(/[^a-z0-9]+/g, '');
  const dom = urlOficial ? dominioRegistravel(urlOficial) : '';
  return { nome: base, dominio: dom && !C.DOMINIOS_AGREGADORES.test(dom) && !C.DOMINIOS_IMPRENSA.test(dom) ? dom : '' };
}
const mesmaEmpresa = (a, b) => !!(a.nome && b.nome && a.nome === b.nome) || !!(a.dominio && b.dominio && a.dominio === b.dominio);

const urlCanon = (u) => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();

function lotes(itens, tamanho = TAMANHO_LOTE) { const out = []; for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho)); return out; }

const PROMPT = `Você é a pesquisadora do perfil @pedro_destrava (empreendedorismo e negócios, público brasileiro: empresários e quem procura uma nova fonte de renda).
Abaixo há itens de feeds (título, resumo curto, fonte, pontos). Sua tarefa: identificar NEGÓCIOS, STARTUPS, SaaS, APLICATIVOS, PRODUTOS ou MODELOS COMERCIAIS concretos mencionados neles que possam virar um conteúdo simples e curioso para pessoas que querem empreender.

REGRAS:
- Só use o que está nos itens. NÃO invente nome, país, número, faturamento, usuários nem investimento. Se um dado não está no material, use null (ou "não informado").
- Um candidato = um negócio/produto real. Ignore notícias de política, esporte, celebridades, vagas, tutoriais e projetos pessoais sem modelo de negócio.
- "itens" lista os ids dos itens do material que falam desse negócio.
- "url_oficial" só se o endereço do site da própria empresa aparece no material (campo url do item quando a fonte é o próprio site, ou citado no resumo). Caso contrário null; se você souber o site pela sua memória, coloque em "site_provavel" (será conferido depois; pode ser null).
- "interesse" de 0 a 3: 3 = ideia fácil de explicar, com mecanismo de dinheiro visível e curiosa para um empreendedor brasileiro; 0 = pouco útil.
- "sinais_de_risco": use só estes códigos, quando o material indicar: piramide, aposta, renda_garantida, enriquecimento_rapido, ilegal, especulacao, patrocinado, franquia.
- Escreva em português simples (sem jargão, sem clichê de IA).
- Devolva no máximo 22 candidatos, os mais promissores. Se houver poucos, devolva menos.

Responda APENAS JSON:
{"candidatos":[{"nome":"","pais":"país de origem se estiver no material, senão \\"não informado\\"","categoria":"saas|startup|produto|servico|negocio_local|ecommerce","ia":false,"resumo":"1 frase: o que é","problema":"que dor resolve, em linguagem comum","solucao":"o que a empresa faz, em 1 frase","como_ganha_dinheiro":"como entra dinheiro, em 1 frase (ou \\"não informado\\")","modelo_receita":"assinatura|comissao|venda|licenca|mensalidade|publicidade|marketplace|servico_recorrente|null","prova_demanda_citada":"o que o material diz sobre demanda (sem inventar número), ou \\"não informado\\"","investimento_para_testar":{"nivel":"baixo|medio|alto","texto":"quanto custaria testar uma versão simples no Brasil, em termos gerais (sem inventar valores exatos)"},"adaptacao_brasil":"1 frase: hipótese de como a ideia poderia ser testada no Brasil","url_oficial":null,"site_provavel":null,"itens":["it_..."],"interesse":0,"sinais_de_risco":[]}]}`;

function normalizar(raw, porId) {
  const nome = U.limita(raw.nome, 60);
  if (nome.length < 2 || /^(show hn|launch hn|ask hn|startup|app|product)$/i.test(nome)) return null;
  const itensIds = [...new Set((Array.isArray(raw.itens) ? raw.itens : []).map(String).filter((id) => porId.has(id)))];
  if (!itensIds.length) return null;                                 // sem item real por trás, não existe
  const itens = itensIds.map((id) => porId.get(id));
  const textoMaterial = itens.map((i) => `${i.url} ${i.resumo} ${i.titulo}`).join(' ').toLowerCase();
  const hostDe = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const eUrl = (u) => (typeof u === 'string' && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(u.trim()) ? (/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`) : null);
  let oficial = eUrl(raw.url_oficial);
  if (oficial && !textoMaterial.includes(hostDe(oficial))) oficial = null;     // um link que não aparece no material não é "oficial confirmado"
  if (oficial && (C.DOMINIOS_AGREGADORES.test(hostDe(oficial)) || C.DOMINIOS_IMPRENSA.test(hostDe(oficial)))) oficial = null;
  // Fonte do item é o site do produto (ex.: Show HN aponta para o site): vira candidato a oficial, a ser confirmado pela página.
  const proprioSite = itens.find((i) => i.fonte_classe === 'comunidade' && i.url && !C.DOMINIOS_AGREGADORES.test(U.host(i.url)) && !C.DOMINIOS_IMPRENSA.test(U.host(i.url)));
  const siteProvavel = oficial ? null : (proprioSite?.url || eUrl(raw.site_provavel));
  const categoria = Object.keys(C.CATEGORIAS).includes(raw.categoria) ? raw.categoria : 'startup';
  const nivel = ['baixo', 'medio', 'alto'].includes(raw.investimento_para_testar?.nivel) ? raw.investimento_para_testar.nivel : 'medio';
  const modelo = Object.keys(C.MODELOS_RECEITA).includes(raw.modelo_receita) ? raw.modelo_receita : null;
  const sinais = (Array.isArray(raw.sinais_de_risco) ? raw.sinais_de_risco : []).filter((s) => s in C.SINAIS_DESCARTE);
  const chave = chaveEmpresa(nome, oficial || (proprioSite ? proprioSite.url : null));
  return {
    id: `op_${U.sha(chave.nome || chave.dominio || nome, 12)}`,
    nome, chave, categoria, ia: raw.ia === true,
    pais: U.limita(raw.pais, 40) || 'não informado',
    resumo: U.limita(raw.resumo, 220), problema: U.limita(raw.problema, 260), solucao: U.limita(raw.solucao, 260),
    como_ganha_dinheiro: U.limita(raw.como_ganha_dinheiro, 260), modelo_receita: modelo,
    prova_demanda_citada: U.limita(raw.prova_demanda_citada, 260),
    investimento_para_testar: { nivel, texto: U.limita(raw.investimento_para_testar?.texto, 220) },
    adaptacao_brasil: U.limita(raw.adaptacao_brasil, 260),
    url_oficial: oficial, url_sugerida: siteProvavel,
    itens_ids: itensIds,
    fontes_itens: itens.map((i) => ({ id: i.id, titulo: i.titulo, url: i.url, fonte_id: i.fonte_id, fonte_nome: i.fonte_nome, fonte_classe: i.fonte_classe, publicada_em: i.publicada_em, pontos: i.pontos, comentarios: i.comentarios, url_discussao: i.url_discussao, imagem_feed: i.imagem_feed || null, resumo: i.resumo })),
    interesse: Math.max(0, Math.min(3, Math.round(Number(raw.interesse) || 0))),
    sinais_de_risco: sinais,
  };
}

// Extrai candidatos de UM lote de itens (a etapa chama lote por lote para poder retomar de onde parou).
async function extrairLote(itens, { deps = {} } = {}) {
  const pedir = deps.pedirJson || llmJson.pedirJson;
  const material = itens.map((i) => ({ id: i.id, fonte: i.fonte_nome, titulo: i.titulo, resumo: i.resumo?.slice(0, 260) || '', url: i.url, pontos: i.pontos ?? undefined }));
  const d = llmJson.dado('ITENS_DOS_FEEDS', JSON.stringify(material), 36000);
  const { dados, llm } = await pedir({
    sistema: `${PROMPT}\n\n${llmJson.REGRAS_DADOS}`,
    usuario: d.bloco, maxTokens: 6000, temperatura: 0.2, budget: deps.budget,
  });
  const porId = new Map(itens.map((i) => [i.id, i]));
  const lista = (Array.isArray(dados?.candidatos) ? dados.candidatos : []).map((r) => { try { return normalizar(r, porId); } catch { return null; } }).filter(Boolean);
  return { candidatos: lista, llm, suspeita_de_instrucao: d.suspeita_de_instrucao };
}

// Junta o mesmo negócio citado em itens diferentes.
function juntar(lista) {
  const out = [];
  for (const c of lista) {
    const igual = out.find((o) => mesmaEmpresa(o.chave, c.chave));
    if (!igual) { out.push({ ...c }); continue; }
    igual.itens_ids = [...new Set([...igual.itens_ids, ...c.itens_ids])];
    const ids = new Set(igual.fontes_itens.map((f) => f.id));
    c.fontes_itens.forEach((f) => { if (!ids.has(f.id)) igual.fontes_itens.push(f); });
    igual.url_oficial = igual.url_oficial || c.url_oficial; igual.url_sugerida = igual.url_sugerida || c.url_sugerida;
    igual.interesse = Math.max(igual.interesse, c.interesse);
    igual.sinais_de_risco = [...new Set([...igual.sinais_de_risco, ...c.sinais_de_risco])];
    if (!igual.chave.dominio && c.chave.dominio) igual.chave = { ...igual.chave, dominio: c.chave.dominio };
  }
  return out;
}

// Barra o que já foi sugerido, usado ou descartado pelo Pedro. `existentes`: oportunidades guardadas (qualquer execução).
// Regras: decisão do Pedro e conteúdo já gerado valem `dias`; o que a própria ferramenta descartou por falta de prova volta depois de 14 dias.
function barrarRepetidos(candidatos, existentes, { dias = C.DIAS_SEM_REPETIR, agora = Date.now(), mesmoRunId = null } = {}) {
  const livres = []; const barrados = [];
  for (const c of candidatos) {
    const urls = new Set(c.fontes_itens.map((f) => urlCanon(f.url)));
    const achado = existentes.find((e) => {
      if (e.id === c.id && e.run_id === mesmoRunId) return false;                    // retomada da mesma execução
      const idade = (agora - Date.parse(e.encontrada_em || e._atualizado_em || 0)) / 86400000;
      const decisaoHumana = (e.decisoes || []).length > 0 || ['salva', 'usada', 'carrossel_gerado', 'pauta', 'aprovada', 'descartada_usuario'].includes(e.status);
      const janela = decisaoHumana || e.carrossel_id ? dias : (e.status === 'descartada' ? 14 : dias);
      if (idade > janela) return false;
      if (mesmaEmpresa(e.chave || {}, c.chave)) return true;
      return (e.fontes_itens || []).some((f) => urls.has(urlCanon(f.url)));
    });
    if (achado) barrados.push({ candidato: c, motivo: achado.carrossel_id || achado.status === 'usada' ? 'já utilizado em conteúdo' : achado.status === 'descartada_usuario' ? 'descartado por você antes' : 'já sugerido antes', existente_id: achado.id });
    else livres.push(c);
  }
  return { livres, barrados };
}

// Nota barata (só código) para escolher quem passa pela leitura das fontes.
function notaPrevia(c) {
  let n = c.interesse * 3;
  if (c.url_oficial) n += 3; else if (c.url_sugerida) n += 1.5;
  const classes = new Set(c.fontes_itens.map((f) => f.fonte_classe));
  if (classes.has('imprensa')) n += 2;
  if (c.fontes_itens.length >= 2) n += 1.5;
  if (c.fontes_itens.some((f) => (f.pontos || 0) >= 50)) n += 1;
  if (c.sinais_de_risco.length) n -= 6;
  if (c.investimento_para_testar.nivel === 'baixo') n += 1;
  return Math.round(n * 10) / 10;
}

module.exports = { extrairLote, normalizar, juntar, barrarRepetidos, notaPrevia, chaveEmpresa, mesmaEmpresa, lotes, TAMANHO_LOTE, urlCanon };
