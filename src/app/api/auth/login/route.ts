import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 * Body: { password: string }
 *
 * If SITE_PASSWORD env var is not set → always succeeds (open mode).
 * If password matches → sets HttpOnly cookie `site_auth` = sha256(SITE_PASSWORD),
 *   valid for 30 days.
 * If password doesn't match → 401.
 */
export async function POST(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.json({
      ok: true,
      message: "SITE_PASSWORD is not set; protection is disabled.",
    });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.password || body.password !== password) {
    return NextResponse.json({ error: "كلمة السر غير صحيحة" }, { status: 401 });
  }

  const token = createHash("sha256").update(password).digest("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set("site_auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
