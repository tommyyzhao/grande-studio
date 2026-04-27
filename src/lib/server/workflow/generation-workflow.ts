import { eq } from 'drizzle-orm';
import { generationJobs, audioAssets } from '$lib/server/db/schema';
import type { JobStatus, AssetStatus } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { validateJobTransition } from '$lib/services/job-status';
import { validateAssetTransition } from '$lib/services/asset-status';
import { buildObjectKey } from '$lib/services/r2-storage';
import { ProviderError } from '$lib/providers/types';
import type { ProviderAudioChunk, ProviderGenerationHandle } from '$lib/providers/types';
import type { GenerationQueueMessage, WorkflowDeps, WorkflowResult } from './types';

// ─── Error Codes ────────────────────────────────────────────────────────────
// Superset of ProviderErrorCode plus workflow-level error codes

export type WorkflowErrorCode =
	| 'provider_timeout'
	| 'provider_validation_error'
	| 'provider_auth_error'
	| 'provider_rate_limited'
	| 'stream_interrupted'
	| 'audio_assembly_failed'
	| 'r2_write_failed';

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
 * Fail both job and asset: set status='failed', record error details, and release quota.
 * This is best-effort — if the fail transition itself errors, we log and continue.
 */
async function failWorkflow(
	deps: WorkflowDeps,
	ownerId: string,
	jobId: string,
	assetId: string,
	currentJobStatus: JobStatus,
	currentAssetStatus: AssetStatus,
	errorCode: WorkflowErrorCode,
	errorMessage: string,
	quotaReservationId: string
): Promise<WorkflowResult> {
	// Attempt to transition job and asset to 'failed'
	const jobCheck = validateJobTransition(currentJobStatus, 'failed');
	const assetCheck = validateAssetTransition(currentAssetStatus, 'failed');

	const now = new Date();
	const errorJson = { code: errorCode, message: errorMessage, failedAt: now.toISOString() };

	if (jobCheck.valid && assetCheck.valid) {
		try {
			await withRLS(deps.db, ownerId, async (tx) => {
				await tx
					.update(generationJobs)
					.set({
						status: 'failed' as JobStatus,
						errorCode,
						errorJson,
						updatedAt: now
					})
					.where(eq(generationJobs.id, jobId));
				await tx
					.update(audioAssets)
					.set({
						status: 'failed' as AssetStatus,
						errorJson,
						updatedAt: now
					})
					.where(eq(audioAssets.id, assetId));
			});
		} catch (dbError) {
			console.error(`[workflow] Failed to write failure state to DB for job=${jobId}:`, dbError);
		}
	} else {
		console.error(
			`[workflow] Cannot transition to failed: job(${currentJobStatus}→failed): ${jobCheck.valid ? 'ok' : (jobCheck as { reason: string }).reason}, ` +
			`asset(${currentAssetStatus}→failed): ${assetCheck.valid ? 'ok' : (assetCheck as { reason: string }).reason}`
		);
	}

	// Release quota reservation (best-effort)
	try {
		const releaseResult = await deps.quota.releaseQuota(quotaReservationId);
		if (!releaseResult.ok) {
			console.warn(`[workflow] Quota release failed for reservation=${quotaReservationId}: ${releaseResult.error}`);
		}
	} catch (quotaError) {
		console.error(`[workflow] Quota release threw for reservation=${quotaReservationId}:`, quotaError);
	}

	return { ok: false, error: `${errorCode}: ${errorMessage}`, jobId, assetId };
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
 * 7. Finalize: asset→ready, job→succeeded, commit quota
 *
 * On any failure in steps 4-7: job and asset → 'failed', quota released.
 */
export async function runGenerationWorkflow(
	message: GenerationQueueMessage,
	deps: WorkflowDeps
): Promise<WorkflowResult> {
	const { jobId, assetId, ownerId, quotaReservationId } = message;

	// Track current statuses so failWorkflow knows the right transition source
	let currentJobStatus: JobStatus = 'created';
	let currentAssetStatus: AssetStatus = 'created';

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

	currentJobStatus = job.status;
	currentAssetStatus = asset.status;

	// ── Step 2: Transition to 'queued' ──────────────────────────────────────

	const toQueued = await transitionStatuses(
		deps,
		ownerId,
		jobId,
		assetId,
		currentJobStatus,
		'queued',
		currentAssetStatus,
		'queued'
	);

	if (!toQueued.ok) {
		console.error(`[workflow] Failed to transition to queued: ${toQueued.error}`);
		return { ok: false, error: toQueued.error, jobId, assetId };
	}

	currentJobStatus = 'queued';
	currentAssetStatus = 'queued';

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

	currentJobStatus = 'generating';
	currentAssetStatus = 'generating';

	// ── Step 4+5: Build generation input, stream audio chunks ──────────────
	// MiniMax streaming is a single POST with stream=true.
	// We call streamGenerationAudio(input) directly, which handles the POST.

	const requestPayload = job.requestJson as GenerationRequestPayload;

	// Build the typed generation input from the stored request payload
	let generationInput: import('$lib/providers/types').TextToMusicInput | import('$lib/providers/types').InstrumentalGenerationInput | import('$lib/providers/types').CoverRestyleInput;

	try {
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
				return failWorkflow(
					deps, ownerId, jobId, assetId,
					currentJobStatus, currentAssetStatus,
					'provider_validation_error',
					`Source asset not found or has no R2 key: ${requestPayload.sourceAssetId}`,
					quotaReservationId
				);
			}

			sourceAudioUrl = await deps.r2.getSignedUrl(sourceAsset.r2ObjectKey);
		}

		switch (requestPayload.mode) {
			case 'text_to_music':
				generationInput = {
					prompt: requestPayload.prompt,
					lyrics: requestPayload.lyrics,
					instrumental: false,
					lyricsOptimizer: requestPayload.lyricsOptimizer,
					structureTags: requestPayload.structureTags
				};
				break;
			case 'instrumental':
				generationInput = {
					prompt: requestPayload.prompt,
					instrumental: true,
					structureTags: requestPayload.structureTags
				};
				break;
			case 'cover_restyle':
				generationInput = {
					prompt: requestPayload.prompt,
					sourceAudioUrl: sourceAudioUrl!,
					lyrics: requestPayload.lyrics
				};
				break;
		}
	} catch (error) {
		if (error instanceof ProviderError) {
			return failWorkflow(
				deps, ownerId, jobId, assetId,
				currentJobStatus, currentAssetStatus,
				error.code,
				error.message,
				quotaReservationId
			);
		}
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'provider_validation_error',
			error instanceof Error ? error.message : 'Unknown error building generation input',
			quotaReservationId
		);
	}

	// Stream audio from the provider (single POST with stream=true)
	if (!deps.provider.streamGenerationAudio) {
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'provider_validation_error',
			'Provider does not support streaming audio generation',
			quotaReservationId
		);
	}

	const chunks: ProviderAudioChunk[] = [];
	let receivingAudioTransitioned = false;
	let handle: ProviderGenerationHandle = { providerJobId: 'unknown', supportsStreaming: true };

	try {
		for await (const chunk of deps.provider.streamGenerationAudio(generationInput)) {
			// Transition to 'receiving_audio' on first chunk
			if (!receivingAudioTransitioned) {
				const toReceiving = await transitionStatuses(
					deps, ownerId, jobId, assetId,
					'generating', 'receiving_audio',
					'generating', 'receiving_audio'
				);
				if (!toReceiving.ok) {
					console.error(`[workflow] Failed to transition to receiving_audio: ${toReceiving.error}`);
					return failWorkflow(
						deps, ownerId, jobId, assetId,
						currentJobStatus, currentAssetStatus,
						'stream_interrupted',
						`Failed to transition to receiving_audio: ${toReceiving.error}`,
						quotaReservationId
					);
				}
				currentJobStatus = 'receiving_audio';
				currentAssetStatus = 'receiving_audio';
				receivingAudioTransitioned = true;
			}
			chunks.push(chunk);

			// Best-effort: forward chunk to live-listening KV channel
			if (deps.liveChunks) {
				try {
					await deps.liveChunks.publishChunk(jobId, chunk.sequence, chunk.data, chunk.isFinal);
				} catch (liveErr) {
					console.warn(`[workflow] Live chunk publish failed for job=${jobId} chunk=${chunk.sequence}:`, liveErr);
				}
			}
		}
	} catch (error) {
		// Stream broke before a valid file was fully received
		if (error instanceof ProviderError) {
			return failWorkflow(
				deps, ownerId, jobId, assetId,
				currentJobStatus, currentAssetStatus,
				error.code,
				error.message,
				quotaReservationId
			);
		}
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'stream_interrupted',
			error instanceof Error ? error.message : 'Stream broke before audio was fully received',
			quotaReservationId
		);
	}

	// Best-effort: mark live stream as complete
	if (deps.liveChunks) {
		try {
			await deps.liveChunks.endStream(jobId);
		} catch (liveErr) {
			console.warn(`[workflow] Live stream end failed for job=${jobId}:`, liveErr);
		}
	}

	// Assemble audio bytes
	let audioBytes: Uint8Array;
	try {
		audioBytes = assembleAudioChunks(chunks);
	} catch (error) {
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'audio_assembly_failed',
			error instanceof Error ? error.message : 'Failed to assemble audio chunks',
			quotaReservationId
		);
	}

	if (audioBytes.length === 0) {
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'audio_assembly_failed',
			'No audio data received from provider',
			quotaReservationId
		);
	}

	// ── Step 6: Persist to R2 ───────────────────────────────────────────────

	const toPersisting = await transitionStatuses(
		deps, ownerId, jobId, assetId,
		currentJobStatus, 'persisting',
		currentAssetStatus, 'persisting'
	);
	if (!toPersisting.ok) {
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'r2_write_failed',
			`Failed to transition to persisting: ${toPersisting.error}`,
			quotaReservationId
		);
	}
	currentJobStatus = 'persisting';
	currentAssetStatus = 'persisting';

	// Audio format is always MP3 from MiniMax (verified via integration test)
	const format = 'mp3';
	const sampleRate: number | null = 44100;
	const durationSec: number | null = null; // Duration can be detected client-side from the audio buffer

	const r2ObjectKey = buildObjectKey(ownerId, message.projectId, assetId, format);

	try {
		await deps.r2.uploadAudio(r2ObjectKey, audioBytes, formatToContentType(format));
	} catch (error) {
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'r2_write_failed',
			error instanceof Error ? error.message : 'Failed to upload audio to R2',
			quotaReservationId
		);
	}

	// ── Step 7: Finalize — update asset to 'ready', job to 'succeeded' ──────

	const jobFinalCheck = validateJobTransition('persisting', 'succeeded');
	if (!jobFinalCheck.valid) {
		console.error(`[workflow] Invalid job transition persisting→succeeded: ${jobFinalCheck.reason}`);
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'audio_assembly_failed',
			`Invalid job transition persisting→succeeded: ${jobFinalCheck.reason}`,
			quotaReservationId
		);
	}

	const assetFinalCheck = validateAssetTransition('persisting', 'ready');
	if (!assetFinalCheck.valid) {
		console.error(`[workflow] Invalid asset transition persisting→ready: ${assetFinalCheck.reason}`);
		return failWorkflow(
			deps, ownerId, jobId, assetId,
			currentJobStatus, currentAssetStatus,
			'audio_assembly_failed',
			`Invalid asset transition persisting→ready: ${assetFinalCheck.reason}`,
			quotaReservationId
		);
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

	// Commit quota on success
	try {
		const commitResult = await deps.quota.commitQuota(quotaReservationId);
		if (!commitResult.ok) {
			console.warn(`[workflow] Quota commit failed for reservation=${quotaReservationId}: ${commitResult.error}`);
		}
	} catch (quotaError) {
		console.error(`[workflow] Quota commit threw for reservation=${quotaReservationId}:`, quotaError);
	}

	return { ok: true, jobId, assetId };
}
