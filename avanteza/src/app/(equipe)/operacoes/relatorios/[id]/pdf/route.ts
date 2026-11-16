// PDF do relatório semanal para a equipe (inclusive rascunho, para revisar antes de publicar).
import { currentSession } from "@/lib/auth";
import { podeVerMotor } from "@/lib/motor/acesso";
import { relatorioEquipe } from "@/lib/relatorios/gerar";
import { gerarPdfRelatorio, nomeArquivoPdf } from "@/lib/relatorios/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sess = await currentSession();
  if (!podeVerMotor(sess)) return new Response("Acesso negado.", { status: 403 });
  const { id } = await params;
  const r = await relatorioEquipe(id);
  if (!r) return new Response("Relatório não encontrado.", { status: 404 });
  const pdf = await gerarPdfRelatorio({ dados: r.dados, abertura: r.abertura, destaques: r.destaques ?? [] });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nomeArquivoPdf(r.client_name, r.semana)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
