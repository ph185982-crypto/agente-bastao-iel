// PDF do relatório semanal do cliente (só publicado e só da empresa ativa do escopo da sessão).
import { requireMapa } from "@/lib/mapa/auth";
import { obterRelatorio } from "@/lib/mapa/relatorios";
import { gerarPdfRelatorio, nomeArquivoPdf } from "@/lib/relatorios/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { scope } = await requireMapa();
  const { id } = await params;
  const r = await obterRelatorio(scope, id);
  if (!r) return new Response("Relatório não encontrado.", { status: 404 });
  const pdf = await gerarPdfRelatorio({ dados: r.dados, abertura: r.abertura, destaques: r.destaques ?? [], publicadoEm: r.publicado_em });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nomeArquivoPdf(r.dados.cliente, r.semana)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
