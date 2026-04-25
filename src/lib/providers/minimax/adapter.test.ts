import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createMiniMaxAdapter,
	buildTextToMusicPayload,
	buildInstrumentalPayload,
	buildCoverRestylePayload,
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
	it('formats cover/re-style payload with refer_voice', () => {
		const input: CoverRestyleInput = {
			prompt: 'Make it jazzy',
			sourceAudioUrl: 'https://r2.example.com/audio/source.mp3'
		};

		const payload = buildCoverRestylePayload(input);

		expect(payload).toEqual({
			model: 'music-01',
			prompt: 'Make it jazzy',
			is_instrumental: false,
			refer_voice: 'https://r2.example.com/audio/source.mp3'
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
		it('sends refer_voice with source audio URL', async () => {
			const mockResponse = createSuccessResponse('task-cover-001');
			fetchSpy.mockResolvedValueOnce(createMockResponse(mockResponse));

			const adapter = createMiniMaxAdapter('test-api-key');
			const handle = await adapter.generateCoverRestyle({
				prompt: 'Make it jazzy',
				sourceAudioUrl: 'https://r2.example.com/audio/source.mp3'
			});

			const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
			expect(body.refer_voice).toBe('https://r2.example.com/audio/source.mp3');
			expect(body.prompt).toBe('Make it jazzy');

			expect(handle.providerJobId).toBe('task-cover-001');
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
