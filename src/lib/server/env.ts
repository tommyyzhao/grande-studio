import type { RequestEvent } from '@sveltejs/kit';
import type { R2BucketLike } from '$lib/services/r2-storage';
import type { KVNamespaceLike } from '$lib/services/live-chunks';
import { createLocalR2Bucket } from '$lib/server/local-r2';

export interface AppEnv {
	DATABASE_URL: string;
	MINIMAX_API_KEY: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	R2_SIGNING_SECRET: string;
	R2_BUCKET_NAME: string;
	// HMAC secret for short-lived /api/events tokens. Lives on both Pages
	// (mints) and the standalone Worker (verifies); kept separate from
	// R2_SIGNING_SECRET so audio URL signing can be rotated independently.
	EVENTS_TOKEN_SECRET: string;
	// Cloudflare R2 binding on production, local filesystem in dev
	AUDIO_BUCKET: R2BucketLike;
	LIVE_KV?: KVNamespaceLike;
}

/**
 * Resolve environment variables from Cloudflare platform bindings (runtime)
 * with a fallback to process.env for local development.
 */
export function getEnv(event: RequestEvent): AppEnv {
	const p = (event.platform?.env ?? {}) as Record<string, unknown>;
	// In local dev, the Cloudflare adapter injects an empty Miniflare R2 binding
	// for AUDIO_BUCKET. The Inngest workflow writes via createLocalR2Bucket() to
	// the filesystem, so reads must do the same — otherwise we'd hit the empty
	// Miniflare binding and 404. INNGEST_DEV=1 is set when running the local stack.
	const isDev = process.env.INNGEST_DEV === '1';
	return {
		DATABASE_URL: (p.DATABASE_URL as string) ?? process.env.DATABASE_URL ?? '',
		MINIMAX_API_KEY: (p.MINIMAX_API_KEY as string) ?? process.env.MINIMAX_API_KEY ?? '',
		BETTER_AUTH_SECRET:
			(p.BETTER_AUTH_SECRET as string) ?? process.env.BETTER_AUTH_SECRET ?? '',
		BETTER_AUTH_URL:
			(p.BETTER_AUTH_URL as string) ??
			process.env.BETTER_AUTH_URL ??
			'http://localhost:5173',
		R2_SIGNING_SECRET:
			(p.R2_SIGNING_SECRET as string) ?? process.env.R2_SIGNING_SECRET ?? '',
		R2_BUCKET_NAME: (p.R2_BUCKET_NAME as string) ?? process.env.R2_BUCKET_NAME ?? '',
		EVENTS_TOKEN_SECRET:
			(p.EVENTS_TOKEN_SECRET as string) ?? process.env.EVENTS_TOKEN_SECRET ?? '',
		AUDIO_BUCKET: isDev
			? createLocalR2Bucket()
			: ((p.AUDIO_BUCKET as R2BucketLike) ?? createLocalR2Bucket()),
		LIVE_KV: p.LIVE_KV as KVNamespaceLike | undefined
	};
}

/**
 * Create a database instance from a connection string.
 * Uses Neon driver for neon.tech URLs, local pg driver otherwise.
 */
export async function getDb(dbUrl: string) {
	const { createLocalDb, createNeonDb } = await import('./db');
	return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
}
