import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidJsonResponse, rejectCrossOriginRequest } from './route-utils';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authentication route utilities', () => {
  it('rejects a missing or cross-origin Origin header', async () => {
    vi.stubEnv('RP_NAME', 'Todo App');
    vi.stubEnv('RP_ID', 'localhost');
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');

    const response = rejectCrossOriginRequest(
      new Request('http://localhost:3000/api/auth/logout', {
        headers: { origin: 'https://attacker.example' },
      }),
    );
    expect(response?.status).toBe(403);

    const missingOrigin = rejectCrossOriginRequest(
      new Request('http://localhost:3000/api/auth/logout'),
    );
    expect(missingOrigin?.status).toBe(403);
    expect(rejectCrossOriginRequest(
      new Request('http://localhost:3000/api/auth/logout', {
        headers: { origin: 'http://localhost:3000' },
      }),
    )).toBeNull();
  });

  it('returns a client error only for malformed JSON', async () => {
    const response = invalidJsonResponse(new SyntaxError('invalid'));
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'Invalid request body' });
    expect(invalidJsonResponse(new TypeError('unexpected'))).toBeNull();
  });
});
