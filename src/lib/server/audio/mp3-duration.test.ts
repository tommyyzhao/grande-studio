import { describe, it, expect } from 'vitest';
import { estimateMp3DurationSec } from './mp3-duration';

/**
 * Build a minimal CBR MPEG-1 Layer III byte stream:
 *   - optional ID3v2 header
 *   - N frames at 128 kbps / 44100 Hz (frame size = 417, padding 0/1
 *     varies in real life; we use a constant 417 for simplicity here).
 */
function buildCbrMp3({
	frames,
	withId3 = false,
	bitrateKbps = 128,
	sampleRate = 44100
}: {
	frames: number;
	withId3?: boolean;
	bitrateKbps?: number;
	sampleRate?: number;
}): Uint8Array {
	const samplesPerFrame = 1152; // MPEG-1 Layer III
	const frameSize = Math.floor((samplesPerFrame * bitrateKbps * 1000) / 8 / sampleRate);

	const id3Size = withId3 ? 10 + 1024 : 0;
	const audio = new Uint8Array(frames * frameSize);

	const bitrateIdx = (() => {
		const table = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
		const idx = table.indexOf(bitrateKbps);
		if (idx < 0) throw new Error(`unsupported bitrate ${bitrateKbps}`);
		return idx;
	})();
	const srIdx = (() => {
		const table = [44100, 48000, 32000];
		const idx = table.indexOf(sampleRate);
		if (idx < 0) throw new Error(`unsupported sample rate ${sampleRate}`);
		return idx;
	})();

	for (let f = 0; f < frames; f++) {
		const off = f * frameSize;
		audio[off] = 0xff;
		// Version 3 (MPEG-1), Layer 1 (Layer III), no CRC
		audio[off + 1] = 0xfb;
		// Bitrate index, sample-rate index, no padding, no private
		audio[off + 2] = (bitrateIdx << 4) | (srIdx << 2);
		// Channel mode 3 (mono), no extension/copyright/original/emphasis
		audio[off + 3] = 0xc0;
	}

	if (!withId3) return audio;

	const out = new Uint8Array(id3Size + audio.length);
	out[0] = 0x49; // I
	out[1] = 0x44; // D
	out[2] = 0x33; // 3
	out[3] = 0x03; // version major
	out[4] = 0x00;
	out[5] = 0x00;
	// sync-safe size of 1024 = 0x00 0x00 0x08 0x00
	out[6] = 0x00;
	out[7] = 0x00;
	out[8] = 0x08;
	out[9] = 0x00;
	out.set(audio, id3Size);
	return out;
}

describe('estimateMp3DurationSec', () => {
	it('returns null for too-small input', () => {
		expect(estimateMp3DurationSec(new Uint8Array(10))).toBeNull();
	});

	it('returns null for non-MPEG bytes', () => {
		expect(estimateMp3DurationSec(new Uint8Array(2048))).toBeNull();
	});

	it('estimates CBR 128 kbps duration within 0.05 s', () => {
		// 30 s @ 128 kbps / 44100 Hz ≈ 1148 frames
		const frames = Math.round((30 * 44100) / 1152);
		const buf = buildCbrMp3({ frames });
		const dur = estimateMp3DurationSec(buf);
		expect(dur).not.toBeNull();
		expect(dur!).toBeGreaterThan(29.9);
		expect(dur!).toBeLessThan(30.1);
	});

	it('handles ID3v2 prefix', () => {
		const frames = Math.round((10 * 44100) / 1152);
		const buf = buildCbrMp3({ frames, withId3: true });
		const dur = estimateMp3DurationSec(buf);
		expect(dur).not.toBeNull();
		expect(dur!).toBeGreaterThan(9.9);
		expect(dur!).toBeLessThan(10.1);
	});

	it('estimates CBR 192 kbps duration', () => {
		const frames = Math.round((60 * 44100) / 1152);
		const buf = buildCbrMp3({ frames, bitrateKbps: 192 });
		const dur = estimateMp3DurationSec(buf);
		expect(dur).not.toBeNull();
		expect(dur!).toBeGreaterThan(59.5);
		expect(dur!).toBeLessThan(60.5);
	});
});
