import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionSecret, getWebAuthnConfig } from '@/lib/auth/config';
import { invalidJsonResponse, rejectCrossOriginRequest } from '@/lib/auth/route-utils';
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
  const user = userDB.findByUsername(username);
  const credentials = user ? authenticatorDB.findAllByUser(user.id) : [];
  const { rpID } = getWebAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((credential) => ({
      id: credential.credential_id,
    })),
    userVerification: 'required',
  });

  challengeStore.save(username, 'authentication', options.challenge);
  return NextResponse.json(options);
}
