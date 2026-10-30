import { createHash } from 'node:crypto';

export function getWebAuthnUserId(username: string): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(username, 'utf8').digest();
  const userId = new Uint8Array(32);
  userId.set(digest);
  return userId;
}
