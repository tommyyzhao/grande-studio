import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

export type Schema = typeof schema;

/**
 * Local development: uses node-postgres (pg) driver for local Postgres.
 */
export function createLocalDb(connectionString: string): NodePgDatabase<Schema> {
	return drizzleNodePg(connectionString, { schema });
}

/**
 * Production: uses @neondatabase/serverless driver for Neon Postgres.
 */
export function createNeonDb(connectionString: string): NeonDatabase<Schema> {
	return drizzleNeon(connectionString, { schema });
}

export type Database = NodePgDatabase<Schema> | NeonDatabase<Schema>;

export { schema };
