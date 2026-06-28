const express = require('express');
const { createCompatClient } = require('../lib/llm');
const crypto = require('crypto');

let _llm = null;
const getOpenAI = () => (_llm ??= createCompatClient());
const router = express.Router();

// ── Job store (in-memory, 30min TTL) ──────────────────────────────────────────
const JOBS = new Map();

function createJob(id) {
  const job = {
    id,
    status: 'processing',
    progress: '⏳ Preparando o júri...',
    round: 0,
    personasAnalyzed: 0,
    groupResults: [],
    results: null,
    error: null,
  };
  JOBS.set(id, job);
  setTimeout(() => JOBS.delete(id), 30 * 60 * 1000);
  return job;
}

// ── 100 Personas ──────────────────────────────────────────────────────────────

const GROUP_NAMES = {
  1: 'Curiosos Casuais',
  2: 'Empreendedores',
  3: 'Entusiastas Tech',
  4: 'Audiência 40+',
  5: 'Céticos e Críticos',
};

const PERSONAS = [
  // GRUPO 1 — Curiosos Casuais (30)
  { id:  1, g: 1, name: 'João',      age: 22, desc: 'Estudante universitário de TI, vicia em Reels no intervalo, atenção curtíssima, passa o dedo se não entender em 2 segundos.' },
  { id:  2, g: 1, name: 'Ana',       age: 19, desc: 'Influencer iniciante, exigente com qualidade visual e texto, compara tudo com os maiores criadores.' },
  { id:  3, g: 1, name: 'Lucas',     age: 25, desc: 'Entregador de app, assiste vídeos entre entregas, cansado, só para se algo for muito chocante.' },
  { id:  4, g: 1, name: 'Mariana',   age: 21, desc: 'Manicure, usa Instagram para relaxar no trabalho, quer entretenimento leve e fácil de entender.' },
  { id:  5, g: 1, name: 'Gabriel',   age: 28, desc: 'Designer freelancer, detecta conteúdo medíocre na hora, só engaja se a produção for boa.' },
  { id:  6, g: 1, name: 'Fernanda',  age: 24, desc: 'Professora de inglês, bilíngue, padrão alto, compara conteúdo BR com criadores gringos.' },
  { id:  7, g: 1, name: 'Caio',      age: 20, desc: 'Gamer, 18 horas por dia no celular, ironiza conteúdo repetitivo mas compartilha raridades genuínas.' },
  { id:  8, g: 1, name: 'Letícia',   age: 23, desc: 'Enfermeira em plantão noturno, precisa de conteúdo que mantenha acordada, muito direta.' },
  { id:  9, g: 1, name: 'Felipe',    age: 30, desc: 'Mecânico, sem paciência para texto longo, aprecia conteúdo direto ao ponto.' },
  { id: 10, g: 1, name: 'Bruna',     age: 26, desc: 'Recepcionista, faz scroll compulsivo no almoço, headline precisa ser irresistível para ela parar.' },
  { id: 11, g: 1, name: 'Diego',     age: 27, desc: 'Estudante de medicina, detecta imprecisão científica mas ama curiosidades reais e bem embasadas.' },
  { id: 12, g: 1, name: 'Camila',    age: 18, desc: 'Recém saída do ensino médio, usa gírias atuais, ama conteúdo que pode mostrar para os amigos.' },
  { id: 13, g: 1, name: 'Thiago',    age: 32, desc: 'Motorista de ônibus, vê vídeos à noite, cansado, precisa de algo que valha seu tempo.' },
  { id: 14, g: 1, name: 'Rebeca',    age: 22, desc: 'Estudante de jornalismo, critica clickbait ferozmente, valoriza informação de qualidade.' },
  { id: 15, g: 1, name: 'Henrique',  age: 29, desc: 'Barbeiro, sempre conectado, influenciado pelas tendências do feed, compartilha sem pensar muito.' },
  { id: 16, g: 1, name: 'Juliana',   age: 20, desc: 'Universitária de psicologia, analisa comportamento nos vídeos, engaja com conteúdo sobre mente humana.' },
  { id: 17, g: 1, name: 'Vitor',     age: 35, desc: 'Técnico de informática, quer aprender algo novo de verdade, ignora título enganoso.' },
  { id: 18, g: 1, name: 'Taís',      age: 23, desc: 'Atendente de caixa, conteúdo precisa ser fácil e consumível no intervalo de 5 minutos.' },
  { id: 19, g: 1, name: 'Bruno',     age: 31, desc: 'Corretor de imóveis, analisa engajamento dos posts com curiosidade profissional.' },
  { id: 20, g: 1, name: 'Natália',   age: 25, desc: 'Nutricionista, segue perfis de saúde e curiosidades, viraliza conteúdo que conecta com bem-estar.' },
  { id: 21, g: 1, name: 'Rafael',    age: 34, desc: 'Operador de telemarketing, entediado, usa Instagram em segundo plano o tempo todo.' },
  { id: 22, g: 1, name: 'Vanessa',   age: 19, desc: 'Influenciadora digital aspirante, analisa tudo com olhar de criadora de conteúdo.' },
  { id: 23, g: 1, name: 'André',     age: 33, desc: 'Padeiro, acorda às 4h, faz scroll rápido antes de dormir, conteúdo curto e impactante.' },
  { id: 24, g: 1, name: 'Priscila',  age: 28, desc: 'Educadora física, compartilha conteúdo motivacional e de curiosidades com seus alunos.' },
  { id: 25, g: 1, name: 'Leandro',   age: 21, desc: 'Vendedor de loja, gosta de fatos que pode usar em conversas para parecer esperto.' },
  { id: 26, g: 1, name: 'Samara',    age: 24, desc: 'Cabeleireira, fala muito com clientes, compartilha tudo que considera interessante.' },
  { id: 27, g: 1, name: 'Mateus',    age: 27, desc: 'Bombeiro, esporádico no Instagram, só para em conteúdo realmente surpreendente ou útil.' },
  { id: 28, g: 1, name: 'Cristiane', age: 30, desc: 'Auxiliar de enfermagem, exausta, precisa de conteúdo que alivie e informe ao mesmo tempo.' },
  { id: 29, g: 1, name: 'Rodrigo',   age: 26, desc: 'Estudante de administração, para em conteúdo que conecta com negócio e empreendedorismo.' },
  { id: 30, g: 1, name: 'Débora',    age: 22, desc: 'Fotógrafa freelancer, estética muito importante, descarta conteúdo visualmente medíocre.' },

  // GRUPO 2 — Empreendedores e Lojistas (25)
  { id: 31, g: 2, name: 'Ricardo',   age: 38, desc: 'Dono de loja de roupas, cético com promessas exageradas, valoriza dica prática e dados reais.' },
  { id: 32, g: 2, name: 'Patrícia',  age: 34, desc: 'Empresária do ramo alimentício, pragmática, quer dados reais e cases comprovados.' },
  { id: 33, g: 2, name: 'Marcos',    age: 42, desc: 'Franqueado de fast food, analítico, compara tudo com resultados do próprio negócio.' },
  { id: 34, g: 2, name: 'Juliana',   age: 31, desc: 'Dona de salão de beleza, avalia conteúdo com olho no potencial viral para seu negócio.' },
  { id: 35, g: 2, name: 'Eduardo',   age: 45, desc: 'Importador de eletrônicos, conectado com mercado chinês, ama novidades de tecnologia.' },
  { id: 36, g: 2, name: 'Amanda',    age: 29, desc: 'E-commerce de moda, estuda marketing digital, identifica tendências de conteúdo.' },
  { id: 37, g: 2, name: 'Carlos',    age: 40, desc: 'Distribuidor de bebidas, prático, gosta de curiosidades que pode contar na mesa de negócios.' },
  { id: 38, g: 2, name: 'Renata',    age: 36, desc: 'Consultora de RH, compartilha conteúdo profissional com equipe, exige qualidade.' },
  { id: 39, g: 2, name: 'Fábio',     age: 33, desc: 'Dono de agência de publicidade, nota imediatamente headline fraca ou genérica.' },
  { id: 40, g: 2, name: 'Luciana',   age: 37, desc: 'Dentista com clínica própria, usa redes para fidelizar pacientes, valoriza conteúdo educativo.' },
  { id: 41, g: 2, name: 'Sérgio',    age: 44, desc: 'Construtor civil, lida com tecnologia, interessa por inovações de materiais e processos.' },
  { id: 42, g: 2, name: 'Mônica',    age: 32, desc: 'Coach de negócios, especialista em marketing pessoal, critica conteúdo superficial.' },
  { id: 43, g: 2, name: 'Paulo',     age: 39, desc: 'Advogado com escritório próprio, racional, precisa de fontes confiáveis para compartilhar.' },
  { id: 44, g: 2, name: 'Elaine',    age: 35, desc: 'Gerente de marketing, avalia ROI de conteúdo, engaja com inovações que aplicaria em campanhas.' },
  { id: 45, g: 2, name: 'Gustavo',   age: 41, desc: 'Dono de oficina mecânica, aprecia conteúdo técnico acessível para atrair clientes.' },
  { id: 46, g: 2, name: 'Aline',     age: 28, desc: 'Empreendedora digital, vende cursos, estuda conteúdo viral para aprender estratégias.' },
  { id: 47, g: 2, name: 'Marcelo',   age: 43, desc: 'Dono de rede de farmácias, conservador, só compartilha conteúdo 100% verificado.' },
  { id: 48, g: 2, name: 'Fernanda',  age: 30, desc: 'Arquiteta autônoma, mistura arte e negócio, engaja com tecnologia, design e inovação.' },
  { id: 49, g: 2, name: 'Roberto',   age: 46, desc: 'Fazendeiro com agronegócio modernizado, interessa por tecnologia, compartilha no grupo familiar.' },
  { id: 50, g: 2, name: 'Simone',    age: 33, desc: 'Nutricionista online, avalia conteúdo pela credibilidade científica antes de repostar.' },
  { id: 51, g: 2, name: 'Alexandre', age: 38, desc: 'Gerente comercial, competitivo, ama fatos que pode usar para vender mais.' },
  { id: 52, g: 2, name: 'Cíntia',    age: 27, desc: 'Fotógrafa de casamentos, visual é tudo, conteúdo precisa ter estética além da informação.' },
  { id: 53, g: 2, name: 'Nelson',    age: 49, desc: 'Empresário veterano, difícil de impressionar, mas quando engaja, compartilha muito.' },
  { id: 54, g: 2, name: 'Tânia',     age: 36, desc: 'Pedagoga com escola particular, preocupada com qualidade da informação para usar com alunos.' },
  { id: 55, g: 2, name: 'Luiz',      age: 42, desc: 'Gerente de TI corporativa, só para em tecnologia muito relevante para o trabalho.' },

  // GRUPO 3 — Entusiastas de Tecnologia (20)
  { id: 56, g: 3, name: 'Arthur',    age: 23, desc: 'Dev front-end, segue tudo de tech, entedia fácil com óbvio, ama descobrir algo que ainda não sabe.' },
  { id: 57, g: 3, name: 'Isabella',  age: 27, desc: 'Engenheira de software, verifica fatos técnicos, corrige erros nos comentários.' },
  { id: 58, g: 3, name: 'Nicolas',   age: 25, desc: 'Estudante de ciência da computação, detecta simplificação exagerada de conceitos técnicos.' },
  { id: 59, g: 3, name: 'Laura',     age: 29, desc: 'Product manager em startup, ama inovação, compartilha com time quando o conteúdo é bom.' },
  { id: 60, g: 3, name: 'Pedro',     age: 22, desc: 'Streamer de tech, explica tecnologia de forma simples, exige a mesma qualidade dos outros.' },
  { id: 61, g: 3, name: 'Bianca',    age: 31, desc: 'Analista de dados, headline com dado específico a atrai mais do que qualquer promessa vaga.' },
  { id: 62, g: 3, name: 'Thales',    age: 26, desc: 'Pesquisador de IA, sabe muito, detecta erros técnicos e perde interesse imediatamente.' },
  { id: 63, g: 3, name: 'Carolina',  age: 24, desc: 'Engenheira elétrica, curiosa com aplicações práticas de tecnologia avançada.' },
  { id: 64, g: 3, name: 'Natan',     age: 28, desc: 'Fundador de startup fintech, interessa por tecnologia disruptiva e oportunidades de mercado.' },
  { id: 65, g: 3, name: 'Sofia',     age: 32, desc: 'UX designer, critica conteúdo confuso ou mal explicado, pensa no usuário final.' },
  { id: 66, g: 3, name: 'Diogo',     age: 35, desc: 'Hacker ético, vê mundo através de riscos e vulnerabilidades, gosta de revelações.' },
  { id: 67, g: 3, name: 'Karina',    age: 26, desc: 'Desenvolvedora mobile, consome tech content em inglês e português, padrão alto.' },
  { id: 68, g: 3, name: 'Erick',     age: 29, desc: 'Entusiasta de hardware, monta PCs, ama curiosidades sobre chips e processadores.' },
  { id: 69, g: 3, name: 'Melissa',   age: 23, desc: 'Estudante de engenharia de produção, otimização e eficiência são suas palavras-chave.' },
  { id: 70, g: 3, name: 'Vinícius',  age: 30, desc: 'Tech lead em grande empresa, compartilha conteúdo que educa o time.' },
  { id: 71, g: 3, name: 'Alice',     age: 27, desc: 'Cientista de dados, desconfia de afirmações absolutas, exige números e evidências.' },
  { id: 72, g: 3, name: 'Gustavo',   age: 34, desc: 'Arquiteto de soluções cloud, ama o que China e EUA fazem em infraestrutura.' },
  { id: 73, g: 3, name: 'Daniela',   age: 25, desc: 'Jornalista tech, verifica fontes profissionalmente, detecta fake news e imprecisões.' },
  { id: 74, g: 3, name: 'Bernardo',  age: 33, desc: 'CTO de startup, quer saber como a tecnologia resolve problemas reais.' },
  { id: 75, g: 3, name: 'Raquel',    age: 28, desc: 'Professora universitária de computação, rigorosa, mas compartilha quando é realmente bom.' },

  // GRUPO 4 — Audiência 40+ (15)
  { id: 76, g: 4, name: 'Maria',     age: 52, desc: 'Dona de casa, usa Instagram para se informar, não entende gírias, precisa de headline muito clara.' },
  { id: 77, g: 4, name: 'José',      age: 58, desc: 'Aposentado, tem tempo, compartilha tudo que acha interessante na família no WhatsApp.' },
  { id: 78, g: 4, name: 'Helena',    age: 45, desc: 'Professora do ensino fundamental, recomenda conteúdo educativo para os alunos.' },
  { id: 79, g: 4, name: 'Antonio',   age: 60, desc: 'Médico aposentado, rigoroso com informação científica, rejeita sensacionalismo.' },
  { id: 80, g: 4, name: 'Rosa',      age: 47, desc: 'Secretária executiva, gosta de conteúdo que pode usar para impressionar na conversa.' },
  { id: 81, g: 4, name: 'Geraldo',   age: 55, desc: 'Engenheiro civil aposentado, fascinado por tecnologia moderna, compara com como era antes.' },
  { id: 82, g: 4, name: 'Cleide',    age: 43, desc: 'Supervisora de loja, usa Instagram à noite, prefere vídeos curtos e bem explicados.' },
  { id: 83, g: 4, name: 'Raimundo',  age: 62, desc: 'Comerciante, novo no Instagram, precisa de tudo bem explicado, mas quando entende compartilha.' },
  { id: 84, g: 4, name: 'Sueli',     age: 49, desc: 'Gerente bancária, não repassa nada sem verificar se é verdade.' },
  { id: 85, g: 4, name: 'Oswaldo',   age: 57, desc: 'Ex-militar, aprecia fatos históricos e tecnologia de defesa e engenharia.' },
  { id: 86, g: 4, name: 'Lúcia',     age: 44, desc: 'Advogada, detecta imprecisões, compartilha com clientes quando o conteúdo é válido.' },
  { id: 87, g: 4, name: 'Edson',     age: 51, desc: 'Contador, gosta de curiosidades sobre finanças e economia global.' },
  { id: 88, g: 4, name: 'Vera',      age: 46, desc: 'Enfermeira-chefe, exausta, só para em conteúdo muito relevante ou de nostalgia.' },
  { id: 89, g: 4, name: 'Reinaldo',  age: 59, desc: 'Vendedor veterano, gosta de história e de como as coisas eram antes, nostalgia ressoa.' },
  { id: 90, g: 4, name: 'Neuza',     age: 48, desc: 'Professora de história, apaixonada, engaja profundamente com conteúdo histórico bem contado.' },

  // GRUPO 5 — Céticos e Críticos (10)
  { id: 91, g: 5, name: 'Rafa',      age: 31, desc: 'Jornalista investigativo, detecta clickbait em milissegundos, denuncia conteúdo enganoso.' },
  { id: 92, g: 5, name: 'Bia',       age: 27, desc: 'Filósofa, questiona todo argumento, exige evidências antes de acreditar em qualquer afirmação.' },
  { id: 93, g: 5, name: 'Renato',    age: 35, desc: 'Físico pesquisador, irritado com pseudociência, desiste se detectar imprecisão.' },
  { id: 94, g: 5, name: 'Isabela',   age: 29, desc: 'Advogada digital, suspeita de toda afirmação, pesquisa antes de compartilhar qualquer coisa.' },
  { id: 95, g: 5, name: 'Tiago',     age: 33, desc: 'Jornalista de tecnologia, compara com fontes primárias, critica superficialidade.' },
  { id: 96, g: 5, name: 'Clara',     age: 25, desc: 'Doutoranda em ciências sociais, analisa retórica e manipulação, imune a sensacionalismo.' },
  { id: 97, g: 5, name: 'Mauricio',  age: 40, desc: 'Professor universitário de filosofia, cobra rigor intelectual, mas elogia qualidade real.' },
  { id: 98, g: 5, name: 'Estela',    age: 36, desc: 'Pesquisadora de desinformação, radar apurado para fake news, compartilha só com fonte.' },
  { id: 99, g: 5, name: 'Flávio',    age: 28, desc: 'Cientista social, estuda viés cognitivo e manipulação de mídia, rejeita exagero.' },
  { id: 100,g: 5, name: 'Tereza',    age: 44, desc: 'Editora de revista científica, padrão editorial altíssimo, quando aprova é porque é excelente.' },
];

// ── GPT helpers ───────────────────────────────────────────────────────────────

async function analyzeReaction(persona, headline, ctx) {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é ${persona.name}, ${persona.age} anos. ${persona.desc} Está scrollando Instagram agora, cansado, com pressa.`,
        },
        {
          role: 'user',
          content: `Você viu esta headline: "${headline}"${ctx ? `\nContexto do vídeo: ${ctx}` : ''}

Reaja como ${persona.name} faria INTERNAMENTE em 1-2 frases curtas:
- O que pensou nos primeiros 2 segundos?
- Você parou? SIM ou NÃO?
- Motivo em uma frase.

Retorne apenas JSON: { "parou": boolean, "pensamento": "string curta", "motivo": "string curta" }`,
        },
      ],
      max_tokens: 120,
      response_format: { type: 'json_object' },
      temperature: 0.85,
    });
    const r = JSON.parse(res.choices[0].message.content || '{}');
    return { persona, parou: !!r.parou, pensamento: r.pensamento || '', motivo: r.motivo || '' };
  } catch {
    return { persona, parou: false, pensamento: '', motivo: 'erro' };
  }
}

async function analyzeDescription(persona, headline, description) {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é ${persona.name}, ${persona.age} anos. ${persona.desc} Você parou no Instagram por causa de uma headline e está lendo a descrição.`,
        },
        {
          role: 'user',
          content: `Headline: "${headline}"
Descrição: "${description}"

Retorne JSON:
{
  "cumpriu_promessa": boolean,
  "assistiria_completo": boolean,
  "compartilharia": "sim" | "nao" | "talvez",
  "confusoes": ["string"],
  "elogio": "string ou null"
}`,
        },
      ],
      max_tokens: 180,
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });
    const r = JSON.parse(res.choices[0].message.content || '{}');
    return { persona, ...r };
  } catch {
    return { persona, cumpriu_promessa: false, assistiria_completo: false, compartilharia: 'nao', confusoes: [], elogio: null };
  }
}

async function runGroupDebate(groupId, groupName, reactions, descAnalysis, headline, description) {
  const stoppedCount = reactions.filter(r => r.parou).length;
  const names = reactions.slice(0, 5).map(r => r.persona.name).join(', ');
  const reactionSummary = reactions.slice(0, 8)
    .map(r => `${r.persona.name}: ${r.parou ? '✅ parou' : '❌ passou'} — "${r.pensamento}"`)
    .join('\n');

  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você simula um grupo de brasileiros do Instagram chamado "${groupName}" debatendo um conteúdo. Simule conversa natural de grupo de WhatsApp.`,
        },
        {
          role: 'user',
          content: `Grupo: ${groupName} — participantes: ${names}

Headline: "${headline}"
Descrição: "${description}"

${stoppedCount}/${reactions.length} pararam o scroll.

Reações:
${reactionSummary}

Simulem 4-6 trocas de WhatsApp naturais. Depois cheguem a um consenso.

Retorne JSON:
{
  "debate": "Nome: mensagem\\nNome2: mensagem\\n...",
  "consenso": {
    "score_headline": number,
    "score_descricao": number,
    "problema_principal": "string ou null",
    "ponto_forte": "string",
    "veredicto": "APROVADO" | "REPROVAR" | "REVISAR"
  }
}`,
        },
      ],
      max_tokens: 650,
      response_format: { type: 'json_object' },
      temperature: 0.9,
    });
    const r = JSON.parse(res.choices[0].message.content || '{}');
    return { groupId, groupName, stoppedCount, totalCount: reactions.length, ...r };
  } catch (e) {
    console.warn(`[HeadlineJury] debate grupo ${groupId} falhou:`, e.message);
    return {
      groupId, groupName, stoppedCount, totalCount: reactions.length,
      debate: `${names.split(',')[0].trim()}: Não conseguimos debater esse conteúdo.`,
      consenso: { score_headline: 50, score_descricao: 50, problema_principal: null, ponto_forte: 'N/A', veredicto: 'REVISAR' },
    };
  }
}

async function runFinalVerdict(headline, description, reactions, descAnalysis, groupResults) {
  const totalParou     = reactions.filter(r => r.parou).length;
  const totalAssistiu  = descAnalysis.filter(d => d.assistiria_completo).length;
  const totalCompartilha = descAnalysis.filter(d => d.compartilharia === 'sim').length;
  const nDesc = descAnalysis.length || 1;

  const groupSummary = groupResults
    .map(g => `${g.groupName}: ${g.stoppedCount}/${g.totalCount} pararam | score=${g.consenso?.score_headline} | ${g.consenso?.veredicto}`)
    .join('\n');

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é o Juiz Chefe de um júri de 100 pessoas analisando conteúdo para Instagram do @pedro_destrava.
Perfil: 175k seguidores brasileiros, nicho de curiosidades de tecnologia, ciência, história e inovação. Tom: "o que ninguém te contou". Maior viral: 36k likes no vídeo do notebook dos anos 2000.`,
      },
      {
        role: 'user',
        content: `HEADLINE: "${headline}"
DESCRIÇÃO: "${description}"

RESULTADOS DO JÚRI:
- Pararam o scroll: ${totalParou}/100 (${totalParou}%)
- Assistiriam completo: ${totalAssistiu}/${nDesc} (${Math.round(totalAssistiu / nDesc * 100)}% de quem parou)
- Compartilhariam: ${totalCompartilha}/${nDesc} (${Math.round(totalCompartilha / nDesc * 100)}%)

DEBATES DOS GRUPOS:
${groupSummary}

Dê o VEREDITO FINAL. Retorne JSON:
{
  "aprovado": boolean,
  "score_geral": number,
  "score_headline": number,
  "score_descricao": number,
  "taxa_parada": number,
  "taxa_retencao": number,
  "taxa_compartilhamento": number,
  "pontos_fortes": ["string"],
  "pontos_fracos": ["string"],
  "headline_reescrita": "string",
  "headline_alternativas": ["string", "string", "string"],
  "descricao_reescrita": "string",
  "veredicto_texto": "string parágrafo especialista",
  "alerta_clickbait": boolean,
  "alerta_muito_complexo": boolean,
  "alerta_muito_generico": boolean
}`,
      },
    ],
    max_tokens: 1400,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(res.choices[0].message.content || '{}');
}

function selectVoices(reactions, descAnalysis) {
  const byId = {};
  for (const d of descAnalysis) byId[d.persona.id] = d;

  const enriched = reactions
    .filter(r => r.pensamento)
    .map(r => ({
      name: r.persona.name,
      age: r.persona.age,
      groupName: GROUP_NAMES[r.persona.g],
      parou: r.parou,
      pensamento: r.pensamento,
      motivo: r.motivo,
      compartilharia: byId[r.persona.id]?.compartilharia || null,
    }));

  const stopped    = enriched.filter(r => r.parou).slice(0, 4);
  const notStopped = enriched.filter(r => !r.parou).slice(0, 3);
  const skeptics   = enriched.filter(r => r.groupName === 'Céticos e Críticos').slice(0, 2);
  const over40     = enriched.filter(r => r.groupName === 'Audiência 40+').slice(0, 1);

  const all = [...stopped, ...notStopped, ...skeptics, ...over40];
  return [...new Map(all.map(v => [v.name, v])).values()].slice(0, 10);
}

// ── Main job processor ────────────────────────────────────────────────────────

async function processJob(job, { headline, description, context }) {
  try {
    const BATCH = 20;

    // ── RODADA 1: Reação instantânea ──────────────────────────────────────────
    job.round = 1;
    job.progress = '🧑‍🤝‍🧑 Rodada 1: 100 pessoas lendo a headline...';
    console.log('[HeadlineJury] Rodada 1 iniciada');

    const reactions = [];
    for (let i = 0; i < PERSONAS.length; i += BATCH) {
      const batch = PERSONAS.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(p => analyzeReaction(p, headline, context)));
      reactions.push(...results);
      job.personasAnalyzed = reactions.length;
      job.progress = `🧑‍🤝‍🧑 Rodada 1: ${reactions.length}/100 pessoas reagiram à headline...`;
    }

    const stoppedReactions = reactions.filter(r => r.parou);
    console.log(`[HeadlineJury] Rodada 1: ${stoppedReactions.length}/100 pararam`);

    // ── RODADA 2: Análise da descrição ────────────────────────────────────────
    job.round = 2;
    job.progress = `📖 Rodada 2: ${stoppedReactions.length} pessoas que pararam lendo a descrição...`;
    console.log('[HeadlineJury] Rodada 2 iniciada');

    const descAnalysis = [];
    if (stoppedReactions.length > 0) {
      for (let i = 0; i < stoppedReactions.length; i += BATCH) {
        const batch = stoppedReactions.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(r => analyzeDescription(r.persona, headline, description)));
        descAnalysis.push(...results);
        job.progress = `📖 Rodada 2: ${descAnalysis.length}/${stoppedReactions.length} analisaram a descrição...`;
      }
    }
    console.log(`[HeadlineJury] Rodada 2: ${descAnalysis.length} análises`);

    // ── RODADA 3: Debates por grupo ───────────────────────────────────────────
    job.round = 3;
    job.progress = '💬 Rodada 3: Grupos debatendo entre si...';
    console.log('[HeadlineJury] Rodada 3 iniciada');

    const groupResults = [];
    for (let g = 1; g <= 5; g++) {
      const gReactions   = reactions.filter(r => r.persona.g === g);
      const gDescAnalysis = descAnalysis.filter(d => d.persona.g === g);
      const result = await runGroupDebate(g, GROUP_NAMES[g], gReactions, gDescAnalysis, headline, description);
      groupResults.push(result);
      job.groupResults = [...groupResults];
      job.progress = `💬 Rodada 3: ${groupResults.length}/5 grupos debateram...`;
      console.log(`[HeadlineJury] Grupo ${g} (${GROUP_NAMES[g]}): ${result.consenso?.veredicto}`);
    }

    // ── RODADA 4: Veredito final ──────────────────────────────────────────────
    job.round = 4;
    job.progress = '⚖️ Rodada 4: Juiz calculando veredito final...';
    console.log('[HeadlineJury] Rodada 4 iniciada');

    const verdict = await runFinalVerdict(headline, description, reactions, descAnalysis, groupResults);
    const voices  = selectVoices(reactions, descAnalysis);

    job.progress = '✅ Análise concluída!';
    job.status = 'done';
    job.results = {
      verdict,
      groupResults,
      voices,
      rawStats: {
        totalPersonas: 100,
        stoppedCount: stoppedReactions.length,
        descAnalyzedCount: descAnalysis.length,
      },
    };
    console.log(`[HeadlineJury] Concluído. Score geral: ${verdict.score_geral}`);
  } catch (e) {
    console.error('[HeadlineJury] job error:', e.message);
    job.status = 'error';
    job.error = e.message;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/analyze', (req, res) => {
  const { headline, description, videoUrl, context } = req.body;
  if (!headline?.trim())    return res.status(400).json({ error: 'headline é obrigatória' });
  if (!description?.trim()) return res.status(400).json({ error: 'descrição é obrigatória' });
  if (!process.env.GROQ_API_KEY)
    return res.status(500).json({ error: 'GROQ_API_KEY não configurada' });

  const jobId = crypto.randomUUID();
  const job   = createJob(jobId);

  // Fire-and-forget: processes async in background while this request has already returned
  setImmediate(() => {
    processJob(job, {
      headline:    headline.trim(),
      description: description.trim(),
      context:     context?.trim() || '',
    }).catch(e => console.error('[HeadlineJury] unhandled:', e.message));
  });

  res.json({ jobId, status: 'processing' });
});

router.get('/status/:jobId', (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  res.json({
    status:           job.status,
    progress:         job.progress,
    round:            job.round,
    personasAnalyzed: job.personasAnalyzed,
    groupResults:     job.groupResults,
    results:          job.results,
    error:            job.error,
  });
});

module.exports = router;
// Exporta as 100 personas para reúso no pré-veto do cofre (Fase 3)
module.exports.PERSONAS = PERSONAS;
module.exports.GROUP_NAMES = GROUP_NAMES;
