/**
 * Live audio chunk forwarding service.
 * Bridges the generation workflow (producer) and SSE endpoint (consumer)
 * via Cloudflare KV for real-time audio preview during generation.
 *
 * Best-effort: failures here never affect generation workflow success.
 */

// ─── KV Abstraction ──────────────────────────────────────────────────────────

/** Minimal Cloudflare KV namespace interface (avoids @cloudflare/workers-types) */
export interface KVNamespaceLike {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Metadata stored at {jobId}:meta in KV */
export interface LiveStreamMeta {
	chunkCount: number;
	complete: boolean;
}

/** TTL for KV entries — auto-cleanup after stream ends */
const CHUNK_TTL_SECONDS = 300;

// ─── Publisher (Workflow side) ────────────────────────────────────────────────

/** Publishes audio chunks to KV for live-listening consumers */
export interface LiveChunkPublisher {
	/** Write a decoded audio chunk to KV as base64 */
	publishChunk(jobId: string, chunkIndex: number, audioBytes: Uint8Array, isFinal: boolean): Promise<void>;
	/** Mark the stream as complete (final cleanup signal) */
	endStream(jobId: string): Promise<void>;
}

// ─── Reader (SSE endpoint side) ──────────────────────────────────────────────

/** Reads audio chunks from KV for forwarding to clients */
export interface LiveChunkReader {
	/** Get stream metadata (chunk count, completion status) */
	getStreamMeta(jobId: string): Promise<LiveStreamMeta | null>;
	/** Get a single chunk's base64-encoded audio data */
	getChunk(jobId: string, index: number): Promise<string | null>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Encode Uint8Array to base64 string */
function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

// ─── Factory Functions ───────────────────────────────────────────────────────

/** Create a live chunk publisher for the generation workflow */
export function createLiveChunkPublisher(kv: KVNamespaceLike): LiveChunkPublisher {
	return {
		async publishChunk(jobId, chunkIndex, audioBytes, isFinal) {
			const base64 = uint8ArrayToBase64(audioBytes);

			// Write chunk data
			await kv.put(`${jobId}:${chunkIndex}`, base64, { expirationTtl: CHUNK_TTL_SECONDS });

			// Update metadata with current chunk count
			const meta: LiveStreamMeta = {
				chunkCount: chunkIndex + 1,
				complete: isFinal
			};
			await kv.put(`${jobId}:meta`, JSON.stringify(meta), {
				expirationTtl: CHUNK_TTL_SECONDS
			});
		},

		async endStream(jobId) {
			const raw = await kv.get(`${jobId}:meta`);
			if (raw) {
				const meta: LiveStreamMeta = JSON.parse(raw);
				meta.complete = true;
				await kv.put(`${jobId}:meta`, JSON.stringify(meta), {
					expirationTtl: CHUNK_TTL_SECONDS
				});
			}
		}
	};
}

/** Create a live chunk reader for the SSE endpoint */
export function createLiveChunkReader(kv: KVNamespaceLike): LiveChunkReader {
	return {
		async getStreamMeta(jobId) {
			const raw = await kv.get(`${jobId}:meta`);
			if (!raw) return null;
			return JSON.parse(raw) as LiveStreamMeta;
		},

		async getChunk(jobId, index) {
			return kv.get(`${jobId}:${index}`);
		}
	};
}
