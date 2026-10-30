import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionSecret, getWebAuthnConfig, isSameOriginRequest } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('WebAuthn configuration', () => {
  it('requires all RP settings', () => {
    vi.stubEnv('RP_NAME', '');
    vi.stubEnv('RP_ID', '');
    vi.stubEnv('RP_ORIGIN', '');

    expect(() => getWebAuthnConfig()).toThrow('RP_NAME, RP_ID, and RP_ORIGIN must be configured');
  });

  it('accepts localhost HTTP and HTTPS subdomains under the configured RP ID', () => {
    vi.stubEnv('RP_NAME', ' Todo App ');
    vi.stubEnv('RP_ID', 'example.com');
    vi.stubEnv('RP_ORIGIN', 'https://app.example.com');

    expect(getWebAuthnConfig()).toEqual({
      rpName: 'Todo App',
      rpID: 'example.com',
      rpOrigin: 'https://app.example.com',
    });

    vi.stubEnv('RP_ID', 'localhost');
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');
    expect(getWebAuthnConfig().rpID).toBe('localhost');
  });

  it('rejects insecure, non-matching, and non-origin RP URLs', () => {
    vi.stubEnv('RP_NAME', 'Todo App');
    vi.stubEnv('RP_ID', 'example.com');
    vi.stubEnv('RP_ORIGIN', 'http://example.com');
    expect(() => getWebAuthnConfig()).toThrow('RP_ORIGIN must be HTTPS');

    vi.stubEnv('RP_ORIGIN', 'https://notexample.com');
    expect(() => getWebAuthnConfig()).toThrow('RP_ORIGIN must be HTTPS');

    vi.stubEnv('RP_ORIGIN', 'https://example.com/path');
    expect(() => getWebAuthnConfig()).toThrow('RP_ORIGIN must be HTTPS');

    vi.stubEnv('RP_ORIGIN', 'not-an-origin');
    expect(() => getWebAuthnConfig()).toThrow('RP_ORIGIN must be a valid origin URL');
  });

  it('requires a strong session signing secret', () => {
    vi.stubEnv('SESSION_SECRET', 'short');
    expect(() => getSessionSecret()).toThrow('SESSION_SECRET must contain at least 32 bytes');

    vi.stubEnv('SESSION_SECRET', 'a sufficiently long secret value for tests');
    expect(getSessionSecret()).toBe('a sufficiently long secret value for tests');
  });

  it('requires the exact configured request origin', () => {
    const request = new Request('https://app.example.com/api/auth/logout', {
      headers: { origin: 'https://app.example.com' },
    });
    expect(isSameOriginRequest(request, 'https://app.example.com')).toBe(true);
    expect(isSameOriginRequest(request, 'https://example.com')).toBe(false);
    expect(isSameOriginRequest(new Request(request.url), 'https://app.example.com')).toBe(false);
  });
});
