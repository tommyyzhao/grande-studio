/**
 * WAV encoder — encodes an AudioBuffer to WAV format (PCM 16-bit).
 *
 * Produces a standards-compliant RIFF/WAVE file suitable for download.
 */

/**
 * Encode an AudioBuffer to a WAV Blob (PCM 16-bit little-endian).
 *
 * @param buffer - The decoded AudioBuffer to encode
 * @param sampleRate - Target sample rate (defaults to buffer.sampleRate)
 * @returns Blob with audio/wav MIME type
 */
export function encodeWav(buffer: AudioBuffer, sampleRate?: number): Blob {
	const rate = sampleRate ?? buffer.sampleRate;
	const numChannels = buffer.numberOfChannels;
	const numSamples = buffer.length;
	const bitsPerSample = 16;
	const bytesPerSample = bitsPerSample / 8;

	// Interleave channels
	const interleaved = interleaveChannels(buffer, numChannels, numSamples);

	// Build WAV file
	const dataByteLength = interleaved.length * bytesPerSample;
	const headerSize = 44;
	const totalSize = headerSize + dataByteLength;

	const arrayBuffer = new ArrayBuffer(totalSize);
	const view = new DataView(arrayBuffer);

	// RIFF header
	writeString(view, 0, 'RIFF');
	view.setUint32(4, totalSize - 8, true); // file size - 8
	writeString(view, 8, 'WAVE');

	// fmt sub-chunk
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // sub-chunk size (PCM = 16)
	view.setUint16(20, 1, true); // audio format (1 = PCM)
	view.setUint16(22, numChannels, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * numChannels * bytesPerSample, true); // byte rate
	view.setUint16(32, numChannels * bytesPerSample, true); // block align
	view.setUint16(34, bitsPerSample, true);

	// data sub-chunk
	writeString(view, 36, 'data');
	view.setUint32(40, dataByteLength, true);

	// Write PCM samples (float32 → int16)
	let offset = 44;
	for (let i = 0; i < interleaved.length; i++) {
		const sample = Math.max(-1, Math.min(1, interleaved[i]));
		const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
		view.setInt16(offset, int16, true);
		offset += 2;
	}

	return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function interleaveChannels(
	buffer: AudioBuffer,
	numChannels: number,
	numSamples: number
): Float32Array {
	if (numChannels === 1) {
		return buffer.getChannelData(0);
	}

	const interleaved = new Float32Array(numSamples * numChannels);
	const channels: Float32Array[] = [];
	for (let ch = 0; ch < numChannels; ch++) {
		channels.push(buffer.getChannelData(ch));
	}

	for (let i = 0; i < numSamples; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			interleaved[i * numChannels + ch] = channels[ch][i];
		}
	}

	return interleaved;
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
