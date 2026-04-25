import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';

/** Routes that require authentication — redirect to /signin if no session. */
const PROTECTED_PREFIXES = ['/projects'];

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	// Guard protected routes
	if (!event.locals.user) {
		const isProtected = PROTECTED_PREFIXES.some((prefix) =>
			event.url.pathname.startsWith(prefix)
		);
		if (isProtected) {
			redirect(303, '/signin');
		}
	}

	return resolve(event);
};
