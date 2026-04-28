/**
 * Standalone Cloudflare Worker that serves /api/inngest.
 *
 * Why this exists: Cloudflare Pages Functions silently ignore
 * `[limits] cpu_ms` from wrangler config and cap execution around ~30s CPU /
 * ~3 min wall, which is below the 1-3 min held connection MiniMax music
 * generation needs. Standalone Workers on the Paid plan honor the limits
 * setting up to 300_000 ms (5 min) of CPU time, so the long-running Inngest
 * function lives here instead of the Pages project. Pages still serves the
 * SvelteKit app; only the Inngest webhook is split out.
 *
 * Inngest cloud's app URL is pointed at this worker's `/api/inngest`. The
 * SvelteKit app continues to send events via `inngest.send()` (HTTP to
 * inngest.com), so `/api/generate` does not depend on this worker being up.
 */
import { serve } from 'inngest/cloudflare';
import { inngest } from '../src/lib/server/inngest/client';
import { generationFunction, quotaExpiryFunction } from '../src/lib/server/inngest/functions';
import { inngestEnvContext } from '../src/lib/server/inngest/context';
import type { WorkflowEnv } from '../src/lib/server/workflow/types';
import type { R2BucketLike } from '../src/lib/services/r2-storage';
import type { KVNamespaceLike } from '../src/lib/services/live-chunks';

interface WorkerEnv {
	AUDIO_BUCKET: R2BucketLike;
	LIVE_KV?: KVNamespaceLike;
	DATABASE_URL?: string;
	MINIMAX_API_KEY?: string;
	R2_SIGNING_SECRET?: string;
	BETTER_AUTH_URL?: string;
	INNGEST_EVENT_KEY?: string;
	INNGEST_SIGNING_KEY?: string;
}

const inngestHandler = serve({
	client: inngest,
	functions: [generationFunction, quotaExpiryFunction]
});

function buildWorkflowEnv(env: WorkerEnv): WorkflowEnv {
	return {
		DATABASE_URL: env.DATABASE_URL,
		MINIMAX_API_KEY: env.MINIMAX_API_KEY,
		R2_SIGNING_SECRET: env.R2_SIGNING_SECRET ?? '',
		BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? '',
		AUDIO_BUCKET: env.AUDIO_BUCKET,
		LIVE_KV: env.LIVE_KV
	};
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const url = new URL(request.url);
		const isInngestRoute =
			url.pathname === '/api/inngest' || url.pathname.startsWith('/api/inngest/');

		if (!isInngestRoute) {
			return new Response('grande-studio inngest worker', {
				status: 200,
				headers: { 'content-type': 'text/plain' }
			});
		}

		return inngestEnvContext.run(buildWorkflowEnv(env), () =>
			inngestHandler(request, env as Record<string, string | undefined>)
		);
	}
};
