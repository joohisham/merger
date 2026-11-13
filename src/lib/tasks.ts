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
    await updateTask(id, {
      provider: r.provider,
      provider_task_id: r.providerTaskId ?? null,
      key_id: r.keyId,
      attempts_json: JSON.stringify(outcome.attempts),
      status: r.immediate && r.resultUrls?.length ? "completed" : "processing",
      progress: r.immediate && r.resultUrls?.length ? 100 : 10,
      result_urls_json: r.resultUrls?.length ? JSON.stringify(r.resultUrls) : null,
      completed_at: r.immediate && r.resultUrls?.length ? new Date().toISOString() : null,
    });
  } else if (outcome.errorClass === "params") {
    await updateTask(id, {
      attempts_json: JSON.stringify(outcome.attempts),
      status: "failed",
      error_message: outcome.errorMessage,
      completed_at: new Date().toISOString(),
    });
  } else {
    // Awaiting a valid key: stay "processing" and let get_task retry.
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

/**
 * Advance a task by polling the provider / merger. Called by get_task.
 * Returns the fresh task state.
 */
export async function advanceTask(task: TaskRow): Promise<TaskRow> {
  if (task.status === "completed" || task.status === "failed") return task;

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
    try {
      const { getKeyPool } = await import("./key-failover");
      const pool = await getKeyPool([task.provider as ProviderName]);
      const key = pool.find((k) => k.id === task.key_id) || pool[0];
      if (!key) {
        // Original key gone; try any key from the same provider.
        if (pool.length === 0) return task;
        const polled = await kiePollTask(pool[0], task.provider_task_id, task.type);
        await updateTask(task.id, {
          progress: polled.progress,
          status: polled.status === "completed" ? "completed" : polled.status === "failed" ? "failed" : "processing",
          result_urls_json: polled.urls.length ? JSON.stringify(polled.urls) : task.result_urls_json,
          completed_at: polled.status === "completed" ? new Date().toISOString() : null,
        });
        return (await getTask(task.id))!;
      }
      const polled = await kiePollTask(key, task.provider_task_id, task.type);
      await updateTask(task.id, {
        progress: polled.progress,
        status: polled.status === "completed" ? "completed" : polled.status === "failed" ? "failed" : "processing",
        result_urls_json: polled.urls.length ? JSON.stringify(polled.urls) : task.result_urls_json,
        completed_at: polled.status === "completed" ? new Date().toISOString() : null,
      });
    } catch (e: unknown) {
      await updateTask(task.id, { error_message: (e as Error).message });
    }
    return (await getTask(task.id))!;
  }

  // Image tasks without provider_task_id may have completed synchronously.
  if (task.type === "image" && !task.provider_task_id && task.status === "processing") {
    // If no key was available, attempt a fresh failover on every poll.
    if (!task.key_id) {
      await createImageTask({
        prompt: task.prompt,
        model: task.model,
        social_platform: task.social_platform,
        ...JSON.parse(task.params_json || "{}"),
      }).catch(() => {});
      return (await getTask(task.id))!;
    }
  }

  return task;
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
