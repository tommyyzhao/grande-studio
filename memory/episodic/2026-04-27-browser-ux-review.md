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

## What I did NOT exercise

- Drag-and-drop in arrangement, take-edges/variations, multi-block playback,
  download flow, cover-mode end-to-end, hitting the rate limit, mobile
  layout. All blocked or limited by C1 / C3.

## Next session priorities

1. Decide on schema-vs-auth fix for C1 and apply.
2. Root-cause C3 (`/api/audio/serve` 404 with file present).
3. Enable RLS on all business tables and add policies (C2).
4. Add baseURL to BetterAuth init and surface a friendlier 500 page.
5. Re-run this browser walkthrough on a clean DB after the above.
