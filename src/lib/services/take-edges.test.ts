import { describe, it, expect, beforeEach } from 'vitest';
import {
	createTakeEdgeService,
	type TakeEdgeRepository,
	type TakeEdgeRow,
	type NewTakeEdge,
	type TakeEdgeService
} from './take-edges';

// ─── In-Memory Repository for Testing ─────────────────────────────────────

function createInMemoryTakeEdgeRepo(): TakeEdgeRepository {
	const store = new Map<string, TakeEdgeRow>();
	let nextId = 1;

	return {
		async create(data: NewTakeEdge) {
			const id = `edge-${nextId++}`;
			const now = new Date();
			const row: TakeEdgeRow = {
				id,
				projectId: data.projectId,
				ownerId: data.ownerId,
				parentAssetId: data.parentAssetId,
				childAssetId: data.childAssetId,
				branchType: data.branchType,
				branchPrompt: data.branchPrompt,
				createdAt: now,
				deletedAt: null
			};
			store.set(id, row);
			return row;
		},

		async findByParent(parentAssetId) {
			const results: TakeEdgeRow[] = [];
			for (const row of store.values()) {
				if (row.parentAssetId === parentAssetId && row.deletedAt === null) {
					results.push(row);
				}
			}
			return results;
		},

		async findByChild(childAssetId) {
			const results: TakeEdgeRow[] = [];
			for (const row of store.values()) {
				if (row.childAssetId === childAssetId && row.deletedAt === null) {
					results.push(row);
				}
			}
			return results;
		},

		async findAllActive() {
			const results: TakeEdgeRow[] = [];
			for (const row of store.values()) {
				if (row.deletedAt === null) {
					results.push(row);
				}
			}
			return results;
		},

		async softDeleteByAssetId(assetId) {
			let count = 0;
			for (const [id, row] of store.entries()) {
				if (
					(row.parentAssetId === assetId || row.childAssetId === assetId) &&
					row.deletedAt === null
				) {
					store.set(id, { ...row, deletedAt: new Date() });
					count++;
				}
			}
			return count;
		}
	};
}

// ─── Test Constants ───────────────────────────────────────────────────────

const PROJECT_ID = 'proj-1';
const OWNER_ID = 'owner-1';
const ASSET_A = 'asset-a';
const ASSET_B = 'asset-b';
const ASSET_C = 'asset-c';
const ASSET_D = 'asset-d';

// ─── Tests ────────────────────────────────────────────────────────────────

describe('TakeEdgeService', () => {
	let repo: TakeEdgeRepository;
	let service: TakeEdgeService;

	beforeEach(() => {
		repo = createInMemoryTakeEdgeRepo();
		service = createTakeEdgeService(repo);
	});

	// ── createEdge ──────────────────────────────────────────────────────

	describe('createEdge', () => {
		it('creates a simple edge between two assets', async () => {
			const result = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'prompt_variation'
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.edge.parentAssetId).toBe(ASSET_A);
				expect(result.edge.childAssetId).toBe(ASSET_B);
				expect(result.edge.branchType).toBe('prompt_variation');
				expect(result.edge.branchPrompt).toBeNull();
				expect(result.edge.projectId).toBe(PROJECT_ID);
				expect(result.edge.ownerId).toBe(OWNER_ID);
				expect(result.edge.deletedAt).toBeNull();
			}
		});

		it('creates an edge with a branch prompt', async () => {
			const result = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'lyric_edit',
				'Changed the chorus lyrics'
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.edge.branchPrompt).toBe('Changed the chorus lyrics');
				expect(result.edge.branchType).toBe('lyric_edit');
			}
		});

		it('creates multiple edges from the same parent', async () => {
			const r1 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'prompt_variation'
			);
			const r2 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_C,
				'instrumental_variant'
			);

			expect(r1.ok).toBe(true);
			expect(r2.ok).toBe(true);
		});

		it('creates edges for all branch types', async () => {
			const branchTypes = [
				'prompt_variation',
				'lyric_edit',
				'instrumental_variant',
				'cover_restyle',
				'reference_from_asset',
				'manual_duplicate',
				'other'
			] as const;

			for (let i = 0; i < branchTypes.length; i++) {
				const result = await service.createEdge(
					PROJECT_ID,
					OWNER_ID,
					`parent-${i}`,
					`child-${i}`,
					branchTypes[i]
				);
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.edge.branchType).toBe(branchTypes[i]);
				}
			}
		});
	});

	// ── Self-edge rejection ─────────────────────────────────────────────

	describe('self-edge rejection', () => {
		it('rejects an edge from an asset to itself', async () => {
			const result = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_A,
				'prompt_variation'
			);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('itself');
			}
		});
	});

	// ── Cycle detection ─────────────────────────────────────────────────

	describe('cycle detection', () => {
		it('rejects A → B → C → A (direct cycle back to root)', async () => {
			// A → B
			const r1 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'prompt_variation'
			);
			expect(r1.ok).toBe(true);

			// B → C
			const r2 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_B,
				ASSET_C,
				'prompt_variation'
			);
			expect(r2.ok).toBe(true);

			// C → A should be rejected (creates cycle A→B→C→A)
			const r3 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_C,
				ASSET_A,
				'prompt_variation'
			);
			expect(r3.ok).toBe(false);
			if (!r3.ok) {
				expect(r3.error).toContain('Cycle detected');
			}
		});

		it('rejects A → B → A (simple two-node cycle)', async () => {
			// A → B
			const r1 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'prompt_variation'
			);
			expect(r1.ok).toBe(true);

			// B → A should be rejected
			const r2 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_B,
				ASSET_A,
				'prompt_variation'
			);
			expect(r2.ok).toBe(false);
			if (!r2.ok) {
				expect(r2.error).toContain('Cycle detected');
			}
		});

		it('rejects longer cycles: A → B → C → D → A', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_B, ASSET_C, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_C, ASSET_D, 'prompt_variation');

			// D → A should be rejected
			const result = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_D,
				ASSET_A,
				'prompt_variation'
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('Cycle detected');
			}
		});

		it('allows valid DAG structures (diamond shape)', async () => {
			// A → B, A → C, B → D, C → D (diamond — no cycle)
			const r1 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'prompt_variation'
			);
			expect(r1.ok).toBe(true);

			const r2 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_C,
				'prompt_variation'
			);
			expect(r2.ok).toBe(true);

			const r3 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_B,
				ASSET_D,
				'prompt_variation'
			);
			expect(r3.ok).toBe(true);

			const r4 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_C,
				ASSET_D,
				'prompt_variation'
			);
			expect(r4.ok).toBe(true);
		});

		it('allows a linear chain without cycles', async () => {
			// A → B → C → D (linear — no cycle)
			const r1 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_A,
				ASSET_B,
				'prompt_variation'
			);
			const r2 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_B,
				ASSET_C,
				'prompt_variation'
			);
			const r3 = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_C,
				ASSET_D,
				'prompt_variation'
			);

			expect(r1.ok).toBe(true);
			expect(r2.ok).toBe(true);
			expect(r3.ok).toBe(true);
		});

		it('does not consider soft-deleted edges in cycle detection', async () => {
			// A → B
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			// B → C
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_B, ASSET_C, 'prompt_variation');

			// Soft-delete edges for B (removes A→B and B→C)
			await service.softDeleteEdgesForAsset(ASSET_B);

			// C → A should now be allowed since B's edges are soft-deleted
			const result = await service.createEdge(
				PROJECT_ID,
				OWNER_ID,
				ASSET_C,
				ASSET_A,
				'prompt_variation'
			);
			expect(result.ok).toBe(true);
		});
	});

	// ── getChildren ─────────────────────────────────────────────────────

	describe('getChildren', () => {
		it('returns child edges for a parent asset', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_C, 'lyric_edit');

			const children = await service.getChildren(ASSET_A);
			expect(children).toHaveLength(2);
			expect(children.map((e) => e.childAssetId).sort()).toEqual(
				[ASSET_B, ASSET_C].sort()
			);
		});

		it('returns empty array when no children exist', async () => {
			const children = await service.getChildren(ASSET_A);
			expect(children).toHaveLength(0);
		});

		it('does not return soft-deleted edges', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.softDeleteEdgesForAsset(ASSET_B);

			const children = await service.getChildren(ASSET_A);
			expect(children).toHaveLength(0);
		});
	});

	// ── getParents ──────────────────────────────────────────────────────

	describe('getParents', () => {
		it('returns parent edges for a child asset', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_C, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_B, ASSET_C, 'cover_restyle');

			const parents = await service.getParents(ASSET_C);
			expect(parents).toHaveLength(2);
			expect(parents.map((e) => e.parentAssetId).sort()).toEqual(
				[ASSET_A, ASSET_B].sort()
			);
		});

		it('returns empty array when no parents exist', async () => {
			const parents = await service.getParents(ASSET_A);
			expect(parents).toHaveLength(0);
		});

		it('does not return soft-deleted edges', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.softDeleteEdgesForAsset(ASSET_A);

			const parents = await service.getParents(ASSET_B);
			expect(parents).toHaveLength(0);
		});
	});

	// ── softDeleteEdgesForAsset ──────────────────────────────────────────

	describe('softDeleteEdgesForAsset', () => {
		it('soft-deletes edges where asset is parent', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_C, 'lyric_edit');

			const result = await service.softDeleteEdgesForAsset(ASSET_A);
			expect(result.deletedCount).toBe(2);

			const children = await service.getChildren(ASSET_A);
			expect(children).toHaveLength(0);
		});

		it('soft-deletes edges where asset is child', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_C, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_B, ASSET_C, 'cover_restyle');

			const result = await service.softDeleteEdgesForAsset(ASSET_C);
			expect(result.deletedCount).toBe(2);

			const parents = await service.getParents(ASSET_C);
			expect(parents).toHaveLength(0);
		});

		it('soft-deletes edges where asset is both parent and child', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_B, ASSET_C, 'lyric_edit');

			const result = await service.softDeleteEdgesForAsset(ASSET_B);
			expect(result.deletedCount).toBe(2);

			// Verify both directions are soft-deleted
			const childrenOfA = await service.getChildren(ASSET_A);
			expect(childrenOfA).toHaveLength(0);

			const parentsOfC = await service.getParents(ASSET_C);
			expect(parentsOfC).toHaveLength(0);
		});

		it('returns 0 when asset has no edges', async () => {
			const result = await service.softDeleteEdgesForAsset(ASSET_A);
			expect(result.deletedCount).toBe(0);
		});

		it('does not affect edges of other assets', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_C, ASSET_D, 'lyric_edit');

			await service.softDeleteEdgesForAsset(ASSET_A);

			// C → D should still exist
			const children = await service.getChildren(ASSET_C);
			expect(children).toHaveLength(1);
			expect(children[0].childAssetId).toBe(ASSET_D);
		});

		it('is idempotent — soft-deleting already deleted edges returns 0', async () => {
			await service.createEdge(PROJECT_ID, OWNER_ID, ASSET_A, ASSET_B, 'prompt_variation');

			const r1 = await service.softDeleteEdgesForAsset(ASSET_A);
			expect(r1.deletedCount).toBe(1);

			const r2 = await service.softDeleteEdgesForAsset(ASSET_A);
			expect(r2.deletedCount).toBe(0);
		});
	});
});
