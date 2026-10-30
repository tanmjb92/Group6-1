import { describe, expect, it } from 'vitest';
import { getWebAuthnUserId } from './user-handle';

describe('WebAuthn user handles', () => {
  it('creates a stable opaque 32-byte handle for each username', () => {
    const first = getWebAuthnUserId('alice');
    const repeated = getWebAuthnUserId('alice');

    expect(first).toHaveLength(32);
    expect(first).toEqual(repeated);
    expect(getWebAuthnUserId('bob')).not.toEqual(first);
  });

  it('keeps handles within the WebAuthn byte limit for unicode usernames', () => {
    expect(getWebAuthnUserId('😀'.repeat(64))).toHaveLength(32);
  });
});
