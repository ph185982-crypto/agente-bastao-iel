import type { Metadata } from "next";
import { PaginaDepartamento } from "@/components/shell/PaginaDepartamento";

export const metadata: Metadata = { title: "Operações — Avanteza" };

export default function Page() {
  return <PaginaDepartamento id="operacoes" atalhos={[{ href: "/aprovacoes", label: "Aprovações" }, { href: "/alertas", label: "Alertas" }, { href: "/relatorios", label: "Relatórios" }, { href: "/auditoria", label: "Auditoria" }]} />;
}
