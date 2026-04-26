/**
 * Extract the effective user ID from request locals.
 * Returns the authenticated user's ID, or the temp session ID for unauthenticated users.
 * Returns null if neither is available.
 */
export function getEffectiveUserId(locals: App.Locals): string | null {
	return locals.user?.id ?? locals.tempSessionId ?? null;
}

/**
 * Check if the current request is from a temp (unauthenticated) session.
 */
export function isTempSession(locals: App.Locals): boolean {
	return !locals.user && !!locals.tempSessionId;
}
