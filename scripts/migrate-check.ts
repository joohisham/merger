import "dotenv/config";
import { createClient } from "@libsql/client";

/**
 * Migration verification script.
 *
 * Connects to the live Turso DB, prints the current columns of both tables,
 * adds the missing `updated_at` column to `api_keys` (using a constant-default
 * approach — no default, then backfill), and verifies the previously-failing
 * UPDATE query now works.
 *
 * SQLite restriction: ALTER TABLE ADD COLUMN does NOT support non-constant
 * defaults like datetime('now'). So we:
 *   1. ALTER TABLE api_keys ADD COLUMN updated_at TEXT  (no default)
 *   2. UPDATE api_keys SET updated_at = datetime('now') WHERE updated_at IS NULL  (backfill)
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DB_TOKEN;

if (!TURSO_URL) {
  console.error("TURSO_DATABASE_URL not set");
  process.exit(1);
}

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });

async function getColumns(table: string): Promise<string[]> {
  const r = await db.execute({ sql: `PRAGMA table_info(${table})`, args: [] });
  return r.rows
    .map((row) => String(row.name))
    .filter(Boolean)
    .sort();
}

async function main() {
  console.log("=== BEFORE MIGRATION ===");
  const tasksBefore = await getColumns("tasks");
  const keysBefore = await getColumns("api_keys");
  console.log("tasks columns:    ", tasksBefore.join(", "));
  console.log("api_keys columns: ", keysBefore.join(", "));

  const keysHasUpdated = keysBefore.includes("updated_at");
  const tasksHasUpdated = tasksBefore.includes("updated_at");
  console.log("");
  console.log(`tasks.updated_at present:    ${tasksHasUpdated}`);
  console.log(`api_keys.updated_at present: ${keysHasUpdated}`);

  if (!keysHasUpdated) {
    console.log("");
    console.log(">>> api_keys.updated_at is MISSING — running migration...");
    // Step 1: Add column WITHOUT default (SQLite ALTER TABLE doesn't support non-constant defaults)
    try {
      await db.execute(`ALTER TABLE api_keys ADD COLUMN updated_at TEXT`);
      console.log(">>> ALTER TABLE ADD COLUMN succeeded (no default).");
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/duplicate column name/i.test(msg)) {
        console.log(">>> Column already exists (concurrent migration) — OK.");
      } else {
        console.error(">>> ALTER TABLE failed:", e);
        process.exit(1);
      }
    }
    // Step 2: Backfill existing rows
    try {
      await db.execute(`UPDATE api_keys SET updated_at = datetime('now') WHERE updated_at IS NULL`);
      console.log(">>> Backfill UPDATE succeeded — existing rows now have updated_at set.");
    } catch (e) {
      console.error(">>> Backfill failed:", e);
      process.exit(1);
    }
  }

  if (!tasksHasUpdated) {
    console.log("");
    console.log(">>> tasks.updated_at is MISSING — running migration...");
    try {
      await db.execute(`ALTER TABLE tasks ADD COLUMN updated_at TEXT`);
      console.log(">>> ALTER TABLE ADD COLUMN succeeded.");
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/duplicate column name/i.test(msg)) {
        console.log(">>> Column already exists — OK.");
      } else {
        console.error(">>> ALTER TABLE failed:", e);
        process.exit(1);
      }
    }
    try {
      await db.execute(`UPDATE tasks SET updated_at = datetime('now') WHERE updated_at IS NULL`);
      console.log(">>> Backfill UPDATE succeeded.");
    } catch (e) {
      console.error(">>> Backfill failed:", e);
      process.exit(1);
    }
  }

  console.log("");
  console.log("=== AFTER MIGRATION ===");
  const tasksAfter = await getColumns("tasks");
  const keysAfter = await getColumns("api_keys");
  console.log("tasks columns:    ", tasksAfter.join(", "));
  console.log("api_keys columns: ", keysAfter.join(", "));

  // Test the actual UPDATE that was failing before
  console.log("");
  console.log("=== TESTING UPDATE with updated_at on api_keys (the failing query) ===");
  try {
    const keys = await db.execute(`SELECT id, status FROM api_keys LIMIT 1`);
    if (keys.rows.length > 0) {
      const id = String(keys.rows[0].id);
      const status = String(keys.rows[0].status);
      await db.execute({
        sql: `UPDATE api_keys SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [status, null, id],
      });
      console.log(`>>> UPDATE on api_keys ${id} succeeded (the previously-failing query works!).`);
    } else {
      console.log(">>> No api_keys rows to test — skipping UPDATE test.");
    }
  } catch (e) {
    console.error(">>> UPDATE failed:", e);
    process.exit(1);
  }

  console.log("");
  console.log("=== ALL CHECKS PASSED ===");
}

main().catch((e) => {
  console.error("Script failed:", e);
  process.exit(1);
});
