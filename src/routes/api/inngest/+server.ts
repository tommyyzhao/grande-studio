import { serve } from 'inngest/sveltekit';
import { inngest } from '$lib/server/inngest/client';
import { generationFunction, quotaExpiryFunction } from '$lib/server/inngest/functions';

const handler = serve({
	client: inngest,
	functions: [generationFunction, quotaExpiryFunction]
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
