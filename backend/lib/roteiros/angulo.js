// Motor 1 (ângulo) e Motor 2 (laboratório de ganchos) do Motor Magnético (docs/PROJETO_MOTOR_MAGNETICO.md).
// Uma chamada de IA gratuita, ANTES de escrever: decide o ângulo do roteiro (crença, virada, inimigo, emoção, nível de
// consciência, objeção) e devolve até 8 ganchos de tipos diferentes, já na ordem "o que deixa uma dúvida que só o
// vídeo responde". O código só ELIMINA o que viola regra objetiva; o roteirista escreve a partir do melhor que sobrar.
// Qualquer falha aqui não trava nada: sem ângulo utilizável o roteirista segue como antes.
const TIPOS = ['contraste', 'numero', 'erro', 'identidade', 'pergunta', 'cena', 'reenquadramento', 'confissao'];
const EMOCOES = ['indignacao', 'alivio', 'orgulho', 'medo_de_perder', 'curiosidade'];
const CONSCIENCIAS = ['nao_sabe_do_problema', 'sabe_do_problema', 'sabe_da_solucao'];
const ABERTURA = {
  nao_sabe_do_problema: 'abra por uma CENA ou pela CONSEQUÊNCIA (o dono ainda não sabe que tem problema)',
  sabe_do_problema: 'abra pelo ERRO que ele comete (ele já sabe que tem o problema)',
  sabe_da_solucao: 'abra pela DIFERENÇA entre as soluções que ele já conhece',
};
const MAX_PALAVRAS_GANCHO = 9;       // ~3 s falados
const JANELA_ANGULOS = 7;            // não repete inimigo + emoção nos últimos 7 roteiros
const MAX_INDIGNACAO_EM = 3;         // indignação em no máximo 1 de cada 3

const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const limpa = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => semAcento(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const radicais = (s) => new Set(chave(s).split(' ').filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));

function promptAngulo({ pauta, formato, formatoNome, estrutura, evitar = [] }) {
  return `Você é o ESTRATEGISTA DE ÂNGULO e o LABORATÓRIO DE GANCHOS dos Reels do @pedro_destrava (público: dono de pequena empresa, MEI, vendedor de marketplace no Brasil; voz: liberdade econômica, direto, firme, sem palanque).
Você NÃO escreve o roteiro. Decide o ângulo e escreve ganchos. FORMATO que será usado: ${formato} · ${formatoNome} (${estrutura}).
O ÂNGULO responde, em frases curtas e concretas:
- crenca: o que o público acredita hoje e está errado ou incompleto.
- virada: o que ele vai passar a acreditar (uma frase; é a promessa que o vídeo entrega).
- inimigo: uma IDEIA, regra ou hábito (nunca uma pessoa, partido ou empresa).
- em_jogo: o que está em jogo no bolso ou na rotina dele.
- emocao: uma de ${EMOCOES.join(', ')}.
- consciencia: uma de ${CONSCIENCIAS.join(', ')}.
- objecao: o que o dono pensa para resistir ("se eu não fizer X, perco Y"), nas palavras dele.
OS GANCHOS: até 8, de tipos DIFERENTES entre ${TIPOS.join(', ')}. Cada um é a primeira frase falada: no máximo ${MAX_PALAVRAS_GANCHO} palavras, assunto e promessa claros, entende-se sem som, anuncia a CONSEQUÊNCIA da virada sem explicar o mecanismo. Proibido: saudação, "hoje eu vou falar", "você sabia que", nome de político ou partido, emoji, hashtag.
Regras de fato: tipo "numero" e "confissao" SÓ se o fato está escrito na PAUTA; sem isso, não escreva esse tipo. Tipo "cena" sempre em "você", no presente ("o fornecedor liga às 7 da manhã e você já sabe o assunto"), nunca como caso real inventado.
Todos os ganchos prometem o MESMO payoff (a virada). Ordene do que mais deixa uma dúvida que só o vídeo responde para o que menos deixa.
Nível de consciência decide a abertura: ${CONSCIENCIAS.map((c) => `${c} → ${ABERTURA[c]}`).join('; ')}.
${evitar.length ? `NÃO repita estes ângulos recentes (inimigo + emoção): ${evitar.join('; ')}.\n` : ''}Responda APENAS JSON: {"crenca":"","virada":"","inimigo":"","em_jogo":"","emocao":"","consciencia":"","objecao":"","ganchos":[{"tipo":"","texto":""}]}`;
}

function normalizarAngulo(d) {
  const emocao = EMOCOES.includes(d?.emocao) ? d.emocao : null;
  const consciencia = CONSCIENCIAS.includes(d?.consciencia) ? d.consciencia : 'sabe_do_problema';
  const ganchos = (Array.isArray(d?.ganchos) ? d.ganchos : []).slice(0, 10)
    .map((g) => ({ tipo: TIPOS.includes(g?.tipo) ? g.tipo : null, texto: limpa(g?.texto, 160) })).filter((g) => g.texto);
  return {
    crenca: limpa(d?.crenca, 200), virada: limpa(d?.virada, 200), inimigo: limpa(d?.inimigo, 120), em_jogo: limpa(d?.em_jogo, 200),
    emocao, consciencia, objecao: limpa(d?.objecao, 200), ganchos,
  };
}

// Ângulo repetido: mesmo inimigo (por radicais) e mesma emoção entre os últimos roteiros; indignação demais.
function repetido(a, recentes = []) {
  const ult = recentes.slice(-JANELA_ANGULOS); const ra = radicais(a.inimigo);
  const igual = ult.some((x) => x.emocao === a.emocao && ra.size && [...radicais(x.inimigo)].some((r) => ra.has(r)));
  const indignados = ult.slice(-(MAX_INDIGNACAO_EM - 1)).filter((x) => x.emocao === 'indignacao').length;
  return igual || (a.emocao === 'indignacao' && indignados >= MAX_INDIGNACAO_EM - 1);
}
const resumoAngulo = (a) => `${a.inimigo} (${a.emocao || '?'})`;

// Só elimina. `regras` = { abertura, vicio, politico, numeros } do fiscal do código (passadas pelo index.js, uma fonte só).
function eliminarGanchos(ang, { pauta, regras }) {
  const permitidos = regras.numerosDe(pauta.texto);
  const baseViragem = radicais(ang.virada);
  const motivos = [];
  const bons = ang.ganchos.filter((g) => {
    const m = (x) => { motivos.push(`${x}: "${g.texto}"`); return false; };
    if (palavras(g.texto) > MAX_PALAVRAS_GANCHO) return m('mais de 9 palavras');
    if (regras.abertura.test(g.texto.trim())) return m('abertura proibida');
    if (regras.politico.test(g.texto)) return m('nome de político ou partido');
    if (regras.vicio(g.texto)) return m('vício de IA');
    if (/[\u{1F300}-\u{1FAFF}]|#\w/u.test(g.texto)) return m('emoji ou hashtag');
    const nums = (g.texto.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, ''));
    if (nums.some((k) => !permitidos.has(k) && !(Number(k) >= 1 && Number(k) <= 10 && k.length <= 2))) return m('número fora da pauta');
    if (g.tipo === 'confissao' && !/\b(eu|minha|meu)\b/i.test(g.texto)) return m('confissão sem primeira pessoa');
    // gancho e payoff falam da mesma coisa: ao menos um substantivo (radical de 5 letras) em comum com a virada
    if (baseViragem.size && ![...radicais(g.texto)].some((r) => baseViragem.has(r))) return m('sem ligação com a virada (promessa ≠ entrega)');
    return true;
  });
  return { bons, motivos };
}

// Ordem do modelo = ordem de preferência. O 1º que sobra é o gancho; os 2 seguintes ficam de reserva (troca opcional).
function montar(ang, { pauta, regras }) {
  const { bons, motivos } = eliminarGanchos(ang, { pauta, regras });
  if (!bons.length) return { ...ang, gancho: null, reservas: [], eliminados: motivos };
  return { ...ang, ganchos: bons, gancho: bons[0], reservas: bons.slice(1, 3), eliminados: motivos };
}

// Trecho que entra no prompt do roteirista.
function blocoParaRoteirista(a) {
  if (!a?.gancho) return '';
  return `ÂNGULO DESTE ROTEIRO (já decidido, siga):
- Crença do público: ${a.crenca}
- Virada (a promessa que o vídeo entrega no payoff): ${a.virada}
- Inimigo (uma ideia, nunca uma pessoa): ${a.inimigo}
- Em jogo no bolso ou na rotina: ${a.em_jogo}
- Emoção dominante: ${a.emocao}. Nível de consciência: ${a.consciencia} → ${ABERTURA[a.consciencia]}.
- Objeção do dono, que UMA fala antes do payoff diz com as palavras dele e responde: "${a.objecao}"
GANCHO ESCOLHIDO (use palavra por palavra como primeira frase): "${a.gancho.texto}"
REGRAS DESTE ROTEIRO: batidas gancho → aposta → virada → prova → objeção respondida → payoff → CTA. Frases de até 12 palavras. Prova sem número = UMA cena com objeto, momento e fala do cliente. Uma frase de print só, na virada, até 12 palavras, completa sozinha, sem começar por pronome. O payoff repete palavras do gancho (o vídeo emenda no começo); depois, CTA de até 6 palavras. A solução que você propõe não pode sofrer do defeito que o roteiro critica.`;
}

// Etiquetas que acompanham o vídeo (alimentam o aprendizado, Motor 6).
const etiquetas = (a) => (a?.gancho ? { tipo_gancho: a.gancho.tipo, emocao: a.emocao, inimigo: a.inimigo, consciencia: a.consciencia, reservas: (a.reservas || []).map((g) => g.texto) } : null);

module.exports = { TIPOS, EMOCOES, CONSCIENCIAS, MAX_PALAVRAS_GANCHO, JANELA_ANGULOS, promptAngulo, normalizarAngulo, repetido, resumoAngulo, eliminarGanchos, montar, blocoParaRoteirista, etiquetas, radicais };
