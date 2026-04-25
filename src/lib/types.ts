/**
 * Client-safe types shared between server and client code.
 * These mirror the server-side schema enums but are importable from client code.
 */

export type AssetStatus =
	| 'created'
	| 'queued'
	| 'generating'
	| 'receiving_audio'
	| 'persisting'
	| 'ready'
	| 'failed'
	| 'deleted';

export type JobStatus =
	| 'created'
	| 'queued'
	| 'generating'
	| 'receiving_audio'
	| 'persisting'
	| 'succeeded'
	| 'failed'
	| 'cancelled';

/** SSE job-status event payload (matches server-side JobStatusEvent) */
export interface JobStatusEvent {
	jobId: string;
	assetId: string | null;
	status: JobStatus;
	errorCode: string | null;
}

/** Client-side representation of an audio asset for block cards */
export interface BlockAsset {
	id: string;
	title: string;
	prompt: string | null;
	durationSec: number | null;
	provider: string;
	format: string | null;
	status: AssetStatus;
	createdAt: string;
}

/** SSE audio-chunk event payload for live-listening */
export interface AudioChunkEvent {
	jobId: string;
	assetId: string;
	chunkIndex: number;
	/** Base64-encoded audio bytes */
	data: string;
	isFinal: boolean;
}
