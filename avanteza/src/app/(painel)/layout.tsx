import { Shell } from "@/components/Shell";
import { requireAdmin } from "@/lib/auth";
import { userDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const db = await userDb();
  const [approvals, alerts, settings] = await Promise.all([
    db.from("actions").select("id", { count: "exact", head: true }).eq("status", "proposed"),
    db.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("settings").select("global_pause, dry_run").maybeSingle(),
  ]);
  return (
    <Shell
      counts={{ approvals: approvals.count ?? 0, alerts: alerts.count ?? 0 }}
      paused={Boolean(settings.data?.global_pause)}
      dryRun={Boolean(settings.data?.dry_run)}
    >
      {children}
    </Shell>
  );
}
