import { describe, expect, it } from 'vitest';
import {
  authenticationResponseSchema,
  registrationResponseSchema,
  usernameRequestSchema,
} from './validation';

const registrationResponse = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key',
  response: { attestationObject: 'attestation', clientDataJSON: 'client-data' },
  clientExtensionResults: {},
};

const authenticationResponse = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key',
  response: {
    authenticatorData: 'auth-data',
    clientDataJSON: 'client-data',
    signature: 'signature',
  },
  clientExtensionResults: {},
};

describe('authentication request validation', () => {
  it('trims usernames and rejects empty, long, or unexpected input', () => {
    expect(usernameRequestSchema.parse({ username: ' alice ' })).toEqual({ username: 'alice' });
    expect(usernameRequestSchema.safeParse({ username: '  ' }).success).toBe(false);
    expect(usernameRequestSchema.safeParse({ username: 'a'.repeat(65) }).success).toBe(false);
    expect(usernameRequestSchema.safeParse({ username: 'alice', extra: true }).success).toBe(false);
  });

  it('accepts structurally valid registration responses and rejects malformed ones', () => {
    expect(
      registrationResponseSchema.safeParse({ username: 'alice', response: registrationResponse })
        .success,
    ).toBe(true);
    expect(
      registrationResponseSchema.safeParse({
        username: 'alice',
        response: { ...registrationResponse, response: {} },
      }).success,
    ).toBe(false);
  });

  it('accepts structurally valid authentication responses and rejects malformed ones', () => {
    expect(
      authenticationResponseSchema.safeParse({
        username: 'alice',
        response: authenticationResponse,
      }).success,
    ).toBe(true);
    expect(
      authenticationResponseSchema.safeParse({
        username: 'alice',
        response: { ...authenticationResponse, response: { signature: 3 } },
      }).success,
    ).toBe(false);
  });
});
