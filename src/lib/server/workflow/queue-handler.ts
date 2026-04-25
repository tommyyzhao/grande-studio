import { createLocalDb, createNeonDb } from '$lib/server/db';
import { createMiniMaxAdapter } from '$lib/providers/minimax/adapter';
import { createR2StorageService } from '$lib/services/r2-storage';
import { createQuotaService, createDrizzleQuotaRepository } from '$lib/services/quota';
import { runGenerationWorkflow } from './generation-workflow';
import type { GenerationQueueMessage, MessageBatchLike, WorkflowDeps, WorkflowEnv } from './types';

/**
 * Builds workflow dependencies from environment bindings.
 * Throws if required env values are missing.
 */
function buildWorkflowDeps(env?: WorkflowEnv): WorkflowDeps {
	const dbUrl = env?.DATABASE_URL ?? process.env.DATABASE_URL ?? '';
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const apiKey = env?.MINIMAX_API_KEY ?? process.env.MINIMAX_API_KEY;
	if (!apiKey) {
		throw new Error('MINIMAX_API_KEY is required for generation workflow');
	}
	const provider = createMiniMaxAdapter(apiKey);

	const bucket = env?.AUDIO_BUCKET;
	if (!bucket) {
		throw new Error('AUDIO_BUCKET binding is required for generation workflow');
	}
	const signingSecret = env?.R2_SIGNING_SECRET ?? process.env.R2_SIGNING_SECRET ?? '';
	const baseUrl = env?.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? '';
	const r2 = createR2StorageService(bucket, signingSecret, baseUrl);

	const quotaRepo = createDrizzleQuotaRepository(db);
	const quota = createQuotaService(quotaRepo);

	return { db, provider, r2, quota };
}

/**
 * Processes a single generation queue message.
 * Runs the generation workflow and propagates errors for retry handling.
 */
export async function processGenerationMessage(
	message: GenerationQueueMessage,
	env?: WorkflowEnv
): Promise<void> {
	const deps = buildWorkflowDeps(env);
	const result = await runGenerationWorkflow(message, deps);

	if (!result.ok) {
		throw new Error(
			`Workflow failed for job ${result.jobId}: ${result.error}`
		);
	}

	console.log(
		`[queue] Workflow completed: job=${result.jobId} asset=${result.assetId}`
	);
}

/**
 * Cloudflare Queue consumer handler.
 * Processes each message individually — acks on success, retries on failure.
 *
 * Export this as the `queue` handler from the worker entry point:
 *
 * ```ts
 * export default {
 *   fetch: svelteKitHandler,
 *   queue(batch, env, ctx) {
 *     return handleGenerationQueue(batch, env);
 *   }
 * };
 * ```
 */
export async function handleGenerationQueue(
	batch: MessageBatchLike<GenerationQueueMessage>,
	env?: WorkflowEnv
): Promise<void> {
	for (const msg of batch.messages) {
		try {
			await processGenerationMessage(msg.body, env);
			msg.ack();
		} catch (error) {
			console.error(
				`[queue] Failed to process message ${msg.id}:`,
				error instanceof Error ? error.message : error
			);
			msg.retry();
		}
	}
}
