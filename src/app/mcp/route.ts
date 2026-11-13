import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createImageTask,
  createVideoTask,
  createMergeTaskEntry,
  getTask,
  advanceTask,
  listMedia,
  parseResultUrls,
} from "@/lib/tasks";
import type { MergeClip } from "@/lib/merger";
import { MODELS, SOCIAL_PRESETS } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-memory session registry. Each client gets a transport + server keyed by session id.
 * Sessions are removed on DELETE / timeout.
 */
interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
}
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 1000 * 60 * 30; // 30 min

function buildServer(): McpServer {
  const server = new McpServer({
    name: "social-media-mcp",
    version: "1.0.0",
  });

  server.tool(
    "generate_image",
    "Generate high-resolution social media images, thumbnails, and ad banners. Returns a task_id; poll get_task until status is 'completed' to obtain result URLs.",
    {
      prompt: z.string().min(1).describe("Text prompt describing the image to generate."),
      model: z.string().optional().describe("Model id or alias. Default: gpt-image-2-6/flare-text-to-image"),
      social_platform: z.string().optional().describe("Platform preset (instagram | tiktok | youtube | facebook | twitter | linkedin | all)."),
      aspect_ratio: z.string().optional().describe("Optional aspect ratio like '9:16', '1:1', '16:9'. Overrides the platform preset."),
      width: z.number().int().positive().optional().describe("Optional width in pixels."),
      height: z.number().int().positive().optional().describe("Optional height in pixels."),
      n: z.number().int().positive().max(4).optional().describe("Number of images to generate (1-4). Default 1."),
    },
    async (args) => {
      const { taskId, task } = await createImageTask({
        prompt: args.prompt,
        model: args.model,
        social_platform: args.social_platform,
        aspect_ratio: args.aspect_ratio,
        width: args.width,
        height: args.height,
        n: args.n,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              task_id: taskId,
              status: task.status,
              progress: task.progress,
              model: task.model,
              message:
                task.status === "completed" && parseResultUrls(task).length
                  ? "Image generated successfully."
                  : "Image generation started. Poll get_task with the task_id until status is 'completed'.",
              result_urls: parseResultUrls(task),
            }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "generate_video",
    "Generate a viral video clip with native audio for Reels, TikToks, and Shorts. Async — returns a task_id; poll get_task until status is 'completed'.",
    {
      prompt: z.string().min(1).describe("Text prompt describing the video to generate."),
      model: z.string().optional().describe("Model id or alias. Default: grok-imagine-video-1-5-preview"),
      social_platform: z.string().optional().describe("Platform preset (tiktok | instagram | youtube | facebook | twitter | linkedin | all)."),
      aspect_ratio: z.string().optional().describe("Optional aspect ratio like '9:16'. Overrides the platform preset."),
      duration: z.number().int().positive().max(60).optional().describe("Duration in seconds (max 60). Default 5."),
    },
    async (args) => {
      const { taskId, task } = await createVideoTask({
        prompt: args.prompt,
        model: args.model,
        social_platform: args.social_platform,
        aspect_ratio: args.aspect_ratio,
        duration: args.duration,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              task_id: taskId,
              status: task.status,
              progress: task.progress,
              model: task.model,
              message: "Video generation started. Poll get_task with the task_id until status is 'completed'.",
            }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "merge_videos",
    "Concatenate up to 10 video clips into a single MP4. Each clip is either a direct video URL or a previously-completed task_id from generate_video. Limits: max 10 clips, 200MB per source, 600s total.",
    {
      clips: z.array(z.object({
        url: z.string().describe("Direct video URL OR a completed task_id from generate_video."),
        type: z.enum(["url", "task_id"]).optional().describe("'url' (direct URL) or 'task_id' (reference to a completed generate_video task). Auto-detected if omitted."),
        label: z.string().optional().describe("Optional label for the clip."),
      })).min(1).max(10),
      social_platform: z.string().optional().describe("Target platform preset (default 'all')."),
    },
    async (args) => {
      const clips: MergeClip[] = args.clips.map((c) => ({
        url: c.url,
        type: c.type === "task_id" ? "task_id" : "url",
        label: c.label,
      }));
      const taskId = await createMergeTaskEntry(clips, args.social_platform || "all");
      const task = await getTask(taskId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              task_id: taskId,
              status: task?.status,
              progress: task?.progress,
              message: "Merge job submitted. Poll get_task with the task_id until status is 'completed'.",
            }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_task",
    "Track any image, video, or merge task. Returns live status, progress, result URLs, and attempts. Each call advances the task (polls the provider) so the progress value is fresh.",
    {
      task_id: z.string().min(1).describe("The task id returned by generate_image, generate_video, or merge_videos."),
    },
    async (args) => {
      let task = await getTask(args.task_id);
      if (!task) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Task not found", task_id: args.task_id }) }],
          isError: true,
        };
      }
      task = await advanceTask(task);
      const payload = {
        task_id: task.id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        model: task.model,
        social_platform: task.social_platform,
        prompt: task.prompt,
        result_urls: parseResultUrls(task),
        error: task.error_message,
        created_at: task.created_at,
        completed_at: task.completed_at,
        attempts: JSON.parse(task.attempts_json || "[]"),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );

  server.tool(
    "list_media",
    "Recall previously generated social media assets (completed images / videos / merges) directly from the database. Returns the most recent items with result URLs.",
    {
      limit: z.number().int().positive().max(100).optional().describe("Max items to return (1-100). Default 20."),
      type: z.enum(["image", "video", "merge"]).optional().describe("Filter by task type."),
    },
    async (args) => {
      const items = await listMedia(args.limit ?? 20, args.type);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: items.length, items }, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    "models",
    "config://models",
    { description: "Available generation models and social presets." },
    async () => ({
      contents: [
        {
          uri: "config://models",
          mimeType: "application/json",
          text: JSON.stringify({ models: MODELS, presets: SOCIAL_PRESETS }, null, 2),
        },
      ],
    })
  );

  return server;
}

function purgeOldSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastSeen > SESSION_TTL_MS) {
      s.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

function getOrCreateSession(sessionId?: string): Session {
  purgeOldSessions();
  if (sessionId && sessions.has(sessionId)) {
    const s = sessions.get(sessionId)!;
    s.lastSeen = Date.now();
    return s;
  }
  // New session
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id: string) => {
      // nothing — we register below
    },
  });
  const server = buildServer();
  // Connect: McpServer.connect returns a promise but we register the session id
  // only after the first response. We store under a placeholder and update on
  // response via the session id the transport generates.
  const session: Session = { transport, server, lastSeen: Date.now() };
  return session;
}

async function handleRequest(req: NextRequest): Promise<Response> {
  // Convert NextRequest to a standard Request.
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((v, k) => headers.set(k, v));
  const init: RequestInit = {
    method: req.method,
    headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  const webReq = new Request(url.toString(), init);

  // Determine session id from header (Mcp-Session-Id)
  const sessionId = headers.get("mcp-session-id") || undefined;

  // Stateless mode: every request gets its own transport, connected to a shared server.
  // This is the simplest approach that works for tools-only servers.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  const server = buildServer();
  await server.connect(transport);
  const response = await transport.handleRequest(webReq);
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const response = await handleRequest(req);
    return new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error", data: (e as Error).message },
        id: null,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // Stateless mode: GET not supported for SSE; return 405 with info.
  return new NextResponse(
    "MCP Streamable HTTP (stateless). Use POST with JSON-RPC body (initialize / tools/list / tools/call).",
    { status: 405, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

export async function DELETE() {
  return new NextResponse(null, { status: 200 });
}
