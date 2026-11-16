// Plano padrão de 12 meses por tipo de cliente. Funções PURAS (sem banco, sem relógio): testáveis e determinísticas.
export type ClientKind = "marketplace" | "midia" | "ambos";
export type Owner = "avanteza" | "cliente";

export interface ActionTemplate {
  title: string;
  description: string;
  owner: Owner;
  /** Mês do plano (1–12) em que a ação deve estar pronta. */
  dueMonth: number;
}
export interface PhaseTemplate {
  position: number;
  name: string;
  description: string;
  startMonth: number;
  endMonth: number;
  actions: ActionTemplate[];
}

export const PHASES: Pick<PhaseTemplate, "position" | "name" | "description" | "startMonth" | "endMonth">[] = [
  { position: 1, name: "Diagnóstico e base", description: "Meses 1 e 2: entender o ponto de partida, liberar acessos e fixar metas.", startMonth: 1, endMonth: 2 },
  { position: 2, name: "Estruturação", description: "Meses 3 e 4: arrumar a casa e montar a estrutura que sustenta o crescimento.", startMonth: 3, endMonth: 4 },
  { position: 3, name: "Aceleração", description: "Meses 5 a 8: testar, otimizar e abrir novos canais com a base pronta.", startMonth: 5, endMonth: 8 },
  { position: 4, name: "Escala", description: "Meses 9 a 12: ampliar o que funciona e preparar o ano seguinte.", startMonth: 9, endMonth: 12 },
];

const a = (title: string, description: string, dueMonth: number, owner: Owner = "avanteza"): ActionTemplate => ({ title, description, owner, dueMonth });

const MARKETPLACE: ActionTemplate[][] = [
  [
    a("Reunião de kickoff e alinhamento de metas", "Apresentar o plano de 12 meses, combinar rotina de reuniões e as metas de faturamento e margem.", 1),
    a("Liberar acessos às contas dos marketplaces", "Autorizar a Avanteza nas contas do Mercado Livre e demais canais para leitura e gestão.", 1, "cliente"),
    a("Diagnóstico do catálogo", "Revisar títulos, fotos, atributos, variações e anúncios pausados ou sem estoque.", 1),
    a("Enviar custos e margens por produto", "Planilha com custo, impostos e margem mínima aceita por produto, base da política de preços.", 1, "cliente"),
    a("Diagnóstico de reputação e logística", "Avaliar reclamações, cancelamentos, atrasos e prazos de envio de cada conta.", 2),
    a("Definir metas e indicadores do plano", "Fixar metas de faturamento, margem, ROAS e reputação, e como serão acompanhadas.", 2),
  ],
  [
    a("Reestruturar o catálogo prioritário", "Reescrever títulos, descrições e atributos dos anúncios que mais vendem ou mais têm potencial.", 3),
    a("Aprovar kit de fotos e vídeos", "Validar o novo padrão de imagens dos produtos prioritários.", 3, "cliente"),
    a("Implantar a política de preços", "Regras de preço com margem mínima e limites de variação por dia.", 3),
    a("Estruturar campanhas de ADS", "Criar campanhas de Product Ads por curva ABC, com meta de ROAS por grupo de produtos.", 4),
    a("Plano de reputação", "Metas de tempo de resposta, reclamações e cancelamentos, com rotina de acompanhamento.", 4),
    a("Ajustar logística e prazos de envio", "Alinhar expedição, embalagem e prazos para melhorar entrega e reputação.", 4, "cliente"),
    a("Montar o calendário promocional", "Mapear datas, campanhas da plataforma e promoções próprias dos próximos meses.", 4),
  ],
  [
    a("Participar das promoções e campanhas da plataforma", "Inscrever os produtos certos nas campanhas, respeitando a margem mínima.", 5),
    a("Otimização semanal de ADS", "Cortar verba onde o ROAS está abaixo da meta e reforçar onde sobra espaço.", 6),
    a("Reposição de estoque dos campeões", "Garantir estoque dos produtos mais vendidos para não perder ranking.", 6, "cliente"),
    a("Expandir o catálogo", "Cadastrar novos produtos e variações, com fotos e custos aprovados.", 6, "cliente"),
    a("Abrir a loja na Shopee", "Cadastro da conta, integração e publicação dos primeiros anúncios.", 6),
    a("Reputação: busca pelo selo de melhor vendedor", "Plano de ação para subir de nível de reputação nas contas.", 7),
    a("Revisão trimestral de preços e margens", "Reavaliar preços, custos e promoções com os números dos últimos meses.", 8),
    a("Abrir a loja no TikTok Shop", "Cadastro, integração do catálogo e primeiras campanhas.", 8),
  ],
  [
    a("Escalar a verba de ADS", "Aumentar investimento onde o retorno comprovou a meta.", 9),
    a("Preparar as datas sazonais do ano", "Estoque, preço, anúncios e verba para os picos de venda.", 9, "cliente"),
    a("Ampliar linhas e novos produtos", "Lançar linhas novas com base no que mais vende nos canais.", 10, "cliente"),
    a("Automatizar rotinas de monitoramento", "Alertas de estoque, reputação, perguntas sem resposta e queda de vendas.", 10),
    a("Avaliar logística de maior escala", "Estudar fulfillment e outras opções para reduzir prazo e custo.", 11),
    a("Balanço de 12 meses e plano do próximo ano", "Resultados contra as metas e o desenho do segundo ano.", 12),
  ],
];

const MIDIA: ActionTemplate[][] = [
  [
    a("Reunião de kickoff e alinhamento de metas", "Apresentar o plano, combinar rotina de reuniões, orçamento mensal e metas de resultado.", 1),
    a("Liberar acessos às contas de anúncio e analytics", "Acesso a Meta (Instagram e Facebook), Google Ads, Google Analytics e gerenciador de tags.", 1, "cliente"),
    a("Auditoria de rastreamento", "Conferir pixels, API de conversões, GA4 e eventos de compra e lead.", 1),
    a("Auditoria das contas e do histórico", "Analisar estrutura atual, campanhas, públicos e resultados dos últimos meses.", 2),
    a("Definir KPIs e metas", "CPA, ROAS, custo por lead e faturamento atribuído, com o valor de cada conversão.", 2),
    a("Mapear público, oferta e concorrentes", "Entender quem compra, o que atrai e como o mercado anuncia.", 2),
  ],
  [
    a("Configurar contas e pixels", "Corrigir e padronizar pixels, conversões e integrações entre as plataformas.", 3),
    a("Reestruturar as contas de anúncio", "Nomenclatura, objetivos e orçamento organizados por etapa do funil.", 3),
    a("Estrutura de campanhas por funil", "Campanhas de topo, meio e fundo com públicos e verba definidos.", 3),
    a("Primeiro lote de criativos", "Briefing e produção da primeira bateria de anúncios; aprovação do cliente.", 4, "cliente"),
    a("Revisar páginas de destino e oferta", "Ajustar a página, a oferta e a chamada para ação junto ao cliente.", 4, "cliente"),
    a("Painel de acompanhamento", "Relatório com investimento, resultados e custo por conversão por canal.", 4),
  ],
  [
    a("Calendário de testes", "Testes de criativo, público e oferta, um por vez, com critério de decisão.", 5),
    a("Otimização semanal de verba", "Mover orçamento entre campanhas conforme custo por resultado.", 5),
    a("Funil de remarketing", "Remarketing e públicos semelhantes para quem já interagiu com a marca.", 6),
    a("Renovação mensal de criativos", "Novos anúncios todo mês; cliente envia material, depoimentos e novidades.", 6, "cliente"),
    a("Abrir novos canais", "Testar TikTok Ads, YouTube ou outro canal com verba controlada.", 7),
    a("Relatório de resultados do semestre", "Leitura de resultados, aprendizados e ajustes para a segunda metade.", 8),
  ],
  [
    a("Escalar verba nas campanhas vencedoras", "Aumentos graduais de orçamento sem perder o custo por resultado.", 9),
    a("Ampliar públicos e praças", "Novas regiões, interesses e públicos com base nos melhores resultados.", 10),
    a("Consolidar novos canais", "Manter os canais que bateram a meta e encerrar os demais.", 10),
    a("Automatizar regras e alertas", "Regras de pausa, aumento de verba e alertas de queda de desempenho.", 11),
    a("Balanço de 12 meses e plano do próximo ano", "Resultados contra as metas e o desenho do segundo ano.", 12),
  ],
];

const TRACK_PREFIX = { marketplace: "Marketplaces", midia: "Mídia" } as const;

export function planTemplate(kind: ClientKind): PhaseTemplate[] {
  return PHASES.map((p, i) => {
    let actions: ActionTemplate[];
    if (kind === "marketplace") actions = MARKETPLACE[i];
    else if (kind === "midia") actions = MIDIA[i];
    else {
      actions = [
        ...MARKETPLACE[i].map((x) => ({ ...x, title: `${TRACK_PREFIX.marketplace}: ${x.title}` })),
        ...MIDIA[i].map((x) => ({ ...x, title: `${TRACK_PREFIX.midia}: ${x.title}` })),
      ].sort((x, y) => x.dueMonth - y.dueMonth);
    }
    return { ...p, actions: actions.map((x) => ({ ...x })) };
  });
}

// ── datas (UTC, sem fuso: o plano trabalha com dias de calendário) ──
export function isDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma meses preservando o dia; dia que não existe no mês de destino vira o último dia (31/jan + 1 mês = 28 ou 29/fev). */
export function addMonthsStr(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, last))).toISOString().slice(0, 10);
}
export function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface GeneratedAction extends ActionTemplate {
  dueDate: string;
  position: number;
}
export interface GeneratedPhase extends Omit<PhaseTemplate, "actions"> {
  startsOn: string;
  endsOn: string;
  actions: GeneratedAction[];
}

/** Plano completo a partir da data de início: fase N começa no início do mês `startMonth` e termina no último dia de `endMonth`. */
export function generatePlan(kind: ClientKind, startDate: string): GeneratedPhase[] {
  if (!isDateStr(startDate)) throw new Error("Data de início inválida (use AAAA-MM-DD).");
  if (!["marketplace", "midia", "ambos"].includes(kind)) throw new Error("Tipo de cliente inválido.");
  return planTemplate(kind).map((p) => ({
    ...p,
    startsOn: addMonthsStr(startDate, p.startMonth - 1),
    endsOn: addDaysStr(addMonthsStr(startDate, p.endMonth), -1),
    actions: p.actions.map((x, i) => ({ ...x, dueDate: addDaysStr(addMonthsStr(startDate, x.dueMonth), -1), position: i + 1 })),
  }));
}
