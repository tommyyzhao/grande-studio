/**
 * Client-side SSE consumer module.
 * Connects to /api/events, parses job-status events, and exposes reactive state
 * that block cards and other UI components can consume.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Cleanup on disconnect
 * - Svelte 5 runes for reactive status tracking
 */
import type { JobStatus, JobStatusEvent } from '$lib/types';

// ─── Backoff constants ──────────────────────────────────────────────────────
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JobState {
	jobId: string;
	assetId: string | null;
	status: JobStatus;
	errorCode: string | null;
	updatedAt: number; // timestamp ms
}

type StatusListener = (event: JobStatusEvent) => void;

// ─── SSE Store ──────────────────────────────────────────────────────────────

/**
 * Creates an SSE consumer store. Call connect() to start receiving events,
 * disconnect() to stop. The store is reactive via Svelte 5 runes.
 */
export function createSSEStore() {
	// Reactive state: map of jobId → JobState
	let jobs = $state<Map<string, JobState>>(new Map());
	let connected = $state(false);
	let reconnecting = $state(false);

	// Internal non-reactive state
	let eventSource: EventSource | null = null;
	let retryMs = INITIAL_RETRY_MS;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let intentionalClose = false;
	const listeners = new Set<StatusListener>();

	function handleEvent(event: MessageEvent) {
		try {
			const data: JobStatusEvent = JSON.parse(event.data);
			const state: JobState = {
				jobId: data.jobId,
				assetId: data.assetId,
				status: data.status,
				errorCode: data.errorCode,
				updatedAt: Date.now()
			};

			// Update the reactive map (create new Map for reactivity trigger)
			const next = new Map(jobs);
			next.set(data.jobId, state);
			jobs = next;

			// Notify listeners
			for (const listener of listeners) {
				listener(data);
			}
		} catch (err) {
			console.error('[SSE] Failed to parse event:', err);
		}
	}

	function scheduleReconnect() {
		if (intentionalClose) return;

		reconnecting = true;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			if (!intentionalClose) {
				doConnect();
			}
		}, retryMs);

		// Exponential backoff with cap
		retryMs = Math.min(retryMs * BACKOFF_MULTIPLIER, MAX_RETRY_MS);
	}

	function doConnect() {
		// Clean up any existing connection
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}

		eventSource = new EventSource('/api/events');

		eventSource.addEventListener('open', () => {
			connected = true;
			reconnecting = false;
			// Reset backoff on successful connection
			retryMs = INITIAL_RETRY_MS;
		});

		// Listen for named 'job-status' events (not generic 'message')
		eventSource.addEventListener('job-status', handleEvent);

		eventSource.addEventListener('error', () => {
			connected = false;

			if (eventSource) {
				eventSource.close();
				eventSource = null;
			}

			scheduleReconnect();
		});
	}

	function connect() {
		intentionalClose = false;
		reconnecting = false;
		retryMs = INITIAL_RETRY_MS;
		doConnect();
	}

	function disconnect() {
		intentionalClose = true;
		connected = false;
		reconnecting = false;

		if (retryTimer !== null) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}

		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	}

	/** Get the current status of a specific job */
	function getJobStatus(jobId: string): JobState | undefined {
		return jobs.get(jobId);
	}

	/** Get the current status of the asset associated with a job */
	function getAssetStatus(assetId: string): JobStatus | undefined {
		for (const job of jobs.values()) {
			if (job.assetId === assetId) {
				return job.status;
			}
		}
		return undefined;
	}

	/**
	 * Manually set a job's status (e.g., after a successful generate POST
	 * returns the jobId/assetId, set it to 'created'/'queued' immediately
	 * so the UI shows it before the next SSE poll).
	 */
	function setJobStatus(event: JobStatusEvent) {
		const state: JobState = {
			jobId: event.jobId,
			assetId: event.assetId,
			status: event.status,
			errorCode: event.errorCode,
			updatedAt: Date.now()
		};
		const next = new Map(jobs);
		next.set(event.jobId, state);
		jobs = next;
	}

	/** Subscribe to status change events. Returns an unsubscribe function. */
	function onStatusChange(listener: StatusListener): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	return {
		/** Connect to the SSE endpoint. Call from workspace onMount. */
		connect,
		/** Disconnect from the SSE endpoint. Call on navigation away or onDestroy. */
		disconnect,
		/** Look up a job's current state by jobId */
		getJobStatus,
		/** Look up the most recent job status for an asset by assetId */
		getAssetStatus,
		/** Manually set a job's status (for optimistic UI updates) */
		setJobStatus,
		/** Subscribe to status change events */
		onStatusChange,
		/** Reactive: all tracked jobs */
		get jobs() {
			return jobs;
		},
		/** Reactive: whether the SSE connection is open */
		get connected() {
			return connected;
		},
		/** Reactive: whether we're waiting to reconnect */
		get reconnecting() {
			return reconnecting;
		}
	};
}

/** Singleton SSE store instance for the application */
export const sseStore = createSSEStore();
