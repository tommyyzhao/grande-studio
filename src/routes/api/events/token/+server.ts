import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEffectiveUserId } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';
import { signEventsToken } from '$lib/services/events-token';
import { env as privateEnv } from '$env/dynamic/private';

const PROD_WORKER_EVENTS_URL =
	'https://grande-studio-inngest.tzpersonal.workers.dev/api/events';

/**
 * Mints a short-lived HMAC token for the cross-origin SSE endpoint, plus
 * the absolute URL the client should connect to. In dev the URL is
 * relative — Pages /api/events serves the stream itself so the dev loop
 * stays single-process; in prod it points at the standalone Worker.
 */
export const GET: RequestHandler = async (event) => {
	const { locals } = event;
	const env = getEnv(event);
	const isDev = privateEnv.INNGEST_DEV === '1' || process.env.INNGEST_DEV === '1';

	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required.' });
	}

	const secret = env.EVENTS_TOKEN_SECRET;
	if (!secret) {
		error(500, { message: 'Events token signing is not configured.' });
	}

	const { token, expiresAt } = await signEventsToken(userId, secret);
	const baseUrl = isDev ? '/api/events' : PROD_WORKER_EVENTS_URL;
	const url = `${baseUrl}?token=${encodeURIComponent(token)}`;

	return json({ url, token, expiresAt });
};
