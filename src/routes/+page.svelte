<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import GeneratePanel from '$lib/components/generate-panel.svelte';
	import TransportBar from '$lib/components/transport-bar.svelte';
	import BlockList from '$lib/components/block-list.svelte';
	import ArrangementClipCard from '$lib/components/arrangement-clip-card.svelte';
	import { createAudioEngine } from '$lib/audio-engine/engine';
	import type { ArrangementClipState } from '$lib/audio-engine/engine';
	import { createArrangementEngineBridge } from '$lib/stores/arrangement-engine-bridge.svelte';
	import { arrangementStore, type ClipUpdate } from '$lib/stores/arrangement.svelte';
	import { createArrangementPersistence } from '$lib/stores/arrangement-persistence.svelte';
	import { sseStore } from '$lib/stores/sse.svelte';
	import type { BlockAsset } from '$lib/types';

	let { data } = $props();

	// ─── Audio engine ────────────────────────────────────────────────────
	const audioEngine = createAudioEngine();
	createArrangementEngineBridge(audioEngine, arrangementStore);

	// ─── Arrangement persistence ─────────────────────────────────────────
	const arrangementPersistence = createArrangementPersistence(arrangementStore);

	// Hydrate arrangement from DB on project load
	$effect(() => {
		if (data.project?.id) {
			arrangementPersistence.hydrate(data.project.id);
		}
	});

	// ─── Asset metadata lookup (for arrangement clip cards) ─────────────
	/** Map from assetId → title, populated from initial assets and new blocks */
	let assetTitles = $state<Map<string, string>>(new Map());
	/** Map from assetId → durationSec, populated from initial assets and new blocks */
	let assetDurations = $state<Map<string, number | null>>(new Map());

	// Seed from initial assets
	$effect(() => {
		const titleMap = new Map<string, string>();
		const durMap = new Map<string, number | null>();
		for (const asset of data.assets) {
			titleMap.set(asset.id, asset.title);
			durMap.set(asset.id, asset.durationSec);
		}
		assetTitles = titleMap;
		assetDurations = durMap;
	});

	// ─── Load audio buffers for hydrated arrangement clips ──────────────
	$effect(() => {
		const clips = arrangementStore.clips;
		for (const clip of clips) {
			if (!audioEngine.hasAsset(clip.assetId)) {
				audioEngine.loadAsset(clip.assetId, `/api/audio/${clip.assetId}`);
			}
		}
	});

	// ─── SSE connection ──────────────────────────────────────────────────
	sseStore.connect();

	onDestroy(() => {
		audioEngine.dispose();
		arrangementPersistence.flush();
		arrangementPersistence.dispose();
		sseStore.disconnect();
	});

	// ─── Block list ref ──────────────────────────────────────────────────
	let blockList = $state<ReturnType<typeof BlockList> | null>(null);

	function handleGenerated(result: { jobId: string; assetId: string; prompt: string; lyrics: string | null }) {
		const newBlock: BlockAsset = {
			id: result.assetId,
			title: result.prompt.slice(0, 50) || 'Untitled',
			prompt: result.prompt,
			lyrics: result.lyrics,
			durationSec: null,
			provider: 'minimax',
			format: null,
			status: 'created',
			createdAt: new Date().toISOString(),
			jobId: result.jobId,
			errorCode: null
		};
		blockList?.addBlock(newBlock);

		// Track metadata for arrangement clip cards
		assetTitles = new Map(assetTitles).set(result.assetId, newBlock.title);
		assetDurations = new Map(assetDurations).set(result.assetId, newBlock.durationSec);
	}

	// ─── Add to arrangement ─────────────────────────────────────────────
	let addingToArrangement = $state(false);

	async function handleAddToArrangement(asset: BlockAsset) {
		if (!data.project?.id || addingToArrangement) return;

		addingToArrangement = true;
		try {
			const res = await fetch('/api/arrangement', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id, assetId: asset.id })
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to add clip' }));
				console.error('Failed to add to arrangement:', err.message);
				return;
			}

			const { clip: dbClip } = await res.json();

			// Convert DB row to ArrangementClipState
			const clipState: ArrangementClipState = {
				clipId: dbClip.id,
				assetId: dbClip.assetId,
				startTimeSec: Number(dbClip.startTimeSec) || 0,
				trimStartSec: Number(dbClip.trimStartSec) || 0,
				trimEndSec: dbClip.trimEndSec != null ? Number(dbClip.trimEndSec) : null,
				clipDurationSec: Number(dbClip.clipDurationSec),
				gainDb: Number(dbClip.gainDb) || 0,
				muted: Boolean(dbClip.muted),
				soloed: Boolean(dbClip.soloed),
				layerOrder: Number(dbClip.layerOrder) || 0
			};

			// Add to arrangement store (engine bridge will sync automatically)
			arrangementStore.addClip(clipState);

			// Track asset metadata
			assetTitles = new Map(assetTitles).set(asset.id, asset.title);
			assetDurations = new Map(assetDurations).set(asset.id, asset.durationSec);

			// Load audio buffer in engine if not already loaded
			if (!audioEngine.hasAsset(asset.id)) {
				audioEngine.loadAsset(asset.id, `/api/audio/${asset.id}`);
			}
		} finally {
			addingToArrangement = false;
		}
	}

	// ─── Auth state ──────────────────────────────────────────────────────
	let signingOut = $state(false);

	async function handleSignOut() {
		signingOut = true;
		await authClient.signOut();
		signingOut = false;
		goto('/signin');
	}

	// ─── Project title editing ───────────────────────────────────────────
	let editingTitle = $state(false);
	let titleDraft = $state('');
	let savingTitle = $state(false);

	function startEditingTitle() {
		if (!data.project) return;
		titleDraft = data.project.title;
		editingTitle = true;
	}

	async function saveTitle() {
		if (!data.project || !titleDraft.trim()) return;
		const trimmed = titleDraft.trim();
		if (trimmed === data.project.title) {
			editingTitle = false;
			return;
		}
		savingTitle = true;
		try {
			const res = await fetch('/api/project', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id, title: trimmed })
			});
			if (res.ok) {
				data.project.title = trimmed;
			}
		} finally {
			savingTitle = false;
			editingTitle = false;
		}
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveTitle();
		} else if (e.key === 'Escape') {
			editingTitle = false;
		}
	}

	// ─── Clip update handler ────────────────────────────────────────────
	function handleUpdateClip(update: ClipUpdate) {
		arrangementPersistence.updateClip(update);
	}

	// ─── Remove clip handler (immediate persistence) ────────────────────
	function handleRemoveClip(clipId: string) {
		arrangementPersistence.removeClip(clipId);
	}

	// ─── Layer order handlers ───────────────────────────────────────────
	function handleMoveUp(clipId: string) {
		const clips = arrangementStore.clips;
		const idx = clips.findIndex((c) => c.clipId === clipId);
		if (idx <= 0) return;
		const orderedIds = clips.map((c) => c.clipId);
		// Swap with the clip above
		[orderedIds[idx - 1], orderedIds[idx]] = [orderedIds[idx], orderedIds[idx - 1]];
		arrangementPersistence.reorderClips(orderedIds);
	}

	function handleMoveDown(clipId: string) {
		const clips = arrangementStore.clips;
		const idx = clips.findIndex((c) => c.clipId === clipId);
		if (idx < 0 || idx >= clips.length - 1) return;
		const orderedIds = clips.map((c) => c.clipId);
		// Swap with the clip below
		[orderedIds[idx], orderedIds[idx + 1]] = [orderedIds[idx + 1], orderedIds[idx]];
		arrangementPersistence.reorderClips(orderedIds);
	}

	// ─── Quota display ──────────────────────────────────────────────────
	let quotaRemaining = $derived(data.quotaLimit - data.quotaUsed);
</script>

<svelte:head>
	<title>{data.project?.title ?? 'Grande Studio'} - Grande Studio</title>
</svelte:head>

<div class="flex h-svh flex-col">
	<!-- ═══ Project Header ═══ -->
	<header class="border-border flex items-center justify-between border-b px-4 py-2">
		<div class="flex items-center gap-3">
			<!-- Project title (editable inline for authenticated users) -->
			{#if editingTitle}
				<Input
					class="h-7 w-48 text-sm font-semibold"
					bind:value={titleDraft}
					onblur={saveTitle}
					onkeydown={handleTitleKeydown}
					disabled={savingTitle}
					autofocus
				/>
			{:else}
				<button
					class="text-foreground text-sm font-semibold hover:underline"
					onclick={startEditingTitle}
					disabled={!data.project}
					title={data.project ? 'Click to rename' : ''}
				>
					{data.project?.title ?? 'Untitled Project'}
				</button>
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<!-- Daily quota -->
			{#if data.user}
				<span class="text-muted-foreground text-xs">
					{quotaRemaining}/{data.quotaLimit}
				</span>
			{/if}

			<!-- Sign out / Sign in -->
			{#if data.user}
				<Button variant="ghost" size="sm" disabled={signingOut} onclick={handleSignOut}>
					{signingOut ? 'Signing out...' : 'Sign out'}
				</Button>
			{:else}
				<Button variant="ghost" size="sm" onclick={() => goto('/signin')}>
					Sign in
				</Button>
			{/if}
		</div>
	</header>

	<!-- ═══ Main Content ═══ -->
	<main class="flex min-h-0 flex-1 flex-col">
		<!-- Generate Panel Area -->
		<section class="border-border border-b px-4 py-4">
			<GeneratePanel projectId={data.project?.id ?? null} onGenerated={handleGenerated} />
		</section>

		<!-- Scrollable content area: asset list + arrangement -->
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
			<!-- Asset List Area -->
			<section class="border-border flex-1 border-b px-4 py-4 md:border-r md:border-b-0">
				<BlockList
					bind:this={blockList}
					initialAssets={data.assets}
					engine={audioEngine}
					onAddToArrangement={handleAddToArrangement}
				/>
			</section>

			<!-- Arrangement Area -->
			<section class="flex-1 px-4 py-4">
				<div class="flex flex-col gap-3">
					{#if arrangementStore.clipCount === 0}
						<p class="text-muted-foreground py-8 text-center text-sm">
							No clips in arrangement. Use the <strong>+</strong> button on a ready block to add it here.
						</p>
					{:else}
						{#each arrangementStore.clips as clip, i (clip.clipId)}
							<ArrangementClipCard
								{clip}
								title={assetTitles.get(clip.assetId) ?? 'Untitled'}
								assetDurationSec={assetDurations.get(clip.assetId) ?? null}
								onUpdateClip={handleUpdateClip}
								onRemoveClip={handleRemoveClip}
								onMoveUp={handleMoveUp}
								onMoveDown={handleMoveDown}
								isFirst={i === 0}
								isLast={i === arrangementStore.clips.length - 1}
							/>
						{/each}
					{/if}
				</div>
			</section>
		</div>
	</main>

	<!-- ═══ Transport Bar ═══ -->
	<TransportBar engine={audioEngine} />
</div>
