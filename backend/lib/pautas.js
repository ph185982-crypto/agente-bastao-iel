// Triagem de pautas: a IA só dá NÍVEIS de 0 a 3 por critério (com a definição escrita abaixo);
// quem combina, pesa, penaliza e descarta é o código, e todo descarte tem motivo visível.
//
// "prioridade" serve para ORDENAR a lista do dia. Não prevê alcance nem envio: os pesos são uma
// hipótese e só valem depois de comparados com resultados reais (aba Resultados).
const T = require('./temas');

const PESOS = { enviabilidade: 30, numero: 20, aderencia: 20, ponte: 15, frescor: 10 };
const SOMA_PESOS = Object.values(PESOS).reduce((a, b) => a + b, 0);
const PENALIDADES = { partidario: 30, direito_autoral: 15, sem_fonte: 20 };
const MECANISMOS = ['antes_depois', 'numero_chocante', 'contraintuitivo', 'pergunta_dor'];

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nivel = (x) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0; };
const temDigitos = (s) => /\d/.test(String(s || ''));
// Termos eleitorais inequívocos; o resto da política partidária a IA sinaliza em `partidario`.
const ELEITORAL = /\b(eleic\w*|eleitor\w*|candidat\w*|urna\w*|segundo turno|primeiro turno|tse|pesquisa eleitoral|horario eleitoral|comicio\w*)\b/;

function frescor(publicadaEm, agora) {
  const h = (agora - Date.parse(publicadaEm)) / 3600000;
  if (!Number.isFinite(h)) return 0;
  return h <= 24 ? 3 : h <= 48 ? 2 : h <= 96 ? 1 : 0;
}

// Texto dos critérios para o prompt (a definição de cada nível fica num lugar só).
const INSTRUCOES_CRITERIOS = `Para cada notícia dê NÍVEIS de 0 a 3 (0 = não, 3 = muito) — não dê pontuação nem nota:
- enviabilidade: a ideia cabe em uma frase e alguém mandaria por DM a outra pessoa na mesma situação (salário, aluguel, imposto, empresa pequena, loja online);
- numero: a notícia traz um número concreto ou um antes/depois que dê para mostrar (use só o que está no título/resumo);
- aderencia: tem a ver com o dia a dia de um homem de 25 a 44 anos que trabalha, empreende ou vende pela internet (dinheiro, imposto, preço, trabalho);
- ponte_lojista: dá para mostrar o mesmo assunto do ponto de vista de quem vende (preço, margem, taxa, dependência de plataforma);
- mecanismo: "antes_depois", "numero_chocante", "contraintuitivo" ou "pergunta_dor" (o que melhor descreve como o assunto prende);
- por_que_enviaria: 1 frase dizendo quem mandaria para quem e por quê (sem inventar fato);
- angulo_consumidor: o gancho para quem consome; angulo_lojista: o espelho para quem vende (vazio se ponte_lojista for 0);
- partidario: true SÓ se o ângulo toma lado em disputa de partido, campanha ou eleição; medida econômica explicada sem tomar lado é false;
- direito_autoral: true se o conteúdo depende de reproduzir foto, vídeo ou texto de terceiros.`;

// pautas: [{ id, titulo, resumo, fontes, publicada_em }]; anotacoes: Map(id → avaliação da IA) ou null (sem IA).
function triar(pautas, anotacoes, { estrategia, log = [], agora = Date.now() } = {}) {
  const est = { modo_politico: 'neutral', temas_bloqueados: [], dias_sem_repetir: T.DIAS_PADRAO, ...(estrategia || {}) };
  const aceitas = []; const descartadas = [];
  const descartar = (p, motivo, detalhe) => descartadas.push({ id: p.id, titulo: p.titulo, motivo, detalhe });

  for (const p of pautas) {
    const texto = `${p.titulo || ''} ${p.resumo || ''}`;
    const norm = semAcento(texto);
    const bloqueado = (est.temas_bloqueados || []).find((b) => b && norm.includes(semAcento(b)));
    if (bloqueado) { descartar(p, 'tema_bloqueado', `Tema bloqueado por você: “${bloqueado}”.`); continue; }
    if (est.modo_politico === 'neutral' && ELEITORAL.test(norm)) { descartar(p, 'partidario', 'Assunto eleitoral ou partidário (modo neutro).'); continue; }
    const usado = T.repetido(`${p.titulo || ''}`, log, { dias: est.dias_sem_repetir, agora });
    if (usado) { descartar(p, 'tema_usado', `Mesmo assunto já usado há ${usado.ha_dias} dia(s): “${usado.tema.slice(0, 80)}”.`); continue; }

    if (!anotacoes) { aceitas.push({ ...p, prioridade: null, criterios: null }); continue; }   // sem IA: lista como veio
    const a = anotacoes.get(p.id);
    if (!a) { descartar(p, 'sem_avaliacao', 'A IA não avaliou esta notícia.'); continue; }
    if (est.modo_politico === 'neutral' && a.partidario === true) { descartar(p, 'partidario', 'O ângulo toma lado em disputa partidária ou eleitoral (modo neutro).'); continue; }
    const crit = { enviabilidade: nivel(a.enviabilidade), numero: nivel(a.numero), aderencia: nivel(a.aderencia), ponte: nivel(a.ponte_lojista), frescor: frescor(p.publicada_em, agora) };
    if (!temDigitos(texto)) crit.numero = Math.min(crit.numero, 1);   // a IA não cria número que a notícia não tem
    if (crit.aderencia === 0 || a.ligacao_com_perfil === 'fraca') { descartar(p, 'fora_do_publico', 'Pouca relação com dinheiro, imposto, preço ou trabalho de quem te segue.'); continue; }
    if (crit.numero === 0 && !temDigitos(texto)) { descartar(p, 'sem_numero', 'Sem número nem comparação concreta para mostrar.'); continue; }

    const pen = [];
    if (a.partidario === true) pen.push({ tipo: 'partidario', pontos: PENALIDADES.partidario });
    if (a.direito_autoral === true) pen.push({ tipo: 'direito_autoral', pontos: PENALIDADES.direito_autoral });
    if (!(p.fontes || []).length) pen.push({ tipo: 'sem_fonte', pontos: PENALIDADES.sem_fonte });
    const base = (PESOS.enviabilidade * crit.enviabilidade + PESOS.numero * crit.numero + PESOS.aderencia * crit.aderencia + PESOS.ponte * crit.ponte + PESOS.frescor * crit.frescor) / 3;
    const prioridade = Math.max(0, Math.min(100, Math.round((base / SOMA_PESOS) * 100) - pen.reduce((s, x) => s + x.pontos, 0)));
    aceitas.push({
      ...p, prioridade, criterios: crit,
      mecanismo: MECANISMOS.includes(a.mecanismo) ? a.mecanismo : null,
      por_que_enviaria: String(a.por_que_enviaria || '').slice(0, 220),
      angulo_consumidor: String(a.angulo_consumidor || '').slice(0, 220),
      angulo_lojista: crit.ponte >= 1 ? String(a.angulo_lojista || '').slice(0, 220) : '',
      penalidades: pen,
    });
  }
  aceitas.sort((x, y) => (y.prioridade ?? -1) - (x.prioridade ?? -1) || Date.parse(y.publicada_em) - Date.parse(x.publicada_em));
  return { pautas: aceitas, descartadas, aviso_prioridade: 'Prioridade estimada só para ordenar a lista. Não prevê alcance nem envio.' };
}

module.exports = { triar, frescor, nivel, INSTRUCOES_CRITERIOS, PESOS, PENALIDADES, MECANISMOS, SOMA_PESOS };
