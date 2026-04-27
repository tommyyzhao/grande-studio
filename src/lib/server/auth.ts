import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createLocalDb, createNeonDb } from './db';
import * as authSchema from './db/auth-schema';

/**
 * Build a BetterAuth instance for the current request.
 *
 * Cloudflare Workers reject I/O objects (DB connections, streams) that were
 * created in a different request's handler. The DB driver — and therefore the
 * auth instance that closes over it — must be constructed per-request, not
 * cached at module scope.
 */
export function getAuth(dbUrl: string, secret?: string, baseURL?: string) {
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
	return betterAuth({
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: authSchema
		}),
		emailAndPassword: {
			enabled: true
		},
		secret: secret,
		baseURL: baseURL
	});
}
