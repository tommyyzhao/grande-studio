# 2026-04-27: Inngest Migration and Local Dev Readiness

## Session Summary

Replaced Cloudflare Queue + Cron Triggers with Inngest for background job processing. Debugged and resolved multiple integration issues to get the full generation pipeline working end-to-end locally: POST /api/generate → Inngest event → MiniMax streaming (30 chunks, ~2 min) → local filesystem R2 → DB succeeded/ready → 14MB valid MP3. Also made all audio-serving HTTP routes work locally by providing a filesystem-backed R2 bucket fallback in `getEnv()`.

## Key Decisions Made

### Inngest Architecture (Implemented)
- **inngest/sveltekit adapter** exists (was not in the skill docs) — returns `{ GET, POST, PUT }` matching SvelteKit's `+server.ts` pattern exactly
- **No step.run() for generation workflow** — MiniMax streaming takes 2-3 minutes, which exceeds Inngest's per-step execution timeout (~10s, `timeoutDuration = 1e3 * 10` in engine.js). The workflow runs as a single function invocation. Inngest still provides function-level retries (3 retries configured).
- **Quota expiry uses step.run()** — it's fast (sub-second), so step memoization is fine there
- **Inngest dev server port: 8299** — port 8289 is used by another project on this machine. Set via `INNGEST_BASE_URL=http://localhost:8299` in `.env`

### Local R2 Strategy
- Created `src/lib/server/local-r2.ts` — implements `R2BucketLike` interface using `node:fs` against `.local-r2/` directory
- **`getEnv()` always returns a bucket** — Cloudflare R2 binding in production, `createLocalR2Bucket()` in dev. Changed `AUDIO_BUCKET` from optional to required in `AppEnv`.
- All routes that touch audio (serve, download, upload, generation) now work identically in both environments
- `.local-r2/` added to `.gitignore`

### SvelteKit Env Vars in Inngest Context
- `process.env` is NOT populated from `.env` in SvelteKit's Vite SSR context
- Inngest functions use `$env/dynamic/private` (SvelteKit's env module) to access env vars
- The Inngest client reads `process.env.INNGEST_DEV` and `process.env.INNGEST_BASE_URL` directly — these must be passed as shell env vars when starting Vite: `INNGEST_DEV=1 INNGEST_BASE_URL=http://localhost:8299 npx vite dev`

## Bugs Found and Fixed

### 1. MiniMax non-SSE response fallback
- **Discovery**: MiniMax sometimes returns `text/plain` JSON instead of `text/event-stream` SSE
- **Root cause**: API behavior variation — returns HTTP 200 with JSON body containing error or full audio data instead of streaming
- **Fix**: Added fallback in `streamGenerationAudio` that detects non-SSE content-type, parses JSON body, handles both error responses (status_code != 0) and full audio data
- **File**: `src/lib/providers/minimax/adapter.ts`

### 2. Instrumental mode routing bug (pre-existing)
- **Discovery**: MiniMax returned `status_code: 2013, "lyrics is required"` for instrumental requests
- **Root cause**: Generation workflow created instrumental input as `{ prompt, structureTags }` without `instrumental: true`. The adapter's `streamGenerationAudio` uses `'instrumental' in input && input.instrumental` to detect mode — without the field, it fell through to text-to-music payload with `is_instrumental: false`, which requires lyrics.
- **Fix**: Added `instrumental: true` to the instrumental case in `generation-workflow.ts`
- **File**: `src/lib/server/workflow/generation-workflow.ts` line 316

### 3. process.env not available in Vite SSR for Inngest functions
- **Discovery**: `MINIMAX_API_KEY is required` error when Inngest executed the function
- **Root cause**: `buildWorkflowDeps()` in queue-handler.ts falls back to `process.env`, but Vite SSR doesn't populate process.env from .env files
- **Fix**: Inngest functions use `$env/dynamic/private` and construct `WorkflowEnv` explicitly
- **File**: `src/lib/server/inngest/functions.ts`

### 4. Audio routes returned 503 locally
- **Discovery**: All audio-serving routes (`/api/audio/[assetId]`, `/api/audio/serve`, `/api/download/[assetId]`) checked for `AUDIO_BUCKET` binding and returned 503 when undefined
- **Root cause**: `getEnv()` only returned the Cloudflare R2 binding, with no fallback
- **Fix**: `getEnv()` now returns `createLocalR2Bucket()` when no Cloudflare binding exists
- **File**: `src/lib/server/env.ts`

## File Changes This Session

### New Files
- `src/lib/server/inngest/client.ts` — Inngest client (id: "grande-studio", dev mode auto-detection)
- `src/lib/server/inngest/functions.ts` — Two functions: process-generation (event), expire-stale-quotas (cron)
- `src/routes/api/inngest/+server.ts` — SvelteKit serve endpoint via inngest/sveltekit adapter
- `src/lib/server/local-r2.ts` — Filesystem R2BucketLike for local dev
- `memory/episodic/2026-04-27-inngest-migration-and-local-dev.md` — This file

### Modified Files
- `src/routes/api/generate/+server.ts` — `queue.send()` → `inngest.send({ name: 'generation/requested', ... })`
- `src/lib/server/env.ts` — Removed GENERATION_QUEUE, AUDIO_BUCKET now always defined (local R2 fallback)
- `src/app.d.ts` — Removed GENERATION_QUEUE and QueueLike from Platform.env
- `src/lib/providers/minimax/adapter.ts` — Non-SSE response fallback for streaming
- `src/lib/server/workflow/generation-workflow.ts` — Instrumental mode fix (added `instrumental: true`)
- `wrangler.jsonc` — Removed `triggers.crons` and `queues` sections
- `.env` / `.env.example` — Added INNGEST_DEV, INNGEST_BASE_URL
- `.gitignore` — Added `.local-r2`
- `package.json` / `package-lock.json` — Added `inngest` dependency

### Deleted Files
- `worker-entry.ts` — Dead code, was never wired into the build

## What's Working Now

- **Build**: `npm run build` passes (Cloudflare Pages adapter)
- **Typecheck**: 0 errors, 0 warnings
- **Tests**: 443 passed, 0 failures
- **Generation pipeline E2E**: POST → Inngest → MiniMax streaming (30 chunks) → local R2 (14MB MP3) → DB succeeded + asset ready
- **Audio serving routes**: All use local filesystem R2 in dev
- **Inngest functions registered**: process-generation (event trigger), expire-stale-quotas (*/5 * * * * cron)
- **MiniMax API**: Verified working with real key, both streaming and non-streaming

## What's NOT Done / Known Gaps

### Local UX Gaps (Next Session — Browser Testing)
1. **No browser smoke test yet** — UI renders but no one has tested the full user flow in Chrome (create project → generate → see status update → play audio)
2. **Live-listening disabled locally** — `LIVE_KV` is undefined, so real-time audio preview during generation is silently skipped. User sees status updates but doesn't hear audio until generation completes. Not critical.
3. **SSE/polling for job status** — need to verify the client actually picks up status transitions and shows the asset as ready when generation completes
4. **`providerModel: 'music-01'` hardcoded** in generate endpoint (line 143, 152) — should be `'music-2.6'`. Cosmetic DB column issue only.

### Production / Deployment Gaps
5. **Cloudflare R2 bucket** not provisioned
6. **Cloudflare KV namespace** not provisioned
7. **Neon production DB** not set up, migrations not run
8. **RLS not enabled** on Postgres tables (`ALTER TABLE ENABLE ROW LEVEL SECURITY` never ran)
9. **Production env vars** not configured in Cloudflare dashboard
10. **Inngest production setup** — need INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY
11. **E2E/Playwright tests** — PRD specifies 25 test files, 0 exist

## How to Run Locally

```bash
# Terminal 1: Inngest dev server
npx inngest-cli@latest dev -p 8299 --no-discovery -u http://localhost:5183/api/inngest

# Terminal 2: SvelteKit dev server
INNGEST_DEV=1 INNGEST_BASE_URL=http://localhost:8299 npx vite dev --port 5183

# Inngest dashboard: http://localhost:8299
# App: http://localhost:5183
```

## Environment
- **Git branch**: `ralph/v1-minimax-web-studio`
- **Local Postgres DB**: `grande_studio` at `localhost:5432`
- **Inngest dev port**: 8299 (8289 used by another project)
- **Vite dev port**: 5183 (5173 often in use)
- **Node.js**: uses native fetch for MiniMax streaming
- **inngest package**: v4.x (uses createFunction with triggers in options object, not 3-arg form)
