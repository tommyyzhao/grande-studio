import type { TextToMusicInput, CoverRestyleInput } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────

/** Maximum lyrics length allowed by MiniMax API */
export const MINIMAX_MAX_LYRICS_LENGTH = 2000;

/** Structure tags supported by MiniMax Music 2.6 */
export const SUPPORTED_STRUCTURE_TAGS = [
	'[Intro]',
	'[Verse]',
	'[Verse 1]',
	'[Verse 2]',
	'[Pre-Chorus]',
	'[Chorus]',
	'[Hook]',
	'[Bridge]',
	'[Breakdown]',
	'[Solo]',
	'[Outro]'
] as const;

// ─── Validation Result Types ──────────────────────────────────────────────

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationWarning {
	field: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
}

// ─── Request Types ────────────────────────────────────────────────────────

export type MusicRequestMode = 'text_to_music' | 'instrumental' | 'cover_restyle';

export interface MusicRequestInput {
	mode: MusicRequestMode;
	prompt: string;
	lyrics?: string;
	instrumental?: boolean;
	lyricsOptimizer?: boolean;
	structureTags?: string[];
	sourceAssetId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function extractBracketedTags(lyrics: string): string[] {
	const matches = lyrics.match(/\[[^\]]+\]/g);
	return matches ?? [];
}

// ─── Validator ────────────────────────────────────────────────────────────

export function validateMusicRequest(input: MusicRequestInput): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// Prompt must be non-empty
	if (!input.prompt || input.prompt.trim().length === 0) {
		errors.push({ field: 'prompt', message: 'Prompt is required and cannot be empty' });
	}

	// Instrumental + lyrics = invalid (explicit error, not silent ignore)
	if (input.instrumental && input.lyrics && input.lyrics.trim().length > 0) {
		errors.push({
			field: 'lyrics',
			message: 'Lyrics cannot be provided when instrumental mode is enabled'
		});
	}

	// Non-instrumental + no lyrics + no optimizer = invalid
	if (
		!input.instrumental &&
		input.mode !== 'cover_restyle' &&
		(!input.lyrics || input.lyrics.trim().length === 0) &&
		!input.lyricsOptimizer
	) {
		errors.push({
			field: 'lyrics',
			message:
				'Lyrics are required when not in instrumental mode, or enable the lyrics optimizer to auto-generate them'
		});
	}

	// Lyrics length within MiniMax limits
	if (input.lyrics && input.lyrics.length > MINIMAX_MAX_LYRICS_LENGTH) {
		errors.push({
			field: 'lyrics',
			message: `Lyrics exceed maximum length of ${MINIMAX_MAX_LYRICS_LENGTH} characters (current: ${input.lyrics.length})`
		});
	}

	// Cover/re-style requires source asset
	if (input.mode === 'cover_restyle') {
		if (!input.sourceAssetId || input.sourceAssetId.trim().length === 0) {
			errors.push({
				field: 'sourceAssetId',
				message: 'Source asset is required for cover/re-style mode'
			});
		}
	}

	// Unsupported structure tags produce warnings
	if (input.structureTags && input.structureTags.length > 0) {
		for (const tag of input.structureTags) {
			if (!SUPPORTED_STRUCTURE_TAGS.includes(tag as (typeof SUPPORTED_STRUCTURE_TAGS)[number])) {
				warnings.push({
					field: 'structureTags',
					message: `Unsupported structure tag: ${tag}`
				});
			}
		}
	}

	// Also check for bracketed tags embedded in lyrics text
	if (input.lyrics) {
		const embeddedTags = extractBracketedTags(input.lyrics);
		for (const tag of embeddedTags) {
			if (!SUPPORTED_STRUCTURE_TAGS.includes(tag as (typeof SUPPORTED_STRUCTURE_TAGS)[number])) {
				warnings.push({
					field: 'lyrics',
					message: `Unsupported structure tag in lyrics: ${tag}`
				});
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings
	};
}
