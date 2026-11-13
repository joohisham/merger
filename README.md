# MCP Media Generator & Social Media Automation Engine

Production-grade MCP (Model Context Protocol) server + Arabic RTL web dashboard for AI image / video generation and multi-platform social media content automation.

> **Stack**: Next.js 16 (App Router) • TypeScript • Tailwind CSS 4 • shadcn/ui • Turso (libsql) • `@modelcontextprotocol/sdk` • kie.ai

---

## Highlights

- **Password protection** (optional) for the dashboard + `/api` + `/mcp` routes via the `SITE_PASSWORD` env var. Browser users get a login page + cookie session; API/MCP clients send an `x-site-password` header or `Authorization: Bearer <password>`.
- **MCP Server** at `/mcp` (Streamable HTTP) exposing **5 powerful tools**:
  - `generate_image` — high-res social graphics, thumbnails, ad banners
  - `generate_video` — viral clips with native audio for Reels / TikToks / Shorts
  - `merge_videos` — concatenate up to 10 clips into one MP4
  - `get_task` — poll any task with live status + result URLs
  - `list_media` — recall previously generated assets from the DB
- **Strict sequential API key failover engine**: keys are tried in `created_at ASC` order; on `disabled`/`exhausted`/`temporary` errors the engine silently switches to the next key; on `params` (HTTP 400/422) it stops immediately. AI agents **never** see API key or balance errors.
- **Two ways to add kie.ai keys**: via `KIE_API_KEY` env var (auto-seeded on first cold start) OR via the dashboard's "Keys" tab (stored in Turso, full failover support).
- **Zero local media storage**: only URLs + metadata are persisted to Turso.
- **Asynchronous task queue**: long-running generations return a `task_id` immediately; `get_task` advances the task by polling the provider on every call.
- **Arabic RTL dark-mode dashboard** with:
  - API key manager (masked, status badges, usage stats)
  - Live task monitor (auto-refresh, progress bars, click-to-expand detail dialog)
  - Generation studio (try image / video / merge from the UI)
  - MCP integration hub (one-click copy snippets for Z.ai / GLM, Claude Desktop, Cursor, ChatGPT)
  - Health check (`/api/health`) verifying Turso + merger reachability + auth status
- **Social presets** baked in: 9:16 (TikTok / Reels / Shorts), 1:1 / 4:5 (Instagram), 16:9 (YouTube / LinkedIn / Facebook), 2:1 (Twitter/X), 4:1 (LinkedIn cover).

## Models

| Kind | Canonical id | Aliases |
| --- | --- | --- |
| image | `gpt-image-2-6/flare-text-to-image` | `gpt-image-2.6/flare-text-to-image`, `gpt-image-2-6`, `gpt-image-2.6` |
| video | `grok-imagine-video-1-5-preview` | `grok-imagine-video-1.5-preview`, `grok-imagine-video-1-5`, `grok-imagine-video-1.5`, `grok-imagine` |

## Quick start (local)

```bash
# 1. Install dependencies
bun install   # or npm install

# 2. Copy env template and fill in your Turso + kie.ai credentials
cp .env.example .env
# - TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
# - KIE_BASE_URL (default https://api.kie.ai)
# - KIE_API_KEY (your first kie.ai key — auto-seeds into the DB on first run)
# - MERGER_BASE_URL (external merger microservice URL, optional)
# - SITE_PASSWORD (optional — set to lock down the dashboard + API + MCP)

# 3. Run the dev server
bun run dev   # http://localhost:3000

# 4. (Optional) Manually seed the kie.ai key via script:
#    Only needed if KIE_API_KEY is not set in .env. The app auto-seeds on first cold start anyway.
bun run scripts/seed.ts
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel.
3. Set the following environment variables in the Vercel dashboard:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `KIE_BASE_URL` (default `https://api.kie.ai`)
   - `KIE_API_KEY` (your first kie.ai key — auto-seeds into the DB on first cold start)
   - `MERGER_BASE_URL` (external merger microservice URL, optional)
   - `SITE_PASSWORD` (password to protect the dashboard + API + MCP, optional)
4. Deploy. Vercel auto-detects Next.js 16; `vercel.json` already bumps long-running routes (`/mcp`, `/api/generate/*`, `/api/merge`, `/api/tasks/[id]`) to 60s max duration.

---

## Password protection (`SITE_PASSWORD`)

The dashboard, `/api/*`, and `/mcp` routes are **open by default** (no password). To lock them down, set the `SITE_PASSWORD` environment variable in Vercel (or in your `.env` file for local dev).

### Env var name in Vercel

```
SITE_PASSWORD=choose-a-strong-password
```

- If `SITE_PASSWORD` is **set** → all routes require auth.
- If `SITE_PASSWORD` is **empty or missing** → the site is fully open (no protection).

### How auth works

| Client type | Auth method |
| --- | --- |
| **Browser** | Visiting `/` without a cookie → redirected to `/login`. Enter the password → a `site_auth` HttpOnly cookie (SHA-256 of the password, valid 30 days) is set. The logout button in the dashboard header clears the cookie. |
| **API client** (`/api/*`) | Send header `x-site-password: <SITE_PASSWORD>` **or** `Authorization: Bearer <SITE_PASSWORD>`. |
| **MCP client** (`/mcp`) | Send header `x-site-password: <SITE_PASSWORD>` **or** `Authorization: Bearer <SITE_PASSWORD>`. The MCP Integration Hub tab auto-includes the correct header in the copy-paste snippets when auth is enabled. |

### Unauthorized responses

- Browser HTML routes → `307` redirect to `/login`
- `/api/*` → `401` JSON `{ "error": "Unauthorized. ..." }`
- `/mcp` → `401` JSON-RPC `{ "error": { "code": -32001, "message": "..." } }`

### MCP client config with password

When `SITE_PASSWORD` is set, your MCP client config should include a `headers` field. The dashboard's "MCP Integration Hub" tab generates these snippets automatically (with `<YOUR_SITE_PASSWORD>` as a placeholder you replace):

```json
{
  "mcpServers": {
    "social-media": {
      "url": "https://your-deployment.vercel.app/mcp",
      "transport": "http",
      "headers": {
        "x-site-password": "your-actual-password"
      }
    }
  }
}
```

---

## Adding kie.ai API keys

There are **two ways** to add kie.ai keys, and you can use both:

### Method 1: `KIE_API_KEY` env var (auto-seed — recommended for first deploy)

Set the `KIE_API_KEY` environment variable in Vercel (or in your `.env` file locally):

```
KIE_API_KEY=3d0ce8e2f67847701cd71604eeded488
```

**How it works:**
- On the first cold start (after deploy), `ensureSchema()` checks if this key already exists in the Turso `api_keys` table.
- If not found, it inserts it automatically with label `"Auto-seeded from KIE_API_KEY env"` and status `active`.
- If it already exists, it skips (idempotent — safe to redeploy).

**When to use this method:**
- First deploy — you want at least one key available without manual setup.
- You have a single primary key and don't need to rotate it often.

**Limitations:**
- Only one key per env var. If you change the env var value, the new key is seeded on the next cold start (the old key stays in the DB — you can disable/delete it from the dashboard).
- The env var value is visible in your Vercel dashboard (visible to anyone with project admin access — same as all env vars).

### Method 2: Dashboard "Keys" tab (recommended for adding more keys)

Once you're logged into the dashboard, go to the **"المفاتيح" (Keys)** tab:

1. Click **"إضافة مفتاح" (Add Key)**.
2. Select the provider (`kie` or `cometapi`).
3. Paste the API key (it's stored as-is in the Turso DB; displayed masked everywhere).
4. Add an optional label (e.g., `"Backup key #2"`).
5. Click **"حفظ المفتاح" (Save)**.

**How it works:**
- The key is stored in the `api_keys` table with `status = 'active'` and `created_at = now()`.
- The failover engine picks it up automatically on the next generation request.
- Keys are tried in strict `created_at ASC` order (oldest first).

**Managing keys from the dashboard:**
- **Enable/Disable**: Click the power icon to toggle a key between `active` and `disabled`. Disabled keys are excluded from the failover pool.
- **Delete**: Click the trash icon to permanently remove a key.
- **Status badges**: `active` (green), `exhausted` (amber — balance ran out, waiting for refill), `disabled` (red — manually turned off).
- **Usage stats**: Each key shows `success_count / usage_count` and `fail_count`.

**When to use this method:**
- You want to add multiple keys for failover.
- You want to rotate keys without redeploying.
- You want to monitor per-key usage stats.
- You want to temporarily disable a key without deleting it.

### Which method should I use?

| Scenario | Method |
| --- | --- |
| First deploy, just need one working key | `KIE_API_KEY` env var |
| Need failover with multiple keys | Both: env var for the first key, dashboard for the rest |
| Need to rotate a key without redeploying | Dashboard "Keys" tab |
| Want per-key usage stats | Dashboard "Keys" tab |
| Want to temporarily disable a key | Dashboard "Keys" tab |

**Both methods store keys in the same Turso `api_keys` table.** The failover engine treats them identically — it doesn't care whether a key came from the env var or the dashboard.

---

## Connect your AI agent

Use the dashboard's **MCP Integration Hub** tab to copy the right snippet for your client. Common pattern:

```json
{
  "mcpServers": {
    "social-media": {
      "url": "https://your-deployment.vercel.app/mcp",
      "transport": "http"
    }
  }
}
```

Then in any MCP-aware agent (Z.ai / GLM, Claude Desktop, Cursor, ChatGPT Connectors):

```
Call generate_image with prompt="…" social_platform="tiktok"
Call get_task with task_id="<returned id>"   # poll until status == "completed"
```

## API surface

| Route | Method | Purpose | Protected |
| --- | --- | --- | --- |
| `/login` | GET | Login page (HTML form) | No |
| `/api/auth/login` | POST | Login: `{ password }` → sets `site_auth` cookie | No |
| `/api/auth/logout` | POST | Clears the session cookie | No |
| `/mcp` | POST | MCP Streamable HTTP entry point | Yes (if `SITE_PASSWORD` set) |
| `/api/health` | GET | DB + merger health + auth status | Yes (if `SITE_PASSWORD` set) |
| `/api/keys` | GET / POST | list / add API keys | Yes (if `SITE_PASSWORD` set) |
| `/api/keys/[id]` | PATCH / DELETE | update status / delete | Yes (if `SITE_PASSWORD` set) |
| `/api/tasks?type=image\|video\|merge&limit=50` | GET | list tasks | Yes (if `SITE_PASSWORD` set) |
| `/api/tasks/[id]` | GET | fetch a task + advance progress | Yes (if `SITE_PASSWORD` set) |
| `/api/generate/image` | POST | create image task | Yes (if `SITE_PASSWORD` set) |
| `/api/generate/video` | POST | create video task | Yes (if `SITE_PASSWORD` set) |
| `/api/merge` | POST | create merge task | Yes (if `SITE_PASSWORD` set) |

## Failover classification

| Class | Trigger | Behavior |
| --- | --- | --- |
| `disabled` | HTTP 401 / 403, "invalid api key" | Mark key as `disabled`; switch to next |
| `exhausted` | HTTP 402, "balance/quota/credit" | Mark key as `exhausted`; switch to next |
| `provider` | "model not found / unsupported" | Skip to next key |
| `params` | HTTP 400 / 422 | Stop immediately (client error) |
| `temporary` | HTTP 429 / 5xx, timeout, network | Skip to next key; retry later |

If every key fails with non-permanent errors, the task stays in `processing` state and is retried automatically on the next `get_task` poll.

## Project structure

```
src/
├── middleware.ts                # Password protection (SITE_PASSWORD): cookie + header auth
├── app/
│   ├── layout.tsx              # Arabic RTL + dark mode + Cairo font
│   ├── page.tsx                # Dashboard (Health / Studio / Tasks / Keys / MCP Hub)
│   ├── login/page.tsx          # Login page (password form)
│   ├── globals.css             # Tailwind + custom utilities + Cairo font
│   ├── mcp/route.ts            # MCP Streamable HTTP endpoint (stateless)
│   └── api/
│       ├── auth/login/route.ts    # POST: verify password, set cookie
│       ├── auth/logout/route.ts   # POST: clear cookie
│       ├── health/route.ts        # GET: DB + merger + auth status
│       ├── keys/route.ts          # GET / POST: list / add API keys
│       ├── keys/[id]/route.ts     # PATCH / DELETE: update / delete key
│       ├── tasks/route.ts         # GET: list tasks
│       ├── tasks/[id]/route.ts    # GET: fetch + advance task
│       ├── generate/image/route.ts
│       ├── generate/video/route.ts
│       └── merge/route.ts
├── lib/
│   ├── turso.ts                # Schema, ensureSchema (auto-seeds KIE_API_KEY), ping, genId
│   ├── models.ts               # Model registry + social presets
│   ├── key-failover.ts         # Strict sequential failover engine
│   ├── tasks.ts                # Task lifecycle: create / advance / list
│   ├── merger.ts               # External merger microservice client
│   ├── api-client.ts           # Typed REST helper for the dashboard
│   └── providers/
│       └── kie.ts              # kie.ai image + video + poll handlers
└── components/
    └── theme-provider.tsx      # next-themes wrapper
scripts/
└── seed.ts                    # Manual key seeder (reads KIE_API_KEY env var)
vercel.json                    # Long-running route durations (60s for /mcp, /api/generate/*, /api/merge)
```

## License

MIT — use freely for commercial and personal projects.
