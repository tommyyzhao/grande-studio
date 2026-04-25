<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import '../app.css';

	let { data, children } = $props();

	let signingOut = $state(false);

	async function handleSignOut() {
		signingOut = true;
		await authClient.signOut();
		signingOut = false;
		goto('/signin');
	}

	// The workspace page (/) has its own header — skip the layout header there
	let isWorkspace = $derived($page.url.pathname === '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if data.user && !isWorkspace}
	<header class="border-border flex items-center justify-between border-b px-4 py-2">
		<span class="text-sm font-medium">{data.user.email}</span>
		<Button variant="ghost" size="sm" disabled={signingOut} onclick={handleSignOut}>
			{signingOut ? 'Signing out...' : 'Sign out'}
		</Button>
	</header>
{/if}

{@render children()}
