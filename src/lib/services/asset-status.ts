import type { AssetStatus } from '$lib/server/db/schema';

export type TransitionResult =
	| { valid: true }
	| { valid: false; reason: string };

const allowedTransitions: Record<AssetStatus, readonly AssetStatus[]> = {
	created: ['queued'],
	queued: ['generating', 'failed'],
	generating: ['receiving_audio', 'failed'],
	receiving_audio: ['persisting', 'failed'],
	persisting: ['ready', 'failed'],
	ready: ['deleted'],
	failed: ['deleted'],
	deleted: []
};

export function validateAssetTransition(
	current: AssetStatus,
	next: AssetStatus
): TransitionResult {
	if (current === next) {
		return { valid: false, reason: `Asset is already in '${current}' status` };
	}

	const allowed = allowedTransitions[current];
	if (allowed.includes(next)) {
		return { valid: true };
	}

	return {
		valid: false,
		reason: `Invalid asset status transition: '${current}' → '${next}'`
	};
}
