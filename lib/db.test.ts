import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './db';

describe('authentication database', () => {
  let database: ReturnType<typeof createDatabase> | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('creates users and stores multiple authenticators per user', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('alice');

    database.authenticatorDB.create({
      user_id: user.id,
      credential_id: 'credential-one',
      credential_public_key: Buffer.from([1, 2, 3]),
      counter: 0,
    });
    database.authenticatorDB.create({
      user_id: user.id,
      credential_id: 'credential-two',
      credential_public_key: Buffer.from([4, 5, 6]),
      counter: 2,
    });

    expect(database.authenticatorDB.findAllByUser(user.id)).toHaveLength(2);
    expect(database.authenticatorDB.findByCredentialId('credential-two')?.counter).toBe(2);
  });

  it('updates counters only when the expected stored value still matches', () => {
    database = createDatabase(':memory:');
    const { user, authenticator } = database.createUserWithAuthenticator('alice', {
      credential_id: 'credential-one',
      credential_public_key: Buffer.from([1]),
      counter: 4,
    });

    expect(database.authenticatorDB.updateCounter(authenticator.id, user.id, 4, 5)).toBe(true);
    expect(database.authenticatorDB.updateCounter(authenticator.id, user.id, 4, 6)).toBe(false);
    expect(database.authenticatorDB.findByCredentialId('credential-one')?.counter).toBe(5);
  });

  it('creates a user and authenticator atomically and cascades user deletion', () => {
    database = createDatabase(':memory:');
    const { user, authenticator } = database.createUserWithAuthenticator('alice', {
      credential_id: 'credential-one',
      credential_public_key: Buffer.from([1]),
      counter: 0,
    });

    expect(authenticator.user_id).toBe(user.id);
    database.userDB.delete(user.id);
    expect(database.authenticatorDB.findByCredentialId('credential-one')).toBeNull();
  });

  it('rolls back user creation when authenticator insertion fails', () => {
    const activeDatabase = createDatabase(':memory:');
    database = activeDatabase;
    const firstUser = activeDatabase.userDB.create('alice');
    activeDatabase.authenticatorDB.create({
      user_id: firstUser.id,
      credential_id: 'duplicate-credential',
      credential_public_key: Buffer.from([1]),
      counter: 0,
    });

    expect(() =>
      activeDatabase.createUserWithAuthenticator('bob', {
        credential_id: 'duplicate-credential',
        credential_public_key: Buffer.from([2]),
        counter: 0,
      }),
    ).toThrow();
    expect(activeDatabase.userDB.findByUsername('bob')).toBeNull();
  });
});
