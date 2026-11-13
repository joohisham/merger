"use client";

/**
 * Tiny typed REST helper for the dashboard. All routes are relative so they
 * work transparently through the Caddy gateway in the dev sandbox and on
 * Vercel in production.
 */

export type KeyStatus = "active" | "exhausted" | "disabled";
export type ProviderName = "kie" | "cometapi";

export interface ApiKeyView {
  id: string;
  provider: ProviderName;
  label: string;
  status: KeyStatus;
  masked: string;
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface HealthState {
  ok: boolean;
  database: string;
  merger: boolean;
  keys: number;
  timestamp: string;
}

export type TaskType = "image" | "video" | "merge";
export type TaskStatus = "pending" | "processing" | "completed" | "failed";

export interface TaskView {
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
  result_urls?: string[];
  attempts?: Array<{ keyId: string; provider: string; errorClass: string; error: string }>;
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  health: () => jfetch<HealthState>("/api/health"),

  listKeys: () => jfetch<{ count: number; keys: ApiKeyView[] }>("/api/keys"),
  addKey: (provider: ProviderName, api_key: string, label: string) =>
    jfetch<ApiKeyView>("/api/keys", {
      method: "POST",
      body: JSON.stringify({ provider, api_key, label }),
    }),
  updateKey: (id: string, status: KeyStatus) =>
    jfetch<{ id: string; status: KeyStatus }>(`/api/keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  deleteKey: (id: string) =>
    jfetch<{ ok: boolean; id: string }>(`/api/keys/${id}`, { method: "DELETE" }),

  listTasks: (type?: TaskType, limit = 50) =>
    jfetch<{ count: number; tasks: TaskView[] }>(
      `/api/tasks?type=${type || ""}&limit=${limit}`
    ),
  getTask: (id: string) => jfetch<TaskView>(`/api/tasks/${id}`),

  generateImage: (body: Record<string, unknown>) =>
    jfetch<{ task_id: string; status: string; progress: number; error?: string; result_urls?: string[] }>(
      "/api/generate/image",
      { method: "POST", body: JSON.stringify(body) }
    ),
  generateVideo: (body: Record<string, unknown>) =>
    jfetch<{ task_id: string; status: string; progress: number; error?: string }>(
      "/api/generate/video",
      { method: "POST", body: JSON.stringify(body) }
    ),
  mergeVideos: (body: { clips: Array<{ url: string; type?: "url" | "task_id"; label?: string }>; social_platform?: string }) =>
    jfetch<{ task_id: string; status: string; progress: number }>(
      "/api/merge",
      { method: "POST", body: JSON.stringify(body) }
    ),
};
