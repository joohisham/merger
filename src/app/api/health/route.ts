import { NextResponse } from "next/server";
import { pingTurso, ensureSchema, getSchemaDebug } from "@/lib/turso";
import { pingMerger } from "@/lib/merger";
import { listApiKeys } from "@/lib/key-failover";
import { sweepProcessingTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Verifies Turso DB connectivity + external merger service status.
 * This endpoint NEVER crashes with a 500 — even if Turso is unreachable,
 * it returns a 200 with `ok: false` and diagnostic info so the dashboard
 * can show what's wrong instead of a fetch error.
 *
 * Also triggers sweepProcessingTasks() so stale "processing" tasks (>3 min
 * with no progress) get marked as "failed" — this is the user-facing way
 * the dashboard refresh causes the timeout reaper to fire on Vercel.
 *
 * Returns:
 *  {
 *    ok: boolean,
 *    database: "turso-connected" | "turso-error" | "turso-misconfigured",
 *    merger: boolean,
 *    keys: number,
 *    auth: boolean,
 *    env: { tursoUrlSet, tursoTokenSet, kieKeySet, sitePasswordSet },
 *    error: string | null,
 *    timestamp: string
 *  }
 */
export async function GET() {
  const tursoUrlSet = !!process.env.TURSO_DATABASE_URL;
  const tursoTokenSet = !!process.env.TURSO_AUTH_TOKEN;
  const kieKeySet = !!process.env.KIE_API_KEY;
  let tursoOk = false;
  let database: string = "turso-error";
  let keys = 0;
  let mergerOk = false;
  let error: string | null = null;

  // Try ensureSchema — but never crash the endpoint if it fails.
  try {
    await ensureSchema();
  } catch (e) {
    error = (e as Error).message?.slice(0, 300) || "ensureSchema() failed";
    // Continue — we still want to report what we can.
  }

  // Sweep stale "processing" tasks (>3 min no progress) → mark as "failed".
  // This is the user-facing way the dashboard refresh triggers the timeout
  // reaper on Vercel serverless (where fire-and-forget doesn't work).
  // Best-effort — never throw.
  try {
    await sweepProcessingTasks(5);
  } catch (e) {
    console.error("[health] sweepProcessingTasks error:", e);
  }

  // Ping Turso (also wrapped in try/catch internally, returns bool).
  try {
    tursoOk = await pingTurso();
    if (tursoOk) {
      database = "turso-connected";
    } else if (!tursoUrlSet || !tursoTokenSet) {
      database = "turso-misconfigured";
      if (!error) error = "TURSO_DATABASE_URL or TURSO_AUTH_TOKEN env var is not set.";
    }
  } catch (e) {
    error = (e as Error).message?.slice(0, 300) || "pingTurso() failed";
  }

  // Ping merger (best-effort, has internal try/catch).
  try {
    mergerOk = await pingMerger();
  } catch {
    mergerOk = false;
  }

  // Count keys (best-effort).
  try {
    keys = (await listApiKeys()).length;
  } catch {
    keys = 0;
  }

  return NextResponse.json({
    ok: tursoOk,
    database,
    merger: mergerOk,
    keys,
    auth: !!process.env.SITE_PASSWORD,
    env: {
      tursoUrlSet,
      tursoTokenSet,
      kieKeySet,
      sitePasswordSet: !!process.env.SITE_PASSWORD,
    },
    error,
    timestamp: new Date().toISOString(),
  });
}
