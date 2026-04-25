import type { JobStatus } from '$lib/server/db/schema';

export type TransitionResult =
	| { valid: true }
	| { valid: false; reason: string };

const allowedTransitions: Record<JobStatus, readonly JobStatus[]> = {
	created: ['queued'],
	queued: ['generating', 'cancelled'],
	generating: ['receiving_audio', 'failed'],
	receiving_audio: ['persisting', 'failed'],
	persisting: ['succeeded', 'failed'],
	succeeded: [],
	failed: [],
	cancelled: []
};

export function validateJobTransition(
	current: JobStatus,
	next: JobStatus
): TransitionResult {
	if (current === next) {
		return { valid: false, reason: `Job is already in '${current}' status` };
	}

	const allowed = allowedTransitions[current];
	if (allowed.includes(next)) {
		return { valid: true };
	}

	return {
		valid: false,
		reason: `Invalid job status transition: '${current}' → '${next}'`
	};
}
