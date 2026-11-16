// Aprovações do Mapa: tipos, rótulos e validações puras (sem banco, sem relógio).
export type TipoPeca = "criativo" | "post" | "legenda" | "calendario" | "contrato_midia" | "relatorio" | "outro";
export type StatusAprovacao = "pendente" | "aprovada" | "ajuste" | "cancelada";
export type TipoEventoAprovacao = "enviada" | "nova_versao" | "aprovada" | "ajuste" | "comentario" | "cancelada";

export const TIPOS_PECA: TipoPeca[] = ["criativo", "post", "legenda", "calendario", "contrato_midia", "relatorio", "outro"];
export const ROTULO_TIPO_PECA: Record<TipoPeca, string> = {
  criativo: "Criativo", post: "Post", legenda: "Legenda", calendario: "Calendário editorial", contrato_midia: "Contrato de mídia", relatorio: "Relatório", outro: "Outro",
};
export const ROTULO_STATUS_APROVACAO: Record<StatusAprovacao, string> = {
  pendente: "Aguardando aprovação", aprovada: "Aprovada", ajuste: "Ajuste pedido", cancelada: "Cancelada",
};
export const ROTULO_EVENTO: Record<TipoEventoAprovacao, string> = {
  enviada: "Enviada para aprovação", nova_versao: "Nova versão enviada", aprovada: "Aprovada", ajuste: "Pediu ajuste", comentario: "Comentário", cancelada: "Cancelada",
};

export const isTipoPeca = (v: unknown): v is TipoPeca => typeof v === "string" && (TIPOS_PECA as string[]).includes(v);
export const linkValido = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 2000;

/** Atrasada: pendente e com prazo antes de hoje. */
export const aprovacaoAtrasada = (a: { status: string; prazo: string | null }, hoje: string) => a.status === "pendente" && Boolean(a.prazo) && a.prazo! < hoje;

/** Título da ação criada quando o cliente pede ajuste. */
export const tituloAjuste = (tipo: string, titulo: string) => `Ajustar ${(ROTULO_TIPO_PECA[tipo as TipoPeca] ?? "peça").toLowerCase()}: ${titulo}`.slice(0, 200);
