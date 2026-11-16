import type { Metadata } from "next";
import { PaginaDepartamento } from "@/components/shell/PaginaDepartamento";

export const metadata: Metadata = { title: "Comercial — Avanteza" };

export default function Page() {
  return <PaginaDepartamento id="comercial" atalhos={[]} />;
}
