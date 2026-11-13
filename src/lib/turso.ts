import { createClient, type Client } from "@libsql/client";

/**
 * Turso (libsql) HTTP client.
 *
 * - In production we connect to Turso over HTTP (serverless friendly, no local SQLite files).
 * - The schema is ensured on first connection via ensureSchema().
 * - We export a singleton `db` plus an `ensureSchema()` helper that any cold start can call.
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL || "";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DB_TOKEN || "";

if (!TURSO_URL) {
  // We do not throw at import time so the health check can surface the misconfiguration.
  console.warn("[turso] TURSO_DATABASE_URL is not set. DB features will be unavailable.");
}

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;
  _client = createClient({
    url: TURSO_URL || "file::memory:?cache=shared",
    authToken: TURSO_TOKEN || undefined,
  });
  return _client;
}

export const db = getDb();

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    provider TEXT,
    provider_task_id TEXT,
    key_id TEXT,
    model TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT DEFAULT '',
    social_platform TEXT DEFAULT 'all',
    params_json TEXT DEFAULT '{}',
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    result_urls_json TEXT,
    error_message TEXT,
    attempts_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    label TEXT DEFAULT '',
    api_key TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    usage_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)`,
];

let _schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (_schemaEnsured) return;
  const client = getDb();
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.execute(stmt);
  }
  _schemaEnsured = true;
}

export async function pingTurso(): Promise<boolean> {
  try {
    await ensureSchema();
    const r = await getDb().execute("SELECT 1 AS ok");
    return Array.isArray(r.rows) && r.rows.length > 0;
  } catch (e) {
    console.error("[turso] ping failed:", e);
    return false;
  }
}

/** Generate a sortable unique id (used for task + api_key rows). */
export function genId(prefix = "tsk"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}
