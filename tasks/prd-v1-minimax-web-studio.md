# PRD: V1 Minimax Web Studio

## Introduction

V1 Minimax Web Studio is an open-source, mobile-first AI music sketchpad for non-technical creators and "creator-plus" users who want to generate, iterate, stack, lightly arrange, and export AI-generated music without using a traditional DAW.

Users can generate audio from prompts, optional lyrics, structural tags, or MiniMax-supported cover/re-style workflows; listen while streamed audio chunks arrive; persist the final generated audio to durable storage; place audio blocks into a synchronized vertical arrangement; stack multiple blocks simultaneously; trim, drag-to-extend loop, mute, solo, adjust volume, and export rough mixes or individual blocks.

The product uses a vertical, CapCut-style block interface rather than a horizontal multitrack timeline. Unauthenticated users can immediately start generating music in a temporary project with heavy rate limits. Authenticated users get a persistent single project workspace with higher daily generation limits.

V1 uses MiniMax Music 2.6 as the only implemented music provider. The architecture treats MiniMax as a provider behind a typed adapter boundary, preserving clean extension points for future providers.

V1 is not a DAW, not a professional mastering suite, and not a full producer-grade AI audio workstation. It is a lightweight AI music creation environment with enough arrangement control to feel materially more useful than a one-shot prompt box.

## Goals

- Let any user (including unauthenticated) generate music from a text prompt within 30 seconds of landing
- Support instrumental-only generation, user-provided lyrics, and structural tags
- Support MiniMax cover/re-style workflows for existing song-like reference audio
- Stream final audio chunks to the browser so users hear results as they arrive
- Persist all generated audio to durable R2 storage
- Let users stack multiple audio blocks in a synchronized vertical arrangement
- Provide non-destructive arrangement editing: trim, drag-to-extend loop, volume, mute, solo, start offset
- Let users branch generations into a take DAG for A/B exploration
- Let users export individual blocks and rough client-side mixdowns
- Enforce per-user ownership isolation via Postgres RLS
- Keep the system testable, lightweight, and open-source-friendly
- Make the PRD agent-executable by eliminating ambiguous implementation forks

## User Stories

---

### Authentication & Onboarding

---

### US-001: Email/Password Authentication

**Description:** As a user, I want to sign up and sign in with email and password so that my projects and generations are saved.

**Acceptance Criteria:**
- [ ] BetterAuth configured with email/password provider
- [ ] Sign-up page collects email and password
- [ ] Sign-in page accepts email and password
- [ ] Session persists across page reloads
- [ ] Sign-out button ends session and redirects to landing state
- [ ] Password reset flow via email
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-002: Unauthenticated Temp Project

**Description:** As an unauthenticated visitor, I want to immediately start generating music and using the editor so that I can try the product before committing to an account.

**Acceptance Criteria:**
- [ ] Unauthenticated user lands directly in a functional workspace (no login gate)
- [ ] Temp project is created using a browser-session identifier
- [ ] Unauthenticated users are heavily rate-limited (max 3 generations per session)
- [ ] Persistent banner at top: "Sign up to save your project and get more generations"
- [ ] Banner includes sign-up CTA button
- [ ] All workspace features (generate, arrange, play, export) work in temp mode
- [ ] Temp project data is ephemeral (not persisted to user-owned DB rows)
- [ ] On sign-up, temp project can optionally be claimed by the new user (stretch goal, not required for V1)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Project

---

### US-003: Single Project Workspace

**Description:** As an authenticated user, I want a single persistent project workspace so that I can generate, arrange, and export without managing multiple projects.

**Acceptance Criteria:**
- [ ] On first authenticated visit, a default project is auto-created for the user
- [ ] On subsequent visits, user is returned to their existing project
- [ ] Project header shows project title
- [ ] User can rename project title inline
- [ ] Project stores all assets, clips, take edges, jobs, and exports
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Generation

---

### US-004: Prompt-to-Music Generation

**Description:** As a creator, I want to describe the music I want in plain language so that I can generate a usable first version quickly.

**Acceptance Criteria:**
- [ ] Generate panel includes a text prompt field
- [ ] User can optionally describe tempo, genre, mood, instruments, use case in the prompt
- [ ] Submit validates request through MiniMax validator (`/lib/providers/minimax/validateMusicRequest.ts`)
- [ ] On submit, a `generation_job` and `audio_asset` row are created immediately
- [ ] Job is enqueued to Cloudflare Queue
- [ ] A queued block appears in the workspace immediately after submit
- [ ] On success, final audio is persisted to R2 and block becomes playable
- [ ] Empty prompt is rejected with a visible error
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-005: Instrumental Toggle

**Description:** As a creator, I want to force instrumental-only generation so that I do not get unwanted AI vocals.

**Acceptance Criteria:**
- [ ] Generate panel includes an "Instrumental only" toggle
- [ ] Toggle maps to MiniMax `is_instrumental=true` through the adapter
- [ ] When instrumental mode is on, lyrics input is disabled with a visible explanation ("Lyrics are not used in instrumental mode")
- [ ] Submitting instrumental=true with lyrics is rejected by the form validator with a clear message (not silently ignored)
- [ ] Generated block displays "Instrumental" badge when applicable
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-006: Lyrics Input

**Description:** As a creator, I want to provide lyrics so that the generated song reflects my words instead of auto-generated lyrics.

**Acceptance Criteria:**
- [ ] Generate panel includes a multi-line lyrics text area
- [ ] Lyrics are stored separately from prompt on the `audio_asset`
- [ ] Lyrics are sent to MiniMax only through the provider adapter
- [ ] Lyrics are displayed in the asset detail/ready block
- [ ] Lyrics length respects MiniMax limits; over-limit shows a validation error
- [ ] Non-instrumental mode without lyrics and without lyrics optimizer enabled is rejected
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-007: Structure Tag Helper

**Description:** As a creator, I want to use simple structure tags so that I can guide the song shape.

**Acceptance Criteria:**
- [ ] Generate panel includes a structure tag helper (button palette or dropdown)
- [ ] Supported tags: `[Intro]`, `[Verse]`, `[Verse 1]`, `[Verse 2]`, `[Pre-Chorus]`, `[Chorus]`, `[Hook]`, `[Bridge]`, `[Breakdown]`, `[Solo]`, `[Outro]`
- [ ] Tapping a tag inserts it at cursor position in the lyrics field
- [ ] Unsupported bracketed tags produce a warning before submission
- [ ] Tags are not silently lowercased or rewritten by application code
- [ ] Tags are stored as part of generation metadata (`structure_tags_json`)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-008: Cover / Re-style From Upload

**Description:** As a creator, I want to upload a song-like source track so that MiniMax can create a new rendition preserving core melodic/lyrical structure.

**Acceptance Criteria:**
- [ ] Generate panel includes a "Cover / Re-style" mode toggle or tab
- [ ] User can upload an audio file (max 50MB, accepted formats: MP3, WAV, M4A, FLAC)
- [ ] Upload goes through SvelteKit endpoint and is persisted to R2
- [ ] Uploaded audio becomes an `uploaded` source_type audio asset
- [ ] File type and size are validated server-side; violations return clear errors
- [ ] User can trigger a MiniMax cover/re-style generation from the uploaded source
- [ ] UI labels the feature as "Cover / Re-style", not "Generate around reference"
- [ ] Generated child asset is connected to source asset through `take_edges` with `cover_restyle` branch type
- [ ] Lyrics are optional in cover/re-style mode (provider-side extraction if omitted)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Streaming & Live Delivery

---

### US-009: Backend Generation Workflow

**Description:** As a system, I need to process generation jobs durably so that user requests produce persisted audio assets.

**Acceptance Criteria:**
- [ ] Cloudflare Workflow consumes job messages from Queue
- [ ] Workflow calls MiniMax adapter with `stream=true` where supported
- [ ] Workflow updates job/asset status through each transition: `created` -> `queued` -> `generating` -> `receiving_audio` -> `persisting` -> `ready`
- [ ] Workflow assembles hex-encoded audio chunks into final audio bytes
- [ ] Workflow persists final file to R2
- [ ] Workflow updates `audio_asset.r2_object_key`, `duration_sec`, `format`, `sample_rate`
- [ ] On failure, job and asset transition to `failed` with `error_json` and `error_code`
- [ ] Failed jobs are immutable; retry creates a new job and new asset
- [ ] If non-streaming URL fallback is used, workflow fetches URL immediately and persists to R2 (URL is never stored as canonical source)
- [ ] Quota reservation is committed on success, released on failure before provider consumption
- [ ] Typecheck/lint passes

---

### US-010: SSE Live Status Updates

**Description:** As a creator, I want to see real-time status updates for my generation so that the workspace feels responsive.

**Acceptance Criteria:**
- [ ] SvelteKit SSE endpoint streams job status changes to the client
- [ ] Client receives status transitions: queued, generating, receiving_audio, persisting, ready, failed
- [ ] SSE connection is per-project or per-job
- [ ] Client updates block card UI reactively on each status change
- [ ] SSE endpoint validates session ownership (user can only subscribe to their own jobs)
- [ ] Connection drops are handled gracefully with automatic reconnection
- [ ] Typecheck/lint passes

---

### US-011: Live Audio Streaming Playback

**Description:** As a creator, I want to hear the result while MiniMax streams the final output chunks so that I do not wait silently.

**Acceptance Criteria:**
- [ ] Workflow forwards audio chunks to the client SSE channel as they arrive
- [ ] Client assembles chunks into a playable buffer using the audio engine
- [ ] Block card shows a "Live" indicator while receiving audio
- [ ] User can listen to partial audio before generation completes
- [ ] The live-listening stream is not labeled as a separate preview artifact
- [ ] If live listening fails but worker persistence succeeds, the asset still becomes `ready`
- [ ] If the stream breaks before a valid file can be assembled, job and asset transition to `failed`
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-012: Pending and Progress Block States

**Description:** As a creator, I want to see clear visual states for each generation so that I know what's happening.

**Acceptance Criteria:**
- [ ] Queued block appears immediately after submit with "Queued" badge
- [ ] Generating block shows spinner and "Generating..." status
- [ ] Receiving audio block shows "Receiving audio..." with live-listen player when chunks are playable
- [ ] Persisting block shows "Saving..."
- [ ] Ready block shows full controls (play, add to arrangement, branch, export)
- [ ] Failed block shows error summary and "Retry" button
- [ ] Retry creates a new generation job (does not mutate the failed job)
- [ ] Cancel is available only before provider submission (while status is `queued`)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Vertical Workspace

---

### US-013: Vertical Block Workspace

**Description:** As a creator, I want generated assets to appear as vertical blocks so that I can manage ideas without a complicated DAW timeline.

**Acceptance Criteria:**
- [ ] Assets are displayed as vertical cards in a scrollable list
- [ ] Each card shows: waveform visualization, title, duration, provider badge, prompt summary
- [ ] Waveform is rendered using wavesurfer.js (visualization only, not audio playback control)
- [ ] User can rename a block by tapping the title
- [ ] Ready block card includes: play preview, add to arrangement, create variation, cover/re-style, export
- [ ] Block cards show "Derived from: [parent title]" badge when applicable
- [ ] Block cards show "N variations" link when children exist
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Arrangement & Audio Engine

---

### US-014: Audio Engine Foundation

**Description:** As a developer, I need a headless audio engine module so that all audio behavior is isolated from Svelte components.

**Acceptance Criteria:**
- [ ] Audio engine module lives at `/lib/audio-engine/`
- [ ] Engine implements the `AudioEngine` interface (loadAsset, unloadAsset, play, pause, stop, seek, dispose, per-clip controls)
- [ ] Svelte components never directly instantiate `AudioContext`
- [ ] Engine manages its own `AudioContext` lifecycle (create on first interaction, suspend/resume, dispose)
- [ ] Engine can load an audio buffer from a URL (R2 signed URL)
- [ ] Engine can play a single loaded asset
- [ ] Engine exposes reactive transport state: `currentTime`, `isPlaying`, `duration`
- [ ] Engine can be tested with mocked buffers and fake clocks
- [ ] Typecheck/lint passes

---

### US-015: Global Transport Controls

**Description:** As a creator, I want play/pause/stop controls so that I can audition my arrangement.

**Acceptance Criteria:**
- [ ] Transport bar shows: Play, Pause, Stop buttons
- [ ] Transport bar shows current time and total arrangement length
- [ ] Play starts all audible clips from current position using shared clock
- [ ] Pause freezes playback at current position
- [ ] Stop resets transport to 0:00
- [ ] Transport state is driven by the audio engine, not by component state
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-016: Add Blocks to Arrangement

**Description:** As a creator, I want to add generated blocks to the arrangement so that I can stack and layer them.

**Acceptance Criteria:**
- [ ] Ready block card includes "Add to arrangement" button
- [ ] Clicking creates an `arrangement_clip` row linked to the audio asset
- [ ] New clip defaults: `start_time_sec=0`, `trim_start_sec=0`, `trim_end_sec=null` (full length), `clip_duration_sec=asset.duration_sec`, `gain_db=0`, `muted=false`, `soloed=false`
- [ ] Clip appears as an arrangement clip card in the arrangement stack
- [ ] Same asset can be added to arrangement multiple times (creates separate clips)
- [ ] Arrangement clip card shows: title, waveform, start offset, trim handles, loop drag edge, gain slider, mute, solo, remove button, layer order controls
- [ ] Removing a clip from arrangement deletes the clip row but not the source asset
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-017: Synchronized Multi-Clip Playback

**Description:** As a creator-plus user, I want multiple clips to play simultaneously from a shared transport so that I can audition layered arrangements.

**Acceptance Criteria:**
- [ ] Audio engine schedules all non-muted, non-solo-excluded clips on the same `AudioContext` clock
- [ ] Each clip's `start_time_sec` determines when it begins relative to the transport
- [ ] Clips that start later than transport position are scheduled to begin at the correct time
- [ ] Multiple clips playing simultaneously are summed (mixed) by the AudioContext graph
- [ ] Adding/removing clips while stopped updates the arrangement without playback glitches
- [ ] Arrangement store (`/lib/stores/arrangement.svelte.ts`) is the live source of truth; engine consumes it reactively
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-018: Clip Start Offset

**Description:** As a creator, I want to choose when a block starts relative to the arrangement so that blocks do not all begin at the same time.

**Acceptance Criteria:**
- [ ] Arrangement clip card shows start time with numeric +/- step controls (mobile-friendly)
- [ ] Step increment is 0.5 seconds
- [ ] Minimum start time is 0
- [ ] Start offset is reflected in synchronized playback (clip begins at `start_time_sec` on the transport)
- [ ] Start offset is reflected in rough mixdown export
- [ ] Changed value is persisted via debounced DB write
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-019: Non-Destructive Trimming

**Description:** As a creator, I want to trim a block without permanently deleting the underlying audio so that I can experiment freely.

**Acceptance Criteria:**
- [ ] Arrangement clip card exposes trim start and trim end controls
- [ ] Trim can be set via drag handles on the waveform or via numeric inputs
- [ ] Original audio asset remains unchanged (trim state stored on the clip, not the asset)
- [ ] Playback respects trim state (only plays the trimmed region)
- [ ] Export respects trim state
- [ ] Trimming updates `clip_duration_sec` if trim shortens the clip below its current duration
- [ ] Changed values are persisted via debounced DB write
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-020: Drag-to-Extend Looping

**Description:** As a creator, I want to drag the right edge of a clip's waveform to extend it so that the audio loops, just like extending a clip in a DAW.

**Acceptance Criteria:**
- [ ] Arrangement clip waveform has a draggable right edge handle
- [ ] Dragging the right edge past the source audio's trimmed length causes the waveform to visually repeat
- [ ] Partial loops are supported (user can stop at e.g. 2.5 repetitions)
- [ ] `clip_duration_sec` stores the total playback length including loop repetitions
- [ ] If `clip_duration_sec > trimmed audio length`, audio loops within the region; otherwise no looping occurs
- [ ] Audio engine implements seamless looping of the trimmed region within `clip_duration_sec`
- [ ] Arrangement length = max of all `(start_time_sec + clip_duration_sec)` across clips; always finite
- [ ] Looping is reflected in rough mixdown export
- [ ] Changed value is persisted via debounced DB write
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-021: Volume, Mute, and Solo

**Description:** As a creator, I want basic mix controls so that I can make stacked blocks listenable.

**Acceptance Criteria:**
- [ ] Each arrangement clip has a gain slider (dB)
- [ ] Each clip has a mute toggle button
- [ ] Each clip has a solo toggle button
- [ ] Solo semantics: if no clips are soloed, all non-muted clips are audible
- [ ] Solo semantics: if one or more clips are soloed, only soloed clips are audible
- [ ] Solo semantics: multiple soloed clips play simultaneously
- [ ] Solo semantics: mute state persists while solo is active; solo does not erase mute
- [ ] Solo semantics: when all solos are cleared, prior mute states resume
- [ ] Gain, mute, and solo are routed through the headless audio engine (not component-level)
- [ ] Changed values are persisted via debounced DB write
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-022: Arrangement State Persistence

**Description:** As a creator, I want my arrangement edits to be saved automatically so that I can close the browser and return to my work.

**Acceptance Criteria:**
- [ ] `/lib/stores/arrangement.svelte.ts` is the live source of truth for arrangement UI/audio state
- [ ] Clip edits (start offset, trim, loop, gain, mute, solo) trigger debounced DB writes (500ms-1000ms debounce)
- [ ] Destructive actions (remove clip) persist immediately with confirmation
- [ ] On project open, arrangement store is hydrated from DB
- [ ] DB is the persistence layer, not the live interaction source
- [ ] Audio engine is a consumer/executor of state, not the owner of state
- [ ] Typecheck/lint passes

---

### Iteration & Branching

---

### US-023: Prompt Variation

**Description:** As a creator, I want to create a variation from an existing block so that I can keep exploring without losing the original.

**Acceptance Criteria:**
- [ ] Ready block card includes "Create variation" action
- [ ] Generate panel opens with prompt and lyrics prefilled from parent block
- [ ] User can edit prompt or lyrics before submitting
- [ ] New generation creates a child asset connected via `take_edges` with `prompt_variation` branch type
- [ ] Parent block's "N variations" count updates
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-024: Cover / Re-style From Existing Asset

**Description:** As a creator, I want to use an existing ready asset as the source for a cover/re-style generation so that I can transform a strong result.

**Acceptance Criteria:**
- [ ] Ready block card includes "Cover / Re-style" action
- [ ] MiniMax adapter receives the correct source-audio input (R2-stored file, not a provider URL)
- [ ] Generated child asset is connected via `take_edges` with `cover_restyle` branch type
- [ ] Parent and child relationship is visible in the workspace (badges/links)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-025: Take DAG Display

**Description:** As a creator, I want to see which blocks are derived from which so that I can navigate my generation history.

**Acceptance Criteria:**
- [ ] Each block card shows "Derived from: [parent title]" badge if it has a parent edge
- [ ] Each block card shows "N variations" link if it has child edges
- [ ] Tapping "Derived from" scrolls to or highlights the parent block
- [ ] Tapping "N variations" filters or scrolls to show child blocks
- [ ] Deleting/hiding one variation does not delete siblings
- [ ] Take graph cycles are prevented at the service layer with tests
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Export

---

### US-026: Export Individual Block

**Description:** As a creator, I want to download an individual generated block so that I can use it elsewhere.

**Acceptance Criteria:**
- [ ] Ready block card includes "Export" / download button
- [ ] Export serves the durable R2-backed source file
- [ ] Download preserves the provider-backed source format (e.g., MP3 from MiniMax)
- [ ] UI displays the available format and does not claim "lossless" unless actually lossless
- [ ] Downloaded file name includes the block title
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### US-027: Export Rough Mixdown — Snapshot & Render

**Description:** As a creator, I want to export my stacked arrangement as a rough mix so that I can share or continue editing elsewhere.

**Acceptance Criteria:**
- [ ] Arrangement stack includes an "Export rough mix" button (also accessible from transport bar)
- [ ] On export, browser builds a typed `ArrangementSnapshotV1` from current arrangement state
- [ ] Snapshot includes all clips with: clipId, assetId, sourceUrl, startTimeSec, trimStartSec, trimEndSec, clipDurationSec, gainDb, muted, soloed, layerOrder
- [ ] Snapshot is validated against the V1 schema before rendering
- [ ] Browser loads all required audio buffers
- [ ] Browser renders mix using `OfflineAudioContext` respecting: start offsets, trims, drag-to-extend loops, gain, mute, solo
- [ ] Output format: WAV 44.1kHz / 16-bit
- [ ] User downloads the rendered file
- [ ] Export is labeled "Rough Mixdown" (not "mastered" or "final")
- [ ] Optional: browser uploads rendered file to R2 and creates `rendered_export` asset (stretch goal)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Quota & Rate Limiting

---

### US-028: Daily Generation Quota

**Description:** As a user, I want to know how many generations I have left today so that I can plan my creative session.

**Acceptance Criteria:**
- [ ] Authenticated users have a fixed daily generation limit (configurable, e.g., 10/day)
- [ ] Unauthenticated users have a lower session limit (3 per session)
- [ ] Each generation request creates a `quota_reservation` with 10-minute TTL and `reserved` status
- [ ] Reservation uses `idempotency_key` to prevent double-reservation from repeated clicks
- [ ] On job success, reservation transitions to `committed`
- [ ] On job failure before provider consumption, reservation transitions to `released`
- [ ] Cloudflare Cron Trigger runs every 5 minutes to expire stale reservations
- [ ] UI shows remaining daily generations (e.g., "7 of 10 remaining today")
- [ ] When limit is reached, generate button is disabled with message: "Daily limit reached. Resets at [time in user's timezone]"
- [ ] Daily limit resets at midnight UTC (or configurable)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Security & Ownership

---

### US-029: RLS Ownership Isolation

**Description:** As a user, I want to be certain that no other user can access my projects, assets, or arrangements.

**Acceptance Criteria:**
- [ ] All user-owned tables (`projects`, `audio_assets`, `arrangement_clips`, `take_edges`, `generation_jobs`, `quota_reservations`, `export_jobs`, `provider_events`) include `owner_id` column
- [ ] RLS is enabled on all user-owned tables
- [ ] RLS policies reference `current_setting('app.user_id', true)`
- [ ] Every SvelteKit endpoint sets `SET LOCAL app.user_id = '<authenticated-user-id>'` before data access
- [ ] Application-layer ownership checks exist in addition to RLS
- [ ] Provider API keys are never exposed client-side
- [ ] R2 object URLs are signed or access-controlled
- [ ] Upload routes enforce file size (50MB) and type (MP3, WAV, M4A, FLAC) restrictions server-side
- [ ] Logs never expose provider API keys or raw secrets
- [ ] Typecheck/lint passes

---

## Functional Requirements

- FR-01: All provider calls go through `/lib/providers/minimax/` via the typed `MusicProvider` adapter; no direct MiniMax calls from UI, stores, or route handlers
- FR-02: Provider registry defines `minimax` (enabled), `elevenlabs` (stub, disabled), `stability` (stub, disabled)
- FR-03: All MiniMax requests pass through `/lib/providers/minimax/validateMusicRequest.ts`; no ad-hoc validation elsewhere
- FR-04: MiniMax streaming hex mode is the default; non-streaming URL fallback fetches and persists to R2 immediately (URL never stored as canonical source)
- FR-05: Audio assets are separate from arrangement clips; assets represent "what the audio is," clips represent "how it's used"
- FR-06: All arrangement edits are non-destructive; trim, loop, and gain live on the clip, not the source asset
- FR-07: Take relationships use the `take_edges` table (edge table, not parent/child columns on assets)
- FR-08: Failed generation jobs are immutable; retry always creates a new job
- FR-09: Svelte components never instantiate `AudioContext`; all audio routes through `/lib/audio-engine/`
- FR-10: wavesurfer.js is used for waveform visualization only, not for audio playback or arrangement state
- FR-11: Arrangement store (`/lib/stores/arrangement.svelte.ts`) is the live source of truth; DB is the persistence layer; audio engine is a consumer
- FR-12: Client-side rough mixdown uses `OfflineAudioContext`; server-side mixdown is post-V1
- FR-13: Quota reservation must precede every generation; no generation without a reservation
- FR-14: SSE endpoint delivers job status updates and optionally audio chunks to the client
- FR-15: All user-owned tables enforce ownership via Postgres RLS
- FR-16: Daily generation quotas reset at midnight UTC; UI displays remaining count and reset time

## Non-Goals (Out of Scope)

- No inpainting (regenerating a selected section while preserving surrounding context)
- No outpainting (extending audio by generating continuation from end context)
- No stem separation
- No destructive waveform editing
- No horizontal DAW timeline, beat-grid warping, or quantized clip launching
- No pan control (deferred to post-V1)
- No multi-provider runtime support beyond registry stubs
- No server-side mixdown renderer
- No professional-grade render guarantees or mastering
- No lossless source quality guarantees
- No multi-project support (V1.1)
- No OAuth / social login (V1.1)
- No real-time collaborative editing
- No rights/consent workflow beyond Terms of Service
- No exact preservation of an instrumental bed while changing lyrics
- No tempo detection, beat-aware trimming, or auto-loop repair
- No claiming temp project on sign-up (stretch goal, not required)

## Design Considerations

### Main Workspace Layout

Mobile-first vertical stack. Primary regions:

1. **Persistent banner** (unauthenticated users only): sign-up CTA with rate limit info
2. **Project header**: title (editable), quota remaining, sign-out
3. **Generate panel**: prompt, instrumental toggle, lyrics, structure tags, cover/re-style upload, generate button
4. **Asset list**: vertical cards of all generated/uploaded assets
5. **Arrangement transport**: play/pause/stop, current time, arrangement length, export rough mix
6. **Arrangement stack**: clip cards with waveform, controls, drag handles

### Mobile Gesture Vocabulary

- Tap = primary action / select / play (context-dependent)
- Long press = context menu
- Swipe left on card = remove/delete confirmation
- Chevrons = reorder visual layer order
- Drag handles on waveform left edge = trim
- Drag handle on waveform right edge = extend/loop
- Numeric +/- stepper = start offset

Consistent gesture vocabulary across all card types.

### Block Card States

| State | Visual |
|-------|--------|
| Queued | Gray card, "Queued" badge, spinner |
| Generating | Gray card, "Generating..." badge, spinner |
| Receiving audio | Blue card, "Live" badge, playable partial player |
| Persisting | Blue card, "Saving..." badge |
| Ready | Full card, waveform, all controls |
| Failed | Red card, error summary, retry button |

## Technical Considerations

### Stack

- **Frontend**: Svelte 5 (runes), SvelteKit 2, Tailwind CSS, shadcn-svelte — all pinned versions
- **Runtime**: Cloudflare Pages/Workers, Queues, Workflows, Cron Triggers
- **Database**: Neon Serverless Postgres, Drizzle ORM, BetterAuth
- **Storage**: Cloudflare R2
- **Audio**: Headless Web Audio engine, `OfflineAudioContext` for export, wavesurfer.js for waveform visualization

### Database Schema

See `v_1_minimax_web_studio_prd.md` sections 11.1-11.9 for full SQL schema. Key changes from that document for this final PRD:

- `arrangement_clips.loop_enabled` is **removed**
- `arrangement_clips.pan` is **removed** (post-V1)
- `arrangement_clips.clip_duration_sec numeric not null` is **added** (defaults to asset duration; when greater than trimmed length, audio loops)

### State Machines

All status transitions follow the state machines defined in `v_1_minimax_web_studio_prd.md` section 13. Key rules:
- Failed -> queued/generating is forbidden (retry creates new job)
- Ready -> failed is forbidden
- Succeeded -> failed is forbidden
- Committed quota cannot be released; expired quota cannot be committed

### MiniMax Validation Test Matrix

Required test cases (see `v_1_minimax_web_studio_prd.md` section 9.3):
- Prompt + instrumental + no lyrics -> valid
- Prompt + instrumental + lyrics -> invalid (clear error, not silent ignore)
- Prompt + non-instrumental + lyrics -> valid
- Prompt + non-instrumental + no lyrics + optimizer on -> valid
- Prompt + non-instrumental + no lyrics + optimizer off -> invalid
- Empty prompt -> invalid
- Unsupported structure tag -> warning
- Cover/re-style with source -> valid
- Cover/re-style without source -> invalid

### Implementation Order

1. Schema migration-zero (all tables, constraints, RLS)
2. RLS policies
3. MiniMax request validator with tests
4. MiniMax adapter with mocked tests
5. Generation job state machine
6. Quota reservation state machine
7. Audio engine with mocked tests
8. Arrangement store
9. UI components
10. SSE live updates
11. E2E tests
12. Real MiniMax integration
13. R2 persistence
14. Client-side export

### E2E Test Files

Each MVP criterion maps to a named test file:

1. `tests/e2e/auth-signup-signin.spec.ts`
2. `tests/e2e/temp-project-unauthenticated.spec.ts`
3. `tests/e2e/project-create.spec.ts`
4. `tests/e2e/generate-text-to-music.spec.ts`
5. `tests/e2e/generate-instrumental.spec.ts`
6. `tests/e2e/generate-lyrics-structure.spec.ts`
7. `tests/e2e/cover-restyle-source.spec.ts`
8. `tests/e2e/streaming-hex-live-listen.spec.ts`
9. `tests/e2e/r2-persistence.spec.ts`
10. `tests/e2e/vertical-blocks.spec.ts`
11. `tests/e2e/add-multiple-blocks-to-arrangement.spec.ts`
12. `tests/e2e/synchronized-stacked-playback.spec.ts`
13. `tests/e2e/clip-start-offset.spec.ts`
14. `tests/e2e/non-destructive-trim.spec.ts`
15. `tests/e2e/drag-to-extend-loop.spec.ts`
16. `tests/e2e/clip-volume.spec.ts`
17. `tests/e2e/mute-solo-semantics.spec.ts`
18. `tests/e2e/take-variation-branch.spec.ts`
19. `tests/e2e/export-individual-block.spec.ts`
20. `tests/e2e/export-rough-mixdown.spec.ts`
21. `tests/e2e/provider-boundary.spec.ts`
22. `tests/e2e/provider-registry-stubs.spec.ts`
23. `tests/e2e/no-component-audiocontext.spec.ts`
24. `tests/e2e/ownership-rls.spec.ts`
25. `tests/e2e/daily-quota-limit.spec.ts`

## Success Metrics

- User can go from landing to hearing generated audio in under 60 seconds (including generation time)
- User can hear streamed audio before generation completes
- User can stack 3+ blocks and play them simultaneously without audible glitches
- User can create a variation in under 3 clicks from a ready block
- User can export a rough mixdown in under 5 clicks
- Daily quota limit and reset time are visible at all times for authenticated users
- No user can access another user's project, assets, or clips (verified by E2E test)
- All provider calls are isolated behind the adapter boundary (verified by architectural E2E test)

## Open Questions

1. **Temp project claiming on sign-up**: Should signing up automatically adopt the temp project's assets into the new user's project? Marked as stretch goal — decide during implementation if effort is low.
2. **Waveform peak computation**: Browser-side computation for MVP. If mobile performance is unacceptable, move to an ingest pipeline with peaks stored in R2. Monitor during testing.
3. **SSE vs polling fallback**: SSE is the primary mechanism. Should there be a polling fallback for environments where SSE is unreliable? Decide during integration testing.
4. **Daily limit value**: What is the right default? Start with 10/day for authenticated users, 3/session for guests, and adjust based on MiniMax cost data.
5. **Audio format from MiniMax**: Confirm whether MiniMax Music 2.6 streaming hex output is MP3, AAC, or WAV. This affects export quality claims and format display.
