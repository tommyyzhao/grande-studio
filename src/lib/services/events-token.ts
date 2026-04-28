/**
 * Short-lived HMAC tokens for the cross-origin SSE endpoint.
 *
 * Pages (cookie-authed) mints a token via /api/events/token; the standalone
 * Worker hosting /api/events accepts the token in the query string and runs
 * RLS against the embedded user id. Avoids the cookie-cross-site problem
 * without a custom domain. Same `R2_SIGNING_SECRET` that signs audio URLs
 * is reused, so no extra secret rotation surface.
 *
 * Token shape: `<userId>.<expiresAt>.<hmacHex>` — userId can be a real
 * BetterAuth id (32 chars text) or a temp session id; both treat the value
 * as opaque for RLS purposes.
 */
const DEFAULT_TTL_SEC = 600;

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function signPayload(secret: string, payload: string): Promise<string> {
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return bytesToHex(new Uint8Array(sig));
}

export interface EventsToken {
	token: string;
	expiresAt: number;
}

export async function signEventsToken(
	userId: string,
	secret: string,
	ttlSec: number = DEFAULT_TTL_SEC
): Promise<EventsToken> {
	const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
	const payload = `${userId}.${expiresAt}`;
	const sig = await signPayload(secret, payload);
	return { token: `${payload}.${sig}`, expiresAt };
}

export interface VerifiedEventsToken {
	userId: string;
	expiresAt: number;
}

export async function verifyEventsToken(
	token: string,
	secret: string
): Promise<VerifiedEventsToken | null> {
	const parts = token.split('.');
	if (parts.length !== 3) return null;

	const [userId, expiresAtStr, sig] = parts;
	const expiresAt = Number(expiresAtStr);
	if (!userId || !Number.isFinite(expiresAt)) return null;
	if (Math.floor(Date.now() / 1000) > expiresAt) return null;

	const expected = await signPayload(secret, `${userId}.${expiresAtStr}`);
	if (expected.length !== sig.length) return null;

	let result = 0;
	for (let i = 0; i < expected.length; i++) {
		result |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
	}
	if (result !== 0) return null;

	return { userId, expiresAt };
}
