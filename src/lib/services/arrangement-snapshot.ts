/**
 * ArrangementSnapshotV1 — typed, validated snapshot of arrangement state
 * for use by the rough mixdown renderer.
 */
import type { ArrangementClipState } from '$lib/audio-engine/engine';

// ─── Types ───────────────────────────────────────────────────────────────

export interface ClipSnapshotV1 {
	clipId: string;
	assetId: string;
	/** Signed R2 URL for fetching the source audio */
	sourceUrl: string;
	startTimeSec: number;
	trimStartSec: number;
	trimEndSec: number | null;
	clipDurationSec: number;
	gainDb: number;
	muted: boolean;
	soloed: boolean;
	layerOrder: number;
}

export interface ArrangementSnapshotV1 {
	snapshotVersion: 1;
	projectId: string;
	renderedAt: string;
	sampleRate: 44100;
	bitDepth: 16;
	clips: ClipSnapshotV1[];
}

// ─── Validation ──────────────────────────────────────────────────────────

export interface SnapshotValidationError {
	clipId: string | null;
	field: string;
	message: string;
}

function validateClip(clip: ArrangementClipState): SnapshotValidationError[] {
	const errors: SnapshotValidationError[] = [];
	const id = clip.clipId;

	if (!clip.clipId) {
		errors.push({ clipId: id, field: 'clipId', message: 'clipId is required' });
	}
	if (!clip.assetId) {
		errors.push({ clipId: id, field: 'assetId', message: 'assetId is required' });
	}
	if (typeof clip.startTimeSec !== 'number' || clip.startTimeSec < 0) {
		errors.push({
			clipId: id,
			field: 'startTimeSec',
			message: 'startTimeSec must be a non-negative number'
		});
	}
	if (typeof clip.trimStartSec !== 'number' || clip.trimStartSec < 0) {
		errors.push({
			clipId: id,
			field: 'trimStartSec',
			message: 'trimStartSec must be a non-negative number'
		});
	}
	if (clip.trimEndSec !== null && (typeof clip.trimEndSec !== 'number' || clip.trimEndSec < 0)) {
		errors.push({
			clipId: id,
			field: 'trimEndSec',
			message: 'trimEndSec must be a non-negative number or null'
		});
	}
	if (
		clip.trimEndSec !== null &&
		typeof clip.trimStartSec === 'number' &&
		typeof clip.trimEndSec === 'number' &&
		clip.trimEndSec <= clip.trimStartSec
	) {
		errors.push({
			clipId: id,
			field: 'trimEndSec',
			message: 'trimEndSec must be greater than trimStartSec'
		});
	}
	if (typeof clip.clipDurationSec !== 'number' || clip.clipDurationSec <= 0) {
		errors.push({
			clipId: id,
			field: 'clipDurationSec',
			message: 'clipDurationSec must be a positive number'
		});
	}

	return errors;
}

// ─── Snapshot Builder ────────────────────────────────────────────────────

export type GetSignedUrl = (assetId: string) => Promise<string>;

export interface BuildSnapshotResult {
	ok: true;
	snapshot: ArrangementSnapshotV1;
}

export interface BuildSnapshotError {
	ok: false;
	errors: SnapshotValidationError[];
}

/**
 * Build a validated ArrangementSnapshotV1 from arrangement store state.
 *
 * @param projectId - The project ID
 * @param clips - Current arrangement clips from the store
 * @param getSignedUrl - Async function that resolves assetId → signed R2 URL
 * @returns Validated snapshot or validation errors
 */
export async function buildSnapshot(
	projectId: string,
	clips: ArrangementClipState[],
	getSignedUrl: GetSignedUrl
): Promise<BuildSnapshotResult | BuildSnapshotError> {
	// Validate projectId
	if (!projectId) {
		return {
			ok: false,
			errors: [{ clipId: null, field: 'projectId', message: 'projectId is required' }]
		};
	}

	// Validate all clips
	const allErrors: SnapshotValidationError[] = [];
	for (const clip of clips) {
		allErrors.push(...validateClip(clip));
	}

	if (allErrors.length > 0) {
		return { ok: false, errors: allErrors };
	}

	// Resolve signed URLs for each unique asset
	const uniqueAssetIds = [...new Set(clips.map((c) => c.assetId))];
	const urlMap = new Map<string, string>();

	for (const assetId of uniqueAssetIds) {
		const url = await getSignedUrl(assetId);
		urlMap.set(assetId, url);
	}

	// Build clip snapshots
	const clipSnapshots: ClipSnapshotV1[] = clips.map((clip) => ({
		clipId: clip.clipId,
		assetId: clip.assetId,
		sourceUrl: urlMap.get(clip.assetId)!,
		startTimeSec: clip.startTimeSec,
		trimStartSec: clip.trimStartSec,
		trimEndSec: clip.trimEndSec,
		clipDurationSec: clip.clipDurationSec,
		gainDb: clip.gainDb,
		muted: clip.muted,
		soloed: clip.soloed,
		layerOrder: clip.layerOrder
	}));

	const snapshot: ArrangementSnapshotV1 = {
		snapshotVersion: 1,
		projectId,
		renderedAt: new Date().toISOString(),
		sampleRate: 44100,
		bitDepth: 16,
		clips: clipSnapshots
	};

	return { ok: true, snapshot };
}
