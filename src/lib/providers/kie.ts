import type { ApiKeyRow, ProviderName, ProviderCallResult } from "../key-failover";
import { presetForPlatform } from "../models";

/**
 * kie.ai provider integration.
 *
 * Docs (public):
 *  - Image: POST https://api.kie.ai/api/v1/...  (gpt-image-2-6/flare-text-to-image)
 *  - Video: POST https://api.kie.ai/api/v1/...  (grok-imagine-video-1-5-preview)
 *
 * kie.ai uses an `apiKey` field inside the request body OR `Authorization: Bearer <key>`
 * (we use the Bearer header). Generation is asynchronous: the create call returns a
 * `data.id` (provider task id) that we poll via the status endpoint.
 */

const KIE_BASE = process.env.KIE_BASE_URL || "https://api.kie.ai";
const KIE_API_BASE = `${KIE_BASE}/api/v1`;

interface ImageGenInput {
  prompt: string;
  model: string;
  social_platform?: string;
  aspect_ratio?: string;     // "9:16"
  width?: number;
  height?: number;
  n?: number;                // count
}

interface VideoGenInput {
  prompt: string;
  model: string;
  social_platform?: string;
  aspect_ratio?: string;
  duration?: number;          // seconds
}

export interface ProviderCallOptions {
  image?: ImageGenInput;
  video?: VideoGenInput;
}

function resolveDimensions(input: { social_platform?: string; aspect_ratio?: string; width?: number; height?: number }) {
  const preset = presetForPlatform(input.social_platform);
  const ratio = input.aspect_ratio || preset?.ratio;
  let width = input.width || preset?.width || 1024;
  let height = input.height || preset?.height || 1024;
  if (ratio && !input.width && !input.height) {
    const [w, h] = ratio.split(":").map((x) => parseInt(x, 10));
    if (w && h) {
      const base = 1024;
      width = Math.round((base * w) / Math.max(w, h));
      height = Math.round((base * h) / Math.max(w, h));
    }
  }
  return { width, height, ratio };
}

async function parseError(res: Response): Promise<{ status: number; message: string }> {
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    message = body?.message || body?.error || body?.msg || JSON.stringify(body).slice(0, 300);
  } catch {
    try {
      const text = await res.text();
      if (text) message = text.slice(0, 300);
    } catch { /* ignore */ }
  }
  return { status: res.status, message };
}

/** Submit an image generation task to kie.ai. */
export async function kieGenerateImage(
  key: ApiKeyRow,
  opts: ImageGenInput
): Promise<ProviderCallResult> {
  const { width, height, ratio } = resolveDimensions(opts);
  const endpoint = `${KIE_API_BASE}/images/generations`;
  const body = {
    model: opts.model,
    prompt: opts.prompt,
    n: opts.n ?? 1,
    size: `${width}x${height}`,
    aspectRatio: ratio,
    response_format: "url",
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
  const urls: string[] = Array.isArray(data?.data)
    ? data.data.map((d: { url?: string; b64_json?: string }) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : "")).filter(Boolean)
    : data?.url
      ? [data.url]
      : [];

  const providerTaskId = data?.id || data?.task_id || data?.taskId || null;

  return {
    keyId: key.id,
    provider: "kie",
    providerTaskId: providerTaskId ? String(providerTaskId) : undefined,
    resultUrls: urls.length > 0 ? urls : undefined,
    immediate: urls.length > 0,
    raw: data,
  };
}

/** Submit a video generation task to kie.ai. Async — returns a provider task id. */
export async function kieGenerateVideo(
  key: ApiKeyRow,
  opts: VideoGenInput
): Promise<ProviderCallResult> {
  const { width, height, ratio } = resolveDimensions(opts);
  const endpoint = `${KIE_API_BASE}/videos/generations`;
  const body = {
    model: opts.model,
    prompt: opts.prompt,
    aspectRatio: ratio,
    width,
    height,
    duration: opts.duration ?? 5,
    audio: true,
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
  const providerTaskId = data?.id || data?.task_id || data?.taskId || data?.data?.id;
  if (!providerTaskId) {
    const err = new Error("kie.ai did not return a task id") as Error & { status?: number };
    err.status = 502;
    throw err;
  }

  return {
    keyId: key.id,
    provider: "kie",
    providerTaskId: String(providerTaskId),
    resultUrls: undefined,
    immediate: false,
    raw: data,
  };
}

/** Poll a kie.ai task until completion (or timeout). Returns result URLs. */
export async function kiePollTask(
  key: ApiKeyRow,
  providerTaskId: string,
  kind: "image" | "video"
): Promise<{ status: string; progress: number; urls: string[]; raw: unknown }> {
  const endpoint = `${KIE_API_BASE}/${kind === "image" ? "images" : "videos"}/generations/${encodeURIComponent(providerTaskId)}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key.api_key}`,
    },
  });
  if (!res.ok) {
    const { status, message } = await parseError(res);
    const err = new Error(message) as Error & { status?: number };
    err.status = status;
    throw err;
  }
  const data = await res.json();
  const status = String(data?.status || data?.data?.status || "processing").toLowerCase();
  const progress = Number(data?.progress || data?.data?.progress || (status === "completed" ? 100 : status === "failed" ? 0 : 10));
  let urls: string[] = [];
  const out = data?.output || data?.data?.output || data?.url || data?.video_url || data?.data?.url;
  if (Array.isArray(out)) urls = out.filter(Boolean) as string[];
  else if (typeof out === "string") urls = [out];
  else if (out && typeof out === "object" && out.url) urls = [String(out.url)];
  return { status, progress, urls, raw: data };
}

/** Build a failover call closure for image generation. */
export function buildImageCall(opts: ImageGenInput) {
  return async ({ key }: { key: ApiKeyRow; provider: ProviderName }): Promise<ProviderCallResult> => {
    return kieGenerateImage(key, opts);
  };
}

/** Build a failover call closure for video generation. */
export function buildVideoCall(opts: VideoGenInput) {
  return async ({ key }: { key: ApiKeyRow; provider: ProviderName }): Promise<ProviderCallResult> => {
    return kieGenerateVideo(key, opts);
  };
}
