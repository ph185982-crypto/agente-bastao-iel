// Sala de redação: 10 "mentes" de copywriters clássicos que escrevem os carrosséis do @pedro_destrava.
//
// O que é e o que não é:
//  - Cada mente é o MÉTODO documentado do copywriter (livros, anúncios e cartas conhecidos), destilado em princípios,
//    técnicas, fórmulas de título e o que ele proibiria. Os textos de exemplo são originais, escritos para o Pedro.
//  - Não copiamos os livros: a maior parte está sob direito autoral e não caberia no contexto das IAs gratuitas.
//    O que entra no prompt é o jeito de pensar de cada um, aplicado ao Instagram e ao público do Pedro.
//  - A mente não "vira" a pessoa nem assina nada: ela orienta a IA a escrever com aquele método.
//  - Quem decide qual mente funciona é o resultado real (alcance, envios), registrado por carrossel em c.top.mentes.

const MENTES = [
  {
    id: 'ogilvy', nome: 'David Ogilvy', escola: 'Ogilvy & Mather; "Confissões de um Publicitário", "Ogilvy on Advertising"',
    essencia: 'O título faz 80% do trabalho. Fato específico vende; adjetivo não. O leitor não é idiota: é alguém que você respeita.',
    tecnicas: [
      'Título com a informação mais interessante e concreta da pauta, como uma notícia que importa para o leitor.',
      'Um detalhe surpreendente e verdadeiro vale mais que dez adjetivos (o relógio do Rolls-Royce).',
      'Promessa de benefício ou de perda clara para o leitor, dita sem exagero.',
      'Escrever como quem conversa com uma pessoa inteligente; frases curtas, palavras simples.',
    ],
    capa: 'Fato específico e surpreendente + consequência para o leitor. Ex.: "De cada R$ 3 que você fatura, R$ 1 já é do governo."',
    proibido: 'Adjetivo vazio, trocadilho, título que exige o resto do texto para fazer sentido.',
  },
  {
    id: 'hopkins', nome: 'Claude Hopkins', escola: '"Scientific Advertising" (1923), "My Life in Advertising"',
    essencia: 'Publicidade é vendedor por escrito. Ser específico gera crença; generalidade escorre. Toda afirmação precisa de um porquê. Teste tudo.',
    tecnicas: [
      'Números exatos (27,5%, não "quase 30%") — o exato soa medido; o redondo soa inventado.',
      '"Reason why": diga POR QUE algo acontece, o mecanismo por trás.',
      'Conte o processo que ninguém conta (o que acontece nos bastidores).',
      'Cada peça é um teste: uma ideia por carrossel, medível.',
    ],
    capa: 'Número exato dos fatos + o mecanismo escondido. Ex.: "27,5% em cima de 27,5%: a cascata que aparece na sua nota."',
    proibido: 'Superlativo sem prova ("o maior", "absurdo"), afirmação sem porquê.',
  },
  {
    id: 'caples', nome: 'John Caples', escola: '"Tested Advertising Methods"; "Riram quando sentei ao piano…"',
    essencia: 'Título que funciona junta interesse próprio, novidade e curiosidade — nessa ordem de força. Só o teste diz qual é o melhor.',
    tecnicas: [
      'Interesse próprio primeiro: o que o leitor ganha ou perde.',
      'Novidade: "novo", "agora", "a partir de" — quando os fatos sustentam.',
      'Curiosidade que só o carrossel responde, sem esconder do que se trata.',
      'Fórmulas testadas: "Como…", "Por que…", "O que ninguém te contou sobre…", história de virada (riram de mim quando…).',
    ],
    capa: 'Bolso + novidade + curiosidade. Ex.: "A partir de janeiro, vender R$ 10 mil vai te custar mais. Eu fiz a conta."',
    proibido: 'Curiosidade sem benefício (enigma), título esperto que não diz para quem é.',
  },
  {
    id: 'collier', nome: 'Robert Collier', escola: '"The Robert Collier Letter Book"',
    essencia: 'Entre na conversa que já está acontecendo na cabeça do leitor. Comece pelo que ele já pensa, sente e fala.',
    tecnicas: [
      'Abrir com a frase que o empreendedor já disse em voz alta este mês.',
      'Descrever a situação dele melhor do que ele mesmo descreveria — aí ele confia no resto.',
      'Ligar a notícia a um desejo ou medo que ele já tem (caixa, sócio, cliente, imposto, tempo).',
    ],
    capa: 'A frase que ele já pensa. Ex.: "Vendeu mais e sobrou menos? Não é impressão sua."',
    proibido: 'Começar pelo órgão, pelo político ou pela notícia em vez da vida do leitor.',
  },
  {
    id: 'schwartz', nome: 'Eugene Schwartz', escola: '"Breakthrough Advertising" (1966)',
    essencia: 'Não se cria desejo: canaliza-se um desejo que já existe. O texto muda conforme o quanto o leitor já sabe (consciência) e quanto o mercado já ouviu promessas (sofisticação).',
    tecnicas: [
      'Diagnosticar a consciência: o público do Pedro, em geral, NÃO sabe que o problema existe → abra pela dor ou pela identificação, não pela solução nem pela notícia.',
      'Mercado sofisticado (já ouviu "imposto é alto" mil vezes) → traga o MECANISMO novo ou a cena concreta, não a promessa de sempre.',
      'Intensificar: tornar a dor visível, com detalhe e consequência, até ficar impossível ignorar.',
    ],
    capa: 'Desejo/medo que já existe + mecanismo novo, ou identificação pura em mercado saturado. Ex.: "Imposto sobre imposto: a linha da sua nota que ninguém te explicou."',
    proibido: 'Prometer o que o leitor já ouviu cem vezes; começar pela solução para quem nem sabe do problema.',
  },
  {
    id: 'halbert', nome: 'Gary Halbert', escola: '"The Boron Letters"; carta do brasão de família',
    essencia: 'O que mais importa é um público faminto pelo assunto. Escreva como uma carta pessoal, de uma pessoa para outra, simples, direta, com energia.',
    tecnicas: [
      'Segunda pessoa e tom de amigo que sabe de algo: "Olha, preciso te contar uma coisa."',
      'Frases curtas, parágrafos de uma linha, palavras de conversa.',
      'Fale com UMA pessoa específica (o dono de loja, o vendedor da Shopee), não com "os brasileiros".',
      'Ritmo que puxa: cada linha empurra a próxima.',
    ],
    capa: 'Bilhete pessoal e urgente. Ex.: "Se você tem CNPJ, para tudo e lê isso."',
    proibido: 'Tom institucional, "prezados", texto para todo mundo (que não fala com ninguém).',
  },
  {
    id: 'sugarman', nome: 'Joseph Sugarman', escola: '"The Adweek Copywriting Handbook"; anúncios dos óculos BluBlocker',
    essencia: 'A única função da primeira frase é fazer ler a segunda; a da segunda, fazer ler a terceira (o escorregador). Curiosidade é o motor.',
    tecnicas: [
      'Primeira frase curtíssima e fácil de ler.',
      'Cada slide termina abrindo uma pergunta que o próximo responde (loop aberto).',
      'Gatilhos de curiosidade e de consistência: comece com algo com que o leitor concorda.',
      'Contar como história: "Ontem eu vi uma coisa…"',
    ],
    capa: 'Frase curta que abre um loop. Ex.: "Tem um imposto que você paga e nunca viu no boleto."',
    proibido: 'Entregar tudo na capa; slide que termina fechado (sem motivo para deslizar).',
  },
  {
    id: 'bencivenga', nome: 'Gary Bencivenga', escola: '"Bencivenga Bullets"; considerado o redator mais crível da resposta direta',
    essencia: 'Prova vence promessa. Se o leitor não acredita, nada mais importa. A melhor copy é a mais crível, não a mais barulhenta.',
    tecnicas: [
      'Trazer a prova para frente: número, fonte, documento, comparação antes/depois.',
      'Bullets de curiosidade com especificidade ("o item da nota fiscal que…").',
      'Admitir o limite do que se sabe aumenta a credibilidade do resto.',
      'Transformar uma afirmação forte em algo verificável.',
    ],
    capa: 'Prova na capa. Ex.: "Está no Diário Oficial: a taxa subiu de 8% para 12%."',
    proibido: 'Exagero, hipérbole, afirmação que o leitor não consegue checar.',
  },
  {
    id: 'kennedy', nome: 'Dan Kennedy', escola: '"The Ultimate Sales Letter"; série "No B.S."',
    essencia: 'Problema, agitação, solução. Fale da dor com honestidade brutal antes de oferecer saída. Sem frescura.',
    tecnicas: [
      'Problema: nomeie a dor concreta do leitor.',
      'Agitação: mostre o custo de continuar assim (dinheiro, tempo, risco) — sem inventar.',
      'Solução/ação: o que fazer agora, simples.',
      'Linguagem crua, direta, sem jargão.',
    ],
    capa: 'Dor nomeada sem rodeio. Ex.: "Seu preço está errado e quem paga é o seu lucro."',
    proibido: 'Rodeio, linguagem corporativa, falar da solução antes da dor.',
  },
  {
    id: 'bernbach', nome: 'Bill Bernbach', escola: 'DDB; "Think Small" (Fusca), "Avis — somos o nº 2"',
    essencia: 'Honestidade e simplicidade surpreendem. Uma verdade admitida desarma o leitor; uma ideia original se destaca no meio do barulho.',
    tecnicas: [
      'Admitir algo inesperado que o próprio público reconhece ("A gente também achou que ia melhorar."), sem inventar história pessoal do Pedro.',
      'Inverter o óbvio: dizer o contrário do que todo mundo diz, com razão.',
      'Uma ideia só, executada com simplicidade e humanidade.',
    ],
    capa: 'Verdade inesperada e humana. Ex.: "A gente comemorou o dólar caindo. A maquininha não percebeu."',
    proibido: 'Fórmula batida, grito, imitação do que todo mundo posta, confissão pessoal inventada.',
  },
];

// Pares para escrever as 2 versões do roteiro: métodos que se complementam no formato de carrossel.
const AI = require('./antiIA');
const PARES = [['sugarman', 'kennedy'], ['halbert', 'caples'], ['schwartz', 'bencivenga'], ['collier', 'ogilvy'], ['bernbach', 'hopkins']];
const porId = new Map(MENTES.map((m) => [m.id, m]));

function hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
// Rodízio estável pelo id do carrossel: ao longo dos dias, todas as duplas escrevem o mesmo número de vezes.
// Com placar real (peso por redator, backend/lib/placar.js): 80% das vezes a dupla sai pelo resultado medido dos dois, 20% por
// igual entre todas (quem tem pouco dado continua escrevendo). O sorteio é estável pelo id do carrossel.
function parPara(id, pesos = null) {
  if (pesos && Object.keys(pesos).length >= 2) {
    const media = Object.values(pesos).reduce((s, x) => s + x, 0) / Object.keys(pesos).length;
    const w = PARES.map(([a, b]) => (pesos[a] ?? media) + (pesos[b] ?? media)); const soma = w.reduce((s, x) => s + x, 0);
    const p = w.map((x) => 0.8 * (x / soma) + 0.2 / PARES.length);
    const u = (hash(`${id}:par`) % 10000) / 10000; let acc = 0;
    for (let i = 0; i < PARES.length; i++) { acc += p[i]; if (u < acc) return PARES[i].map((x) => porId.get(x)); }
  }
  return PARES[hash(id) % PARES.length].map((x) => porId.get(x));
}

// Bloco completo de uma mente para o prompt do roteiro.
function paraRoteiro(m) {
  if (!m) return '';
  return `MENTE DO REDATOR DESTA VERSÃO: ${m.nome} (${m.escola}).
Escreva com o MÉTODO dele, adaptado ao Instagram e ao empreendedor brasileiro (sem copiar frases dele):
- Essência: ${m.essencia}
${m.tecnicas.map((t) => `- ${t}`).join('\n')}
- Capa no estilo dele: ${m.capa}
- Ele nunca faria: ${m.proibido}
As regras de fatos, números e honestidade abaixo continuam valendo acima do método.`;
}

// Versão curta de todas as mentes para a sala de capas (uma chamada só).
function paraCapas() {
  return MENTES.map((m) => `${m.id} — ${m.nome}: ${m.essencia} Capa: ${m.capa} Nunca: ${m.proibido}`).join('\n');
}

const SALA_CAPAS = `Você é a sala de redação do @pedro_destrava. Dez redatores, cada um com o MÉTODO de um copywriter clássico, escrevem a CAPA (primeiro slide) de um carrossel de Instagram para empreendedores brasileiros.
A capa decide tudo: é o que faz o dedo parar no feed de quem NÃO segue o Pedro.
OS REDATORES (método de cada um):
${paraCapas()}

REGRAS QUE VALEM PARA TODOS:
- Cada redator escreve 1 capa com o próprio método, diferente das outras.
- É a HEADLINE da capa (letra grande, em cima de uma foto): até 12 palavras, de preferência 6 a 10. Português falado, sem jornalês. Fale com "você" quando couber.
- Número só se estiver nos FATOS VERIFICADOS, escrito igual. Nada de data solta, nada de aspas inventadas.
- Ator certo (quem faz o quê). Sem clickbait mentiroso: a capa precisa ser verdade segundo os fatos.
- Não comece pelo nome de órgão ou político; comece pela vida/bolso do leitor ou por uma frase que pare o dedo.
- Marque com **asteriscos** UMA expressão de destaque.

${AI.GANCHOS}

${AI.REGRAS}
Responda APENAS JSON: {"capas":[{"mente":"ogilvy","texto":""}]}`;

// Placar real: engajamento (curtidas + 4 × comentários) dos posts publicados, agrupado pela mente que escreveu a capa
// e pela que escreveu o roteiro. Com poucos posts, é só indício: mostramos n e mediana, sem declarar vencedor.
async function placar({ grafo, armazem, conta } = {}) {
  const a = armazem(); if (!a?.duravel) return { n: 0, motivo: 'Sem banco de dados.' };
  const lista = await a.conteudos.listar(conta); const posts = [];
  for (const x of lista.slice(0, 150)) {
    if (x.resumo?.status !== 'publicado') continue;
    const c = (await a.conteudos.obter(conta, x.id))?.doc; const id = c?.publicacao?.ig_post_id; const m = c?.top?.mentes;
    if (!m || !id) continue;
    try { const r = await grafo('GET', id, { fields: 'like_count,comments_count,timestamp' }); if (Date.now() - Date.parse(r.timestamp) < 24 * 3600000) continue; posts.push({ titulo: c.titulo, capa: String(m.capa || '').replace(/ \(roteiro\)$/, '') || null, roteiro: m.roteiro || null, eng: (r.like_count || 0) + 4 * (r.comments_count || 0) }); } catch { /* post apagado ou sem permissão */ }
  }
  const med = (xs) => { const s = [...xs].sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const agrupa = (campo) => MENTES.map((m) => { const ps = posts.filter((p) => p[campo] === m.id); return { id: m.id, nome: m.nome, n: ps.length, mediana: med(ps.map((p) => p.eng)) }; }).filter((x) => x.n).sort((p, q) => q.mediana - p.mediana);
  return { n: posts.length, por_capa: agrupa('capa'), por_roteiro: agrupa('roteiro'), leitura: posts.length < 15 ? `Ainda poucos posts com mente registrada (${posts.length}); com menos de 3 posts por mente, a diferença pode ser sorte.` : 'Compare as medianas; uma mente só merece mais espaço se ganhar com 3 ou mais posts.' };
}

module.exports = { AI, MENTES, PARES, porId, parPara, paraRoteiro, paraCapas, SALA_CAPAS, placar };
