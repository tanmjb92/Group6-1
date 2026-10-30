import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';

const username = z.string().trim().min(1).max(64);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasStringFields(value: unknown, fields: string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string');
}

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.rawId !== 'string' ||
    value.type !== 'public-key' ||
    !isRecord(value.clientExtensionResults) ||
    !hasStringFields(value.response, ['attestationObject', 'clientDataJSON'])
  ) {
    return false;
  }
  return true;
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.rawId !== 'string' ||
    value.type !== 'public-key' ||
    !isRecord(value.clientExtensionResults) ||
    !hasStringFields(value.response, ['authenticatorData', 'clientDataJSON', 'signature'])
  ) {
    return false;
  }
  return true;
}

export const usernameRequestSchema = z.object({ username }).strict();
export const registrationResponseSchema = z
  .object({
    username,
    response: z.custom<RegistrationResponseJSON>(isRegistrationResponse),
  })
  .strict();
export const authenticationResponseSchema = z
  .object({
    username,
    response: z.custom<AuthenticationResponseJSON>(isAuthenticationResponse),
  })
  .strict();
