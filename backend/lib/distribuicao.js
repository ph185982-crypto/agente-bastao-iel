// Distribution Intelligence: depois de publicar, o ciclo PUBLICAÇÃO → COMENTÁRIOS → STORIES → RESPOSTAS → NOVA PAUTA → NOVO CONTEÚDO.
// Pura e sem IA: compara o post com os outros na MESMA idade (série por post do placar), conta os comentários reais por tipo e
// sugere os próximos passos. Stories e reaproveitamento saem como texto pronto: o app não publica Stories.
const C = require('./crescimento');
const MI = require('./meuInstagram');

const arred = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const TEMA_NOME = Object.fromEntries(C.TEMAS.map((t) => [t.id, t.nome]));

// Alcance dos outros posts do mesmo formato quando tinham a mesma idade (ponto mais próximo da série, ±12 h).
function comparacaoNaIdade(post, series = []) {
  const idade = post.idade_h ?? Math.round((Date.now() - Date.parse(post.publicado_em)) / 3600000);
  const outros = series.filter((s) => String(s.id) !== String(post.id) && s.tipo === post.tipo).map((s) => {
    const p = (s.pontos || []).reduce((best, x) => (best == null || Math.abs(x.idade_h - idade) < Math.abs(best.idade_h - idade) ? x : best), null);
    return p && Math.abs(p.idade_h - idade) <= 12 ? p.alcance : null;
  }).filter((x) => x != null);
  const med = MI.mediana(outros);
  return { idade_h: idade, n: outros.length, mediana_outros: med, razao: med && post.alcance ? arred(post.alcance / med) : null };
}

function plano({ post, series = [], comentarios = [], seguidores = null } = {}) {
  if (!post) return null;
  const tema = C.temaDe(post.legenda); const comp = comparacaoNaIdade(post, series);
  const doPost = comentarios.filter((c) => String(c.media_id) === String(post.id) && c.classe !== 'spam');
  const por = {}; for (const c of doPost) por[c.classe] = (por[c.classe] || 0) + 1;
  const perguntas = doPost.filter((c) => ['pergunta', 'duvida'].includes(c.classe));
  const pendentes = doPost.filter((c) => c.estado === 'novo' && ['pergunta', 'duvida', 'critica', 'discordancia', 'interesse_comercial', 'sugestao'].includes(c.classe));
  const desempenho = comp.razao == null ? `Sem base de comparação: faltam outros ${post.tipo}s com série na mesma idade (${comp.n} encontrados).`
    : comp.razao >= 1.3 ? `Acima do normal: ${comp.razao}× o alcance mediano de ${comp.n} ${post.tipo}s na mesma idade (${comp.idade_h} h).`
      : comp.razao <= 0.77 ? `Abaixo do normal: ${comp.razao}× o alcance mediano de ${comp.n} ${post.tipo}s na mesma idade.`
        : `Dentro do normal (${comp.razao}× a mediana de ${comp.n} posts na mesma idade).`;
  const assunto = (post.legenda || '').split(/[.!?\n]/)[0].slice(0, 80);
  const stories = [
    { tipo: 'enquete', texto: `Enquete: "${assunto}" — você já sabia disso? Sim / Não`, quando: 'logo depois de publicar' },
    perguntas.length ? { tipo: 'resposta', texto: `Responder em Story a pergunta mais comum: "${perguntas[0].texto.slice(0, 100)}"`, quando: 'no dia seguinte' } : { tipo: 'caixinha', texto: `Caixinha: "O que você quer saber sobre ${TEMA_NOME[tema.id]?.toLowerCase() || 'isso'}?"`, quando: 'no dia seguinte' },
    { tipo: 'repost', texto: 'Repostar o post com um adesivo de link ou de "novo post" e uma frase de bastidor.', quando: 'até 24 h depois' },
  ];
  const reaproveitar = [];
  if (post.tipo === 'reel' || post.tipo === 'video') reaproveitar.push('Virar carrossel (botão "Virar carrossel" na aba Vídeos), se o roteiro foi feito aqui.');
  if (post.tipo === 'carrossel' || post.tipo === 'imagem') reaproveitar.push('Virar roteiro de Reel: mande a pauta para a Estratégia criativa.');
  if (comp.razao != null && comp.razao >= 1.3) reaproveitar.push('Desempenho acima do normal: vale uma continuação que se entenda sozinha (sem "parte 2" no gancho).');
  reaproveitar.push('LinkedIn: o carrossel aprovado também pode sair lá, se a conexão estiver ligada.');
  const pautas = perguntas.slice(0, 3).map((c) => ({ comentario_id: c.id, texto: c.texto.slice(0, 160) }));
  return {
    post: { id: post.id, tipo: post.tipo, permalink: post.permalink || null, legenda: post.legenda, publicado_em: post.publicado_em, alcance: post.alcance ?? null, tema: TEMA_NOME[tema.id] || 'Outros' },
    desempenho: { ...comp, leitura: desempenho },
    comentarios: { total: doPost.length, por_classe: por, pendentes: pendentes.length },
    proximos_passos: [
      pendentes.length ? `Responder ${pendentes.length} comentário(s) que pedem resposta (aba Comunidade).` : 'Nenhum comentário pendente de resposta.',
      perguntas.length ? `Transformar em pauta ${Math.min(3, perguntas.length)} pergunta(s) deste post.` : 'Sem perguntas novas neste post ainda.',
      'Publicar os Stories sugeridos abaixo.',
    ],
    stories, reaproveitar, pautas,
    colaboracao: 'Sem dado para sugerir colaboração: a ferramenta não lê quem interage a partir de outras contas.',
    ciclo: ['Publicação', 'Comentários', 'Stories', 'Respostas', 'Nova pauta', 'Novo conteúdo'],
    seguidores_da_conta: seguidores,
  };
}

module.exports = { plano, comparacaoNaIdade };
