import { auth } from '$lib/server/auth';
import { toSvelteKitHandler } from 'better-auth/svelte-kit';

const handleAuth = toSvelteKitHandler(auth);

export const GET = handleAuth;
export const POST = handleAuth;
