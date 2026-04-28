<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		Play,
		Pause,
		ListPlus,
		GitBranch,
		Disc3,
		Download,
		MoreHorizontal
	} from 'lucide-svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import type { BlockAsset } from '$lib/types';
	import type { AudioEngine } from '$lib/audio-engine/engine';

	interface Props {
		asset: BlockAsset;
		audioUrl: string;
		engine?: AudioEngine;
		onTitleChange?: (id: string, newTitle: string) => void;
		onAddToArrangement?: (asset: BlockAsset) => void;
		onCreateVariation?: (asset: BlockAsset) => void;
		onCoverRestyle?: (asset: BlockAsset) => void;
		onExport?: (asset: BlockAsset) => void;
		/** Number of child variations derived from this block */
		variationCount?: number;
		/** Parent asset ID if this block is derived from another */
		parentAssetId?: string | null;
		/** Parent asset title for "Derived from" badge */
		parentTitle?: string | null;
		/** Callback to scroll to and highlight the parent block */
		onScrollToParent?: (parentAssetId: string) => void;
		/** Callback to scroll to child variations of this block */
		onScrollToVariations?: (assetId: string) => void;
	}

	let {
		asset,
		audioUrl,
		engine,
		onTitleChange,
		onAddToArrangement,
		onCoverRestyle,
		onCreateVariation,
		onExport,
		variationCount = 0,
		parentAssetId = null,
		parentTitle = null,
		onScrollToParent,
		onScrollToVariations
	}: Props = $props();

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

	// ─── Play/preview state ──────────────────────────────────────────────
	let isPreviewPlaying = $state(false);

	async function handlePlayPreview() {
		if (!engine) return;
		if (isPreviewPlaying) {
			await engine.pause();
			isPreviewPlaying = false;
			return;
		}
		if (!engine.hasAsset(asset.id)) {
			await engine.loadAsset(asset.id, audioUrl);
		}
		await engine.play(asset.id);
		isPreviewPlaying = true;
	}

	function handleAddToArrangement() {
		onAddToArrangement?.(asset);
	}

	function handleCreateVariation() {
		onCreateVariation?.(asset);
	}

	function handleCoverRestyle() {
		onCoverRestyle?.(asset);
	}

	function handleExport() {
		onExport?.(asset);
	}

	// ─── Long-press context menu (mobile) ────────────────────────────────
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let contextMenuOpen = $state(false);

	function handlePointerDown() {
		longPressTimer = setTimeout(() => {
			contextMenuOpen = true;
		}, 500);
	}

	function handlePointerUp() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function handlePointerCancel() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}
</script>

<div
	class="bg-card text-card-foreground ring-foreground/10 flex flex-col gap-3 rounded-xl p-4 shadow-xs ring-1"
	onpointerdown={handlePointerDown}
	onpointerup={handlePointerUp}
	onpointerleave={handlePointerCancel}
	onpointercancel={handlePointerCancel}
	role="group"
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
	<div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
		<div class="min-w-0 max-w-full flex-1 basis-full sm:basis-0">
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
					class="text-foreground block w-full truncate text-left text-sm font-semibold hover:underline"
					onclick={startEditingTitle}
					title="Click to rename"
				>
					{asset.title}
				</button>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			{#if variationCount > 0}
				<button
					class="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-500/20 dark:text-blue-400"
					onclick={() => onScrollToVariations?.(asset.id)}
					title="Scroll to variations"
				>
					{variationCount} {variationCount === 1 ? 'variation' : 'variations'}
				</button>
			{/if}
			<span
				class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium"
			>
				{providerLabel}
			</span>
		</div>
	</div>

	<!-- Derived from badge -->
	{#if parentAssetId && parentTitle}
		<button
			class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] hover:underline"
			onclick={() => onScrollToParent?.(parentAssetId)}
			title="Scroll to parent block"
		>
			<GitBranch class="size-3 shrink-0" />
			<span>Derived from: <span class="font-medium">{parentTitle}</span></span>
		</button>
	{/if}

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

	<!-- Action buttons. Play and Add to arrangement are the primary
	     actions; Variation, Cover, and Download collapse into the dropdown. -->
	<div class="flex items-center gap-1">
		<Button
			variant="outline"
			size="sm"
			onclick={handlePlayPreview}
			title={isPreviewPlaying ? 'Pause preview' : 'Play preview'}
			class="gap-1.5"
		>
			{#if isPreviewPlaying}
				<Pause class="size-4" />
			{:else}
				<Play class="size-4" />
			{/if}
			<span class="text-xs">{isPreviewPlaying ? 'Pause' : 'Play'}</span>
		</Button>

		<Button
			variant="outline"
			size="sm"
			onclick={handleAddToArrangement}
			title="Add to arrangement"
			class="gap-1.5"
		>
			<ListPlus class="size-4" />
			<span class="text-xs">Add</span>
		</Button>

		<!-- More actions dropdown (also used by long-press on mobile) -->
		<DropdownMenu.Root bind:open={contextMenuOpen}>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class="ml-auto"
						title="More actions"
					>
						<MoreHorizontal class="size-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onclick={handlePlayPreview}>
					{#if isPreviewPlaying}
						<Pause class="size-4" />
					{:else}
						<Play class="size-4" />
					{/if}
					{isPreviewPlaying ? 'Pause preview' : 'Play preview'}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={handleAddToArrangement}>
					<ListPlus class="size-4" />
					Add to arrangement
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={handleCreateVariation}>
					<GitBranch class="size-4" />
					Create variation
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={handleCoverRestyle}>
					<Disc3 class="size-4" />
					Cover / Re-style
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={handleExport}>
					<Download class="size-4" />
					Download
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
</div>
