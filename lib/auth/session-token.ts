import { SignJWT, jwtVerify } from 'jose';

export interface Session {
  userId: number;
  username: string;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SESSION_ISSUER = 'todo-app';
const encoder = new TextEncoder();

function getSigningKey(secret: string): Uint8Array {
  const key = encoder.encode(secret);
  if (key.byteLength < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  }
  return key;
}

export async function signSessionToken(
  session: Session,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!Number.isSafeInteger(session.userId) || session.userId <= 0 || !session.username) {
    throw new Error('Invalid session');
  }

  return new SignJWT({ username: session.username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(SESSION_ISSUER)
    .setSubject(String(session.userId))
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SESSION_TTL_SECONDS)
    .sign(getSigningKey(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(secret), {
      algorithms: ['HS256'],
      issuer: SESSION_ISSUER,
      currentDate: new Date(nowSeconds * 1000),
    });
    const userId = Number(payload.sub);
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      typeof payload.username !== 'string' ||
      payload.username.length === 0
    ) {
      return null;
    }

    return { userId, username: payload.username };
  } catch {
    return null;
  }
}
