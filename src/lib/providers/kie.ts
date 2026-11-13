import type { ApiKeyRow, ProviderName, ProviderCallResult } from "../key-failover";
import { presetForPlatform } from "../models";

/**
 * kie.ai provider integration.
 *
 * Docs (public): https://docs.kie.ai
 *  - Create task:  POST /api/v1/jobs/createTask
 *      body: { model, callBackUrl?, input: { prompt, aspect_ratio, ... } }
 *      resp: { code:200, msg:"success", data: { taskId } }
 *  - Poll task:    GET  /api/v1/jobs/recordInfo?taskId=<id>
 *      resp: { code:200, data: { taskId, state: "waiting|queuing|generating|success|fail",
 *                               progress, resultJson: '{"resultUrls":[...]}' } }
 *
 * The same /createTask + /recordInfo pair works for both image and video models.
 * Auth is via `Authorization: Bearer <api_key>` header.
 */

const KIE_BASE = process.env.KIE_BASE_URL || "https://api.kie.ai";

interface ImageGenInput {
  prompt: string;
  model: string;
  social_platform?: string;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  n?: number;
}

interface VideoGenInput {
  prompt: string;
  model: string;
  social_platform?: string;
  aspect_ratio?: string;
  duration?: number;
}

export interface ProviderCallOptions {
  image?: ImageGenInput;
  video?: VideoGenInput;
}

function resolveAspectRatio(input: { social_platform?: string; aspect_ratio?: string }): string {
  if (input.aspect_ratio) return input.aspect_ratio;
  const preset = presetForPlatform(input.social_platform);
  return preset?.ratio || "1:1";
}

async function parseError(res: Response): Promise<{ status: number; message: string }> {
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    message = body?.msg || body?.message || body?.error || JSON.stringify(body).slice(0, 300);
  } catch {
    try {
      const text = await res.text();
      if (text) message = text.slice(0, 300);
    } catch { /* ignore */ }
  }
  return { status: res.status, message };
}

/** Create a kie.ai task (image or video — both go through the same /createTask). */
async function kieCreateTask(
  key: ApiKeyRow,
  model: string,
  input: Record<string, unknown>
): Promise<ProviderCallResult> {
  const endpoint = `${KIE_BASE}/api/v1/jobs/createTask`;
  const body = {
    model,
    input,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key.api_key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const { status, message } = await parseError(res);
    const err = new Error(message) as Error & { status?: number };
    err.status = status;
    throw err;
  }

  const data = await res.json();
  // kie.ai wraps responses as { code, msg, data }
  if (data?.code && data.code !== 200) {
    const err = new Error(data.msg || `kie.ai code ${data.code}`) as Error & { status?: number };
    // Map kie-specific codes to HTTP-ish status for our classifier
    err.status = data.code === 401 ? 401 : data.code === 422 ? 422 : 502;
    throw err;
  }
  const taskId = data?.data?.taskId || data?.data?.id;
  if (!taskId) {
    const err = new Error("kie.ai did not return a task id") as Error & { status?: number };
    err.status = 502;
    throw err;
  }

  return {
    keyId: key.id,
    provider: "kie",
    providerTaskId: String(taskId),
    resultUrls: undefined,
    immediate: false,
    raw: data,
  };
}

/** Poll a kie.ai task until completion. */
export async function kiePollTask(
  _key: ApiKeyRow,
  providerTaskId: string,
  _kind: "image" | "video"
): Promise<{ status: string; progress: number; urls: string[]; raw: unknown }> {
  const url = `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${_key.api_key}`,
    },
  });
  if (!res.ok) {
    const { status, message } = await parseError(res);
    const err = new Error(message) as Error & { status?: number };
    err.status = status;
    throw err;
  }
  const data = await res.json();
  if (data?.code && data.code !== 200) {
    const err = new Error(data.msg || `kie.ai code ${data.code}`) as Error & { status?: number };
    err.status = data.code === 401 ? 401 : data.code === 422 ? 422 : 502;
    throw err;
  }
  const d = data?.data || {};
  const state = String(d.state || d.status || "generating").toLowerCase();
  const progress = Number(d.progress ?? (state === "success" ? 100 : state === "fail" ? 0 : 10));

  // Result URLs come back as a JSON string in `resultJson`
  let urls: string[] = [];
  const rj = d.resultJson;
  if (typeof rj === "string" && rj.trim().length > 0) {
    try {
      const parsed = JSON.parse(rj);
      const list = parsed?.resultUrls || parsed?.result_urls || parsed?.urls || parsed?.outputs;
      if (Array.isArray(list)) urls = list.filter(Boolean) as string[];
      else if (typeof list === "string") urls = [list];
      else if (parsed?.url) urls = [String(parsed.url)];
    } catch { /* ignore */ }
  } else if (Array.isArray(rj)) {
    urls = rj.filter(Boolean) as string[];
  } else if (rj && typeof rj === "object") {
    const list = (rj as { resultUrls?: unknown; result_urls?: unknown; urls?: unknown }).resultUrls
      || (rj as { result_urls?: unknown }).result_urls
      || (rj as { urls?: unknown }).urls;
    if (Array.isArray(list)) urls = list.filter(Boolean) as string[];
  }

  const status =
    state === "success" || state === "completed" ? "completed" :
    state === "fail" || state === "failed" ? "failed" : "processing";

  return { status, progress, urls, raw: data };
}

/** Build a failover call closure for image generation. */
export function buildImageCall(opts: ImageGenInput) {
  return async ({ key }: { key: ApiKeyRow; provider: ProviderName }): Promise<ProviderCallResult> => {
    const aspectRatio = resolveAspectRatio(opts);
    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: aspectRatio,
      n: opts.n ?? 1,
      output_format: "png",
    };
    if (opts.width && opts.height) {
      input.width = opts.width;
      input.height = opts.height;
    }
    return kieCreateTask(key, opts.model, input);
  };
}

/** Build a failover call closure for video generation. */
export function buildVideoCall(opts: VideoGenInput) {
  return async ({ key }: { key: ApiKeyRow; provider: ProviderName }): Promise<ProviderCallResult> => {
    const aspectRatio = resolveAspectRatio(opts);
    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: aspectRatio,
      duration: opts.duration ?? 5,
      audio: true,
    };
    return kieCreateTask(key, opts.model, input);
  };
}
