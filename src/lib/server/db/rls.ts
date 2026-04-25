import { sql } from 'drizzle-orm';
import type { Database } from './index';

/**
 * Executes a callback within a transaction that has `app.user_id` set for RLS.
 *
 * Uses `SET LOCAL` so the setting is scoped to the transaction and automatically
 * cleared when the transaction ends. If `userId` is not provided, the transaction
 * runs without setting `app.user_id` (RLS will deny all access).
 */
export async function withRLS<T>(
	db: Database,
	userId: string,
	fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL app.user_id = ${userId}`);
		return fn(tx);
	});
}
