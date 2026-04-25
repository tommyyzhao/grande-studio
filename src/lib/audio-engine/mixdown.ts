/**
 * Rough mixdown renderer — uses OfflineAudioContext to render an arrangement
 * snapshot into a single AudioBuffer, then encodes to WAV for download.
 */
import type { ArrangementSnapshotV1, ClipSnapshotV1 } from '$lib/services/arrangement-snapshot';
import { encodeWav } from './wav-encoder';

export interface MixdownProgress {
	phase: 'loading' | 'rendering' | 'encoding' | 'done';
	/** 0–1 progress within the loading phase (assets loaded / total) */
	loadProgress: number;
}

export interface MixdownResult {
	blob: Blob;
	durationSec: number;
}

/**
 * Render arrangement snapshot to a WAV blob.
 *
 * @param snapshot - Validated ArrangementSnapshotV1
 * @param onProgress - Optional callback for progress updates
 * @returns WAV blob and duration
 */
export async function renderMixdown(
	snapshot: ArrangementSnapshotV1,
	onProgress?: (progress: MixdownProgress) => void
): Promise<MixdownResult> {
	const { sampleRate, clips } = snapshot;

	// Determine which clips are audible (mute/solo filtering)
	const audibleClips = getAudibleClips(clips);

	if (audibleClips.length === 0) {
		throw new Error('No audible clips to render. Check mute/solo settings.');
	}

	// Calculate total arrangement duration
	const totalDuration = Math.max(
		...audibleClips.map((c) => c.startTimeSec + c.clipDurationSec)
	);

	if (totalDuration <= 0) {
		throw new Error('Arrangement has zero duration.');
	}

	// ─── Phase 1: Load audio buffers ────────────────────────────────────
	onProgress?.({ phase: 'loading', loadProgress: 0 });

	const uniqueUrls = [...new Set(audibleClips.map((c) => c.sourceUrl))];
	const bufferMap = new Map<string, AudioBuffer>();

	// Use a temporary AudioContext for decoding (needed for decodeAudioData)
	const tempCtx = new AudioContext();

	try {
		for (let i = 0; i < uniqueUrls.length; i++) {
			const url = uniqueUrls[i];
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to fetch audio from ${url}: ${response.status}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
			bufferMap.set(url, audioBuffer);
			onProgress?.({ phase: 'loading', loadProgress: (i + 1) / uniqueUrls.length });
		}
	} finally {
		await tempCtx.close();
	}

	// ─── Phase 2: Render with OfflineAudioContext ───────────────────────
	onProgress?.({ phase: 'rendering', loadProgress: 1 });

	const totalSamples = Math.ceil(totalDuration * sampleRate);
	// Render as stereo (2 channels)
	const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

	for (const clip of audibleClips) {
		const buffer = bufferMap.get(clip.sourceUrl);
		if (!buffer) continue;

		const trimStart = clip.trimStartSec;
		const trimEnd = clip.trimEndSec ?? buffer.duration;
		const trimmedDuration = Math.max(0, trimEnd - trimStart);

		if (trimmedDuration <= 0) continue;

		// Per-clip gain node
		const gainNode = offlineCtx.createGain();
		const linearGain = Math.pow(10, clip.gainDb / 20);
		gainNode.gain.value = linearGain;
		gainNode.connect(offlineCtx.destination);

		const effectiveDuration = clip.clipDurationSec;

		if (effectiveDuration <= trimmedDuration) {
			// No looping — single source
			const source = offlineCtx.createBufferSource();
			source.buffer = buffer;
			source.connect(gainNode);
			source.start(clip.startTimeSec, trimStart, effectiveDuration);
		} else {
			// Looping — schedule multiple sources back-to-back
			let remaining = effectiveDuration;
			let timeOnCtx = clip.startTimeSec;
			let loopOffset = 0;

			while (remaining > 0) {
				const playDuration = Math.min(trimmedDuration - loopOffset, remaining);
				if (playDuration <= 0) break;

				const source = offlineCtx.createBufferSource();
				source.buffer = buffer;
				source.connect(gainNode);
				source.start(timeOnCtx, trimStart + loopOffset, playDuration);

				timeOnCtx += playDuration;
				remaining -= playDuration;
				loopOffset = 0;
			}
		}
	}

	const renderedBuffer = await offlineCtx.startRendering();

	// ─── Phase 3: Encode to WAV ─────────────────────────────────────────
	onProgress?.({ phase: 'encoding', loadProgress: 1 });

	const blob = encodeWav(renderedBuffer, sampleRate);

	onProgress?.({ phase: 'done', loadProgress: 1 });

	return { blob, durationSec: totalDuration };
}

/**
 * Filter clips based on mute/solo semantics:
 * - If any clip is soloed, only soloed clips are audible
 * - Otherwise, all non-muted clips are audible
 */
function getAudibleClips(clips: ClipSnapshotV1[]): ClipSnapshotV1[] {
	const anySoloed = clips.some((c) => c.soloed);
	if (anySoloed) {
		return clips.filter((c) => c.soloed);
	}
	return clips.filter((c) => !c.muted);
}

/**
 * Trigger a browser download of a Blob as a file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
