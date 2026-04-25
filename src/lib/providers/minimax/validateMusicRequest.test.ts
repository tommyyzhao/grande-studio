import { describe, it, expect } from 'vitest';
import {
	validateMusicRequest,
	MINIMAX_MAX_LYRICS_LENGTH,
	SUPPORTED_STRUCTURE_TAGS,
	type MusicRequestInput
} from './validateMusicRequest';

describe('validateMusicRequest', () => {
	// ─── Prompt validation ──────────────────────────────────────────────

	it('rejects empty prompt', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: '',
			lyrics: 'Some lyrics',
			instrumental: false
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({ field: 'prompt', message: expect.stringContaining('required') })
		);
	});

	it('rejects whitespace-only prompt', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: '   ',
			lyrics: 'Some lyrics',
			instrumental: false
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({ field: 'prompt' })
		);
	});

	// ─── Instrumental + lyrics = invalid ────────────────────────────────

	it('rejects instrumental=true with lyrics (clear error, not silent ignore)', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A chill beat',
			lyrics: 'La la la',
			instrumental: true
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				field: 'lyrics',
				message: expect.stringContaining('instrumental')
			})
		);
	});

	it('allows instrumental=true without lyrics', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A chill beat',
			instrumental: true
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('allows instrumental=true with empty string lyrics', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A chill beat',
			lyrics: '',
			instrumental: true
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	// ─── Non-instrumental + no lyrics + no optimizer = invalid ───────────

	it('rejects non-instrumental without lyrics and without optimizer', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A pop song',
			instrumental: false
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				field: 'lyrics',
				message: expect.stringContaining('Lyrics are required')
			})
		);
	});

	it('rejects non-instrumental with empty lyrics and without optimizer', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A pop song',
			lyrics: '  ',
			instrumental: false,
			lyricsOptimizer: false
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({ field: 'lyrics' })
		);
	});

	// ─── Non-instrumental + lyrics = valid ──────────────────────────────

	it('allows non-instrumental with lyrics', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A pop song',
			lyrics: '[Verse]\nLa la la',
			instrumental: false
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	// ─── Non-instrumental + no lyrics + optimizer on = valid ─────────────

	it('allows non-instrumental without lyrics when optimizer is on', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A pop song',
			instrumental: false,
			lyricsOptimizer: true
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	// ─── Unsupported structure tags produce warning ──────────────────────

	it('produces warning for unsupported structure tags', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A rock anthem',
			lyrics: 'Yeah yeah yeah',
			instrumental: false,
			structureTags: ['[Intro]', '[Dubstep Drop]', '[Chorus]']
		});
		expect(result.valid).toBe(true);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				field: 'structureTags',
				message: expect.stringContaining('[Dubstep Drop]')
			})
		);
	});

	it('produces no warnings for all supported tags', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A rock anthem',
			lyrics: 'Yeah yeah yeah',
			instrumental: false,
			structureTags: [...SUPPORTED_STRUCTURE_TAGS]
		});
		expect(result.valid).toBe(true);
		expect(result.warnings).toHaveLength(0);
	});

	it('detects unsupported tags embedded in lyrics', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A rock anthem',
			lyrics: '[Verse]\nSome words\n[Epic Buildup]\nMore words',
			instrumental: false
		});
		expect(result.valid).toBe(true);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				field: 'lyrics',
				message: expect.stringContaining('[Epic Buildup]')
			})
		);
	});

	it('does not warn for supported tags embedded in lyrics', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A rock anthem',
			lyrics: '[Verse]\nSome words\n[Chorus]\nMore words',
			instrumental: false
		});
		expect(result.valid).toBe(true);
		expect(result.warnings).toHaveLength(0);
	});

	// ─── Cover/re-style requires source asset ───────────────────────────

	it('rejects cover/re-style without source asset', () => {
		const result = validateMusicRequest({
			mode: 'cover_restyle',
			prompt: 'Make it jazzy'
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				field: 'sourceAssetId',
				message: expect.stringContaining('Source asset is required')
			})
		);
	});

	it('rejects cover/re-style with empty source asset', () => {
		const result = validateMusicRequest({
			mode: 'cover_restyle',
			prompt: 'Make it jazzy',
			sourceAssetId: '  '
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({ field: 'sourceAssetId' })
		);
	});

	it('allows cover/re-style with source asset and no lyrics', () => {
		const result = validateMusicRequest({
			mode: 'cover_restyle',
			prompt: 'Make it jazzy',
			sourceAssetId: '550e8400-e29b-41d4-a716-446655440000'
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('allows cover/re-style with source asset and optional lyrics', () => {
		const result = validateMusicRequest({
			mode: 'cover_restyle',
			prompt: 'Make it jazzy',
			sourceAssetId: '550e8400-e29b-41d4-a716-446655440000',
			lyrics: 'New lyrics for the cover'
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	// ─── Lyrics length within MiniMax limits ────────────────────────────

	it('rejects lyrics exceeding maximum length', () => {
		const longLyrics = 'a'.repeat(MINIMAX_MAX_LYRICS_LENGTH + 1);
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A song',
			lyrics: longLyrics,
			instrumental: false
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				field: 'lyrics',
				message: expect.stringContaining('maximum length')
			})
		);
	});

	it('allows lyrics at exactly maximum length', () => {
		const maxLyrics = 'a'.repeat(MINIMAX_MAX_LYRICS_LENGTH);
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'A song',
			lyrics: maxLyrics,
			instrumental: false
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	// ─── Multiple errors accumulate ─────────────────────────────────────

	it('collects multiple errors at once', () => {
		const result = validateMusicRequest({
			mode: 'cover_restyle',
			prompt: '',
			instrumental: true,
			lyrics: 'Should not be here'
		});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThanOrEqual(2);
		expect(result.errors.map((e) => e.field)).toContain('prompt');
		expect(result.errors.map((e) => e.field)).toContain('lyrics');
	});

	// ─── Valid complete request ──────────────────────────────────────────

	it('validates a complete text-to-music request', () => {
		const result = validateMusicRequest({
			mode: 'text_to_music',
			prompt: 'An upbeat pop song about summer',
			lyrics: '[Verse 1]\nSunshine on the beach\n[Chorus]\nSummer vibes',
			instrumental: false,
			structureTags: ['[Verse 1]', '[Chorus]']
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it('validates a complete instrumental request', () => {
		const result = validateMusicRequest({
			mode: 'instrumental',
			prompt: 'A relaxing lo-fi beat',
			instrumental: true,
			structureTags: ['[Intro]', '[Verse]', '[Outro]']
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});
});
