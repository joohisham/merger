import "dotenv/config";
import { createClient } from "@libsql/client";

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DB_TOKEN;
const KIE_KEY = "3d0ce8e2f67847701cd71604eeded488";

if (!TURSO_URL) {
  console.error("TURSO_DATABASE_URL not set");
  process.exit(1);
}

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
];

async function main() {
  for (const s of SCHEMA) await db.execute(s);
  const existing = await db.execute({
    sql: `SELECT id FROM api_keys WHERE provider = 'kie' AND api_key = ? LIMIT 1`,
    args: [KIE_KEY],
  });
  if (existing.rows.length === 0) {
    const id = `key_seed_${Date.now().toString(36)}`;
    await db.execute({
      sql: `INSERT INTO api_keys (id, provider, label, api_key, status, created_at) VALUES (?, 'kie', 'Primary kie.ai key', ?, 'active', datetime('now'))`,
      args: [id, KIE_KEY],
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
