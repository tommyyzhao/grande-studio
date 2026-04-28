<script lang="ts">
	import { Loader2, X, RefreshCw } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import type { BlockAsset } from '$lib/types';

	interface Props {
		asset: BlockAsset;
		/** Whether live audio chunks are being received (for receiving_audio state) */
		isLive?: boolean;
		onRetry?: (asset: BlockAsset) => void;
		onCancel?: (asset: BlockAsset) => void;
	}

	let { asset, isLive = false, onRetry, onCancel }: Props = $props();

	// ─── Status display config ───────────────────────────────────────────
	interface StatusConfig {
		label: string;
		showSpinner: boolean;
		cardClass: string;
		badgeClass: string;
	}

	const STATUS_CONFIG: Record<string, StatusConfig> = {
		created: {
			label: 'Queued',
			showSpinner: true,
			cardClass: '',
			badgeClass: 'bg-muted text-muted-foreground'
		},
		queued: {
			label: 'Queued',
			showSpinner: true,
			cardClass: '',
			badgeClass: 'bg-muted text-muted-foreground'
		},
		generating: {
			label: 'Generating...',
			showSpinner: true,
			cardClass: '',
			badgeClass: 'bg-muted text-muted-foreground'
		},
		receiving_audio: {
			label: 'Streaming…',
			showSpinner: true,
			cardClass: 'ring-blue-500/40 bg-blue-500/5 dark:bg-blue-500/10',
			badgeClass: 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
		},
		persisting: {
			label: 'Saving...',
			showSpinner: true,
			cardClass: '',
			badgeClass: 'bg-muted text-muted-foreground'
		},
		failed: {
			label: 'Failed',
			showSpinner: false,
			cardClass: 'ring-destructive/30 bg-destructive/5 dark:bg-destructive/10',
			badgeClass: 'bg-destructive/20 text-destructive'
		}
	};

	let config = $derived(
		STATUS_CONFIG[asset.status] ?? STATUS_CONFIG.queued
	);

	// ─── Error message mapping ───────────────────────────────────────────
	const ERROR_MESSAGES: Record<string, string> = {
		provider_timeout: 'Generation timed out. Please try again.',
		provider_validation_error: 'Invalid request. Please check your prompt and settings.',
		provider_auth_error: 'Provider authentication error. Please try again later.',
		provider_rate_limited: 'Rate limited by the provider. Please wait and try again.',
		stream_interrupted: 'Audio stream was interrupted. Please try again.',
		audio_assembly_failed: 'Failed to assemble audio. Please try again.',
		r2_write_failed: 'Failed to save audio. Please try again.'
	};

	let errorSummary = $derived(
		asset.status === 'failed' && asset.errorCode
			? ERROR_MESSAGES[asset.errorCode] ?? 'Generation failed. Please try again.'
			: null
	);

	// ─── Prompt truncation ───────────────────────────────────────────────
	function truncatePrompt(text: string | null, max: number = 80): string {
		if (!text) return '';
		if (text.length <= max) return text;
		return text.slice(0, max).trimEnd() + '…';
	}

	// ─── Cancel is only allowed when queued ──────────────────────────────
	let canCancel = $derived(
		asset.status === 'created' || asset.status === 'queued'
	);

	// ─── Computed card class ─────────────────────────────────────────────
	let cardClass = $derived.by(() => {
		const base = 'text-card-foreground flex flex-col gap-3 rounded-xl p-4 shadow-xs ring-1';
		if (asset.status === 'failed') {
			return `${base} ${config.cardClass}`;
		}
		if (asset.status === 'receiving_audio') {
			return `${base} ${config.cardClass}`;
		}
		return `${base} bg-card ring-foreground/10`;
	});

	function handleRetry() {
		onRetry?.(asset);
	}

	function handleCancel() {
		onCancel?.(asset);
	}
</script>

<div class={cardClass} role="group">
	<!-- Status area (replaces waveform) -->
	<div class="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-md">
		{#if asset.status === 'receiving_audio' && isLive}
			<!-- Live audio visualization placeholder -->
			<div class="flex h-full w-full items-center justify-center gap-1">
				{#each Array(12) as _, i}
					<div
						class="bg-blue-500/60 w-1 rounded-full"
						style="height: {20 + Math.sin(i * 0.8) * 16}px; animation: pulse 1.5s ease-in-out {i * 0.1}s infinite alternate;"
					></div>
				{/each}
			</div>
		{:else if config.showSpinner}
			<div class="bg-muted/50 flex h-full w-full items-center justify-center">
				<Loader2 class="text-muted-foreground size-5 animate-spin" />
			</div>
		{:else if asset.status === 'failed'}
			<div class="bg-destructive/5 flex h-full w-full items-center justify-center">
				<span class="text-destructive text-xs font-medium">Generation failed</span>
			</div>
		{/if}
	</div>

	<!-- Title + Status badge -->
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0 flex-1">
			<span class="text-foreground block truncate text-sm font-semibold">
				{asset.title}
			</span>
		</div>
		<span
			class="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium {config.badgeClass}"
		>
			{config.label}
		</span>
	</div>

	<!-- Info row: prompt summary -->
	{#if asset.prompt}
		<p class="text-muted-foreground line-clamp-2 text-xs">
			{truncatePrompt(asset.prompt)}
		</p>
	{/if}

	<!-- Error summary (failed state) -->
	{#if errorSummary}
		<p class="text-destructive text-xs">
			{errorSummary}
		</p>
	{/if}

	<!-- Action buttons -->
	<div class="flex items-center gap-1">
		{#if asset.status === 'failed'}
			<Button variant="outline" size="sm" onclick={handleRetry}>
				<RefreshCw class="size-3.5" />
				Retry
			</Button>
		{/if}

		{#if canCancel}
			<Button variant="ghost" size="sm" onclick={handleCancel}>
				<X class="size-3.5" />
				Cancel
			</Button>
		{/if}
	</div>
</div>

<style>
	@keyframes pulse {
		0% {
			transform: scaleY(0.4);
		}
		100% {
			transform: scaleY(1);
		}
	}
</style>
