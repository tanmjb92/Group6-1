import Database from 'better-sqlite3';
import { createChallengeStore } from './auth/challenge-store';

export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface NewAuthenticator {
  user_id: number;
  credential_id: string;
  credential_public_key: Uint8Array;
  counter: number;
}

function toUser(row: User | undefined): User | null {
  return row ?? null;
}

export function createDatabase(filename: string): ReturnType<typeof createAuthDatabase> {
  return createAuthDatabase(new Database(filename));
}

function createAuthDatabase(connection: Database.Database) {
  connection.pragma('foreign_keys = ON');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
  `);

  const userByUsername = connection.prepare(
    'SELECT id, username, created_at FROM users WHERE username = ?',
  );
  const userById = connection.prepare(
    'SELECT id, username, created_at FROM users WHERE id = ?',
  );
  const authenticatorByCredentialId = connection.prepare(
    `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
     FROM authenticators WHERE credential_id = ?`,
  );
  const authenticatorsByUser = connection.prepare(
    `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
     FROM authenticators WHERE user_id = ?`,
  );

  const userDB = {
    findByUsername(username: string): User | null {
      return toUser(userByUsername.get(username) as User | undefined);
    },
    findById(id: number): User | null {
      return toUser(userById.get(id) as User | undefined);
    },
    create(username: string): User {
      const result = connection.prepare('INSERT INTO users (username) VALUES (?)').run(username);
      const user = userById.get(Number(result.lastInsertRowid)) as User | undefined;
      if (!user) throw new Error('Created user could not be loaded');
      return user;
    },
    delete(id: number): void {
      connection.prepare('DELETE FROM users WHERE id = ?').run(id);
    },
  };

  const authenticatorDB = {
    findByCredentialId(credentialId: string): Authenticator | null {
      return (
        (authenticatorByCredentialId.get(credentialId) as Authenticator | undefined) ?? null
      );
    },
    findAllByUser(userId: number): Authenticator[] {
      return authenticatorsByUser.all(userId) as Authenticator[];
    },
    create(authenticator: NewAuthenticator): Authenticator {
      const result = connection
        .prepare(
          `INSERT INTO authenticators
            (user_id, credential_id, credential_public_key, counter)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          authenticator.user_id,
          authenticator.credential_id,
          Buffer.from(authenticator.credential_public_key),
          authenticator.counter ?? 0,
        );
      const row = connection
        .prepare(
          `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
           FROM authenticators WHERE id = ?`,
        )
        .get(Number(result.lastInsertRowid)) as Authenticator | undefined;
      if (!row) throw new Error('Created authenticator could not be loaded');
      return row;
    },
    updateCounter(
      id: number,
      userId: number,
      expectedCounter: number,
      counter: number,
    ): boolean {
      return (
        connection
          .prepare(
            `UPDATE authenticators SET counter = ?
             WHERE id = ? AND user_id = ? AND counter = ?`,
          )
          .run(counter ?? 0, id, userId, expectedCounter ?? 0).changes === 1
      );
    },
    deleteForUser(userId: number): void {
      connection.prepare('DELETE FROM authenticators WHERE user_id = ?').run(userId);
    },
  };

  const createUserWithAuthenticator = connection.transaction(
    (username: string, authenticator: Omit<NewAuthenticator, 'user_id'>) => {
      const user = userDB.create(username);
      const createdAuthenticator = authenticatorDB.create({
        ...authenticator,
        user_id: user.id,
      });
      return { user, authenticator: createdAuthenticator };
    },
  );

  return {
    connection,
    userDB,
    authenticatorDB,
    createUserWithAuthenticator,
    challengeStore: createChallengeStore(connection),
    close(): void {
      connection.close();
    },
  };
}

const database = createDatabase(process.env.DATABASE_PATH ?? 'todos.db');

export const db = database.connection;
export const userDB = database.userDB;
export const authenticatorDB = database.authenticatorDB;
export const createUserWithAuthenticator = database.createUserWithAuthenticator;
export const challengeStore = database.challengeStore;
