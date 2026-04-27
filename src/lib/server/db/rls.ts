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
	// Sanitize userId to prevent SQL injection (UUIDs and session IDs are alphanumeric + hyphens)
	const sanitized = userId.replace(/[^a-zA-Z0-9\-_]/g, '');
	if (sanitized !== userId || !userId) {
		throw new Error('Invalid userId for RLS context');
	}

	return db.transaction(async (tx) => {
		// SET LOCAL cannot be parameterized ($1) in Postgres — must use raw SQL.
		// The userId is sanitized above to prevent injection.
		await tx.execute(sql.raw(`SET LOCAL app.user_id = '${sanitized}'`));
		return fn(tx);
	});
}
