import { NextResponse } from "next/server";
import { safeEqual } from "./crypto";
import { adminDb } from "./db";

/** Valida "Authorization: Bearer <CRON_SECRET>" (padrão da Vercel Cron e do pg_cron). */
export function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  return null;
}

export async function runJob<T>(job: string, fn: () => Promise<T>): Promise<NextResponse> {
  const db = adminDb();
  const { data: run, error: dbErr } = await db.from("job_runs").insert({ job, status: "running" }).select("id").single();
  if (dbErr) {
    console.error(`[cron] banco indisponível (${job}):`, dbErr.message);
    return NextResponse.json({ ok: false, job, error: `Banco indisponível: ${dbErr.message}` }, { status: 503 });
  }
  try {
    const result = await fn();
    await db.from("job_runs").update({ status: "ok", details: result as object, finished_at: new Date().toISOString() }).eq("id", run?.id);
    return NextResponse.json({ ok: true, job, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("job_runs").update({ status: "error", details: { error: message }, finished_at: new Date().toISOString() }).eq("id", run?.id);
    return NextResponse.json({ ok: false, job, error: message }, { status: 500 });
  }
}
