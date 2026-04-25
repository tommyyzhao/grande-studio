import { createLocalDb, createNeonDb } from '$lib/server/db';
import { runGenerationWorkflow } from './generation-workflow';
import type { GenerationQueueMessage, MessageBatchLike } from './types';

/**
 * Creates a database instance from the DATABASE_URL environment variable.
 */
function getDb() {
	const dbUrl = process.env.DATABASE_URL ?? '';
	return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
}

/**
 * Processes a single generation queue message.
 * Runs the generation workflow and propagates errors for retry handling.
 */
export async function processGenerationMessage(
	message: GenerationQueueMessage
): Promise<void> {
	const db = getDb();
	const result = await runGenerationWorkflow(message, { db });

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
 *   queue: handleGenerationQueue
 * };
 * ```
 */
export async function handleGenerationQueue(
	batch: MessageBatchLike<GenerationQueueMessage>
): Promise<void> {
	for (const msg of batch.messages) {
		try {
			await processGenerationMessage(msg.body);
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
