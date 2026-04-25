import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createMiniMaxAdapter,
	buildTextToMusicPayload,
	buildInstrumentalPayload,
	buildCoverRestylePayload,
	validateR2SourceUrl,
	MiniMaxApiError,
	type MiniMaxMusicResponse
} from './adapter';
import type { TextToMusicInput, InstrumentalGenerationInput, CoverRestyleInput } from '../types';

// ─── Mock fetch ─────────────────────────────────────────────────────────────

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
			).rejects.toThrow('Invalid source audio URL');

			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('returns handle with metadata from cover response', async () => {
			const mockResponse: MiniMaxMusicResponse = {
				base_resp: { status_code: 0, status_msg: 'success' },
				data: { task_id: 'task-cover-meta', audio_url: 'https://cdn.minimaxi.chat/cover-out.mp3' },
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
			).rejects.toThrow(MiniMaxApiError);
		});
	});

	describe('error handling', () => {
		it('throws MiniMaxApiError on HTTP error', async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				text: () => Promise.resolve('Invalid API key')
			} as Response);

			const adapter = createMiniMaxAdapter('bad-key');
			await expect(
				adapter.generateTextToMusic({
					prompt: 'A song',
					lyrics: 'Lyrics',
					instrumental: false
				})
			).rejects.toThrow(MiniMaxApiError);
		});

		it('throws MiniMaxApiError on non-zero status_code in response', async () => {
			fetchSpy.mockResolvedValueOnce(
				createMockResponse({
					base_resp: { status_code: 1001, status_msg: 'Invalid parameter' },
					data: { task_id: '' }
				})
			);

			const adapter = createMiniMaxAdapter('test-api-key');
			await expect(
				adapter.generateTextToMusic({
					prompt: 'A song',
					lyrics: 'Lyrics',
					instrumental: false
				})
			).rejects.toThrow(MiniMaxApiError);
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
});
