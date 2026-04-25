/**
 * Arrangement persistence — debounced DB writes and hydration for arrangement state.
 *
 * Wraps the arrangement store's mutation methods to add persistence:
 * - Property edits (gain, mute, solo, trim, offset, duration, layer order) → debounced DB writes
 * - Destructive actions (removeClip) → immediate DB writes
 * - hydrate(projectId) → loads clips from DB and populates the store
 *
 * Must be called within a Svelte component context (so $effect cleanup works).
 */
import type { ArrangementClipState } from '$lib/audio-engine/engine';
import type { ClipUpdate } from './arrangement.svelte';

const DEBOUNCE_MS = 500;

/** Fields that trigger debounced persistence when changed */
const PERSISTABLE_FIELDS = [
	'gainDb',
	'muted',
	'soloed',
	'startTimeSec',
	'trimStartSec',
	'trimEndSec',
	'clipDurationSec',
	'layerOrder'
] as const;

/** Minimal store interface needed by the persistence layer */
export interface ArrangementStorePersistable {
	readonly clips: ArrangementClipState[];
	setClips(clips: ArrangementClipState[]): void;
	updateClip(update: ClipUpdate): void;
	removeClip(clipId: string): void;
	reorderClips(orderedClipIds: string[]): void;
}

/** Convert a DB row (with numeric strings) to an ArrangementClipState */
function rowToClipState(row: Record<string, unknown>): ArrangementClipState {
	return {
		clipId: row.id as string,
		assetId: row.assetId as string,
		startTimeSec: Number(row.startTimeSec) || 0,
		trimStartSec: Number(row.trimStartSec) || 0,
		trimEndSec: row.trimEndSec != null ? Number(row.trimEndSec) : null,
		clipDurationSec: Number(row.clipDurationSec),
		gainDb: Number(row.gainDb) || 0,
		muted: Boolean(row.muted),
		soloed: Boolean(row.soloed),
		layerOrder: Number(row.layerOrder) || 0
	};
}

/**
 * Creates a persistence-aware wrapper around the arrangement store.
 * Returns methods that update the store AND trigger DB persistence.
 */
export function createArrangementPersistence(store: ArrangementStorePersistable) {
	const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Accumulated changes per clip during debounce window */
	const pendingChanges = new Map<string, Partial<ArrangementClipState>>();

	// --- Server communication ---

	async function persistClipUpdate(
		clipId: string,
		changes: Partial<ArrangementClipState>
	): Promise<void> {
		try {
			const response = await fetch('/api/arrangement', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clipId, ...changes })
			});
			if (!response.ok) {
				console.error(`Failed to persist clip update for ${clipId}:`, response.statusText);
			}
		} catch (err) {
			console.error(`Failed to persist clip update for ${clipId}:`, err);
		}
	}

	async function persistClipRemoval(clipId: string): Promise<void> {
		try {
			const response = await fetch(
				`/api/arrangement?clipId=${encodeURIComponent(clipId)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				console.error(`Failed to persist clip removal for ${clipId}:`, response.statusText);
			}
		} catch (err) {
			console.error(`Failed to persist clip removal for ${clipId}:`, err);
		}
	}

	// --- Debounced persistence ---

	function scheduleUpdate(clipId: string, changes: Partial<ArrangementClipState>): void {
		// Accumulate changes during the debounce window
		const existing = pendingChanges.get(clipId);
		if (existing) {
			pendingChanges.set(clipId, { ...existing, ...changes });
		} else {
			pendingChanges.set(clipId, { ...changes });
		}

		// Reset timer
		const timer = debounceTimers.get(clipId);
		if (timer) clearTimeout(timer);

		debounceTimers.set(
			clipId,
			setTimeout(() => {
				debounceTimers.delete(clipId);
				const accumulated = pendingChanges.get(clipId);
				pendingChanges.delete(clipId);
				if (accumulated) {
					persistClipUpdate(clipId, accumulated);
				}
			}, DEBOUNCE_MS)
		);
	}

	// --- Public API ---

	/**
	 * Load clips from DB and hydrate the store.
	 * Does NOT trigger persistence writes.
	 */
	async function hydrate(projectId: string): Promise<void> {
		const response = await fetch(
			`/api/arrangement?projectId=${encodeURIComponent(projectId)}`
		);
		if (!response.ok) {
			throw new Error(`Failed to load arrangement: ${response.statusText}`);
		}
		const { clips } = await response.json();
		const clipStates: ArrangementClipState[] = (clips as Record<string, unknown>[]).map(
			rowToClipState
		);
		store.setClips(clipStates);
	}

	/**
	 * Update a clip's fields in the store and schedule debounced DB write.
	 */
	function updateClip(update: ClipUpdate): void {
		store.updateClip(update);

		// Extract only persistable changed fields
		const { clipId, ...changes } = update;
		const persistable: Partial<ArrangementClipState> = {};
		let hasPersistable = false;

		for (const key of PERSISTABLE_FIELDS) {
			if (key in changes) {
				(persistable as Record<string, unknown>)[key] = (changes as Record<string, unknown>)[
					key
				];
				hasPersistable = true;
			}
		}

		if (hasPersistable) {
			scheduleUpdate(clipId, persistable);
		}
	}

	/**
	 * Remove a clip from the store and immediately persist to DB.
	 */
	function removeClip(clipId: string): void {
		// Cancel any pending debounced updates for this clip
		const timer = debounceTimers.get(clipId);
		if (timer) {
			clearTimeout(timer);
			debounceTimers.delete(clipId);
		}
		pendingChanges.delete(clipId);

		store.removeClip(clipId);
		persistClipRemoval(clipId);
	}

	/**
	 * Reorder clips in the store and schedule debounced DB writes for layer order changes.
	 */
	function reorderClips(orderedClipIds: string[]): void {
		store.reorderClips(orderedClipIds);

		// Persist layer order for each clip
		for (let i = 0; i < orderedClipIds.length; i++) {
			scheduleUpdate(orderedClipIds[i], { layerOrder: i });
		}
	}

	/**
	 * Flush all pending debounced writes immediately.
	 */
	function flush(): void {
		for (const [clipId, timer] of debounceTimers) {
			clearTimeout(timer);
			debounceTimers.delete(clipId);
			const accumulated = pendingChanges.get(clipId);
			pendingChanges.delete(clipId);
			if (accumulated) {
				persistClipUpdate(clipId, accumulated);
			}
		}
	}

	/**
	 * Clean up all pending debounce timers.
	 */
	function dispose(): void {
		for (const timer of debounceTimers.values()) {
			clearTimeout(timer);
		}
		debounceTimers.clear();
		pendingChanges.clear();
	}

	return {
		/** Load arrangement from DB into the store */
		hydrate,
		/** Update a clip (store + debounced DB write) */
		updateClip,
		/** Remove a clip (store + immediate DB write) */
		removeClip,
		/** Reorder clips (store + debounced DB writes for layer order) */
		reorderClips,
		/** Flush all pending writes immediately */
		flush,
		/** Clean up timers (call on unmount) */
		dispose
	};
}
