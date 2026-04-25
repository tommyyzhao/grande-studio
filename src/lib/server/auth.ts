import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { DATABASE_URL } from '$env/static/private';
import { createLocalDb } from './db';
import * as authSchema from './db/auth-schema';

const db = createLocalDb(DATABASE_URL);

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: authSchema
	}),
	emailAndPassword: {
		enabled: true
	}
});
