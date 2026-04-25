import type { BranchType } from '$lib/server/db/schema';
import { takeEdges } from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from '$lib/server/db/index';

// ─── Row Types ────────────────────────────────────────────────────────────

export interface TakeEdgeRow {
	id: string;
	projectId: string;
	ownerId: string;
	parentAssetId: string;
	childAssetId: string;
	branchType: BranchType;
	branchPrompt: string | null;
	createdAt: Date;
	deletedAt: Date | null;
}

export interface NewTakeEdge {
	projectId: string;
	ownerId: string;
	parentAssetId: string;
	childAssetId: string;
	branchType: BranchType;
	branchPrompt: string | null;
}

// ─── Repository Interface ─────────────────────────────────────────────────

export interface TakeEdgeRepository {
	create(data: NewTakeEdge): Promise<TakeEdgeRow>;
	findByParent(parentAssetId: string): Promise<TakeEdgeRow[]>;
	findByChild(childAssetId: string): Promise<TakeEdgeRow[]>;
	findAllActive(): Promise<TakeEdgeRow[]>;
	softDeleteByAssetId(assetId: string): Promise<number>;
}

// ─── Service ──────────────────────────────────────────────────────────────

export type TakeEdgeServiceResult =
	| { ok: true; edge: TakeEdgeRow }
	| { ok: false; error: string };

export interface TakeEdgeService {
	createEdge(
		projectId: string,
		ownerId: string,
		parentAssetId: string,
		childAssetId: string,
		branchType: BranchType,
		branchPrompt?: string
	): Promise<TakeEdgeServiceResult>;
	getChildren(assetId: string): Promise<TakeEdgeRow[]>;
	getParents(assetId: string): Promise<TakeEdgeRow[]>;
	softDeleteEdgesForAsset(assetId: string): Promise<{ deletedCount: number }>;
}

export function createTakeEdgeService(repo: TakeEdgeRepository): TakeEdgeService {
	return {
		async createEdge(projectId, ownerId, parentAssetId, childAssetId, branchType, branchPrompt) {
			// Self-edge check
			if (parentAssetId === childAssetId) {
				return { ok: false, error: 'Cannot create edge from an asset to itself' };
			}

			// Cycle detection: BFS from childAssetId following parent→child edges
			// to see if parentAssetId is reachable (would form a cycle)
			const hasCycle = await detectCycle(repo, childAssetId, parentAssetId);
			if (hasCycle) {
				return {
					ok: false,
					error: `Cycle detected: adding edge ${parentAssetId} → ${childAssetId} would create a cycle`
				};
			}

			const edge = await repo.create({
				projectId,
				ownerId,
				parentAssetId,
				childAssetId,
				branchType,
				branchPrompt: branchPrompt ?? null
			});

			return { ok: true, edge };
		},

		async getChildren(assetId) {
			return repo.findByParent(assetId);
		},

		async getParents(assetId) {
			return repo.findByChild(assetId);
		},

		async softDeleteEdgesForAsset(assetId) {
			const deletedCount = await repo.softDeleteByAssetId(assetId);
			return { deletedCount };
		}
	};
}

// ─── Cycle Detection ──────────────────────────────────────────────────────

/**
 * BFS from `startAssetId` following child→parent edges (via findByChild)
 * to check if `targetAssetId` is reachable. If the child of the proposed
 * edge can reach the parent via existing edges, adding the edge would
 * create a cycle.
 *
 * We traverse: from childAssetId, find its children (where it's a parent),
 * and check if any descendant is the parentAssetId.
 */
async function detectCycle(
	repo: TakeEdgeRepository,
	childAssetId: string,
	parentAssetId: string
): Promise<boolean> {
	const visited = new Set<string>();
	const queue: string[] = [childAssetId];

	while (queue.length > 0) {
		const current = queue.shift()!;

		if (current === parentAssetId) {
			return true;
		}

		if (visited.has(current)) {
			continue;
		}
		visited.add(current);

		// Follow edges where current is the parent → get children
		const childEdges = await repo.findByParent(current);
		for (const edge of childEdges) {
			if (!visited.has(edge.childAssetId)) {
				queue.push(edge.childAssetId);
			}
		}
	}

	return false;
}

// ─── Drizzle Repository ──────────────────────────────────────────────────

export function createDrizzleTakeEdgeRepository(db: Database): TakeEdgeRepository {
	function rowToEdge(row: typeof takeEdges.$inferSelect): TakeEdgeRow {
		return {
			id: row.id,
			projectId: row.projectId,
			ownerId: row.ownerId,
			parentAssetId: row.parentAssetId,
			childAssetId: row.childAssetId,
			branchType: row.branchType as BranchType,
			branchPrompt: row.branchPrompt,
			createdAt: row.createdAt,
			deletedAt: row.deletedAt
		};
	}

	return {
		async create(data) {
			const rows = await db
				.insert(takeEdges)
				.values({
					projectId: data.projectId,
					ownerId: data.ownerId,
					parentAssetId: data.parentAssetId,
					childAssetId: data.childAssetId,
					branchType: data.branchType,
					branchPrompt: data.branchPrompt
				})
				.returning();
			return rowToEdge(rows[0]);
		},

		async findByParent(parentAssetId) {
			const rows = await db
				.select()
				.from(takeEdges)
				.where(
					and(eq(takeEdges.parentAssetId, parentAssetId), isNull(takeEdges.deletedAt))
				);
			return rows.map(rowToEdge);
		},

		async findByChild(childAssetId) {
			const rows = await db
				.select()
				.from(takeEdges)
				.where(
					and(eq(takeEdges.childAssetId, childAssetId), isNull(takeEdges.deletedAt))
				);
			return rows.map(rowToEdge);
		},

		async findAllActive() {
			const rows = await db
				.select()
				.from(takeEdges)
				.where(isNull(takeEdges.deletedAt));
			return rows.map(rowToEdge);
		},

		async softDeleteByAssetId(assetId) {
			const now = new Date();
			const parentRows = await db
				.update(takeEdges)
				.set({ deletedAt: now })
				.where(
					and(eq(takeEdges.parentAssetId, assetId), isNull(takeEdges.deletedAt))
				)
				.returning();
			const childRows = await db
				.update(takeEdges)
				.set({ deletedAt: now })
				.where(
					and(eq(takeEdges.childAssetId, assetId), isNull(takeEdges.deletedAt))
				)
				.returning();
			return parentRows.length + childRows.length;
		}
	};
}
