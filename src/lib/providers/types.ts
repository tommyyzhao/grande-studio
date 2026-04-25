// ─── Provider Identifiers ──────────────────────────────────────────────────

export const providerIds = ['minimax', 'elevenlabs', 'stability'] as const;
export type ProviderId = (typeof providerIds)[number];

// ─── Provider Registry ─────────────────────────────────────────────────────

export interface ProviderRegistryEntry {
	id: ProviderId;
	enabled: boolean;
	stub: boolean;
	displayName: string;
}

// ─── Generation Input Types ────────────────────────────────────────────────

export interface TextToMusicInput {
	prompt: string;
	lyrics?: string;
	instrumental: boolean;
	lyricsOptimizer?: boolean;
	structureTags?: string[];
	/** Duration hint in seconds, if provider supports it */
	durationSec?: number;
}

export interface InstrumentalGenerationInput {
	prompt: string;
	structureTags?: string[];
	durationSec?: number;
}

export interface CoverRestyleInput {
	prompt: string;
	/** R2 object key or signed URL of the source audio */
	sourceAudioUrl: string;
	lyrics?: string;
	durationSec?: number;
}

// ─── Generation Output Types ───────────────────────────────────────────────

export interface ProviderGenerationHandle {
	/** Provider-specific job/task ID */
	providerJobId: string;
	/** Whether the provider supports streaming audio chunks */
	supportsStreaming: boolean;
	/** Provider-specific metadata */
	metadata?: Record<string, unknown>;
}

export interface ProviderAudioChunk {
	/** Decoded audio bytes for this chunk */
	data: Uint8Array;
	/** Sequence number of this chunk (0-based) */
	sequence: number;
	/** Whether this is the final chunk */
	isFinal: boolean;
}

// ─── Provider Error Types ──────────────────────────────────────────────────

export type ProviderErrorCode =
	| 'provider_timeout'
	| 'provider_validation_error'
	| 'provider_auth_error'
	| 'provider_rate_limited';

export class ProviderError extends Error {
	constructor(
		message: string,
		public readonly code: ProviderErrorCode,
		public readonly providerStatusCode?: number,
		public readonly providerResponse?: string
	) {
		super(message);
		this.name = 'ProviderError';
	}
}

// ─── Music Provider Interface ──────────────────────────────────────────────

export interface MusicProvider {
	/** Submit a text-to-music generation request */
	generateTextToMusic(input: TextToMusicInput): Promise<ProviderGenerationHandle>;

	/** Submit an instrumental-only generation request */
	generateInstrumental(input: InstrumentalGenerationInput): Promise<ProviderGenerationHandle>;

	/** Submit a cover/re-style generation request */
	generateCoverRestyle(input: CoverRestyleInput): Promise<ProviderGenerationHandle>;

	/** Stream audio chunks from an in-progress generation (optional) */
	streamGenerationAudio?(
		handle: ProviderGenerationHandle
	): AsyncGenerator<ProviderAudioChunk, void, undefined>;

	/** Pre-process cover source audio before submission (optional) */
	preprocessCoverSource?(sourceAudioUrl: string): Promise<string>;
}
