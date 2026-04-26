import type { QuotaStatus } from '$lib/server/db/schema';
import { quotaReservations } from '$lib/server/db/schema';
import { eq, and, sql, lte, gt } from 'drizzle-orm';
import type { Database } from '$lib/server/db/index';

// ─── Transition Validation (pure) ──────────────────────────────────────────

export type TransitionResult = { valid: true } | { valid: false; reason: string };

const allowedTransitions: Record<QuotaStatus, readonly QuotaStatus[]> = {
	reserved: ['committed', 'released', 'expired'],
	committed: [],
	released: [],
	expired: []
};

export function validateQuotaTransition(
	current: QuotaStatus,
	next: QuotaStatus
): TransitionResult {
	if (current === next) {
		return { valid: false, reason: `Quota reservation is already in '${current}' status` };
	}

	const allowed = allowedTransitions[current];
	if (allowed.includes(next)) {
		return { valid: true };
	}

	return {
		valid: false,
		reason: `Invalid quota status transition: '${current}' → '${next}'`
	};
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const QUOTA_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DAILY_LIMIT = 10;
export const TEMP_SESSION_LIMIT = 3;

// ─── Repository Interface ──────────────────────────────────────────────────

export interface QuotaReservationRow {
	id: string;
	ownerId: string;
	generationJobId: string | null;
	idempotencyKey: string;
	unitsReserved: number;
	status: QuotaStatus;
	expiresAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface NewQuotaReservation {
	ownerId: string;
	generationJobId: string | null;
	idempotencyKey: string;
	unitsReserved: number;
	status: QuotaStatus;
	expiresAt: Date;
}

export interface QuotaRepository {
	findById(id: string): Promise<QuotaReservationRow | undefined>;
	findByIdempotencyKeyAndOwner(
		ownerId: string,
		idempotencyKey: string
	): Promise<QuotaReservationRow | undefined>;
	create(data: NewQuotaReservation): Promise<QuotaReservationRow>;
	updateStatus(id: string, status: QuotaStatus): Promise<QuotaReservationRow | undefined>;
	findExpiredReserved(now: Date): Promise<QuotaReservationRow[]>;
	countCommittedToday(ownerId: string, todayStartUtc: Date): Promise<number>;
}

// ─── Service ───────────────────────────────────────────────────────────────

export type QuotaServiceResult =
	| { ok: true; reservation: QuotaReservationRow }
	| { ok: false; error: string };

export interface QuotaService {
	reserveQuota(
		ownerId: string,
		jobId: string,
		idempotencyKey: string
	): Promise<QuotaServiceResult>;
	commitQuota(reservationId: string): Promise<QuotaServiceResult>;
	releaseQuota(reservationId: string): Promise<QuotaServiceResult>;
	expireStaleReservations(): Promise<{ expiredCount: number }>;
	checkDailyUsage(ownerId: string): Promise<number>;
}

export function createQuotaService(repo: QuotaRepository): QuotaService {
	return {
		async reserveQuota(ownerId, jobId, idempotencyKey) {
			// Idempotency: return existing reservation if same key+owner
			const existing = await repo.findByIdempotencyKeyAndOwner(ownerId, idempotencyKey);
			if (existing) {
				return { ok: true, reservation: existing };
			}

			const now = new Date();
			const expiresAt = new Date(now.getTime() + QUOTA_TTL_MS);

			const reservation = await repo.create({
				ownerId,
				generationJobId: jobId,
				idempotencyKey,
				unitsReserved: 1,
				status: 'reserved',
				expiresAt
			});

			return { ok: true, reservation };
		},

		async commitQuota(reservationId) {
			const reservation = await repo.findById(reservationId);
			if (!reservation) {
				return { ok: false, error: `Quota reservation '${reservationId}' not found` };
			}

			const transition = validateQuotaTransition(reservation.status, 'committed');
			if (!transition.valid) {
				return { ok: false, error: transition.reason };
			}

			const updated = await repo.updateStatus(reservationId, 'committed');
			if (!updated) {
				return { ok: false, error: `Failed to update reservation '${reservationId}'` };
			}

			return { ok: true, reservation: updated };
		},

		async releaseQuota(reservationId) {
			const reservation = await repo.findById(reservationId);
			if (!reservation) {
				return { ok: false, error: `Quota reservation '${reservationId}' not found` };
			}

			const transition = validateQuotaTransition(reservation.status, 'released');
			if (!transition.valid) {
				return { ok: false, error: transition.reason };
			}

			const updated = await repo.updateStatus(reservationId, 'released');
			if (!updated) {
				return { ok: false, error: `Failed to update reservation '${reservationId}'` };
			}

			return { ok: true, reservation: updated };
		},

		async expireStaleReservations() {
			const now = new Date();
			const expired = await repo.findExpiredReserved(now);

			let expiredCount = 0;
			for (const reservation of expired) {
				const updated = await repo.updateStatus(reservation.id, 'expired');
				if (updated) {
					expiredCount++;
				}
			}

			return { expiredCount };
		},

		async checkDailyUsage(ownerId) {
			const now = new Date();
			const todayStartUtc = new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
			);
			return repo.countCommittedToday(ownerId, todayStartUtc);
		}
	};
}

// ─── Drizzle Repository ────────────────────────────────────────────────────

export function createDrizzleQuotaRepository(db: Database): QuotaRepository {
	function rowToReservation(row: typeof quotaReservations.$inferSelect): QuotaReservationRow {
		return {
			id: row.id,
			ownerId: row.ownerId,
			generationJobId: row.generationJobId,
			idempotencyKey: row.idempotencyKey,
			unitsReserved: row.unitsReserved,
			status: row.status as QuotaStatus,
			expiresAt: row.expiresAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	}

	return {
		async findById(id) {
			const rows = await db
				.select()
				.from(quotaReservations)
				.where(eq(quotaReservations.id, id))
				.limit(1);
			return rows[0] ? rowToReservation(rows[0]) : undefined;
		},

		async findByIdempotencyKeyAndOwner(ownerId, idempotencyKey) {
			const rows = await db
				.select()
				.from(quotaReservations)
				.where(
					and(
						eq(quotaReservations.ownerId, ownerId),
						eq(quotaReservations.idempotencyKey, idempotencyKey)
					)
				)
				.limit(1);
			return rows[0] ? rowToReservation(rows[0]) : undefined;
		},

		async create(data) {
			const rows = await db
				.insert(quotaReservations)
				.values({
					ownerId: data.ownerId,
					generationJobId: data.generationJobId,
					idempotencyKey: data.idempotencyKey,
					unitsReserved: data.unitsReserved,
					status: data.status,
					expiresAt: data.expiresAt
				})
				.returning();
			return rowToReservation(rows[0]);
		},

		async updateStatus(id, status) {
			const rows = await db
				.update(quotaReservations)
				.set({ status, updatedAt: new Date() })
				.where(eq(quotaReservations.id, id))
				.returning();
			return rows[0] ? rowToReservation(rows[0]) : undefined;
		},

		async findExpiredReserved(now) {
			const rows = await db
				.select()
				.from(quotaReservations)
				.where(
					and(
						eq(quotaReservations.status, 'reserved'),
						lte(quotaReservations.expiresAt, now)
					)
				);
			return rows.map(rowToReservation);
		},

		async countCommittedToday(ownerId, todayStartUtc) {
			const rows = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(quotaReservations)
				.where(
					and(
						eq(quotaReservations.ownerId, ownerId),
						eq(quotaReservations.status, 'committed'),
						gt(quotaReservations.updatedAt, todayStartUtc)
					)
				);
			return rows[0]?.count ?? 0;
		}
	};
}
