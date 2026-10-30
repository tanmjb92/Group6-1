import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signSessionToken, verifySessionToken } from './session-token';

const secret = 'a-test-signing-secret-that-is-at-least-32-bytes';
const session = { userId: 7, username: 'alice' };

describe('session token', () => {
  it('signs and verifies a session token with a seven-day expiry', async () => {
    const now = 1_800_000_000;
    const token = await signSessionToken(session, secret, now);

    await expect(verifySessionToken(token, secret, now)).resolves.toEqual(session);
    await expect(verifySessionToken(token, secret, now + 7 * 24 * 60 * 60)).resolves.toBeNull();
  });

  it('rejects tampered, malformed, and expired tokens', async () => {
    const token = await signSessionToken(session, secret, 1_800_000_000);
    const tampered = `${token.slice(0, -1)}x`;

    await expect(verifySessionToken(tampered, secret, 1_800_000_001)).resolves.toBeNull();
    await expect(verifySessionToken('not-a-jwt', secret, 1_800_000_001)).resolves.toBeNull();
    await expect(verifySessionToken(token, secret, 1_800_000_000 + 7 * 24 * 60 * 60)).resolves.toBeNull();
  });

  it('rejects secrets shorter than 32 bytes', async () => {
    await expect(signSessionToken(session, 'too-short', 1_800_000_000)).rejects.toThrow(
      'SESSION_SECRET must contain at least 32 bytes',
    );
    await expect(verifySessionToken('not-a-jwt', 'too-short')).resolves.toBeNull();
  });

  it('does not sign invalid user identities', async () => {
    await expect(
      signSessionToken({ userId: 0, username: 'alice' }, secret, 1_800_000_000),
    ).rejects.toThrow('Invalid session');
    await expect(
      signSessionToken({ userId: 7, username: '' }, secret, 1_800_000_000),
    ).rejects.toThrow('Invalid session');
  });

  it('rejects a correctly signed token with invalid session claims', async () => {
    const now = 1_800_000_000;
    const invalidToken = await new SignJWT({ username: 5 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('todo-app')
      .setSubject('7')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(secret));

    await expect(verifySessionToken(invalidToken, secret, now)).resolves.toBeNull();
  });
});
