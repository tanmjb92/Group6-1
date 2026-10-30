import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { createSession, getSession } from '@/lib/auth';
import { getWebAuthnConfig } from '@/lib/auth/config';
import { invalidJsonResponse, rejectCrossOriginRequest } from '@/lib/auth/route-utils';
import { registrationResponseSchema } from '@/lib/auth/validation';
import {
  authenticatorDB,
  challengeStore,
  createUserWithAuthenticator,
  userDB,
} from '@/lib/db';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

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
  const parsed = registrationResponseSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid registration response' }, { status: 400 });
  }

  const { username, response } = parsed.data;
  const expectedChallenge = challengeStore.consume(username, 'registration');
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: 'Registration challenge expired or invalid' },
      { status: 400 },
    );
  }

  const existingUser = userDB.findByUsername(username);
  const session = await getSession();
  if (existingUser && session?.userId !== existingUser.id) {
    return NextResponse.json({ error: 'Registration is no longer available' }, { status: 409 });
  }
  if (!existingUser && session) {
    return NextResponse.json({ error: 'Registration is no longer available' }, { status: 409 });
  }

  const { rpID, rpOrigin } = getWebAuthnConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rpOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ error: 'Passkey registration could not be verified' }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Passkey registration could not be verified' }, { status: 400 });
  }

  const credential = verification.registrationInfo.credential;
  const credentialId = isoBase64URL.fromBuffer(isoBase64URL.toBuffer(credential.id));
  const authenticator = {
    credential_id: credentialId,
    credential_public_key: credential.publicKey,
    counter: credential.counter ?? 0,
  };

  try {
    if (existingUser) {
      authenticatorDB.create({ ...authenticator, user_id: existingUser.id });
    } else {
      const { user } = createUserWithAuthenticator(username, authenticator);
      await createSession(user);
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: 'Username or passkey is already registered' },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ success: true });
}
