<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let loading = $state(false);

	let emailError = $derived.by(() => {
		if (!email) return '';
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email) ? '' : 'Please enter a valid email address';
	});

	let passwordError = $derived.by(() => {
		if (!password) return '';
		return password.length >= 8 ? '' : 'Password must be at least 8 characters';
	});

	let confirmError = $derived.by(() => {
		if (!confirmPassword) return '';
		return confirmPassword === password ? '' : 'Passwords do not match';
	});

	let isValid = $derived(
		email.length > 0 &&
			password.length >= 8 &&
			confirmPassword === password &&
			!emailError &&
			!passwordError &&
			!confirmError
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isValid) return;

		error = '';
		loading = true;

		const result = await authClient.signUp.email({
			email,
			password,
			name: email.split('@')[0]
		});

		loading = false;

		if (result.error) {
			error = result.error.message ?? 'Sign-up failed. Please try again.';
			return;
		}

		// Hard navigation so the new BetterAuth cookie is included on the GET /
		// load. SvelteKit's goto() reuses the SPA context and the layout's
		// `data.user` was rendering as null on the first paint, leaving "Sign in"
		// visible to a freshly-signed-up user.
		window.location.assign('/');
	}
</script>

<svelte:head>
	<title>Sign Up - Grande Studio</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<Card.Title class="text-2xl">Create an account</Card.Title>
			<Card.Description>Enter your email and password to get started</Card.Description>
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
						placeholder="At least 8 characters"
						bind:value={password}
						aria-invalid={passwordError ? true : undefined}
						autocomplete="new-password"
						required
					/>
					{#if passwordError}
						<p class="text-destructive text-sm">{passwordError}</p>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					<Label for="confirm-password">Confirm password</Label>
					<Input
						id="confirm-password"
						type="password"
						placeholder="Repeat your password"
						bind:value={confirmPassword}
						aria-invalid={confirmError ? true : undefined}
						autocomplete="new-password"
						required
					/>
					{#if confirmError}
						<p class="text-destructive text-sm">{confirmError}</p>
					{/if}
				</div>

				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}

				<Button type="submit" disabled={!isValid || loading} class="w-full">
					{loading ? 'Creating account...' : 'Sign up'}
				</Button>
			</form>
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-muted-foreground text-sm">
				Already have an account?
				<a href="/signin" class="text-primary underline-offset-4 hover:underline">Sign in</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
