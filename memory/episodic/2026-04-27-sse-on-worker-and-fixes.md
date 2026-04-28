# 2026-04-27 — SSE on Worker, auth retry, prod-deploy gap, dedicated events secret

Continuation of the standalone-Worker session. Closes the long-running-endpoint
class entirely (SSE and Inngest both off Pages), tightens the user-visible
auth UX, and surfaces a CI mis-routing that had been silently sending
ralph-branch deploys to a preview alias instead of production.

## Shipped

### `/api/events` SSE on the standalone Worker

Same problem class as the Inngest webhook — Pages Functions kill long-poll.
Moved the SSE polling loop onto `grande-studio-inngest`. To get cookies
across the origin gap (`grande-studio.pages.dev` ≠
`grande-studio-inngest.tzpersonal.workers.dev`), the client now mints a
short-lived HMAC token via Pages `/api/events/token` (cookie-authed) and
appends it to the EventSource URL.

Files touched:

- `src/lib/services/events-token.ts` — sign / verify, with constant-time
  comparison and unit tests (5/5 pass).
- `src/lib/server/events/event-stream.ts` — extracted polling loop so
  Pages (dev) and Worker (prod) share one code path.
- `src/routes/api/events/token/+server.ts` — token mint on Pages.
- `src/routes/api/events/+server.ts` — accepts token in dev, 410s in prod.
- `worker/inngest-worker.ts` — adds `/api/events` route alongside
  `/api/inngest`, with `Access-Control-Allow-Origin` for the Pages host.
- `src/lib/stores/sse.svelte.ts` — fetches token first, opens
  EventSource at the worker URL.

End-to-end validated through the prod UI: signed in, generated a track,
SSE delivered `Generating → Live → ready` transitions cleanly. Zero
console errors across the entire 2 min lifecycle.

### `EVENTS_TOKEN_SECRET` (separate from R2_SIGNING_SECRET)

Initial implementation reused `R2_SIGNING_SECRET` for the events token.
It worked locally and in unit tests — and broke immediately in prod with
401 on every Worker `/api/events` connection, because the Pages-side and
Worker-side `R2_SIGNING_SECRET` values had been provisioned at different
times with different inputs. Audio still worked because each runtime
signs and verifies within itself, so the mismatch never surfaced before
this cross-runtime round-trip.

Fix: dedicated `EVENTS_TOKEN_SECRET`, freshly generated and set on both
Pages and Worker in the same shell session. Audio URL signing keeps its
own secret and can be rotated independently.

This is a small but real gotcha to remember: any new cross-runtime
secret needs explicit "set on both sides with the same value" tooling
or it silently breaks the moment one side is rotated.

### Auth cold-start retry

Pages Functions occasionally 503 the first BetterAuth POST after the
function spins down (CF error code 1102 — Worker exceeded resource
limits during cold start). The `signup` and `signin` pages now do a
single transparent retry on any 5xx after a 600 ms wait, and only show
"The service is starting up — please try again in a moment" if the
retry also fails. The previous "Invalid email or password" / "Sign-up
failed" messages were misleading on a 503.

### Pages `/api/inngest` 410 in production

Mirror of the events-route guard. Returns 410 Gone on any non-dev
request so an accidental `curl -X PUT https://grande-studio.pages.dev/api/inngest`
can never re-register Pages as the active app URL and silently break
generation again. Local dev (`INNGEST_DEV=1`) keeps serving the manifest.

### Stuck-row reaper window: 10 → 5 min

Worker reliably completes inside ~3 min in prod (worst case observed).
Halving the recovery window without crowding the success path.

## CI mis-routing — fixed

Important discovery during validation. The deploy workflow was running
on push to either `main` or `ralph/v1-minimax-web-studio`, but the
wrangler command had `--branch ${{ github.ref_name }}`. Cloudflare Pages
treats `--branch main` as production and anything else as a preview
alias. So every push to the working branch was deploying to
`https://ralph-v1-minimax-web-studio.grande-studio.pages.dev` — the
production URL `https://grande-studio.pages.dev` had been stale for the
last several pushes, and we only noticed when `/api/events/token`
returned 404 there.

Until `main` is restored as the source of truth, the working branch
**is** production. Workflow now passes `--branch main` regardless of
ref, and the Inngest Worker deploy + sync steps no longer gate on
`ref_name == 'main'` (which would have skipped them on every working-
branch push, leaving the Worker out of sync with Pages).

If `main` ever resumes its conventional role, revert this — the
default behavior is the right long-term setup.

## R2 streaming write — investigated, no action

Worker memory cap is 128 MB. The generation workflow buffers all
provider chunks (`Uint8Array` per chunk) before assembling and uploading
to R2. For a typical MiniMax MP3 (128-192 kbps × 1-3 min) the peak is
well under 10 MB. No OOM risk on this workload; flagged in the docs
in case higher-bitrate output ever lands.

## Open / next session

- Task #12 was committed alongside this; if main is restored and CI
  goes back to ref-based branch routing, also restore the `if:
  ref_name == 'main'` gates on the Worker deploy + sync steps.
- Pages `/api/auth/sign-in/email` 503 rate seemed elevated this
  session (4 attempts → 1 success at one point). Cold-start retry
  helps, but if it persists the next move is to put BetterAuth on the
  Worker too — there's nothing structurally tying it to Pages.
- E2E Playwright tests (PRD wants 25, currently 0) — would catch
  regressions like the secret mismatch in CI rather than at runtime.

## Where to find things

- `CLAUDE.md` — bootstrap, secrets list now includes `EVENTS_TOKEN_SECRET`,
  foot-gun list mentions `/api/events` on Worker.
- `worker/inngest-worker.ts` — Inngest + SSE route handlers + CORS.
- `src/lib/services/events-token.ts` — sign/verify helpers.
- `src/lib/server/events/event-stream.ts` — shared SSE polling loop.
- `src/routes/api/events/token/+server.ts` — token mint.
- `.github/workflows/deploy.yml` — split-deploy CI, now always
  targets prod via `--branch main`.
