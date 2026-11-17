// Comercial sob a Central: app.avanteza.com.br/comercial/* é o Vendedor IA, servido por reescrita (next.config.ts).
// A página /comercial (entrada do departamento) continua sendo desta Central; /comercial/<qualquer coisa> vai para lá.
// Sem dependências: importado pelo next.config.ts e pelo middleware (Edge).

/** Origem do Vendedor IA (a mesma variável dos Dashboards e do Financeiro). */
export function origemVendedoria(env: Record<string, string | undefined> = process.env): string {
  return (env.VENDEDORIA_URL?.trim() || "https://nexo-vendedoria.vercel.app").replace(/\/+$/, "");
}

/** Interruptor do menu/atalhos (as reescritas ficam sempre): COMERCIAL_ZONA=0 volta os atalhos para o domínio antigo. */
export const zonaComercialLigada = (env: Record<string, string | undefined> = process.env) => env.COMERCIAL_ZONA?.trim() !== "0";

/** Reescritas da zona (Next "afterFiles": a página /comercial desta Central vence). */
export function reescritasComercial(origem: string) {
  return [{ source: "/comercial/:path+", destination: `${origem}/comercial/:path+` }];
}

/** Link antigo /crm/* aberto aqui (vindo de uma tela do Vendedor IA): manda para a zona, onde ele existe. */
export const redirecionamentosComercial = () => [
  { source: "/crm", destination: "/comercial/crm", permanent: false },
  { source: "/crm/:path*", destination: "/comercial/crm/:path*", permanent: false },
];

/**
 * Caminhos da zona que passam pelo middleware desta Central sem sessão: os arquivos do Next/fontes do Vendedor IA
 * (a proposta pública precisa deles) e a proposta pública (/comercial/p/{token} e a API dela). O resto exige a sessão
 * da Central (e o Vendedor IA ainda confere a dele).
 */
export const ZONA_PUBLICA: RegExp[] = [
  /^\/comercial\/_next\//,
  /^\/comercial\/(fonts\/|icon-\d+\.png$|manifest\.json$)/,
  /^\/comercial\/p\/[^/]+\/?$/,
  /^\/comercial\/api\/comercial\/publico\//,
];

/** Módulos do Comercial na zona (atalhos do menu por departamentos). */
export const MODULOS_ZONA: ReadonlyArray<{ id: string; nome: string; icon: string; caminho: string; descricao: string }> = [
  { id: "com-oportunidades", nome: "Oportunidades", icon: "funnel", caminho: "/comercial/oportunidades", descricao: "Funil, ficha da oportunidade, propostas e ganho." },
  { id: "com-contatos", nome: "Contatos", icon: "users", caminho: "/comercial/contatos", descricao: "Pessoas e empresas, com a conversa do WhatsApp." },
  { id: "com-tarefas", nome: "Tarefas e agenda", icon: "check", caminho: "/comercial/tarefas", descricao: "Tarefas, compromissos e reuniões do comercial." },
  { id: "com-contratos", nome: "Contratos", icon: "doc", caminho: "/comercial/contratos", descricao: "Gerar o contrato, enviar para assinatura (ClickSign) e acompanhar." },
  { id: "com-conversas", nome: "Conversas", icon: "chat", caminho: "/comercial/conversas", descricao: "WhatsApp com o Vendedor IA: atendimento e prospecção." },
  { id: "com-leads", nome: "Leads (SDR)", icon: "list", caminho: "/comercial/leads", descricao: "Kanban de leads do Vendedor IA." },
];
