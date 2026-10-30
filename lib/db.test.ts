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

describe('todo database', () => {
  let database: ReturnType<typeof createDatabase> | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('creates todos with defaults and scopes reads by user', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('todo-owner');
    const otherUser = database.userDB.create('other-owner');
    const todo = database.todoDB.create(user.id, { title: '  Buy milk  ' });

    expect(todo).toMatchObject({
      user_id: user.id,
      title: 'Buy milk',
      completed: false,
      due_date: null,
      priority: 'medium',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      updated_at: null,
    });
    expect(database.todoDB.findAllByUser(user.id)).toEqual([todo]);
    expect(database.todoDB.findAllByUser(otherUser.id)).toEqual([]);
    expect(database.todoDB.findById(todo.id, otherUser.id)).toBeNull();
  });

  it('updates only supplied fields and refreshes updated_at', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('todo-owner');
    const todo = database.todoDB.create(user.id, { title: 'Original' });
    const updated = database.todoDB.update(todo.id, user.id, {
      title: 'Renamed',
      completed: true,
    });

    expect(updated).toMatchObject({
      id: todo.id,
      user_id: user.id,
      title: 'Renamed',
      completed: true,
    });
    expect(updated?.updated_at).toBeTruthy();
    expect(database.todoDB.update(todo.id, user.id + 1, { title: 'Unauthorized' })).toBeNull();
    expect(database.todoDB.findById(todo.id, user.id)?.title).toBe('Renamed');
  });

  it('persists recurrence settings when creating and updating todos', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('recurrence-owner');
    const todo = database.todoDB.create(user.id, {
      title: 'Pay rent',
      due_date: '2026-02-01T01:00:00.000Z',
      is_recurring: true,
      recurrence_pattern: 'monthly',
    });

    expect(todo).toMatchObject({ is_recurring: true, recurrence_pattern: 'monthly' });
    expect(
      database.todoDB.update(todo.id, user.id, {
        is_recurring: false,
        recurrence_pattern: null,
      }),
    ).toMatchObject({ is_recurring: false, recurrence_pattern: null });
  });

  it('completes a recurring todo and creates at most one next occurrence atomically', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('recurrence-owner');
    const todo = database.todoDB.create(user.id, {
      title: 'Pay rent',
      due_date: '2026-02-01T01:00:00.000Z',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'monthly',
      reminder_minutes: 60,
    });
    const calculateNext = (dueDate: string, pattern: 'daily' | 'weekly' | 'monthly' | 'yearly') =>
      pattern === 'monthly' ? '2026-03-01T01:00:00.000Z' : dueDate;

    const first = database.todoDB.updateWithNextOccurrence(
      todo.id,
      user.id,
      { completed: true },
      calculateNext,
    );
    const repeated = database.todoDB.updateWithNextOccurrence(
      todo.id,
      user.id,
      { completed: true },
      calculateNext,
    );
    database.todoDB.update(todo.id, user.id, { completed: false });
    const completedAgain = database.todoDB.updateWithNextOccurrence(
      todo.id,
      user.id,
      { completed: true },
      calculateNext,
    );

    expect(first.todo).toMatchObject({ id: todo.id, completed: true });
    expect(first.nextInstance).toMatchObject({
      title: 'Pay rent',
      due_date: '2026-03-01T01:00:00.000Z',
      priority: 'high',
      completed: false,
      is_recurring: true,
      recurrence_pattern: 'monthly',
      reminder_minutes: 60,
    });
    expect(repeated).toMatchObject({ todo: { id: todo.id, completed: true }, nextInstance: null });
    expect(completedAgain).toMatchObject({
      todo: { id: todo.id, completed: true },
      nextInstance: null,
    });
    expect(database.todoDB.findAllByUser(user.id)).toHaveLength(2);
  });

  it('does not create another occurrence for non-recurring completion', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('recurrence-owner');
    const todo = database.todoDB.create(user.id, { title: 'One-off task' });

    const result = database.todoDB.updateWithNextOccurrence(
      todo.id,
      user.id,
      { completed: true },
      () => {
        throw new Error('Date calculation should not run');
      },
    );

    expect(result).toMatchObject({ todo: { completed: true }, nextInstance: null });
    expect(database.todoDB.findAllByUser(user.id)).toHaveLength(1);
  });

  it('deletes only an owned todo and cascades to dependent rows', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('todo-owner');
    const otherUser = database.userDB.create('other-owner');
    const todo = database.todoDB.create(user.id, { title: 'Delete me' });
    database.connection.exec(`
      CREATE TABLE subtasks (
        id INTEGER PRIMARY KEY,
        todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE todo_tags (
        todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
      );
    `);
    database.connection.prepare('INSERT INTO subtasks (todo_id) VALUES (?)').run(todo.id);
    const tagId = Number(
      database.connection.prepare('INSERT INTO tags (user_id) VALUES (?)').run(user.id)
        .lastInsertRowid,
    );
    database.connection
      .prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')
      .run(todo.id, tagId);

    expect(database.todoDB.delete(todo.id, otherUser.id)).toBe(false);
    expect(database.todoDB.delete(todo.id, user.id)).toBe(true);
    expect(database.todoDB.findById(todo.id, user.id)).toBeNull();
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM subtasks').get()).toEqual({
      count: 0,
    });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM todo_tags').get()).toEqual({
      count: 0,
    });
  });

});
