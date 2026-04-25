import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { takeEdges } from '$lib/server/db/schema';
import type { BranchType } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { eq, and, isNull, sql } from 'drizzle-orm';
import {
	createTakeEdgeService,
	createDrizzleTakeEdgeRepository
} from '$lib/services/take-edges';

function getDb() {
	const dbUrl = process.env.DATABASE_URL ?? '';
	return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
}

const VALID_BRANCH_TYPES: BranchType[] = [
	'prompt_variation',
	'lyric_edit',
	'instrumental_variant',
	'cover_restyle',
	'reference_from_asset',
	'manual_duplicate',
	'other'
];

/**
 * POST /api/take-edges
 * Create a take edge linking parent asset to child asset.
 * Body: { projectId, parentAssetId, childAssetId, branchType, branchPrompt? }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, { message: 'Authentication required.' });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid JSON request body.' });
	}

	const { projectId, parentAssetId, childAssetId, branchType, branchPrompt } = body;

	if (!projectId || typeof projectId !== 'string') {
		error(400, { message: 'Missing required field: projectId' });
	}
	if (!parentAssetId || typeof parentAssetId !== 'string') {
		error(400, { message: 'Missing required field: parentAssetId' });
	}
	if (!childAssetId || typeof childAssetId !== 'string') {
		error(400, { message: 'Missing required field: childAssetId' });
	}
	if (!branchType || !VALID_BRANCH_TYPES.includes(branchType as BranchType)) {
		error(400, { message: `Invalid branchType. Must be one of: ${VALID_BRANCH_TYPES.join(', ')}` });
	}
	if (branchPrompt !== undefined && typeof branchPrompt !== 'string') {
		error(400, { message: 'branchPrompt must be a string if provided' });
	}

	const db = getDb();
	const repo = createDrizzleTakeEdgeRepository(db);
	const service = createTakeEdgeService(repo);

	const result = await service.createEdge(
		projectId as string,
		locals.user.id,
		parentAssetId as string,
		childAssetId as string,
		branchType as BranchType,
		(branchPrompt as string) ?? undefined
	);

	if (!result.ok) {
		error(400, { message: result.error });
	}

	return json({ edge: result.edge });
};

/**
 * GET /api/take-edges?projectId=...
 * Get variation counts and edge data for a project.
 * Returns: { counts: Record<parentAssetId, number>, edges: Array<{ parentAssetId, childAssetId, branchType }> }
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		error(401, { message: 'Authentication required.' });
	}

	const projectId = url.searchParams.get('projectId');
	if (!projectId) {
		error(400, { message: 'Missing required query parameter: projectId' });
	}

	const db = getDb();

	const edgeRows = await withRLS(db, locals.user.id, async (tx) => {
		return tx
			.select({
				parentAssetId: takeEdges.parentAssetId,
				childAssetId: takeEdges.childAssetId,
				branchType: takeEdges.branchType
			})
			.from(takeEdges)
			.where(
				and(
					eq(takeEdges.projectId, projectId),
					isNull(takeEdges.deletedAt)
				)
			);
	});

	// Build counts from edges
	const counts: Record<string, number> = {};
	for (const row of edgeRows) {
		counts[row.parentAssetId] = (counts[row.parentAssetId] ?? 0) + 1;
	}

	return json({ counts, edges: edgeRows });
};
