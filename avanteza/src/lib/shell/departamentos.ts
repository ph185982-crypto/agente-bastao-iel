// Departamentos da Central e os módulos de cada um. Fonte única do menu lateral, das páginas de entrada
// (/operacoes, /comercial, /marketing, /financeiro) e da Central de ferramentas.
import { apps, getApp, hrefDoApp } from "@/lib/apps";
import { canUseApp, type Session } from "@/lib/session";
import { podeVerPessoal, podeVerFinanceiro } from "@/lib/financeiro/acesso";
import { podeVerDashboards } from "@/lib/dashboards/nav";

export type DepId = "operacoes" | "comercial" | "marketing" | "financeiro";
/** O que o usuário precisa poder para ver o módulo. */
type Requisito = { app: string } | "dashboards" | "financeiro" | "pessoal";

export interface Modulo {
  id: string;
  nome: string;
  descricao: string;
  icon: string;
  href: string;
  /** Abre outro aplicativo (login único) em vez de uma tela desta Central. */
  externo?: boolean;
  requer: Requisito;
}
export interface Departamento {
  id: DepId;
  nome: string;
  icon: string;
  href: string;
  descricao: string;
  modulos: Modulo[];
}

function appModulo(id: string, nome: string, icon: string, descricao: string): Modulo {
  const a = getApp(id);
  return { id, nome, icon, descricao, href: a ? hrefDoApp(a) : "/central", externo: Boolean(a?.url), requer: { app: id } };
}

export function departamentos(): Departamento[] {
  return [
    {
      id: "operacoes", nome: "Operações", icon: "truck", href: "/operacoes",
      descricao: "Contas de marketplace, clientes do Mapa e entregas.",
      modulos: [
        { id: "marketplaces", nome: "Marketplaces", icon: "store", href: "/", descricao: "Contas de Mercado Livre, Shopee e TikTok Shop: visão geral, alertas e aprovações.", requer: { app: "marketplaces" } },
        { id: "clientes", nome: "Clientes e Mapa", icon: "users", href: "/clientes", descricao: "Cadastro, plano de ação, reuniões e acessos dos clientes.", requer: { app: "marketplaces" } },
        { id: "entregas", nome: "Entregas", icon: "truck", href: "/entregas", descricao: "O que foi entregue, o que está em andamento e o que atrasou.", requer: { app: "marketplaces" } },
      ],
    },
    {
      id: "comercial", nome: "Comercial", icon: "briefcase", href: "/comercial",
      descricao: "Vendedor IA, CRM e contratos — hoje como atalhos com login único.",
      modulos: [
        appModulo("vendas", "Vendedor IA", "chat", "Atendimento e prospecção no WhatsApp com IA."),
        appModulo("crm", "CRM", "funnel", "Funil, contatos, tarefas, agenda e propostas."),
        appModulo("contratos", "Contratos", "doc", "Geração de contratos e assinatura digital."),
      ],
    },
    {
      id: "marketing", nome: "Marketing", icon: "megaphone", href: "/marketing",
      descricao: "Conteúdo, anúncios e canais dos clientes.",
      modulos: [
        appModulo("conteudo", "Conteúdo", "pen", "Produção e publicação para Instagram e LinkedIn."),
        { id: "anuncios", nome: "Anúncios", icon: "chart", href: "/dashboards#marketing", descricao: "Investimento, resultados e CAC da Meta, nos Dashboards.", requer: "dashboards" },
        { id: "canais", nome: "Canais", icon: "signal", href: "/dashboards#canais", descricao: "Mídia e tráfego dos canais dos clientes.", requer: "dashboards" },
      ],
    },
    {
      id: "financeiro", nome: "Financeiro", icon: "wallet", href: "/financeiro",
      descricao: "Receitas, despesas, contas, contratos, DRE e metas da Avanteza.",
      modulos: [
        { id: "fin-visao", nome: "Financeiro da empresa", icon: "wallet", href: "/financeiro", descricao: "Resultado do mês, previstos e gráfico diário.", requer: "financeiro" },
        { id: "fin-lanc", nome: "Lançamentos", icon: "list", href: "/financeiro/lancamentos", descricao: "Extrato com busca e filtros; criar, editar, confirmar e reclassificar.", requer: "financeiro" },
        { id: "fin-contas", nome: "Contas a pagar", icon: "bell", href: "/financeiro/contas", descricao: "Vencimentos, pagamento e cancelamento.", requer: "financeiro" },
        { id: "fin-receber", nome: "A receber", icon: "check", href: "/financeiro/receber", descricao: "Receitas previstas, baixa e perdas.", requer: "financeiro" },
        { id: "fin-contratos", nome: "Contratos recorrentes", icon: "doc", href: "/financeiro/contratos", descricao: "Mensalidades e parcelados com o andamento das parcelas.", requer: "financeiro" },
        { id: "fin-dre", nome: "DRE", icon: "chart", href: "/financeiro/dre", descricao: "Demonstração do resultado mensal.", requer: "financeiro" },
        { id: "fin-metas", nome: "Metas", icon: "flag", href: "/financeiro/metas", descricao: "Meta mensal de receita e metas de poupança.", requer: "financeiro" },
        { id: "fin-cat", nome: "Categorias", icon: "folder", href: "/financeiro/categorias", descricao: "Onde o dinheiro entra e sai.", requer: "financeiro" },
        { id: "fin-pessoal", nome: "Pessoal", icon: "lock", href: "/financeiro/pessoal", descricao: "Finanças pessoais do dono, separadas da empresa. Só você vê.", requer: "pessoal" },
      ],
    },
  ];
}

export function moduloVisivel(sess: Session | null, m: Modulo): boolean {
  const r = m.requer;
  if (r === "dashboards") return podeVerDashboards(sess);
  if (r === "financeiro") return podeVerFinanceiro(sess);
  if (r === "pessoal") return podeVerPessoal(sess);
  return canUseApp(sess, r.app);
}

/** Departamentos com só os módulos que o usuário pode abrir (some o departamento sem nenhum módulo). */
export function departamentosVisiveis(sess: Session | null): Departamento[] {
  if (!sess || sess.role === "client") return [];
  return departamentos()
    .map((d) => ({ ...d, modulos: d.modulos.filter((m) => moduloVisivel(sess, m)) }))
    .filter((d) => d.modulos.length > 0);
}

export function departamento(id: DepId, sess: Session | null): Departamento | undefined {
  return departamentosVisiveis(sess).find((d) => d.id === id);
}

/** Aplicativos externos (Site) que a Central de ferramentas ainda lista. */
export const appsInstitucionais = () => apps().filter((a) => a.external);
