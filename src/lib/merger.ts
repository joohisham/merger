import { db, ensureSchema, genId } from "./turso";
import type { Row } from "@libsql/client";

/**
 * Video Merge Service (client for the external /api/jobs merger microservice).
 *
 * Limits enforced by the external merger:
 *  - Max 10 clips
 *  - Max 200MB per source
 *  - Max 150MB output
 *  - Max 600 seconds total duration
 *  - ~24h storage expiry
 *
 * Endpoints:
 *   POST /api/jobs                       -> create job, returns { id, ... }
 *   POST /api/jobs/{id}/process          -> start processing
 *   GET  /api/jobs/{id}                  -> poll status
 *   GET  /api/jobs/{id}/video?download=1 -> download merged video
 */

const MERGER_BASE = process.env.MERGER_BASE_URL || "https://merger.example.com";

export interface MergeClip {
  url: string;        // direct video URL OR a previously-completed task id
  type: "url" | "task_id";
  label?: string;
}

export interface MergeJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result_url?: string;
  expires_at?: string;
  error?: string;
}

export const MERGE_LIMITS = {
  maxClips: 10,
  maxSourceMB: 200,
  maxOutputMB: 150,
  maxDurationSec: 600,
} as const;

function validateClips(clips: MergeClip[]): { ok: boolean; error?: string } {
  if (!Array.isArray(clips) || clips.length === 0) {
    return { ok: false, error: "At least one clip is required." };
  }
  if (clips.length > MERGE_LIMITS.maxClips) {
    return { ok: false, error: `Max ${MERGE_LIMITS.maxClips} clips allowed.` };
  }
  for (const c of clips) {
    if (!c.url || typeof c.url !== "string") {
      return { ok: false, error: "Each clip must have a url or task_id." };
    }
  }
  return { ok: true };
}

/** Resolve clips that reference a completed task_id into direct URLs. */
async function resolveClips(clips: MergeClip[]): Promise<MergeClip[]> {
  const out: MergeClip[] = [];
  for (const c of clips) {
    if (c.type === "task_id" || (!c.type && /^[a-zA-Z0-9_-]{8,40}$/.test(c.url) && !c.url.startsWith("http"))) {
      const r = await db.execute({ sql: `SELECT result_urls_json FROM tasks WHERE id = ?`, args: [c.url] });
      const row = r.rows[0];
      if (!row || !row.result_urls_json) {
        throw new Error(`Task ${c.url} has no completed result URLs to merge.`);
      }
      const urls: string[] = JSON.parse(String(row.result_urls_json));
      if (!urls.length) throw new Error(`Task ${c.url} has no result URLs.`);
      out.push({ url: urls[0], type: "url", label: c.label || `task:${c.url}` });
    } else {
      out.push({ ...c, type: "url" });
    }
  }
  return out;
}

/** Create + process a merge job in the external merger service. */
export async function submitMergeJob(clips: MergeClip[], taskDbId: string): Promise<MergeJob> {
  await ensureSchema();
  const v = validateClips(clips);
  if (!v.ok) throw new Error(v.error || "Invalid clips.");

  const resolved = await resolveClips(clips);

  // Persist the source clip list in the task row (for traceability)
  await db.execute({
    sql: `UPDATE tasks SET params_json = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [JSON.stringify({ clips: resolved }), taskDbId],
  });

  // Create external job
  const createRes = await fetch(`${MERGER_BASE}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clips: resolved.map((c) => ({ url: c.url, label: c.label })) }),
  });
  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => "");
    throw new Error(`Merger create failed: HTTP ${createRes.status} ${txt.slice(0, 200)}`);
  }
  const created = await createRes.json();
  const jobId = created?.id || created?.data?.id;
  if (!jobId) throw new Error("Merger did not return a job id.");

  // Start processing
  const procRes = await fetch(`${MERGER_BASE}/api/jobs/${encodeURIComponent(jobId)}/process`, {
    method: "POST",
  });
  if (!procRes.ok) {
    const txt = await procRes.text().catch(() => "");
    throw new Error(`Merger process failed: HTTP ${procRes.status} ${txt.slice(0, 200)}`);
  }

  // Persist provider task id for polling
  await db.execute({
    sql: `UPDATE tasks SET provider_task_id = ?, provider = 'merger', updated_at = datetime('now') WHERE id = ?`,
    args: [String(jobId), taskDbId],
  });

  return {
    id: String(jobId),
    status: "processing",
    progress: 0,
  };
}

/** Poll the external merger job and update our task row. Returns the merge job state. */
export async function pollMergeJob(jobId: string): Promise<MergeJob> {
  const res = await fetch(`${MERGER_BASE}/api/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Merger poll failed: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const rawStatus = String(data?.status || data?.data?.status || "processing").toLowerCase();
  const progress = Number(data?.progress || data?.data?.progress || 0);
  const resultUrl = data?.video_url || data?.data?.video_url || data?.output_url || data?.data?.output_url;
  const expiresAt = data?.expires_at || data?.data?.expires_at || data?.expiresAt;
  const status: MergeJob["status"] =
    rawStatus === "done" || rawStatus === "success" || rawStatus === "completed"
      ? "completed"
      : rawStatus === "failed" || rawStatus === "error"
      ? "failed"
      : rawStatus === "pending"
      ? "pending"
      : "processing";
  return {
    id: jobId,
    status,
    progress,
    result_url: resultUrl ? String(resultUrl) : undefined,
    expires_at: expiresAt ? String(expiresAt) : undefined,
    error: data?.error || data?.data?.error,
  };
}

/** Check whether the external merger service is reachable. */
export async function pingMerger(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${MERGER_BASE}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Allocate a new merge task row in our DB and return its id. */
export async function createMergeTask(clips: MergeClip[], socialPlatform = "all"): Promise<string> {
  await ensureSchema();
  const id = genId("tsk");
  await db.execute({
    sql: `INSERT INTO tasks (id, provider, model, type, prompt, social_platform, params_json, status, attempts_json)
         VALUES (?, 'merger', 'merge', 'merge', ?, ?, ?, 'pending', '[]')`,
    args: [id, socialPlatform, JSON.stringify({ clips })],
  });
  return id;
}
