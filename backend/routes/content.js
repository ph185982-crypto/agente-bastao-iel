// Mesa de trabalho: descoberta de pautas, leitura de fonte, afirmações,
// pesquisa, briefing, copy e arte. Cada rota é uma etapa curta (cabe nos 60 s
// da Vercel) e sem estado: o navegador guarda o trabalho e manda o que a
// etapa precisa. Nada aqui publica no Instagram.
const express = require('express');
const crypto = require('crypto');
const { limita, unica } = require('../lib/access');
const feeds = require('../lib/feeds');
const { pedirJson, dado, REGRAS_DADOS, hasLlmKey } = require('../lib/llmJson');
const Editorial = require('../../static/editorial');

const router = express.Router();
const porMinuto = (max, nome) => limita({ max, janelaMs: 60000, nome });

const erroJson = (res, e, status) => {
  const code = e.code || (e.isUrlError ? 'URL' : 'ERRO');
  const http = status || (e.isUrlError ? 400 : e.code === 'SEM_IA' ? 503 : e.code === 'LIMITE' ? 429 : 500);
  res.status(http).json({ error: e.message, code });
};

// ── A. Encontre uma pauta ───────────────────────────────────────────────────
// Notícias recentes dos feeds dos próprios veículos, agrupadas por
// acontecimento. A IA só ESCREVE a justificativa; os links, datas e veículos
// vêm do feed e não passam por ela.
router.post('/discover', porMinuto(6, 'descoberta'), async (req, res) => {
  try {
    const pilares = (Array.isArray(req.body?.pilares) && req.body.pilares.length ? req.body.pilares : Editorial.PILARES_PADRAO)
      .slice(0, 8).map((p) => ({ id: String(p.id || p.nome).slice(0, 40), nome: String(p.nome || '').slice(0, 80), palavras: (p.palavras || []).map(String).slice(0, 30) }));
    const dias = Math.min(7, Math.max(1, Number(req.body?.dias) || 3));
    const recentes = (req.body?.recentes || []).map((r) => String(r).slice(0, 140)).slice(0, 10);

    const lidos = await feeds.lerTodos();
    const candidatos = [];
    const vistos = new Set();
    for (const p of pilares) {
      const achados = feeds.filtrar(lidos.itens, { palavras: p.palavras, dias, minimo: 2 });
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
    if (lista.length && hasLlmKey()) {
      try {
        const entrada = dado('NOTICIAS', JSON.stringify(lista.map((p) => ({ i: p.i, pilar: p.pilar, titulo: p.titulo, resumo: p.resumo, veiculos: p.veiculos }))), 14000);
        const rec = dado('POSTS_RECENTES_DO_PERFIL', recentes.join('\n'), 2000);
        const { dados, llm } = await pedirJson({
          temperatura: 0.4,
          maxTokens: 3500,
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
Não dê pontuação. Se a ligação for fraca ou a notícia não render post, omita o item.

${entrada.bloco}
${rec.bloco}

Responda APENAS JSON: {"itens":[{"i":0,"ligacao_com_perfil":"forte","por_que_interessa":"","angulo":"","objetivo_sugerido":"","formato_sugerido":"","risco":"","limitacoes":"","repete_recente":false}]}`,
        });
        const porI = new Map((dados.itens || []).filter((x) => Number.isInteger(x.i)).map((x) => [x.i, x]));
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

    res.json({
      gerado_em: new Date().toISOString(),
      janela_dias: dias,
      pautas: lista.filter((p) => !(ia.usada && (p.sem_anotacao || p.ligacao === 'fraca'))).map(({ i, ...p }) => p),
      ia,
      feeds: lidos.status,
      aviso: 'Notícias dos feeds dos próprios veículos, dos últimos dias. Não é uma busca completa nem um ranking de tendências.',
    });
  } catch (e) {
    erroJson(res, e);
  }
});

module.exports = router;
module.exports._util = { erroJson, porMinuto, unica };
