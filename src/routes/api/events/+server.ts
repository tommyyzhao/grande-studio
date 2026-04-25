import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { generationJobs } from '$lib/server/db/schema';
import type { JobStatus } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { gte } from 'drizzle-orm';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30000;
/** On first connection, look back 1 minute to catch recently-active jobs */
const INITIAL_LOOKBACK_MS = 60_000;

interface JobStatusEvent {
	jobId: string;
	assetId: string | null;
	status: JobStatus;
	errorCode: string | null;
}

export const GET: RequestHandler = async ({ locals, request }) => {
	// 1. Validate session (reject unauthenticated)
	// Note: temp session support will be added in US-062
	if (!locals.user) {
		error(401, { message: 'Authentication required. Please sign in to receive updates.' });
	}

	const userId = locals.user.id;

	// 2. Set up DB
	const dbUrl = process.env.DATABASE_URL ?? '';
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	// 3. Polling state
	const knownStatuses = new Map<string, JobStatus>();
	let lastPollTime = new Date(Date.now() - INITIAL_LOOKBACK_MS);
	let closed = false;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

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
