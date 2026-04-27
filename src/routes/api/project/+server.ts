import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { eq } from 'drizzle-orm';
import { getEnv } from '$lib/server/env';

/**
 * PATCH /api/project
 * Update project title. Body: { projectId, title }
 * Requires authentication (temp users cannot rename projects).
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals } = event;
	const env = getEnv(event);
	if (!locals.user) {
		error(401, { message: 'Authentication required to rename projects.' });
	}

	let body: { projectId: string; title: string };
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid JSON request body.' });
	}

	const { projectId, title } = body;

	if (!projectId || typeof projectId !== 'string') {
		error(400, { message: 'Missing required field: projectId' });
	}

	if (!title || typeof title !== 'string' || title.trim().length === 0) {
		error(400, { message: 'Title must be a non-empty string.' });
	}

	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const [updated] = await withRLS(db, locals.user.id, async (tx) => {
		return tx
			.update(projects)
			.set({ title: title.trim(), updatedAt: new Date() })
			.where(eq(projects.id, projectId))
			.returning({ id: projects.id, title: projects.title });
	});

	if (!updated) {
		error(404, { message: 'Project not found.' });
	}

	return json({ project: updated });
};
