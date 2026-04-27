# 2026-04-27 — V1 Production Deploy + Long-Running Worker Decision

Brought the app live at `https://grande-studio.pages.dev`. Sign-up,
sign-in, workspace, audio serve are all working in production. Generation
hits a Cloudflare-Pages execution ceiling and that's the open architectural
question for next session.

## Critical fixes this session

### C1 — `owner_id` uuid → text on 8 tables (committed `5a9630d`)

BetterAuth user IDs are 32-char alphanumeric strings, not UUIDs. The whole
schema previously assumed `owner_id uuid`. Fix: migrate the eight
owner-scoped tables (`projects`, `audio_assets`, `generation_jobs`,
`arrangement_clips`, `take_edges`, `quota_reservations`, `export_jobs`,
`provider_events`) to `text`. Existing UUID values stayed valid as text,
no data conversion.

### C2 — RLS enabled with text policies (rolled into C1 commit)

`relrowsecurity` was `false` on every business table, even though
`withRLS()` was setting `app.user_id`. Edited
`drizzle/0003_rls_ownership_policies.sql` to cast `app.user_id::text` and
ran it via `psql` against both local and Neon prod. RLS now enforces
ownership across all eight tables.

### C3 — Dev R2 split-brain (committed `1d89418`)

The Cloudflare Pages adapter injects an empty Miniflare R2 binding into
`event.platform.env.AUDIO_BUCKET` during dev. `getEnv()` was preferring
that over `createLocalR2Bucket()`. Inngest writes went to the local
filesystem; SvelteKit reads went to the empty Miniflare binding → 404.
Fixed by forcing `createLocalR2Bucket()` whenever `INNGEST_DEV=1`.

### Friendlier 500 page (committed `6a280fd`)

Added `src/routes/+error.svelte` with header, message, and Back/Reload
buttons. Replaces the bare `500 Internal Error` SvelteKit default.

## Production stack provisioned

| Component | Identifier |
|---|---|
| Pages project | `grande-studio` (TZPERSONAL account) |
| R2 bucket | `grande-studio-audio` (already existed) |
| KV namespace | `42abaef07d9e4490ac8368639128e3d0` (created this session) |
| Neon project | `MeshiNeon` (`empty-wind-58284971`), region `aws-us-west-2` |
| Neon DB | `neondb` — schema pushed via `drizzle-kit push`, RLS migrated |
| Inngest cloud app | id `grande-studio`, synced via `PUT /api/inngest` |
| Custom URL | `https://grande-studio.pages.dev` |

R2 S3 access keys have been minted (saved to local `.env`, gitignored).
For the Inngest sidecar work next session.

## Production-only fixes

These would never have shown up in dev — they're CF Workers / Pages
Functions specific.

- `nodejs_compat` flag on. Required for `AsyncLocalStorage`.
- `inngestEnvContext` (AsyncLocalStorage) plumbs platform.env into
  Inngest function bodies. Functions previously hardcoded
  `createLocalR2Bucket()` which has no equivalent in CF runtime.
- BetterAuth instance now built per-request. The previous module-scope
  cache (`let _auth`) tied a DB connection to whichever request constructed
  it; CF rejects subsequent requests with "Cannot perform I/O on behalf of
  a different request."
- `auth.ts` switched from `node-postgres` (which can't run in Workers, no
  TCP sockets) to `@neondatabase/serverless` when the URL includes
  `neon.tech`. Same conditional pattern already in `env.ts` and the
  workflow handlers.
- `EventSource` SSR guard fixed. Workers expose `EventSource` globally,
  so `typeof EventSource === 'undefined'` only fires in Node SSR — Workers
  fell through and tried to construct one with the relative URL
  `/api/events`, which throws "URL is invalid" and 500'd the workspace.
  Use `typeof window === 'undefined'` instead.

## CI/CD

`.github/workflows/deploy.yml` deploys on push to `main` or
`ralph/v1-minimax-web-studio`. Runs typecheck → vitest → build → wrangler
pages deploy → Inngest manifest sync. Repo secrets `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` are set. First run at `25021240084` was green
(1m14s).

## Stuck-row reaper (`bed584e`)

When the Inngest function dies mid-stream, asset rows previously stayed
in `receiving_audio` forever (the workflow's own catch blocks never run).
Extended the existing 5-min cron to flip rows in
`(generating, receiving_audio, persisting)` older than 10 min to `failed`
with `errorCode='WORKER_TIMEOUT'`. Quota releases on the same cron pass
via the existing `expireStaleReservations`.

## UX wins (`13dd007`, `f4fc950`)

- Sign-up / sign-in now use `window.location.assign('/')` instead of
  `goto('/')`. `goto` is a soft SPA nav that reused the layout context;
  the freshly-set BetterAuth cookie wasn't visible on the first paint,
  so a fresh sign-up still saw a "Sign in" button until refresh.
- Generate form preserves prompt + instrumental toggle on submit (M3).

## Open: long-running generation in production (task #13)

This is the v1.1 architectural question.

**Symptom:** Inngest function runs ~180 s wall / ~2 s CPU, then dies with
`outcome=exceededCpu`. MiniMax music generation needs 1-3 min of held
HTTP connection. CF Pages Functions do not honor `[limits] cpu_ms` from
wrangler config — the platform's own ceiling kicks in.

**User constraint:** prefer to stay on CF Pages + Inngest, no third
platform if avoidable.

**Options to evaluate next session:**

1. **Standalone Cloudflare Worker (not Pages)** for `/api/inngest`.
   Standalone Workers respect `[limits] cpu_ms = 300000` (5 min) on
   Workers Paid. Would route Inngest webhook to
   `grande-studio-inngest.<account>.workers.dev/api/inngest` and keep
   Pages serving everything else. Effort: ~1-2 h. Stays on Cloudflare,
   keeps Inngest. **Most aligned with user constraint.**
2. **Cloudflare Workflows** (durable execution product). Refactor
   Inngest functions to CF's native long-running primitive. Effort:
   ~4 h. Stays on CF, removes Inngest entirely.
3. **Inngest Connect** — long-lived worker process that connects via
   WebSocket to Inngest cloud. Paid Inngest feature, requires somewhere
   to run the long-lived process (CF doesn't host that).
4. **Fly.io sidecar.** Already scoped, has R2 keys. But adds a third
   platform — last resort per user direction.

**Recommended starting point: option 1 (standalone Worker).** Quickest
to validate, smallest blast radius, no platform drift.

## Other lower-priority follow-ups

- Task #14 (stuck-row recovery) — done via the cron reaper.
- Task #12 (post-signup `data.user` undefined) — fixed via hard nav.
- `/api/events` SSE 500s on CF (long-poll exceeds wall budget). Browser
  reconnects with backoff; status updates land on page refresh. Same
  architectural class as #13 — fixes itself if generation moves to a
  long-running runtime.
- Original handoff items still open: M4 (empty-state a11y leak — likely
  already fixed, didn't see it in latest snapshots), M5 (cover-mode file
  input styling), L1-L3 (cosmetic).
- E2E/Playwright test files (PRD says 25, currently 0) — hold for
  post-v1.1 once architecture is settled.

## Branch state

`ralph/v1-minimax-web-studio` is **17 commits** ahead of `49bf053`,
pushed to `origin`, CI green. Ready for either a PR to `main` (after
v1.1 architecture is decided) or for next-session continuation.
