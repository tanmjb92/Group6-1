export interface WebAuthnConfig {
  rpName: string;
  rpID: string;
  rpOrigin: string;
}

export function getWebAuthnConfig(): WebAuthnConfig {
  const rpName = process.env.RP_NAME?.trim();
  const rpID = process.env.RP_ID?.trim().toLowerCase();
  const rpOrigin = process.env.RP_ORIGIN?.trim();

  if (!rpName || !rpID || !rpOrigin) {
    throw new Error('RP_NAME, RP_ID, and RP_ORIGIN must be configured');
  }

  let origin: URL;
  try {
    origin = new URL(rpOrigin);
  } catch {
    throw new Error('RP_ORIGIN must be a valid origin URL');
  }

  if (
    origin.origin !== rpOrigin ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === 'localhost')) ||
    (origin.hostname !== rpID && !origin.hostname.endsWith(`.${rpID}`))
  ) {
    throw new Error('RP_ORIGIN must be HTTPS and use RP_ID as its host or parent domain');
  }

  return { rpName, rpID, rpOrigin };
}

export function isSameOriginRequest(request: Request, rpOrigin: string): boolean {
  return request.headers.get('origin') === rpOrigin;
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  }
  return secret;
}
