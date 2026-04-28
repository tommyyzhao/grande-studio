# 2026-04-27 — Standalone Worker for `/api/inngest` (task #13)

Production generation now works end-to-end. The MiniMax 1-3 min hold that
Pages Functions kept killing with `outcome=exceededCpu` runs cleanly on
a standalone Cloudflare Worker. Spike → ship took one session.

## What shipped

A second Cloudflare deployable next to the Pages project:

- `worker/inngest-worker.ts` — fetch handler that imports the existing
  `inngest` client + functions and the workflow code, wraps each
  invocation in `inngestEnvContext.run(env, …)` (so functions can read
  bindings via `getInngestEnv()` exactly as before), and returns 200 for
  any non-`/api/inngest` path so it's debuggable from a browser.
- `wrangler.worker.toml` — `name = "grande-studio-inngest"`,
  `compatibility_flags = ["nodejs_compat"]`, R2 + KV bindings pointing
  at the same `grande-studio-audio` / `42abaef…` resources Pages uses,
  `[vars] BETTER_AUTH_URL = "https://grande-studio.pages.dev"` so the
  worker constructs audio URLs that resolve back through Pages.

The Pages `/api/inngest/+server.ts` is still in the repo — local dev
uses it. In production it's just an unused endpoint; Inngest cloud no
longer talks to it.

## End-to-end validation

Driven through the prod UI via Playwright: signed up
`worker-spike2-2026-04-28@example.com`, signed in, submitted "A short,
upbeat electronic track…" in instrumental mode. UI flow:

1. Quota dropped 10 → 9.
2. Block transitioned `Generating...` → `Live` (worker streaming MiniMax).
3. Block reached ready state with Play / Add to arrangement / Variation /
   Cover / Download buttons; provider tag `MiniMax`.
4. `wrangler tail grande-studio-inngest` showed the function complete:
   `[queue] Workflow completed: job=ebf7a4d1… asset=cc75d4dc…` —
   Ok, no `exceededCpu`, no exception.

Quality gates green: `npm run check` 0 errors / 0 warnings, vitest 443/443.

## Critical foot-guns surfaced this session

- **Inngest cloud's app identity is the client `id`, not the URL.** Our
  PUT against the Worker URL returned `{"modified":true}` and replaced
  the Pages URL pointer for app `grande-studio` — there was never a
  fan-out / duplicate-run hazard because both registrations shared the
  same id. If you ever change the URL, just `PUT` the new one; no
  manual deletion of the old app needed.
- **Pages cold-starts 503 the first BetterAuth request after the
  function spins down.** Caught both on sign-up and sign-in this
  session. The UI surfaces it as "Sign-up failed. Please try again." /
  "Invalid email or password." which is misleading. Worth a UX fix:
  show a "service waking up, retry" affordance distinct from auth
  failure. (Logged here, not yet filed.)

## Architecture diagram (mental model)

```
browser ──HTTP──▶ Pages (grande-studio.pages.dev)
                    │ SvelteKit app, BetterAuth, /api/audio/serve
                    │ /api/generate ─inngest.send()→ Inngest cloud
                    ▼                                    │
                  R2 + KV + Neon                         │ POST
                                                         ▼
                          standalone Worker (grande-studio-inngest…workers.dev)
                          /api/inngest = serve({ generationFunction, quotaExpiryFunction })
                          │ holds the 1-3 min MiniMax stream
                          ▼
                          R2 (writes) + Neon (job/asset rows) + KV (live chunks)
```

Audio served back from Pages reads the same R2 bucket the Worker writes
into. Both sides sign URLs with the same `R2_SIGNING_SECRET`.

## CI changes

`.github/workflows/deploy.yml` now does three things on push to `main`:

1. `pages deploy` (unchanged)
2. `wrangler deploy --config wrangler.worker.toml` (new)
3. `curl -X PUT https://grande-studio-inngest.tzpersonal.workers.dev/api/inngest`
   — the sync now points at the WORKER URL. If we'd left the old
   `PUT https://grande-studio.pages.dev/api/inngest` alone, the next
   main push would have re-registered Pages and kicked the Worker out
   as the active app URL. Bad foot-gun avoided.

## Backlog deltas

- Task #13 (long-running generation runtime): **closed**. Standalone
  Worker is the answer; no Fly.io sidecar needed; no platform drift.
- `/api/events` SSE 500s on Pages — same root cause class as #13. Now
  that the Worker pattern is proven, the same approach (move
  `/api/events` to a standalone Worker, or to the existing Inngest
  Worker) would unblock live streaming. Not done this session.
- Pages cold-start 503 → misleading auth UI message. New M-tier item.

## Where to find things

- `worker/inngest-worker.ts` — Worker entrypoint.
- `wrangler.worker.toml` — Worker config (bindings, vars, limits commented).
- `.github/workflows/deploy.yml` — split-deploy CI.
- `CLAUDE.md` — bootstrap doc, has the new architecture in the foot-guns
  list and the deploy quickref.
