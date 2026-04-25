import { describe, it, expect, beforeEach } from 'vitest';
import type { QuotaStatus } from '$lib/server/db/schema';
import {
	validateQuotaTransition,
	createQuotaService,
	QUOTA_TTL_MS,
	type QuotaRepository,
	type QuotaReservationRow,
	type NewQuotaReservation,
	type QuotaService
} from './quota';

// ─── In-Memory Repository for Testing ──────────────────────────────────────

function createInMemoryQuotaRepo(): QuotaRepository {
	const store = new Map<string, QuotaReservationRow>();
	let nextId = 1;

	return {
		async findById(id) {
			return store.get(id);
		},

		async findByIdempotencyKeyAndOwner(ownerId, idempotencyKey) {
			for (const row of store.values()) {
				if (row.ownerId === ownerId && row.idempotencyKey === idempotencyKey) {
					return row;
				}
			}
			return undefined;
		},

		async create(data: NewQuotaReservation) {
			const id = `res-${nextId++}`;
			const now = new Date();
			const row: QuotaReservationRow = {
				id,
				ownerId: data.ownerId,
				generationJobId: data.generationJobId,
				idempotencyKey: data.idempotencyKey,
				unitsReserved: data.unitsReserved,
				status: data.status,
				expiresAt: data.expiresAt,
				createdAt: now,
				updatedAt: now
			};
			store.set(id, row);
			return row;
		},

		async updateStatus(id, status) {
			const row = store.get(id);
			if (!row) return undefined;
			const updated = { ...row, status, updatedAt: new Date() };
			store.set(id, updated);
			return updated;
		},

		async findExpiredReserved(now) {
			const results: QuotaReservationRow[] = [];
			for (const row of store.values()) {
				if (row.status === 'reserved' && row.expiresAt <= now) {
					results.push(row);
				}
			}
			return results;
		},

		async countCommittedToday(ownerId, todayStartUtc) {
			let count = 0;
			for (const row of store.values()) {
				if (
					row.ownerId === ownerId &&
					row.status === 'committed' &&
					row.updatedAt > todayStartUtc
				) {
					count++;
				}
			}
			return count;
		}
	};
}

// ─── validateQuotaTransition (pure) ────────────────────────────────────────

describe('validateQuotaTransition', () => {
	describe('allowed transitions', () => {
		const allowed: [QuotaStatus, QuotaStatus][] = [
			['reserved', 'committed'],
			['reserved', 'released'],
			['reserved', 'expired']
		];

		for (const [from, to] of allowed) {
			it(`allows ${from} → ${to}`, () => {
				const result = validateQuotaTransition(from, to);
				expect(result.valid).toBe(true);
			});
		}
	});

	describe('disallowed transitions', () => {
		const disallowed: [QuotaStatus, QuotaStatus][] = [
			// committed is terminal
			['committed', 'reserved'],
			['committed', 'released'],
			['committed', 'expired'],
			// released is terminal
			['released', 'reserved'],
			['released', 'committed'],
			['released', 'expired'],
			// expired is terminal
			['expired', 'reserved'],
			['expired', 'committed'],
			['expired', 'released']
		];

		for (const [from, to] of disallowed) {
			it(`rejects ${from} → ${to}`, () => {
				const result = validateQuotaTransition(from, to);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain(from);
					expect(result.reason).toContain(to);
				}
			});
		}
	});

	describe('same-status transitions', () => {
		const statuses: QuotaStatus[] = ['reserved', 'committed', 'released', 'expired'];

		for (const status of statuses) {
			it(`rejects ${status} → ${status}`, () => {
				const result = validateQuotaTransition(status, status);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain('already');
				}
			});
		}
	});
});

// ─── Quota Service ─────────────────────────────────────────────────────────

describe('QuotaService', () => {
	let repo: QuotaRepository;
	let service: QuotaService;

	beforeEach(() => {
		repo = createInMemoryQuotaRepo();
		service = createQuotaService(repo);
	});

	describe('reserveQuota', () => {
		it('creates a reservation with reserved status', async () => {
			const result = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.reservation.ownerId).toBe('owner-1');
				expect(result.reservation.generationJobId).toBe('job-1');
				expect(result.reservation.idempotencyKey).toBe('key-1');
				expect(result.reservation.status).toBe('reserved');
				expect(result.reservation.unitsReserved).toBe(1);
			}
		});

		it('sets 10-minute TTL on expiration', async () => {
			const before = Date.now();
			const result = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			const after = Date.now();

			expect(result.ok).toBe(true);
			if (result.ok) {
				const expiresMs = result.reservation.expiresAt.getTime();
				expect(expiresMs).toBeGreaterThanOrEqual(before + QUOTA_TTL_MS);
				expect(expiresMs).toBeLessThanOrEqual(after + QUOTA_TTL_MS);
			}
		});

		it('returns existing reservation for duplicate idempotency key', async () => {
			const first = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			const second = await service.reserveQuota('owner-1', 'job-2', 'key-1');

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			if (first.ok && second.ok) {
				expect(second.reservation.id).toBe(first.reservation.id);
				expect(second.reservation.generationJobId).toBe('job-1');
			}
		});

		it('allows same idempotency key for different owners', async () => {
			const first = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			const second = await service.reserveQuota('owner-2', 'job-2', 'key-1');

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			if (first.ok && second.ok) {
				expect(second.reservation.id).not.toBe(first.reservation.id);
			}
		});

		it('creates separate reservations for different idempotency keys', async () => {
			const first = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			const second = await service.reserveQuota('owner-1', 'job-2', 'key-2');

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			if (first.ok && second.ok) {
				expect(second.reservation.id).not.toBe(first.reservation.id);
			}
		});
	});

	describe('commitQuota', () => {
		it('transitions reserved to committed', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			expect(reserve.ok).toBe(true);
			if (!reserve.ok) return;

			const result = await service.commitQuota(reserve.reservation.id);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.reservation.status).toBe('committed');
			}
		});

		it('rejects committing a released reservation', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (!reserve.ok) return;
			await service.releaseQuota(reserve.reservation.id);

			const result = await service.commitQuota(reserve.reservation.id);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('released');
				expect(result.error).toContain('committed');
			}
		});

		it('rejects committing an expired reservation', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (!reserve.ok) return;

			// Manually expire it
			await repo.updateStatus(reserve.reservation.id, 'expired');

			const result = await service.commitQuota(reserve.reservation.id);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('expired');
				expect(result.error).toContain('committed');
			}
		});

		it('rejects committing an already committed reservation', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (!reserve.ok) return;
			await service.commitQuota(reserve.reservation.id);

			const result = await service.commitQuota(reserve.reservation.id);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('already');
			}
		});

		it('returns error for non-existent reservation', async () => {
			const result = await service.commitQuota('non-existent-id');
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('not found');
			}
		});
	});

	describe('releaseQuota', () => {
		it('transitions reserved to released', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			expect(reserve.ok).toBe(true);
			if (!reserve.ok) return;

			const result = await service.releaseQuota(reserve.reservation.id);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.reservation.status).toBe('released');
			}
		});

		it('rejects releasing a committed reservation', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (!reserve.ok) return;
			await service.commitQuota(reserve.reservation.id);

			const result = await service.releaseQuota(reserve.reservation.id);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('committed');
				expect(result.error).toContain('released');
			}
		});

		it('rejects releasing an expired reservation', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (!reserve.ok) return;
			await repo.updateStatus(reserve.reservation.id, 'expired');

			const result = await service.releaseQuota(reserve.reservation.id);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('expired');
			}
		});

		it('rejects releasing an already released reservation', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (!reserve.ok) return;
			await service.releaseQuota(reserve.reservation.id);

			const result = await service.releaseQuota(reserve.reservation.id);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('already');
			}
		});

		it('returns error for non-existent reservation', async () => {
			const result = await service.releaseQuota('non-existent-id');
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('not found');
			}
		});
	});

	describe('expireStaleReservations', () => {
		it('expires reserved rows past their TTL', async () => {
			// Create a reservation with an expiration in the past
			await repo.create({
				ownerId: 'owner-1',
				generationJobId: 'job-1',
				idempotencyKey: 'key-1',
				unitsReserved: 1,
				status: 'reserved',
				expiresAt: new Date(Date.now() - 60_000) // expired 1 minute ago
			});

			const result = await service.expireStaleReservations();
			expect(result.expiredCount).toBe(1);

			// Verify the reservation is now expired
			const reservation = await repo.findByIdempotencyKeyAndOwner('owner-1', 'key-1');
			expect(reservation?.status).toBe('expired');
		});

		it('does not expire reservations still within TTL', async () => {
			await repo.create({
				ownerId: 'owner-1',
				generationJobId: 'job-1',
				idempotencyKey: 'key-1',
				unitsReserved: 1,
				status: 'reserved',
				expiresAt: new Date(Date.now() + 300_000) // 5 minutes from now
			});

			const result = await service.expireStaleReservations();
			expect(result.expiredCount).toBe(0);

			const reservation = await repo.findByIdempotencyKeyAndOwner('owner-1', 'key-1');
			expect(reservation?.status).toBe('reserved');
		});

		it('does not touch committed reservations', async () => {
			const created = await repo.create({
				ownerId: 'owner-1',
				generationJobId: 'job-1',
				idempotencyKey: 'key-1',
				unitsReserved: 1,
				status: 'reserved',
				expiresAt: new Date(Date.now() - 60_000) // expired
			});
			await repo.updateStatus(created.id, 'committed');

			const result = await service.expireStaleReservations();
			expect(result.expiredCount).toBe(0);

			const reservation = await repo.findById(created.id);
			expect(reservation?.status).toBe('committed');
		});

		it('does not touch released reservations', async () => {
			const created = await repo.create({
				ownerId: 'owner-1',
				generationJobId: 'job-1',
				idempotencyKey: 'key-1',
				unitsReserved: 1,
				status: 'reserved',
				expiresAt: new Date(Date.now() - 60_000) // expired
			});
			await repo.updateStatus(created.id, 'released');

			const result = await service.expireStaleReservations();
			expect(result.expiredCount).toBe(0);

			const reservation = await repo.findById(created.id);
			expect(reservation?.status).toBe('released');
		});

		it('expires multiple stale reservations at once', async () => {
			for (let i = 0; i < 3; i++) {
				await repo.create({
					ownerId: `owner-${i}`,
					generationJobId: `job-${i}`,
					idempotencyKey: `key-${i}`,
					unitsReserved: 1,
					status: 'reserved',
					expiresAt: new Date(Date.now() - 60_000)
				});
			}

			const result = await service.expireStaleReservations();
			expect(result.expiredCount).toBe(3);
		});
	});

	describe('checkDailyUsage', () => {
		it('returns 0 when no committed reservations exist', async () => {
			const count = await service.checkDailyUsage('owner-1');
			expect(count).toBe(0);
		});

		it('counts committed reservations for the owner', async () => {
			// Create and commit 3 reservations
			for (let i = 0; i < 3; i++) {
				const reserve = await service.reserveQuota('owner-1', `job-${i}`, `key-${i}`);
				if (reserve.ok) {
					await service.commitQuota(reserve.reservation.id);
				}
			}

			const count = await service.checkDailyUsage('owner-1');
			expect(count).toBe(3);
		});

		it('does not count reserved (non-committed) reservations', async () => {
			await service.reserveQuota('owner-1', 'job-1', 'key-1');

			const count = await service.checkDailyUsage('owner-1');
			expect(count).toBe(0);
		});

		it('does not count released reservations', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			if (reserve.ok) {
				await service.releaseQuota(reserve.reservation.id);
			}

			const count = await service.checkDailyUsage('owner-1');
			expect(count).toBe(0);
		});

		it('does not count other owners reservations', async () => {
			const reserve = await service.reserveQuota('owner-2', 'job-1', 'key-1');
			if (reserve.ok) {
				await service.commitQuota(reserve.reservation.id);
			}

			const count = await service.checkDailyUsage('owner-1');
			expect(count).toBe(0);
		});

		it('does not count expired reservations', async () => {
			const created = await repo.create({
				ownerId: 'owner-1',
				generationJobId: 'job-1',
				idempotencyKey: 'key-1',
				unitsReserved: 1,
				status: 'reserved',
				expiresAt: new Date(Date.now() - 60_000)
			});
			await repo.updateStatus(created.id, 'expired');

			const count = await service.checkDailyUsage('owner-1');
			expect(count).toBe(0);
		});
	});

	describe('full lifecycle scenarios', () => {
		it('reserve → commit is the happy path', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			expect(reserve.ok).toBe(true);
			if (!reserve.ok) return;
			expect(reserve.reservation.status).toBe('reserved');

			const commit = await service.commitQuota(reserve.reservation.id);
			expect(commit.ok).toBe(true);
			if (!commit.ok) return;
			expect(commit.reservation.status).toBe('committed');

			// Usage reflects the commit
			const usage = await service.checkDailyUsage('owner-1');
			expect(usage).toBe(1);
		});

		it('reserve → release frees the quota', async () => {
			const reserve = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			expect(reserve.ok).toBe(true);
			if (!reserve.ok) return;

			const release = await service.releaseQuota(reserve.reservation.id);
			expect(release.ok).toBe(true);
			if (!release.ok) return;
			expect(release.reservation.status).toBe('released');

			// Usage is not affected
			const usage = await service.checkDailyUsage('owner-1');
			expect(usage).toBe(0);
		});

		it('reserve → expire handles abandoned reservations', async () => {
			// Create reservation with past expiration
			const created = await repo.create({
				ownerId: 'owner-1',
				generationJobId: 'job-1',
				idempotencyKey: 'key-1',
				unitsReserved: 1,
				status: 'reserved',
				expiresAt: new Date(Date.now() - 60_000)
			});

			const result = await service.expireStaleReservations();
			expect(result.expiredCount).toBe(1);

			// Cannot commit after expiration
			const commit = await service.commitQuota(created.id);
			expect(commit.ok).toBe(false);

			// Usage is not affected
			const usage = await service.checkDailyUsage('owner-1');
			expect(usage).toBe(0);
		});

		it('idempotent reserve + commit works correctly', async () => {
			const first = await service.reserveQuota('owner-1', 'job-1', 'key-1');
			const second = await service.reserveQuota('owner-1', 'job-1', 'key-1');

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			if (!first.ok || !second.ok) return;

			// Same reservation returned
			expect(first.reservation.id).toBe(second.reservation.id);

			// Commit once
			const commit = await service.commitQuota(first.reservation.id);
			expect(commit.ok).toBe(true);

			// Only counts as 1 usage
			const usage = await service.checkDailyUsage('owner-1');
			expect(usage).toBe(1);
		});
	});
});
