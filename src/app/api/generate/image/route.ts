import { NextRequest, NextResponse } from "next/server";
import { createImageTask } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/generate/image
 * Body: {
 *   prompt: string,
 *   model?: string,
 *   social_platform?: string,
 *   aspect_ratio?: string,
 *   width?: number,
 *   height?: number,
 *   n?: number
 * }
 */
export async function POST(req: NextRequest) {
  let body: {
    prompt?: string;
    model?: string;
    social_platform?: string;
    aspect_ratio?: string;
    width?: number;
    height?: number;
    n?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.prompt || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  try {
    const { taskId, task, outcome } = await createImageTask({
      prompt: body.prompt,
      model: body.model,
      social_platform: body.social_platform,
      aspect_ratio: body.aspect_ratio,
      width: body.width,
      height: body.height,
      n: body.n,
    });
    return NextResponse.json({
      task_id: taskId,
      status: task.status,
      progress: task.progress,
      model: task.model,
      result_urls: task.result_urls_json ? JSON.parse(task.result_urls_json) : [],
      error: task.error_message,
      outcome: outcome?.success
        ? { success: true, keyId: outcome.result?.keyId, provider: outcome.result?.provider }
        : { success: false, errorClass: outcome?.errorClass, error: outcome?.errorMessage, awaitingKey: outcome?.awaitingKey },
    }, { status: task.status === "failed" ? 422 : 202 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
