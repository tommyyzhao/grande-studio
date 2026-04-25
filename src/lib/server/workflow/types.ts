import type { JobType, Provider } from '$lib/server/db/schema';
import type { Database } from '$lib/server/db';

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

// ─── Workflow Dependencies ────────────────────────────────────────────────────

/** Dependencies injected into the generation workflow */
export interface WorkflowDeps {
	db: Database;
}

// ─── Workflow Result ──────────────────────────────────────────────────────────

export type WorkflowResult =
	| { ok: true; jobId: string; assetId: string }
	| { ok: false; error: string; jobId: string; assetId: string };
