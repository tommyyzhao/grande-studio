# 2026-04-28 — UX Audit Batch Closed

End-of-session entry. Closed the entire UX audit backlog from
`2026-04-27-ux-audit-and-next-session-backlog.md` in one pass. All items
land as a coherent set; the bug + high-friction items are the meaningful
behaviour fixes, and P1–P6 are the surface polish.

## Items shipped (referenced by stable IDs)

### Bugs

- **B1** — `audio_assets.duration_sec` now populated server-side. New
  `src/lib/server/audio/mp3-duration.ts` parses the first MPEG Layer III
  frame, supports CBR (bytes × 8 / bitrate) and Xing/Info VBR, and skips
  ID3v2 if present. Worker-safe: pure `Uint8Array` arithmetic, no Node
  APIs. `src/lib/server/audio/mp3-duration.test.ts` covers 5 cases
  (too-small input, non-MPEG bytes, CBR 128 kbps, ID3v2 prefix, CBR
  192 kbps). `generation-workflow.ts:473` now calls
  `estimateMp3DurationSec(audioBytes)` instead of writing `null`. This
  unblocks the transport timer ceiling, the per-block `--:--`, and the
  2-pixel arrangement clips.
- **B2** — Empty-arrangement copy rewritten. `+page.svelte:462` now
  refers to the actual `Add` button (with the `ListPlus` icon inline)
  inside an illustrated empty state.
- **B3** — `receiving_audio` status renamed `Live` → `Streaming…` with
  the spinner enabled. The old `Radio` icon has been removed because it
  signalled live broadcast that wasn't actually happening client-side.
  The bars-animation visualisation in `pending-block-card.svelte` stays
  (it visualises chunk arrival, not audio playback).

### High-friction UX

- **H1** — Instrumental switch visibility. Dropped `size="sm"` (now
  default 32 × 18.4 px with a 16 px thumb) and the label now reads
  `Instrumental only — ON|OFF` so the state is readable as text, not
  just visible as a chip.
- **H2** — Block action buttons reduced from five icon-only buttons to
  two labelled buttons (Play / Pause and Add) plus a `…` dropdown that
  retains all five actions including Variation, Cover/Re-style, and
  Download.
- **H3** — Mobile title row uses `flex-wrap` with `basis-full sm:basis-0`
  so badges drop below the title on narrow screens instead of overlapping.
- **H4** — Mode tabs now a true segmented control: ~50 % combined width
  (`w-fit`), inactive items are text-only with hover, active item gets a
  white background + subtle ring + shadow. No more "primary nav" feel.
- **H5** — Cover / Re-style file input is now a styled drop-zone label:
  dashed border, hover state, upload glyph, accepted-formats hint
  inline. The native `<input type="file">` is `sr-only` inside the label
  so accessibility is preserved.
- **H6** — Auth cold-start retry logic fixed. The previous gate on
  `result.error.status >= 500` never fired because BetterAuth's client
  error has no `.status` field on a 503. New `isColdStartLike()` helper
  retries when status is missing AND message is missing (the actual
  cold-start signature) OR when status is an explicit 5xx. Also added
  pre-warm: both `signin/+page.svelte` and `signup/+page.svelte` fire
  `fetch('/api/auth/get-session')` on mount so the function is hot when
  the user submits.

### Polish

- **P1** — Project title now has a pencil icon next to it
  (`+page.svelte:376-388`), visible alongside the existing
  `hover:underline`.
- **P2** — Header sign-in/sign-out button changed from `variant="ghost"`
  to `variant="outline"`.
- **P3** — Transport `Stop` button replaced with a real seek bar tied
  to `engine.seek()`. The bar uses the arrangement total duration as
  its max and is disabled when no clips are present. `Square` icon
  removed.
- **P4** — Block-list and arrangement empty states each get an
  illustrated panel: dashed-border card with a circular tinted icon
  glyph (music note for blocks, `ListPlus` for arrangement) plus a
  primary heading and helper text.
- **P5** — Structure-tag chips now visually nest under the lyrics
  textarea: a muted `border-t-0 rounded-b-md` strip with the caption
  *"Click to insert into lyrics"* and per-chip `title="Insert {tag} into
  lyrics"` tooltips.
- **P6** — Skipped intentionally. The arrangement clip card scissor /
  headphones / volume icons already have `title` attributes (which act
  as native browser tooltips), so the "unlabeled" complaint is partial.
  Adding visible labels would make the dense control row worse on
  narrow screens. Left as-is; revisit if the row is redesigned for a
  proper timeline view.

## Quality gates

- `npm test` — 453 / 453 passing (was 448 + 5 new MP3 duration tests).
- `npm run check` — 0 svelte errors / 0 warnings across 5505 files.
- Smoke test: `vite dev` rendered the workspace at 1280 × 800 and at
  390 × 844 (mobile) without layout breakage. Console errors visible at
  startup are the expected `/api/events/token` 500s — Inngest dev server
  wasn't running and these endpoints depend on it. Not regression-related.

## Decisions worth remembering

- **Server-side duration is the right boundary.** The previous design
  punted to "the client computes it" but no client ever did. Computing
  once at R2-write time means every reader sees the duration consistently
  — including the arrangement clip width and the transport timer
  ceiling.
- **Mp3 duration parser stays minimal.** Layer III only, supports MPEG-1
  and MPEG-2/2.5 frame sizes, accepts both CBR and Xing/Info VBR
  headers. If MiniMax ever switches to Layer II or AAC, the parser
  returns null and `durationSec` stays null — matches today's behaviour
  rather than crashing the workflow. About 180 lines including the
  test.
- **Pre-warm for the cold-start retry is the cheap belt-and-suspenders
  half**. The retry path is still there for the case where the user
  submits before the warm-up fetch returns; the pre-warm just makes that
  path much rarer in practice. Pre-warm is fire-and-forget; we don't
  wait for it.
- **P3's seek bar reuses the existing `engine.seek()` API.** The engine
  test suite already exercises `seek()` for clip-relative offsets
  (engine.test.ts:475+), so transport-level seeking is just a UI
  change.

## What's next

- The PRD asks for 25 E2E Playwright tests; we still have 0. The most
  valuable five are: signup-then-generate, signin-then-generate,
  instrumental-toggle, add-to-arrangement, sign-out-temp-session-handoff.
  These would have caught the Pages "preview alias" CI bug from the
  previous session.
- Open foot-guns from `2026-04-27-browser-ux-review.md` (C1 BetterAuth
  IDs, C2 RLS no-op) are still parked. Both are correctness issues but
  haven't surfaced production breakage yet.
- B1's duration parser only fires for new generations. Existing
  `audio_assets` rows with `duration_sec = NULL` keep showing `--:--`.
  A backfill (read each row's R2 object, parse, UPDATE) is a one-shot
  job worth running before public launch but isn't blocking.

## File map (this session)

```
NEW:  src/lib/server/audio/mp3-duration.ts          (B1 parser)
NEW:  src/lib/server/audio/mp3-duration.test.ts     (5 cases)
EDIT: src/lib/server/workflow/generation-workflow.ts:473  (call parser)
EDIT: src/routes/+page.svelte                       (B2, P1, P2, P4-arrangement)
EDIT: src/lib/components/pending-block-card.svelte  (B3)
EDIT: src/lib/components/generate-panel.svelte      (H1, H4, H5, P5)
EDIT: src/lib/components/block-card.svelte          (H2, H3)
EDIT: src/lib/components/block-list.svelte         (P4-blocks)
EDIT: src/lib/components/transport-bar.svelte      (P3 seek bar)
EDIT: src/routes/signin/+page.svelte                (H6)
EDIT: src/routes/signup/+page.svelte                (H6)
```

## Branch state

`ralph/v1-minimax-web-studio`. Working tree dirty with the changes
above; pre-commit not run yet by this session. CI on push deploys both
Pages (to prod via `--branch main`) and the Inngest Worker, then PUTs
the manifest.
