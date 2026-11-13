import { NextRequest, NextResponse } from "next/server";
import { listTasks, type TaskType } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tasks?type=image|video|merge&limit=50 — list tasks. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") || undefined) as TaskType | undefined;
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const tasks = await listTasks(limit, type);
  return NextResponse.json({ count: tasks.length, tasks });
}
