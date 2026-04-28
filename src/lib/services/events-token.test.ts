import { describe, expect, it } from 'vitest';
import { signEventsToken, verifyEventsToken } from './events-token';

const SECRET = 'test-secret-bytes-32-characters-long!!';

describe('events-token', () => {
	it('round-trips a freshly signed token', async () => {
		const { token, expiresAt } = await signEventsToken('user-abc', SECRET);

		const verified = await verifyEventsToken(token, SECRET);

		expect(verified).not.toBeNull();
		expect(verified!.userId).toBe('user-abc');
		expect(verified!.expiresAt).toBe(expiresAt);
	});

	it('rejects a token signed with a different secret', async () => {
		const { token } = await signEventsToken('user-abc', SECRET);

		const verified = await verifyEventsToken(token, 'different-secret');

		expect(verified).toBeNull();
	});

	it('rejects a token whose payload was tampered with', async () => {
		const { token } = await signEventsToken('user-abc', SECRET);
		const [, exp, sig] = token.split('.');
		const tampered = `attacker.${exp}.${sig}`;

		const verified = await verifyEventsToken(tampered, SECRET);

		expect(verified).toBeNull();
	});

	it('rejects a token past its expiry', async () => {
		// Use a TTL of -1 second so the token is immediately expired.
		const { token } = await signEventsToken('user-abc', SECRET, -1);

		const verified = await verifyEventsToken(token, SECRET);

		expect(verified).toBeNull();
	});

	it('rejects malformed tokens', async () => {
		expect(await verifyEventsToken('', SECRET)).toBeNull();
		expect(await verifyEventsToken('not-a-token', SECRET)).toBeNull();
		expect(await verifyEventsToken('a.b', SECRET)).toBeNull();
		expect(await verifyEventsToken('a.b.c.d', SECRET)).toBeNull();
		expect(await verifyEventsToken('user.notanumber.deadbeef', SECRET)).toBeNull();
	});
});
