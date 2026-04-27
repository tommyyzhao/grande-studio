// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { R2BucketLike } from '$lib/services/r2-storage';
import type { KVNamespaceLike } from '$lib/services/live-chunks';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: {
				id: string;
				name: string;
				email: string;
				emailVerified: boolean;
				image?: string | null;
				createdAt: Date;
				updatedAt: Date;
			} | null;
			session: {
				id: string;
				userId: string;
				expiresAt: Date;
				token: string;
			} | null;
			/** Temp session ID for unauthenticated users (from session cookie) */
			tempSessionId: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: {
				DATABASE_URL?: string;
				MINIMAX_API_KEY?: string;
				BETTER_AUTH_SECRET?: string;
				BETTER_AUTH_URL?: string;
				R2_SIGNING_SECRET?: string;
				R2_BUCKET_NAME?: string;
				AUDIO_BUCKET?: R2BucketLike;
				LIVE_KV?: KVNamespaceLike;
			};
			context?: {
				waitUntil(promise: Promise<unknown>): void;
			};
		}
	}
}

export {};
