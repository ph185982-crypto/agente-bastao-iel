// Semente do Motor de Entregas (idempotente): catálogo de serviços + playbooks padrão e, com --aplicar-clientes, os serviços
// de cada cliente ativo pelo tipo (marketplace → Onboarding + Marketplace; mídia → Onboarding + Tráfego + Mídias sociais;
// ambos → todos) e as ações (plano de 12 meses quando faltar + tarefas dos playbooks + rotinas dos próximos 30 dias).
// Rodar de novo não duplica nada: catálogo só cria o que falta (edição do admin é preservada) e as ações usam recurrence_key.
// SEGURANÇA: só roda em Postgres local. Para outro banco é preciso passar --permitir-remoto (decisão consciente).
//   Uso: DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/seed-playbooks.mjs [--aplicar-clientes] [--inicio=AAAA-MM-DD] [--previa]
//   --inicio: data de início dos serviços dos clientes que ainda não têm início de plano (padrão: hoje).
//   --previa: com --aplicar-clientes, só mostra o que seria criado (não grava ações).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isLocalUrl } from "./connect.mjs";

const args = process.argv.slice(2);
const remoto = args.includes("--permitir-remoto");
const aplicar = args.includes("--aplicar-clientes");
const previa = args.includes("--previa");
const inicioArg = args.find((a) => a.startsWith("--inicio="))?.slice(9);
const url = process.env.DATABASE_URL ?? process.env.NEON_URL;
if (!url) throw new Error("Defina DATABASE_URL");
if (!isLocalUrl(url) && !remoto) throw new Error("Recusado: DATABASE_URL não é um Postgres local. Use --permitir-remoto só se for de propósito.");
if (inicioArg && !/^\d{4}-\d{2}-\d{2}$/.test(inicioArg)) throw new Error("--inicio precisa ser AAAA-MM-DD");
process.env.DATABASE_URL = url;

// Reaproveita o código do app (TypeScript) pelo tsx: a mesma regra de geração da tela e da rotina diária.
// Sem o carregador do tsx, o script se reabre com `node --import tsx` (devDependency já instalada).
if (!process.env.AVZ_SEED_TSX) {
  const r = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: { ...process.env, AVZ_SEED_TSX: "1" } });
  process.exit(r.status ?? 1);
}
const motor = await import("../src/lib/motor/repo.ts");
const { rawQuery, closeLocalPool } = await import("../src/lib/db/client.ts");
const { spDate } = await import("../src/lib/dates.ts");

try {
  const cat = await motor.semearCatalogo();
  console.log(`catálogo: ${cat.servicos} serviço(s), ${cat.playbooks} playbook(s) e ${cat.tarefas} tarefa(s) novos`);
  if (aplicar) {
    const hoje = spDate();
    const clientes = await rawQuery("select id, name, kind, slug, start_date from avanteza.clients where active order by name");
    const equipe = await motor.listarEquipe();
    for (const c of clientes) {
      if (["showman", "uffir"].includes(c.slug) && c.kind !== "midia") console.warn(`  aviso: ${c.name} deveria ser do tipo "midia" (está "${c.kind}")`);
      const r = await motor.aplicarPlaybooks(c.id, { hoje, actor: "seed-playbooks", previa, inicio: c.start_date ?? inicioArg ?? hoje, equipe });
      const g = r.gravado;
      console.log(previa
        ? `  ${c.name} (${c.kind}): prévia — ${r.plano.criar.length} nova(s), ${r.plano.vincular.length} ligada(s) ao plano`
        : `  ${c.name} (${c.kind}): ${r.servicosCriados} serviço(s), ${r.planoCriado ? "plano criado, " : ""}${g.criadas} ação(ões) nova(s), ${g.vinculadas} ligada(s) ao plano, ${g.atualizadas} atualizada(s), ${g.arquivadas} arquivada(s)`);
    }
  }
} finally {
  await closeLocalPool();
}
