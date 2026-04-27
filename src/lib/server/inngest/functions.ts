import { env as privateEnv } from '$env/dynamic/private';
import { inngest } from './client';
import { processGenerationMessage } from '$lib/server/workflow/queue-handler';
import { handleScheduled } from '$lib/server/workflow/scheduled-handler';
import { createLocalR2Bucket } from '$lib/server/local-r2';
import type { GenerationQueueMessage } from '$lib/server/workflow/types';
import type { WorkflowEnv } from '$lib/server/workflow/types';

/** Build WorkflowEnv from SvelteKit's private env vars + local R2 for dev. */
function getWorkflowEnv(): WorkflowEnv {
	return {
		DATABASE_URL: privateEnv.DATABASE_URL,
		MINIMAX_API_KEY: privateEnv.MINIMAX_API_KEY,
		R2_SIGNING_SECRET: privateEnv.R2_SIGNING_SECRET ?? '',
		BETTER_AUTH_URL: privateEnv.BETTER_AUTH_URL ?? 'http://localhost:5183',
		AUDIO_BUCKET: createLocalR2Bucket(),
		LIVE_KV: undefined
	};
}

/**
 * Inngest function: processes a music generation job.
 *
 * Triggered by the "generation/requested" event sent from POST /api/generate.
 * Runs the full generation pipeline: stream from MiniMax, persist to R2,
 * update DB statuses, commit quota.
 *
 * NOTE: The workflow runs without step.run() wrapping because MiniMax streaming
 * takes 2-3 minutes, which exceeds Inngest's per-step execution timeout.
 * Inngest still provides retries at the function level on failure.
 */
export const generationFunction = inngest.createFunction(
	{
		id: 'process-generation',
		retries: 3,
		triggers: [{ event: 'generation/requested' }]
	},
	async ({ event }) => {
		const message = event.data as GenerationQueueMessage;
		const env = getWorkflowEnv();

		await processGenerationMessage(message, env);

		return { jobId: message.jobId, assetId: message.assetId };
	}
);

/**
 * Inngest cron function: expires stale quota reservations.
 *
 * Replaces the Cloudflare Cron Trigger that ran every 5 minutes.
 * Transitions all 'reserved' rows past their expires_at to 'expired'.
 */
export const quotaExpiryFunction = inngest.createFunction(
	{
		id: 'expire-stale-quotas',
		triggers: [{ cron: '*/5 * * * *' }]
	},
	async ({ step }) => {
		await step.run('expire-reservations', async () => {
			await handleScheduled();
		});
	}
);
