import { db, ensureSchema, genId } from "./turso";
import type { Row, InValue } from "@libsql/client";
import { runWithFailover, type ProviderName, type FailoverOutcome } from "./key-failover";
import {
  buildImageCall,
  buildVideoCall,
  kiePollTask,
} from "./providers/kie";
import { defaultModelForKind, resolveModel, type ModelSpec } from "./models";
import { submitMergeJob, pollMergeJob, type MergeClip } from "./merger";

/**
 * Task lifecycle helpers.
 *
 * Tasks are stored in Turso and progressed through states:
 *   pending -> processing -> completed | failed
 *
 * Long-running generations return a task_id immediately. Clients poll get_task
 * until completion; each poll also advances the task (polling the provider for
 * async video tasks, or merging results).
 */

export type TaskType = "image" | "video" | "merge";
export type TaskStatus = "pending" | "processing" | "completed" | "failed";

export interface TaskRow {
  id: string;
  provider: string | null;
  provider_task_id: string | null;
  key_id: string | null;
  model: string;
  type: TaskType;
  prompt: string;
  social_platform: string;
  params_json: string;
  status: TaskStatus;
  progress: number;
  result_urls_json: string | null;
  error_message: string | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToTask(r: Row): TaskRow {
  return {
    id: String(r.id),
    provider: r.provider ? String(r.provider) : null,
    provider_task_id: r.provider_task_id ? String(r.provider_task_id) : null,
    key_id: r.key_id ? String(r.key_id) : null,
    model: String(r.model ?? ""),
    type: String(r.type) as TaskType,
    prompt: String(r.prompt ?? ""),
    social_platform: String(r.social_platform ?? "all"),
    params_json: String(r.params_json ?? "{}"),
    status: String(r.status) as TaskStatus,
    progress: Number(r.progress ?? 0),
    result_urls_json: r.result_urls_json ? String(r.result_urls_json) : null,
    error_message: r.error_message ? String(r.error_message) : null,
    attempts_json: String(r.attempts_json ?? "[]"),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    completed_at: r.completed_at ? String(r.completed_at) : null,
  };
}

export async function getTask(id: string): Promise<TaskRow | null> {
  await ensureSchema();
  const r = await db.execute({ sql: `SELECT * FROM tasks WHERE id = ?`, args: [id] });
  if (!r.rows.length) return null;
  return rowToTask(r.rows[0]);
}

export async function listTasks(limit = 50, type?: TaskType): Promise<TaskRow[]> {
  await ensureSchema();
  // Sweep "processing" tasks BEFORE returning the list. We AWAIT (not fire-and-
  // forget) because Vercel serverless kills the lambda as soon as the response
  // is sent — a fire-and-forget sweep would be cut off and never complete.
  // Sweeping stale tasks is fast (no HTTP calls — just marks them failed).
  // Non-stale processing tasks get polled, but bounded to maxToProcess.
  try {
    await sweepProcessingTasks(5);
  } catch (e) {
    console.error("[tasks] sweepProcessingTasks error:", e);
  }

  if (type) {
    const r = await db.execute({
      sql: `SELECT * FROM tasks WHERE type = ? ORDER BY created_at DESC LIMIT ?`,
      args: [type, limit],
    });
    return r.rows.map(rowToTask);
  }
  const r = await db.execute({
    sql: `SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map(rowToTask);
}

export function parseResultUrls(t: TaskRow): string[] {
  if (!t.result_urls_json) return [];
  try {
    const v = JSON.parse(t.result_urls_json);
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function parseAttempts(t: TaskRow): Array<{ keyId: string; provider: string; errorClass: string; error: string }> {
  try {
    const v = JSON.parse(t.attempts_json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function updateTask(id: string, fields: Record<string, unknown>): Promise<void> {
  const cols: string[] = [];
  const args: InValue[] = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k} = ?`);
    args.push(v as InValue);
  }
  cols.push(`updated_at = datetime('now')`);
  args.push(id);
  await db.execute({
    sql: `UPDATE tasks SET ${cols.join(", ")} WHERE id = ?`,
    args,
  });
}

/* ----------------------------- Image generation --------------------------- */

export interface ImageGenParams {
  prompt: string;
  model?: string;
  social_platform?: string;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  n?: number;
  /** Provider preference order; default ["kie","cometapi"]. */
  providers?: ProviderName[];
}

export async function createImageTask(p: ImageGenParams): Promise<{ taskId: string; task: TaskRow; outcome?: FailoverOutcome }> {
  await ensureSchema();
  const id = genId("tsk");
  const model: ModelSpec = p.model ? (resolveModel(p.model) || defaultModelForKind("image")) : defaultModelForKind("image");
  if (model.kind !== "image") {
    throw new Error(`Model ${model.id} is not an image model.`);
  }
  const providers = p.providers ?? (model.provider === "kie" ? ["kie", "cometapi"] : ["cometapi", "kie"]);

  await db.execute({
    sql: `INSERT INTO tasks (id, model, type, prompt, social_platform, params_json, status, attempts_json)
         VALUES (?, ?, 'image', ?, ?, ?, 'processing', '[]')`,
    args: [
      id,
      model.id,
      p.prompt,
      p.social_platform ?? "all",
      JSON.stringify({ aspect_ratio: p.aspect_ratio, width: p.width, height: p.height, n: p.n }),
    ],
  });

  const outcome = await runWithFailover({
    providers,
    model: model.id,
    payload: { ...p },
    call: buildImageCall({
      prompt: p.prompt,
      model: model.id,
      social_platform: p.social_platform,
      aspect_ratio: p.aspect_ratio,
      width: p.width,
      height: p.height,
      n: p.n,
    }),
  });

  if (outcome.success && outcome.result) {
    const r = outcome.result;
    // kie.ai tasks are always async (POST /createTask -> poll /recordInfo).
    // If the provider returned immediate resultUrls, mark complete now.
    const isImmediate = !!r.immediate && !!r.resultUrls?.length;
    await updateTask(id, {
      provider: r.provider,
      provider_task_id: r.providerTaskId ?? null,
      key_id: r.keyId,
      attempts_json: JSON.stringify(outcome.attempts),
      status: isImmediate ? "completed" : "processing",
      progress: isImmediate ? 100 : 10,
      result_urls_json: r.resultUrls?.length ? JSON.stringify(r.resultUrls) : null,
      completed_at: isImmediate ? new Date().toISOString() : null,
    });
  } else if (outcome.errorClass === "params") {
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "failed",
      error_message: outcome.errorMessage,
      completed_at: new Date().toISOString(),
    });
  } else if (!outcome.awaitingKey) {
    // Permanent failure (exhausted / disabled / provider / unknown):
    // mark FAILED immediately so the user knows they need to top up credits
    // or fix their API key — there's no point waiting.
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "failed",
      progress: 0,
      error_message: outcome.errorMessage,
      completed_at: new Date().toISOString(),
    });
  } else {
    // awaitingKey === true: transient (5xx/429/network) errors only — keep
    // "processing" so get_task can retry when a key becomes available.
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "processing",
      progress: 5,
      error_message: outcome.awaitingKey ? "Awaiting an active API key. Add one in the dashboard." : outcome.errorMessage,
    });
  }

  const task = (await getTask(id))!;
  return { taskId: id, task, outcome };
}

/* ----------------------------- Video generation --------------------------- */

export interface VideoGenParams {
  prompt: string;
  model?: string;
  social_platform?: string;
  aspect_ratio?: string;
  duration?: number;
  providers?: ProviderName[];
}

export async function createVideoTask(p: VideoGenParams): Promise<{ taskId: string; task: TaskRow; outcome?: FailoverOutcome }> {
  await ensureSchema();
  const id = genId("tsk");
  const model: ModelSpec = p.model ? (resolveModel(p.model) || defaultModelForKind("video")) : defaultModelForKind("video");
  if (model.kind !== "video") {
    throw new Error(`Model ${model.id} is not a video model.`);
  }
  const providers = p.providers ?? (model.provider === "kie" ? ["kie", "cometapi"] : ["cometapi", "kie"]);

  await db.execute({
    sql: `INSERT INTO tasks (id, model, type, prompt, social_platform, params_json, status, attempts_json)
         VALUES (?, ?, 'video', ?, ?, ?, 'processing', '[]')`,
    args: [
      id,
      model.id,
      p.prompt,
      p.social_platform ?? "all",
      JSON.stringify({ aspect_ratio: p.aspect_ratio, duration: p.duration }),
    ],
  });

  const outcome = await runWithFailover({
    providers,
    model: model.id,
    payload: { ...p },
    call: buildVideoCall({
      prompt: p.prompt,
      model: model.id,
      social_platform: p.social_platform,
      aspect_ratio: p.aspect_ratio,
      duration: p.duration,
    }),
  });

  if (outcome.success && outcome.result) {
    const r = outcome.result;
    await updateTask(id, {
      provider: r.provider,
      provider_task_id: r.providerTaskId ?? null,
      key_id: r.keyId,
      attempts_json: JSON.stringify(outcome.attempts),
      status: "processing",
      progress: 10,
    });
  } else if (outcome.errorClass === "params") {
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "failed",
      error_message: outcome.errorMessage,
      completed_at: new Date().toISOString(),
    });
  } else if (!outcome.awaitingKey) {
    // Permanent failure (exhausted / disabled / provider): mark FAILED immediately.
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "failed",
      progress: 0,
      error_message: outcome.errorMessage,
      completed_at: new Date().toISOString(),
    });
  } else {
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "processing",
      progress: 5,
      error_message: outcome.awaitingKey ? "Awaiting an active API key. Add one in the dashboard." : outcome.errorMessage,
    });
  }

  const task = (await getTask(id))!;
  return { taskId: id, task, outcome };
}

/* ----------------------------- Merge tasks -------------------------------- */

export async function createMergeTaskEntry(clips: MergeClip[], socialPlatform = "all"): Promise<string> {
  await ensureSchema();
  const id = genId("tsk");
  await db.execute({
    sql: `INSERT INTO tasks (id, provider, model, type, prompt, social_platform, params_json, status, attempts_json)
         VALUES (?, 'merger', 'merge', 'merge', '', ?, ?, 'processing', '[]')`,
    args: [id, socialPlatform, JSON.stringify({ clips })],
  });
  try {
    await submitMergeJob(clips, id);
    await updateTask(id, { progress: 10 });
  } catch (e: unknown) {
    await updateTask(id, {
      status: "failed",
      error_message: (e as Error).message,
      completed_at: new Date().toISOString(),
    });
  }
  return id;
}

/* ----------------------------- Polling ------------------------------------ */

/** Max age (in ms) a "processing" task can stay without progress before being marked failed. */
export const STALE_TASK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Advance a task by polling the provider / merger. Called by get_task.
 * Returns the fresh task state.
 *
 * IMPORTANT: this function never silently swallows errors. If polling fails:
 *  - On auth/key errors (401/403) we mark the task as "failed" — the key
 *    that submitted the task is no longer valid, so polling will never succeed.
 *  - On other errors (transient network, 5xx), we record the error but keep
 *    the task "processing" so it can be retried later.
 *  - After STALE_TASK_TIMEOUT_MS (3 min) with no progress change, we mark
 *    the task as "failed" to prevent it from sitting in "processing" forever.
 */
export async function advanceTask(task: TaskRow): Promise<TaskRow> {
  if (task.status === "completed" || task.status === "failed") return task;

  // Stale-task reaper: if updated_at is older than the timeout, mark failed.
  // This catches tasks that are stuck waiting for a key, or tasks whose
  // provider polling always fails silently.
  const stale = isStale(task);
  if (stale) {
    await updateTask(task.id, {
      status: "failed",
      error_message: task.error_message
        ? `${task.error_message} (timed out: no progress for >3 minutes)`
        : "Task timed out: no progress for >3 minutes. Likely the API key is exhausted/disabled, or the provider task is no longer pollable.",
      completed_at: new Date().toISOString(),
    });
    return (await getTask(task.id))!;
  }

  if (task.type === "merge" && task.provider_task_id) {
    try {
      const j = await pollMergeJob(task.provider_task_id);
      const fields: Record<string, unknown> = { progress: j.progress };
      if (j.status === "completed" && j.result_url) {
        fields.status = "completed";
        fields.result_urls_json = JSON.stringify([j.result_url]);
        fields.progress = 100;
        fields.completed_at = new Date().toISOString();
      } else if (j.status === "failed") {
        fields.status = "failed";
        fields.error_message = j.error || "Merge failed.";
        fields.completed_at = new Date().toISOString();
      }
      await updateTask(task.id, fields);
    } catch (e: unknown) {
      await updateTask(task.id, { error_message: (e as Error).message });
    }
    return (await getTask(task.id))!;
  }

  if ((task.type === "image" || task.type === "video") && task.provider_task_id && task.provider) {
    // Async provider task — poll for completion.
    let polled: { status: string; progress: number; urls: string[]; raw: unknown };
    try {
      const { getKeyPool } = await import("./key-failover");
      const pool = await getKeyPool([task.provider as ProviderName]);
      // Prefer the original key that submitted the task.
      const key = pool.find((k) => k.id === task.key_id) || pool[0];
      if (!key) {
        // No keys at all — keep the task processing; the stale reaper above
        // will eventually mark it failed if it never progresses.
        await updateTask(task.id, {
          error_message: "No API keys available for the task's provider.",
        });
        return (await getTask(task.id))!;
      }
      polled = await kiePollTask(key, task.provider_task_id, task.type);
      // Treat auth errors during polling as fatal: the key that submitted
      // the task is no longer valid, so we'll never get results.
      // We detect this by checking the raw response code in the thrown error.
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      const status = err.status ?? 0;
      const msg = err.message || String(e);

      // 401/403 = key invalid/disabled → can never poll this task again
      // 422 = task id unknown to kie.ai → can never get results
      // These are permanent — mark the task failed so it doesn't sit forever.
      if (status === 401 || status === 403 || status === 422) {
        await updateTask(task.id, {
          status: "failed",
          error_message: `Provider polling failed permanently (HTTP ${status}): ${msg}`,
          completed_at: new Date().toISOString(),
        });
        return (await getTask(task.id))!;
      }

      // Transient errors: record but keep "processing" — reaper will catch
      // it if it stays stuck for >3 minutes.
      await updateTask(task.id, { error_message: `Polling error: ${msg}` });
      return (await getTask(task.id))!;
    }

    // Polled successfully — update progress + status.
    const newProgress = Math.max(task.progress, polled.progress);
    const fields: Record<string, unknown> = {
      progress: newProgress,
      // Clear transient polling errors when we get a successful poll.
      error_message: polled.status === "failed" ? "Provider reported task failure." : null,
    };
    if (polled.status === "completed" && polled.urls.length > 0) {
      fields.status = "completed";
      fields.progress = 100;
      fields.result_urls_json = JSON.stringify(polled.urls);
      fields.completed_at = new Date().toISOString();
    } else if (polled.status === "completed" && polled.urls.length === 0) {
      // kie.ai said "completed" but returned no URLs — treat as failed.
      fields.status = "failed";
      fields.error_message = "Provider marked the task completed but returned no result URLs.";
      fields.completed_at = new Date().toISOString();
    } else if (polled.status === "failed") {
      fields.status = "failed";
      fields.error_message = "Provider reported task failure.";
      fields.completed_at = new Date().toISOString();
    } else {
      fields.status = "processing";
    }
    await updateTask(task.id, fields);
    return (await getTask(task.id))!;
  }

  // Image tasks without provider_task_id never reached kie.ai. If they have
  // no key_id, attempt a fresh failover on every poll (e.g. a key was added
  // after the task was created). The stale reaper above will eventually
  // fail them if the failover keeps returning awaitingKey.
  if (task.type === "image" && !task.provider_task_id && task.status === "processing") {
    if (!task.key_id) {
      try {
        const params = JSON.parse(task.params_json || "{}");
        await createImageTask({
          prompt: task.prompt,
          model: task.model,
          social_platform: task.social_platform,
          aspect_ratio: params.aspect_ratio,
          width: params.width,
          height: params.height,
          n: params.n,
        });
      } catch {
        // createImageTask already wrote its own error; nothing to do.
      }
      return (await getTask(task.id))!;
    }
  }

  // Same retry path for video tasks awaiting a key.
  if (task.type === "video" && !task.provider_task_id && task.status === "processing") {
    if (!task.key_id) {
      try {
        const params = JSON.parse(task.params_json || "{}");
        await createVideoTask({
          prompt: task.prompt,
          model: task.model,
          social_platform: task.social_platform,
          aspect_ratio: params.aspect_ratio,
          duration: params.duration,
        });
      } catch {
        // already recorded
      }
      return (await getTask(task.id))!;
    }
  }

  return task;
}

/** Detect if a processing task is stale (no progress update within timeout). */
function isStale(task: TaskRow): boolean {
  if (task.status !== "processing") return false;
  // Use updated_at; if it's missing fall back to created_at.
  const ts = task.updated_at || task.created_at;
  if (!ts) return false;
  // Accept both ISO ("2026-11-13T...") and SQLite ("2026-11-13 12:34:56") formats.
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t > STALE_TASK_TIMEOUT_MS;
}

/**
 * Sweep all "processing" tasks, advancing each. Called by listTasks() and
 * the /api/tasks list endpoint so tasks progress even when nobody polls
 * a specific task. Bounded by concurrency to avoid hammering kie.ai.
 *
 * Returns the count of tasks that transitioned out of "processing".
 */
export async function sweepProcessingTasks(maxToProcess = 10): Promise<number> {
  const r = await db.execute({
    sql: `SELECT * FROM tasks WHERE status = 'processing'
          ORDER BY updated_at ASC LIMIT ?`,
    args: [maxToProcess],
  });
  const tasks = r.rows.map(rowToTask);
  let changed = 0;
  for (const t of tasks) {
    const before = t.status;
    try {
      await advanceTask(t);
    } catch {
      // advanceTask should not throw; defensive guard.
    }
    // Re-read to see if status changed
    const after = await getTask(t.id);
    if (after && after.status !== before) changed++;
  }
  return changed;
}

/* ----------------------------- List media --------------------------------- */

export interface MediaItem {
  id: string;
  type: TaskType;
  model: string;
  prompt: string;
  social_platform: string;
  urls: string[];
  created_at: string;
  status: TaskStatus;
}

export async function listMedia(limit = 50, type?: TaskType): Promise<MediaItem[]> {
  const tasks = await listTasks(limit, type);
  return tasks
    .filter((t) => t.status === "completed")
    .map((t) => ({
      id: t.id,
      type: t.type,
      model: t.model,
      prompt: t.prompt,
      social_platform: t.social_platform,
      urls: parseResultUrls(t),
      created_at: t.created_at,
      status: t.status,
    }));
}
