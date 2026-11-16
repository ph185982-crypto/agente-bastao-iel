import type { Metadata } from "next";
import { PaginaDepartamento } from "@/components/shell/PaginaDepartamento";

export const metadata: Metadata = { title: "Marketing — Avanteza" };

export default function Page() {
  return <PaginaDepartamento id="marketing" atalhos={[{ href: "/dashboards", label: "Dashboards" }]} />;
}
