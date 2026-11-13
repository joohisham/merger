import { NextRequest, NextResponse } from "next/server";
import { createMergeTaskEntry } from "@/lib/tasks";
import { MERGE_LIMITS, type MergeClip } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/merge
 * Body: {
 *   clips: Array<{ url: string, type?: "url" | "task_id", label?: string }>,
 *   social_platform?: string
 * }
 */
export async function POST(req: NextRequest) {
  let body: { clips?: MergeClip[]; social_platform?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.clips) || body.clips.length === 0) {
    return NextResponse.json({ error: "clips[] is required (1-10 clips)" }, { status: 400 });
  }
  if (body.clips.length > MERGE_LIMITS.maxClips) {
    return NextResponse.json({ error: `Max ${MERGE_LIMITS.maxClips} clips allowed.` }, { status: 400 });
  }
  try {
    const clips: MergeClip[] = body.clips.map((c) => ({
      url: c.url,
      type: c.type === "task_id" ? "task_id" : "url",
      label: c.label,
    }));
    const taskId = await createMergeTaskEntry(clips, body.social_platform || "all");
    return NextResponse.json({
      task_id: taskId,
      status: "processing",
      progress: 0,
      message: "Merge job submitted. Poll /api/tasks/[id] until status is 'completed'.",
    }, { status: 202 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
