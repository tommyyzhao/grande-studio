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
drizzle/                   generated migrations
memory/episodic/           session logs (read latest first)
.claude/skills/            tech-specific reference docs
```

## Branch & deploy

Working branch: `ralph/v1-minimax-web-studio`. Main: `main`. Do not push to
remotes or open PRs without explicit user request. Cloudflare Pages prod is
not yet provisioned (R2/KV/Neon prod/Inngest keys all pending).
