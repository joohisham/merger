import { NextRequest, NextResponse } from "next/server";
import { createVideoTask } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/generate/video
 * Body: {
 *   prompt: string,
 *   model?: string,
 *   social_platform?: string,
 *   aspect_ratio?: string,
 *   duration?: number
 * }
 */
export async function POST(req: NextRequest) {
  let body: {
    prompt?: string;
    model?: string;
    social_platform?: string;
    aspect_ratio?: string;
    duration?: number;
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
    const { taskId, task, outcome } = await createVideoTask({
      prompt: body.prompt,
      model: body.model,
      social_platform: body.social_platform,
      aspect_ratio: body.aspect_ratio,
      duration: body.duration,
    });
    return NextResponse.json({
      task_id: taskId,
      status: task.status,
      progress: task.progress,
      model: task.model,
      error: task.error_message,
      outcome: outcome?.success
        ? { success: true, keyId: outcome.result?.keyId, provider: outcome.result?.provider, providerTaskId: outcome.result?.providerTaskId }
        : { success: false, errorClass: outcome?.errorClass, error: outcome?.errorMessage, awaitingKey: outcome?.awaitingKey },
    }, { status: task.status === "failed" ? 422 : 202 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
