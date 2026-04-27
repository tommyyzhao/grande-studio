import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { arrangementClips, audioAssets } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { eq, and, isNull } from 'drizzle-orm';
import { getEffectiveUserId } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';

/**
 * GET /api/arrangement?projectId=...
 * Load all arrangement clips for a project (hydration on project open).
 */
export const GET: RequestHandler = async (event) => {
	const { url, locals } = event;
	const env = getEnv(event);
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required.' });
	}

	const projectId = url.searchParams.get('projectId');
	if (!projectId) {
		error(400, { message: 'Missing required query parameter: projectId' });
	}

	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const clips = await withRLS(db, userId, async (tx) => {
		return tx
			.select()
			.from(arrangementClips)
			.where(and(eq(arrangementClips.projectId, projectId), isNull(arrangementClips.deletedAt)))
			.orderBy(arrangementClips.layerOrder);
	});

	return json({ clips });
};

/**
 * POST /api/arrangement
 * Create a new arrangement clip for a ready asset.
 * Body: { projectId, assetId }
 * Returns: { clip } with the created clip row.
 */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const env = getEnv(event);
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required.' });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid JSON request body.' });
	}

	const { projectId, assetId } = body;
	if (!projectId || typeof projectId !== 'string') {
		error(400, { message: 'Missing required field: projectId' });
	}
	if (!assetId || typeof assetId !== 'string') {
		error(400, { message: 'Missing required field: assetId' });
	}

	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const clip = await withRLS(db, userId, async (tx) => {
		// Fetch the source asset to get duration
		const [asset] = await tx
			.select({ durationSec: audioAssets.durationSec, status: audioAssets.status })
			.from(audioAssets)
			.where(eq(audioAssets.id, assetId))
			.limit(1);

		if (!asset) {
			error(404, { message: 'Asset not found.' });
		}
		if (asset.status !== 'ready') {
			error(400, { message: 'Asset must be in ready state to add to arrangement.' });
		}

		const clipDuration = asset.durationSec ? String(asset.durationSec) : '0';

		// Get current max layer order for this project
		const existingClips = await tx
			.select({ layerOrder: arrangementClips.layerOrder })
			.from(arrangementClips)
			.where(
				and(eq(arrangementClips.projectId, projectId), isNull(arrangementClips.deletedAt))
			)
			.orderBy(arrangementClips.layerOrder);

		const nextLayerOrder =
			existingClips.length > 0
				? existingClips[existingClips.length - 1].layerOrder + 1
				: 0;

		const [created] = await tx
			.insert(arrangementClips)
			.values({
				projectId,
				ownerId: userId,
				assetId,
				startTimeSec: '0',
				trimStartSec: '0',
				trimEndSec: null,
				clipDurationSec: clipDuration,
				gainDb: '0',
				muted: false,
				soloed: false,
				layerOrder: nextLayerOrder
			})
			.returning();

		return created;
	});

	return json({ clip });
};

/**
 * PATCH /api/arrangement
 * Update clip fields (debounced from client). Body: { clipId, ...fields }
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals } = event;
	const env = getEnv(event);
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required.' });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid JSON request body.' });
	}

	const clipId = body.clipId;
	if (!clipId || typeof clipId !== 'string') {
		error(400, { message: 'Missing required field: clipId' });
	}

	// Map client fields to DB column values (numeric fields stored as strings in Drizzle)
	const dbUpdate: Record<string, unknown> = {};

	if ('startTimeSec' in body) dbUpdate.startTimeSec = String(body.startTimeSec);
	if ('trimStartSec' in body) dbUpdate.trimStartSec = String(body.trimStartSec);
	if ('trimEndSec' in body)
		dbUpdate.trimEndSec = body.trimEndSec != null ? String(body.trimEndSec) : null;
	if ('clipDurationSec' in body) dbUpdate.clipDurationSec = String(body.clipDurationSec);
	if ('gainDb' in body) dbUpdate.gainDb = String(body.gainDb);
	if ('muted' in body) dbUpdate.muted = body.muted;
	if ('soloed' in body) dbUpdate.soloed = body.soloed;
	if ('layerOrder' in body) dbUpdate.layerOrder = body.layerOrder;

	if (Object.keys(dbUpdate).length === 0) {
		error(400, { message: 'No valid fields to update.' });
	}

	dbUpdate.updatedAt = new Date();

	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	await withRLS(db, userId, async (tx) => {
		await tx.update(arrangementClips).set(dbUpdate).where(eq(arrangementClips.id, clipId));
	});

	return json({ ok: true });
};

/**
 * DELETE /api/arrangement?clipId=...
 * Soft-delete an arrangement clip (immediate, not debounced).
 */
export const DELETE: RequestHandler = async (event) => {
	const { url, locals } = event;
	const env = getEnv(event);
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required.' });
	}

	const clipId = url.searchParams.get('clipId');
	if (!clipId) {
		error(400, { message: 'Missing required query parameter: clipId' });
	}

	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
	const now = new Date();

	await withRLS(db, userId, async (tx) => {
		await tx
			.update(arrangementClips)
			.set({ deletedAt: now, updatedAt: now })
			.where(eq(arrangementClips.id, clipId));
	});

	return json({ ok: true });
};
