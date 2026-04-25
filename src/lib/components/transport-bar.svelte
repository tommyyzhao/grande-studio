<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Play, Pause, Square, Download } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { AudioEngine } from '$lib/audio-engine/engine';
	import { arrangementStore } from '$lib/stores/arrangement.svelte';

	interface Props {
		engine: AudioEngine;
	}

	let { engine }: Props = $props();

	// ─── Reactive time polling ──────────────────────────────────────────
	let currentTime = $state(0);
	let isPlaying = $state(false);
	let rafId: number | null = null;

	function pollEngineState() {
		currentTime = engine.currentTime;
		isPlaying = engine.isPlaying;
		rafId = requestAnimationFrame(pollEngineState);
	}

	// Start polling on mount
	rafId = requestAnimationFrame(pollEngineState);

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

	<Button variant="outline" size="sm" disabled title="Export rough mix (coming soon)">
		<Download class="size-4" />
		Export
	</Button>
</footer>
