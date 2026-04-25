<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';

	interface Props {
		projectId: string | null;
	}

	let { projectId }: Props = $props();

	// ─── Form state ──────────────────────────────────────────────────────
	let prompt = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');
	let lastResult: { jobId: string; assetId: string } | null = $state(null);

	let promptEmpty = $derived(!prompt.trim());

	// ─── Submit handler ──────────────────────────────────────────────────
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (promptEmpty || submitting || !projectId) return;

		submitting = true;
		errorMessage = '';
		lastResult = null;

		try {
			const idempotencyKey = crypto.randomUUID();

			const res = await fetch('/api/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId,
					prompt: prompt.trim(),
					mode: 'text_to_music' as const,
					instrumental: false,
					lyricsOptimizer: true,
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

	{#if errorMessage}
		<p class="text-destructive text-sm">{errorMessage}</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button type="submit" disabled={promptEmpty || submitting || !projectId} size="sm">
			{#if submitting}
				Generating...
			{:else}
				Generate
			{/if}
		</Button>
	</div>
</form>
