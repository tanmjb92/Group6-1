import { NextResponse } from 'next/server';
import { getWebAuthnConfig, isSameOriginRequest } from './config';

export function rejectCrossOriginRequest(request: Request): NextResponse | null {
  const { rpOrigin } = getWebAuthnConfig();
  if (!isSameOriginRequest(request, rpOrigin)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  return null;
}

export function invalidJsonResponse(error: unknown): NextResponse | null {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  return null;
}
