# 2026-04-27 — Browser UX/UX Review

First end-to-end browser test of the V1 Minimax Web Studio after the Inngest
migration session. Used Chrome via MCP browser tools against `localhost:5183`
(vite) + `localhost:8299` (inngest dev server). All findings below were
observed in a real browser, not inferred from code.

## TL;DR

The app renders cleanly and the generation pipeline works end-to-end (verified
via Inngest dashboard + workflow logs). However, several critical bugs make
the app effectively unusable for an authenticated user, and audio playback
is broken even for the temp-session happy path. **None of these block local
generation, but all block production deployment.**

## Critical (deployment-blocking)

### C1. `projects.owner_id` type mismatch with BetterAuth user IDs

- **What**: `projects.owner_id` (and almost every other table referencing
  user IDs) is declared `uuid`. BetterAuth generates 32-char alphanumeric
  IDs (`Hx9DvNgWL2RlcmjDJYji2jJXQOYGjHiR`), not UUIDs.
- **Symptom**: Sign-up succeeds (creates row in `user`), then immediately
  redirects to `/`, where `+page.server.ts:128` throws when running
  `select * from projects where owner_id = $1` with the BetterAuth ID.
  User sees a bare `500 Internal Error` page with no header/branding/back link.
- **Repro**: visit `/signup`, fill form, submit. Sign-in flow has the same
  problem post-auth.
- **Fix options**: (a) change `owner_id` columns from `uuid` → `text`
  via migration, or (b) configure BetterAuth to generate UUIDs (`generateId`
  override). Option (b) is less invasive but only works for new users —
  any existing users already in the DB with text IDs would still break.

### C2. Row-Level Security is OFF on every business table

- **What**: `pg_class.relrowsecurity = false` for `projects`, `audio_assets`,
  `generation_jobs`, `arrangement_clips`, `take_edges`, `quota_reservations`,
  `user`, and `session`. The `withRLS()` wrapper sets `app.user_id` and
  starts a transaction, but with no RLS policies enforced the access
  control is purely application-side `WHERE owner_id = X`.
- **Risk**: any SQL access path that doesn't include the `WHERE` filter
  reads everyone's data. Production deployment must enable RLS before
  going live.
- **Status**: was already in the "remaining work" list — flagging because
  it surfaced during testing.

### C3. `/api/audio/serve` returns 404 even when the object exists on disk

- **What**: After fixing the missing `R2_SIGNING_SECRET` (was empty in
  `.env`, causing `DataError: Zero-length key` 500s), `/api/audio/[assetId]`
  now successfully signs and redirects to `/api/audio/serve?key=...`. But
  the serve endpoint returns 404 with `{"message": "Audio object not found
  in storage."}` — even when the file is verifiably present at
  `.local-r2/<owner>/<project>/<asset>.mp3`.
- **Investigation**: a node script using the same path components reads
  the file fine. So either (a) the local-r2 `get()` resolves a different
  path under vite, or (b) the URL-encoded key is being mis-decoded somewhere.
  Did not finish root-causing.
- **Symptom for users**: every block shows "Waveform unavailable", duration
  shows `--:--`, and clicking Play preview throws
  `Error: Failed to fetch audio: 404 Not Found at engine.ts:178`.

## High (clearly broken UX)

### H1. Project rename is dead code for temp users, broken for authenticated users

- `src/routes/+page.svelte:379` — the rename button is `disabled={!data.project || isTemp}`,
  so temp users (the only working user type today) see a clickable-looking
  "Untitled Project" with no tooltip and no rename UI on click. Authenticated
  users would get the inline edit, but they can't reach the page (C1).

### H2. Sign-up auto-redirects to a 500 with no recovery

- After sign-up succeeds, the user is dropped into a bare `500 Internal Error`
  page with no header, no logo, no "go back" link. They can't get out without
  manually editing the URL.

### H3. Sign-in / Sign-up pages have no branding or navigation chrome

- Centered card, blank background, no logo, no link to home. If a user
  arrives via the persistent "Sign up" banner and changes their mind, there
  is no way back to the workspace.

### H4. Better Auth "Base URL could not be determined" warning

- `src/lib/server/auth.ts` constructs `betterAuth({ ... })` without
  passing `baseURL`. The startup warning is harmless in dev but will
  break production OAuth callbacks and cookie domain inference.

## Medium (confusing or rough)

### M1. Quota counter copy is ambiguous

- Reads "2 of 3 free generations" — which means *remaining*. Easy to
  misread as "2 used of 3". The authenticated copy ("2 of 3 remaining
  today") is clearer; the temp copy should match.

### M2. Block title truncates mid-word with no ellipsis

- Asset title is auto-derived from prompt and chopped: e.g.
  `A 5-second cheerful ukulele jingle for a coffee sh` (lost "op"). Should
  use `…` or word-boundary truncation.

### M3. Form fully resets after Generate submit

- Prompt textarea, lyrics, and Instrumental-only toggle all clear on submit.
  Re-running a similar prompt requires retyping. Suggest preserving prompt
  and toggle state.

### M4. Hidden block-card actions appear in a11y tree when no blocks exist

- The first `read_page` against an empty workspace returned `Play preview`,
  `Add to arrangement`, `Create variation`, etc. as interactive elements,
  even though "No blocks yet" was rendered. Accessibility / template
  bleed — the empty-state should not expose the block-card action buttons.

### M5. Cover/Re-style file input is unstyled

- Default browser `<input type="file">` rendering ("Choose File" / "No
  file chosen"). No drag-and-drop affordance, no on-brand button. Users
  expect drag-drop on a music app.

### M6. `/api/events` (SSE) intermittently returns 503

- Saw one 503 followed by a successful 200 retry. May be a Vite HMR /
  reconnect race. Worth instrumenting.

## Low / cosmetic

- L1. The Inngest dev server defaults its connect-gateway port to 8289 but
  conflicts with another Inngest process on the machine, falling back to
  8290. Harmless, just noisy.
- L2. The "Insert structure tag" chips work but don't visually flash on
  click — minor feedback gap.
- L3. The `Sign in` button on `/signin` is gray when disabled rather than
  clearly indicating focus state — minor a11y rough edge.

## What I patched mid-session

- `.env` (local-only, not committed): added missing `R2_SIGNING_SECRET`
  and corrected `BETTER_AUTH_URL` from `:5173` → `:5183`.
- `src/lib/server/inngest/functions.ts`: passed `getWorkflowEnv()` to the
  scheduled quota-expiry handler so it stops crashing with
  `database "admin" does not exist` on every cron tick. Committed in
  `b9dd739`.

## End-of-session quick fixes (committed)

- `c42b207` `fix(auth): pass BETTER_AUTH_URL as baseURL to BetterAuth`
  — kills the "Base URL could not be determined" startup warning, lets
  BetterAuth resolve cookie domain and redirect URLs in production. Adds
  a 3rd `baseURL` arg to `getAuth()` and threads it through
  `hooks.server.ts` and `routes/api/auth/[...all]/+server.ts`.
- `d117dc4` `fix(ux): word-aware title truncation, clearer quota copy,
  plain project title for temp users`. Added `truncateAtWord()` to
  `$lib/utils.ts`; replaced both `prompt.slice(0, 50)` and
  `prompt.slice(0, 80)` call sites; reworded
  "X of 3 free generations" → "X free generations remaining"; rendered
  project title as plain `<span>` for temp users instead of a disabled
  `<button>` with `hover:underline`.

Verified: `npm run check` clean (5496 files, 0 errors), `npm test`
443/443 passing.

## Key learnings

- **BetterAuth + UUID columns is a foot-gun.** The whole codebase
  pre-existing this session assumed `owner_id uuid` everywhere because
  temp_session_ids are UUIDs, but the moment a real user signs up,
  every owner-scoped query 500s. Anyone working on the schema needs to
  know: either keep the column `text`, or override BetterAuth's `id`
  generation. Don't mix.
- **`relrowsecurity = false` on every business table.** `withRLS()` only
  starts a transaction with `SET LOCAL app.user_id` — without policies,
  it's a no-op. The protection today is purely the `WHERE owner_id = X`
  filters in queries. Fine for the temp-session demo loop, scary for
  a multi-tenant production deploy.
- **C3 (audio serve 404) is suspicious for path resolution, not signing.**
  After patching `R2_SIGNING_SECRET`, the signature now verifies; the
  404 comes from `bucket.get(key)` returning null in `local-r2.ts`.
  A bare `node` script using the same path components reads the file
  fine. Top hypothesis: `process.cwd()` at request time differs from
  the project root under vite SSR (or the URL-decoded key has a stray
  character). The `LOCAL_R2_DIR` constant captures cwd at module load,
  which usually matches but is fragile. Worth instrumenting with a
  one-line console.error of the resolved path on miss before the next
  session debug.
- **Sign-out issues a fresh `temp_session_id` cookie.** This caused a
  confusing test artifact: my newly-generated asset was owned by the
  pre-signup temp session UUID, but my browser had the post-signout
  UUID, so the audio fetch RLS-404'd even though the file was on disk.
  Worth deciding whether sign-out should preserve any prior temp session
  rather than minting a new one.
- **Inngest dev server `--no-discovery -u <url>` is the right flag set
  for vite dev.** Without it, the dev server tries to auto-discover
  apps and fails. Captured here for future onboarding.
- **MiniMax sometimes responds with a single JSON payload instead of
  SSE.** The adapter now handles both (committed earlier this session
  in `339edc8`). Don't assume SSE-only.

## What I did NOT exercise

- Drag-and-drop in arrangement, take-edges/variations, multi-block playback,
  download flow, cover-mode end-to-end, hitting the rate limit, mobile
  layout. All blocked or limited by C1 / C3.

## Next session priorities (in order)

1. **C1 — schema/auth fix.** Recommend: write a migration changing
   `owner_id` from `uuid` → `text` on `projects`, `audio_assets`,
   `generation_jobs`, `arrangement_clips`, `take_edges`, and
   `quota_reservations`. Updating BetterAuth's id generator is reversible
   per-user; the schema change is one-shot and matches BetterAuth's
   defaults across plugins. Drop existing temp-session test rows before
   migrating (they're UUIDs, would still cast fine, but the type change
   doesn't require a data conversion either way).
2. **C3 — audio serve 404 root cause.** Add a `console.error` in
   `local-r2.ts` `get()` catch block logging the attempted path and the
   actual error. Restart vite, hit a fresh asset, look at the path. Fix
   based on the actual mismatch (likely `process.cwd()` vs project root,
   or a `%2F` decoding edge case).
3. **C2 — enable RLS + policies** on the six business tables. Match the
   `app.user_id` setting used by `withRLS()`. Once C1 lands, the RLS
   policy can use `current_setting('app.user_id')::text = owner_id`.
4. **Friendlier 500 page** — `src/routes/+error.svelte` with at least a
   header and a back link. The bare `500 Internal Error` after sign-up
   is the worst UX moment in the app right now.
5. **Re-run the Chrome walkthrough on a clean DB** after the above.
   Exercise: arrangement drag/drop, downloads, cover-mode end-to-end,
   rate-limit-reached UI, mobile width.
6. **Then production setup**: provision Cloudflare R2 + KV, Neon prod DB,
   run migrations, configure prod env vars, smoke-test on Cloudflare
   Pages preview.
