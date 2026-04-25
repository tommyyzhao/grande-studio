import { describe, it, expect, vi, beforeEach } from 'vitest';
import { diffAndDispatch, type BridgeEngineTarget } from './arrangement-engine-bridge.svelte';
import type { ArrangementClipState } from '$lib/audio-engine/engine';

function makeClip(overrides: Partial<ArrangementClipState> & { clipId: string }): ArrangementClipState {
	return {
		assetId: 'asset-1',
		startTimeSec: 0,
		trimStartSec: 0,
		trimEndSec: null,
		clipDurationSec: 5,
		gainDb: 0,
		muted: false,
		soloed: false,
		layerOrder: 0,
		...overrides
	};
}

function createMockEngine(): BridgeEngineTarget & {
	calls: Record<string, unknown[][]>;
} {
	const calls: Record<string, unknown[][]> = {};

	function track(method: string) {
		return vi.fn((...args: unknown[]) => {
			if (!calls[method]) calls[method] = [];
			calls[method].push(args);
		});
	}

	return {
		calls,
		setArrangement: track('setArrangement'),
		setClipGain: track('setClipGain'),
		setClipMute: track('setClipMute'),
		setClipSolo: track('setClipSolo'),
		setClipStartOffset: track('setClipStartOffset'),
		setClipTrim: track('setClipTrim'),
		setClipLoop: track('setClipLoop'),
		setClipAssetId: track('setClipAssetId')
	};
}

describe('diffAndDispatch', () => {
	let engine: ReturnType<typeof createMockEngine>;

	beforeEach(() => {
		engine = createMockEngine();
	});

	// ─── Structural changes ───────────────────────────────────────────

	describe('structural changes (add/remove clips)', () => {
		it('calls setArrangement when a clip is added', () => {
			const clip = makeClip({ clipId: 'c1' });
			diffAndDispatch(engine, [clip], [], new Set());

			expect(engine.setArrangement).toHaveBeenCalledOnce();
			expect(engine.setArrangement).toHaveBeenCalledWith([clip]);
		});

		it('calls setArrangement when a clip is removed', () => {
			const clip = makeClip({ clipId: 'c1' });
			diffAndDispatch(engine, [], [clip], new Set(['c1']));

			expect(engine.setArrangement).toHaveBeenCalledOnce();
			expect(engine.setArrangement).toHaveBeenCalledWith([]);
		});

		it('calls setArrangement when clips are swapped (different IDs)', () => {
			const oldClip = makeClip({ clipId: 'c1' });
			const newClip = makeClip({ clipId: 'c2' });
			diffAndDispatch(engine, [newClip], [oldClip], new Set(['c1']));

			expect(engine.setArrangement).toHaveBeenCalledOnce();
		});

		it('calls setArrangement when multiple clips added simultaneously', () => {
			const clips = [makeClip({ clipId: 'c1' }), makeClip({ clipId: 'c2' })];
			diffAndDispatch(engine, clips, [], new Set());

			expect(engine.setArrangement).toHaveBeenCalledOnce();
			expect(engine.setArrangement).toHaveBeenCalledWith(clips);
		});

		it('does NOT call individual setters on structural changes', () => {
			const clip = makeClip({ clipId: 'c1', gainDb: -6 });
			diffAndDispatch(engine, [clip], [], new Set());

			expect(engine.setClipGain).not.toHaveBeenCalled();
			expect(engine.setClipMute).not.toHaveBeenCalled();
			expect(engine.setClipSolo).not.toHaveBeenCalled();
		});
	});

	// ─── No changes ──────────────────────────────────────────────────

	describe('no changes', () => {
		it('calls nothing when clips are identical', () => {
			const clip = makeClip({ clipId: 'c1' });
			const prevClip = makeClip({ clipId: 'c1' });
			diffAndDispatch(engine, [clip], [prevClip], new Set(['c1']));

			expect(engine.setArrangement).not.toHaveBeenCalled();
			expect(engine.setClipGain).not.toHaveBeenCalled();
			expect(engine.setClipMute).not.toHaveBeenCalled();
			expect(engine.setClipSolo).not.toHaveBeenCalled();
			expect(engine.setClipStartOffset).not.toHaveBeenCalled();
			expect(engine.setClipTrim).not.toHaveBeenCalled();
			expect(engine.setClipLoop).not.toHaveBeenCalled();
			expect(engine.setClipAssetId).not.toHaveBeenCalled();
		});

		it('calls nothing for empty arrays', () => {
			diffAndDispatch(engine, [], [], new Set());

			expect(engine.setArrangement).not.toHaveBeenCalled();
		});
	});

	// ─── Gain changes ────────────────────────────────────────────────

	describe('gain changes', () => {
		it('calls setClipGain when gainDb changes', () => {
			const prev = makeClip({ clipId: 'c1', gainDb: 0 });
			const curr = makeClip({ clipId: 'c1', gainDb: -6 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipGain).toHaveBeenCalledOnce();
			expect(engine.setClipGain).toHaveBeenCalledWith('c1', -6);
			expect(engine.setArrangement).not.toHaveBeenCalled();
		});

		it('does not call setClipGain when gainDb is unchanged', () => {
			const prev = makeClip({ clipId: 'c1', gainDb: -6 });
			const curr = makeClip({ clipId: 'c1', gainDb: -6 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipGain).not.toHaveBeenCalled();
		});
	});

	// ─── Mute changes ────────────────────────────────────────────────

	describe('mute changes', () => {
		it('calls setClipMute when muted changes to true', () => {
			const prev = makeClip({ clipId: 'c1', muted: false });
			const curr = makeClip({ clipId: 'c1', muted: true });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipMute).toHaveBeenCalledOnce();
			expect(engine.setClipMute).toHaveBeenCalledWith('c1', true);
		});

		it('calls setClipMute when muted changes to false', () => {
			const prev = makeClip({ clipId: 'c1', muted: true });
			const curr = makeClip({ clipId: 'c1', muted: false });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipMute).toHaveBeenCalledOnce();
			expect(engine.setClipMute).toHaveBeenCalledWith('c1', false);
		});
	});

	// ─── Solo changes ────────────────────────────────────────────────

	describe('solo changes', () => {
		it('calls setClipSolo when soloed changes', () => {
			const prev = makeClip({ clipId: 'c1', soloed: false });
			const curr = makeClip({ clipId: 'c1', soloed: true });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipSolo).toHaveBeenCalledOnce();
			expect(engine.setClipSolo).toHaveBeenCalledWith('c1', true);
		});
	});

	// ─── Start offset changes ────────────────────────────────────────

	describe('start offset changes', () => {
		it('calls setClipStartOffset when startTimeSec changes', () => {
			const prev = makeClip({ clipId: 'c1', startTimeSec: 0 });
			const curr = makeClip({ clipId: 'c1', startTimeSec: 2.5 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipStartOffset).toHaveBeenCalledOnce();
			expect(engine.setClipStartOffset).toHaveBeenCalledWith('c1', 2.5);
		});

		it('does not call setClipStartOffset when unchanged', () => {
			const prev = makeClip({ clipId: 'c1', startTimeSec: 2.5 });
			const curr = makeClip({ clipId: 'c1', startTimeSec: 2.5 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipStartOffset).not.toHaveBeenCalled();
		});
	});

	// ─── Trim changes ────────────────────────────────────────────────

	describe('trim changes', () => {
		it('calls setClipTrim when trimStartSec changes', () => {
			const prev = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null });
			const curr = makeClip({ clipId: 'c1', trimStartSec: 1.0, trimEndSec: null });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipTrim).toHaveBeenCalledOnce();
			expect(engine.setClipTrim).toHaveBeenCalledWith('c1', 1.0, null);
		});

		it('calls setClipTrim when trimEndSec changes', () => {
			const prev = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null });
			const curr = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: 3.5 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipTrim).toHaveBeenCalledOnce();
			expect(engine.setClipTrim).toHaveBeenCalledWith('c1', 0, 3.5);
		});

		it('calls setClipTrim when both trim values change', () => {
			const prev = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null });
			const curr = makeClip({ clipId: 'c1', trimStartSec: 1.0, trimEndSec: 4.0 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipTrim).toHaveBeenCalledOnce();
			expect(engine.setClipTrim).toHaveBeenCalledWith('c1', 1.0, 4.0);
		});

		it('calls setClipTrim when trimEndSec changes from number to null', () => {
			const prev = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: 3.0 });
			const curr = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipTrim).toHaveBeenCalledOnce();
			expect(engine.setClipTrim).toHaveBeenCalledWith('c1', 0, null);
		});

		it('does not call setClipTrim when both null', () => {
			const prev = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null });
			const curr = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipTrim).not.toHaveBeenCalled();
		});
	});

	// ─── Clip duration / loop changes ────────────────────────────────

	describe('clip duration / loop changes', () => {
		it('calls setClipLoop when clipDurationSec changes', () => {
			const prev = makeClip({ clipId: 'c1', clipDurationSec: 5 });
			const curr = makeClip({ clipId: 'c1', clipDurationSec: 12.5 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipLoop).toHaveBeenCalledOnce();
			expect(engine.setClipLoop).toHaveBeenCalledWith('c1', 12.5);
		});

		it('does not call setClipLoop when clipDurationSec is unchanged', () => {
			const prev = makeClip({ clipId: 'c1', clipDurationSec: 5 });
			const curr = makeClip({ clipId: 'c1', clipDurationSec: 5 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipLoop).not.toHaveBeenCalled();
		});
	});

	// ─── Asset ID changes ────────────────────────────────────────────

	describe('asset ID changes', () => {
		it('calls setClipAssetId when assetId changes', () => {
			const prev = makeClip({ clipId: 'c1', assetId: 'asset-1' });
			const curr = makeClip({ clipId: 'c1', assetId: 'asset-2' });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipAssetId).toHaveBeenCalledOnce();
			expect(engine.setClipAssetId).toHaveBeenCalledWith('c1', 'asset-2');
		});
	});

	// ─── Multiple changes on one clip ────────────────────────────────

	describe('multiple changes on one clip', () => {
		it('calls multiple setters when several properties change at once', () => {
			const prev = makeClip({ clipId: 'c1', gainDb: 0, muted: false, startTimeSec: 0 });
			const curr = makeClip({ clipId: 'c1', gainDb: -6, muted: true, startTimeSec: 2.0 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipGain).toHaveBeenCalledWith('c1', -6);
			expect(engine.setClipMute).toHaveBeenCalledWith('c1', true);
			expect(engine.setClipStartOffset).toHaveBeenCalledWith('c1', 2.0);
			expect(engine.setArrangement).not.toHaveBeenCalled();
		});

		it('calls both setClipTrim and setClipLoop when trim and duration change together', () => {
			const prev = makeClip({ clipId: 'c1', trimStartSec: 0, trimEndSec: null, clipDurationSec: 5 });
			const curr = makeClip({ clipId: 'c1', trimStartSec: 1.0, trimEndSec: 3.0, clipDurationSec: 2.0 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setClipTrim).toHaveBeenCalledWith('c1', 1.0, 3.0);
			expect(engine.setClipLoop).toHaveBeenCalledWith('c1', 2.0);
		});
	});

	// ─── Multiple clips ──────────────────────────────────────────────

	describe('multiple clips', () => {
		it('dispatches changes independently per clip', () => {
			const prev = [
				makeClip({ clipId: 'c1', gainDb: 0 }),
				makeClip({ clipId: 'c2', gainDb: 0 })
			];
			const curr = [
				makeClip({ clipId: 'c1', gainDb: -6 }),
				makeClip({ clipId: 'c2', soloed: true })
			];
			diffAndDispatch(engine, curr, prev, new Set(['c1', 'c2']));

			expect(engine.setClipGain).toHaveBeenCalledWith('c1', -6);
			expect(engine.setClipSolo).toHaveBeenCalledWith('c2', true);
			expect(engine.setArrangement).not.toHaveBeenCalled();
		});

		it('only dispatches for clips that changed', () => {
			const prev = [
				makeClip({ clipId: 'c1', gainDb: 0 }),
				makeClip({ clipId: 'c2', gainDb: -3 })
			];
			const curr = [
				makeClip({ clipId: 'c1', gainDb: 0 }),	// unchanged
				makeClip({ clipId: 'c2', gainDb: -6 })		// changed
			];
			diffAndDispatch(engine, curr, prev, new Set(['c1', 'c2']));

			expect(engine.setClipGain).toHaveBeenCalledOnce();
			expect(engine.setClipGain).toHaveBeenCalledWith('c2', -6);
		});
	});

	// ─── Returned snapshot ───────────────────────────────────────────

	describe('returned snapshot', () => {
		it('returns shallow copies of current clips for next comparison', () => {
			const clip = makeClip({ clipId: 'c1', gainDb: -6 });
			const result = diffAndDispatch(engine, [clip], [], new Set());

			expect(result.clips).toHaveLength(1);
			expect(result.clips[0]).toEqual(clip);
			expect(result.clips[0]).not.toBe(clip); // different reference
		});

		it('returns updated clip IDs set', () => {
			const clips = [makeClip({ clipId: 'c1' }), makeClip({ clipId: 'c2' })];
			const result = diffAndDispatch(engine, clips, [], new Set());

			expect(result.clipIds).toEqual(new Set(['c1', 'c2']));
		});

		it('chained calls work correctly (simulating reactive loop)', () => {
			// First call: add clip
			const clip1 = makeClip({ clipId: 'c1', gainDb: 0 });
			const r1 = diffAndDispatch(engine, [clip1], [], new Set());
			expect(engine.setArrangement).toHaveBeenCalledOnce();

			// Second call: change gain (property only, no structural change)
			const clip1Updated = makeClip({ clipId: 'c1', gainDb: -6 });
			const r2 = diffAndDispatch(engine, [clip1Updated], r1.clips, r1.clipIds);
			expect(engine.setClipGain).toHaveBeenCalledWith('c1', -6);
			// setArrangement should not be called again
			expect(engine.setArrangement).toHaveBeenCalledOnce();

			// Third call: add second clip (structural change)
			const clip2 = makeClip({ clipId: 'c2' });
			diffAndDispatch(engine, [clip1Updated, clip2], r2.clips, r2.clipIds);
			expect(engine.setArrangement).toHaveBeenCalledTimes(2);
		});
	});

	// ─── layerOrder is not dispatched ────────────────────────────────

	describe('layerOrder (UI-only)', () => {
		it('does not dispatch any engine call when only layerOrder changes', () => {
			const prev = makeClip({ clipId: 'c1', layerOrder: 0 });
			const curr = makeClip({ clipId: 'c1', layerOrder: 2 });
			diffAndDispatch(engine, [curr], [prev], new Set(['c1']));

			expect(engine.setArrangement).not.toHaveBeenCalled();
			expect(engine.setClipGain).not.toHaveBeenCalled();
			expect(engine.setClipMute).not.toHaveBeenCalled();
			expect(engine.setClipSolo).not.toHaveBeenCalled();
			expect(engine.setClipStartOffset).not.toHaveBeenCalled();
			expect(engine.setClipTrim).not.toHaveBeenCalled();
			expect(engine.setClipLoop).not.toHaveBeenCalled();
			expect(engine.setClipAssetId).not.toHaveBeenCalled();
		});
	});
});
