/**
 * Standalone Cloudflare Worker that hosts long-running endpoints.
 *
 * Cloudflare Pages Functions silently kill requests that hold a connection
 * past ~30s CPU / ~3 min wall, which is below both what MiniMax music
 * generation needs (1-3 min) and what the SSE status stream needs (open
 * indefinitely). Standalone Workers on the Paid plan honor
 * `[limits] cpu_ms = 300000`, so both endpoints live here.
 *
 * Routes:
 *   POST /api/inngest   — Inngest webhook (generation + quota cron)
 *   GET  /api/events    — SSE status stream (token-authed; cookie can't
 *                         cross from grande-studio.pages.dev)
 *
 * Pages keeps serving the SvelteKit app, audio fetch, and the cookie-authed
 * /api/events/token mint endpoint.
 */
import { serve } from 'inngest/cloudflare';
import { inngest } from '../src/lib/server/inngest/client';
import { generationFunction, quotaExpiryFunction } from '../src/lib/server/inngest/functions';
import { inngestEnvContext } from '../src/lib/server/inngest/context';
import { createNeonDb, createLocalDb } from '../src/lib/server/db';
import { buildEventStream } from '../src/lib/server/events/event-stream';
import { verifyEventsToken } from '../src/lib/services/events-token';
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

const ALLOWED_ORIGIN = 'https://grande-studio.pages.dev';

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

async function handleEvents(request: Request, env: WorkerEnv): Promise<Response> {
	const url = new URL(request.url);
	const token = url.searchParams.get('token');
	if (!token) {
		return new Response(JSON.stringify({ error: 'token required' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
		});
	}

	const verified = await verifyEventsToken(token, env.R2_SIGNING_SECRET ?? '');
	if (!verified) {
		return new Response(JSON.stringify({ error: 'invalid or expired token' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
		});
	}

	const dbUrl = env.DATABASE_URL ?? '';
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const stream = buildEventStream({
		db,
		userId: verified.userId,
		liveKv: env.LIVE_KV,
		signal: request.signal
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
			'X-Accel-Buffering': 'no'
		}
	});
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/inngest' || url.pathname.startsWith('/api/inngest/')) {
			return inngestEnvContext.run(buildWorkflowEnv(env), () =>
				inngestHandler(request, env as Record<string, string | undefined>)
			);
		}

		if (url.pathname === '/api/events') {
			return handleEvents(request, env);
		}

		return new Response('grande-studio inngest worker', {
			status: 200,
			headers: { 'content-type': 'text/plain' }
		});
	}
};
