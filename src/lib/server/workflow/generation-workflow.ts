import { eq } from 'drizzle-orm';
import { generationJobs, audioAssets } from '$lib/server/db/schema';
import type { JobStatus, AssetStatus } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { validateJobTransition } from '$lib/services/job-status';
import { validateAssetTransition } from '$lib/services/asset-status';
import type { GenerationQueueMessage, WorkflowDeps, WorkflowResult } from './types';

/**
 * Transitions both job and asset status atomically within an RLS-protected transaction.
 * Validates transitions using the state machine services before writing.
 */
async function transitionStatuses(
	deps: WorkflowDeps,
	ownerId: string,
	jobId: string,
	assetId: string,
	currentJobStatus: JobStatus,
	nextJobStatus: JobStatus,
	currentAssetStatus: AssetStatus,
	nextAssetStatus: AssetStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
	const jobCheck = validateJobTransition(currentJobStatus, nextJobStatus);
	if (!jobCheck.valid) {
		return { ok: false, error: jobCheck.reason };
	}

	const assetCheck = validateAssetTransition(currentAssetStatus, nextAssetStatus);
	if (!assetCheck.valid) {
		return { ok: false, error: assetCheck.reason };
	}

	const now = new Date();
	await withRLS(deps.db, ownerId, async (tx) => {
		await tx
			.update(generationJobs)
			.set({ status: nextJobStatus, updatedAt: now })
			.where(eq(generationJobs.id, jobId));
		await tx
			.update(audioAssets)
			.set({ status: nextAssetStatus, updatedAt: now })
			.where(eq(audioAssets.id, assetId));
	});

	return { ok: true };
}

/**
 * Generation workflow: processes a generation job from the queue.
 *
 * Steps:
 * 1. Fetch job and asset from DB — validates they exist
 * 2. Transition to 'queued'
 * 3. Transition to 'generating'
 * 4. Call provider (placeholder — implemented in US-022)
 * 5. Assemble audio (placeholder — implemented in US-022)
 * 6. Persist to R2 (placeholder — implemented in US-022)
 * 7. Finalize (placeholder — implemented in US-022/023)
 */
export async function runGenerationWorkflow(
	message: GenerationQueueMessage,
	deps: WorkflowDeps
): Promise<WorkflowResult> {
	const { jobId, assetId, ownerId } = message;

	// ── Step 1: Fetch job and asset ──────────────────────────────────────────

	const job = await withRLS(deps.db, ownerId, async (tx) => {
		const rows = await tx
			.select()
			.from(generationJobs)
			.where(eq(generationJobs.id, jobId));
		return rows[0] ?? null;
	});

	if (!job) {
		console.error(`[workflow] Job not found: ${jobId}`);
		return { ok: false, error: `Job not found: ${jobId}`, jobId, assetId };
	}

	const asset = await withRLS(deps.db, ownerId, async (tx) => {
		const rows = await tx
			.select()
			.from(audioAssets)
			.where(eq(audioAssets.id, assetId));
		return rows[0] ?? null;
	});

	if (!asset) {
		console.error(`[workflow] Asset not found: ${assetId}`);
		return { ok: false, error: `Asset not found: ${assetId}`, jobId, assetId };
	}

	// ── Step 2: Transition to 'queued' ──────────────────────────────────────

	const toQueued = await transitionStatuses(
		deps,
		ownerId,
		jobId,
		assetId,
		job.status,
		'queued',
		asset.status,
		'queued'
	);

	if (!toQueued.ok) {
		console.error(`[workflow] Failed to transition to queued: ${toQueued.error}`);
		return { ok: false, error: toQueued.error, jobId, assetId };
	}

	// ── Step 3: Transition to 'generating' ──────────────────────────────────

	const toGenerating = await transitionStatuses(
		deps,
		ownerId,
		jobId,
		assetId,
		'queued',
		'generating',
		'queued',
		'generating'
	);

	if (!toGenerating.ok) {
		console.error(`[workflow] Failed to transition to generating: ${toGenerating.error}`);
		return { ok: false, error: toGenerating.error, jobId, assetId };
	}

	// ── Step 4: Call provider (placeholder — US-022) ────────────────────────
	// TODO: Resolve provider adapter from message.provider/message.jobType
	// TODO: Call adapter.generateTextToMusic / generateInstrumental / generateCoverRestyle
	// TODO: If streaming, call adapter.streamGenerationAudio(handle)
	// TODO: Transition asset to 'receiving_audio' when chunks begin

	// ── Step 5: Assemble audio (placeholder — US-022) ───────────────────────
	// TODO: Assemble hex-decoded chunks into final audio byte array
	// TODO: Handle non-streaming fallback (fetch URL, convert to bytes)

	// ── Step 6: Persist to R2 (placeholder — US-022) ────────────────────────
	// TODO: Transition asset to 'persisting'
	// TODO: Upload assembled audio to R2 via R2 storage service
	// TODO: Update asset with r2_object_key, duration_sec, format, sample_rate

	// ── Step 7: Finalize (placeholder — US-022/023) ─────────────────────────
	// TODO: Transition asset to 'ready', job to 'succeeded'
	// TODO: Commit quota reservation
	// TODO: Error handling: transition to 'failed', release quota (US-023)

	return { ok: true, jobId, assetId };
}
