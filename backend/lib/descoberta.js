// Busca de pautas: notícias recentes dos feeds dos próprios veículos, agrupadas por acontecimento e
// trianguladas (a IA dá níveis; o código pesa, penaliza e descarta com motivo). Usada pela tela
// "Encontre uma pauta" e pelo monitor de notícias em alta. Não publica nem cria conteúdo.
const crypto = require('crypto');
const feeds = require('./feeds');
const llmJson = require('./llmJson');
const { dado, REGRAS_DADOS, hasLlmKey } = llmJson;
const Editorial = require('../../static/editorial');
const Pautas = require('./pautas');
const Temas = require('./temas');
const Estrategia = require('./estrategia');

async function descobrir({ pilares: pilaresEntrada, dias: diasEntrada, recentes: recentesEntrada } = {}) {
  const pilares = (Array.isArray(pilaresEntrada) && pilaresEntrada.length ? pilaresEntrada : Editorial.PILARES_PADRAO)
    .slice(0, 8).map((p) => ({ id: String(p.id || p.nome).slice(0, 40), nome: String(p.nome || '').slice(0, 80), palavras: (p.palavras || []).map(String).slice(0, 30) }));
  const dias = Math.min(7, Math.max(1, Number(diasEntrada) || 3));
  const recentes = (recentesEntrada || []).map((r) => String(r).slice(0, 140)).slice(0, 10);

  const lidos = await feeds.lerTodos();
  const candidatos = [];
  const vistos = new Set();
  for (const p of pilares) {
    // Páginas de áudio/vídeo do Senado não têm texto para ler: ficam de fora.
    const achados = feeds.filtrar(lidos.itens, { palavras: p.palavras, dias, minimo: 2 }).filter((x) => !/^\s*(Áudio|Vídeo|Foto|Fotos)\s*:/i.test(x.titulo));
    for (const g of feeds.agruparEventos(achados.slice(0, 40)).slice(0, 3)) {
      if (vistos.has(g.principal.url)) continue;
      vistos.add(g.principal.url);
      candidatos.push({ pilar_id: p.id, pilar: p.nome, grupo: g });
    }
  }
  const lista = candidatos.slice(0, 14).map((c, i) => ({
    id: `p_${crypto.createHash('sha1').update(c.grupo.principal.url).digest('hex').slice(0, 8)}`,
    i, pilar_id: c.pilar_id, pilar: c.pilar,
    titulo: c.grupo.principal.titulo,
    resumo: c.grupo.principal.resumo,
    veiculos: c.grupo.veiculos,
    fontes: c.grupo.itens.slice(0, 4).map((x) => ({ titulo: x.titulo, url: x.url, origem: x.origem, publicada_em: x.publicada_em, tipo_fonte: x.tipo_fonte })),
    publicada_em: c.grupo.principal.publicada_em,
  }));

  let ia = { usada: false, erro: null };
  let porIFinal = new Map();
  if (lista.length && hasLlmKey()) {
    try {
      const entrada = dado('NOTICIAS', JSON.stringify(lista.map((p) => ({ i: p.i, pilar: p.pilar, titulo: p.titulo, resumo: p.resumo, veiculos: p.veiculos }))), 14000);
      const rec = dado('POSTS_RECENTES_DO_PERFIL', recentes.join('\n'), 2000);
      const { dados, llm } = await llmJson.pedirJson({
        temperatura: 0.4,
        maxTokens: 5000,
        sistema: `${Editorial.VOZ}\n\n${REGRAS_DADOS}`,
        usuario: `Abaixo, notícias recentes (só título, resumo e veículos). Para cada uma escreva, SEM afirmar nenhum fato que não esteja no título/resumo:
  - ligacao_com_perfil: "forte", "media" ou "fraca" (seja honesto: se a conexão com política, economia, empreendedorismo ou o bolso de quem lê é forçada, é "fraca");
  - por_que_interessa: 1 frase ligando o assunto ao perfil e à vida prática de quem lê, só com o que o título/resumo permite concluir (sem especular efeitos);
  - angulo: uma tese possível OU uma pergunta central, em 1 frase (se o assunto não sustenta posição, proponha explicar o que mudou);
  - objetivo_sugerido: "alcance", "autoridade" ou "conversao";
  - formato_sugerido: "carrossel", "estatico", "reels" ou "stories";
  - risco: "alto" se envolve acusação a pessoa, crime, saúde ou eleição; senão "baixo";
  - limitacoes: o que precisa ser confirmado antes de publicar;
  - repete_recente: true se o tema é o mesmo de algum post recente listado.
  ${Pautas.INSTRUCOES_CRITERIOS}
  Se a ligação for fraca ou a notícia não render post, ainda assim devolva o item (o sistema decide o que descartar e mostra o motivo).

  ${entrada.bloco}
  ${rec.bloco}

  Responda APENAS JSON: {"itens":[{"i":0,"ligacao_com_perfil":"forte","enviabilidade":0,"numero":0,"aderencia":0,"ponte_lojista":0,"mecanismo":"","por_que_enviaria":"","angulo_consumidor":"","angulo_lojista":"","partidario":false,"direito_autoral":false,"por_que_interessa":"","angulo":"","objetivo_sugerido":"","formato_sugerido":"","risco":"","limitacoes":"","repete_recente":false}]}`,
      });
      const porI = new Map((dados.itens || []).filter((x) => Number.isInteger(x.i)).map((x) => [x.i, x]));
      porIFinal = porI;
      lista.forEach((p) => {
        const a = porI.get(p.i);
        if (!a) { p.sem_anotacao = true; return; }
        p.ligacao = ['forte', 'media'].includes(a.ligacao_com_perfil) ? a.ligacao_com_perfil : 'fraca';
        p.por_que_interessa = String(a.por_que_interessa || '').slice(0, 280);
        p.angulo = String(a.angulo || '').slice(0, 280);
        p.objetivo_sugerido = Editorial.OBJETIVOS[a.objetivo_sugerido] ? a.objetivo_sugerido : null;
        p.formato_sugerido = Editorial.FORMATOS[a.formato_sugerido] ? a.formato_sugerido : null;
        p.risco = a.risco === 'alto' ? 'alto' : 'baixo';
        p.limitacoes = String(a.limitacoes || '').slice(0, 280);
        p.repete_recente = !!a.repete_recente;
      });
      ia = { usada: true, ...llm };
    } catch (e) {
      ia = { usada: false, erro: e.message };
    }
  }

  // A IA só dá níveis; o código combina, penaliza e descarta (com motivo visível).
  const anotacoes = ia.usada ? new Map(lista.filter((p) => !p.sem_anotacao).map((p) => [p.id, porIFinal.get(p.i)])) : null;
  const estrategia = await Estrategia.ler();
  const log = await Temas.ler().catch(() => []);
  const triagem = Pautas.triar(lista.map(({ i, ...p }) => p), anotacoes, { estrategia, log });

  return {
    gerado_em: new Date().toISOString(),
    janela_dias: dias,
    pautas: triagem.pautas,
    descartadas: triagem.descartadas,
    aviso_prioridade: triagem.aviso_prioridade,
    estrategia: { modo_politico: estrategia.modo_politico, dias_sem_repetir: estrategia.dias_sem_repetir, temas_bloqueados: estrategia.temas_bloqueados },
    ia,
    feeds: lidos.status,
    aviso: 'Notícias dos feeds dos próprios veículos, dos últimos dias. Não é uma busca completa nem um ranking de tendências.',
  };
}

module.exports = { descobrir };
