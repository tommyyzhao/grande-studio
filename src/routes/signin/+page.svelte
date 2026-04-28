<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	// Pre-warm the BetterAuth handler on Pages so the user's submit lands
	// on a hot function. Cold-start 503s otherwise surface as a generic
	// "Invalid email or password" because the BetterAuth client doesn't
	// expose HTTP status on its error object.
	onMount(() => {
		fetch('/api/auth/get-session', { credentials: 'include' }).catch(() => {});
	});

	let emailError = $derived.by(() => {
		if (!email) return '';
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email) ? '' : 'Please enter a valid email address';
	});

	let passwordError = $derived.by(() => {
		if (!password) return '';
		return password.length >= 8 ? '' : 'Password must be at least 8 characters';
	});

	let isValid = $derived(
		email.length > 0 && password.length >= 8 && !emailError && !passwordError
	);

	// Cold-start 503s on Pages reach the BetterAuth client without a parsed
	// status (response body isn't JSON), so a missing status+message is the
	// signature we retry on.
	function isColdStartLike(err: unknown): boolean {
		if (!err || typeof err !== 'object') return false;
		const e = err as { status?: number; message?: string };
		if (typeof e.status === 'number' && e.status >= 500) return true;
		return e.status == null && !e.message;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isValid) return;

		error = '';
		loading = true;

		const submit = () => authClient.signIn.email({ email, password });

		let result = await submit();
		// Pages Functions can 5xx on a cold start. BetterAuth's client error
		// object doesn't expose .status on a 503 — the cold-start signature is
		// "no status AND no message". Retry on that, plus any explicit 5xx.
		if (result.error && isColdStartLike(result.error)) {
			await new Promise((r) => setTimeout(r, 600));
			result = await submit();
		}

		loading = false;

		if (result.error) {
			error = isColdStartLike(result.error)
				? 'The service is starting up — please try again in a moment.'
				: (result.error.message ?? 'Invalid email or password.');
			return;
		}

		// Hard navigation so the new BetterAuth cookie is included on the GET /
		// load — see signup/+page.svelte for the same workaround.
		window.location.assign('/');
	}
</script>

<svelte:head>
	<title>Sign In - Grande Studio</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<Card.Title class="text-2xl">Sign in</Card.Title>
			<Card.Description>Enter your email and password to continue</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={handleSubmit} class="flex flex-col gap-4">
				<div class="flex flex-col gap-2">
					<Label for="email">Email</Label>
					<Input
						id="email"
						type="email"
						placeholder="you@example.com"
						bind:value={email}
						aria-invalid={emailError ? true : undefined}
						autocomplete="email"
						required
					/>
					{#if emailError}
						<p class="text-destructive text-sm">{emailError}</p>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						type="password"
						placeholder="Your password"
						bind:value={password}
						aria-invalid={passwordError ? true : undefined}
						autocomplete="current-password"
						required
					/>
					{#if passwordError}
						<p class="text-destructive text-sm">{passwordError}</p>
					{/if}
				</div>

				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}

				<Button type="submit" disabled={!isValid || loading} class="w-full">
					{loading ? 'Signing in...' : 'Sign in'}
				</Button>
			</form>
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-muted-foreground text-sm">
				Don't have an account?
				<a href="/signup" class="text-primary underline-offset-4 hover:underline">Sign up</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
