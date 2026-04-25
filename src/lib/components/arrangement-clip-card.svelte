<script lang="ts">
	import { Music, Minus, Plus, Scissors } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ArrangementClipState } from '$lib/audio-engine/engine';
	import type { ClipUpdate } from '$lib/stores/arrangement.svelte';

	interface Props {
		clip: ArrangementClipState;
		/** Title of the source asset */
		title: string;
		/** Original source audio duration in seconds (for trim bounds) */
		assetDurationSec: number | null;
		/** Callback to update clip fields (persists via arrangement persistence) */
		onUpdateClip?: (update: ClipUpdate) => void;
	}

	let { clip, title, assetDurationSec, onUpdateClip }: Props = $props();

	const STEP = 0.5;

	// ─── Computed trim bounds ────────────────────────────────────────────
	/** Effective maximum for trim values (source audio duration) */
	const maxDuration = $derived(assetDurationSec ?? clip.clipDurationSec);
	/** Effective trim end (null means end of source audio) */
	const effectiveTrimEnd = $derived(clip.trimEndSec ?? maxDuration);
	/** Trimmed audio length */
	const trimmedLength = $derived(effectiveTrimEnd - clip.trimStartSec);
	/** Whether trim section is expanded */
	let trimExpanded = $state(false);

	// ─── Duration formatting ─────────────────────────────────────────────
	function formatDuration(sec: number): string {
		if (sec <= 0) return '0:00';
		const totalSec = Math.floor(sec);
		const min = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${min}:${s.toString().padStart(2, '0')}`;
	}

	// ─── Seconds formatting (for trim/offset values) ────────────────────
	function formatSec(sec: number): string {
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

	// ─── Trim controls ──────────────────────────────────────────────────
	function decrementTrimStart() {
		const newValue = Math.max(0, clip.trimStartSec - STEP);
		onUpdateClip?.({ clipId: clip.clipId, trimStartSec: newValue });
	}

	function incrementTrimStart() {
		// Cannot exceed effective trim end (leave at least 0.5s of audio)
		const maxTrimStart = effectiveTrimEnd - STEP;
		const newValue = Math.min(maxTrimStart, clip.trimStartSec + STEP);
		if (newValue <= clip.trimStartSec) return;
		const update: ClipUpdate = { clipId: clip.clipId, trimStartSec: newValue };
		// If trim shortens below clipDurationSec, reduce clipDurationSec to match
		const newTrimmedLength = effectiveTrimEnd - newValue;
		if (newTrimmedLength < clip.clipDurationSec) {
			update.clipDurationSec = newTrimmedLength;
		}
		onUpdateClip?.(update);
	}

	function decrementTrimEnd() {
		// Cannot go below trim start (leave at least 0.5s of audio)
		const minTrimEnd = clip.trimStartSec + STEP;
		const newValue = Math.max(minTrimEnd, effectiveTrimEnd - STEP);
		if (newValue >= effectiveTrimEnd) return;
		const update: ClipUpdate = { clipId: clip.clipId, trimEndSec: newValue };
		// If trim shortens below clipDurationSec, reduce clipDurationSec to match
		const newTrimmedLength = newValue - clip.trimStartSec;
		if (newTrimmedLength < clip.clipDurationSec) {
			update.clipDurationSec = newTrimmedLength;
		}
		onUpdateClip?.(update);
	}

	function incrementTrimEnd() {
		const newValue = Math.min(maxDuration, effectiveTrimEnd + STEP);
		if (newValue <= effectiveTrimEnd) return;
		// If going back to the max, set to null (meaning "no trim end")
		const trimEndValue = newValue >= maxDuration ? null : newValue;
		onUpdateClip?.({ clipId: clip.clipId, trimEndSec: trimEndValue });
	}

	function toggleTrim() {
		trimExpanded = !trimExpanded;
	}
</script>

<div
	class="bg-card text-card-foreground ring-foreground/10 rounded-lg shadow-xs ring-1"
	role="group"
>
	<!-- Main row: icon, title, offset, trim toggle -->
	<div class="flex items-center gap-3 px-3 py-2.5">
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

		<!-- Trim toggle button -->
		<Button
			variant={trimExpanded ? 'secondary' : 'ghost'}
			size="icon"
			class="size-7"
			onclick={toggleTrim}
			title="Toggle trim controls"
		>
			<Scissors class="size-3.5" />
		</Button>

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
				{formatSec(clip.startTimeSec)}
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

	<!-- Trim controls (expandable) -->
	{#if trimExpanded}
		<div class="border-border flex items-center gap-4 border-t px-3 py-2">
			<!-- Trim start -->
			<div class="flex items-center gap-1">
				<span class="text-muted-foreground text-xs">Start</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-6"
					disabled={clip.trimStartSec <= 0}
					onclick={decrementTrimStart}
					title="Decrease trim start by 0.5s"
				>
					<Minus class="size-3" />
				</Button>
				<span class="text-muted-foreground w-9 text-center text-xs tabular-nums">
					{formatSec(clip.trimStartSec)}
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-6"
					disabled={effectiveTrimEnd - clip.trimStartSec <= STEP}
					onclick={incrementTrimStart}
					title="Increase trim start by 0.5s"
				>
					<Plus class="size-3" />
				</Button>
			</div>

			<!-- Trim end -->
			<div class="flex items-center gap-1">
				<span class="text-muted-foreground text-xs">End</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-6"
					disabled={effectiveTrimEnd - clip.trimStartSec <= STEP}
					onclick={decrementTrimEnd}
					title="Decrease trim end by 0.5s"
				>
					<Minus class="size-3" />
				</Button>
				<span class="text-muted-foreground w-9 text-center text-xs tabular-nums">
					{formatSec(effectiveTrimEnd)}
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-6"
					disabled={effectiveTrimEnd >= maxDuration}
					onclick={incrementTrimEnd}
					title="Increase trim end by 0.5s"
				>
					<Plus class="size-3" />
				</Button>
			</div>

			<!-- Trimmed length indicator -->
			<span class="text-muted-foreground ml-auto text-xs">
				{formatSec(trimmedLength)} of {formatSec(maxDuration)}
			</span>
		</div>
	{/if}
</div>
