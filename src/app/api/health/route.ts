import { NextResponse } from "next/server";
import { pingTurso, ensureSchema } from "@/lib/turso";
import { pingMerger } from "@/lib/merger";
import { listApiKeys } from "@/lib/key-failover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Verifies Turso DB connectivity + external merger service status.
 * Returns:
 *  { ok: true, database: "turso-connected", merger: <bool>, keys: <n> }
 */
export async function GET() {
  await ensureSchema();
  const [tursoOk, mergerOk, keys] = await Promise.all([
    pingTurso(),
    pingMerger(),
    listApiKeys().then((ks) => ks.length).catch(() => 0),
  ]);
  return NextResponse.json({
    ok: tursoOk,
    database: tursoOk ? "turso-connected" : "turso-error",
    merger: mergerOk,
    keys,
    timestamp: new Date().toISOString(),
  });
}
