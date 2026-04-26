// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { R2BucketLike } from '$lib/services/r2-storage';
import type { KVNamespaceLike } from '$lib/services/live-chunks';

/** Minimal Cloudflare Queue producer interface (avoids @cloudflare/workers-types dependency) */
interface QueueLike {
	send(message: unknown): Promise<void>;
	sendBatch(messages: { body: unknown }[]): Promise<void>;
}

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
			env: {
				AUDIO_BUCKET: R2BucketLike;
				GENERATION_QUEUE: QueueLike;
				LIVE_KV: KVNamespaceLike;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
		}
	}
}

export {};
