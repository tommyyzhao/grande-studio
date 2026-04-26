import { createLocalDb, createNeonDb } from '$lib/server/db';
import { createQuotaService, createDrizzleQuotaRepository } from '$lib/services/quota';
import type { WorkflowEnv } from './types';

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
}
