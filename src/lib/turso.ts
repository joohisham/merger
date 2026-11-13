import { createClient, type Client } from "@libsql/client";

/**
 * Turso (libsql) HTTP client.
 *
 * - In production we connect to Turso over HTTP (serverless friendly, no local SQLite files).
 * - The schema is ensured on first connection via ensureSchema().
 * - We export a singleton `db` plus an `ensureSchema()` helper that any cold start can call.
 *
 * Migration strategy:
 *   1. CREATE TABLE IF NOT EXISTS — creates tables for new databases.
 *   2. ALTER TABLE migrations — adds missing columns to tables that already exist
 *      from older deploys. Uses PRAGMA table_info() to detect missing columns.
 *      This is idempotent: if a column already exists, the migration is skipped.
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

/**
 * Canonical schema for both tables. Each column is described as
 * { name, type, definition } so we can both CREATE new tables and ALTER
 * existing ones with missing columns.
 */
interface ColumnDef {
  name: string;
  /** Full column definition used in CREATE TABLE (without the column name). */
  definition: string;
  /**
   * Full ADD COLUMN definition used in ALTER TABLE (used as-is after "ADD COLUMN ").
   * NOTE: SQLite ALTER TABLE ADD COLUMN does NOT support non-constant defaults
   * (like datetime('now')). For such columns, use a constant or no default here,
   * and add a `backfill` statement to set the value for existing rows.
   */
  addDefinition: string;
  /** Optional UPDATE statement to backfill existing rows after the column is added. */
  backfill?: string;
}

const TASKS_COLUMNS: ColumnDef[] = [
  { name: "id", definition: "TEXT PRIMARY KEY", addDefinition: "TEXT PRIMARY KEY" },
  { name: "provider", definition: "TEXT", addDefinition: "TEXT" },
  { name: "provider_task_id", definition: "TEXT", addDefinition: "TEXT" },
  { name: "key_id", definition: "TEXT", addDefinition: "TEXT" },
  { name: "model", definition: "TEXT NOT NULL", addDefinition: "TEXT NOT NULL DEFAULT ''" },
  { name: "type", definition: "TEXT NOT NULL", addDefinition: "TEXT NOT NULL DEFAULT ''" },
  { name: "prompt", definition: "TEXT DEFAULT ''", addDefinition: "TEXT DEFAULT ''" },
  { name: "social_platform", definition: "TEXT DEFAULT 'all'", addDefinition: "TEXT DEFAULT 'all'" },
  { name: "params_json", definition: "TEXT DEFAULT '{}'", addDefinition: "TEXT DEFAULT '{}'" },
  { name: "status", definition: "TEXT NOT NULL", addDefinition: "TEXT NOT NULL DEFAULT 'pending'" },
  { name: "progress", definition: "INTEGER DEFAULT 0", addDefinition: "INTEGER DEFAULT 0" },
  { name: "result_urls_json", definition: "TEXT", addDefinition: "TEXT" },
  { name: "error_message", definition: "TEXT", addDefinition: "TEXT" },
  { name: "attempts_json", definition: "TEXT DEFAULT '[]'", addDefinition: "TEXT DEFAULT '[]'" },
  { name: "created_at", definition: "TEXT DEFAULT (datetime('now'))", addDefinition: "TEXT DEFAULT (datetime('now'))" },
  { name: "updated_at", definition: "TEXT DEFAULT (datetime('now'))", addDefinition: "TEXT DEFAULT (datetime('now'))" },
  { name: "completed_at", definition: "TEXT", addDefinition: "TEXT" },
];

const API_KEYS_COLUMNS: ColumnDef[] = [
  { name: "id", definition: "TEXT PRIMARY KEY", addDefinition: "TEXT PRIMARY KEY" },
  { name: "provider", definition: "TEXT NOT NULL", addDefinition: "TEXT NOT NULL DEFAULT ''" },
  { name: "label", definition: "TEXT DEFAULT ''", addDefinition: "TEXT DEFAULT ''" },
  { name: "api_key", definition: "TEXT NOT NULL", addDefinition: "TEXT NOT NULL DEFAULT ''" },
  { name: "status", definition: "TEXT DEFAULT 'active'", addDefinition: "TEXT DEFAULT 'active'" },
  { name: "usage_count", definition: "INTEGER DEFAULT 0", addDefinition: "INTEGER DEFAULT 0" },
  { name: "success_count", definition: "INTEGER DEFAULT 0", addDefinition: "INTEGER DEFAULT 0" },
  { name: "fail_count", definition: "INTEGER DEFAULT 0", addDefinition: "INTEGER DEFAULT 0" },
  { name: "last_used_at", definition: "TEXT", addDefinition: "TEXT" },
  { name: "last_error", definition: "TEXT", addDefinition: "TEXT" },
  { name: "created_at", definition: "TEXT DEFAULT (datetime('now'))", addDefinition: "TEXT DEFAULT (datetime('now'))" },
  // NOTE: updated_at was missing from the original schema. Added here + migration below.
  // CREATE TABLE allows DEFAULT (datetime('now')) — a non-constant expression — but
  // ALTER TABLE ADD COLUMN does NOT. So we add the column WITHOUT a default and then
  // backfill existing rows with datetime('now') in a separate UPDATE.
  {
    name: "updated_at",
    definition: "TEXT DEFAULT (datetime('now'))",
    // For ALTER TABLE: no default (constant), then backfill separately.
    addDefinition: "TEXT",
    // Backfill statement to run after adding the column.
    backfill: `UPDATE api_keys SET updated_at = datetime('now') WHERE updated_at IS NULL`,
  },
];

function buildCreateTableSql(table: string, columns: ColumnDef[]): string {
  const cols = columns.map((c) => `  ${c.name} ${c.definition}`).join(",\n");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n${cols}\n)`;
}

const SCHEMA_STATEMENTS = [
  buildCreateTableSql("tasks", TASKS_COLUMNS),
  buildCreateTableSql("api_keys", API_KEYS_COLUMNS),
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)`,
];

/**
 * Get the set of column names currently present in a table.
 * Uses PRAGMA table_info which is supported by SQLite / libsql.
 */
async function getTableColumns(client: Client, table: string): Promise<Set<string>> {
  const res = await client.execute({ sql: `PRAGMA table_info(${table})`, args: [] });
  const names = new Set<string>();
  for (const row of res.rows) {
    // PRAGMA table_info returns columns: cid, name, type, notnull, dflt_value, pk
    const name = row.name;
    if (typeof name === "string") names.add(name);
  }
  return names;
}

/**
 * Add any missing columns to an existing table via ALTER TABLE ADD COLUMN.
 * Skips columns that already exist. Idempotent.
 *
 * Notes on SQLite ADD COLUMN restrictions:
 *  - Cannot add a column with PRIMARY KEY (we skip 'id' — it always exists)
 *  - NOT NULL without DEFAULT is not allowed; we always provide a DEFAULT or
 *    allow NULL (for TEXT columns with non-constant defaults like datetime('now'))
 *  - Cannot add UNIQUE columns
 *  - Cannot use non-constant defaults (e.g. datetime('now')) — for those we add
 *    the column without a default, then run a `backfill` UPDATE statement.
 * We guard by skipping 'id' (always present) and providing a safe addDefinition.
 */
async function migrateTable(
  client: Client,
  table: string,
  expectedColumns: ColumnDef[]
): Promise<string[]> {
  const existing = await getTableColumns(client, table);
  const added: string[] = [];
  for (const col of expectedColumns) {
    if (existing.has(col.name)) continue;
    // 'id' is the PRIMARY KEY; cannot be added via ALTER. It must already exist
    // (otherwise the table wouldn't exist at all — handled by CREATE TABLE).
    if (col.definition.includes("PRIMARY KEY")) continue;
    try {
      await client.execute(
        `ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.addDefinition}`
      );
      added.push(`${table}.${col.name}`);
      console.log(`[turso] Migration: added column ${table}.${col.name}`);

      // If the column has a backfill statement, run it now to set values for
      // existing rows (needed for non-constant defaults like datetime('now')).
      if (col.backfill) {
        try {
          await client.execute(col.backfill);
          console.log(`[turso] Migration: backfilled ${table}.${col.name}`);
        } catch (e) {
          console.error(`[turso] Migration backfill failed for ${table}.${col.name}:`, e);
          // Don't rethrow — the column was added; backfill is best-effort.
        }
      }
    } catch (e) {
      // If the column already exists (race with another cold start), ignore the error.
      // SQLite error code for "duplicate column name" is 1 (SQLITE_ERROR) with message
      // containing "duplicate column name".
      const msg = (e as Error).message || "";
      if (/duplicate column name/i.test(msg)) {
        // Already added by a concurrent request — fine.
        continue;
      }
      console.error(`[turso] Migration failed for ${table}.${col.name}:`, e);
      throw e;
    }
  }
  return added;
}

let _schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (_schemaEnsured) return;
  const client = getDb();

  // Step 1: Create tables (if not exist) + indexes.
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.execute(stmt);
  }

  // Step 2: Run ALTER TABLE migrations to add any missing columns to tables
  // that already existed from older deploys (e.g. adding updated_at to api_keys).
  try {
    await migrateTable(client, "tasks", TASKS_COLUMNS);
    await migrateTable(client, "api_keys", API_KEYS_COLUMNS);
  } catch (e) {
    console.error("[turso] migration failed:", e);
    // Don't rethrow — schema creation already succeeded; migrations are best-effort
    // for backward compat. If a migration truly fails, the next cold start retries.
  }

  // Step 3: Auto-seed the kie.ai key from the KIE_API_KEY env var if it's set and
  // not already in the DB. This lets Vercel deployments "self-heal" on first cold
  // start without needing to run the seed script manually.
  const kieKey = process.env.KIE_API_KEY;
  if (kieKey) {
    try {
      const existing = await client.execute({
        sql: `SELECT id FROM api_keys WHERE provider = 'kie' AND api_key = ? LIMIT 1`,
        args: [kieKey],
      });
      if (existing.rows.length === 0) {
        const id = `key_seed_${Date.now().toString(36)}`;
        await client.execute({
          sql: `INSERT INTO api_keys (id, provider, label, api_key, status, created_at)
               VALUES (?, 'kie', 'Auto-seeded from KIE_API_KEY env', ?, 'active', datetime('now'))`,
          args: [id, kieKey],
        });
        console.log(`[turso] Auto-seeded kie.ai key from KIE_API_KEY env as ${id}`);
      }
    } catch (e) {
      console.error("[turso] auto-seed failed:", e);
    }
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

/**
 * Debug helper: returns the current schema of both tables.
 * Useful for the health endpoint or a /api/debug route when investigating.
 */
export async function getSchemaDebug(): Promise<{
  tasksColumns: string[];
  apiKeysColumns: string[];
}> {
  const client = getDb();
  await ensureSchema();
  const tasksCols = await getTableColumns(client, "tasks");
  const apiKeysCols = await getTableColumns(client, "api_keys");
  return {
    tasksColumns: Array.from(tasksCols).sort(),
    apiKeysColumns: Array.from(apiKeysCols).sort(),
  };
}
