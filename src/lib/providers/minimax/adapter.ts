import {
	ProviderError,
	type MusicProvider,
	type TextToMusicInput,
	type InstrumentalGenerationInput,
	type CoverRestyleInput,
	type ProviderGenerationHandle,
	type ProviderAudioChunk
} from '../types';

// ─── MiniMax API Constants ──────────────────────────────────────────────────

const MINIMAX_API_BASE = 'https://api.minimaxi.chat/v1';
const MINIMAX_MUSIC_ENDPOINT = `${MINIMAX_API_BASE}/music_generation`;
const MINIMAX_MODEL = 'music-01';

// Known provider CDN domains — source audio must come from R2, not these
const PROVIDER_CDN_DOMAINS = [
	'cdn.minimax.chat',
	'cdn.minimaxi.chat',
	'fileserviceupload.minimax.chat'
] as const;

// ─── MiniMax API Request/Response Types ─────────────────────────────────────

export interface MiniMaxMusicRequest {
	model: string;
	prompt: string;
	lyrics?: string;
	is_instrumental: boolean;
	refer_voice?: string;
	/** When true, MiniMax auto-generates/optimizes lyrics from the prompt */
	lyrics_optimization?: boolean;
}

export interface MiniMaxMusicResponse {
	base_resp: {
		status_code: number;
		status_msg: string;
	};
	data: {
		audio?: string;
		audio_url?: string;
		task_id: string;
	};
	extra_info?: {
		audio_format?: string;
		audio_sample_rate?: number;
		audio_size?: number;
		bitrate?: number;
		duration?: number;
	};
}

// ─── Source URL Validation ──────────────────────────────────────────────────

/**
 * Validates that a source audio URL is from R2 storage, not a provider CDN.
 * Provider URLs are temporary and must never be stored as the canonical audio source.
 */
export function validateR2SourceUrl(url: string): { valid: boolean; error?: string } {
	if (!url || url.trim().length === 0) {
		return { valid: false, error: 'Source audio URL is required' };
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { valid: false, error: 'Source audio URL is not a valid URL' };
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return { valid: false, error: 'Source audio URL must use HTTP or HTTPS' };
	}

	for (const domain of PROVIDER_CDN_DOMAINS) {
		if (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)) {
			return {
				valid: false,
				error: `Source audio must be from R2 storage, not provider CDN (${parsed.hostname})`
			};
		}
	}

	return { valid: true };
}

// ─── Payload Builders ───────────────────────────────────────────────────────

export function buildTextToMusicPayload(input: TextToMusicInput): MiniMaxMusicRequest {
	const payload: MiniMaxMusicRequest = {
		model: MINIMAX_MODEL,
		prompt: input.prompt,
		is_instrumental: false
	};

	if (input.lyrics) {
		payload.lyrics = input.lyrics;
	}

	if (input.lyricsOptimizer) {
		payload.lyrics_optimization = true;
	}

	return payload;
}

export function buildInstrumentalPayload(input: InstrumentalGenerationInput): MiniMaxMusicRequest {
	return {
		model: MINIMAX_MODEL,
		prompt: input.prompt,
		is_instrumental: true
	};
}

export function buildCoverRestylePayload(input: CoverRestyleInput): MiniMaxMusicRequest {
	// Validate source URL is from R2, not a provider CDN
	const urlValidation = validateR2SourceUrl(input.sourceAudioUrl);
	if (!urlValidation.valid) {
		throw new Error(`Invalid source audio URL: ${urlValidation.error}`);
	}

	const payload: MiniMaxMusicRequest = {
		model: MINIMAX_MODEL,
		prompt: input.prompt,
		is_instrumental: false,
		refer_voice: input.sourceAudioUrl
	};

	if (input.lyrics) {
		payload.lyrics = input.lyrics;
	}

	return payload;
}

// ─── API Caller ─────────────────────────────────────────────────────────────

async function callMiniMaxAPI(
	payload: MiniMaxMusicRequest,
	apiKey: string
): Promise<MiniMaxMusicResponse> {
	const response = await fetch(MINIMAX_MUSIC_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify(payload)
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => 'Unknown error');
		throw new MiniMaxApiError(
			`MiniMax API error: ${response.status} ${response.statusText}`,
			response.status,
			errorBody
		);
	}

	const result: MiniMaxMusicResponse = await response.json();

	if (result.base_resp.status_code !== 0) {
		throw new MiniMaxApiError(
			`MiniMax API returned error: ${result.base_resp.status_msg}`,
			result.base_resp.status_code,
			JSON.stringify(result.base_resp)
		);
	}

	return result;
}

// ─── Error Types ────────────────────────────────────────────────────────────

export class MiniMaxApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number,
		public readonly responseBody: string
	) {
		super(message);
		this.name = 'MiniMaxApiError';
	}
}

// ─── Hex Decoding ──────────────────────────────────────────────────────────

/**
 * Decodes a hex-encoded string into a Uint8Array of audio bytes.
 */
export function decodeHexToBytes(hex: string): Uint8Array {
	const clean = hex.replace(/\s/g, '');
	if (clean.length === 0) {
		return new Uint8Array(0);
	}
	if (clean.length % 2 !== 0) {
		throw new Error('Invalid hex string: odd number of characters');
	}
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < clean.length; i += 2) {
		const byte = parseInt(clean.substring(i, i + 2), 16);
		if (isNaN(byte)) {
			throw new Error(`Invalid hex character at position ${i}`);
		}
		bytes[i / 2] = byte;
	}
	return bytes;
}

// ─── Error Normalization ───────────────────────────────────────────────────

/**
 * Normalizes MiniMax-specific errors into typed ProviderError objects.
 * Maps HTTP status codes and MiniMax application error codes to provider error codes.
 */
export function normalizeMiniMaxError(error: unknown): ProviderError {
	if (error instanceof ProviderError) {
		return error;
	}

	if (error instanceof MiniMaxApiError) {
		// HTTP 401/403 → auth error
		if (error.statusCode === 401 || error.statusCode === 403) {
			return new ProviderError(
				'MiniMax authentication failed',
				'provider_auth_error',
				error.statusCode,
				error.responseBody
			);
		}
		// HTTP 429 → rate limited
		if (error.statusCode === 429) {
			return new ProviderError(
				'MiniMax rate limit exceeded',
				'provider_rate_limited',
				error.statusCode,
				error.responseBody
			);
		}
		// HTTP 408/502/503/504 → timeout / server unavailable
		if ([408, 502, 503, 504].includes(error.statusCode)) {
			return new ProviderError(
				'MiniMax request timed out or server unavailable',
				'provider_timeout',
				error.statusCode,
				error.responseBody
			);
		}
		// HTTP 400 or MiniMax application error codes (1000+) → validation error
		if (error.statusCode === 400 || error.statusCode >= 1000) {
			return new ProviderError(
				`MiniMax validation error: ${error.message}`,
				'provider_validation_error',
				error.statusCode,
				error.responseBody
			);
		}
		// All other HTTP errors → validation as catch-all
		return new ProviderError(
			`MiniMax error: ${error.message}`,
			'provider_validation_error',
			error.statusCode,
			error.responseBody
		);
	}

	// Network errors (fetch failed) → timeout
	if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
		return new ProviderError('MiniMax request failed: network error', 'provider_timeout');
	}

	// Abort errors → timeout
	if (error instanceof DOMException && error.name === 'AbortError') {
		return new ProviderError('MiniMax request timed out', 'provider_timeout');
	}

	// Unknown errors → validation as catch-all
	const message = error instanceof Error ? error.message : String(error);
	return new ProviderError(`MiniMax error: ${message}`, 'provider_validation_error');
}

// ─── Stream Chunk Parsing ──────────────────────────────────────────────────

/**
 * Parses a MiniMax streaming response body into hex audio chunks.
 * Handles both SSE-prefixed ("data: {...}") and plain JSON line formats.
 */
export async function* parseStreamLines(
	body: ReadableStream<Uint8Array>
): AsyncGenerator<{ hex: string; isFinal: boolean }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
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
				if (data === '[DONE]') return;

				try {
					const parsed = JSON.parse(data) as {
						data?: { audio?: string; status?: number };
						audio?: string;
						is_final?: boolean;
					};
					const audio = parsed.data?.audio ?? parsed.audio;
					if (audio) {
						const isFinal = parsed.is_final === true || parsed.data?.status === 2;
						yield { hex: audio, isFinal };
						if (isFinal) return;
					}
				} catch {
					// Not JSON — skip
				}
			}
		}

		// Flush remaining buffer
		const remaining = buffer.trim();
		if (remaining && remaining !== '[DONE]') {
			const data = remaining.startsWith('data: ') ? remaining.slice(6) : remaining;
			if (data !== '[DONE]') {
				try {
					const parsed = JSON.parse(data) as {
						data?: { audio?: string };
						audio?: string;
					};
					const audio = parsed.data?.audio ?? parsed.audio;
					if (audio) {
						yield { hex: audio, isFinal: true };
					}
				} catch {
					// ignore
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

// ─── Response → Handle Converter ────────────────────────────────────────────

function toProviderHandle(response: MiniMaxMusicResponse): ProviderGenerationHandle {
	return {
		providerJobId: response.data.task_id,
		supportsStreaming: !!response.data.audio,
		metadata: {
			audioUrl: response.data.audio_url,
			hasHexAudio: !!response.data.audio,
			extraInfo: response.extra_info
		}
	};
}

// ─── MiniMax Adapter ────────────────────────────────────────────────────────

export function createMiniMaxAdapter(apiKey: string): MusicProvider {
	if (!apiKey) {
		throw new Error('MINIMAX_API_KEY is required to create MiniMax adapter');
	}

	return {
		async generateTextToMusic(input: TextToMusicInput): Promise<ProviderGenerationHandle> {
			try {
				const payload = buildTextToMusicPayload(input);
				const response = await callMiniMaxAPI(payload, apiKey);
				return toProviderHandle(response);
			} catch (error) {
				throw normalizeMiniMaxError(error);
			}
		},

		async generateInstrumental(
			input: InstrumentalGenerationInput
		): Promise<ProviderGenerationHandle> {
			try {
				const payload = buildInstrumentalPayload(input);
				const response = await callMiniMaxAPI(payload, apiKey);
				return toProviderHandle(response);
			} catch (error) {
				throw normalizeMiniMaxError(error);
			}
		},

		async generateCoverRestyle(input: CoverRestyleInput): Promise<ProviderGenerationHandle> {
			try {
				const payload = buildCoverRestylePayload(input);
				const response = await callMiniMaxAPI(payload, apiKey);
				return toProviderHandle(response);
			} catch (error) {
				throw normalizeMiniMaxError(error);
			}
		},

		async *streamGenerationAudio(
			handle: ProviderGenerationHandle
		): AsyncGenerator<ProviderAudioChunk, void, undefined> {
			const metadata = handle.metadata as
				| { audioUrl?: string; hasHexAudio?: boolean }
				| undefined;

			// Non-streaming URL fallback: fetch the URL and yield as a single chunk
			if (!handle.supportsStreaming) {
				const audioUrl = metadata?.audioUrl;
				if (!audioUrl) {
					throw new ProviderError(
						'No streaming audio or download URL available',
						'provider_validation_error'
					);
				}
				try {
					const response = await fetch(audioUrl);
					if (!response.ok) {
						throw new MiniMaxApiError(
							`Failed to fetch audio: ${response.status} ${response.statusText}`,
							response.status,
							await response.text().catch(() => '')
						);
					}
					const buffer = await response.arrayBuffer();
					yield {
						data: new Uint8Array(buffer),
						sequence: 0,
						isFinal: true
					};
					return;
				} catch (error) {
					throw normalizeMiniMaxError(error);
				}
			}

			// Streaming mode: fetch streaming hex chunks from MiniMax
			let response: Response;
			try {
				response = await fetch(
					`${MINIMAX_MUSIC_ENDPOINT}?task_id=${encodeURIComponent(handle.providerJobId)}`,
					{
						method: 'GET',
						headers: {
							Authorization: `Bearer ${apiKey}`,
							Accept: 'text/event-stream'
						}
					}
				);

				if (!response.ok) {
					const errorBody = await response.text().catch(() => '');
					throw new MiniMaxApiError(
						`MiniMax streaming error: ${response.status} ${response.statusText}`,
						response.status,
						errorBody
					);
				}
			} catch (error) {
				throw normalizeMiniMaxError(error);
			}

			if (!response.body) {
				throw new ProviderError(
					'MiniMax streaming response has no body',
					'provider_validation_error'
				);
			}

			let sequence = 0;
			try {
				for await (const { hex, isFinal } of parseStreamLines(response.body)) {
					yield {
						data: decodeHexToBytes(hex),
						sequence: sequence++,
						isFinal
					};
				}
			} catch (error) {
				if (error instanceof ProviderError) throw error;
				throw normalizeMiniMaxError(error);
			}
		}
	};
}
