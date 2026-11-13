import { NextResponse } from "next/server";
import { pingTurso, ensureSchema, getSchemaDebug, getEnsureSchemaError } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/debug
 *
 * Diagnostic endpoint — returns which env vars are set (boolean only, no values)
 * + Turso connectivity + schema state. Used for troubleshooting Vercel deployments.
 *
 * This endpoint is NOT password-protected by design (it leaks no secrets, only
 * boolean presence flags) so users can diagnose config issues before login.
 */
export async function GET() {
  // Collect env var PRESENCE (boolean, not values).
  const envPresence = {
    TURSO_DATABASE_URL: !!process.env.TURSO_DATABASE_URL,
    TURSO_DB_URL: !!process.env.TURSO_DB_URL,
    TURSO_AUTH_TOKEN: !!process.env.TURSO_AUTH_TOKEN,
    TURSO_DB_TOKEN: !!process.env.TURSO_DB_TOKEN,
    KIE_BASE_URL: !!process.env.KIE_BASE_URL,
    KIE_API_KEY: !!process.env.KIE_API_KEY,
    MERGER_BASE_URL: !!process.env.MERGER_BASE_URL,
    SITE_PASSWORD: !!process.env.SITE_PASSWORD,
    DATABASE_URL: !!process.env.DATABASE_URL,
  };

  // Which Turso URL/Token is actually being used (name only, not value).
  const tursoUrlSource = process.env.TURSO_DATABASE_URL
    ? "TURSO_DATABASE_URL"
    : process.env.TURSO_DB_URL
    ? "TURSO_DB_URL"
    : "(none — falling back to in-memory SQLite!)";
  const tursoTokenSource = process.env.TURSO_AUTH_TOKEN
    ? "TURSO_AUTH_TOKEN"
    : process.env.TURSO_DB_TOKEN
    ? "TURSO_DB_TOKEN"
    : "(none — connecting without auth!)";

  // Try to connect to Turso and get schema info.
  let tursoOk = false;
  let schemaDebug: { tasksColumns: string[]; apiKeysColumns: string[] } | null = null;
  let ensureError: string | null = null;

  try {
    await ensureSchema();
  } catch {
    // ensureSchema threw — capture the error
  }

  ensureError = getEnsureSchemaError();

  try {
    tursoOk = await pingTurso();
  } catch {
    tursoOk = false;
  }

  if (tursoOk) {
    try {
      schemaDebug = await getSchemaDebug();
    } catch {
      schemaDebug = null;
    }
  }

  return NextResponse.json({
    env: envPresence,
    turso: {
      connected: tursoOk,
      urlSource: tursoUrlSource,
      tokenSource: tursoTokenSource,
      ensureSchemaError: ensureError,
      schema: schemaDebug,
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    timestamp: new Date().toISOString(),
  });
}
