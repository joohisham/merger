import { NextRequest, NextResponse } from "next/server";
import { updateApiKeyStatus, deleteApiKey, type KeyStatus } from "@/lib/key-failover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: KeyStatus[] = ["active", "exhausted", "disabled"];

/** PATCH /api/keys/[id] — change key status. Body: { status } */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const status = (body.status || "").toLowerCase() as KeyStatus;
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }
  await updateApiKeyStatus(id, status);
  return NextResponse.json({ id, status });
}

/** DELETE /api/keys/[id] — permanently delete a key. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await deleteApiKey(id);
  return NextResponse.json({ ok: true, id });
}
