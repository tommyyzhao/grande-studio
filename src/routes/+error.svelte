<script lang="ts">
	import { page } from '$app/stores';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center">
	<div class="max-w-md space-y-6">
		<div class="space-y-2">
			<p class="text-muted-foreground text-sm font-medium tracking-wider uppercase">
				Error {$page.status}
			</p>
			<h1 class="text-foreground text-3xl font-semibold">
				{#if $page.status === 404}
					Page not found
				{:else if $page.status >= 500}
					Something went wrong
				{:else}
					{$page.error?.message ?? 'Unexpected error'}
				{/if}
			</h1>
			<p class="text-muted-foreground text-sm">
				{#if $page.status >= 500}
					An unexpected error occurred on our end. Try again, or head back to the workspace.
				{:else if $page.status === 404}
					The page you're looking for doesn't exist or has moved.
				{:else}
					{$page.error?.message ?? ''}
				{/if}
			</p>
		</div>

		<div class="flex justify-center gap-3">
			<Button href="/" variant="default">Back to workspace</Button>
			<Button onclick={() => location.reload()} variant="outline">Reload</Button>
		</div>
	</div>
</div>
