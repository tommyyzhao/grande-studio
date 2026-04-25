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
import type { JobStatus, JobStatusEvent, AudioChunkEvent } from '$lib/types';

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

/** Accumulated live audio chunks for a job */
export interface LiveAudioState {
	assetId: string;
	/** Base64-encoded audio chunks in order */
	chunks: string[];
	/** Whether all chunks have been received */
	complete: boolean;
	/** Timestamp of last chunk received */
	lastChunkAt: number;
}

type StatusListener = (event: JobStatusEvent) => void;
type ChunkListener = (event: AudioChunkEvent) => void;

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

	// Reactive state: live audio chunks per jobId
	let liveAudio = $state<Map<string, LiveAudioState>>(new Map());

	// Internal non-reactive state
	let eventSource: EventSource | null = null;
	let retryMs = INITIAL_RETRY_MS;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let intentionalClose = false;
	const listeners = new Set<StatusListener>();
	const chunkListeners = new Set<ChunkListener>();

	function handleChunkEvent(event: MessageEvent) {
		try {
			const data: AudioChunkEvent = JSON.parse(event.data);
			const next = new Map(liveAudio);
			const existing = next.get(data.jobId);

			if (existing) {
				// Ensure chunks are placed at the correct index
				existing.chunks[data.chunkIndex] = data.data;
				existing.complete = data.isFinal;
				existing.lastChunkAt = Date.now();
			} else {
				const chunks: string[] = [];
				chunks[data.chunkIndex] = data.data;
				next.set(data.jobId, {
					assetId: data.assetId,
					chunks,
					complete: data.isFinal,
					lastChunkAt: Date.now()
				});
			}

			liveAudio = next;

			// Notify chunk listeners
			for (const listener of chunkListeners) {
				listener(data);
			}
		} catch (err) {
			console.error('[SSE] Failed to parse audio-chunk event:', err);
		}
	}

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

		// Listen for named 'audio-chunk' events for live-listening
		eventSource.addEventListener('audio-chunk', handleChunkEvent);

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

	/** Subscribe to audio chunk events. Returns an unsubscribe function. */
	function onAudioChunk(listener: ChunkListener): () => void {
		chunkListeners.add(listener);
		return () => chunkListeners.delete(listener);
	}

	/** Get accumulated live audio chunks for a job */
	function getLiveAudio(jobId: string): LiveAudioState | undefined {
		return liveAudio.get(jobId);
	}

	/** Check if a job is currently receiving live audio chunks */
	function isLiveListening(jobId: string): boolean {
		const state = liveAudio.get(jobId);
		if (!state || state.complete) return false;
		// Consider "live" if we received a chunk in the last 10 seconds
		return Date.now() - state.lastChunkAt < 10_000;
	}

	/** Check if an asset's associated job is live-listening (by assetId) */
	function isAssetLive(assetId: string): boolean {
		for (const [jobId, state] of liveAudio) {
			if (state.assetId === assetId) {
				return isLiveListening(jobId);
			}
		}
		return false;
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
		/** Subscribe to audio chunk events for live-listening */
		onAudioChunk,
		/** Get accumulated live audio chunks for a job */
		getLiveAudio,
		/** Check if a job is currently receiving live audio (by jobId) */
		isLiveListening,
		/** Check if an asset has an active live-listening stream (by assetId) */
		isAssetLive,
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
		},
		/** Reactive: all live audio state */
		get liveAudio() {
			return liveAudio;
		}
	};
}

/** Singleton SSE store instance for the application */
export const sseStore = createSSEStore();
