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

  it('finds due reminders at inclusive preset boundaries across Singapore midnight', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('reminder-owner');
    const now = '2026-03-08T23:59:00.000Z';
    const presets = [15, 30, 60, 120, 1440, 2880, 10080] as const;
    const expected = presets.map((minutes) =>
      database!.todoDB.create(user.id, {
        title: `Reminder ${minutes}`,
        due_date: new Date(Date.parse(now) + minutes * 60_000).toISOString(),
        reminder_minutes: minutes,
      }),
    );
    const outside = database.todoDB.create(user.id, {
      title: 'Outside boundary',
      due_date: new Date(Date.parse(now) + 60 * 60_000 + 1).toISOString(),
      reminder_minutes: 60,
    });

    expect(database.todoDB.findDueReminders(user.id, now).map((todo) => todo.id)).toEqual(
      expected.map((todo) => todo.id),
    );
    expect(
      database.todoDB
        .findDueReminders(user.id, new Date(Date.parse(now) + 1).toISOString())
        .map((todo) => todo.id)
        .sort((left, right) => left - right),
    ).toEqual([...expected.map((todo) => todo.id), outside.id].sort((left, right) => left - right));
    expect(expected[4].due_date).toBe('2026-03-09T23:59:00.000Z');
    expect(expected[6].due_date).toBe('2026-03-15T23:59:00.000Z');
  });

  it('includes arbitrarily overdue reminders and excludes completed, sent, unconfigured, and foreign todos', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('reminder-owner');
    const other = database.userDB.create('other-reminder-owner');
    const dueDate = '2026-03-09T00:00:00.000Z';
    const overdue = database.todoDB.create(user.id, {
      title: 'Overdue reminder',
      due_date: dueDate,
      reminder_minutes: 15,
    });
    const completed = database.todoDB.create(user.id, {
      title: 'Completed reminder',
      due_date: dueDate,
      reminder_minutes: 15,
    });
    database.todoDB.update(completed.id, user.id, { completed: true });
    const sent = database.todoDB.create(user.id, {
      title: 'Sent reminder',
      due_date: dueDate,
      reminder_minutes: 15,
    });
    database.todoDB.acknowledgeReminder(
      sent.id,
      user.id,
      dueDate,
      15,
      '2026-03-08T23:59:00.000Z',
    );
    database.todoDB.create(user.id, { title: 'No date', reminder_minutes: 15 });
    database.todoDB.create(user.id, { title: 'No reminder', due_date: dueDate });
    database.todoDB.create(other.id, {
      title: 'Foreign reminder',
      due_date: dueDate,
      reminder_minutes: 15,
    });

    expect(database.todoDB.findDueReminders(user.id, '2026-03-15T00:00:00.000Z')).toEqual([
      expect.objectContaining({ id: overdue.id }),
    ]);
  });

  it('resets sent state only when due date or reminder timing changes and rejects stale or foreign acknowledgements', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('reminder-owner');
    const other = database.userDB.create('other-reminder-owner');
    const originalDueDate = '2026-03-10T00:00:00.000Z';
    const todo = database.todoDB.create(user.id, {
      title: 'Reminder reset',
      due_date: originalDueDate,
      reminder_minutes: 60,
    });
    const firstSentAt = '2026-03-09T00:00:00.000Z';

    expect(
      database.todoDB.acknowledgeReminder(todo.id, other.id, originalDueDate, 60, firstSentAt),
    ).toBe(false);
    expect(
      database.todoDB.acknowledgeReminder(todo.id, user.id, originalDueDate, 30, firstSentAt),
    ).toBe(false);
    expect(
      database.todoDB.acknowledgeReminder(todo.id, user.id, originalDueDate, 60, firstSentAt),
    ).toBe(true);
    expect(
      database.todoDB.acknowledgeReminder(todo.id, user.id, originalDueDate, 60, firstSentAt),
    ).toBe(false);

    database.todoDB.update(todo.id, user.id, {
      due_date: originalDueDate,
      reminder_minutes: 60,
    });
    expect(database.todoDB.findById(todo.id, user.id)?.last_notification_sent).toBe(firstSentAt);
    database.todoDB.update(todo.id, user.id, { title: 'Unrelated edit' });
    expect(database.todoDB.findById(todo.id, user.id)?.last_notification_sent).toBe(firstSentAt);

    const nextDueDate = '2026-03-11T00:00:00.000Z';
    database.todoDB.update(todo.id, user.id, { due_date: nextDueDate });
    expect(database.todoDB.findById(todo.id, user.id)?.last_notification_sent).toBeNull();
    expect(
      database.todoDB.acknowledgeReminder(todo.id, user.id, originalDueDate, 60, firstSentAt),
    ).toBe(false);
    expect(
      database.todoDB.acknowledgeReminder(todo.id, user.id, nextDueDate, 60, firstSentAt),
    ).toBe(true);
    database.todoDB.update(todo.id, user.id, { reminder_minutes: 120 });
    expect(database.todoDB.findById(todo.id, user.id)?.last_notification_sent).toBeNull();
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

  it('hydrates tags and subtasks together and preserves both when editing the parent', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('combined-owner');
    const tag = database.tagDB.create(user.id, { name: 'Work' });
    const todo = database.todoDB.create(user.id, { title: 'Parent', tag_ids: [tag.id] });
    const subtask = database.subtaskDB.create(todo.id, { title: 'Child' });

    expect(database.todoDB.findAllByUser(user.id)).toEqual([
      expect.objectContaining({ id: todo.id, tags: [tag], subtasks: [subtask] }),
    ]);
    expect(database.todoDB.update(todo.id, user.id, { title: 'Edited parent' })).toMatchObject({
      title: 'Edited parent',
      tags: [tag],
      subtasks: [subtask],
    });
    expect(database.todoDB.update(todo.id, user.id, { tag_ids: [] })).toMatchObject({
      tags: [],
      subtasks: [subtask],
    });
    database.subtaskDB.update(subtask.id, user.id, { completed: true });
    expect(database.todoDB.findById(todo.id, user.id)).toMatchObject({
      tags: [],
      subtasks: [expect.objectContaining({ id: subtask.id, completed: true })],
    });
  });

  it('deletes only an owned todo and cascades to dependent rows', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('todo-owner');
    const otherUser = database.userDB.create('other-owner');
    const todo = database.todoDB.create(user.id, { title: 'Delete me' });
    database.subtaskDB.create(todo.id, { title: 'Child task' });
    const tag = database.tagDB.create(user.id, { name: 'Cascade' });
    database.tagDB.attachToTodo(todo.id, tag.id, user.id);

    expect(database.todoDB.delete(todo.id, otherUser.id)).toBe(false);
    expect(database.todoDB.delete(todo.id, user.id)).toBe(true);
    expect(database.todoDB.findById(todo.id, user.id)).toBeNull();
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM subtasks').get()).toEqual({ count: 0 });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM todo_tags').get()).toEqual({
      count: 0,
    });
  });

  it('orders subtasks by position and appends after the current maximum', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('todo-owner');
    const todo = database.todoDB.create(user.id, { title: 'Parent' });

    const first = database.subtaskDB.create(todo.id, { title: 'First' });
    const second = database.subtaskDB.create(todo.id, { title: 'Second' });
    database.subtaskDB.delete(first.id, user.id);
    const third = database.subtaskDB.create(todo.id, { title: 'Third' });

    expect([second, third].map(({ title, position }) => ({ title, position }))).toEqual([
      { title: 'Second', position: 1 },
      { title: 'Third', position: 2 },
    ]);
    expect(database.subtaskDB.findByTodoId(todo.id)).toEqual([second, third]);
  });

  it('updates and deletes subtasks only for their owning user', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('todo-owner');
    const otherUser = database.userDB.create('other-owner');
    const todo = database.todoDB.create(user.id, { title: 'Parent' });
    const subtask = database.subtaskDB.create(todo.id, { title: 'Child' });

    expect(database.subtaskDB.update(subtask.id, otherUser.id, { completed: true })).toBeNull();
    expect(database.subtaskDB.delete(subtask.id, otherUser.id)).toBe(false);
    expect(database.subtaskDB.update(subtask.id, user.id, { completed: true })).toMatchObject({
      id: subtask.id,
      completed: true,
    });
    expect(database.subtaskDB.delete(subtask.id, user.id)).toBe(true);
    expect(database.subtaskDB.findByTodoId(todo.id)).toEqual([]);
  });

  it('imports todos with remapped relationships and case-insensitive tag reuse', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('import-owner');
    const existingTag = database.tagDB.create(user.id, { name: 'Work', color: '#111111' });
    const result = database.todoDB.importAll(user.id, [
      {
        title: 'Imported project',
        completed: true,
        due_date: '2026-11-02T03:00:00.000Z',
        priority: 'high',
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: 60,
        created_at: '2026-10-01T00:00:00.000Z',
        subtasks: [
          { title: 'Second step', completed: true, position: 9 },
          { title: 'First step', completed: false, position: 9 },
        ],
        tags: [
          { name: 'work', color: '#FFFFFF' },
          { name: 'Personal', color: '#00AA00' },
        ],
      },
      {
        title: 'Another imported todo',
        completed: false,
        due_date: null,
        priority: 'medium',
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: null,
        created_at: '2026-10-02T00:00:00.000Z',
        subtasks: [],
        tags: [{ name: 'PERSONAL', color: '#0000FF' }],
      },
    ]);

    const imported = database.todoDB.findAllByUser(user.id);
    const first = imported.find((todo) => todo.title === 'Imported project')!;
    const second = imported.find((todo) => todo.title === 'Another imported todo')!;

    expect(result).toEqual({ imported: 2, tagsCreated: 1, tagsReused: 2 });
    expect(first).toMatchObject({
      completed: true,
      due_date: '2026-11-02T03:00:00.000Z',
      priority: 'high',
      reminder_minutes: 60,
      created_at: '2026-10-01T00:00:00.000Z',
    });
    expect(first.tags).toEqual(
      expect.arrayContaining([
        existingTag,
        expect.objectContaining({ name: 'Personal', color: '#00AA00' }),
      ]),
    );
    expect(first.subtasks?.map(({ title, completed, position }) => ({ title, completed, position }))).toEqual([
      { title: 'Second step', completed: true, position: 0 },
      { title: 'First step', completed: false, position: 1 },
    ]);
    expect(second.tags?.[0]).toMatchObject({ name: 'Personal', color: '#00AA00' });
    expect(first.id).not.toBe(0);
    expect(first.subtasks?.every((subtask) => subtask.todo_id === first.id)).toBe(true);
  });

  it('rolls back every imported relation when one row fails', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('import-rollback-owner');
    database.connection.exec(`
      CREATE TRIGGER reject_import_todo
      BEFORE INSERT ON todos
      WHEN NEW.title = 'Reject import'
      BEGIN
        SELECT RAISE(ABORT, 'Import rejected');
      END;
    `);

    expect(() =>
      database!.todoDB.importAll(user.id, [
        {
          title: 'Will roll back',
          completed: false,
          due_date: null,
          priority: 'medium',
          is_recurring: false,
          recurrence_pattern: null,
          reminder_minutes: null,
          created_at: '2026-10-01T00:00:00.000Z',
          subtasks: [{ title: 'Child', completed: false, position: 0 }],
          tags: [{ name: 'New tag', color: '#123456' }],
        },
        {
          title: 'Reject import',
          completed: false,
          due_date: null,
          priority: 'low',
          is_recurring: false,
          recurrence_pattern: null,
          reminder_minutes: null,
          created_at: '2026-10-02T00:00:00.000Z',
          subtasks: [],
          tags: [],
        },
      ]),
    ).toThrow('Import rejected');

    expect(database.todoDB.findAllByUser(user.id)).toEqual([]);
    expect(database.tagDB.findAllByUser(user.id)).toEqual([]);
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM subtasks').get()).toEqual({ count: 0 });
  });

});
