import { getAuth } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';
import type { RequestHandler } from './$types';

const handleRequest: RequestHandler = async (event) => {
	const env = getEnv(event);
	const auth = getAuth(env.DATABASE_URL, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL);

	// Delegate to BetterAuth's handler
	return auth.handler(event.request);
};

export const GET = handleRequest;
export const POST = handleRequest;
