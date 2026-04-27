import type { RequestEvent } from '@sveltejs/kit';
import type { R2BucketLike } from '$lib/services/r2-storage';
import type { KVNamespaceLike } from '$lib/services/live-chunks';

/** Minimal Cloudflare Queue producer interface */
interface QueueLike {
	send(message: unknown): Promise<void>;
	sendBatch(messages: { body: unknown }[]): Promise<void>;
}

export interface AppEnv {
	DATABASE_URL: string;
	MINIMAX_API_KEY: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	R2_SIGNING_SECRET: string;
	R2_BUCKET_NAME: string;
	// Cloudflare bindings (only available on Cloudflare)
	AUDIO_BUCKET?: R2BucketLike;
	LIVE_KV?: KVNamespaceLike;
	GENERATION_QUEUE?: QueueLike;
}

/**
 * Resolve environment variables from Cloudflare platform bindings (runtime)
 * with a fallback to process.env for local development.
 */
export function getEnv(event: RequestEvent): AppEnv {
	const p = (event.platform?.env ?? {}) as Record<string, unknown>;
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
		AUDIO_BUCKET: p.AUDIO_BUCKET as R2BucketLike | undefined,
		LIVE_KV: p.LIVE_KV as KVNamespaceLike | undefined,
		GENERATION_QUEUE: p.GENERATION_QUEUE as QueueLike | undefined
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
