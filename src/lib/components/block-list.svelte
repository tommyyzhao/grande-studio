<script lang="ts">
	import BlockCard from '$lib/components/block-card.svelte';
	import PendingBlockCard from '$lib/components/pending-block-card.svelte';
	import { sseStore } from '$lib/stores/sse.svelte';
	import type { BlockAsset, AssetStatus } from '$lib/types';
	import type { AudioEngine } from '$lib/audio-engine/engine';

	interface Props {
		/** Initial assets loaded from the server */
		initialAssets: BlockAsset[];
		engine?: AudioEngine;
		onAddToArrangement?: (asset: BlockAsset) => void;
		onCreateVariation?: (asset: BlockAsset) => void;
		onCoverRestyle?: (asset: BlockAsset) => void;
		onExport?: (asset: BlockAsset) => void;
		/** Map of parentAssetId → number of child variations */
		variationCounts?: Map<string, number>;
	}

	let {
		initialAssets,
		engine,
		onAddToArrangement,
		onCoverRestyle,
		onCreateVariation,
		onExport,
		variationCounts
	}: Props = $props();

	// ─── Local asset list state ─────────────────────────────────────────
	// Seeded from server-loaded data; managed locally after mount
	let assets = $state<BlockAsset[]>([]);
	let hydrated = false;

	// Hydrate from initialAssets (re-hydrates if server data changes, e.g. navigation)
	$effect(() => {
		const serverAssets = initialAssets;
		if (!hydrated || assets.length === 0) {
			assets = [...serverAssets];
			hydrated = true;
		}
	});

	// Map from jobId → status for SSE-driven updates
	const JOB_TO_ASSET_STATUS: Record<string, AssetStatus> = {
		created: 'created',
		queued: 'queued',
		generating: 'generating',
		receiving_audio: 'receiving_audio',
		persisting: 'persisting',
		succeeded: 'ready',
		failed: 'failed',
		cancelled: 'deleted'
	};

	// ─── SSE status change listener ─────────────────────────────────────
	$effect(() => {
		const unsubscribe = sseStore.onStatusChange((event) => {
			const assetStatus = JOB_TO_ASSET_STATUS[event.status];
			if (!assetStatus) return;

			// Find the asset that matches this job and update its status
			const idx = assets.findIndex(
				(a) => a.jobId === event.jobId || (event.assetId && a.id === event.assetId)
			);
			if (idx === -1) return;

			// Create a new array for reactivity
			const updated = [...assets];
			updated[idx] = {
				...updated[idx],
				status: assetStatus,
				errorCode: event.errorCode ?? updated[idx].errorCode
			};
			assets = updated;
		});

		return unsubscribe;
	});

	/**
	 * Add a new block to the list after a generation submit succeeds.
	 * Called from the parent component.
	 */
	export function addBlock(block: BlockAsset) {
		// Prepend (newest first)
		assets = [block, ...assets];

		// Optimistically set the SSE store so other consumers know about this job
		if (block.jobId) {
			sseStore.setJobStatus({
				jobId: block.jobId,
				assetId: block.id,
				status: 'created',
				errorCode: null
			});
		}
	}

	// ─── Derived: effective assets with SSE overrides applied ────────────
	let displayAssets = $derived.by(() => {
		return assets.filter((a) => a.status !== 'deleted');
	});

	// ─── Audio URL helper ───────────────────────────────────────────────
	function getAudioUrl(asset: BlockAsset): string {
		return `/api/audio/${asset.id}`;
	}

	// ─── Handlers ───────────────────────────────────────────────────────
	function handleRetry(asset: BlockAsset) {
		// Retry creates a new generation — handled by parent via event
		// For now, this is a placeholder; US-044 defines retry behavior
	}

	function handleCancel(asset: BlockAsset) {
		// Cancel is a placeholder for now
	}

	function handleTitleChange(id: string, newTitle: string) {
		const idx = assets.findIndex((a) => a.id === id);
		if (idx === -1) return;
		const updated = [...assets];
		updated[idx] = { ...updated[idx], title: newTitle };
		assets = updated;
	}
</script>

<div class="flex flex-col gap-3">
	{#if displayAssets.length === 0}
		<p class="text-muted-foreground py-8 text-center text-sm">
			No blocks yet. Generate your first track above.
		</p>
	{:else}
		{#each displayAssets as asset (asset.id)}
			{#if asset.status === 'ready'}
				<BlockCard
					{asset}
					audioUrl={getAudioUrl(asset)}
					{engine}
					onTitleChange={handleTitleChange}
					{onAddToArrangement}
					{onCreateVariation}
					{onCoverRestyle}
					{onExport}
					variationCount={variationCounts?.get(asset.id) ?? 0}
				/>
			{:else}
				<PendingBlockCard
					{asset}
					isLive={sseStore.isAssetLive(asset.id)}
					onRetry={handleRetry}
					onCancel={handleCancel}
				/>
			{/if}
		{/each}
	{/if}
</div>
