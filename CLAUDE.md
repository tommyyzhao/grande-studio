# Grande Studio — Agent Bootstrap

V1 MiniMax Web Studio: SvelteKit app that turns text prompts into music via the
MiniMax API. Cloudflare Pages target; local dev is fully self-contained.

## Read first (in this order)

1. The newest file in `memory/episodic/` — current session context, open bugs,
   what's just landed. Always read before touching code.
2. `prd.json` — product spec.
3. The relevant skill pack in `.claude/skills/` for whatever you're touching
   (svelte, drizzle, inngest, better-auth, neon, cloudflare, playwright, etc.).
   These are the canonical references; prefer them over web search.

## Stack

SvelteKit 2 / Svelte 5 (runes) · Tailwind v4 · TypeScript · Drizzle ORM ·
Postgres (Neon in prod, local in dev) · BetterAuth · Inngest (workflows + cron) ·
Cloudflare Pages adapter + R2 (filesystem fallback in dev) · MiniMax music API.

## Run locally

Two terminals — both required.

```bash
# Terminal 1: Inngest dev server (port 8299; 8289 conflicts with another project)
npx inngest-cli@latest dev -p 8299 --no-discovery -u http://localhost:5183/api/inngest

# Terminal 2: Vite. INNGEST_* must be shell env vars — process.env is not populated
# from .env in the Vite SSR context, but the Inngest client reads them directly.
INNGEST_DEV=1 INNGEST_BASE_URL=http://localhost:8299 npx vite dev --port 5183
```

App: `http://localhost:5183` · Inngest UI: `http://localhost:8299`.

`.env` requires: `DATABASE_URL`, `MINIMAX_API_KEY`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL=http://localhost:5183`, `R2_BUCKET_NAME`, `R2_SIGNING_SECRET`
(any non-empty for dev), `INNGEST_DEV=1`, `INNGEST_BASE_URL=http://localhost:8299`.
Cloudflare creds only needed for prod.

## Quality gates

`npm run check` (svelte-check, must be 0 errors) and `npm test` (vitest, 443+
must pass) before claiming a task done. Currently green.

## Browser/UI testing

Two browser MCPs are installed:

- **Prefer `mcp__playwright__*`** for automated UI validation. Each session gets
  its own isolated in-memory profile (`--isolated`) so parallel agents don't
  collide. Snapshots/console logs land in `.playwright-mcp/` (gitignored).
- `mcp__claude-in-chrome__*` only when a real logged-in human profile is needed.
  Single-session — don't run it from multiple parallel agents.

For non-trivial test work, load the `playwright-best-practices` skill first.

## Memory convention

`memory/episodic/YYYY-MM-DD-<topic>.md` is the running log of notable sessions:
what was changed, what broke, hypotheses, and key learnings. **Append a new
entry at the end of any session that ships meaningful changes or surfaces
non-obvious findings.** This is the handoff channel between sessions.

## Foot-guns (do not relearn these)

- **BetterAuth user IDs are 32-char text, not UUIDs.** Any `owner_id` column
  declared `uuid` 500s the moment a real user signs up. Open issue: C1 in
  the latest browser-ux-review memo.
- **`withRLS()` is a no-op without RLS policies.** It only sets a GUC; if
  `relrowsecurity = false`, protection collapses to whatever `WHERE owner_id`
  filters the query happens to include. Open issue: C2.
- **`process.env` is not populated in Vite SSR.** Use `$env/dynamic/private`
  in SvelteKit code. Inngest functions need `getWorkflowEnv()` passed
  explicitly into handlers (including scheduled/cron handlers).
- **MiniMax sometimes returns `application/json` instead of `text/event-stream`.**
  The adapter handles both; don't assume SSE-only.
- **Sign-out mints a fresh `temp_session_id`.** Assets created pre-signout
  become unreachable for the new cookie owner. Be aware when testing.
- **Generation workflow is a single function invocation, not stepped.**
  MiniMax streaming exceeds Inngest's per-step ~10s timeout. Function-level
  retries (3) still apply. Quota expiry is fast and uses `step.run`.
- **Cloudflare Workers reject I/O across requests.** Never cache a DB
  connection / fetch / stream / auth instance at module scope — Workers
  throw "Cannot perform I/O on behalf of a different request" the moment
  a second request reuses it. Build per-request (e.g. `getAuth(...)` returns
  a fresh BetterAuth each call).
- **`node-postgres` does not run in Workers** (no TCP sockets). Anything
  hitting Postgres in production must use `@neondatabase/serverless` —
  pattern: `dbUrl.includes('neon.tech') ? createNeonDb : createLocalDb`.
- **Inngest function bodies don't see `platform.env`.** Bindings (R2/KV)
  must be plumbed in via `inngestEnvContext.run(env, …)` from
  `src/routes/api/inngest/+server.ts`. Functions read with `getInngestEnv()`.
  Requires `nodejs_compat` for `AsyncLocalStorage`.
- **Cloudflare Workers expose `EventSource` globally.** A plain
  `typeof EventSource === 'undefined'` SSR guard fires only in Node, not in
  the Workers runtime. Use `typeof window === 'undefined'` for the real
  browser-only check.
- **Cloudflare Pages adapter injects an empty Miniflare R2 binding in
  dev** that shadows the local-filesystem fallback. `getEnv()` forces
  `createLocalR2Bucket()` when `INNGEST_DEV=1` so writes (Inngest workflow)
  and reads (`/api/audio/serve`) hit the same store.
- **Inngest cloud needs a one-time sync per deploy** (`curl -X PUT
  https://<host>/api/inngest`). Without it the dashboard never learns
  the function manifest and events sit unprocessed.
- **`/api/inngest` and `/api/events` both run on the standalone Worker**
  in production, not Pages. Pages Functions silently kill long-running
  requests around 180 s wall with `outcome=exceededCpu`, which is below
  the 1-3 min MiniMax generation needs and far below SSE's
  open-indefinitely model. The Worker (`grande-studio-inngest`) is
  configured via `wrangler.worker.toml` and respects `[limits] cpu_ms`.
  The Pages `+server.ts` files for both routes are kept for local dev
  only and 410 in production. Inngest cloud's app URL is
  `https://grande-studio-inngest.tzpersonal.workers.dev/api/inngest`;
  the SSE URL is the same host's `/api/events` (cookies can't cross
  from `grande-studio.pages.dev`, so the client mints a short-lived
  HMAC token via `/api/events/token` on Pages first). CI deploys both
  and syncs the Worker URL.

## Production deploy quickref

`wrangler.jsonc` is the source of truth for bindings (`AUDIO_BUCKET` →
R2 bucket `grande-studio-audio`, `LIVE_KV` → KV namespace
`42abaef07d9e4490ac8368639128e3d0`) and `nodejs_compat`. Secrets live on
the Pages project (set via `wrangler pages secret put`):

```
DATABASE_URL          MINIMAX_API_KEY       BETTER_AUTH_SECRET
BETTER_AUTH_URL       R2_BUCKET_NAME        R2_SIGNING_SECRET
INNGEST_EVENT_KEY     INNGEST_SIGNING_KEY
```

The standalone Inngest Worker (`grande-studio-inngest`) is configured by
`wrangler.worker.toml`; its secrets are independent of Pages and are set
via `wrangler secret put NAME --config wrangler.worker.toml` (or
`wrangler secret bulk file.json --config wrangler.worker.toml`):

```
DATABASE_URL          MINIMAX_API_KEY      R2_SIGNING_SECRET
INNGEST_EVENT_KEY     INNGEST_SIGNING_KEY  EVENTS_TOKEN_SECRET
```

`EVENTS_TOKEN_SECRET` must be **identical** on Pages and Worker — Pages
mints `/api/events` access tokens with it and the Worker verifies them.
Provision both with the same value (one `wrangler pages secret put` and
one `wrangler secret put --config wrangler.worker.toml`). Keep it
distinct from `R2_SIGNING_SECRET` so audio URL signing rotates separately.

`BETTER_AUTH_URL` lives as a non-secret `[vars]` entry in
`wrangler.worker.toml`. R2 bucket and KV namespace bindings point at the
same resources Pages uses.

Deploy (CI does this on push to main; commands below for ad-hoc runs):

```bash
npm run build
npx wrangler pages deploy .svelte-kit/cloudflare --project-name grande-studio --branch main --commit-dirty=true
npx wrangler deploy --config wrangler.worker.toml                          # standalone Inngest Worker
curl -X PUT https://grande-studio-inngest.tzpersonal.workers.dev/api/inngest   # sync at WORKER URL
```

Live at https://grande-studio.pages.dev. Inngest Worker at
https://grande-studio-inngest.tzpersonal.workers.dev. Neon prod DB:
`empty-wind-58284971` in org `tommy@meshi.io` (region `aws-us-west-2`).

## Layout

```
src/
  routes/                  SvelteKit routes (+page, +server, +error, api/…)
  lib/
    server/
      auth.ts              BetterAuth wiring (baseURL is required)
      env.ts               getEnv() — local R2 fallback for dev
      local-r2.ts          Filesystem-backed R2BucketLike
      inngest/             client + functions (process-generation, expire-stale-quotas)
      workflow/            generation-workflow.ts is the MiniMax driver
      db/                  drizzle schema + migrations
    providers/minimax/     SSE + JSON adapter
worker/
  inngest-worker.ts        standalone CF Worker entrypoint for /api/inngest
drizzle/                   generated migrations
memory/episodic/           session logs (read latest first)
.claude/skills/            tech-specific reference docs
wrangler.jsonc             Pages project config
wrangler.worker.toml       standalone Inngest Worker config
```

## Branch & deploy

Working branch: `ralph/v1-minimax-web-studio`. Main: `main`. Do not push to
remotes or open PRs without explicit user request. Cloudflare Pages prod is
not yet provisioned (R2/KV/Neon prod/Inngest keys all pending).
