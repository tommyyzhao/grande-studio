import { AsyncLocalStorage } from 'node:async_hooks';
import type { WorkflowEnv } from '$lib/server/workflow/types';

/**
 * Request-scoped context for Inngest function execution.
 *
 * Inngest function callbacks don't receive the SvelteKit RequestEvent, so they
 * can't reach platform.env (R2/KV bindings) directly. The /api/inngest serve
 * endpoint runs each invocation inside `inngestEnvContext.run(env, ...)`, and
 * functions read the env via `getInngestEnv()`.
 *
 * Requires the `nodejs_compat` Cloudflare compatibility flag for AsyncLocalStorage.
 */
export const inngestEnvContext = new AsyncLocalStorage<WorkflowEnv>();

export function getInngestEnv(): WorkflowEnv | undefined {
	return inngestEnvContext.getStore();
}
