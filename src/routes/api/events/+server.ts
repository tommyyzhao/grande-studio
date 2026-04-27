import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { generationJobs } from '$lib/server/db/schema';
import type { JobStatus } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { gte } from 'drizzle-orm';
import { createLiveChunkReader } from '$lib/services/live-chunks';
import type { LiveChunkReader } from '$lib/services/live-chunks';
import { getEffectiveUserId } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30000;
/** Chunk polling interval — faster than DB poll for real-time feel */
const CHUNK_POLL_INTERVAL_MS = 500;
/** On first connection, look back 1 minute to catch recently-active jobs */
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

/** Tracks KV chunk polling state for a job with active live-listening */
interface LiveJobState {
	assetId: string;
	lastChunkIndex: number;
}

export const GET: RequestHandler = async (event) => {
	const { locals, request } = event;
	const env = getEnv(event);

	// 1. Validate session (authenticated user OR temp session)
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required. Please sign in or refresh the page.' });
	}

	// 2. Set up DB
	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	// 3. Set up live chunk reader (optional — requires KV binding)
	const chunkReader: LiveChunkReader | null =
		env.LIVE_KV ? createLiveChunkReader(env.LIVE_KV) : null;

	// 4. Polling state
	const knownStatuses = new Map<string, JobStatus>();
	let lastPollTime = new Date(Date.now() - INITIAL_LOOKBACK_MS);
	let closed = false;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	let chunkPollTimer: ReturnType<typeof setTimeout> | null = null;

	/** Jobs currently in receiving_audio status — tracked for chunk polling */
	const liveJobs = new Map<string, LiveJobState>();

	const encoder = new TextEncoder();

	const cleanup = () => {
		closed = true;
		if (pollTimer !== null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		if (heartbeatTimer !== null) {
			clearTimeout(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (chunkPollTimer !== null) {
			clearTimeout(chunkPollTimer);
			chunkPollTimer = null;
		}
	};

	// Listen for client disconnect via AbortSignal
	request.signal.addEventListener('abort', cleanup);

	const stream = new ReadableStream({
		start(controller) {
			// SSE comment for connection established
			controller.enqueue(encoder.encode(': connected\n\n'));
			// Tell client to retry after 3 seconds if connection drops
			controller.enqueue(encoder.encode('retry: 3000\n\n'));

			const poll = async () => {
				if (closed) return;

				try {
					// Capture the cutoff time, then advance lastPollTime.
					// Using gte (>=) + the knownStatuses map for deduplication ensures
					// we never miss a status change even on timing boundaries.
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
							const event: JobStatusEvent = {
								jobId: job.jobId,
								assetId: job.assetId,
								status: job.status,
								errorCode: job.errorCode
							};

							controller.enqueue(
								encoder.encode(
									`event: job-status\ndata: ${JSON.stringify(event)}\n\n`
								)
							);

							knownStatuses.set(job.jobId, job.status);

							// Track live jobs for chunk polling
							if (chunkReader) {
								if (job.status === 'receiving_audio' && job.assetId && !liveJobs.has(job.jobId)) {
									liveJobs.set(job.jobId, { assetId: job.assetId, lastChunkIndex: -1 });
									startChunkPolling();
								} else if (job.status !== 'receiving_audio' && liveJobs.has(job.jobId)) {
									// Job left receiving_audio — do a final chunk sweep then remove
									await flushRemainingChunks(job.jobId, controller);
									liveJobs.delete(job.jobId);
								}
							}
						}
					}
				} catch (err) {
					// Don't close connection on transient DB errors — next poll will retry
					console.error('[SSE] Poll error:', err);
				}

				if (!closed) {
					pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
				}
			};

			/** Poll KV for new audio chunks for all live jobs */
			const pollChunks = async () => {
				if (closed || liveJobs.size === 0 || !chunkReader) return;

				for (const [jobId, state] of liveJobs) {
					try {
						const meta = await chunkReader.getStreamMeta(jobId);
						if (!meta) continue;

						// Read new chunks since our last position
						for (let i = state.lastChunkIndex + 1; i < meta.chunkCount; i++) {
							const data = await chunkReader.getChunk(jobId, i);
							if (!data) break; // KV eventually consistent — chunk not yet visible

							const event: AudioChunkEvent = {
								jobId,
								assetId: state.assetId,
								chunkIndex: i,
								data,
								isFinal: meta.complete && i === meta.chunkCount - 1
							};

							controller.enqueue(
								encoder.encode(
									`event: audio-chunk\ndata: ${JSON.stringify(event)}\n\n`
								)
							);

							state.lastChunkIndex = i;
						}

						// If stream is complete and all chunks consumed, stop tracking
						if (meta.complete && state.lastChunkIndex >= meta.chunkCount - 1) {
							liveJobs.delete(jobId);
						}
					} catch (err) {
						// KV read errors are non-fatal — next poll will retry
						console.warn(`[SSE] Chunk poll error for job=${jobId}:`, err);
					}
				}

				if (!closed && liveJobs.size > 0) {
					chunkPollTimer = setTimeout(pollChunks, CHUNK_POLL_INTERVAL_MS);
				}
			};

			/** Final sweep: read any remaining chunks for a job that left receiving_audio */
			const flushRemainingChunks = async (jobId: string, ctrl: ReadableStreamDefaultController) => {
				if (!chunkReader) return;
				const state = liveJobs.get(jobId);
				if (!state) return;

				try {
					const meta = await chunkReader.getStreamMeta(jobId);
					if (!meta) return;

					for (let i = state.lastChunkIndex + 1; i < meta.chunkCount; i++) {
						const data = await chunkReader.getChunk(jobId, i);
						if (!data) break;

						const event: AudioChunkEvent = {
							jobId,
							assetId: state.assetId,
							chunkIndex: i,
							data,
							isFinal: i === meta.chunkCount - 1
						};

						ctrl.enqueue(
							encoder.encode(
								`event: audio-chunk\ndata: ${JSON.stringify(event)}\n\n`
							)
						);

						state.lastChunkIndex = i;
					}
				} catch (err) {
					console.warn(`[SSE] Flush chunks error for job=${jobId}:`, err);
				}
			};

			/** Start chunk polling if not already running */
			const startChunkPolling = () => {
				if (chunkPollTimer !== null) return; // Already running
				pollChunks();
			};

			const heartbeat = () => {
				if (closed) return;

				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					// Controller closed (client disconnected)
					cleanup();
					return;
				}

				if (!closed) {
					heartbeatTimer = setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS);
				}
			};

			// Start polling and heartbeat
			poll();
			heartbeatTimer = setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
