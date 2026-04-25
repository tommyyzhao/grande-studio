/**
 * Arrangement store — the single source of truth for arrangement clip state.
 * UI components and the audio engine both consume this store.
 *
 * Uses Svelte 5 runes ($state, $derived) for reactivity.
 */
import type { ArrangementClipState } from '$lib/audio-engine/engine';

/** Partial update for a clip — clipId is required, all other fields optional */
export type ClipUpdate = Partial<Omit<ArrangementClipState, 'clipId'>> & { clipId: string };

/**
 * Creates a reactive arrangement store backed by Svelte 5 runes.
 */
export function createArrangementStore() {
	let clips = $state<ArrangementClipState[]>([]);

	const totalDuration = $derived.by(() => {
		let maxEnd = 0;
		for (const clip of clips) {
			const endTime = clip.startTimeSec + clip.clipDurationSec;
			if (endTime > maxEnd) maxEnd = endTime;
		}
		return maxEnd;
	});

	const activeClips = $derived.by(() => {
		const anySoloed = clips.some((c) => c.soloed);
		if (anySoloed) {
			return clips.filter((c) => c.soloed);
		}
		return clips.filter((c) => !c.muted);
	});

	const clipCount = $derived(clips.length);

	function addClip(clip: ArrangementClipState): void {
		clips = [...clips, clip];
	}

	function removeClip(clipId: string): void {
		clips = clips.filter((c) => c.clipId !== clipId);
	}

	function updateClip(update: ClipUpdate): void {
		clips = clips.map((c) => {
			if (c.clipId !== update.clipId) return c;
			const { clipId: _, ...changes } = update;
			return { ...c, ...changes };
		});
	}

	function reorderClips(orderedClipIds: string[]): void {
		const indexed = new Map(orderedClipIds.map((id, i) => [id, i]));
		clips = [...clips].sort((a, b) => {
			const ai = indexed.get(a.clipId) ?? Infinity;
			const bi = indexed.get(b.clipId) ?? Infinity;
			return ai - bi;
		});
		// Update layerOrder to match new array positions
		clips = clips.map((c, i) => (c.layerOrder === i ? c : { ...c, layerOrder: i }));
	}

	/** Replace all clips at once (e.g., on project load / hydration) */
	function setClips(newClips: ArrangementClipState[]): void {
		clips = [...newClips];
	}

	/** Get a single clip by ID */
	function getClip(clipId: string): ArrangementClipState | undefined {
		return clips.find((c) => c.clipId === clipId);
	}

	return {
		/** Add a clip to the arrangement */
		addClip,
		/** Remove a clip by ID */
		removeClip,
		/** Partially update a clip's fields */
		updateClip,
		/** Reorder clips by an array of clip IDs (sets layerOrder accordingly) */
		reorderClips,
		/** Replace all clips (for hydration from DB) */
		setClips,
		/** Look up a single clip by ID */
		getClip,

		/** Reactive: all clips in order */
		get clips() {
			return clips;
		},
		/** Reactive: max(startTimeSec + clipDurationSec) across all clips */
		get totalDuration() {
			return totalDuration;
		},
		/** Reactive: clips that would be audible (solo-aware, mute-aware) */
		get activeClips() {
			return activeClips;
		},
		/** Reactive: number of clips */
		get clipCount() {
			return clipCount;
		}
	};
}

/** Singleton arrangement store for the application */
export const arrangementStore = createArrangementStore();
