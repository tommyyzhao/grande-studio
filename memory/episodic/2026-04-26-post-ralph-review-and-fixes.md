# 2026-04-26: Post-Ralph Review, Critical Fixes, and MiniMax Integration

## Session Summary

Ralph completed all 64 user stories for V1 Minimax Web Studio. This session reviewed the output, identified critical gaps, and fixed the most important ones. The app now loads in the browser and the MiniMax API is verified working.

## Key Decisions Made

### Architecture: Inngest over Cloudflare Queue (Option C)
- **Decision**: Replace Cloudflare Queue + Cron with Inngest for background job processing
- **Reason**: Cloudflare Pages only supports `fetch` handler. Queue consumers and Cron Triggers require Workers mode. Inngest sidesteps this entirely — it calls HTTP endpoints on the Pages app webhook-style, so no separate Worker deployment is needed.
- **Status**: IMPLEMENTED in 2026-04-27 session. See `memory/episodic/2026-04-27-inngest-migration-and-local-dev.md`.
- **Impact**: Remove Queue/Cron config from wrangler.jsonc, add Inngest client + serve endpoint, convert generation workflow to Inngest function, convert quota expiry cron to Inngest scheduled function.

### MiniMax API: Correct Endpoint and Model
- **Old (wrong)**: `https://api.minimaxi.chat/v1/music_generation`, model `music-01`
- **New (correct)**: `https://api.minimax.io/v1/music_generation`, model `music-2.6`
- **Cover model**: `music-cover` (not same model with different params)
- **Parameter fixes**: `lyrics_optimization` → `lyrics_optimizer`, `refer_voice` → `audio_url`
- **Streaming**: Single POST with `stream: true` in payload, returns SSE. NOT a separate GET with task_id.
- **Verified**: Non-streaming (162s, 5.6MB MP3) and streaming (25 chunks, 146s, 11.3MB) both tested with real API key.
- **Audio format**: Always MP3 with ID3 tag header (0x49 0x44 0x33)

### Database: Local Postgres for Dev
- Local Postgres is the dev target, Neon is production only
- Database `grande_studio` exists with all 12 tables (8 app + 4 BetterAuth)
- RLS is defined in migrations but NOT actually enabled on tables (relrowsecurity=false)

## Bugs Found and Fixed

### 1. Build failure: $env/static/private in auth.ts
- **Root cause**: BetterAuth initialized at module level using `$env/static/private` which requires env vars at build time
- **Fix**: Converted to lazy `getAuth(dbUrl, secret)` factory function cached in module scope
- **File**: `src/lib/server/auth.ts`

### 2. process.env won't work on Cloudflare Workers
- **Root cause**: 13 files used `process.env.DATABASE_URL` etc. Cloudflare Workers use `platform.env`
- **Fix**: Created `src/lib/server/env.ts` with `getEnv(event)` helper. All routes now use it. Falls back to process.env for local dev.
- **Files**: All route files in `src/routes/api/**`, `src/routes/+page.server.ts`

### 3. Signed URL route missing (/api/audio/serve)
- **Root cause**: `r2-storage.ts` generates URLs to `/api/audio/serve?key=...` but route didn't exist
- **Fix**: Created `src/routes/api/audio/serve/+server.ts` — verifies HMAC signature, fetches from R2, streams back
- **File**: New route created

### 4. SET LOCAL can't be parameterized
- **Root cause**: Drizzle's `sql` template sends `SET LOCAL app.user_id = $1` as prepared statement, but Postgres doesn't allow parameterized SET
- **Fix**: Use `sql.raw()` with sanitized userId (stripped to alphanumeric + hyphens)
- **File**: `src/lib/server/db/rls.ts`

### 5. SSR crashes: browser-only APIs called during server rendering
- **EventSource** in `src/lib/stores/sse.svelte.ts` — added `typeof EventSource === 'undefined'` guard
- **requestAnimationFrame** in `src/lib/components/transport-bar.svelte` — added `typeof requestAnimationFrame !== 'undefined'` guard

### 6. MiniMax adapter completely wrong
- Rewrote `src/lib/providers/minimax/adapter.ts` with correct endpoint, model, params, streaming
- Updated `src/lib/providers/types.ts` — `streamGenerationAudio` now takes `(input, handle?)` instead of `(handle)`
- Updated `src/lib/server/workflow/generation-workflow.ts` to call streaming directly with input
- Updated all adapter tests to match new API

## What's Working Now

- **Build**: `npm run build` passes (Cloudflare Pages adapter)
- **Typecheck**: 0 errors, 0 warnings
- **Tests**: 443 passed, 0 failures
- **Browser**: App loads at localhost, renders full workspace UI
- **MiniMax API**: Real key works, both streaming and non-streaming verified
- **Auth**: BetterAuth configured with email/password, lazy initialization
- **DB**: Local Postgres with all tables, RLS module working

## What's NOT Working / Not Done

### Critical for Staging
1. **Inngest integration** (replaces Queue/Cron) — NEXT SESSION
2. **Cloudflare resources not provisioned** (R2 bucket, KV namespace)
3. **Neon production DB** not set up
4. **RLS not actually enabled** on Postgres tables (migrations define policies but `ALTER TABLE ENABLE ROW LEVEL SECURITY` may not have run)
5. **Production env vars** not configured in Cloudflare dashboard
6. **Worker entry point** created but won't be needed after Inngest migration

### Testing Gaps
7. **Zero E2E/Playwright tests** — PRD specifies 25 test files, none exist
8. **No browser smoke test of generation flow** — UI renders but haven't tested actual Generate → MiniMax → audio playback
9. **No real integration test through the full stack** (endpoint → queue → workflow → R2 → playback)

### Known Issues
10. **BetterAuth warning**: "Base URL could not be determined" on dev server start (BETTER_AUTH_URL in .env but not picked up by lazy init at startup)
11. **RLS policies may need re-running** — tables exist but RLS enforcement is off
12. **Temp project cleanup** — temp sessions create real DB rows that are never cleaned up

## File Structure Changes This Session

### New Files
- `src/lib/server/env.ts` — centralized env helper
- `src/routes/api/audio/serve/+server.ts` — signed URL audio serving
- `worker-entry.ts` — Cloudflare Worker entry (will be removed after Inngest migration)
- `scripts/test-minimax-integration.ts` — real API integration test
- `memory/episodic/2026-04-26-post-ralph-review-and-fixes.md` — this file

### Modified Files (key changes)
- `src/lib/server/auth.ts` — lazy init
- `src/lib/server/db/rls.ts` — raw SQL for SET LOCAL
- `src/lib/providers/minimax/adapter.ts` — complete rewrite for correct API
- `src/lib/providers/minimax/adapter.test.ts` — updated for new API
- `src/lib/providers/types.ts` — streamGenerationAudio signature change
- `src/lib/server/workflow/generation-workflow.ts` — direct streaming call
- `src/lib/stores/sse.svelte.ts` — SSR guard
- `src/lib/components/transport-bar.svelte` — SSR guard
- `src/hooks.server.ts` — lazy auth, platform.env
- `src/app.d.ts` — Platform.env types
- All `src/routes/api/**` — getEnv(event) migration

## Environment

- **Dev server port**: varies (5173 often in use by other projects)
- **Local Postgres DB**: `grande_studio` at `localhost:5432`
- **MINIMAX_API_KEY**: Set in `.env`, verified working
- **BETTER_AUTH_SECRET**: Auto-generated in `.env`
- **Git branch**: `ralph/v1-minimax-web-studio`
- **Total commits**: 85 (from Ralph) + uncommitted fixes from this session
