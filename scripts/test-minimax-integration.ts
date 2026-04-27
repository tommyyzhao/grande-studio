/**
 * Real MiniMax API integration test.
 * Run with: npx tsx scripts/test-minimax-integration.ts
 */
import 'dotenv/config';
import * as fs from 'fs';

// CORRECT endpoint: api.minimax.io (NOT api.minimaxi.chat)
const MINIMAX_API_BASE = 'https://api.minimax.io/v1';
const MINIMAX_MUSIC_ENDPOINT = `${MINIMAX_API_BASE}/music_generation`;

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
	console.error('MINIMAX_API_KEY not set in .env');
	process.exit(1);
}

console.log('=== MiniMax API Integration Test ===\n');
console.log(`API Key: ${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`);
console.log(`Endpoint: ${MINIMAX_MUSIC_ENDPOINT}\n`);

// Test 1: Instrumental generation (non-streaming, hex output)
async function testInstrumentalGeneration() {
	console.log('--- Test 1: Instrumental Generation (music-2.6) ---');

	const payload = {
		model: 'music-2.6',
		prompt: 'A calm lo-fi hip hop beat with soft piano and vinyl crackle, 90 BPM',
		is_instrumental: true,
		stream: false,
		output_format: 'hex',
		audio_setting: {
			sample_rate: 44100,
			bitrate: 256000,
			format: 'mp3'
		}
	};

	console.log('Request payload:', JSON.stringify(payload, null, 2));

	try {
		const start = Date.now();
		const response = await fetch(MINIMAX_MUSIC_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify(payload)
		});
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);

		console.log(`\nHTTP Status: ${response.status} ${response.statusText} (${elapsed}s)`);

		const result = await response.json();
		console.log('base_resp:', JSON.stringify(result.base_resp));

		if (result.base_resp?.status_code !== 0) {
			console.error('API Error:', result.base_resp?.status_msg);
			return false;
		}

		console.log('trace_id:', result.trace_id);
		console.log('extra_info:', JSON.stringify(result.extra_info));
		console.log('data.status:', result.data?.status);

		if (result.data?.audio) {
			const hex = result.data.audio;
			const byteLen = hex.length / 2;
			console.log(`audio hex length: ${hex.length} chars (${(byteLen / 1024 / 1024).toFixed(2)} MB decoded)`);

			// Decode and check format header
			const bytes = new Uint8Array(byteLen);
			for (let i = 0; i < hex.length; i += 2) {
				bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
			}
			const header = Array.from(bytes.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
			console.log(`first 4 bytes: ${header}`);

			if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
				console.log('-> MP3 (MPEG frame sync)');
			} else if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
				console.log('-> MP3 with ID3 tag');
			}

			fs.writeFileSync('/tmp/minimax-test.mp3', bytes);
			console.log('-> Saved to /tmp/minimax-test.mp3');
		}

		return true;
	} catch (error) {
		console.error('Request failed:', error);
		return false;
	}
}

// Test 2: Streaming generation
async function testStreamingGeneration() {
	console.log('\n--- Test 2: Streaming Instrumental (music-2.6, stream=true) ---');

	const payload = {
		model: 'music-2.6',
		prompt: 'An energetic electronic dance beat, 128 BPM',
		is_instrumental: true,
		stream: true,
		output_format: 'hex',
		audio_setting: {
			sample_rate: 44100,
			bitrate: 256000,
			format: 'mp3'
		}
	};

	console.log('Request payload:', JSON.stringify(payload, null, 2));

	try {
		const start = Date.now();
		const response = await fetch(MINIMAX_MUSIC_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify(payload)
		});

		console.log(`\nHTTP Status: ${response.status} ${response.statusText}`);
		console.log('Content-Type:', response.headers.get('content-type'));

		if (!response.ok) {
			const errorText = await response.text();
			console.error('Error:', errorText.substring(0, 500));
			return false;
		}

		if (!response.body) {
			console.error('No response body for streaming');
			return false;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let chunkCount = 0;
		let totalHexLen = 0;
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(':')) continue;

				const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
				if (data === '[DONE]') {
					console.log('Received [DONE] sentinel');
					continue;
				}

				try {
					const parsed = JSON.parse(data);
					const audio = parsed.data?.audio ?? parsed.audio;
					if (audio) {
						chunkCount++;
						totalHexLen += audio.length;
						if (chunkCount <= 3 || chunkCount % 10 === 0) {
							console.log(`  chunk ${chunkCount}: ${audio.length} hex chars`);
						}
					}
					if (parsed.data?.status === 2 || parsed.is_final) {
						console.log('  -> Final chunk received');
					}
					// Log extra_info if present
					if (parsed.extra_info && chunkCount <= 1) {
						console.log('  extra_info:', JSON.stringify(parsed.extra_info));
					}
				} catch {
					// Not JSON
				}
			}
		}

		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		console.log(`\nStreaming complete (${elapsed}s): ${chunkCount} chunks, ${totalHexLen} total hex chars (${(totalHexLen/2/1024/1024).toFixed(2)} MB decoded)`);

		return chunkCount > 0;
	} catch (error) {
		console.error('Streaming failed:', error);
		return false;
	}
}

// Run tests
(async () => {
	const test1 = await testInstrumentalGeneration();
	console.log(`\nTest 1 (non-streaming): ${test1 ? 'PASS' : 'FAIL'}`);

	if (test1) {
		const test2 = await testStreamingGeneration();
		console.log(`\nTest 2 (streaming): ${test2 ? 'PASS' : 'FAIL'}`);
	}

	console.log('\n=== Integration Test Complete ===');
})();
