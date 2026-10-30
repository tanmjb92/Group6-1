import { cookies } from 'next/headers';
import type { User } from './db';
import { getSessionSecret } from './auth/config';
import { SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from './auth/session-token';

const SESSION_COOKIE = 'todo-session';

export async function createSession(user: Pick<User, 'id' | 'username'>): Promise<void> {
  const token = await signSessionToken(
    { userId: user.id, username: user.username },
    getSessionSecret(),
  );
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function getSession(): Promise<{ userId: number; username: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  return verifySessionToken(token, getSessionSecret());
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
