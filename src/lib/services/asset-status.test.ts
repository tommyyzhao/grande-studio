import { describe, it, expect } from 'vitest';
import { validateAssetTransition } from './asset-status';
import type { AssetStatus } from '$lib/server/db/schema';

describe('validateAssetTransition', () => {
	describe('allowed transitions', () => {
		const allowed: [AssetStatus, AssetStatus][] = [
			['created', 'queued'],
			['queued', 'generating'],
			['queued', 'failed'],
			['generating', 'receiving_audio'],
			['generating', 'failed'],
			['receiving_audio', 'persisting'],
			['receiving_audio', 'failed'],
			['persisting', 'ready'],
			['persisting', 'failed'],
			['ready', 'deleted'],
			['failed', 'deleted']
		];

		for (const [from, to] of allowed) {
			it(`allows ${from} → ${to}`, () => {
				const result = validateAssetTransition(from, to);
				expect(result.valid).toBe(true);
			});
		}
	});

	describe('disallowed transitions', () => {
		const disallowed: [AssetStatus, AssetStatus][] = [
			// Failed is immutable (except to deleted)
			['failed', 'queued'],
			['failed', 'generating'],
			['failed', 'receiving_audio'],
			['failed', 'persisting'],
			['failed', 'ready'],
			// Ready cannot go backwards
			['ready', 'failed'],
			['ready', 'receiving_audio'],
			['ready', 'generating'],
			['ready', 'queued'],
			['ready', 'created'],
			// Cannot skip steps
			['created', 'generating'],
			['created', 'ready'],
			['queued', 'ready'],
			['queued', 'receiving_audio'],
			['generating', 'ready'],
			['generating', 'persisting'],
			// Deleted is terminal
			['deleted', 'created'],
			['deleted', 'ready'],
			['deleted', 'failed']
		];

		for (const [from, to] of disallowed) {
			it(`rejects ${from} → ${to}`, () => {
				const result = validateAssetTransition(from, to);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain(from);
					expect(result.reason).toContain(to);
				}
			});
		}
	});

	describe('same-status transitions', () => {
		const statuses: AssetStatus[] = [
			'created',
			'queued',
			'generating',
			'receiving_audio',
			'persisting',
			'ready',
			'failed',
			'deleted'
		];

		for (const status of statuses) {
			it(`rejects ${status} → ${status}`, () => {
				const result = validateAssetTransition(status, status);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain('already');
				}
			});
		}
	});
});
