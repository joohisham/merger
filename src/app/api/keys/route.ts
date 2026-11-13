import { NextRequest, NextResponse } from "next/server";
import {
  listApiKeys,
  createApiKey,
  maskKey,
  type ProviderName,
} from "@/lib/key-failover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PROVIDERS: ProviderName[] = ["kie", "cometapi"];

/** GET /api/keys — list all keys (masked). */
export async function GET() {
  const keys = await listApiKeys();
  return NextResponse.json({
    count: keys.length,
    keys: keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      label: k.label,
      status: k.status,
      masked: maskKey(k.api_key),
      usage_count: k.usage_count,
      success_count: k.success_count,
      fail_count: k.fail_count,
      last_used_at: k.last_used_at,
      last_error: k.last_error,
      created_at: k.created_at,
    })),
  });
}

/** POST /api/keys — add a new key. Body: { provider, api_key, label? } */
export async function POST(req: NextRequest) {
  let body: { provider?: string; api_key?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const provider = (body.provider || "").toLowerCase() as ProviderName;
  const apiKey = body.api_key || "";
  const label = body.label || "";
  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `provider must be one of ${VALID_PROVIDERS.join(", ")}` }, { status: 400 });
  }
  if (!apiKey || apiKey.length < 8) {
    return NextResponse.json({ error: "api_key is required (min 8 chars)" }, { status: 400 });
  }
  const created = await createApiKey(provider, apiKey, label);
  return NextResponse.json({
    id: created.id,
    provider: created.provider,
    label: created.label,
    status: created.status,
    masked: maskKey(created.api_key),
    created_at: created.created_at,
  }, { status: 201 });
}
