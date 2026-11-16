// Playbooks padrão da Avanteza (semente idempotente: só cria o que falta; o que o admin editou na tela nunca é sobrescrito).
// Prazos: D+n = dias corridos a partir do início do serviço. Recorrência: dia da semana ISO (1 = segunda … 7 = domingo)
// ou dia do mês. Fase = posição no plano de 12 meses (1 Diagnóstico e base · 2 Estruturação · 3 Aceleração · 4 Escala).
import type { Papel, Prioridade, Recorrencia } from "./tipos";

export interface TarefaPadrao {
  slug: string;
  title: string;
  description: string;
  fase: 1 | 2 | 3 | 4;
  papel: Papel;
  d: number;
  rec?: Recorrencia;
  dia?: number;
  checklist?: string[];
  pronto?: string;
  cliente?: boolean;
  visivel?: boolean;
  min?: number;
  prio?: Prioridade;
}
export interface PlaybookPadrao {
  servico: { slug: string; name: string; description: string; kind: "marketplace" | "midia" | "ambos" | "geral"; position: number };
  playbook: { slug: string; name: string; description: string };
  tarefas: TarefaPadrao[];
}

export const PLAYBOOKS_PADRAO: PlaybookPadrao[] = [
  {
    servico: { slug: "onboarding", name: "Onboarding", description: "Entrada do cliente: kickoff, acessos, contrato, pasta no Drive e plano de 12 meses.", kind: "geral", position: 1 },
    playbook: { slug: "onboarding", name: "Onboarding do cliente", description: "Primeiros 10 dias de todo cliente novo, qualquer serviço." },
    tarefas: [
      { slug: "contrato-drive", title: "Arquivar contrato e criar a pasta do cliente no Drive", description: "Contrato assinado na pasta do cliente e a pasta cadastrada na Central.", fase: 1, papel: "gestor_conta", d: 1, checklist: ["Contrato assinado salvo na pasta", "ID da pasta cadastrado em Dados e contato", "Contrato publicado em Arquivos do Mapa"], pronto: "Contrato visível em Arquivos do Mapa.", visivel: false, min: 20, prio: 1 },
      { slug: "kickoff", title: "Reunião de kickoff e alinhamento de metas", description: "Apresentar a Avanteza, o plano de 12 meses, a rotina de reuniões e combinar as metas.", fase: 1, papel: "gestor_conta", d: 2, checklist: ["Agenda enviada com link do Meet", "Metas de faturamento e margem registradas", "Rotina de reuniões e canal de contato combinados"], pronto: "Resumo e ações registrados em Reuniões.", min: 60, prio: 1 },
      { slug: "acessos-cliente", title: "Enviar os acessos às contas e ferramentas", description: "Liberar a Avanteza nas contas dos marketplaces, Meta Business, Google e no que mais for usado.", fase: 1, papel: "gestor_conta", d: 3, checklist: ["Marketplaces (Mercado Livre, Shopee, TikTok Shop)", "Meta Business (Instagram e Facebook)", "Google (Analytics, Ads, Drive)"], pronto: "Todos os acessos testados pela equipe.", cliente: true, prio: 1 },
      { slug: "acesso-mapa", title: "Criar o acesso do cliente ao Mapa", description: "Gerar o usuário do cliente e enviar o link com a senha por canal seguro.", fase: 1, papel: "gestor_conta", d: 3, checklist: ["Acesso criado em Acesso do cliente", "Senha enviada por canal seguro"], visivel: false, min: 10, prio: 2 },
      { slug: "conferir-acessos", title: "Conferir acessos e conectar as contas na Central", description: "Conectar marketplaces e canais de mídia e confirmar que a coleta funciona.", fase: 1, papel: "gestor_conta", d: 5, checklist: ["Contas de marketplace conectadas", "Canal de mídia (Meta/Windsor) configurado", "Primeira coleta sem erro"], pronto: "Central mostrando os números do cliente.", visivel: false, min: 40, prio: 1 },
      { slug: "plano-12-meses", title: "Apresentar o plano de 12 meses ao cliente", description: "Revisar fases, metas e responsabilidades do plano com o cliente, já no Mapa.", fase: 1, papel: "gestor_conta", d: 10, checklist: ["Plano gerado na Central", "Fases e metas revisadas com o cliente", "Cliente entrou no Mapa"], pronto: "Cliente confirmou o plano.", min: 45, prio: 2 },
    ],
  },
  {
    servico: { slug: "marketplace", name: "Gestão de marketplaces", description: "Mercado Livre, Shopee e TikTok Shop: catálogo, preços, ADS, reputação, logística e relatórios.", kind: "marketplace", position: 2 },
    playbook: { slug: "marketplace", name: "Marketplaces", description: "Rotina de gestão das lojas do cliente nos marketplaces." },
    tarefas: [
      { slug: "diagnostico-conta", title: "Diagnóstico das contas nos marketplaces", description: "Ponto de partida: reputação, anúncios, curva ABC, ADS e concorrentes.", fase: 1, papel: "marketplace", d: 7, checklist: ["Reputação e métricas de atendimento", "Anúncios pausados ou sem estoque", "Curva ABC de vendas", "ADS: investimento e ROAS atuais", "Principais concorrentes"], pronto: "Diagnóstico publicado em Arquivos do Mapa.", min: 180, prio: 1 },
      { slug: "custos-margens", title: "Enviar custos e margens por produto", description: "Planilha com custo, impostos e margem mínima aceita por produto, base da política de preços.", fase: 1, papel: "marketplace", d: 7, checklist: ["Custo por produto", "Impostos", "Margem mínima aceita"], cliente: true, prio: 1 },
      { slug: "ads-estrutura", title: "Estruturar campanhas de ADS", description: "Campanhas de Product Ads por curva ABC, com meta de ROAS por grupo de produtos.", fase: 2, papel: "marketplace", d: 14, checklist: ["Campanhas por curva A, B e C", "Meta de ROAS por campanha", "Orçamento diário definido"], pronto: "Campanhas ativas com meta de ROAS.", min: 120, prio: 1 },
      { slug: "catalogo-fichas", title: "Revisar catálogo e fichas dos anúncios prioritários", description: "Títulos, atributos e descrições dos anúncios que mais vendem ou mais têm potencial.", fase: 2, papel: "marketplace", d: 21, checklist: ["Títulos com as palavras-chave certas", "Ficha técnica (atributos) completa", "Descrição padronizada", "Categoria correta"], pronto: "Anúncios prioritários com qualidade máxima no canal.", min: 240, prio: 1 },
      { slug: "precos-margem", title: "Revisar preços e margem por canal", description: "Preço de cada canal considerando taxas, frete e a margem mínima do cliente.", fase: 2, papel: "marketplace", d: 21, checklist: ["Taxas e frete de cada canal", "Margem mínima respeitada", "Regras de preço configuradas na Central"], min: 120, prio: 1 },
      { slug: "fotos-variacoes", title: "Padronizar fotos e variações", description: "Foto principal dentro das regras do canal e variações (cor/tamanho) agrupadas.", fase: 2, papel: "marketplace", d: 28, checklist: ["Foto principal no padrão do canal", "Variações agrupadas no mesmo anúncio", "Vídeo/clip onde o canal permite"], min: 180, prio: 2 },
      { slug: "logistica", title: "Revisar logística e prazos de envio", description: "Prazo de despacho, embalagem e modalidades (Full, Flex, coleta) de cada canal.", fase: 2, papel: "marketplace", d: 30, checklist: ["Prazo de despacho", "Embalagem", "Full / Flex / coleta"], min: 60, prio: 2 },
      { slug: "reputacao-perguntas", title: "Perguntas sem resposta e reputação da semana", description: "Zerar perguntas pendentes, tratar reclamações e mediações e conferir atrasos de envio.", fase: 2, papel: "marketplace", d: 7, rec: "semanal", dia: 1, checklist: ["Perguntas sem resposta zeradas", "Reclamações e mediações tratadas", "Atrasos de envio conferidos"], visivel: false, min: 45, prio: 1 },
      { slug: "ads-otimizacao", title: "Otimizar campanhas de ADS", description: "Cortar verba onde o ROAS está abaixo da meta e reforçar onde sobra espaço.", fase: 3, papel: "marketplace", d: 14, rec: "semanal", dia: 4, checklist: ["ROAS por campanha", "Verba ajustada", "Anúncios sem venda pausados no ADS"], visivel: false, min: 60, prio: 1 },
      { slug: "promocoes", title: "Inscrever produtos nas promoções da plataforma", description: "Campanhas e promoções do Mercado Livre, Shopee e TikTok Shop, respeitando a margem mínima.", fase: 3, papel: "marketplace", d: 14, rec: "quinzenal", dia: 2, checklist: ["Promoções abertas no período", "Margem conferida produto a produto"], min: 45, prio: 2 },
      { slug: "relatorio-semanal", title: "Relatório semanal de resultados", description: "Números da semana e o que vem a seguir, enviado ao cliente e publicado no Mapa.", fase: 2, papel: "marketplace", d: 7, rec: "semanal", dia: 5, checklist: ["Faturamento, pedidos e ticket", "ADS: investimento e ROAS", "Destaques e próximos passos"], pronto: "Relatório enviado e publicado em Arquivos do Mapa.", min: 45, prio: 1 },
      { slug: "reuniao-quinzenal", title: "Reunião quinzenal de resultados", description: "Resultados, pendências dos dois lados e decisões da quinzena.", fase: 2, papel: "gestor_conta", d: 14, rec: "quinzenal", dia: 2, checklist: ["Pauta com pendências e números", "Resumo e ações registrados em Reuniões"], pronto: "Reunião registrada no Mapa.", min: 45, prio: 1 },
      { slug: "otimizacao-mensal", title: "Otimização mensal do catálogo", description: "Curva ABC, preços, estoque e anúncios parados: o que ajustar no mês.", fase: 3, papel: "marketplace", d: 30, rec: "mensal", dia: 5, checklist: ["Curva ABC atualizada", "Preços revisados", "Anúncios parados tratados"], min: 120, prio: 2 },
      { slug: "estoque-campeoes", title: "Confirmar reposição de estoque dos campeões", description: "Garantir estoque dos produtos mais vendidos para não perder ranking.", fase: 3, papel: "marketplace", d: 30, rec: "mensal", dia: 25, cliente: true, prio: 2 },
      { slug: "novos-canais", title: "Abrir novo canal de venda (Shopee ou TikTok Shop)", description: "Cadastro da loja, integração do catálogo e primeiras campanhas no canal novo.", fase: 3, papel: "marketplace", d: 120, checklist: ["Conta criada e verificada", "Catálogo integrado", "Primeiras campanhas no ar"], min: 360, prio: 2 },
    ],
  },
  {
    servico: { slug: "trafego", name: "Tráfego pago", description: "Meta Ads e Google Ads: rastreamento, estrutura de campanhas, criativos, otimização e relatórios.", kind: "midia", position: 3 },
    playbook: { slug: "trafego", name: "Tráfego pago", description: "Rotina de gestão das campanhas de mídia paga." },
    tarefas: [
      { slug: "criativos-cliente", title: "Enviar fotos, vídeos e depoimentos para os anúncios", description: "Material bruto da marca para a primeira bateria de criativos.", fase: 1, papel: "trafego", d: 5, checklist: ["Fotos de produtos/serviço", "Vídeos curtos", "Depoimentos de clientes"], cliente: true, prio: 1 },
      { slug: "pixel-capi", title: "Configurar pixel, API de conversões e eventos", description: "Rastreamento confiável antes de investir: pixel, CAPI deduplicada, eventos e GA4.", fase: 1, papel: "trafego", d: 7, checklist: ["Pixel instalado", "API de conversões ativa e deduplicada", "Eventos de lead/compra testados", "GA4 conectado"], pronto: "Eventos chegando no Gerenciador de Eventos sem duplicidade.", min: 120, prio: 1 },
      { slug: "estrutura-campanhas", title: "Montar a estrutura de campanhas por funil", description: "Topo, meio e fundo com públicos, verba e nomenclatura padrão.", fase: 1, papel: "trafego", d: 14, checklist: ["Campanhas por etapa do funil", "Públicos definidos", "Verba por etapa", "Nomenclatura padrão"], pronto: "Campanhas no ar com a estrutura aprovada.", min: 180, prio: 1 },
      { slug: "criativos-semana", title: "Produzir os criativos da semana", description: "Novos anúncios toda semana para combater a fadiga de criativo.", fase: 2, papel: "design", d: 14, rec: "semanal", dia: 2, checklist: ["Briefing a partir dos melhores anúncios", "2 a 4 criativos novos", "Subidos nas campanhas de teste"], min: 120, prio: 2 },
      { slug: "otimizacao-segunda", title: "Otimizar campanhas (segunda)", description: "Primeira otimização da semana: verba, públicos e anúncios com custo alto.", fase: 2, papel: "trafego", d: 14, rec: "semanal", dia: 1, checklist: ["Custo por resultado por campanha", "Verba redistribuída", "Anúncios ruins pausados"], visivel: false, min: 45, prio: 1 },
      { slug: "otimizacao-quinta", title: "Otimizar campanhas (quinta)", description: "Segunda otimização da semana, antes do fim de semana.", fase: 2, papel: "trafego", d: 14, rec: "semanal", dia: 4, checklist: ["Custo por resultado por campanha", "Verba do fim de semana ajustada"], visivel: false, min: 45, prio: 1 },
      { slug: "relatorio-trafego", title: "Relatório semanal de tráfego", description: "Investimento, resultados e custo por resultado da semana, com os próximos passos.", fase: 2, papel: "trafego", d: 7, rec: "semanal", dia: 5, checklist: ["Investimento e resultados", "Custo por resultado", "Melhores e piores anúncios", "Próximos passos"], pronto: "Relatório enviado e publicado no Mapa.", min: 45, prio: 1 },
      { slug: "reuniao-trafego", title: "Reunião quinzenal de tráfego", description: "Resultados, testes e decisões da quinzena com o cliente.", fase: 2, papel: "gestor_conta", d: 14, rec: "quinzenal", dia: 3, checklist: ["Pauta com números e testes", "Resumo e ações registrados em Reuniões"], min: 45, prio: 1 },
      { slug: "testes-mes", title: "Planejar os testes do mês", description: "Um teste por vez (criativo, público ou oferta) com critério de decisão.", fase: 3, papel: "trafego", d: 30, rec: "mensal", dia: 2, checklist: ["Hipótese", "Critério de decisão", "Verba do teste"], min: 60, prio: 2 },
    ],
  },
  {
    servico: { slug: "midias-sociais", name: "Mídias sociais", description: "Instagram: calendário editorial, posts e reels, stories, aprovação do cliente e relatório mensal.", kind: "midia", position: 4 },
    playbook: { slug: "midias-sociais", name: "Mídias sociais", description: "Rotina de conteúdo do Instagram do cliente." },
    tarefas: [
      { slug: "kit-visual", title: "Kit visual e tom de voz das publicações", description: "Padrão de cores, fontes, modelos de post e o jeito de falar da marca.", fase: 1, papel: "design", d: 7, checklist: ["Modelos de feed e reels", "Paleta e fontes", "Guia de tom de voz"], min: 180, prio: 1 },
      { slug: "bio-destaques", title: "Revisar bio, destaques e link do perfil", description: "Perfil que explica o que a marca faz e leva para o contato ou a compra.", fase: 1, papel: "social", d: 10, checklist: ["Bio com proposta e chamada", "Destaques organizados", "Link na bio"], min: 60, prio: 2 },
      { slug: "calendario-editorial", title: "Calendário editorial do próximo mês", description: "Pautas por pilar de conteúdo, datas e campanhas, com formatos definidos.", fase: 2, papel: "social", d: 10, rec: "mensal", dia: 20, checklist: ["Datas e campanhas do mês", "Pautas por pilar", "Formatos (feed, reels, stories)"], pronto: "Calendário enviado para aprovação.", min: 180, prio: 1 },
      { slug: "aprovar-calendario", title: "Aprovar o calendário editorial do mês", description: "Revisar as pautas e aprovar ou pedir ajustes.", fase: 2, papel: "social", d: 10, rec: "mensal", dia: 23, cliente: true, prio: 1 },
      { slug: "posts-semana", title: "Produzir e agendar os posts e reels da semana", description: "Artes, roteiros, legendas e agendamento da semana.", fase: 2, papel: "social", d: 7, rec: "semanal", dia: 1, checklist: ["Artes e vídeos prontos", "Legendas revisadas", "Posts agendados"], min: 240, prio: 1 },
      { slug: "aprovar-posts", title: "Aprovar os posts da semana", description: "Conferir artes e legendas da semana e aprovar ou pedir ajustes.", fase: 2, papel: "social", d: 7, rec: "semanal", dia: 2, cliente: true, prio: 1 },
      { slug: "stories-semana", title: "Stories da semana", description: "Bastidores, enquetes e caixinhas para manter o perfil vivo.", fase: 2, papel: "social", d: 7, rec: "semanal", dia: 3, checklist: ["Sequência de stories planejada", "Interações (enquete/caixinha)"], visivel: false, min: 60, prio: 2 },
      { slug: "relatorio-instagram", title: "Relatório mensal do Instagram", description: "Alcance, seguidores, melhores conteúdos e o que muda no mês seguinte.", fase: 2, papel: "social", d: 30, rec: "mensal", dia: 3, checklist: ["Alcance e seguidores", "Melhores conteúdos", "Aprendizados e ajustes"], pronto: "Relatório publicado no Mapa.", min: 60, prio: 1 },
    ],
  },
];

/** Serviços padrão por tipo de cliente quando ele ainda não tem nenhum serviço cadastrado. */
export function servicosPadraoDoTipo(kind: string): string[] {
  if (kind === "midia") return ["onboarding", "trafego", "midias-sociais"];
  if (kind === "ambos") return ["onboarding", "marketplace", "trafego", "midias-sociais"];
  return ["onboarding", "marketplace"];
}
