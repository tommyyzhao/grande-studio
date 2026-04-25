import { eq } from 'drizzle-orm';
import { generationJobs, audioAssets } from '$lib/server/db/schema';
import type { JobStatus, AssetStatus } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { validateJobTransition } from '$lib/services/job-status';
import { validateAssetTransition } from '$lib/services/asset-status';
import { buildObjectKey } from '$lib/services/r2-storage';
import type { ProviderAudioChunk, ProviderGenerationHandle } from '$lib/providers/types';
import type { GenerationQueueMessage, WorkflowDeps, WorkflowResult } from './types';

// ─── Request Payload Type ────────────────────────────────────────────────────
// Matches the shape stored by POST /api/generate in generation_jobs.request_json

interface GenerationRequestPayload {
	mode: 'text_to_music' | 'instrumental' | 'cover_restyle';
	prompt: string;
	lyrics?: string;
	instrumental: boolean;
	lyricsOptimizer?: boolean;
	structureTags?: string[];
	sourceAssetId?: string;
}

// ─── Audio Assembly ──────────────────────────────────────────────────────────

/** Concatenates decoded audio chunks into a single byte array */
function assembleAudioChunks(chunks: ProviderAudioChunk[]): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk.data, offset);
		offset += chunk.data.length;
	}
	return result;
}

/** Maps audio format string to MIME content type */
function formatToContentType(format: string): string {
	switch (format.toLowerCase()) {
		case 'mp3':
			return 'audio/mpeg';
		case 'wav':
			return 'audio/wav';
		case 'flac':
			return 'audio/flac';
		case 'aac':
			return 'audio/aac';
		case 'm4a':
			return 'audio/mp4';
		default:
			return `audio/${format}`;
	}
}

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
 * 4. Call provider adapter (text-to-music, instrumental, or cover/restyle)
 * 5. Stream audio chunks and assemble into final byte array
 * 6. Persist assembled audio to R2
 * 7. Finalize: asset→ready, job→succeeded (error handling in US-023)
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

	// ── Step 4: Call provider ────────────────────────────────────────────────

	const requestPayload = job.requestJson as GenerationRequestPayload;

	// For cover/restyle, resolve source audio signed URL from R2
	let sourceAudioUrl: string | undefined;
	if (requestPayload.mode === 'cover_restyle' && requestPayload.sourceAssetId) {
		const sourceAsset = await withRLS(deps.db, ownerId, async (tx) => {
			const rows = await tx
				.select({ r2ObjectKey: audioAssets.r2ObjectKey })
				.from(audioAssets)
				.where(eq(audioAssets.id, requestPayload.sourceAssetId!));
			return rows[0] ?? null;
		});

		if (!sourceAsset?.r2ObjectKey) {
			console.error(`[workflow] Source asset not found or has no R2 key: ${requestPayload.sourceAssetId}`);
			return { ok: false, error: `Source asset not found or has no R2 key: ${requestPayload.sourceAssetId}`, jobId, assetId };
		}

		sourceAudioUrl = await deps.r2.getSignedUrl(sourceAsset.r2ObjectKey);
	}

	// Call the appropriate generate method based on job type
	let handle: ProviderGenerationHandle;
	switch (requestPayload.mode) {
		case 'text_to_music':
			handle = await deps.provider.generateTextToMusic({
				prompt: requestPayload.prompt,
				lyrics: requestPayload.lyrics,
				instrumental: false,
				lyricsOptimizer: requestPayload.lyricsOptimizer,
				structureTags: requestPayload.structureTags
			});
			break;
		case 'instrumental':
			handle = await deps.provider.generateInstrumental({
				prompt: requestPayload.prompt,
				structureTags: requestPayload.structureTags
			});
			break;
		case 'cover_restyle':
			handle = await deps.provider.generateCoverRestyle({
				prompt: requestPayload.prompt,
				sourceAudioUrl: sourceAudioUrl!,
				lyrics: requestPayload.lyrics
			});
			break;
	}

	// ── Step 5: Stream audio chunks and assemble bytes ──────────────────────

	if (!deps.provider.streamGenerationAudio) {
		console.error('[workflow] Provider does not support audio streaming or URL retrieval');
		return { ok: false, error: 'Provider does not support audio streaming or URL retrieval', jobId, assetId };
	}

	const chunks: ProviderAudioChunk[] = [];
	let receivingAudioTransitioned = false;

	for await (const chunk of deps.provider.streamGenerationAudio(handle)) {
		// Transition to 'receiving_audio' on first chunk
		if (!receivingAudioTransitioned) {
			const toReceiving = await transitionStatuses(
				deps, ownerId, jobId, assetId,
				'generating', 'receiving_audio',
				'generating', 'receiving_audio'
			);
			if (!toReceiving.ok) {
				console.error(`[workflow] Failed to transition to receiving_audio: ${toReceiving.error}`);
				return { ok: false, error: toReceiving.error, jobId, assetId };
			}
			receivingAudioTransitioned = true;
		}
		chunks.push(chunk);
	}

	const audioBytes = assembleAudioChunks(chunks);

	if (audioBytes.length === 0) {
		console.error('[workflow] No audio data received from provider');
		return { ok: false, error: 'No audio data received from provider', jobId, assetId };
	}

	// ── Step 6: Persist to R2 ───────────────────────────────────────────────

	const toPersisting = await transitionStatuses(
		deps, ownerId, jobId, assetId,
		'receiving_audio', 'persisting',
		'receiving_audio', 'persisting'
	);
	if (!toPersisting.ok) {
		console.error(`[workflow] Failed to transition to persisting: ${toPersisting.error}`);
		return { ok: false, error: toPersisting.error, jobId, assetId };
	}

	// Extract audio metadata from provider response where available
	const extraInfo = (handle.metadata as { extraInfo?: { audio_format?: string; audio_sample_rate?: number; duration?: number } } | undefined)?.extraInfo;
	const format = extraInfo?.audio_format ?? 'mp3';
	const sampleRate = extraInfo?.audio_sample_rate ?? null;
	const durationSec = extraInfo?.duration ?? null;

	const r2ObjectKey = buildObjectKey(ownerId, message.projectId, assetId, format);
	await deps.r2.uploadAudio(r2ObjectKey, audioBytes, formatToContentType(format));

	// ── Step 7: Finalize — update asset to 'ready', job to 'succeeded' ──────

	const jobFinalCheck = validateJobTransition('persisting', 'succeeded');
	if (!jobFinalCheck.valid) {
		console.error(`[workflow] Invalid job transition persisting→succeeded: ${jobFinalCheck.reason}`);
		return { ok: false, error: jobFinalCheck.reason, jobId, assetId };
	}

	const assetFinalCheck = validateAssetTransition('persisting', 'ready');
	if (!assetFinalCheck.valid) {
		console.error(`[workflow] Invalid asset transition persisting→ready: ${assetFinalCheck.reason}`);
		return { ok: false, error: assetFinalCheck.reason, jobId, assetId };
	}

	const now = new Date();
	await withRLS(deps.db, ownerId, async (tx) => {
		await tx
			.update(audioAssets)
			.set({
				status: 'ready' as AssetStatus,
				r2ObjectKey,
				format,
				sampleRate: sampleRate ?? undefined,
				durationSec: durationSec != null ? String(durationSec) : undefined,
				providerJobId: handle.providerJobId,
				updatedAt: now
			})
			.where(eq(audioAssets.id, assetId));

		await tx
			.update(generationJobs)
			.set({
				status: 'succeeded' as JobStatus,
				responseJson: {
					providerJobId: handle.providerJobId,
					supportsStreaming: handle.supportsStreaming,
					metadata: handle.metadata,
					audioSizeBytes: audioBytes.length,
					r2ObjectKey
				},
				updatedAt: now
			})
			.where(eq(generationJobs.id, jobId));
	});

	return { ok: true, jobId, assetId };
}
