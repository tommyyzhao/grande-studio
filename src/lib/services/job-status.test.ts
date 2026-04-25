import { describe, it, expect } from 'vitest';
import { validateJobTransition } from './job-status';
import type { JobStatus } from '$lib/server/db/schema';

describe('validateJobTransition', () => {
	describe('allowed transitions', () => {
		const allowed: [JobStatus, JobStatus][] = [
			['created', 'queued'],
			['queued', 'generating'],
			['queued', 'cancelled'],
			['generating', 'receiving_audio'],
			['generating', 'failed'],
			['receiving_audio', 'persisting'],
			['receiving_audio', 'failed'],
			['persisting', 'succeeded'],
			['persisting', 'failed']
		];

		for (const [from, to] of allowed) {
			it(`allows ${from} → ${to}`, () => {
				const result = validateJobTransition(from, to);
				expect(result.valid).toBe(true);
			});
		}
	});

	describe('disallowed transitions', () => {
		const disallowed: [JobStatus, JobStatus][] = [
			// Failed is immutable
			['failed', 'queued'],
			['failed', 'generating'],
			['failed', 'receiving_audio'],
			['failed', 'persisting'],
			['failed', 'succeeded'],
			['failed', 'created'],
			// Succeeded is immutable
			['succeeded', 'failed'],
			['succeeded', 'generating'],
			['succeeded', 'queued'],
			['succeeded', 'created'],
			// Cancelled is immutable
			['cancelled', 'generating'],
			['cancelled', 'queued'],
			['cancelled', 'created'],
			['cancelled', 'failed'],
			// Cannot skip steps
			['created', 'generating'],
			['created', 'succeeded'],
			['queued', 'succeeded'],
			['queued', 'receiving_audio'],
			['generating', 'succeeded'],
			['generating', 'persisting'],
			// Cannot go backwards
			['receiving_audio', 'generating'],
			['receiving_audio', 'queued'],
			['persisting', 'receiving_audio'],
			['persisting', 'generating']
		];

		for (const [from, to] of disallowed) {
			it(`rejects ${from} → ${to}`, () => {
				const result = validateJobTransition(from, to);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain(from);
					expect(result.reason).toContain(to);
				}
			});
		}
	});

	describe('same-status transitions', () => {
		const statuses: JobStatus[] = [
			'created',
			'queued',
			'generating',
			'receiving_audio',
			'persisting',
			'succeeded',
			'failed',
			'cancelled'
		];

		for (const status of statuses) {
			it(`rejects ${status} → ${status}`, () => {
				const result = validateJobTransition(status, status);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain('already');
				}
			});
		}
	});
});
