<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import GeneratePanel from '$lib/components/generate-panel.svelte';
	import TransportBar from '$lib/components/transport-bar.svelte';
	import { createAudioEngine } from '$lib/audio-engine/engine';
	import { createArrangementEngineBridge } from '$lib/stores/arrangement-engine-bridge.svelte';
	import { arrangementStore } from '$lib/stores/arrangement.svelte';

	let { data } = $props();

	// ─── Audio engine ────────────────────────────────────────────────────
	const audioEngine = createAudioEngine();
	createArrangementEngineBridge(audioEngine, arrangementStore);

	onDestroy(() => {
		audioEngine.dispose();
	});

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
			<GeneratePanel projectId={data.project?.id ?? null} />
		</section>

		<!-- Scrollable content area: asset list + arrangement -->
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
			<!-- Asset List Area -->
			<section class="border-border flex-1 border-b px-4 py-4 md:border-r md:border-b-0">
				<p class="text-muted-foreground text-sm">No blocks yet. Generate your first track above.</p>
			</section>

			<!-- Arrangement Area -->
			<section class="flex-1 px-4 py-4">
				<p class="text-muted-foreground text-sm">Arrangement area will appear here.</p>
			</section>
		</div>
	</main>

	<!-- ═══ Transport Bar ═══ -->
	<TransportBar engine={audioEngine} />
</div>
