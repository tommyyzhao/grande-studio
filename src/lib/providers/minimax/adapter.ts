import type {
	MusicProvider,
	TextToMusicInput,
	InstrumentalGenerationInput,
	CoverRestyleInput,
	ProviderGenerationHandle,
	ProviderAudioChunk
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
			const payload = buildTextToMusicPayload(input);
			const response = await callMiniMaxAPI(payload, apiKey);
			return toProviderHandle(response);
		},

		async generateInstrumental(input: InstrumentalGenerationInput): Promise<ProviderGenerationHandle> {
			const payload = buildInstrumentalPayload(input);
			const response = await callMiniMaxAPI(payload, apiKey);
			return toProviderHandle(response);
		},

		async generateCoverRestyle(input: CoverRestyleInput): Promise<ProviderGenerationHandle> {
			const payload = buildCoverRestylePayload(input);
			const response = await callMiniMaxAPI(payload, apiKey);
			return toProviderHandle(response);
		}
	};
}
