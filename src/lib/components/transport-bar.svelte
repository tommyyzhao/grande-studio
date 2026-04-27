<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Play, Pause, Square, Download, Loader2 } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { AudioEngine } from '$lib/audio-engine/engine';
	import { arrangementStore } from '$lib/stores/arrangement.svelte';
	import { buildSnapshot, type GetSignedUrl } from '$lib/services/arrangement-snapshot';
	import { renderMixdown, downloadBlob, type MixdownProgress } from '$lib/audio-engine/mixdown';

	interface Props {
		engine: AudioEngine;
		projectId: string | null;
	}

	let { engine, projectId }: Props = $props();

	// ─── Reactive time polling ──────────────────────────────────────────
	let currentTime = $state(0);
	let isPlaying = $state(false);
	let rafId: number | null = null;

	function pollEngineState() {
		currentTime = engine.currentTime;
		isPlaying = engine.isPlaying;
		rafId = requestAnimationFrame(pollEngineState);
	}

	// Start polling on mount (browser only)
	if (typeof requestAnimationFrame !== 'undefined') {
		rafId = requestAnimationFrame(pollEngineState);
	}

	onDestroy(() => {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	});

	// ─── Derived state ──────────────────────────────────────────────────
	let arrangementLength = $derived(arrangementStore.totalDuration);

	// ─── Time formatting ────────────────────────────────────────────────
	function formatTime(seconds: number): string {
		const totalSec = Math.max(0, Math.floor(seconds));
		const min = Math.floor(totalSec / 60);
		const sec = totalSec % 60;
		return `${min}:${sec.toString().padStart(2, '0')}`;
	}

	// ─── Transport actions ──────────────────────────────────────────────
	async function handlePlay() {
		await engine.play();
	}

	async function handlePause() {
		await engine.pause();
	}

	function handleStop() {
		engine.stop();
	}

	// ─── Rough mixdown export ───────────────────────────────────────────
	let exporting = $state(false);
	let exportPhase = $state<MixdownProgress['phase'] | null>(null);
	let exportError = $state<string | null>(null);
	let canExport = $derived(arrangementStore.clipCount > 0 && !exporting);

	function getSignedUrl(assetId: string): Promise<string> {
		// The /api/audio endpoint redirects (302) to a signed R2 URL.
		// For OfflineAudioContext we need a direct URL, so we follow the redirect manually.
		return fetch(`/api/audio/${assetId}`, { redirect: 'follow' }).then((res) => res.url);
	}

	async function handleExportMix() {
		if (!projectId || exporting) return;

		exporting = true;
		exportError = null;
		exportPhase = 'loading';

		try {
			// Stop playback before rendering
			engine.stop();

			// Build snapshot from current arrangement state
			const result = await buildSnapshot(
				projectId,
				arrangementStore.clips,
				getSignedUrl as GetSignedUrl
			);

			if (!result.ok) {
				const msgs = result.errors.map((e) => e.message).join('; ');
				throw new Error(`Snapshot validation failed: ${msgs}`);
			}

			// Render mixdown
			const { blob } = await renderMixdown(result.snapshot, (progress) => {
				exportPhase = progress.phase;
			});

			// Download the WAV file
			const filename = `rough-mix-${new Date().toISOString().slice(0, 10)}.wav`;
			downloadBlob(blob, filename);
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Export failed';
			console.error('Mixdown export failed:', err);
		} finally {
			exporting = false;
			exportPhase = null;
		}
	}
</script>

<footer class="border-border flex items-center justify-between border-t px-4 py-2">
	<div class="flex items-center gap-1">
		{#if isPlaying}
			<Button variant="outline" size="icon-sm" onclick={handlePause} title="Pause">
				<Pause class="size-4" />
			</Button>
		{:else}
			<Button variant="outline" size="icon-sm" onclick={handlePlay} title="Play">
				<Play class="size-4" />
			</Button>
		{/if}
		<Button variant="outline" size="icon-sm" onclick={handleStop} title="Stop">
			<Square class="size-3.5" />
		</Button>
	</div>

	<div class="text-muted-foreground flex items-center gap-2 font-mono text-xs">
		<span>{formatTime(currentTime)}</span>
		<span>/</span>
		<span>{formatTime(arrangementLength)}</span>
	</div>

	<div class="flex items-center gap-2">
		{#if exportError}
			<span class="text-destructive text-xs">{exportError}</span>
		{/if}
		<Button
			variant="outline"
			size="sm"
			disabled={!canExport}
			onclick={handleExportMix}
			title={canExport ? 'Export rough mixdown as WAV' : exporting ? 'Exporting...' : 'Add clips to arrangement first'}
		>
			{#if exporting}
				<Loader2 class="size-4 animate-spin" />
				{#if exportPhase === 'loading'}
					Loading...
				{:else if exportPhase === 'rendering'}
					Rendering...
				{:else if exportPhase === 'encoding'}
					Encoding...
				{:else}
					Exporting...
				{/if}
			{:else}
				<Download class="size-4" />
				Export
			{/if}
		</Button>
	</div>
</footer>
