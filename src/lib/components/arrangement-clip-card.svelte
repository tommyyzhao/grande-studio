<script lang="ts">
	import { Music } from 'lucide-svelte';
	import type { ArrangementClipState } from '$lib/audio-engine/engine';

	interface Props {
		clip: ArrangementClipState;
		/** Title of the source asset */
		title: string;
	}

	let { clip, title }: Props = $props();

	// ─── Duration formatting ─────────────────────────────────────────────
	function formatDuration(sec: number): string {
		if (sec <= 0) return '0:00';
		const totalSec = Math.floor(sec);
		const min = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${min}:${s.toString().padStart(2, '0')}`;
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
</div>
