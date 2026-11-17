// Rótulos do relatório semanal nas telas da equipe.
import { dt } from "../format";
import type { RelatorioLinha } from "./gerar";

export const EMAIL: Record<string, string> = { enviado: "e-mail enviado", sem_configuracao: "e-mail não configurado", sem_contato: "cliente sem e-mail de contato", falhou: "e-mail falhou" };

export function rotuloPublicacao(r: RelatorioLinha): string {
  if (r.status === "publicado") return `Publicado ${r.publicado_em ? dt(r.publicado_em) : ""}${r.publicado_por === "automatico" ? " (automático)" : ""}${r.email_status ? ` · ${EMAIL[r.email_status] ?? r.email_status}` : ""}`;
  if (r.status === "descartado") return "Descartado";
  if (r.relatorio_modo === "auto" && r.publicar_apos) return `Publica sozinho em ${dt(r.publicar_apos)} se ninguém revisar`;
  return "Aguardando revisão (publicação manual)";
}
