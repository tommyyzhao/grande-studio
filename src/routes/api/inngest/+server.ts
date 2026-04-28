import { serve } from 'inngest/sveltekit';
import type { RequestHandler } from './$types';
import { inngest } from '$lib/server/inngest/client';
import { generationFunction, quotaExpiryFunction } from '$lib/server/inngest/functions';
import { inngestEnvContext } from '$lib/server/inngest/context';
import { createLocalR2Bucket } from '$lib/server/local-r2';
import { env as privateEnv } from '$env/dynamic/private';
import type { WorkflowEnv } from '$lib/server/workflow/types';
import type { R2BucketLike } from '$lib/services/r2-storage';
import type { KVNamespaceLike } from '$lib/services/live-chunks';

const handler = serve({
	client: inngest,
	functions: [generationFunction, quotaExpiryFunction]
});

/** Production routes Inngest traffic to the standalone Worker; only local
 * dev (INNGEST_DEV=1) actually services /api/inngest from Pages. Returning
 * 410 to anything else prevents an accidental sync from re-registering
 * Pages as the active app URL — that footgun would silently break
 * generation again because Pages Functions kill the long-running stream. */
function goneResponse(): Response {
	return new Response(
		JSON.stringify({
			error: 'gone',
			message:
				'/api/inngest in production is served by the standalone Worker at https://grande-studio-inngest.tzpersonal.workers.dev/api/inngest'
		}),
		{ status: 410, headers: { 'Content-Type': 'application/json' } }
	);
}

function isDev(): boolean {
	return privateEnv.INNGEST_DEV === '1' || process.env.INNGEST_DEV === '1';
}

/** Build per-request WorkflowEnv from platform bindings + private env. */
function buildEnv(platform: App.Platform | undefined): WorkflowEnv {
	const isDev = privateEnv.INNGEST_DEV === '1' || process.env.INNGEST_DEV === '1';
	const platformEnv = (platform?.env ?? {}) as Record<string, unknown>;
	return {
		DATABASE_URL: (platformEnv.DATABASE_URL as string) ?? privateEnv.DATABASE_URL,
		MINIMAX_API_KEY: (platformEnv.MINIMAX_API_KEY as string) ?? privateEnv.MINIMAX_API_KEY,
		R2_SIGNING_SECRET:
			(platformEnv.R2_SIGNING_SECRET as string) ?? privateEnv.R2_SIGNING_SECRET ?? '',
		BETTER_AUTH_URL:
			(platformEnv.BETTER_AUTH_URL as string) ??
			privateEnv.BETTER_AUTH_URL ??
			'http://localhost:5183',
		AUDIO_BUCKET: isDev
			? createLocalR2Bucket()
			: ((platformEnv.AUDIO_BUCKET as R2BucketLike) ?? createLocalR2Bucket()),
		LIVE_KV: platformEnv.LIVE_KV as KVNamespaceLike | undefined
	};
}

export const GET: RequestHandler = (event) =>
	isDev()
		? inngestEnvContext.run(buildEnv(event.platform), () => handler.GET(event))
		: goneResponse();
export const POST: RequestHandler = (event) =>
	isDev()
		? inngestEnvContext.run(buildEnv(event.platform), () => handler.POST(event))
		: goneResponse();
export const PUT: RequestHandler = (event) =>
	isDev()
		? inngestEnvContext.run(buildEnv(event.platform), () => handler.PUT(event))
		: goneResponse();
