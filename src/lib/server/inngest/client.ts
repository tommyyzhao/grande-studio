import { Inngest } from 'inngest';

const isDev =
	typeof process !== 'undefined' && process.env?.INNGEST_DEV === '1';

export const inngest = new Inngest({
	id: 'grande-studio',
	isDev,
	baseUrl: isDev
		? (process.env?.INNGEST_BASE_URL ?? 'http://localhost:8299')
		: undefined
});
