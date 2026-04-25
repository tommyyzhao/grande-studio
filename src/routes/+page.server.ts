import type { PageServerLoad } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { eq, isNull, and } from 'drizzle-orm';
import {
	createQuotaService,
	createDrizzleQuotaRepository,
	DAILY_LIMIT
} from '$lib/services/quota';

function getDb() {
	const dbUrl = process.env.DATABASE_URL ?? '';
	return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	if (!user) {
		// Unauthenticated: return null project (temp workspace handled client-side)
		return {
			project: null,
			quotaUsed: 0,
			quotaLimit: DAILY_LIMIT
		};
	}

	const db = getDb();

	// Find existing project or create a default one
	const existingProjects = await withRLS(db, user.id, async (tx) => {
		return tx
			.select()
			.from(projects)
			.where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt)))
			.limit(1);
	});

	let project: { id: string; title: string };

	if (existingProjects.length > 0) {
		project = { id: existingProjects[0].id, title: existingProjects[0].title };
	} else {
		// Auto-create a default project on first authenticated visit
		const [created] = await withRLS(db, user.id, async (tx) => {
			return tx
				.insert(projects)
				.values({
					ownerId: user.id,
					title: 'My Project'
				})
				.returning({ id: projects.id, title: projects.title });
		});
		project = created;
	}

	// Fetch daily quota usage
	const quotaRepo = createDrizzleQuotaRepository(db);
	const quotaService = createQuotaService(quotaRepo);
	const quotaUsed = await quotaService.checkDailyUsage(user.id);

	return {
		project,
		quotaUsed,
		quotaLimit: DAILY_LIMIT
	};
};
