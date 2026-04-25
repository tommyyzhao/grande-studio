<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import type { BlockAsset } from '$lib/types';

	interface Props {
		asset: BlockAsset;
		audioUrl: string;
		onTitleChange?: (id: string, newTitle: string) => void;
	}

	let { asset, audioUrl, onTitleChange }: Props = $props();

	// ─── Waveform ────────────────────────────────────────────────────────
	let waveformContainer = $state<HTMLDivElement | null>(null);
	let wavesurfer: import('wavesurfer.js').default | null = null;
	let waveformReady = $state(false);
	let waveformError = $state(false);

	$effect(() => {
		if (!waveformContainer || !audioUrl) return;

		// Dynamically import wavesurfer.js (client-only, no SSR)
		let cancelled = false;

		(async () => {
			try {
				const WaveSurfer = (await import('wavesurfer.js')).default;
				if (cancelled) return;

				wavesurfer = WaveSurfer.create({
					container: waveformContainer!,
					url: audioUrl,
					waveColor: 'hsl(var(--muted-foreground) / 0.4)',
					progressColor: 'hsl(var(--primary))',
					height: 48,
					barWidth: 2,
					barGap: 1,
					barRadius: 2,
					normalize: true,
					interact: false
				});

				wavesurfer.on('ready', () => {
					if (!cancelled) waveformReady = true;
				});

				wavesurfer.on('error', () => {
					if (!cancelled) waveformError = true;
				});
			} catch {
				if (!cancelled) waveformError = true;
			}
		})();

		return () => {
			cancelled = true;
			if (wavesurfer) {
				wavesurfer.destroy();
				wavesurfer = null;
			}
			waveformReady = false;
			waveformError = false;
		};
	});

	onDestroy(() => {
		if (wavesurfer) {
			wavesurfer.destroy();
			wavesurfer = null;
		}
	});

	// ─── Title editing ───────────────────────────────────────────────────
	let editingTitle = $state(false);
	let titleDraft = $state('');
	let savingTitle = $state(false);

	function startEditingTitle() {
		titleDraft = asset.title;
		editingTitle = true;
	}

	function saveTitle() {
		const trimmed = titleDraft.trim();
		if (!trimmed || trimmed === asset.title) {
			editingTitle = false;
			return;
		}
		savingTitle = true;
		onTitleChange?.(asset.id, trimmed);
		savingTitle = false;
		editingTitle = false;
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveTitle();
		} else if (e.key === 'Escape') {
			editingTitle = false;
		}
	}

	// ─── Duration formatting ─────────────────────────────────────────────
	function formatDuration(sec: number | null): string {
		if (sec == null || sec <= 0) return '--:--';
		const totalSec = Math.floor(sec);
		const min = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${min}:${s.toString().padStart(2, '0')}`;
	}

	// ─── Prompt truncation ───────────────────────────────────────────────
	function truncatePrompt(text: string | null, max: number = 80): string {
		if (!text) return '';
		if (text.length <= max) return text;
		return text.slice(0, max).trimEnd() + '…';
	}

	// ─── Provider display name ───────────────────────────────────────────
	const PROVIDER_LABELS: Record<string, string> = {
		minimax: 'MiniMax',
		elevenlabs: 'ElevenLabs',
		stability: 'Stability',
		local_upload: 'Upload',
		browser_render: 'Rendered'
	};

	let providerLabel = $derived(PROVIDER_LABELS[asset.provider] ?? asset.provider);
</script>

<div
	class="bg-card text-card-foreground ring-foreground/10 flex flex-col gap-3 rounded-xl p-4 shadow-xs ring-1"
>
	<!-- Waveform -->
	<div class="relative h-12 w-full overflow-hidden rounded-md">
		{#if !waveformReady && !waveformError}
			<div class="bg-muted/50 flex h-full w-full items-center justify-center">
				<span class="text-muted-foreground text-xs">Loading waveform…</span>
			</div>
		{/if}
		{#if waveformError}
			<div class="bg-muted/50 flex h-full w-full items-center justify-center">
				<span class="text-muted-foreground text-xs">Waveform unavailable</span>
			</div>
		{/if}
		<div
			bind:this={waveformContainer}
			class="h-full w-full"
			class:invisible={!waveformReady}
		></div>
	</div>

	<!-- Title + Provider badge -->
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0 flex-1">
			{#if editingTitle}
				<Input
					class="h-7 text-sm font-semibold"
					bind:value={titleDraft}
					onblur={saveTitle}
					onkeydown={handleTitleKeydown}
					disabled={savingTitle}
					autofocus
				/>
			{:else}
				<button
					class="text-foreground block truncate text-left text-sm font-semibold hover:underline"
					onclick={startEditingTitle}
					title="Click to rename"
				>
					{asset.title}
				</button>
			{/if}
		</div>
		<span
			class="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
		>
			{providerLabel}
		</span>
	</div>

	<!-- Info row: duration + prompt summary -->
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<span class="text-muted-foreground font-mono text-xs">
				{formatDuration(asset.durationSec)}
			</span>
			{#if asset.format}
				<span class="text-muted-foreground text-[10px] uppercase">{asset.format}</span>
			{/if}
		</div>
		{#if asset.prompt}
			<p class="text-muted-foreground line-clamp-2 text-xs">
				{truncatePrompt(asset.prompt)}
			</p>
		{/if}
	</div>
</div>
