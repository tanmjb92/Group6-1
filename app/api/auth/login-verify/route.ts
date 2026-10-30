import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { getWebAuthnConfig } from '@/lib/auth/config';
import { isCounterAdvanceValid } from '@/lib/auth/counter';
import { invalidJsonResponse, rejectCrossOriginRequest } from '@/lib/auth/route-utils';
import { authenticationResponseSchema } from '@/lib/auth/validation';
import { authenticatorDB, challengeStore, userDB } from '@/lib/db';

const INVALID_LOGIN = 'Invalid username or passkey';

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  let input: unknown;
  try {
    input = await request.json();
  } catch (error) {
    const response = invalidJsonResponse(error);
    if (response) return response;
    throw error;
  }
  const parsed = authenticationResponseSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
  }

  const { username, response } = parsed.data;
  const expectedChallenge = challengeStore.consume(username, 'authentication');
  if (!expectedChallenge) {
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
  }

  const user = userDB.findByUsername(username);
  const authenticator = authenticatorDB.findByCredentialId(response.id);
  if (!user || !authenticator || authenticator.user_id !== user.id) {
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
  }

  const { rpID, rpOrigin } = getWebAuthnConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rpOrigin,
      expectedRPID: rpID,
      credential: {
        id: isoBase64URL.fromBuffer(isoBase64URL.toBuffer(authenticator.credential_id)),
        publicKey: Uint8Array.from(authenticator.credential_public_key),
        counter: authenticator.counter ?? 0,
      },
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
  }

  const storedCounter = authenticator.counter ?? 0;
  const newCounter = verification.authenticationInfo.newCounter ?? 0;
  if (
    !verification.verified ||
    !isCounterAdvanceValid(storedCounter, newCounter) ||
    !authenticatorDB.updateCounter(
      authenticator.id,
      user.id,
      storedCounter,
      newCounter,
    )
  ) {
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
  }

  await createSession(user);
  return NextResponse.json({ success: true });
}
