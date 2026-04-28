# 2026-04-27 — UX Audit + Next-Session Backlog

End-of-session capture. The infra work this session (standalone Worker
for `/api/inngest`, SSE on the Worker via token handoff,
`EVENTS_TOKEN_SECRET`, prod-CI deploy fix, auth retry, reaper window) is
shipped, validated end-to-end on prod, and committed. Generation in
production works. Next session is a UX/UI pass.

This memo:

1. captures critical learnings and decisions from this session that
   weren't already written into the other two memos, and
2. lays out the full backlog of UX issues triaged from a
   Playwright-driven end-to-end audit, in the order the next session
   should attack them.

For full session context also read, in order:

- `2026-04-27-standalone-worker-for-inngest.md` — first half of the day
- `2026-04-27-sse-on-worker-and-fixes.md` — second half of the day
- this file

`CLAUDE.md` is up to date (foot-guns, secrets list, deploy quickref).

## Critical learnings to remember

1. **Two CF runtimes share the same prod stack.** Pages serves the
   SvelteKit app + audio + the cookie-authed events-token endpoint.
   The standalone Worker (`grande-studio-inngest`) hosts everything
   long-running: `/api/inngest` (generation + cron) and `/api/events`
   (SSE). Inngest cloud's app URL points at the Worker. `BETTER_AUTH_URL`
   is set on Pages secret; Worker has the same value as a `[vars]`
   entry so it can build absolute audio URLs.

2. **`EVENTS_TOKEN_SECRET` must be byte-identical on Pages and Worker.**
   Pages mints, Worker verifies. If the values drift, every SSE
   connection 401s with a misleading "invalid or expired token". Hit
   us once already — `R2_SIGNING_SECRET` had been provisioned with
   different values on each side, and reusing it for tokens broke
   immediately. Audio playback didn't surface the mismatch because
   each runtime signs and verifies within itself.

3. **CF Workers Paid plan flag is eventually-consistent.** Right
   after upgrade, `wrangler deploy` with `[limits] cpu_ms` rejects
   with "Free plan" for several minutes even though the dashboard
   shows Paid. Workaround: deploy without `[limits]` first, re-add
   `[limits]` on a follow-up deploy a few minutes later. Default
   Workers Paid CPU (30 s) is enough for our workload anyway —
   actual CPU per generation is ~2 s, the rest is network I/O.

4. **CF Pages "production" is keyed off `--branch main`, not the
   ref or the project alias.** Our CI was passing
   `--branch ${{ github.ref_name }}`; ralph-branch pushes were quietly
   landing at the preview alias. Fixed: the workflow now passes
   `--branch main` from any source branch and removes the
   `ref_name == 'main'` gates on the Worker deploy + sync steps. If
   `main` is ever restored as the source of truth, revert.

5. **BetterAuth client errors don't expose HTTP status.** The auth
   cold-start retry helper we added gates on `result.error.status >=
   500`, but on 503 the BetterAuth client surfaces a generic error
   object with no `status` field, so the retry path never runs. The
   user still sees "Invalid email or password" on Pages cold-start.
   Need to detect the underlying fetch failure separately — listed
   below as H6.

6. **Inngest cloud apps are keyed by client `id`, not URL.** Re-PUTting
   the manifest from a different host with the same client `id`
   (`grande-studio`) replaces the URL pointer rather than fanning out.
   No manual delete of the old app is needed.

7. **Pages cold-start 503s as CF error 1102.** That's "Worker
   exceeded resource limits" — happens on the BetterAuth handler's
   first request after the function spins down. Roughly 1 in 4
   sign-ins during the audit window. The retry idea is right; just
   needs to be on actual fetch status, not the BetterAuth-client
   error object.

## Decisions made this session

- **Stay on Cloudflare**, not Fly.io. Workers Paid + standalone
  Worker is sufficient. Fly sidecar plan is parked indefinitely;
  the `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_S3_TOKEN`
  in `.env` aren't used in prod and can stay for future contingencies.
- **`EVENTS_TOKEN_SECRET` separate from `R2_SIGNING_SECRET`**. Audio
  URL signing rotates independently; one less coupling to break.
- **Pages `/api/events` and `/api/inngest` 410 in production**, kept
  for local dev (`INNGEST_DEV=1`). Belt-and-suspenders against an
  accidental sync re-pointing Inngest at Pages.
- **Reaper window 10 min → 5 min.** Worker reliably finishes inside
  ~3 min in prod.

## End-of-session live state

- Branch: `ralph/v1-minimax-web-studio`, pushed to origin.
- Latest commits this session:
  - `9a82463` feat(infra): standalone Worker for /api/inngest
  - `8b6eb08` fix: cold-start retry, prod /api/inngest 410, tighter reaper window
  - `9da465f` feat(infra): SSE /api/events on standalone Worker via token handoff
  - `08e5700` fix(events): dedicated EVENTS_TOKEN_SECRET so Pages mints verify on Worker
  - `c54f1c4` chore(ci+docs): always deploy to prod, document EVENTS_TOKEN_SECRET + SSE-on-Worker
- Tests: 448/448 vitest, 0 svelte-check errors.
- Prod app: <https://grande-studio.pages.dev>
- Worker: <https://grande-studio-inngest.tzpersonal.workers.dev>
  hosts `/api/inngest` and `/api/events`.
- Tested account: `worker-spike2-2026-04-28@example.com` /
  `WorkerSpike12345!` (created during validation; safe to reuse).

## UX audit findings — the next session's backlog

Triaged from a full Playwright walk of the prod app: anonymous landing,
sign-up, sign-in, authenticated workspace, generate-mode, instrumental
toggle, cover/re-style mode, in-flight generation, ready blocks, add
to arrangement, mobile (390 px), playback. Screenshots were taken
locally and discarded — they don't need to be in git.

Each item has a stable ID (`B*` bug, `H*` high-friction, `P*` polish)
referenced in the next-session handoff string at the bottom.

### Bugs — data wrong / UI broken

**B1. `audio_assets.duration_sec` is always `null`.**
Highest-impact bug from the audit. Visible everywhere: every block shows
`--:--`, the transport timer ticks past the actual end of the track
(`1:31 / 0:00` for a 30-second clip), and arrangement clips render as a
~2-pixel grey rectangle because their width is computed from the
asset's duration. Source: `generation-workflow.ts:473` writes
`durationSec: null` with the comment "Duration can be detected
client-side from the audio buffer" — but nothing does that.

Fix options (pick one):

- A. After wavesurfer fires `ready` in `block-card.svelte`, PATCH the
  computed duration back to the asset via a small new endpoint. Simple
  but each client computes the same thing.
- B. Compute server-side during R2 persist by parsing the first MPEG
  frame for sample rate + bitrate and the file size. Faster, runs
  once. About 30 lines of Worker-safe code.

Recommend B; the duration is a property of the asset, not the viewer.

**B2. "Use the **+** button on a ready block" copy promises a button
that doesn't exist.** The actual icon is `ListPlus` (lucide), a list
glyph with a small plus. Empty-arrangement panel says
`src/routes/+page.svelte:462`:
```svelte
No clips in arrangement. Use the <strong>+</strong> button on a ready
block to add it here.
```

Fix: change the copy to refer to the actual affordance, e.g. *"Use the
**Add to arrangement** button on a ready block to add it here."*, with
the `ListPlus` icon inline before the words. Or replace the icon with
a `+` glyph in `block-card.svelte:347` (it would clash with the visual
language of the other action icons; not recommended).

**B3. "Live" badge promises live playback that's not happening.** In
`pending-block-card.svelte:43-48`, `receiving_audio` status is labeled
"Live" with a Radio icon and a blue chip. To the user this reads as
"audio is playing live to me". Server-side it just means chunks are
landing in KV. Rename to **"Streaming…"** with the existing waveform
bar animation. Reserve "Live" (with the `Radio` icon) for if/when we
actually wire the live-listen feature so the user hears chunks as they
arrive — currently the code can publish to KV but the client doesn't
play them.

### High-friction UX

**H1. Instrumental switch is invisible.**
`generate-panel.svelte:512-514` uses `<Switch size="sm">`. Per
`switch.svelte:22`, `sm` = 14×24 px with a 12 px thumb. Off vs on is
a near-imperceptible gray→primary transition over 10 px of travel.
Layered fix:

- Drop `size="sm"` so it becomes the default 18.4×32 with a 16 px thumb.
- Add a sibling text indicator: render the label as
  *"Instrumental only — **ON**"* (or **OFF**) so the *text* reflects
  state, not just the chip.
- Consider promoting it to a segmented control next to the prompt
  ("With lyrics" / "Instrumental only") for stronger affordance.

**H2. Block action icons aren't labeled.** Five icon-only buttons
(Play, ListPlus, GitBranch, Disc3, Download) plus a `…` menu in
`block-card.svelte:328-422`. Tooltips only. New users have to guess.

Pick one:

- Add visible labels under each icon (icon + 1-word text), accept the
  card grows.
- Keep just **Play** + **Add to arrangement** as visible icons; collapse
  Variation, Cover/Re-style, Download, More into the existing `…`
  dropdown.

Recommend the second — fewer dominant actions per card, better mobile.

**H3. Mobile title-vs-badge overlap.** On 390 px wide, the MiniMax
provider badge floats over the truncating title. The flex container in
`block-card.svelte:259` likely needs `min-w-0` on the title wrapper
plus a `flex-wrap` or stacked layout on narrow screens.

**H4. Generate vs Cover/Re-style "tabs" look like primary nav.**
`generate-panel.svelte:395-411` renders them as 100% width filled
buttons, the active one solid primary. Reads as "go to a different
page". Use a segmented-control pattern: tighter (~50% combined
width), pill background, active state differentiated via a subtle
inset shadow rather than full primary fill.

**H5. Cover/Re-style file input is the unstyled native HTML widget.**
`generate-panel.svelte:472-481`. "Choose File / No file chosen" in
system font, no drop-zone affordance, accepted-formats hint only as
small caption text. Already noted as M5 in the original handoff;
still open. Style it as a drop-zone with hover state and accepted
formats inline.

**H6. Auth cold-start retry helper never runs.** We added a 5xx retry
in `signup/+page.svelte:46-58` and `signin/+page.svelte:35-50` last
session, but BetterAuth's client error doesn't surface a `status`
field on a 503 — `result.error.status` is `undefined`, the
`>= 500` check is always false, retry never fires. The user still
sees "Invalid email or password" on a Pages cold-start.

Fix: instead of relying on the BetterAuth client to expose status,
either:

- Wrap the auth call in a `try/catch` and inspect the underlying
  `fetch` response status (BetterAuth client may not give us this
  cleanly — would need to monkey-patch fetch or extend the client).
- Easier: detect "no `status` field on the error" + "no message field"
  as the cold-start signature and retry on that. Cheap and matches
  the actual observed shape.
- Consider also pre-warming Pages: a tiny client-side request to
  `/api/auth/get-session` fired right after the page mounts so the
  function is warm by the time the user hits Submit.

### Polish

**P1.** Project title editable but the only affordance is
`hover:underline`. Add a small pencil icon next to the title in
`+page.svelte:376-388`.

**P2.** Header sign-in/sign-out button is `variant="ghost"`; easy to
miss. `outline` lands between "screams" and "invisible".

**P3.** Transport `Stop` button next to `Play` is largely redundant —
`Play` doubles as `Pause` and we have no scrubber. Replace `Stop`
with a real seek bar tied to the currently-playing asset.

**P4.** Empty-block-list and empty-arrangement panels are pure text.
Add a small illustration plus a primary CTA button.

**P5.** Structure-tag chips ([Intro] [Verse] …) don't read as "click
to insert into Lyrics". Add hover tooltip *"Insert into lyrics"* and
visually nest them inside the lyrics card so the relationship is
obvious.

**P6.** Arrangement clip card has unlabeled scissor/headphones/speaker
icons (trim, solo, mute). Same problem as H2 but on the lower-traffic
arrangement surface.

## Recommendation for next session

**Ship this batch first** — clearly high-value, mostly small, no
cross-coupling: **B1, B2, B3, H1, H4, H6**.

**Hold for a single design pass** — these multiply each other and are
better as one coherent visual review than piecemeal: **H2, H3, H5,
P1–P6**.

If time permits in the next session, also revisit:

- E2E Playwright tests (PRD wants 25, currently 0). After this audit
  the obvious high-value tests are: signup-then-generate, signin-then-
  generate, instrumental-toggle, add-to-arrangement, sign-out-temp-
  session-handoff. Five tests would catch most regressions and would
  have caught the "Pages CI deploys to preview" issue.

## Where to find things

- This memo + the two earlier 04-27 memos (`standalone-worker-for-inngest`,
  `sse-on-worker-and-fixes`) are the running log of the day.
- `CLAUDE.md` — bootstrap doc; foot-guns + deploy quickref are current.
- `worker/inngest-worker.ts` — Worker entrypoint (Inngest + SSE).
- `wrangler.worker.toml` — Worker config (`[limits] cpu_ms = 300000`,
  bindings, `[vars] BETTER_AUTH_URL`).
- `src/lib/services/events-token.ts` — token sign/verify (5/5 unit
  tests in `events-token.test.ts`).
- `src/lib/server/events/event-stream.ts` — shared SSE polling loop
  used by Pages (dev) and Worker (prod).
- `src/routes/api/events/+server.ts` — Pages dev route, 410 in prod.
- `src/routes/api/events/token/+server.ts` — Pages token mint.
- `src/lib/stores/sse.svelte.ts` — client SSE consumer (fetches
  token then opens EventSource at returned URL).
- `.github/workflows/deploy.yml` — split-deploy CI, always
  `--branch main`.
- `src/lib/components/pending-block-card.svelte` — "Live" / "Generating"
  / status badges live here (B3, H1 surface here).
- `src/lib/components/block-card.svelte` — ready-state action buttons
  (B1, B2, H2, P3 surface here).
- `src/lib/components/generate-panel.svelte` — instrumental switch +
  mode tabs + file upload (H1, H4, H5 surface here).
- `src/routes/+page.svelte` — empty-state copy, header, transport
  parent (B2, P1, P2, P4 surface here).
- `src/routes/signup/+page.svelte`, `src/routes/signin/+page.svelte` —
  auth retry helper (H6 surfaces here).
