import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createMiniMaxAdapter,
	buildTextToMusicPayload,
	buildInstrumentalPayload,
	buildCoverRestylePayload,
	validateR2SourceUrl,
	decodeHexToBytes,
	normalizeMiniMaxError,
	parseStreamLines,
	MiniMaxApiError,
	type MiniMaxMusicResponse
} from './adapter';
import { ProviderError } from '../types';
import type {
	TextToMusicInput,
	InstrumentalGenerationInput,
	CoverRestyleInput,
	ProviderGenerationHandle
} from '../types';

// ─── Mock Helpers ──────────────────────────────────────────────────────────

function createMockResponse(data: MiniMaxMusicResponse): Response {
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(JSON.stringify(data))
	} as Response;
}

function createSuccessResponse(taskId = 'task-123'): MiniMaxMusicResponse {
	return {
		base_resp: { status_code: 0, status_msg: 'success' },
		data: { task_id: taskId, audio_url: 'https://cdn.minimax.chat/audio/task-123.mp3' },
		extra_info: {
			audio_format: 'mp3',
			audio_sample_rate: 44100,
			audio_size: 1024000,
			bitrate: 128000,
			duration: 30
		}
	};
}

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(encoder.encode(chunks[index]));
				index++;
			} else {
				controller.close();
			}
		}
	});
}

function createStreamingHandle(taskId = 'task-stream-001'): ProviderGenerationHandle {
	return {
		providerJobId: taskId,
		supportsStreaming: true,
		metadata: { hasHexAudio: true }
	};
}

function createUrlHandle(
	taskId = 'task-url-001',
	audioUrl = 'https://cdn.minimax.chat/audio/output.mp3'
): ProviderGenerationHandle {
	return {
		providerJobId: taskId,
		supportsStreaming: false,
		metadata: { audioUrl, hasHexAudio: false }
	};
}

async function collectChunks(
	gen: AsyncGenerator<{ data: Uint8Array; sequence: number; isFinal: boolean }>
) {
	const chunks: { data: Uint8Array; sequence: number; isFinal: boolean }[] = [];
	for await (const chunk of gen) {
		chunks.push(chunk);
	}
	return chunks;
}

// ─── Hex Decoding Tests ───────────────────────────────────────────────────

describe('decodeHexToBytes', () => {
	it('decodes valid hex string', () => {
		const result = decodeHexToBytes('48656c6c6f');
		expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
	});

	it('returns empty array for empty string', () => {
		const result = decodeHexToBytes('');
		expect(result).toEqual(new Uint8Array(0));
	});

	it('throws on odd-length hex string', () => {
		expect(() => decodeHexToBytes('abc')).toThrow('odd number of characters');
	});

	it('handles uppercase hex', () => {
		const result = decodeHexToBytes('DEADBEEF');
		expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
	});

	it('handles mixed case hex', () => {
		const result = decodeHexToBytes('DeAdBeEf');
		expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
	});

	it('strips whitespace before decoding', () => {
		const result = decodeHexToBytes('48 65 6c 6c 6f');
		expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
	});
});

// ─── Error Normalization Tests ─────────────────────────────────────────────

describe('normalizeMiniMaxError', () => {
	it('maps HTTP 401 to provider_auth_error', () => {
		const error = new MiniMaxApiError('Unauthorized', 401, 'Invalid API key');
		const result = normalizeMiniMaxError(error);
		expect(result).toBeInstanceOf(ProviderError);
		expect(result.code).toBe('provider_auth_error');
		expect(result.providerStatusCode).toBe(401);
		expect(result.providerResponse).toBe('Invalid API key');
	});

	it('maps HTTP 403 to provider_auth_error', () => {
		const error = new MiniMaxApiError('Forbidden', 403, 'Access denied');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_auth_error');
		expect(result.providerStatusCode).toBe(403);
	});

	it('maps HTTP 429 to provider_rate_limited', () => {
		const error = new MiniMaxApiError('Too Many Requests', 429, 'Rate limited');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_rate_limited');
		expect(result.providerStatusCode).toBe(429);
	});

	it('maps HTTP 400 to provider_validation_error', () => {
		const error = new MiniMaxApiError('Bad Request', 400, 'Invalid parameter');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_validation_error');
		expect(result.providerStatusCode).toBe(400);
	});

	it('maps HTTP 408 to provider_timeout', () => {
		const error = new MiniMaxApiError('Request Timeout', 408, '');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_timeout');
	});

	it('maps HTTP 502 to provider_timeout', () => {
		const error = new MiniMaxApiError('Bad Gateway', 502, '');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_timeout');
	});

	it('maps HTTP 503 to provider_timeout', () => {
		const error = new MiniMaxApiError('Service Unavailable', 503, '');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_timeout');
	});

	it('maps HTTP 504 to provider_timeout', () => {
		const error = new MiniMaxApiError('Gateway Timeout', 504, '');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_timeout');
	});

	it('maps MiniMax status code 1001 to provider_validation_error', () => {
		const error = new MiniMaxApiError('Invalid parameter', 1001, '{"status_code":1001}');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_validation_error');
		expect(result.providerStatusCode).toBe(1001);
	});

	it('maps network TypeError to provider_timeout', () => {
		const error = new TypeError('Failed to fetch');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_timeout');
		expect(result.message).toContain('network error');
	});

	it('maps AbortError to provider_timeout', () => {
		const error = new DOMException('The operation was aborted', 'AbortError');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_timeout');
	});

	it('passes through existing ProviderError unchanged', () => {
		const original = new ProviderError('Already normalized', 'provider_auth_error', 401);
		const result = normalizeMiniMaxError(original);
		expect(result).toBe(original);
	});

	it('maps unknown error to provider_validation_error', () => {
		const error = new Error('Something unexpected');
		const result = normalizeMiniMaxError(error);
		expect(result.code).toBe('provider_validation_error');
		expect(result.message).toContain('Something unexpected');
	});

	it('maps non-Error values to provider_validation_error', () => {
		const result = normalizeMiniMaxError('string error');
		expect(result.code).toBe('provider_validation_error');
		expect(result.message).toContain('string error');
	});
});

// ─── Stream Parsing Tests ──────────────────────────────────────────────────

describe('parseStreamLines', () => {
	it('parses plain JSON lines with audio hex data', async () => {
		const stream = createMockStream([
			'{"audio":"48656c6c6f"}\n',
			'{"audio":"576f726c64","is_final":true}\n'
		]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([
			{ hex: '48656c6c6f', isFinal: false },
			{ hex: '576f726c64', isFinal: true }
		]);
	});

	it('parses SSE-prefixed lines', async () => {
		const stream = createMockStream([
			'data: {"audio":"aabbccdd"}\n',
			'data: {"audio":"eeff0011","is_final":true}\n'
		]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([
			{ hex: 'aabbccdd', isFinal: false },
			{ hex: 'eeff0011', isFinal: true }
		]);
	});

	it('handles nested data.audio format', async () => {
		const stream = createMockStream([
			'{"data":{"audio":"deadbeef"}}\n',
			'{"data":{"audio":"cafebabe","status":2}}\n'
		]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([
			{ hex: 'deadbeef', isFinal: false },
			{ hex: 'cafebabe', isFinal: true }
		]);
	});

	it('terminates on [DONE] marker', async () => {
		const stream = createMockStream([
			'data: {"audio":"aabbccdd"}\n',
			'data: [DONE]\n',
			'data: {"audio":"should_not_appear"}\n'
		]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([{ hex: 'aabbccdd', isFinal: false }]);
	});

	it('skips empty lines and SSE comments', async () => {
		const stream = createMockStream([
			': this is a comment\n',
			'\n',
			'{"audio":"aabb"}\n',
			'\n',
			'{"audio":"ccdd","is_final":true}\n'
		]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([
			{ hex: 'aabb', isFinal: false },
			{ hex: 'ccdd', isFinal: true }
		]);
	});

	it('handles chunks split across stream reads', async () => {
		// The JSON line is split across two stream chunks
		const stream = createMockStream([
			'{"audio":"aa',
			'bb"}\n{"audio":"ccdd","is_final":true}\n'
		]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([
			{ hex: 'aabb', isFinal: false },
			{ hex: 'ccdd', isFinal: true }
		]);
	});

	it('flushes remaining buffer at end of stream', async () => {
		// Last line has no trailing newline
		const stream = createMockStream(['{"audio":"aabbccdd"}']);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([{ hex: 'aabbccdd', isFinal: true }]);
	});

	it('handles empty stream', async () => {
		const stream = createMockStream([]);
		const chunks: { hex: string; isFinal: boolean }[] = [];
		for await (const chunk of parseStreamLines(stream)) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([]);
	});
});

// ─── Payload Builder Tests ──────────────────────────────────────────────────

describe('buildTextToMusicPayload', () => {
	it('formats basic text-to-music payload', () => {
		const input: TextToMusicInput = {
			prompt: 'An upbeat pop song about summer',
			lyrics: '[Verse]\nSunshine on the beach',
			instrumental: false
		};

		const payload = buildTextToMusicPayload(input);

		expect(payload).toEqual({
			model: 'music-01',
			prompt: 'An upbeat pop song about summer',
			lyrics: '[Verse]\nSunshine on the beach',
			is_instrumental: false
		});
	});

	it('sets is_instrumental to false for text-to-music', () => {
		const input: TextToMusicInput = {
			prompt: 'A chill song',
			lyrics: 'La la la',
			instrumental: false
		};

		const payload = buildTextToMusicPayload(input);
		expect(payload.is_instrumental).toBe(false);
	});

	it('omits lyrics when not provided', () => {
		const input: TextToMusicInput = {
			prompt: 'A pop song',
			instrumental: false,
			lyricsOptimizer: true
		};

		const payload = buildTextToMusicPayload(input);
		expect(payload.lyrics).toBeUndefined();
	});

	it('includes lyrics_optimization when optimizer is enabled', () => {
		const input: TextToMusicInput = {
			prompt: 'A pop song',
			instrumental: false,
			lyricsOptimizer: true
		};

		const payload = buildTextToMusicPayload(input);
		expect(payload.lyrics_optimization).toBe(true);
	});

	it('omits lyrics_optimization when optimizer is disabled', () => {
		const input: TextToMusicInput = {
			prompt: 'A pop song',
			lyrics: 'Some lyrics',
			instrumental: false,
			lyricsOptimizer: false
		};

		const payload = buildTextToMusicPayload(input);
		expect(payload.lyrics_optimization).toBeUndefined();
	});

	it('includes both lyrics and lyrics_optimization when both provided', () => {
		const input: TextToMusicInput = {
			prompt: 'A pop song',
			lyrics: '[Verse]\nHello world',
			instrumental: false,
			lyricsOptimizer: true
		};

		const payload = buildTextToMusicPayload(input);
		expect(payload.lyrics).toBe('[Verse]\nHello world');
		expect(payload.lyrics_optimization).toBe(true);
	});
});

describe('buildInstrumentalPayload', () => {
	it('formats instrumental payload with is_instrumental=true', () => {
		const input: InstrumentalGenerationInput = {
			prompt: 'A relaxing lo-fi beat'
		};

		const payload = buildInstrumentalPayload(input);

		expect(payload).toEqual({
			model: 'music-01',
			prompt: 'A relaxing lo-fi beat',
			is_instrumental: true
		});
	});

	it('never includes lyrics in instrumental payload', () => {
		const input: InstrumentalGenerationInput = {
			prompt: 'A jazz instrumental',
			structureTags: ['[Intro]', '[Verse]', '[Outro]']
		};

		const payload = buildInstrumentalPayload(input);
		expect(payload.lyrics).toBeUndefined();
		expect(payload.is_instrumental).toBe(true);
	});
});

describe('buildCoverRestylePayload', () => {
	it('formats cover/re-style payload with refer_voice from R2 URL', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl: 'https://r2.example.com/owner-123/proj-456/asset-789.mp3'
		};

		const payload = buildCoverRestylePayload(input);

		expect(payload).toEqual({
			model: 'music-01',
			prompt: 'Make it jazzy',
			is_instrumental: false,
			refer_voice: 'https://r2.example.com/owner-123/proj-456/asset-789.mp3'
		});
	});

	it('includes lyrics when provided in cover mode', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl: 'https://r2.example.com/audio/source.mp3',
			lyrics: 'New lyrics for the cover'
		};

		const payload = buildCoverRestylePayload(input);
		expect(payload.lyrics).toBe('New lyrics for the cover');
	});

	it('omits lyrics when not provided in cover mode', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it rock',
			sourceAudioUrl: 'https://r2.example.com/audio/source.mp3'
		};

		const payload = buildCoverRestylePayload(input);
		expect(payload.lyrics).toBeUndefined();
	});

	it('always sets is_instrumental=false for cover mode', () => {
		const input: CoverRestyleInput = {
			prompt: 'Instrumental cover',
			sourceAudioUrl: 'https://r2.example.com/audio/source.mp3'
		};

		const payload = buildCoverRestylePayload(input);
		expect(payload.is_instrumental).toBe(false);
	});

	it('rejects provider CDN URLs as source audio', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl: 'https://cdn.minimaxi.chat/audio/task-123.mp3'
		};

		expect(() => buildCoverRestylePayload(input)).toThrow('Invalid source audio URL');
		expect(() => buildCoverRestylePayload(input)).toThrow('provider CDN');
	});

	it('rejects cdn.minimax.chat URLs as source audio', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it rock',
			sourceAudioUrl: 'https://cdn.minimax.chat/audio/output.mp3'
		};

		expect(() => buildCoverRestylePayload(input)).toThrow('provider CDN');
	});

	it('rejects fileserviceupload.minimax.chat URLs as source audio', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it rock',
			sourceAudioUrl: 'https://fileserviceupload.minimax.chat/upload/file.mp3'
		};

		expect(() => buildCoverRestylePayload(input)).toThrow('provider CDN');
	});

	it('rejects empty source audio URL', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl: ''
		};

		expect(() => buildCoverRestylePayload(input)).toThrow('Invalid source audio URL');
	});

	it('rejects invalid URL format', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl: 'not-a-url'
		};

		expect(() => buildCoverRestylePayload(input)).toThrow('Invalid source audio URL');
	});

	it('accepts R2 signed URLs with query parameters', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl:
				'https://my-bucket.r2.cloudflarestorage.com/owner/proj/asset.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600'
		};

		const payload = buildCoverRestylePayload(input);
		expect(payload.refer_voice).toBe(input.sourceAudioUrl);
	});

	it('accepts custom domain R2 URLs', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it funky',
			sourceAudioUrl: 'https://audio.grande-studio.com/owner-1/proj-1/asset-1.wav'
		};

		const payload = buildCoverRestylePayload(input);
		expect(payload.refer_voice).toBe(input.sourceAudioUrl);
	});
});

// ─── R2 Source URL Validation Tests ────────────────────────────────────────

describe('validateR2SourceUrl', () => {
	it('accepts valid R2 URLs', () => {
		expect(validateR2SourceUrl('https://r2.example.com/audio/source.mp3').valid).toBe(true);
	});

	it('accepts http URLs for local development', () => {
		expect(validateR2SourceUrl('http://localhost:8787/audio/source.mp3').valid).toBe(true);
	});

	it('rejects empty URL', () => {
		const result = validateR2SourceUrl('');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('required');
	});

	it('rejects whitespace-only URL', () => {
		const result = validateR2SourceUrl('   ');
		expect(result.valid).toBe(false);
	});

	it('rejects invalid URL format', () => {
		const result = validateR2SourceUrl('not-a-url');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('not a valid URL');
	});

	it('rejects MiniMax CDN URLs', () => {
		const result = validateR2SourceUrl('https://cdn.minimaxi.chat/audio/task-123.mp3');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('provider CDN');
	});

	it('rejects cdn.minimax.chat URLs', () => {
		const result = validateR2SourceUrl('https://cdn.minimax.chat/audio/output.mp3');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('provider CDN');
	});

	it('rejects fileserviceupload.minimax.chat URLs', () => {
		const result = validateR2SourceUrl('https://fileserviceupload.minimax.chat/upload/file.mp3');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('provider CDN');
	});

	it('rejects non-http protocols', () => {
		const result = validateR2SourceUrl('ftp://example.com/audio.mp3');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('HTTP or HTTPS');
	});
});

// ─── Adapter Integration Tests (mocked fetch) ──────────────────────────────

describe('createMiniMaxAdapter', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('throws if API key is empty', () => {
		expect(() => createMiniMaxAdapter('')).toThrow('MINIMAX_API_KEY is required');
	});

	describe('generateTextToMusic', () => {
		it('sends correct payload and returns handle', async () => {
			const mockResponse = createSuccessResponse('task-ttm-001');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateTextToMusic({
				prompt: 'A dreamy synth pop track',
				lyrics: '[Verse]\nDreaming of stars',
				instrumental: false
			});

			expect(fetchSpy).toHaveBeenCalledOnce();
			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toBe('https://api.minimaxi.chat/v1/music_generation');

			const requestInit = options as RequestInit;
			expect(requestInit.method).toBe('POST');
			expect(requestInit.headers).toEqual(
				expect.objectContaining({
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key'
				})
			);

			const body = JSON.parse(requestInit.body as string);
			expect(body.model).toBe('music-01');
			expect(body.prompt).toBe('A dreamy synth pop track');
			expect(body.lyrics).toBe('[Verse]\nDreaming of stars');
			expect(body.is_instrumental).toBe(false);

			expect(handle.providerJobId).toBe('task-ttm-001');
		});

		it('passes lyrics_optimization flag through', async () => {
			fetchSpy.mockResolvedValueOnce(createMockResponse(createSuccessResponse()));

			const adapter = createMiniMaxAdapter('test-api-key');
			await adapter.generateTextToMusic({
				prompt: 'A pop song',
				instrumental: false,
				lyricsOptimizer: true
			});

			const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
			expect(body.lyrics_optimization).toBe(true);
		});
	});

	describe('generateInstrumental', () => {
		it('sends is_instrumental=true and no lyrics', async () => {
			const mockResponse = createSuccessResponse('task-inst-001');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateInstrumental({
				prompt: 'A chill lo-fi beat'
			});

			const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
			expect(body.is_instrumental).toBe(true);
			expect(body.lyrics).toBeUndefined();
			expect(body.prompt).toBe('A chill lo-fi beat');

			expect(handle.providerJobId).toBe('task-inst-001');
		});
	});

	describe('generateCoverRestyle', () => {
		it('sends refer_voice with R2 source audio URL', async () => {
			const mockResponse = createSuccessResponse('task-cover-001');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateCoverRestyle({
				prompt: 'Make it jazzy',
				sourceAudioUrl: 'https://r2.example.com/owner-1/proj-1/asset-1.mp3'
			});

			const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
			expect(body.refer_voice).toBe('https://r2.example.com/owner-1/proj-1/asset-1.mp3');
			expect(body.prompt).toBe('Make it jazzy');
			expect(body.is_instrumental).toBe(false);
			expect(body.model).toBe('music-01');

			expect(handle.providerJobId).toBe('task-cover-001');
			expect(handle.supportsStreaming).toBe(false);
		});

		it('sends lyrics when provided in cover mode', async () => {
			const mockResponse = createSuccessResponse('task-cover-lyrics');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			await adapter.generateCoverRestyle({
				prompt: 'Jazz version with new vocals',
				sourceAudioUrl: 'https://r2.example.com/audio/source.mp3',
				lyrics: '[Verse]\nNew jazz lyrics here'
			});

			const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
			expect(body.lyrics).toBe('[Verse]\nNew jazz lyrics here');
			expect(body.refer_voice).toBe('https://r2.example.com/audio/source.mp3');
		});

		it('omits lyrics when not provided in cover mode', async () => {
			const mockResponse = createSuccessResponse('task-cover-no-lyrics');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			await adapter.generateCoverRestyle({
				prompt: 'Instrumental restyle',
				sourceAudioUrl: 'https://r2.example.com/audio/source.wav'
			});

			const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
			expect(body.lyrics).toBeUndefined();
		});

		it('rejects provider CDN URLs before making API call', async () => {
			const adapter = createMiniMaxAdapter('test-api-key');

			await expect(
				adapter.generateCoverRestyle({
					prompt: 'Make it jazzy',
					sourceAudioUrl: 'https://cdn.minimaxi.chat/audio/task-123.mp3'
				})
			).rejects.toThrow(ProviderError);

			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('returns handle with metadata from cover response', async () => {
			const mockResponse: MiniMaxMusicResponse = {
				base_resp: { status_code: 0, status_msg: 'success' },
				data: {
					task_id: 'task-cover-meta',
					audio_url: 'https://cdn.minimaxi.chat/cover-out.mp3'
				},
				extra_info: {
					audio_format: 'mp3',
					audio_sample_rate: 44100,
					duration: 25
				}
			};
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateCoverRestyle({
				prompt: 'Restyle this track',
				sourceAudioUrl: 'https://r2.example.com/audio/source.mp3'
			});

			expect(handle.providerJobId).toBe('task-cover-meta');
			expect(handle.metadata).toEqual(
				expect.objectContaining({
					audioUrl: 'https://cdn.minimaxi.chat/cover-out.mp3',
					hasHexAudio: false
				})
			);
		});

		it('handles MiniMax API errors in cover mode', async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: false,
				status: 429,
				statusText: 'Too Many Requests',
				text: () => Promise.resolve('Rate limited')
			} as Response);

			const adapter = createMiniMaxAdapter('test-api-key');
			await expect(
				adapter.generateCoverRestyle({
					prompt: 'Make it jazzy',
					sourceAudioUrl: 'https://r2.example.com/audio/source.mp3'
				})
			).rejects.toThrow(ProviderError);
		});
	});

	describe('error handling (normalized)', () => {
		it('throws ProviderError with provider_auth_error on HTTP 401', async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				text: () => Promise.resolve('Invalid API key')
			} as Response);

			const adapter = createMiniMaxAdapter('bad-key');
			try {
				await adapter.generateTextToMusic({
					prompt: 'A song',
					lyrics: 'Lyrics',
					instrumental: false
				});
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderError);
				expect((error as ProviderError).code).toBe('provider_auth_error');
				expect((error as ProviderError).providerStatusCode).toBe(401);
			}
		});

		it('throws ProviderError with provider_rate_limited on HTTP 429', async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: false,
				status: 429,
				statusText: 'Too Many Requests',
				text: () => Promise.resolve('Rate limited')
			} as Response);

			const adapter = createMiniMaxAdapter('test-api-key');
			try {
				await adapter.generateTextToMusic({
					prompt: 'A song',
					lyrics: 'Lyrics',
					instrumental: false
				});
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderError);
				expect((error as ProviderError).code).toBe('provider_rate_limited');
			}
		});

		it('throws ProviderError with provider_validation_error on non-zero status_code', async () => {
			fetchSpy.mockResolvedValueOnce(
				createMockResponse({
					base_resp: { status_code: 1001, status_msg: 'Invalid parameter' },
					data: { task_id: '' }
				})
			);

			const adapter = createMiniMaxAdapter('test-api-key');
			try {
				await adapter.generateTextToMusic({
					prompt: 'A song',
					lyrics: 'Lyrics',
					instrumental: false
				});
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderError);
				expect((error as ProviderError).code).toBe('provider_validation_error');
				expect((error as ProviderError).providerStatusCode).toBe(1001);
			}
		});

		it('throws ProviderError with provider_timeout on HTTP 504', async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: false,
				status: 504,
				statusText: 'Gateway Timeout',
				text: () => Promise.resolve('Timeout')
			} as Response);

			const adapter = createMiniMaxAdapter('test-api-key');
			try {
				await adapter.generateInstrumental({ prompt: 'A beat' });
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderError);
				expect((error as ProviderError).code).toBe('provider_timeout');
			}
		});
	});

	describe('response mapping', () => {
		it('maps audio_url to metadata', async () => {
			const mockResponse = createSuccessResponse('task-meta-001');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateTextToMusic({
				prompt: 'A song',
				lyrics: 'Lyrics',
				instrumental: false
			});

			expect(handle.metadata).toEqual(
				expect.objectContaining({
					audioUrl: 'https://cdn.minimax.chat/audio/task-123.mp3'
				})
			);
		});

		it('sets supportsStreaming based on hex audio presence', async () => {
			const responseWithHex: MiniMaxMusicResponse = {
				base_resp: { status_code: 0, status_msg: 'success' },
				data: { task_id: 'task-hex', audio: 'deadbeef' }
			};
			fetchSpy.mockResolvedValueOnce(createMockResponse(responseWithHex));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateTextToMusic({
				prompt: 'A song',
				lyrics: 'Lyrics',
				instrumental: false
			});

			expect(handle.supportsStreaming).toBe(true);
		});

		it('sets supportsStreaming=false when no hex audio', async () => {
			const responseUrlOnly: MiniMaxMusicResponse = {
				base_resp: { status_code: 0, status_msg: 'success' },
				data: { task_id: 'task-url', audio_url: 'https://cdn.example.com/audio.mp3' }
			};
			fetchSpy.mockResolvedValueOnce(createMockResponse(responseUrlOnly));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateTextToMusic({
				prompt: 'A song',
				lyrics: 'Lyrics',
				instrumental: false
			});

			expect(handle.supportsStreaming).toBe(false);
		});
	});

	// ─── Streaming Audio Tests ──────────────────────────────────────────────

	describe('streamGenerationAudio', () => {
		describe('streaming mode', () => {
			it('yields decoded hex chunks with correct sequence numbers', async () => {
				const stream = createMockStream([
					'{"audio":"48656c6c6f"}\n',
					'{"audio":"576f726c64","is_final":true}\n'
				]);

				fetchSpy.mockResolvedValueOnce({
					ok: true,
					status: 200,
					body: stream
				} as Response);

				const adapter = createMiniMaxAdapter('test-api-key');
				const handle = createStreamingHandle();
				const chunks = await collectChunks(adapter.streamGenerationAudio!(handle));

				expect(chunks).toHaveLength(2);
				expect(chunks[0].data).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
				expect(chunks[0].sequence).toBe(0);
				expect(chunks[0].isFinal).toBe(false);
				expect(chunks[1].data).toEqual(new Uint8Array([0x57, 0x6f, 0x72, 0x6c, 0x64]));
				expect(chunks[1].sequence).toBe(1);
				expect(chunks[1].isFinal).toBe(true);
			});

			it('sends correct streaming request with auth header', async () => {
				const stream = createMockStream(['{"audio":"aabb","is_final":true}\n']);
				fetchSpy.mockResolvedValueOnce({
					ok: true,
					status: 200,
					body: stream
				} as Response);

				const adapter = createMiniMaxAdapter('my-secret-key');
				const handle = createStreamingHandle('task-42');
				await collectChunks(adapter.streamGenerationAudio!(handle));

				expect(fetchSpy).toHaveBeenCalledOnce();
				const [url, options] = fetchSpy.mock.calls[0];
				expect(url).toContain('task_id=task-42');
				expect((options as RequestInit).headers).toEqual(
					expect.objectContaining({
						Authorization: 'Bearer my-secret-key'
					})
				);
			});

			it('detects stream termination via is_final flag', async () => {
				const stream = createMockStream([
					'{"audio":"aa"}\n',
					'{"audio":"bb"}\n',
					'{"audio":"cc","is_final":true}\n',
					'{"audio":"dd"}\n' // should not appear
				]);
				fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, body: stream } as Response);

				const adapter = createMiniMaxAdapter('test-api-key');
				const chunks = await collectChunks(
					adapter.streamGenerationAudio!(createStreamingHandle())
				);

				expect(chunks).toHaveLength(3);
				expect(chunks[2].isFinal).toBe(true);
			});

			it('detects stream termination via [DONE] marker', async () => {
				const stream = createMockStream([
					'data: {"audio":"aabb"}\n',
					'data: [DONE]\n',
					'data: {"audio":"ccdd"}\n' // should not appear
				]);
				fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, body: stream } as Response);

				const adapter = createMiniMaxAdapter('test-api-key');
				const chunks = await collectChunks(
					adapter.streamGenerationAudio!(createStreamingHandle())
				);

				expect(chunks).toHaveLength(1);
				expect(chunks[0].data).toEqual(new Uint8Array([0xaa, 0xbb]));
			});

			it('normalizes errors during streaming fetch', async () => {
				fetchSpy.mockResolvedValueOnce({
					ok: false,
					status: 401,
					statusText: 'Unauthorized',
					text: () => Promise.resolve('Bad auth')
				} as Response);

				const adapter = createMiniMaxAdapter('bad-key');
				try {
					await collectChunks(
						adapter.streamGenerationAudio!(createStreamingHandle())
					);
					expect.fail('Should have thrown');
				} catch (error) {
					expect(error).toBeInstanceOf(ProviderError);
					expect((error as ProviderError).code).toBe('provider_auth_error');
				}
			});

			it('throws ProviderError when response has no body', async () => {
				fetchSpy.mockResolvedValueOnce({
					ok: true,
					status: 200,
					body: null
				} as Response);

				const adapter = createMiniMaxAdapter('test-api-key');
				try {
					await collectChunks(
						adapter.streamGenerationAudio!(createStreamingHandle())
					);
					expect.fail('Should have thrown');
				} catch (error) {
					expect(error).toBeInstanceOf(ProviderError);
					expect((error as ProviderError).code).toBe('provider_validation_error');
					expect((error as ProviderError).message).toContain('no body');
				}
			});
		});

		describe('URL fallback', () => {
			it('fetches URL and yields single chunk when supportsStreaming=false', async () => {
				const audioBytes = new Uint8Array([0x49, 0x44, 0x33]); // ID3 header
				fetchSpy.mockResolvedValueOnce({
					ok: true,
					status: 200,
					arrayBuffer: () => Promise.resolve(audioBytes.buffer)
				} as Response);

				const adapter = createMiniMaxAdapter('test-api-key');
				const handle = createUrlHandle('task-url', 'https://cdn.example.com/audio.mp3');
				const chunks = await collectChunks(adapter.streamGenerationAudio!(handle));

				expect(chunks).toHaveLength(1);
				expect(chunks[0].data).toEqual(audioBytes);
				expect(chunks[0].sequence).toBe(0);
				expect(chunks[0].isFinal).toBe(true);

				// Verify the fetch was made to the audio URL
				expect(fetchSpy).toHaveBeenCalledWith('https://cdn.example.com/audio.mp3');
			});

			it('throws ProviderError when no URL available and supportsStreaming=false', async () => {
				const adapter = createMiniMaxAdapter('test-api-key');
				const handle: ProviderGenerationHandle = {
					providerJobId: 'task-no-url',
					supportsStreaming: false,
					metadata: { hasHexAudio: false }
				};

				try {
					await collectChunks(adapter.streamGenerationAudio!(handle));
					expect.fail('Should have thrown');
				} catch (error) {
					expect(error).toBeInstanceOf(ProviderError);
					expect((error as ProviderError).code).toBe('provider_validation_error');
					expect((error as ProviderError).message).toContain(
						'No streaming audio or download URL'
					);
				}
			});

			it('normalizes fetch errors in URL fallback', async () => {
				fetchSpy.mockResolvedValueOnce({
					ok: false,
					status: 503,
					statusText: 'Service Unavailable',
					text: () => Promise.resolve('Server error')
				} as Response);

				const adapter = createMiniMaxAdapter('test-api-key');
				const handle = createUrlHandle(
					'task-url-err',
					'https://cdn.example.com/audio.mp3'
				);

				try {
					await collectChunks(adapter.streamGenerationAudio!(handle));
					expect.fail('Should have thrown');
				} catch (error) {
					expect(error).toBeInstanceOf(ProviderError);
					expect((error as ProviderError).code).toBe('provider_timeout');
				}
			});
		});
	});
});
