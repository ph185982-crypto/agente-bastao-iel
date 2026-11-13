// Skill de ROTEIRO DE VÍDEO CURTO do @pedro_destrava.
// Destilada de docs/referencias-roteiro/ESPECIALISTAS_VIDEO_CURTO.md (40 especialistas: Hormozi, MrBeast, Paddy Galloway,
// Jenny Hoyos, Kallaway, Brendan Kane, Jonah Berger, Chip e Dan Heath, Kindra Hall, Matthew Dicks, Rory Sutherland,
// Mosseri/Instagram, TikTok oficial e brasileiros). O documento tem as fontes; aqui fica só o que cabe num prompt.
// Itens marcados [PCM] no documento (5–7 s de reengajamento, palavras por duração) são prática de mercado: recalibrar
// com a retenção real do perfil quando houver dado.

const PALAVRAS_POR_S = 2.6; // ~155 palavras/min em PT-BR falado
const DURACAO = { min_s: 30, max_s: 75 };
const PALAVRAS = { min: Math.round(DURACAO.min_s * PALAVRAS_POR_S) - 5, max: Math.round(DURACAO.max_s * PALAVRAS_POR_S) + 10 };

// Os 12 formatos (seção 4 do documento). `tipos`: de que fonte de pauta cada um sai melhor.
const FORMATOS = {
  F1: { nome: 'Mito × verdade', tipos: ['tese', 'noticia'], cta: 'envio', estrutura: '0–3 s: o mito dito como se fosse verdade. 3–6 s: "Mas…". 6–35 s: a verdade com 1 exemplo concreto. 35–45 s: a consequência no bolso. Fim: CTA de envio.' },
  F2: { nome: 'A conta que ninguém faz', tipos: ['noticia', 'como_fazer'], cta: 'salvar', estrutura: '0–3 s: pergunta com valor em R$. 3–8 s: foreshadow ("o resultado assusta"). 8–45 s: a conta passo a passo, cada número na [TELA]. 45–55 s: o que isso significa. Fim: CTA de salvar. SÓ USE se a pauta trouxer os números; sem números, escolha outro formato.' },
  F3: { nome: '3 erros que custam caro', tipos: ['tese', 'como_fazer'], cta: 'salvar', estrutura: '0–3 s: número + perda. 3–6 s: "o terceiro é o mais comum" (loop). 6–50 s: erros 1, 2 e 3, um exemplo cada. Fim: CTA de salvar ou enviar.' },
  F4: { nome: 'Notícia traduzida pro bolso', tipos: ['noticia'], cta: 'comentar', estrutura: '0–3 s: "Mudou X". 3–10 s: quem é afetado (autosseleção). 10–40 s: o que muda na prática. 40–55 s: a opinião do Pedro (liberdade econômica). Fim: pergunta binária.' },
  F5: { nome: 'Eu fiz X e aconteceu Y', tipos: ['historia', 'caso'], cta: 'envio', estrutura: '0–3 s: o resultado surpreendente primeiro. 3–15 s: o que foi feito. 15–45 s: progressão com "mas… então…". 45–60 s: a lição. Fim: CTA. SÓ com fato real que está na pauta.' },
  F6: { nome: 'História de empreendedor', tipos: ['historia', 'caso'], cta: 'envio', estrutura: '0–3 s: o momento da virada (comece perto do fim). 3–15 s: como era antes. 15–40 s: a explosão (problema, multa, crise). 40–60 s: o novo normal e a lição. Fim: CTA de envio.' },
  F7: { nome: 'Brasil × lá fora', tipos: ['noticia', 'tese'], cta: 'comentar', estrutura: '0–3 s: o contraste em 1 frase. 3–30 s: os dois lados lado a lado. 30–50 s: o porquê, na leitura de liberdade econômica. Fim: pergunta. Número só se estiver na pauta.' },
  F8: { nome: 'Reenquadramento', tipos: ['tese'], cta: 'envio', estrutura: '0–3 s: um nome novo para uma coisa conhecida. 3–25 s: por que o nome novo é mais verdadeiro, com exemplos. 25–40 s: o que o empreendedor faz com isso. Fim: CTA de envio.' },
  F9: { nome: 'Pergunta do empreendedor', tipos: ['tese', 'caso', 'como_fazer'], cta: 'comentar', estrutura: '0–3 s: a dúvida que todo dono de negócio tem (não invente seguidor: "muita gente me pergunta" só se for genérico). 3–6 s: resposta curta logo de cara. 6–40 s: o porquê + exemplo. 40–50 s: exceção ou alerta. Fim: CTA.' },
  F10: { nome: 'Checklist rápido', tipos: ['como_fazer', 'tese'], cta: 'salvar', estrutura: '0–3 s: promessa de verificação ("confere essas 4 coisas"). 3–45 s: 4 ou 5 itens curtos, [TELA] em cada. Fim: CTA de salvar.' },
  F11: { nome: 'Letras miúdas', tipos: ['noticia'], cta: 'envio', estrutura: '0–3 s: "Li a regra inteira". 3–8 s: foreshadow ("tem uma linha que muda tudo"). 8–45 s: o trecho, o que significa, exemplo prático. 45–55 s: como se proteger. Fim: CTA de envio. SÓ se a pauta trouxer a regra.' },
  F12: { nome: 'Opinião forte com prova', tipos: ['tese', 'noticia'], cta: 'comentar', estrutura: '0–3 s: tese impopular. 3–8 s: "e eu vou te mostrar por quê" (loop). 8–50 s: 2 ou 3 provas concretas (cenas do dia a dia se não houver dado). 50–65 s: conclusão. Fim: pergunta binária.' },
};

const SKILL = `SKILL: ROTEIRO DE VÍDEO CURTO (Reels de 30 a 75 s) do @pedro_destrava
Público: dono de pequena empresa, MEI, quem vende em marketplace, autônomo no Brasil. Voz: Pedro Martins, direita assumida, liberdade econômica, fala direto, com convicção, sem palanque.

1. GANCHO (0–3 s; Kallaway, Hoyos, TikTok, Galloway): a PRIMEIRA FRASE JÁ É O ASSUNTO E A PROMESSA, até 15 palavras. Proibido "Oi, pessoal", "hoje eu vou falar", "você sabia que". Teste: serviria como título de vídeo longo? Entende-se sem som? Tipos: contraste ("todo mundo acha X. Mas…"), número específico (só da pauta), erro/alerta (aversão à perda), identidade ("se você é MEI…"), pergunta com lacuna, reenquadramento ("isso não tem nome de imposto, tem nome de sócio"), letras miúdas.
2. TRÊS CAMADAS DIZEM A MESMA COISA (Kallaway): o que ele fala, o texto na tela [TELA: 3 a 5 palavras] e o que se vê (objeto, gesto, cenário).
3. FORESHADOW (Hoyos): logo depois do gancho, 1 ou 2 frases que criam expectativa ("e o terceiro é o que mais custa"). No máximo 2 loops abertos, TODOS fechados antes do fim (loop sem pagamento quebra a confiança: MrBeast).
4. RITMO: uma ideia por frase, 6 a 14 palavras, nunca mais de 20. Algo novo a cada 5–7 s: um dado, um "mas", um exemplo, um [TELA] novo. Cadeia "mas / então" (Parker e Stone). Teste do "e daí?" (Hormozi): frase que dá para cortar sem perder nada, sai.
5. CONCRETO VENCE ABSTRATO (Heath): cena do dia a dia (maquininha, boleto, nota fiscal, fornecedor ligando, funcionário, taxa do marketplace), nome da regra, valor em R$: mas NÚMERO SÓ SE ESTIVER NA PAUTA. Sem número na pauta, use cena e opinião assumida ("na minha leitura"). Número inventado é reprovação automática.
6. PAYOFF (Hormozi, Hoyos): a recompensa responde EXATAMENTE à promessa do gancho e chega no fim. Escreva a última frase antes do resto. TERMINE LOGO DEPOIS DO PAYOFF: nada de "é isso, pessoal", recapitulação ou despedida.
7. UM CTA SÓ, até 1 frase (Mosseri: envio é o sinal mais forte para alcançar quem não segue): envio com destinatário ("manda pra quem é MEI e ainda não sabe disso"), salvar quando for lista ou conta, ou pergunta binária ("sim ou não?"). Proibido "curte e segue", "deixa sua opinião".
8. TOM FALADO (teleprompter): escreva como se fala, "você", "tá", "pra", frases curtas, nível fundamental. Se tropeça lendo em voz alta, reescreve.
9. POLÍTICA SEM PERDER ALCANCE: o Instagram não recomenda conteúdo político a quem não segue. Liberdade econômica entra pelo BOLSO do empreendedor (imposto, burocracia, taxa, prazo); sem nome de político, partido ou eleição no gancho e no [TELA]. Crítica firme, com fato, sem ataque pessoal.
10. DURAÇÃO é consequência: ideia simples 30–45 s (80–120 palavras); explicação ou história 50–75 s (130–195 palavras).

VÍCIOS DE IA PROIBIDOS: "vamos lá", "bora", "se liga", "você sabia que", "não é só X, é Y", "não se trata de", "mais do que", "no mundo de hoje", "cada vez mais", "vale lembrar", "é importante", "descubra", "o guia definitivo", "jornada", "alavancar", "e o melhor de tudo", "mas não para por aí", "em resumo", "spoiler", travessão, emoji, hashtag, tríade enfeitada, frase-lição genérica no fim, "estudos mostram" sem dizer quem, número redondo sem fonte.`;

// Checklist do documento (seção 3). ★ = eliminatório.
const CRITERIOS = [
  { n: 1, el: true, nome: 'Gancho: tema e promessa claros em até 3 s', fiscal: 'retencao' },
  { n: 2, el: true, nome: 'Gancho: tensão ou curiosidade (contraste, número, erro, lacuna)', fiscal: 'retencao' },
  { n: 3, el: false, nome: 'Três camadas alinhadas (fala, [TELA] de 3–5 palavras, visual)', fiscal: 'retencao' },
  { n: 4, el: true, nome: 'Promessa = entrega (o payoff responde ao gancho)', fiscal: 'retencao' },
  { n: 5, el: false, nome: 'Loop aberto logo após o gancho e fechado antes do fim', fiscal: 'retencao' },
  { n: 6, el: true, nome: 'Densidade: zero frase morta', fiscal: 'retencao' },
  { n: 7, el: false, nome: 'Ritmo: algo novo a cada 5–7 s, cadeia "mas/então"', fiscal: 'retencao' },
  { n: 8, el: true, nome: 'Prova e especificidade sem número inventado', fiscal: 'verdade' },
  { n: 9, el: false, nome: 'Relevância: o empreendedor vê o impacto no bolso ou na rotina', fiscal: 'verdade' },
  { n: 10, el: true, nome: 'Tom falado: lê fluido no teleprompter', fiscal: 'verdade' },
  { n: 11, el: false, nome: 'Duração coerente (30–75 s) e sem gordura', fiscal: 'retencao' },
  { n: 12, el: false, nome: 'Final: payoff e saída rápida', fiscal: 'retencao' },
  { n: 13, el: false, nome: 'CTA único que gera envio, salvamento ou comentário', fiscal: 'retencao' },
  { n: 14, el: false, nome: 'Posicionamento e reputação (firme, com fato, sem ataque pessoal nem partidarismo no gancho)', fiscal: 'verdade' },
  { n: 15, el: false, nome: 'Sem vícios de IA: soa como o Pedro falando', fiscal: 'verdade' },
];
const MEDIA_MIN = 7.5; const ELIMINATORIO_MIN = 7;

module.exports = { SKILL, FORMATOS, CRITERIOS, MEDIA_MIN, ELIMINATORIO_MIN, PALAVRAS_POR_S, DURACAO, PALAVRAS };
