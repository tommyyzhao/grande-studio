/**
 * Temp session utility for unauthenticated users.
 *
 * Generates a UUID-based session identifier stored in sessionStorage.
 * The session ID is ephemeral — cleared when the browser tab/window closes.
 * Used to associate temp project data with a browser session.
 */

const TEMP_SESSION_KEY = 'grande_temp_session_id';

/**
 * Get or create a temp session ID.
 * Returns the existing ID from sessionStorage, or generates a new one.
 */
export function getTempSessionId(): string {
	if (typeof sessionStorage === 'undefined') {
		// SSR context — return empty (server uses cookie instead)
		return '';
	}

	let id = sessionStorage.getItem(TEMP_SESSION_KEY);
	if (!id) {
		id = crypto.randomUUID();
		sessionStorage.setItem(TEMP_SESSION_KEY, id);
	}
	return id;
}

/**
 * Check if a temp session ID exists (without creating one).
 */
export function hasTempSession(): boolean {
	if (typeof sessionStorage === 'undefined') return false;
	return sessionStorage.getItem(TEMP_SESSION_KEY) !== null;
}
