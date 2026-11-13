import "dotenv/config";
import { createClient } from "@libsql/client";

/**
 * One-time seed script for the Turso DB.
 *
 * - Creates the schema (idempotent — safe to run multiple times).
 * - Inserts the kie.ai key from KIE_API_KEY env var (if set and not already present).
 *
 * Usage:
 *   KIE_API_KEY=xxxx bun run scripts/seed.ts
 *
 * Note: On Vercel, you don't need to run this — the app auto-seeds on first cold
 * start when KIE_API_KEY is set. This script is for local/initial setup only.
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DB_TOKEN;
const KIE_KEY = process.env.KIE_API_KEY;

if (!TURSO_URL) {
  console.error("TURSO_DATABASE_URL is not set. Add it to .env first.");
  process.exit(1);
}
if (!KIE_KEY) {
  console.error("KIE_API_KEY is not set. Add it to .env first (or pass it inline: KIE_API_KEY=xxx bun run scripts/seed.ts).");
  process.exit(1);
}

const KIE_KEY_VALUE: string = KIE_KEY;

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });

const SCHEMA = [
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

async function main() {
  for (const s of SCHEMA) await db.execute(s);

  const existing = await db.execute({
    sql: `SELECT id FROM api_keys WHERE provider = 'kie' AND api_key = ? LIMIT 1`,
    args: [KIE_KEY_VALUE],
  });
  if (existing.rows.length === 0) {
    const id = `key_seed_${Date.now().toString(36)}`;
    await db.execute({
      sql: `INSERT INTO api_keys (id, provider, label, api_key, status, created_at)
           VALUES (?, 'kie', 'Seeded via scripts/seed.ts', ?, 'active', datetime('now'))`,
      args: [id, KIE_KEY_VALUE],
    });
    console.log(`Inserted kie.ai key as ${id}`);
  } else {
    console.log(`kie.ai key already seeded (id=${existing.rows[0].id}).`);
  }

  const r = await db.execute(`SELECT COUNT(*) AS n FROM api_keys`);
  console.log(`api_keys count =`, r.rows[0]);
  const t = await db.execute(`SELECT COUNT(*) AS n FROM tasks`);
  console.log(`tasks count =`, t.rows[0]);
  const ping = await db.execute(`SELECT 1 AS ok`);
  console.log("ping:", ping.rows[0]);
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
