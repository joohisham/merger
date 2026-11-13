import { db, ensureSchema, genId } from "./turso";
import type { Row } from "@libsql/client";

/**
 * Sequential API Key Failover Engine.
 *
 * Strict ordering by `created_at ASC, id ASC` (chronological order of addition).
 * Exhausted keys stay in rotation (waiting for balance refill); only `disabled`
 * keys are excluded. The AI agent never sees API key or balance errors.
 */

export type ProviderName = "kie" | "cometapi";
export type KeyStatus = "active" | "exhausted" | "disabled";

export interface ApiKeyRow {
  id: string;
  provider: ProviderName;
  label: string;
  api_key: string;
  status: KeyStatus;
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export type ErrorClass = "disabled" | "exhausted" | "provider" | "params" | "temporary";

export interface ProviderCallContext {
  providers: ProviderName[];    // ordered preference (e.g. ["kie","cometapi"])
  model: string;
  payload: Record<string, unknown>;
  /** The actual provider call. Throws on error, returns provider result on success. */
  call: (ctx: { key: ApiKeyRow; provider: ProviderName }) => Promise<ProviderCallResult>;
}

export interface ProviderCallResult {
  keyId: string;
  provider: ProviderName;
  providerTaskId?: string;
  resultUrls?: string[];
  raw?: unknown;
  /** If true, the call returned immediately with results (image gen). Otherwise the task is async. */
  immediate?: boolean;
}

export interface FailoverOutcome {
  success: boolean;
  result?: ProviderCallResult;
  errorClass?: ErrorClass;
  errorMessage?: string;
  attempts: Array<{ keyId: string; provider: ProviderName; errorClass: ErrorClass; error: string }>;
  /** When all keys failed with non-permanent errors, the task stays "processing" awaiting a valid key. */
  awaitingKey?: boolean;
}

function rowToApiKey(r: Row): ApiKeyRow {
  return {
    id: String(r.id),
    provider: String(r.provider) as ProviderName,
    label: String(r.label ?? ""),
    api_key: String(r.api_key),
    status: String(r.status) as KeyStatus,
    usage_count: Number(r.usage_count ?? 0),
    success_count: Number(r.success_count ?? 0),
    fail_count: Number(r.fail_count ?? 0),
    last_used_at: r.last_used_at ? String(r.last_used_at) : null,
    last_error: r.last_error ? String(r.last_error) : null,
    created_at: String(r.created_at),
  };
}

/** Get key pool ordered strictly by creation time. */
export async function getKeyPool(providers: ProviderName[]): Promise<ApiKeyRow[]> {
  await ensureSchema();
  if (providers.length === 0) return [];
  const placeholders = providers.map(() => "?").join(",");
  const res = await db.execute({
    sql: `SELECT * FROM api_keys WHERE status != 'disabled' AND provider IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
    args: providers,
  });
  return res.rows.map(rowToApiKey);
}

/** Classify a provider error from HTTP status / message. */
export function classifyProviderError(status: number, message: string): ErrorClass {
  const m = (message || "").toLowerCase();
  if (status === 401 || status === 403) return "disabled";
  if (status === 402) return "exhausted";
  if (status === 400 || status === 422) return "params";
  if (status === 429) return "temporary";
  if (status >= 500) return "temporary";
  // Body-based heuristics
  if (/balance|quota|credit|insufficient|exhaust/i.test(m)) return "exhausted";
  if (/invalid api key|unauthorized|forbidden|api[-_ ]?key/i.test(m)) return "disabled";
  if (/model not found|unsupported model|unknown model/i.test(m)) return "provider";
  if (/timeout|timed out|network|econnreset|socket hang/i.test(m)) return "temporary";
  if (/invalid|malformed|bad request|expected/i.test(m)) return "params";
  return "temporary";
}

async function markKeyStatus(id: string, status: KeyStatus, error: string | null): Promise<void> {
  await db.execute({
    sql: `UPDATE api_keys SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [status, error ? String(error).slice(0, 500) : null, id],
  });
}

async function markKeyUsed(id: string, success: boolean): Promise<void> {
  if (success) {
    await db.execute({
      sql: `UPDATE api_keys
           SET usage_count = usage_count + 1,
               success_count = success_count + 1,
               last_used_at = datetime('now')
           WHERE id = ?`,
      args: [id],
    });
  } else {
    await db.execute({
      sql: `UPDATE api_keys
           SET usage_count = usage_count + 1,
               fail_count = fail_count + 1,
               last_used_at = datetime('now')
           WHERE id = ?`,
      args: [id],
    });
  }
}

/**
 * Run a provider call with strict sequential key failover.
 *
 * - On `disabled`/`exhausted`: mark the key and switch to the next key.
 * - On `provider` (model not found): switch to next key.
 * - On `temporary` (429/5xx/timeout): switch to next key.
 * - On `params`: stop immediately with an error (client request error).
 *
 * If every key fails with non-permanent errors, returns `awaitingKey: true`
 * so the task can stay "processing" and retry on the next get_task poll.
 */
export async function runWithFailover(ctx: ProviderCallContext): Promise<FailoverOutcome> {
  const pool = await getKeyPool(ctx.providers);
  const attempts: FailoverOutcome["attempts"] = [];

  if (pool.length === 0) {
    return {
      success: false,
      errorClass: "disabled",
      errorMessage: "No API keys available. Add a key in the dashboard to start generating.",
      attempts,
      awaitingKey: true,
    };
  }

  let sawTemporary = false;
  let sawExhausted = false;
  let sawDisabled = false;
  let sawProvider = false;
  let lastErrorMessage = "";

  for (const key of pool) {
    try {
      const result = await ctx.call({ key, provider: key.provider });
      await markKeyUsed(key.id, true);
      return {
        success: true,
        result: { ...result, keyId: key.id, provider: key.provider },
        attempts,
      };
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      const status = err?.status ?? 0;
      const message = err?.message ?? String(e);
      lastErrorMessage = message;
      const cls = classifyProviderError(status, message);
      attempts.push({ keyId: key.id, provider: key.provider, errorClass: cls, error: message });

      if (cls === "disabled") {
        sawDisabled = true;
        await markKeyStatus(key.id, "disabled", message);
      } else if (cls === "exhausted") {
        sawExhausted = true;
        await markKeyStatus(key.id, "exhausted", message);
        await markKeyUsed(key.id, false);
      } else if (cls === "provider") {
        sawProvider = true;
        await markKeyUsed(key.id, false);
      } else if (cls === "temporary") {
        sawTemporary = true;
        await markKeyUsed(key.id, false);
      } else if (cls === "params") {
        // Client request error: stop immediately.
        return {
          success: false,
          errorClass: cls,
          errorMessage: message,
          attempts,
        };
      }
    }
  }

  // Classify the overall failure so callers (tasks.ts) can decide whether
  // to mark the task as "failed" immediately or keep it "processing-awaiting-key".
  //
  // - exhausted (Credits insufficient): NEVER wait — top up required manually.
  //   Mark task as FAILED so the user knows they need to top up.
  // - disabled (401/403): NEVER wait — key is invalid, won't recover on its own.
  //   Mark task as FAILED.
  // - provider (model not found): NEVER wait — config error, won't recover.
  //   Mark task as FAILED.
  // - temporary (5xx, 429, network): MAYBE wait — could recover on next poll.
  //   Keep task as "processing-awaiting-key".
  if (sawExhausted && !sawTemporary) {
    return {
      success: false,
      errorClass: "exhausted",
      errorMessage: lastErrorMessage || "All API keys are out of credits (exhausted). Please top up your kie.ai balance.",
      attempts,
      awaitingKey: false,
    };
  }
  if (sawDisabled && !sawTemporary && !sawExhausted) {
    return {
      success: false,
      errorClass: "disabled",
      errorMessage: lastErrorMessage || "All API keys are disabled or invalid. Check your API keys in the dashboard.",
      attempts,
      awaitingKey: false,
    };
  }
  if (sawProvider && !sawTemporary && !sawExhausted && !sawDisabled) {
    return {
      success: false,
      errorClass: "provider",
      errorMessage: lastErrorMessage || "All API keys rejected the model. Check that the model id is supported.",
      attempts,
      awaitingKey: false,
    };
  }

  // Mixed or only temporary errors — keep "processing-awaiting-key" so the
  // task can be retried when a key becomes available / a transient error clears.
  return {
    success: false,
    errorClass: "temporary",
    errorMessage: "All keys failed with non-permanent errors; task will be retried.",
    attempts,
    awaitingKey: true,
  };
}

/* --------------------------- CRUD helpers ---------------------------------- */

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  await ensureSchema();
  const res = await db.execute(
    `SELECT * FROM api_keys ORDER BY created_at ASC, id ASC`
  );
  return res.rows.map(rowToApiKey);
}

export async function createApiKey(provider: ProviderName, apiKey: string, label = ""): Promise<ApiKeyRow> {
  await ensureSchema();
  const id = genId("key");
  await db.execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key, status, created_at)
         VALUES (?, ?, ?, ?, 'active', datetime('now'))`,
    args: [id, provider, label, apiKey],
  });
  const row = await db.execute({ sql: `SELECT * FROM api_keys WHERE id = ?`, args: [id] });
  return rowToApiKey(row.rows[0]);
}

export async function updateApiKeyStatus(id: string, status: KeyStatus): Promise<void> {
  await db.execute({
    sql: `UPDATE api_keys SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [status, id],
  });
}

export async function deleteApiKey(id: string): Promise<void> {
  await db.execute({ sql: `DELETE FROM api_keys WHERE id = ?`, args: [id] });
}

/** Mask a key for display: keep first 6 + last 4 chars. */
export function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 12) return k.slice(0, 2) + "***" + k.slice(-2);
  return k.slice(0, 6) + "•".repeat(8) + k.slice(-4);
}
