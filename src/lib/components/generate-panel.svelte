<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { MINIMAX_MAX_LYRICS_LENGTH } from '$lib/providers/minimax/validateMusicRequest';

	interface Props {
		projectId: string | null;
	}

	let { projectId }: Props = $props();

	// ─── Form state ──────────────────────────────────────────────────────
	let prompt = $state('');
	let instrumental = $state(false);
	let lyrics = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');
	let lastResult: { jobId: string; assetId: string } | null = $state(null);

	let promptEmpty = $derived(!prompt.trim());
	let lyricsLength = $derived(lyrics.length);
	let lyricsOverLimit = $derived(lyricsLength > MINIMAX_MAX_LYRICS_LENGTH);

	// ─── Client-side validation ──────────────────────────────────────────
	let validationError = $derived.by(() => {
		if (instrumental && lyrics.trim().length > 0) {
			return 'Lyrics cannot be provided when instrumental mode is enabled. Clear the lyrics or disable instrumental mode.';
		}
		if (lyricsOverLimit) {
			return `Lyrics exceed maximum length of ${MINIMAX_MAX_LYRICS_LENGTH} characters (current: ${lyricsLength})`;
		}
		return '';
	});

	let canSubmit = $derived(
		!promptEmpty && !submitting && !!projectId && !validationError
	);

	// ─── Submit handler ──────────────────────────────────────────────────
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;

		submitting = true;
		errorMessage = '';
		lastResult = null;

		try {
			const idempotencyKey = crypto.randomUUID();
			const trimmedLyrics = lyrics.trim();

			const res = await fetch('/api/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId,
					prompt: prompt.trim(),
					mode: instrumental ? ('instrumental' as const) : ('text_to_music' as const),
					instrumental,
					lyrics: trimmedLyrics || undefined,
					lyricsOptimizer: !instrumental && !trimmedLyrics,
					idempotencyKey
				})
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				const msg =
					data?.message ?? `Generation failed (${res.status})`;
				errorMessage = msg;
				return;
			}

			const data = await res.json();
			lastResult = { jobId: data.jobId, assetId: data.assetId };
			prompt = '';
			lyrics = '';
			instrumental = false;
		} catch (err) {
			errorMessage = 'Network error. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-3">
	<div class="flex flex-col gap-1.5">
		<Label for="prompt-input">Describe the music you want to create</Label>
		<Textarea
			id="prompt-input"
			placeholder="e.g. A dreamy lo-fi hip hop beat with soft piano and vinyl crackle..."
			bind:value={prompt}
			disabled={submitting}
			class="min-h-20 resize-none"
			rows={3}
		/>
	</div>

	<!-- Instrumental toggle -->
	<div class="flex items-center gap-2">
		<Switch
			id="instrumental-toggle"
			bind:checked={instrumental}
			disabled={submitting}
			size="sm"
		/>
		<Label for="instrumental-toggle" class="cursor-pointer text-sm font-medium">
			Instrumental only
		</Label>
	</div>

	<!-- Lyrics textarea -->
	<div class="flex flex-col gap-1.5">
		<Label for="lyrics-input" class={instrumental ? 'text-muted-foreground' : ''}>
			Lyrics
		</Label>
		{#if instrumental}
			<p class="text-muted-foreground text-sm italic">
				Lyrics are not used in instrumental mode
			</p>
		{:else}
			<Textarea
				id="lyrics-input"
				placeholder="Enter lyrics (optional — leave empty to auto-generate)"
				bind:value={lyrics}
				disabled={submitting}
				class="min-h-24 resize-y font-mono text-sm"
				rows={4}
			/>
			<div class="flex items-center justify-end gap-1">
				<span
					class="text-xs {lyricsOverLimit
						? 'text-destructive font-medium'
						: 'text-muted-foreground'}"
				>
					{lyricsLength} / {MINIMAX_MAX_LYRICS_LENGTH}
				</span>
			</div>
		{/if}
	</div>

	{#if validationError}
		<p class="text-destructive text-sm">{validationError}</p>
	{/if}

	{#if errorMessage}
		<p class="text-destructive text-sm">{errorMessage}</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button type="submit" disabled={!canSubmit} size="sm">
			{#if submitting}
				Generating...
			{:else}
				Generate
			{/if}
		</Button>
	</div>
</form>
