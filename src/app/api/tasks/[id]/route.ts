import { NextRequest, NextResponse } from "next/server";
import { getTask, advanceTask, parseResultUrls } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tasks/[id] — fetch a task and advance its progress by polling the provider. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let task = await getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  task = await advanceTask(task);
  return NextResponse.json({
    ...task,
    result_urls: parseResultUrls(task),
    attempts: JSON.parse(task.attempts_json || "[]"),
  });
}
