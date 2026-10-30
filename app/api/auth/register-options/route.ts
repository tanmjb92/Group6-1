import { generateRegistrationOptions } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSessionSecret, getWebAuthnConfig } from '@/lib/auth/config';
import { rejectCrossOriginRequest, invalidJsonResponse } from '@/lib/auth/route-utils';
import { getWebAuthnUserId } from '@/lib/auth/user-handle';
import { usernameRequestSchema } from '@/lib/auth/validation';
import { authenticatorDB, challengeStore, userDB } from '@/lib/db';

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
  const parsed = usernameRequestSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid username is required' }, { status: 400 });
  }

  const { username } = parsed.data;
  getSessionSecret();
  const existingUser = userDB.findByUsername(username);
  const session = await getSession();

  if (existingUser && session?.userId !== existingUser.id) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }
  if (!existingUser && session) {
    return NextResponse.json(
      { error: 'Log out before registering a different account' },
      { status: 409 },
    );
  }

  const { rpName, rpID } = getWebAuthnConfig();
  const existingCredentials = existingUser
    ? authenticatorDB.findAllByUser(existingUser.id)
    : [];
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: username,
    userID: getWebAuthnUserId(username),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: existingCredentials.map((credential) => ({
      id: credential.credential_id,
    })),
  });

  challengeStore.save(username, 'registration', options.challenge);
  return NextResponse.json(options);
}
