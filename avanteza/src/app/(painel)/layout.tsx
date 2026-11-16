import { Shell } from "@/components/Shell";
import { requireAdmin, currentSession } from "@/lib/auth";
import { userDb } from "@/lib/db";
import { podeVerDashboards } from "@/lib/dashboards/nav";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const sess = await currentSession();
  const reviewer = sess?.role === "reviewer";
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
      reviewer={reviewer}
      admin={sess?.role === "admin"}
      dashboards={podeVerDashboards(sess)}
      who={sess?.name || sess?.email}
    >
      {children}
    </Shell>
  );
}
