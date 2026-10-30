import { afterEach, describe, expect, it, vi } from 'vitest';

const cookieState = vi.hoisted(() => ({
  value: undefined as string | undefined,
  options: undefined as
    | {
        httpOnly: boolean;
        secure: boolean;
        sameSite: string;
        path: string;
        maxAge: number;
      }
    | undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (cookieState.value ? { value: cookieState.value } : undefined),
    set: (_name: string, value: string, options: typeof cookieState.options) => {
      cookieState.value = value;
      cookieState.options = options;
    },
    delete: () => {
      cookieState.value = undefined;
    },
  }),
}));

import { createSession, deleteSession, getSession } from './auth';

afterEach(() => {
  cookieState.value = undefined;
  cookieState.options = undefined;
  vi.unstubAllEnvs();
});

describe('session cookie lifecycle', () => {
  it('creates an HTTP-only seven-day cookie, reads it, and clears it', async () => {
    vi.stubEnv('SESSION_SECRET', 'a sufficiently long secret value for tests');
    vi.stubEnv('NODE_ENV', 'production');
    const user = { id: 21, username: 'alice' };

    await createSession(user);

    expect(cookieState.value).toBeTruthy();
    expect(cookieState.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 604800,
    });
    await expect(getSession()).resolves.toEqual({ userId: 21, username: 'alice' });

    await deleteSession();
    await expect(getSession()).resolves.toBeNull();
  });

  it('does not set Secure for local development cookies', async () => {
    vi.stubEnv('SESSION_SECRET', 'a sufficiently long secret value for tests');
    vi.stubEnv('NODE_ENV', 'development');

    await createSession({ id: 1, username: 'local-user' });

    expect(cookieState.options?.secure).toBe(false);
  });
});
