import type Database from 'better-sqlite3';

export type Ceremony = 'registration' | 'authentication';

export interface ChallengeStore {
  save(username: string, ceremony: Ceremony, challenge: string): void;
  consume(username: string, ceremony: Ceremony): string | null;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createChallengeStore(
  database: Database.Database,
  now: () => number = Date.now,
  ttlMs = DEFAULT_TTL_MS,
): ChallengeStore {
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      username TEXT NOT NULL,
      ceremony TEXT NOT NULL CHECK(ceremony IN ('registration', 'authentication')),
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (username, ceremony)
    )
  `);

  const saveStatement = database.prepare(`
    INSERT INTO auth_challenges (username, ceremony, challenge, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(username, ceremony) DO UPDATE SET
      challenge = excluded.challenge,
      expires_at = excluded.expires_at
  `);
  const removeExpiredStatement = database.prepare(
    'DELETE FROM auth_challenges WHERE expires_at <= ?',
  );
  const readStatement = database.prepare(`
    SELECT challenge, expires_at
    FROM auth_challenges
    WHERE username = ? AND ceremony = ?
  `);
  const deleteStatement = database.prepare(`
    DELETE FROM auth_challenges
    WHERE username = ? AND ceremony = ?
  `);
  const consumeTransaction = database.transaction(
    (username: string, ceremony: Ceremony): string | null => {
      const row = readStatement.get(username, ceremony) as
        | { challenge: string; expires_at: number }
        | undefined;
      deleteStatement.run(username, ceremony);
      return row && row.expires_at > now() ? row.challenge : null;
    },
  );

  return {
    save(username, ceremony, challenge) {
      const currentTime = now();
      removeExpiredStatement.run(currentTime);
      saveStatement.run(username, ceremony, challenge, currentTime + ttlMs);
    },
    consume(username, ceremony) {
      return consumeTransaction.immediate(username, ceremony);
    },
  };
}
