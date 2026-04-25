/**
 * Reactive bridge between the arrangement store and the audio engine.
 * Uses Svelte 5 $effect to watch store changes and apply them to the engine.
 *
 * Must be called within a Svelte component context (so $effect has proper lifecycle).
 */
import type { AudioEngine, ArrangementClipState } from '$lib/audio-engine/engine';

/** Minimal readable interface for the arrangement store */
export interface ArrangementStoreReadable {
	readonly clips: ArrangementClipState[];
}

/** Subset of AudioEngine methods used by the bridge */
export interface BridgeEngineTarget {
	setArrangement(clips: ArrangementClipState[]): void;
	setClipGain(clipId: string, gainDb: number): void;
	setClipMute(clipId: string, muted: boolean): void;
	setClipSolo(clipId: string, soloed: boolean): void;
	setClipStartOffset(clipId: string, startTimeSec: number): void;
	setClipTrim(clipId: string, trimStartSec: number, trimEndSec: number | null): void;
	setClipLoop(clipId: string, clipDurationSec: number): void;
	setClipAssetId(clipId: string, assetId: string): void;
}

/**
 * Pure diff/dispatch logic — compares current and previous clip arrays,
 * then calls the appropriate engine methods.
 *
 * Returns the new "previous" state for the next comparison.
 */
export function diffAndDispatch(
	engine: BridgeEngineTarget,
	currentClips: ArrangementClipState[],
	previousClips: ArrangementClipState[],
	previousClipIds: Set<string>
): { clips: ArrangementClipState[]; clipIds: Set<string> } {
	const currentClipIds = new Set(currentClips.map((c) => c.clipId));

	// Detect structural changes (clips added or removed)
	const structureChanged =
		currentClipIds.size !== previousClipIds.size ||
		currentClips.some((c) => !previousClipIds.has(c.clipId)) ||
		[...previousClipIds].some((id) => !currentClipIds.has(id));

	if (structureChanged) {
		// Full reconfiguration — safe when not playing, resets engine clip state
		engine.setArrangement(currentClips);
	} else {
		// Same set of clips — apply individual property changes
		const prevMap = new Map(previousClips.map((c) => [c.clipId, c]));

		for (const clip of currentClips) {
			const prev = prevMap.get(clip.clipId);
			if (!prev) continue;

			if (clip.gainDb !== prev.gainDb) {
				engine.setClipGain(clip.clipId, clip.gainDb);
			}
			if (clip.muted !== prev.muted) {
				engine.setClipMute(clip.clipId, clip.muted);
			}
			if (clip.soloed !== prev.soloed) {
				engine.setClipSolo(clip.clipId, clip.soloed);
			}
			if (clip.startTimeSec !== prev.startTimeSec) {
				engine.setClipStartOffset(clip.clipId, clip.startTimeSec);
			}
			if (clip.trimStartSec !== prev.trimStartSec || clip.trimEndSec !== prev.trimEndSec) {
				engine.setClipTrim(clip.clipId, clip.trimStartSec, clip.trimEndSec);
			}
			if (clip.clipDurationSec !== prev.clipDurationSec) {
				engine.setClipLoop(clip.clipId, clip.clipDurationSec);
			}
			if (clip.assetId !== prev.assetId) {
				engine.setClipAssetId(clip.clipId, clip.assetId);
			}
		}
	}

	// Snapshot for next comparison (shallow copy each clip to break references)
	return {
		clips: currentClips.map((c) => ({ ...c })),
		clipIds: currentClipIds
	};
}

/**
 * Creates a reactive bridge that synchronizes arrangement store state to the audio engine.
 * Call from a Svelte component's <script> block so the $effect has proper lifecycle.
 *
 * - Structural changes (add/remove clips) → engine.setArrangement()
 * - Property changes on existing clips → individual engine setters (no playback disruption)
 */
export function createArrangementEngineBridge(
	engine: AudioEngine,
	store: ArrangementStoreReadable
): void {
	let previousClips: ArrangementClipState[] = [];
	let previousClipIds = new Set<string>();

	$effect(() => {
		const result = diffAndDispatch(engine, store.clips, previousClips, previousClipIds);
		previousClips = result.clips;
		previousClipIds = result.clipIds;
	});
}
