/**
 * Worker-safe MP3 duration estimator.
 *
 * Strategy:
 *   1. Skip an ID3v2 tag if present.
 *   2. Parse the first MPEG audio frame header (sync, version, layer,
 *      bitrate, sample-rate).
 *   3. If the frame contains a Xing/Info VBR header, use the embedded
 *      total-frame count.
 *   4. Otherwise treat the file as CBR and compute
 *      `audioBytes * 8 / bitrate`.
 *
 * Returns null when the input doesn't look like a valid MPEG audio file.
 */

// MPEG-1 Layer III bitrate index → kbps. 0 = free, 15 = bad.
const BITRATE_V1_L3 = [
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0
];
// MPEG-2 / 2.5 Layer III bitrate index → kbps.
const BITRATE_V2_L3 = [
	0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0
];
const SAMPLE_RATE_V1 = [44100, 48000, 32000, 0];
const SAMPLE_RATE_V2 = [22050, 24000, 16000, 0];
const SAMPLE_RATE_V25 = [11025, 12000, 8000, 0];

type FrameHeader = {
	versionId: number; // 0=2.5, 1=reserved, 2=2, 3=1
	layer: number; // 1=III, 2=II, 3=I
	bitrateKbps: number;
	sampleRate: number;
	padding: number;
	samplesPerFrame: number;
	frameSize: number;
	headerOffset: number;
};

function parseFrameHeader(buf: Uint8Array, offset: number): FrameHeader | null {
	if (offset + 4 > buf.length) return null;
	const b0 = buf[offset];
	const b1 = buf[offset + 1];
	const b2 = buf[offset + 2];
	const b3 = buf[offset + 3];
	if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

	const versionId = (b1 >> 3) & 0x03;
	const layer = (b1 >> 1) & 0x03;
	if (versionId === 1 || layer === 0) return null;

	const bitrateIdx = (b2 >> 4) & 0x0f;
	const sampleRateIdx = (b2 >> 2) & 0x03;
	const padding = (b2 >> 1) & 0x01;

	if (bitrateIdx === 0 || bitrateIdx === 15) return null;
	if (sampleRateIdx === 3) return null;

	// We only need Layer III for MiniMax; supporting it specifically.
	if (layer !== 1) return null;

	const isV1 = versionId === 3;
	const bitrateTable = isV1 ? BITRATE_V1_L3 : BITRATE_V2_L3;
	const bitrateKbps = bitrateTable[bitrateIdx];
	let sampleRate: number;
	if (versionId === 3) sampleRate = SAMPLE_RATE_V1[sampleRateIdx];
	else if (versionId === 2) sampleRate = SAMPLE_RATE_V2[sampleRateIdx];
	else sampleRate = SAMPLE_RATE_V25[sampleRateIdx];

	if (!bitrateKbps || !sampleRate) return null;

	const samplesPerFrame = isV1 ? 1152 : 576;
	const frameSize = Math.floor((samplesPerFrame * bitrateKbps * 1000) / 8 / sampleRate) + padding;

	// Sanity: skip if frameSize would walk us off the end.
	if (frameSize < 4) return null;

	void b3;
	return {
		versionId,
		layer,
		bitrateKbps,
		sampleRate,
		padding,
		samplesPerFrame,
		frameSize,
		headerOffset: offset
	};
}

function findFirstFrame(buf: Uint8Array, start: number): FrameHeader | null {
	const limit = Math.min(buf.length - 4, start + 65536);
	for (let i = start; i < limit; i++) {
		if (buf[i] !== 0xff) continue;
		const header = parseFrameHeader(buf, i);
		if (!header) continue;
		// Confirm by looking for a second sync at offset + frameSize.
		const next = i + header.frameSize;
		if (next + 2 < buf.length) {
			if (buf[next] === 0xff && (buf[next + 1] & 0xe0) === 0xe0) {
				return header;
			}
		} else {
			return header;
		}
	}
	return null;
}

function readSyncSafeID3v2Size(buf: Uint8Array): number | null {
	if (buf.length < 10) return null;
	if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null; // "ID3"
	// Bytes 6-9 are sync-safe size (7 bits per byte).
	const size =
		((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
	return 10 + size;
}

function readU32BE(buf: Uint8Array, offset: number): number {
	return (
		((buf[offset] << 24) >>> 0) |
		(buf[offset + 1] << 16) |
		(buf[offset + 2] << 8) |
		buf[offset + 3]
	);
}

function readXingFrameCount(buf: Uint8Array, header: FrameHeader): number | null {
	// Xing/Info header lives at a fixed offset inside the first frame data:
	//   MPEG-1 mono: 17 bytes after header; stereo: 32
	//   MPEG-2/2.5 mono: 9; stereo: 17
	// We don't know channel mode from our minimal parser, so probe both
	// candidate offsets for either "Xing" or "Info" magic.
	const candidates = header.versionId === 3 ? [17, 32] : [9, 17];
	for (const rel of candidates) {
		const off = header.headerOffset + 4 + rel;
		if (off + 8 > buf.length) continue;
		const tag = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
		if (tag !== 'Xing' && tag !== 'Info') continue;
		const flags = readU32BE(buf, off + 4);
		if (!(flags & 0x01)) return null; // no frame-count field
		if (off + 12 > buf.length) return null;
		const frames = readU32BE(buf, off + 8);
		return frames > 0 ? frames : null;
	}
	return null;
}

/**
 * Estimate the duration (in seconds) of an MP3 byte stream.
 *
 * Worker-safe: pure arithmetic over a Uint8Array, no Node APIs.
 *
 * @returns Duration in seconds (rounded to 2 decimal places), or null if
 *   the input is not a recognisable MPEG Layer III stream.
 */
export function estimateMp3DurationSec(bytes: Uint8Array): number | null {
	if (!bytes || bytes.length < 64) return null;

	const id3End = readSyncSafeID3v2Size(bytes);
	const searchStart = id3End ?? 0;
	const header = findFirstFrame(bytes, searchStart);
	if (!header) return null;

	const audioStart = id3End ?? header.headerOffset;
	const audioBytes = bytes.length - audioStart;
	if (audioBytes <= 0) return null;

	const xingFrames = readXingFrameCount(bytes, header);
	let seconds: number;
	if (xingFrames != null) {
		seconds = (xingFrames * header.samplesPerFrame) / header.sampleRate;
	} else {
		// CBR: bytes * 8 / bitrate.
		seconds = (audioBytes * 8) / (header.bitrateKbps * 1000);
	}

	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	return Math.round(seconds * 100) / 100;
}
