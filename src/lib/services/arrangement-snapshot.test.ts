import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSnapshot } from './arrangement-snapshot';
import type { ArrangementClipState } from '$lib/audio-engine/engine';

function makeClip(overrides: Partial<ArrangementClipState> = {}): ArrangementClipState {
	return {
		clipId: 'clip-1',
		assetId: 'asset-1',
		startTimeSec: 0,
		trimStartSec: 0,
		trimEndSec: null,
		clipDurationSec: 10,
		gainDb: 0,
		muted: false,
		soloed: false,
		layerOrder: 0,
		...overrides
	};
}

const mockGetSignedUrl = vi.fn(async (assetId: string) => `https://r2.example.com/${assetId}`);

describe('buildSnapshot', () => {
	beforeEach(() => {
		mockGetSignedUrl.mockClear();
	});

	it('builds a valid snapshot from clips', async () => {
		const clips = [
			makeClip({ clipId: 'c1', assetId: 'a1', startTimeSec: 0, clipDurationSec: 10 }),
			makeClip({ clipId: 'c2', assetId: 'a2', startTimeSec: 5, clipDurationSec: 8, gainDb: -3 })
		];

		const result = await buildSnapshot('proj-1', clips, mockGetSignedUrl);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.snapshot.snapshotVersion).toBe(1);
		expect(result.snapshot.projectId).toBe('proj-1');
		expect(result.snapshot.sampleRate).toBe(44100);
		expect(result.snapshot.bitDepth).toBe(16);
		expect(result.snapshot.renderedAt).toBeTruthy();
		expect(result.snapshot.clips).toHaveLength(2);

		expect(result.snapshot.clips[0].clipId).toBe('c1');
		expect(result.snapshot.clips[0].sourceUrl).toBe('https://r2.example.com/a1');
		expect(result.snapshot.clips[1].clipId).toBe('c2');
		expect(result.snapshot.clips[1].sourceUrl).toBe('https://r2.example.com/a2');
		expect(result.snapshot.clips[1].gainDb).toBe(-3);
	});

	it('resolves signed URLs for each unique asset only once', async () => {
		const clips = [
			makeClip({ clipId: 'c1', assetId: 'a1' }),
			makeClip({ clipId: 'c2', assetId: 'a1' }),
			makeClip({ clipId: 'c3', assetId: 'a2' })
		];

		const result = await buildSnapshot('proj-1', clips, mockGetSignedUrl);

		expect(result.ok).toBe(true);
		// Only 2 unique assets, so getSignedUrl called twice
		expect(mockGetSignedUrl).toHaveBeenCalledTimes(2);
		expect(mockGetSignedUrl).toHaveBeenCalledWith('a1');
		expect(mockGetSignedUrl).toHaveBeenCalledWith('a2');

		if (!result.ok) return;
		// Both clips sharing a1 get the same URL
		expect(result.snapshot.clips[0].sourceUrl).toBe(result.snapshot.clips[1].sourceUrl);
	});

	it('includes all clip fields in snapshot', async () => {
		const clip = makeClip({
			clipId: 'c1',
			assetId: 'a1',
			startTimeSec: 2.5,
			trimStartSec: 1,
			trimEndSec: 8,
			clipDurationSec: 14,
			gainDb: -6,
			muted: true,
			soloed: false,
			layerOrder: 3
		});

		const result = await buildSnapshot('proj-1', [clip], mockGetSignedUrl);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const cs = result.snapshot.clips[0];
		expect(cs.clipId).toBe('c1');
		expect(cs.assetId).toBe('a1');
		expect(cs.startTimeSec).toBe(2.5);
		expect(cs.trimStartSec).toBe(1);
		expect(cs.trimEndSec).toBe(8);
		expect(cs.clipDurationSec).toBe(14);
		expect(cs.gainDb).toBe(-6);
		expect(cs.muted).toBe(true);
		expect(cs.soloed).toBe(false);
		expect(cs.layerOrder).toBe(3);
	});

	it('includes muted and soloed clips (renderer applies filtering)', async () => {
		const clips = [
			makeClip({ clipId: 'c1', muted: true }),
			makeClip({ clipId: 'c2', soloed: true }),
			makeClip({ clipId: 'c3', muted: false, soloed: false })
		];

		const result = await buildSnapshot('proj-1', clips, mockGetSignedUrl);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.clips).toHaveLength(3);
	});

	it('builds valid snapshot with zero clips', async () => {
		const result = await buildSnapshot('proj-1', [], mockGetSignedUrl);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.clips).toHaveLength(0);
		expect(mockGetSignedUrl).not.toHaveBeenCalled();
	});

	// ─── Validation: missing projectId ──────────────────────────────────

	it('rejects empty projectId', async () => {
		const result = await buildSnapshot('', [makeClip()], mockGetSignedUrl);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].field).toBe('projectId');
	});

	// ─── Validation: missing required fields ────────────────────────────

	it('rejects clip with empty clipId', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ clipId: '' })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'clipId')).toBe(true);
	});

	it('rejects clip with empty assetId', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ assetId: '' })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'assetId')).toBe(true);
	});

	// ─── Validation: negative times ─────────────────────────────────────

	it('rejects negative startTimeSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ startTimeSec: -1 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'startTimeSec')).toBe(true);
	});

	it('rejects negative trimStartSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ trimStartSec: -0.5 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'trimStartSec')).toBe(true);
	});

	it('rejects negative trimEndSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ trimEndSec: -2 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'trimEndSec')).toBe(true);
	});

	it('allows null trimEndSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ trimEndSec: null })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(true);
	});

	// ─── Validation: invalid clipDurationSec ────────────────────────────

	it('rejects zero clipDurationSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ clipDurationSec: 0 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'clipDurationSec')).toBe(true);
	});

	it('rejects negative clipDurationSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ clipDurationSec: -5 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'clipDurationSec')).toBe(true);
	});

	// ─── Validation: trimEndSec <= trimStartSec ─────────────────────────

	it('rejects trimEndSec <= trimStartSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ trimStartSec: 5, trimEndSec: 3 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'trimEndSec')).toBe(true);
	});

	it('rejects trimEndSec equal to trimStartSec', async () => {
		const result = await buildSnapshot(
			'proj-1',
			[makeClip({ trimStartSec: 5, trimEndSec: 5 })],
			mockGetSignedUrl
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.field === 'trimEndSec')).toBe(true);
	});

	// ─── Validation: multiple errors ────────────────────────────────────

	it('collects errors from multiple clips', async () => {
		const clips = [
			makeClip({ clipId: 'c1', startTimeSec: -1 }),
			makeClip({ clipId: 'c2', clipDurationSec: 0 })
		];

		const result = await buildSnapshot('proj-1', clips, mockGetSignedUrl);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.length).toBeGreaterThanOrEqual(2);
		expect(result.errors.some((e) => e.clipId === 'c1')).toBe(true);
		expect(result.errors.some((e) => e.clipId === 'c2')).toBe(true);
	});

	it('does not call getSignedUrl when validation fails', async () => {
		await buildSnapshot('proj-1', [makeClip({ clipDurationSec: -1 })], mockGetSignedUrl);

		expect(mockGetSignedUrl).not.toHaveBeenCalled();
	});

	// ─── renderedAt timestamp ───────────────────────────────────────────

	it('sets renderedAt to a valid ISO timestamp', async () => {
		const result = await buildSnapshot('proj-1', [makeClip()], mockGetSignedUrl);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const parsed = new Date(result.snapshot.renderedAt);
		expect(parsed.getTime()).not.toBeNaN();
	});
});
