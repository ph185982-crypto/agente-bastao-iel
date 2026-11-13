// Rotinas agendadas. Protegidas por CRON_SECRET (Authorization: Bearer ...).
// Chamadas pelo pg_cron do Supabase (frequentes) e pela Vercel Cron (diária, plano Hobby).
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron, runJob } from "@/lib/cron";
import { adminDb } from "@/lib/supabase/admin";
import { refreshAccount, REFRESH_WINDOW_MS, type AccountRow } from "@/lib/accounts";
import { collectBatch } from "@/lib/collector";
import { processWebhookQueue } from "@/lib/webhooks";
import { runAlerts } from "@/lib/alerts/engine";
import { runApprovedQueue } from "@/lib/executor/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function refreshTokens() {
  const db = adminDb();
  const soon = new Date(Date.now() + REFRESH_WINDOW_MS).toISOString();
  const { data } = await db
    .from("marketplace_accounts")
    .select("*")
    .eq("status", "active")
    .lt("token_expires_at", soon);
  const out = { refreshed: 0, failed: 0 };
  for (const acc of (data ?? []) as AccountRow[]) {
    try {
      await refreshAccount(acc);
      out.refreshed++;
    } catch {
      out.failed++;
    }
  }
  // limpeza de states expirados
  await db.from("oauth_states").delete().lt("expires_at", new Date().toISOString());
  return out;
}

const JOBS: Record<string, () => Promise<unknown>> = {
  "refresh-tokens": refreshTokens,
  collect: () => collectBatch(45_000),
  webhooks: () => processWebhookQueue(40_000),
  alerts: runAlerts,
  execute: () => runApprovedQueue(40_000),
  // "tick": rotina leve e frequente (a cada 5–15 min)
  tick: async () => ({
    tokens: await refreshTokens(),
    webhooks: await processWebhookQueue(20_000),
    execute: await runApprovedQueue(10_000),
  }),
  // "daily": fallback diário da Vercel Cron
  daily: async () => ({
    tokens: await refreshTokens(),
    collect: await collectBatch(35_000),
    alerts: await runAlerts(),
  }),
};

async function handle(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: "rotina desconhecida" }, { status: 404 });
  return runJob(job, fn);
}

export const GET = handle;
export const POST = handle;
