import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { getEffectiveUserId } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';
import { buildEventStream } from '$lib/server/events/event-stream';
import { verifyEventsToken } from '$lib/services/events-token';
import { env as privateEnv } from '$env/dynamic/private';

/**
 * SSE endpoint. In production this is served from the standalone Worker
 * (see worker/inngest-worker.ts) — Pages Functions kill the long-poll.
 * Local dev (INNGEST_DEV=1) runs it from here so the dev workflow stays
 * single-process. Token auth is accepted in both modes; cookie auth as
 * a fallback for dev.
 */
export const GET: RequestHandler = async (event) => {
	const { locals, url, request } = event;
	const env = getEnv(event);
	const isDev = privateEnv.INNGEST_DEV === '1' || process.env.INNGEST_DEV === '1';

	if (!isDev) {
		return new Response(
			JSON.stringify({
				error: 'gone',
				message:
					'/api/events in production is served by the standalone Worker. Mint a token via /api/events/token and connect to its url.'
			}),
			{ status: 410, headers: { 'Content-Type': 'application/json' } }
		);
	}

	let userId: string | null = null;

	const token = url.searchParams.get('token');
	if (token) {
		const verified = await verifyEventsToken(token, env.R2_SIGNING_SECRET ?? '');
		if (verified) userId = verified.userId;
	}

	if (!userId) {
		userId = getEffectiveUserId(locals);
	}

	if (!userId) {
		error(401, { message: 'Session required. Please sign in or refresh the page.' });
	}

	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const stream = buildEventStream({
		db,
		userId,
		liveKv: env.LIVE_KV,
		signal: request.signal
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
