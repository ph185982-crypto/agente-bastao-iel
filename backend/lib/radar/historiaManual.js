// "Nova história": o Pedro (ou quem pesquisa por ele) indica o negócio, as páginas e as afirmações com o trecho que as comprova.
// Entra pelo MESMO caminho que a pesquisa automática: o servidor lê as páginas, confere que o trecho existe palavra por palavra no
// texto lido, que o número está no trecho e que investimento não virou faturamento; depois decide quais afirmações podem ir para uma
// tela (fonte oficial, plataforma ou duas fontes independentes). Quem escreve o trecho não consegue "declarar" que uma fonte é
// oficial ou independente: a classe vem do endereço da página.
const Ev = require('../evidence');
const V = require('./verificacao');
const Cand = require('./candidatos');
const store = require('./store');
const C = require('./config');
const U = require('./util');

const CATEGORIAS = Object.keys(C.CATEGORIAS);
const url = (x) => { try { const u = new URL(String(x)); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; } };

async function criar(entrada, { deps = {}, agora = Date.now() } = {}) {
  const nome = U.limita(entrada?.nome, 80); if (nome.length < 2) throw U.erro('Informe o nome da empresa ou do produto.', 'ENTRADA');
  const site = entrada.site_oficial ? url(entrada.site_oficial) : null; if (entrada.site_oficial && !site) throw U.erro('O site oficial não parece um endereço válido.', 'ENTRADA');
  const paginas = [...new Set((Array.isArray(entrada.fontes) ? entrada.fontes : []).map((f) => url(typeof f === 'string' ? f : f?.url)).filter(Boolean))].slice(0, 8);
  const afirmacoes = (Array.isArray(entrada.afirmacoes) ? entrada.afirmacoes : []).slice(0, 20);
  if (!paginas.length) throw U.erro('Indique ao menos uma página para ler (site oficial ou matéria).', 'ENTRADA');
  if (!afirmacoes.length) throw U.erro('Indique as afirmações com o trecho que as comprova.', 'ENTRADA');
  const chave = Cand.chaveEmpresa(nome, site);
  const cand = { id: `op_${U.sha(chave.nome || chave.dominio || nome, 12)}`, nome, chave, fontes_itens: [] };
  const ler = deps.lerFonte || ((u) => require('../research').lerFonte({ url: u }));
  const docs = []; const limitacoes = [];
  const lidos = await U.emParalelo(paginas, 4, async (u) => { try { const f = await U.comTimeout(ler(u), 20000, 'a leitura da página'); return { u, f }; } catch (e) { return { u, erro: e.message }; } });
  for (const { u, f, erro } of lidos) {
    if (erro) { limitacoes.push(`Fonte inacessível: ${U.host(u)} (${U.limita(erro, 80)}).`); continue; }
    if (!f.legivel) { limitacoes.push(`Fonte não legível: ${U.host(u)} (${f.acesso === 'negado' ? 'o site recusa leitura automática' : f.acesso === 'erro' ? 'a página não respondeu' : 'sem texto lido'}). Dados dela não podem ser usados.`); continue; }
    const classe = V.classeDoc(f.url_final || u, cand);
    if (classe === 'oficial' && !V.nomeNoTexto(nome, `${f.titulo} ${String(f.texto).slice(0, 8000)}`)) { limitacoes.push(`A página ${U.host(u)} não menciona “${nome}”: não foi aceita como site oficial.`); continue; }
    if (classe !== 'oficial' && !V.nomeNoTexto(nome, `${f.titulo} ${f.texto}`)) { limitacoes.push(`A página ${U.host(u)} não menciona “${nome}” no texto lido.`); continue; }
    docs.push({ url: f.url_final || u, url_pedida: u, titulo: f.titulo || '', veiculo: f.veiculo || U.host(u), publicada_em: f.publicada_em || null, acessada_em: f.acessada_em || new Date(agora).toISOString(), texto: f.texto, papel: classe === 'oficial' ? 'oficial' : 'imprensa', classe, dominio: f.dominio || Ev.dominioRegistravel(u), suspeita_de_instrucao: !!f.suspeita_de_instrucao });
  }
  if (!docs.length) throw U.erro(`Nenhuma página pôde ser lida. ${limitacoes.join(' ')}`, 'SEM_FONTE', 422, { erros: limitacoes });
  docs.forEach((d, i) => { d.indice = i; });
  // afirmações: "fonte" pode ser o endereço da página ou o índice na lista enviada
  const brutas = afirmacoes.map((a) => { const alvo = typeof a.fonte === 'number' ? paginas[a.fonte] : url(a.fonte); const d = docs.find((x) => x.url_pedida === alvo || x.url === alvo); return { ...a, documento: d ? d.indice : -1 }; });
  const conf = V.conferirAfirmacoes(brutas, docs, { agora });
  const claims = V.decidirUso(conf.aceitas, docs, nome);
  let verificacao = V.concluir({ cand, docs, claims, rejeitadas: conf.rejeitadas, limitacoes, agora });
  // História escolhida pelo Pedro: a regra "história antiga" é filtro da pesquisa diária, não vale aqui. Os outros sinais de risco valem.
  if (verificacao.descartar?.codigo === 'historia_antiga') {
    verificacao = { ...verificacao, descartar: null, motivos: verificacao.motivos.filter((m) => !/História antiga/.test(m)), estado: verificacao.existencia_confirmada ? 'verificada' : 'insuficiente', limitacoes: [...verificacao.limitacoes, `Idade: ${verificacao.idade.motivo}. Aceita porque a história foi escolhida por você, não encontrada pela pesquisa diária.`] };
  }
  const op = {
    id: cand.id, tipo: 'oportunidade', nome, chave, origem: 'manual', status: verificacao.estado === 'verificada' ? 'pauta' : 'pauta', encontrada_em: new Date(agora).toISOString(), run_id: null, decisoes: [{ em: new Date(agora).toISOString(), acao: 'historia_manual', por: 'pedro' }],
    pais: U.limita(entrada.pais || 'não informado', 40), categoria: CATEGORIAS.includes(entrada.categoria) ? entrada.categoria : 'startup', ia: entrada.ia === true,
    resumo: U.limita(entrada.resumo, 240), problema: U.limita(entrada.problema, 280), solucao: U.limita(entrada.solucao, 280), como_ganha_dinheiro: U.limita(entrada.como_ganha_dinheiro, 280),
    modelo_receita: C.MODELOS_RECEITA[entrada.modelo_receita] ? entrada.modelo_receita : null, adaptacao_brasil: U.limita(entrada.adaptacao_brasil, 280),
    investimento_para_testar: entrada.investimento_para_testar && typeof entrada.investimento_para_testar === 'object' ? { nivel: ['baixo', 'medio', 'alto'].includes(entrada.investimento_para_testar.nivel) ? entrada.investimento_para_testar.nivel : 'medio', texto: U.limita(entrada.investimento_para_testar.texto, 200) } : null,
    fontes_itens: [], pontuacao: null, verificacao,
  };
  const existente = await store.obter('oportunidade', op.id);
  if (existente) { op.carrosseis = existente.doc.carrosseis || []; op.carrossel_id = existente.doc.carrossel_id || null; (op.decisoes = [...(existente.doc.decisoes || []), ...op.decisoes]); }
  await store.salvar('oportunidade', op.id, op, existente ? existente.rev : 0);
  return op;
}

module.exports = { criar };
