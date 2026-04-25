// ─── R2 Bucket Abstraction ────────────────────────────────────────────────
// Minimal interface matching the subset of Cloudflare R2Bucket API we use.
// The real R2Bucket binding satisfies this interface at runtime.

interface R2PutOptions {
	httpMetadata?: { contentType?: string };
}

interface R2GetResult {
	arrayBuffer(): Promise<ArrayBuffer>;
	httpMetadata?: { contentType?: string };
}

export interface R2BucketLike {
	put(
		key: string,
		value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
		options?: R2PutOptions
	): Promise<unknown>;
	get(key: string): Promise<R2GetResult | null>;
	delete(key: string | string[]): Promise<void>;
}

// ─── Service Interface ────────────────────────────────────────────────────

export interface R2StorageService {
	uploadAudio(objectKey: string, bytes: Uint8Array | ArrayBuffer, contentType: string): Promise<void>;
	getSignedUrl(objectKey: string, expiresIn?: number): Promise<string>;
	deleteObject(objectKey: string): Promise<void>;
}

// ─── Object Key Builder ───────────────────────────────────────────────────

export function buildObjectKey(
	ownerId: string,
	projectId: string,
	assetId: string,
	ext: string
): string {
	return `${ownerId}/${projectId}/${assetId}.${ext}`;
}

// ─── URL Signing ──────────────────────────────────────────────────────────

const DEFAULT_EXPIRES_SEC = 3600; // 1 hour

async function createHmacKey(secret: string): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
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

export async function signUrlParams(
	secret: string,
	objectKey: string,
	expiresAt: number
): Promise<string> {
	const key = await createHmacKey(secret);
	const data = new TextEncoder().encode(`${objectKey}:${expiresAt}`);
	const signature = await crypto.subtle.sign('HMAC', key, data);
	return bytesToHex(new Uint8Array(signature));
}

export async function verifyUrlSignature(
	secret: string,
	objectKey: string,
	expiresAt: number,
	signature: string
): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000);
	if (now > expiresAt) return false;

	const expected = await signUrlParams(secret, objectKey, expiresAt);
	if (expected.length !== signature.length) return false;

	// Constant-time comparison
	let result = 0;
	for (let i = 0; i < expected.length; i++) {
		result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return result === 0;
}

// ─── Service Factory ──────────────────────────────────────────────────────

export function createR2StorageService(
	bucket: R2BucketLike,
	signingSecret: string,
	baseUrl: string
): R2StorageService {
	return {
		async uploadAudio(objectKey, bytes, contentType) {
			await bucket.put(objectKey, bytes, {
				httpMetadata: { contentType }
			});
		},

		async getSignedUrl(objectKey, expiresIn = DEFAULT_EXPIRES_SEC) {
			const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
			const sig = await signUrlParams(signingSecret, objectKey, expiresAt);
			const params = new URLSearchParams({
				key: objectKey,
				expires: String(expiresAt),
				sig
			});
			return `${baseUrl}/api/audio/serve?${params.toString()}`;
		},

		async deleteObject(objectKey) {
			await bucket.delete(objectKey);
		}
	};
}
