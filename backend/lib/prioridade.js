// Piloto por qualidade estratégica: a IA pode deixar reservas prontas, mas a fila de aprovação passa a ser ORDENADA pelo que o
// pedido define (audiência comprovada, oportunidade editorial, originalidade, série, posicionamento, funil), com o motivo de cada
// ponto. Também recomenda a frequência pela contagem real de publicações. Nada é publicado só porque está pronto: o Pedro aprova.
const C = require('./crescimento');

const PESOS = { audiencia_comprovada: 30, oportunidade: 20, original: 15, serie: 15, posicionamento: 10, funil: 10 };
const HIPOTESE_SEMANA = { reel: [4, 5], carrossel: [2, 3] };   // hipótese inicial do pedido: 4–5 Reels e 2–3 carrosséis por semana
const DIA = 86400000;

// conteudo: { id, titulo, origem, serie, objetivo, formato }. contexto: { achados (painel), sugestoes (audiência), pilares, objetivosRecentes }
function pontuar(conteudo, ctx = {}) {
  const tema = C.temaDe(conteudo.titulo || conteudo.texto || '');
  const motivos = []; let s = 0;
  const forte = (ctx.achados || []).find((a) => a.dimensao === 'tema' && a.id === tema.id && a.amostra === 'suficiente' && a.razao >= C.RAZAO_DESTAQUE);
  if (forte) { s += PESOS.audiencia_comprovada; motivos.push(`Tema com audiência comprovada: ${forte.nome} rende ${forte.razao}× a mediana (${forte.n} posts).`); }
  const op = (ctx.sugestoes || []).find((x) => x.tema_id === tema.id);
  if (op) { s += Math.round(PESOS.oportunidade * Math.min(1, op.score / 70)); motivos.push(`Oportunidade da audiência (score ${op.score}): ${op.evidencia}`); }
  const reciclado = /recicl|viral|clone/i.test(String(conteudo.origem || ''));
  if (!reciclado) { s += PESOS.original; motivos.push('Conteúdo original (não é reciclagem).'); }
  if (conteudo.serie) { s += PESOS.serie; motivos.push(`Faz parte da série ${conteudo.serie}.`); }
  if (tema.pilar && (ctx.pilares || []).some((p) => p.id === tema.pilar && p.pct > 0)) { s += PESOS.posicionamento; motivos.push('Fortalece um pilar do DNA Editorial.'); }
  const recentes = ctx.objetivosRecentes || [];
  if (conteudo.objetivo && recentes.length >= 4 && !recentes.slice(0, 5).includes(conteudo.objetivo)) { s += PESOS.funil; motivos.push(`Completa o funil: nenhum conteúdo de ${conteudo.objetivo} entre os últimos 5.`); }
  if (!motivos.length) motivos.push('Sem sinal estratégico medido: entra depois dos que têm.');
  return { score: s, motivos, tema: tema.nome || 'Outros' };
}

function ordenar(conteudos, ctx) {
  return conteudos.map((c) => ({ ...c, prioridade: pontuar(c, ctx) })).sort((a, b) => b.prioridade.score - a.prioridade.score);
}

// Frequência: contagem real das últimas 4 semanas por formato, contra a hipótese. Sem dado de resultado, não recomenda mais volume.
function frequencia(posts = [], { agora = Date.now() } = {}) {
  const ult = posts.filter((p) => agora - Date.parse(p.publicado_em) <= 28 * DIA);
  const porSemana = (tipos) => Math.round((ult.filter((p) => tipos.includes(p.tipo)).length / 4) * 10) / 10;
  const reels = porSemana(['reel', 'video']); const carrosseis = porSemana(['carrossel']);
  const leitura = (v, [a, b], nome) => (v < a ? `${nome}: ${v} por semana, abaixo da hipótese (${a}–${b}).` : v > b ? `${nome}: ${v} por semana, acima da hipótese (${a}–${b}); mais volume não é objetivo.` : `${nome}: ${v} por semana, dentro da hipótese (${a}–${b}).`);
  return {
    por_semana: { reels, carrosseis }, hipotese: HIPOTESE_SEMANA,
    leitura: [leitura(reels, HIPOTESE_SEMANA.reel, 'Reels'), leitura(carrosseis, HIPOTESE_SEMANA.carrossel, 'Carrosséis'), 'Stories: diários (hipótese); o app não mede Stories.'],
    nota: 'Hipótese inicial. A recomendação muda quando houver 8 semanas de dado mostrando relação entre volume e resultado por post.',
  };
}

module.exports = { PESOS, HIPOTESE_SEMANA, pontuar, ordenar, frequencia };
