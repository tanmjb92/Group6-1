import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createChallengeStore } from './challenge-store';

describe('challenge store', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('returns a saved challenge once and then consumes it', () => {
    database = new Database(':memory:');
    const store = createChallengeStore(database);

    store.save('alice', 'registration', 'challenge-one');

    expect(store.consume('alice', 'registration')).toBe('challenge-one');
    expect(store.consume('alice', 'registration')).toBeNull();
  });

  it('isolates challenges by username and ceremony', () => {
    database = new Database(':memory:');
    const store = createChallengeStore(database);

    store.save('alice', 'registration', 'register-alice');
    store.save('alice', 'authentication', 'login-alice');
    store.save('bob', 'registration', 'register-bob');

    expect(store.consume('alice', 'authentication')).toBe('login-alice');
    expect(store.consume('bob', 'registration')).toBe('register-bob');
    expect(store.consume('alice', 'registration')).toBe('register-alice');
  });

  it('rejects and removes expired challenges', () => {
    database = new Database(':memory:');
    let now = 1_000;
    const store = createChallengeStore(database, () => now, 100);

    store.save('alice', 'authentication', 'expired');
    now += 101;

    expect(store.consume('alice', 'authentication')).toBeNull();
    expect(store.consume('alice', 'authentication')).toBeNull();
  });

  it('replaces an older challenge for the same ceremony', () => {
    database = new Database(':memory:');
    const store = createChallengeStore(database);

    store.save('alice', 'registration', 'old');
    store.save('alice', 'registration', 'new');

    expect(store.consume('alice', 'registration')).toBe('new');
  });
});
