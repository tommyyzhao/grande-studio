import { sql } from 'drizzle-orm';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { createQuotaService, createDrizzleQuotaRepository } from '$lib/services/quota';
import { audioAssets, generationJobs } from '$lib/server/db/schema';
import type { WorkflowEnv } from './types';

/**
 * Generation rows older than this in `generating` / `receiving_audio` /
 * `persisting` are considered stuck (worker died mid-execution, e.g. exceeded
 * CF Workers wall-time). The cron flips them to `failed` so the UI can show a
 * retry affordance and quota gets released.
 */
const STUCK_THRESHOLD_MINUTES = 10;

/**
 * Cloudflare Cron Trigger handler.
 * Expires stale quota reservations that have passed their TTL.
 *
 * Configured to run every 5 minutes via wrangler.jsonc `triggers.crons`.
 *
 * Export this as the `scheduled` handler from the worker entry point:
 *
 * ```ts
 * export default {
 *   fetch: svelteKitHandler,
 *   queue(batch, env, ctx) { ... },
 *   scheduled(event, env, ctx) {
 *     ctx.waitUntil(handleScheduled(env));
 *   }
 * };
 * ```
 */
export async function handleScheduled(env?: WorkflowEnv): Promise<void> {
	const dbUrl = env?.DATABASE_URL ?? process.env.DATABASE_URL ?? '';
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const quotaRepo = createDrizzleQuotaRepository(db);
	const quotaService = createQuotaService(quotaRepo);

	const { expiredCount } = await quotaService.expireStaleReservations();

	if (expiredCount > 0) {
		console.log(`[scheduled] Expired ${expiredCount} stale quota reservation(s)`);
	}

	// Flip stuck-in-flight assets/jobs to failed. RLS is bypassed here because
	// this runs as the cron principal and needs to scan across all owners.
	const cutoff = sql`now() - interval '${sql.raw(String(STUCK_THRESHOLD_MINUTES))} minutes'`;
	const stuckStatuses = sql`('generating','receiving_audio','persisting')`;

	const stuckAssets = await db
		.update(audioAssets)
		.set({
			status: 'failed',
			errorJson: { code: 'WORKER_TIMEOUT', message: 'Worker did not finish within budget' },
			updatedAt: new Date()
		})
		.where(sql`${audioAssets.status} IN ${stuckStatuses} AND ${audioAssets.updatedAt} < ${cutoff}`)
		.returning({ id: audioAssets.id });

	const stuckJobs = await db
		.update(generationJobs)
		.set({
			status: 'failed',
			errorCode: 'WORKER_TIMEOUT',
			errorJson: { code: 'WORKER_TIMEOUT', message: 'Worker did not finish within budget' },
			updatedAt: new Date()
		})
		.where(sql`${generationJobs.status} IN ${stuckStatuses} AND ${generationJobs.updatedAt} < ${cutoff}`)
		.returning({ id: generationJobs.id });

	if (stuckAssets.length > 0 || stuckJobs.length > 0) {
		console.log(
			`[scheduled] Flipped stuck rows to failed: ${stuckAssets.length} asset(s), ${stuckJobs.length} job(s)`
		);
	}
}
