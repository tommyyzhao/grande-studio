import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createLocalDb } from './db';
import * as authSchema from './db/auth-schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;
let _cachedDbUrl: string | null = null;

/**
 * Lazily create and cache a BetterAuth instance.
 * On Cloudflare Pages env vars are runtime-only (platform.env), so we
 * cannot use $env/static/private at module scope.
 */
export function getAuth(dbUrl: string, secret?: string, baseURL?: string) {
	// Re-create if the DB URL changes (should not happen in production, but safe)
	if (!_auth || _cachedDbUrl !== dbUrl) {
		const db = createLocalDb(dbUrl);
		_auth = betterAuth({
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
		_cachedDbUrl = dbUrl;
	}
	return _auth as ReturnType<typeof betterAuth>;
}
