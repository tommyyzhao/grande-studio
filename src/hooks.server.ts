import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';

/** Routes that require authentication — redirect to /signin if no session. */
const PROTECTED_PREFIXES = ['/projects'];

const TEMP_SESSION_COOKIE = 'temp_session_id';

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	// For unauthenticated users, manage a temp session cookie
	if (!event.locals.user) {
		let tempId = event.cookies.get(TEMP_SESSION_COOKIE) ?? null;

		if (!tempId) {
			tempId = crypto.randomUUID();
			// Session cookie (no maxAge/expires) — cleared when browser closes
			event.cookies.set(TEMP_SESSION_COOKIE, tempId, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false // Allow in local dev (http://localhost)
			});
		}

		event.locals.tempSessionId = tempId;
	} else {
		event.locals.tempSessionId = null;

		// Clean up temp session cookie when user is authenticated
		if (event.cookies.get(TEMP_SESSION_COOKIE)) {
			event.cookies.delete(TEMP_SESSION_COOKIE, { path: '/' });
		}
	}

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
