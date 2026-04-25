// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { R2BucketLike } from '$lib/services/r2-storage';

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
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				AUDIO_BUCKET: R2BucketLike;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
		}
	}
}

export {};
