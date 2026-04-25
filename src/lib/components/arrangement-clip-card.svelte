<script lang="ts">
	import { Music, Minus, Plus, Scissors, Volume2, VolumeX, Headphones } from 'lucide-svelte';
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
	/** Minimum clip duration when dragging (0.5s) */
	const MIN_CLIP_DURATION = 0.5;
	/** Maximum loop multiplier (e.g., 10x the trimmed length) */
	const MAX_LOOP_MULTIPLIER = 10;

	// ─── Computed trim bounds ────────────────────────────────────────────
	/** Effective maximum for trim values (source audio duration) */
	const maxDuration = $derived(assetDurationSec ?? clip.clipDurationSec);
	/** Effective trim end (null means end of source audio) */
	const effectiveTrimEnd = $derived(clip.trimEndSec ?? maxDuration);
	/** Trimmed audio length */
	const trimmedLength = $derived(effectiveTrimEnd - clip.trimStartSec);
	/** Whether trim section is expanded */
	let trimExpanded = $state(false);

	// ─── Drag-to-extend state ────────────────────────────────────────────
	let isDragging = $state(false);
	/** Transient clip duration while dragging (before commit) */
	let dragClipDuration = $state(0);
	/** The bar container element for coordinate calculations */
	let barEl: HTMLDivElement | undefined = $state();

	/** Active clip duration — use drag value when dragging, clip value otherwise */
	const activeClipDuration = $derived(isDragging ? dragClipDuration : clip.clipDurationSec);

	/** How many full + partial loops are needed */
	const loopCount = $derived.by(() => {
		if (trimmedLength <= 0) return 1;
		return activeClipDuration / trimmedLength;
	});

	/** Whether the clip is currently looping (duration exceeds trimmed length) */
	const isLooping = $derived(trimmedLength > 0 && activeClipDuration > trimmedLength);

	/** Filled region width as percentage of the bar (maps to max extendable range) */
	const fillPercent = $derived(
		Math.min(100, (activeClipDuration / (trimmedLength * MAX_LOOP_MULTIPLIER)) * 100)
	);

	/** Array of loop segment widths as percentages of total clip duration */
	const loopSegments = $derived.by(() => {
		if (trimmedLength <= 0 || activeClipDuration <= 0) return [100];
		const segments: number[] = [];
		let remaining = activeClipDuration;
		while (remaining > 0.001) {
			const segLen = Math.min(remaining, trimmedLength);
			segments.push((segLen / activeClipDuration) * 100);
			remaining -= segLen;
		}
		return segments;
	});

	// ─── Drag handlers ──────────────────────────────────────────────────
	function onDragStart(e: PointerEvent) {
		if (!barEl) return;
		isDragging = true;
		dragClipDuration = clip.clipDurationSec;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onDragMove(e: PointerEvent) {
		if (!isDragging || !barEl) return;
		const rect = barEl.getBoundingClientRect();
		// Maximum duration the bar can represent (for coordinate mapping)
		const maxExtendDuration = trimmedLength * MAX_LOOP_MULTIPLIER;
		// Map pointer X position to duration
		const relX = e.clientX - rect.left;
		const ratio = Math.max(0, Math.min(1, relX / rect.width));
		const newDuration = ratio * maxExtendDuration;
		// Clamp to minimum and snap to 0.25s increments
		const snapped = Math.round(newDuration * 4) / 4;
		dragClipDuration = Math.max(MIN_CLIP_DURATION, snapped);
	}

	function onDragEnd(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		// Commit the new duration if changed
		if (Math.abs(dragClipDuration - clip.clipDurationSec) > 0.01) {
			onUpdateClip?.({ clipId: clip.clipId, clipDurationSec: dragClipDuration });
		}
	}

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

	// ─── Gain / Mute / Solo controls ────────────────────────────────────
	/** Gain range: -24 dB to +6 dB */
	const GAIN_MIN = -24;
	const GAIN_MAX = 6;

	function handleGainChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const newGain = parseFloat(target.value);
		onUpdateClip?.({ clipId: clip.clipId, gainDb: newGain });
	}

	function toggleMute() {
		onUpdateClip?.({ clipId: clip.clipId, muted: !clip.muted });
	}

	function toggleSolo() {
		onUpdateClip?.({ clipId: clip.clipId, soloed: !clip.soloed });
	}

	/** Format gain value for display */
	function formatGain(db: number): string {
		if (db === 0) return '0 dB';
		return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
	}
</script>

<div
	class="rounded-lg shadow-xs ring-1 transition-opacity {clip.soloed ? 'bg-primary/10 text-card-foreground ring-primary/30' : 'bg-card text-card-foreground ring-foreground/10'} {clip.muted && !clip.soloed ? 'opacity-50' : ''}"
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

	<!-- Gain slider + Mute / Solo toggles -->
	<div class="border-border flex items-center gap-2 border-t px-3 py-1.5">
		<!-- Mute toggle -->
		<Button
			variant={clip.muted ? 'secondary' : 'ghost'}
			size="icon"
			class="size-7"
			onclick={toggleMute}
			title={clip.muted ? 'Unmute clip' : 'Mute clip'}
		>
			{#if clip.muted}
				<VolumeX class="size-3.5" />
			{:else}
				<Volume2 class="size-3.5" />
			{/if}
		</Button>

		<!-- Solo toggle -->
		<Button
			variant={clip.soloed ? 'default' : 'ghost'}
			size="icon"
			class="size-7"
			onclick={toggleSolo}
			title={clip.soloed ? 'Unsolo clip' : 'Solo clip'}
		>
			<Headphones class="size-3.5" />
		</Button>

		<!-- Gain slider -->
		<input
			type="range"
			min={GAIN_MIN}
			max={GAIN_MAX}
			step="0.5"
			value={clip.gainDb}
			oninput={handleGainChange}
			class="h-1.5 flex-1 cursor-pointer accent-primary"
			title="Gain: {formatGain(clip.gainDb)}"
		/>

		<!-- Gain value label -->
		<span class="text-muted-foreground w-14 text-right text-xs tabular-nums">
			{formatGain(clip.gainDb)}
		</span>
	</div>

	<!-- Waveform bar with drag-to-extend handle -->
	<div class="border-border border-t px-3 py-2">
		<div
			class="relative h-8 select-none overflow-hidden rounded"
			bind:this={barEl}
			role="slider"
			aria-label="Clip duration — drag right edge to extend"
			aria-valuemin={MIN_CLIP_DURATION}
			aria-valuemax={trimmedLength * MAX_LOOP_MULTIPLIER}
			aria-valuenow={activeClipDuration}
			tabindex={0}
		>
			<!-- Background (represents max extendable range) -->
			<div class="bg-muted absolute inset-0 rounded"></div>

			<!-- Filled region representing activeClipDuration / max range -->
			<div
				class="absolute inset-y-0 left-0 flex rounded-l"
				style="width: {fillPercent}%"
			>
				<!-- Loop segments -->
				{#each loopSegments as widthPct, i}
					{@const segBg = i === 0 ? 'bg-primary/70' : 'bg-primary/30'}
					{@const segBorder = i < loopSegments.length - 1 ? 'border-primary/40' : ''}
					<div
						class="h-full border-r last:border-r-0 {segBg} {segBorder}"
						style="width: {widthPct}%; min-width: 1px"
					>
						<!-- Fake waveform bars inside each segment -->
						<div class="flex h-full items-end gap-px px-px">
							{#each { length: Math.max(3, Math.floor(widthPct / 3)) } as _, j}
								{@const barHeight = 30 + Math.abs(Math.sin((j + i * 7) * 0.9)) * 70}
								{@const waveBg = i === 0 ? 'bg-primary-foreground/50' : 'bg-primary-foreground/25'}
								<div
									class="flex-1 rounded-t-sm {waveBg}"
									style="height: {barHeight}%"
								></div>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<!-- Drag handle on the right edge of the filled region -->
			<div
				class="absolute inset-y-0 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
				class:bg-primary={isDragging}
				class:rounded={isDragging}
				style="left: {fillPercent}%"
				onpointerdown={onDragStart}
				onpointermove={onDragMove}
				onpointerup={onDragEnd}
				role="presentation"
			>
				<div class="bg-primary h-5 w-0.5 rounded-full" class:bg-primary-foreground={isDragging}></div>
			</div>
		</div>

		<!-- Duration label row -->
		<div class="mt-1 flex items-center justify-between">
			<span class="text-muted-foreground text-xs tabular-nums">
				{formatSec(activeClipDuration)}
			</span>
			{#if isLooping}
				<span class="text-muted-foreground text-xs">
					{loopCount.toFixed(1)}x loop
				</span>
			{/if}
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
