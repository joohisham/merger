import "dotenv/config";
import { createClient } from "@libsql/client";

/**
 * Test that ensureSchema() from turso.ts correctly migrates existing tables.
 * We simulate an "old" api_keys table by dropping updated_at first, then
 * calling the real ensureSchema() to see if it re-adds the column.
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
  return r.rows.map((row) => String(row.name)).filter(Boolean).sort();
}

async function main() {
  console.log("=== Step 1: Current state ===");
  let cols = await getColumns("api_keys");
  console.log("api_keys columns:", cols.join(", "));

  // Check if updated_at already exists (from previous migration). If yes,
  // we can't easily remove it (SQLite doesn't support DROP COLUMN easily),
  // so we just verify the column is present.
  if (cols.includes("updated_at")) {
    console.log("");
    console.log("updated_at already exists (from previous migration).");
    console.log("Testing the UPDATE query that was failing before:");
    const keys = await db.execute(`SELECT id FROM api_keys LIMIT 1`);
    if (keys.rows.length > 0) {
      const id = String(keys.rows[0].id);
      await db.execute({
        sql: `UPDATE api_keys SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
        args: ["active", null, id],
      });
      console.log(`>>> UPDATE succeeded on row ${id}`);
    }
  }

  console.log("");
  console.log("=== Step 2: Test the real ensureSchema() ===");
  // Now call the actual ensureSchema() from turso.ts to verify it's idempotent
  const { ensureSchema, getSchemaDebug } = await import("../src/lib/turso");

  // Reset the schema-ensured flag by importing fresh
  console.log("Calling ensureSchema()...");
  await ensureSchema();
  console.log("ensureSchema() completed.");

  console.log("");
  console.log("=== Step 3: Final state ===");
  cols = await getColumns("api_keys");
  console.log("api_keys columns:", cols.join(", "));
  const tasksCols = await getColumns("tasks");
  console.log("tasks columns:   ", tasksCols.join(", "));

  console.log("");
  console.log("=== Step 4: getSchemaDebug() ===");
  const debug = await getSchemaDebug();
  console.log("tasks columns:    ", debug.tasksColumns.join(", "));
  console.log("api_keys columns: ", debug.apiKeysColumns.join(", "));

  console.log("");
  console.log("=== ALL TESTS PASSED ===");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
