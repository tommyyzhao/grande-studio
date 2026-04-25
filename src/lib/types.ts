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
