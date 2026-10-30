import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth/session-token';

const SESSION_COOKIE = 'todo-session';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  const session =
    token && secret ? await verifySessionToken(token, secret) : null;

  if (request.nextUrl.pathname === '/login' && session) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  if (
    (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/calendar') &&
    !session
  ) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/calendar', '/login'],
};
