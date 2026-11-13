# MCP Media Generator & Social Media Automation Engine

Production-grade MCP (Model Context Protocol) server + Arabic RTL web dashboard for AI image / video generation and multi-platform social media content automation.

> **Stack**: Next.js 16 (App Router) • TypeScript • Tailwind CSS 4 • shadcn/ui • Turso (libsql) • `@modelcontextprotocol/sdk` • kie.ai

---

## Highlights

- **MCP Server** at `/mcp` (Streamable HTTP) exposing **5 powerful tools**:
  - `generate_image` — high-res social graphics, thumbnails, ad banners
  - `generate_video` — viral clips with native audio for Reels / TikToks / Shorts
  - `merge_videos` — concatenate up to 10 clips into one MP4
  - `get_task` — poll any task with live status + result URLs
  - `list_media` — recall previously generated assets from the DB
- **Strict sequential API key failover engine**: keys are tried in `created_at ASC` order; on `disabled`/`exhausted`/`temporary` errors the engine silently switches to the next key; on `params` (HTTP 400/422) it stops immediately. AI agents **never** see API key or balance errors.
- **Zero local media storage**: only URLs + metadata are persisted to Turso.
- **Asynchronous task queue**: long-running generations return a `task_id` immediately; `get_task` advances the task by polling the provider on every call.
- **Arabic RTL dark-mode dashboard** with:
  - API key manager (masked, status badges, usage stats)
  - Live task monitor (auto-refresh, progress bars, click-to-expand detail dialog)
  - Generation studio (try image / video / merge from the UI)
  - MCP integration hub (one-click copy snippets for Z.ai / GLM, Claude Desktop, Cursor, ChatGPT)
  - Health check (`/api/health`) verifying Turso + merger reachability
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
# - MERGER_BASE_URL (external merger microservice URL, optional)

# 3. Run the dev server
bun run dev   # http://localhost:3000

# 4. Seed your first kie.ai API key (or add it via the dashboard UI)
bun run scripts/seed.ts
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel.
3. Set the following environment variables in the Vercel dashboard:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `KIE_BASE_URL`
   - `MERGER_BASE_URL`
4. Deploy. Vercel auto-detects Next.js 16; `vercel.json` already bumps long-running routes (`/mcp`, `/api/generate/*`, `/api/merge`, `/api/tasks/[id]`) to 60s max duration.

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

| Route | Method | Purpose |
| --- | --- | --- |
| `/mcp` | POST | MCP Streamable HTTP entry point |
| `/api/health` | GET | DB + merger health |
| `/api/keys` | GET / POST | list / add API keys |
| `/api/keys/[id]` | PATCH / DELETE | update status / delete |
| `/api/tasks?type=image\|video\|merge&limit=50` | GET | list tasks |
| `/api/tasks/[id]` | GET | fetch a task + advance progress |
| `/api/generate/image` | POST | create image task |
| `/api/generate/video` | POST | create video task |
| `/api/merge` | POST | create merge task |

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
├── app/
│   ├── layout.tsx              # Arabic RTL + dark mode + Cairo font
│   ├── page.tsx                # Dashboard (Health / Studio / Tasks / Keys / MCP Hub)
│   ├── globals.css             # Tailwind + custom utilities + Cairo font
│   ├── mcp/route.ts            # MCP Streamable HTTP endpoint (stateless)
│   └── api/
│       ├── health/route.ts
│       ├── keys/route.ts
│       ├── keys/[id]/route.ts
│       ├── tasks/route.ts
│       ├── tasks/[id]/route.ts
│       ├── generate/image/route.ts
│       ├── generate/video/route.ts
│       └── merge/route.ts
├── lib/
│   ├── turso.ts                # Schema, ensureSchema, ping, genId
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
└── seed.ts                    # First-key seeder
vercel.json                    # Long-running route durations
```

## License

MIT — use freely for commercial and personal projects.
