// ─── Custom Worker Entry Point ───────────────────────────────────────────────
//
// This file wraps the SvelteKit-generated worker and adds Cloudflare Queue
// consumer and Scheduled (cron) handlers that the adapter cannot generate.
//
// ─── HOW TO WIRE THIS IN ─────────────────────────────────────────────────────
//
// The project currently uses `pages_build_output_dir` in wrangler.jsonc, which
// means it deploys as Cloudflare Pages. Pages only supports the `fetch` handler
// and does NOT support queue consumers or cron triggers.
//
// To enable queue + scheduled handlers, migrate from Pages to Workers mode:
//
// 1. In wrangler.jsonc, replace:
//      "pages_build_output_dir": ".svelte-kit/cloudflare"
//    with:
//      "main": ".svelte-kit/cloudflare/_worker.js",
//      "assets": { "directory": ".svelte-kit/cloudflare", "binding": "ASSETS" }
//
// 2. After the SvelteKit build (`npm run build`), bundle this entry point
//    so that it re-exports the SvelteKit fetch handler alongside queue and
//    scheduled handlers. One approach:
//
//    a) Change wrangler.jsonc "main" to point to a post-build bundled version
//       of this file (e.g. ".svelte-kit/cloudflare/worker-entry.js").
//
//    b) Add a post-build script that bundles this file, replacing the
//       SvelteKit _worker.js import with the actual built path.
//
// 3. Alternatively, deploy a separate "queue worker" that handles only
//    queue + cron, bound to the same queue and cron triggers. This avoids
//    modifying the SvelteKit deployment at all.
//
// ─── CURRENT STATUS ──────────────────────────────────────────────────────────
//
// This file is NOT automatically wired into the build. It serves as the
// reference implementation for when the project migrates to Workers mode.
// The queue and scheduled handlers are fully functional — they just need
// to be exported from the actual worker entry point.
//
// ─────────────────────────────────────────────────────────────────────────────

import { handleGenerationQueue } from './src/lib/server/workflow/queue-handler';
import { handleScheduled } from './src/lib/server/workflow/scheduled-handler';
import type { GenerationQueueMessage, MessageBatchLike, WorkflowEnv } from './src/lib/server/workflow/types';

// Re-export the SvelteKit-generated fetch handler as the default export.
// When wired in, change this import path to match the actual build output.
// For Workers mode: ".svelte-kit/cloudflare/_worker.js"
export { default } from './.svelte-kit/cloudflare/_worker.js';

// ─── Queue Consumer ──────────────────────────────────────────────────────────
// Processes generation queue messages. Configured in wrangler.jsonc under
// `queues.consumers`. Each message triggers a music generation workflow.

export async function queue(
	batch: MessageBatchLike<GenerationQueueMessage>,
	env: WorkflowEnv
): Promise<void> {
	return handleGenerationQueue(batch, env);
}

// ─── Scheduled (Cron) Handler ────────────────────────────────────────────────
// Runs on the cron schedule defined in wrangler.jsonc `triggers.crons`.
// Currently expires stale quota reservations every 5 minutes.

export async function scheduled(
	event: { cron: string; scheduledTime: number },
	env: WorkflowEnv,
	ctx: { waitUntil(promise: Promise<unknown>): void }
): Promise<void> {
	ctx.waitUntil(handleScheduled(env));
}
