// Tipos da busca global (Ctrl/Cmd+K). Sem dependências: usados no servidor (rota /api/busca) e na paleta (cliente).

export type GrupoId = "acoes-rapidas" | "paginas" | "clientes" | "acoes" | "aprovacoes" | "oportunidades" | "contatos" | "contratos";

export interface ItemBusca {
  id: string;
  titulo: string;
  /** Linha secundária curta (cliente, etapa, prazo…). Nunca token, chave ou dado sensível. */
  detalhe?: string | null;
  href: string;
  /** Outro aplicativo (zona /comercial, login único): navegação comum, sem o roteador do Next. */
  ext?: boolean;
  icon?: string;
  /** Ação rápida que pede um cliente antes de abrir (o `href` tem `{cliente}` no lugar do id). */
  pedeCliente?: boolean;
  /** Palavras extras que também encontram o item (ex.: "contrato" acha "Simular contrato assinado"). */
  termos?: string;
}

export interface GrupoBusca { id: GrupoId; rotulo: string; itens: ItemBusca[] }
export interface AvisoBusca { grupo: "comercial" | "local"; texto: string }
export interface RespostaBusca { q: string; grupos: GrupoBusca[]; avisos: AvisoBusca[] }

export const ROTULO_GRUPO: Record<GrupoId, string> = {
  "acoes-rapidas": "Ações rápidas",
  paginas: "Páginas",
  clientes: "Clientes",
  acoes: "Ações e entregas",
  aprovacoes: "Aprovações",
  oportunidades: "Oportunidades",
  contatos: "Contatos",
  contratos: "Contratos",
};

/** Mínimo de caracteres para buscar e máximo aceito (o resto é cortado). */
export const MIN_CARACTERES = 2;
export const MAX_CARACTERES = 80;
/** Resultados por grupo (padrão e teto). */
export const LIMITE_PADRAO = 5;
export const LIMITE_MAXIMO = 10;
