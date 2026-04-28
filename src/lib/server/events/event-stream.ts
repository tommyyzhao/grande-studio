/**
 * Shared SSE polling loop used by both Pages /api/events (dev) and the
 * standalone Worker /api/events (prod). The stream:
 *
 *   - polls `generation_jobs` (RLS-scoped to userId) every POLL_INTERVAL_MS
 *     and emits `job-status` events when a row's status changes
 *   - while a job is in `receiving_audio`, polls KV chunk meta every
 *     CHUNK_POLL_INTERVAL_MS and emits `audio-chunk` events for new chunks
 *   - emits an SSE comment heartbeat every HEARTBEAT_INTERVAL_MS so client
 *     proxies don't drop the connection
 *   - cleans up timers on `signal.aborted` (client disconnect)
 *
 * Kept off the SvelteKit RequestEvent type so the Worker can call it with
 * its own (Database, R2, KV, signal) inputs.
 */
import { gte } from 'drizzle-orm';
import { generationJobs } from '$lib/server/db/schema';
import type { JobStatus } from '$lib/server/db/schema';
import type { Database } from '$lib/server/db';
import { withRLS } from '$lib/server/db/rls';
import { createLiveChunkReader } from '$lib/services/live-chunks';
import type { LiveChunkReader, KVNamespaceLike } from '$lib/services/live-chunks';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30000;
const CHUNK_POLL_INTERVAL_MS = 500;
const INITIAL_LOOKBACK_MS = 60_000;

interface JobStatusEvent {
	jobId: string;
	assetId: string | null;
	status: JobStatus;
	errorCode: string | null;
}

interface AudioChunkEvent {
	jobId: string;
	assetId: string;
	chunkIndex: number;
	data: string;
	isFinal: boolean;
}

interface LiveJobState {
	assetId: string;
	lastChunkIndex: number;
}

export interface BuildEventStreamOptions {
	db: Database;
	userId: string;
	liveKv?: KVNamespaceLike;
	signal: AbortSignal;
}

/**
 * Returns a `ReadableStream<Uint8Array>` of SSE-encoded events for the given
 * user. Caller wraps it in a `Response` with `Content-Type: text/event-stream`.
 */
export function buildEventStream(opts: BuildEventStreamOptions): ReadableStream<Uint8Array> {
	const { db, userId, signal } = opts;
	const chunkReader: LiveChunkReader | null = opts.liveKv
		? createLiveChunkReader(opts.liveKv)
		: null;

	const knownStatuses = new Map<string, JobStatus>();
	const liveJobs = new Map<string, LiveJobState>();
	let lastPollTime = new Date(Date.now() - INITIAL_LOOKBACK_MS);
	let closed = false;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	let chunkPollTimer: ReturnType<typeof setTimeout> | null = null;

	const encoder = new TextEncoder();

	const cleanup = () => {
		closed = true;
		if (pollTimer !== null) clearTimeout(pollTimer);
		if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
		if (chunkPollTimer !== null) clearTimeout(chunkPollTimer);
		pollTimer = heartbeatTimer = chunkPollTimer = null;
	};

	signal.addEventListener('abort', cleanup);

	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(': connected\n\n'));
			controller.enqueue(encoder.encode('retry: 3000\n\n'));

			const flushRemainingChunks = async (jobId: string) => {
				if (!chunkReader) return;
				const state = liveJobs.get(jobId);
				if (!state) return;

				try {
					const meta = await chunkReader.getStreamMeta(jobId);
					if (!meta) return;

					for (let i = state.lastChunkIndex + 1; i < meta.chunkCount; i++) {
						const data = await chunkReader.getChunk(jobId, i);
						if (!data) break;

						const evt: AudioChunkEvent = {
							jobId,
							assetId: state.assetId,
							chunkIndex: i,
							data,
							isFinal: i === meta.chunkCount - 1
						};
						controller.enqueue(
							encoder.encode(`event: audio-chunk\ndata: ${JSON.stringify(evt)}\n\n`)
						);
						state.lastChunkIndex = i;
					}
				} catch (err) {
					console.warn(`[SSE] Flush chunks error for job=${jobId}:`, err);
				}
			};

			const pollChunks = async () => {
				if (closed || liveJobs.size === 0 || !chunkReader) return;

				for (const [jobId, state] of liveJobs) {
					try {
						const meta = await chunkReader.getStreamMeta(jobId);
						if (!meta) continue;

						for (let i = state.lastChunkIndex + 1; i < meta.chunkCount; i++) {
							const data = await chunkReader.getChunk(jobId, i);
							if (!data) break;

							const evt: AudioChunkEvent = {
								jobId,
								assetId: state.assetId,
								chunkIndex: i,
								data,
								isFinal: meta.complete && i === meta.chunkCount - 1
							};
							controller.enqueue(
								encoder.encode(`event: audio-chunk\ndata: ${JSON.stringify(evt)}\n\n`)
							);
							state.lastChunkIndex = i;
						}

						if (meta.complete && state.lastChunkIndex >= meta.chunkCount - 1) {
							liveJobs.delete(jobId);
						}
					} catch (err) {
						console.warn(`[SSE] Chunk poll error for job=${jobId}:`, err);
					}
				}

				if (!closed && liveJobs.size > 0) {
					chunkPollTimer = setTimeout(pollChunks, CHUNK_POLL_INTERVAL_MS);
				}
			};

			const startChunkPolling = () => {
				if (chunkPollTimer !== null) return;
				pollChunks();
			};

			const poll = async () => {
				if (closed) return;

				try {
					const cutoff = lastPollTime;
					lastPollTime = new Date();

					const jobs = await withRLS(db, userId, async (tx) => {
						return tx
							.select({
								jobId: generationJobs.id,
								status: generationJobs.status,
								assetId: generationJobs.resultingAssetId,
								errorCode: generationJobs.errorCode
							})
							.from(generationJobs)
							.where(gte(generationJobs.updatedAt, cutoff));
					});

					for (const job of jobs) {
						const known = knownStatuses.get(job.jobId);
						if (known !== job.status) {
							const evt: JobStatusEvent = {
								jobId: job.jobId,
								assetId: job.assetId,
								status: job.status,
								errorCode: job.errorCode
							};
							controller.enqueue(
								encoder.encode(`event: job-status\ndata: ${JSON.stringify(evt)}\n\n`)
							);
							knownStatuses.set(job.jobId, job.status);

							if (chunkReader) {
								if (
									job.status === 'receiving_audio' &&
									job.assetId &&
									!liveJobs.has(job.jobId)
								) {
									liveJobs.set(job.jobId, {
										assetId: job.assetId,
										lastChunkIndex: -1
									});
									startChunkPolling();
								} else if (job.status !== 'receiving_audio' && liveJobs.has(job.jobId)) {
									await flushRemainingChunks(job.jobId);
									liveJobs.delete(job.jobId);
								}
							}
						}
					}
				} catch (err) {
					console.error('[SSE] Poll error:', err);
				}

				if (!closed) {
					pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
				}
			};

			const heartbeat = () => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					cleanup();
					return;
				}
				if (!closed) {
					heartbeatTimer = setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS);
				}
			};

			poll();
			heartbeatTimer = setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS);
		},
		cancel() {
			cleanup();
		}
	});
}
