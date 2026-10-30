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

  it('attaches tags atomically, hydrates them, and keeps ownership isolated', () => {
    database = createDatabase(':memory:');
    const owner = database.userDB.create('tag-owner');
    const other = database.userDB.create('tag-other');
    const todo = database.todoDB.create(owner.id, { title: 'Tagged task' });
    const ownTag = database.tagDB.create(owner.id, { name: 'Work' });
    const otherTag = database.tagDB.create(other.id, { name: 'Work' });

    expect(database.tagDB.attachToTodo(todo.id, ownTag.id, owner.id)).toBe(true);
    expect(database.tagDB.attachToTodo(todo.id, ownTag.id, owner.id)).toBe(true);
    expect(database.tagDB.attachToTodo(todo.id, otherTag.id, owner.id)).toBe(false);
    expect(database.todoDB.findById(todo.id, owner.id)?.tags).toEqual([ownTag]);
    expect(database.todoDB.findAllByUser(owner.id)[0].tags).toEqual([ownTag]);
    expect(database.tagDB.findAllByUser(other.id)).toEqual([otherTag]);
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM todo_tags').get()).toEqual({
      count: 1,
    });
  });

  it('keeps same-user tag names unique, scopes updates, and cascades tag deletion', () => {
    const activeDatabase = createDatabase(':memory:');
    database = activeDatabase;
    const owner = activeDatabase.userDB.create('tag-owner');
    const other = activeDatabase.userDB.create('tag-other');
    const todo = activeDatabase.todoDB.create(owner.id, { title: 'Tagged task' });
    const tag = activeDatabase.tagDB.create(owner.id, { name: 'Work' });
    expect(activeDatabase.tagDB.create(other.id, { name: 'Work' }).name).toBe('Work');
    expect(() => activeDatabase.tagDB.create(owner.id, { name: 'Work' })).toThrow();
    expect(activeDatabase.tagDB.update(tag.id, other.id, { name: 'Private' })).toBeNull();
    activeDatabase.tagDB.attachToTodo(todo.id, tag.id, owner.id);

    expect(activeDatabase.tagDB.delete(tag.id, other.id)).toBe(false);
    expect(activeDatabase.tagDB.delete(tag.id, owner.id)).toBe(true);
    expect(activeDatabase.todoDB.findById(todo.id, owner.id)?.tags).toEqual([]);
    expect(activeDatabase.connection.prepare('SELECT COUNT(*) AS count FROM todo_tags').get()).toEqual({
      count: 0,
    });
  });

  it('atomically replaces todo tags and rolls back invalid cross-user assignments', () => {
    const activeDatabase = createDatabase(':memory:');
    database = activeDatabase;
    const owner = activeDatabase.userDB.create('tag-owner');
    const other = activeDatabase.userDB.create('tag-other');
    const first = activeDatabase.tagDB.create(owner.id, { name: 'First' });
    const second = activeDatabase.tagDB.create(owner.id, { name: 'Second' });
    const foreign = activeDatabase.tagDB.create(other.id, { name: 'Foreign' });

    expect(() => activeDatabase.todoDB.create(owner.id, { title: 'Invalid', tag_ids: [first.id, foreign.id] }))
      .toThrow();
    expect(activeDatabase.todoDB.findAllByUser(owner.id)).toEqual([]);
    const todo = activeDatabase.todoDB.create(owner.id, { title: 'Valid', tag_ids: [first.id] });
    expect(() => activeDatabase.todoDB.update(todo.id, owner.id, { title: 'Changed', tag_ids: [foreign.id] }))
      .toThrow();
    expect(activeDatabase.todoDB.findById(todo.id, owner.id)).toMatchObject({
      title: 'Valid',
      tags: [first],
    });
    expect(activeDatabase.todoDB.update(todo.id, owner.id, { tag_ids: [second.id, second.id] })?.tags)
      .toEqual([second]);
  });

  it('copies tag associations to recurring instances in the completion transaction', () => {
    const activeDatabase = createDatabase(':memory:');
    database = activeDatabase;
    const user = activeDatabase.userDB.create('recurrence-tags-owner');
    const tag = activeDatabase.tagDB.create(user.id, { name: 'Repeat' });
    const todo = activeDatabase.todoDB.create(user.id, {
      title: 'Tagged repeat',
      due_date: '2026-02-01T01:00:00.000Z',
      is_recurring: true,
      recurrence_pattern: 'monthly',
      tag_ids: [tag.id],
    });

    const result = activeDatabase.todoDB.updateWithNextOccurrence(
      todo.id,
      user.id,
      { completed: true },
      () => '2026-03-01T01:00:00.000Z',
    );
    expect(result.nextInstance?.tags).toEqual([tag]);
  });

  it('detaches an association idempotently and rejects foreign todo access', () => {
    const activeDatabase = createDatabase(':memory:');
    database = activeDatabase;
    const owner = activeDatabase.userDB.create('tag-owner');
    const other = activeDatabase.userDB.create('tag-other');
    const todo = activeDatabase.todoDB.create(owner.id, { title: 'Tagged task' });
    const tag = activeDatabase.tagDB.create(owner.id, { name: 'Work' });
    expect(activeDatabase.tagDB.detachFromTodo(todo.id, tag.id, owner.id)).toBe(true);
    expect(activeDatabase.tagDB.attachToTodo(todo.id, tag.id, owner.id)).toBe(true);
    expect(activeDatabase.tagDB.detachFromTodo(todo.id, tag.id, owner.id)).toBe(true);
    expect(activeDatabase.tagDB.detachFromTodo(todo.id, tag.id, other.id)).toBe(false);
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
    `);
    database.connection.prepare('INSERT INTO subtasks (todo_id) VALUES (?)').run(todo.id);
    const tag = database.tagDB.create(user.id, { name: 'Cascade' });
    database.tagDB.attachToTodo(todo.id, tag.id, user.id);

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
