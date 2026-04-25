import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { arrangementClips } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { eq, and, isNull } from 'drizzle-orm';

function getDb() {
	const dbUrl = process.env.DATABASE_URL ?? '';
	return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
}

/**
 * GET /api/arrangement?projectId=...
 * Load all arrangement clips for a project (hydration on project open).
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

	const clips = await withRLS(db, locals.user.id, async (tx) => {
		return tx
			.select()
			.from(arrangementClips)
			.where(and(eq(arrangementClips.projectId, projectId), isNull(arrangementClips.deletedAt)))
			.orderBy(arrangementClips.layerOrder);
	});

	return json({ clips });
};

/**
 * PATCH /api/arrangement
 * Update clip fields (debounced from client). Body: { clipId, ...fields }
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, { message: 'Authentication required.' });
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

	const db = getDb();

	await withRLS(db, locals.user.id, async (tx) => {
		await tx.update(arrangementClips).set(dbUpdate).where(eq(arrangementClips.id, clipId));
	});

	return json({ ok: true });
};

/**
 * DELETE /api/arrangement?clipId=...
 * Soft-delete an arrangement clip (immediate, not debounced).
 */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		error(401, { message: 'Authentication required.' });
	}

	const clipId = url.searchParams.get('clipId');
	if (!clipId) {
		error(400, { message: 'Missing required query parameter: clipId' });
	}

	const db = getDb();
	const now = new Date();

	await withRLS(db, locals.user.id, async (tx) => {
		await tx
			.update(arrangementClips)
			.set({ deletedAt: now, updatedAt: now })
			.where(eq(arrangementClips.id, clipId));
	});

	return json({ ok: true });
};
