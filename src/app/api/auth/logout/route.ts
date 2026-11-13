import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clears the session cookie. */
export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("site_auth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return res;
}
