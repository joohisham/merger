import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

/**
 * Password-protection middleware.
 *
 * Env var: SITE_PASSWORD
 *   - If not set → open mode (no protection, useful for dev).
 *   - If set     → all routes require auth.
 *
 * Auth methods (any one works):
 *   1. Browser cookie `site_auth` (set automatically after POST /api/auth/login).
 *   2. `x-site-password: <SITE_PASSWORD>` header (for API/MCP clients).
 *   3. `Authorization: Bearer <SITE_PASSWORD>` header (for MCP clients that
 *      only support bearer auth).
 *
 * Public paths (never protected):
 *   - /_next/*, /favicon.ico, /logo.svg, /robots.txt (static assets)
 *   - /login (the login page itself)
 *   - /api/auth/login, /api/auth/logout (the auth endpoints)
 *
 * Unauthorized responses:
 *   - Browser HTML routes → 302 redirect to /login
 *   - /api/* → 401 JSON `{ error: "Unauthorized. ..." }`
 *   - /mcp   → 401 JSON-RPC `{ error: { code: -32001, message: "..." } }`
 */

export const runtime = "nodejs";

const STATIC_PATHS = ["/favicon.ico", "/logo.svg", "/robots.txt"];
const STATIC_PREFIXES = ["/_next/"];

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function isStatic(path: string): boolean {
  if (STATIC_PATHS.includes(path)) return true;
  return STATIC_PREFIXES.some((p) => path.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const path = new URL(req.url).pathname;

  // Always allow static assets (the matcher already excludes most of these,
  // but we double-check in case of edge cases).
  if (isStatic(path)) {
    return NextResponse.next();
  }

  const password = process.env.SITE_PASSWORD;
  // If no password configured, the site is open (dev mode).
  if (!password) {
    return NextResponse.next();
  }

  const expectedToken = sha256Hex(password);
  const cookie = req.cookies.get("site_auth")?.value;
  const isAuthenticatedByCookie = cookie === expectedToken;

  // Login page: allow if not authenticated; redirect to / if already logged in.
  if (path === "/login") {
    if (isAuthenticatedByCookie) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // Auth API endpoints are always reachable (they implement the login flow).
  if (path === "/api/auth/login" || path === "/api/auth/logout") {
    return NextResponse.next();
  }

  // Cookie auth (browser session after login)
  if (isAuthenticatedByCookie) {
    return NextResponse.next();
  }

  // Header auth: x-site-password (recommended for API + MCP clients)
  const headerPass = req.headers.get("x-site-password");
  if (headerPass && headerPass === password) {
    // For browser requests (HTML accept), also set the session cookie so the
    // user doesn't need to send the header on every subsequent request.
    const accept = req.headers.get("accept") || "";
    if (accept.includes("text/html")) {
      const res = NextResponse.next();
      res.cookies.set("site_auth", expectedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
      });
      return res;
    }
    return NextResponse.next();
  }

  // Header auth: Authorization: Bearer <password> (for MCP clients that only
  // support bearer auth — e.g. some Claude Desktop versions)
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === password) {
      return NextResponse.next();
    }
  }

  // Not authenticated — respond based on route type.
  if (path === "/mcp") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Unauthorized. Send the 'x-site-password' header (preferred) or 'Authorization: Bearer <SITE_PASSWORD>' with your MCP request.",
        },
        id: null,
      },
      { status: 401 }
    );
  }
  if (path.startsWith("/api/")) {
    return NextResponse.json(
      {
        error:
          "Unauthorized. Send the 'x-site-password' header (preferred) or 'Authorization: Bearer <SITE_PASSWORD>'.",
      },
      { status: 401 }
    );
  }

  // Browser: redirect to login page.
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Run on everything except Next.js internal static assets and public files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)"],
};
