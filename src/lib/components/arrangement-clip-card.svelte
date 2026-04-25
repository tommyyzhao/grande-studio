<script lang="ts">
	import { Music, Minus, Plus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ArrangementClipState } from '$lib/audio-engine/engine';
	import type { ClipUpdate } from '$lib/stores/arrangement.svelte';

	interface Props {
		clip: ArrangementClipState;
		/** Title of the source asset */
		title: string;
		/** Callback to update clip fields (persists via arrangement persistence) */
		onUpdateClip?: (update: ClipUpdate) => void;
	}

	let { clip, title, onUpdateClip }: Props = $props();

	const STEP = 0.5;

	// ─── Duration formatting ─────────────────────────────────────────────
	function formatDuration(sec: number): string {
		if (sec <= 0) return '0:00';
		const totalSec = Math.floor(sec);
		const min = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${min}:${s.toString().padStart(2, '0')}`;
	}

	// ─── Start offset formatting ─────────────────────────────────────────
	function formatOffset(sec: number): string {
		// Show one decimal if fractional, integer otherwise
		return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
	}

	// ─── Start offset controls ───────────────────────────────────────────
	function decrementOffset() {
		const newValue = Math.max(0, clip.startTimeSec - STEP);
		onUpdateClip?.({ clipId: clip.clipId, startTimeSec: newValue });
	}

	function incrementOffset() {
		const newValue = clip.startTimeSec + STEP;
		onUpdateClip?.({ clipId: clip.clipId, startTimeSec: newValue });
	}
</script>

<div
	class="bg-card text-card-foreground ring-foreground/10 flex items-center gap-3 rounded-lg px-3 py-2.5 shadow-xs ring-1"
	role="group"
>
	<!-- Mini waveform placeholder -->
	<div class="bg-muted flex size-8 shrink-0 items-center justify-center rounded">
		<Music class="text-muted-foreground size-4" />
	</div>

	<!-- Title + duration -->
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-medium">{title}</p>
		<p class="text-muted-foreground text-xs">
			{formatDuration(clip.clipDurationSec)}
		</p>
	</div>

	<!-- Start offset controls -->
	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon"
			class="size-7"
			disabled={clip.startTimeSec <= 0}
			onclick={decrementOffset}
			title="Decrease start offset by 0.5s"
		>
			<Minus class="size-3.5" />
		</Button>
		<span class="text-muted-foreground w-10 text-center text-xs tabular-nums">
			{formatOffset(clip.startTimeSec)}
		</span>
		<Button
			variant="ghost"
			size="icon"
			class="size-7"
			onclick={incrementOffset}
			title="Increase start offset by 0.5s"
		>
			<Plus class="size-3.5" />
		</Button>
	</div>
</div>
