import type { JobType, Provider } from '$lib/server/db/schema';
import type { Database } from '$lib/server/db';
import type { MusicProvider } from '$lib/providers/types';
import type { R2StorageService } from '$lib/services/r2-storage';
import type { R2BucketLike } from '$lib/services/r2-storage';

// ─── Queue Message ────────────────────────────────────────────────────────────

/** Shape of the message sent to the generation queue by POST /api/generate */
export interface GenerationQueueMessage {
	jobId: string;
	assetId: string;
	projectId: string;
	ownerId: string;
	provider: Provider;
	jobType: JobType;
	idempotencyKey: string;
	quotaReservationId: string;
}

// ─── Queue Consumer Abstractions ──────────────────────────────────────────────
// Minimal Cloudflare Queue consumer types (avoids @cloudflare/workers-types)

export interface QueueMessageHandle<T = unknown> {
	readonly body: T;
	readonly id: string;
	ack(): void;
	retry(): void;
}

export interface MessageBatchLike<T = unknown> {
	readonly queue: string;
	readonly messages: readonly QueueMessageHandle<T>[];
	ackAll(): void;
	retryAll(): void;
}

// ─── Workflow Environment ────────────────────────────────────────────────────
// Environment bindings/vars available to the queue handler (Cloudflare Workers env)

export interface WorkflowEnv {
	DATABASE_URL?: string;
	MINIMAX_API_KEY?: string;
	R2_SIGNING_SECRET?: string;
	BETTER_AUTH_URL?: string;
	AUDIO_BUCKET?: R2BucketLike;
}

// ─── Workflow Dependencies ────────────────────────────────────────────────────

/** Dependencies injected into the generation workflow */
export interface WorkflowDeps {
	db: Database;
	provider: MusicProvider;
	r2: R2StorageService;
}

// ─── Workflow Result ──────────────────────────────────────────────────────────

export type WorkflowResult =
	| { ok: true; jobId: string; assetId: string }
	| { ok: false; error: string; jobId: string; assetId: string };
