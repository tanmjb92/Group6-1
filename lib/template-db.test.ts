import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type CreateTemplateInput } from './db';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const draft: CreateTemplateInput = {
  name: 'Weekly review', title_template: 'Review tasks', priority: 'high',
  description: 'A snapshot', category: 'Work', is_recurring: true,
  recurrence_pattern: 'weekly', due_date_offset_minutes: 60,
  reminder_minutes: null, subtasks: [],
};

describe('template database', () => {
  let database: ReturnType<typeof createDatabase>;
  afterEach(() => database?.close());

  it('scopes every operation to the owner and supports duplicate names', () => {
    database = createDatabase(':memory:');
    const alice = database.userDB.create('alice');
    const bob = database.userDB.create('bob');
    const template = database.templateDB.create(alice.id, draft);
    database.templateDB.create(alice.id, draft);
    expect(database.templateDB.findAllByUser(alice.id)).toHaveLength(2);
    expect(database.templateDB.findAllByUser(bob.id)).toEqual([]);
    expect(database.templateDB.findById(template.id, bob.id)).toBeNull();
    expect(database.templateDB.update(template.id, bob.id, draft)).toBeNull();
    expect(database.templateDB.use(template.id, bob.id, new Date())).toBeNull();
    expect(database.templateDB.delete(template.id, bob.id)).toBe(false);
  });

  it('creates independent todos using relative offsets and leaves them on template deletion', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('alice');
    const template = database.templateDB.create(user.id, draft);
    const now = new Date('2026-10-30T08:00:00.000Z');
    const todo = database.templateDB.use(template.id, user.id, now)!;
    expect(todo).toMatchObject({
      title: 'Review tasks', priority: 'high', is_recurring: true,
      recurrence_pattern: 'weekly', due_date: '2026-10-30T09:00:00.000Z',
      completed: false, reminder_minutes: null,
    });
    const edited = database.templateDB.update(template.id, user.id, {
      ...draft, title_template: 'Changed', is_recurring: false,
      recurrence_pattern: null, due_date_offset_minutes: null,
    });
    expect(edited?.title_template).toBe('Changed');
    const second = database.templateDB.use(template.id, user.id, now)!;
    expect(second.id).not.toBe(todo.id);
    expect(second.due_date).toBeNull();
    expect(database.todoDB.findById(todo.id, user.id)?.title).toBe('Review tasks');
    expect(database.templateDB.delete(template.id, user.id)).toBe(true);
    expect(database.templateDB.use(template.id, user.id, now)).toBeNull();
    expect(database.templateDB.update(template.id, user.id, draft)).toBeNull();
    expect(database.templateDB.findAllByUser(user.id)).toEqual([]);
    expect(database.todoDB.findAllByUser(user.id)).toHaveLength(2);
  });

  it('cascades templates on user deletion', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('alice');
    database.templateDB.create(user.id, draft);
    database.userDB.delete(user.id);
    expect(database.templateDB.findAllByUser(user.id)).toEqual([]);
  });

  it('round-trips reminder settings and ordered independent unchecked checklists', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('alice');
    const checklist = [{ title: 'Second', position: 5 }, { title: 'First', position: 2 }];
    const template = database.templateDB.create(user.id, { ...draft, reminder_minutes: 30, subtasks: checklist });
    expect(JSON.parse(template.subtasks_json!)).toEqual(checklist);
    const todo = database.templateDB.use(template.id, user.id, new Date())!;
    const second = database.templateDB.use(template.id, user.id, new Date())!;
    expect(todo.reminder_minutes).toBe(30);
    expect(todo.subtasks?.map(({ title, position, completed }) => ({ title, position, completed }))).toEqual([
      { title: 'First', position: 2, completed: false }, { title: 'Second', position: 5, completed: false },
    ]);
    expect(second.subtasks?.[0].id).not.toBe(todo.subtasks?.[0].id);
    database.subtaskDB.update(todo.subtasks![0].id, user.id, { completed: true });
    expect(database.todoDB.findById(second.id, user.id)?.subtasks?.[0].completed).toBe(false);
    database.templateDB.update(template.id, user.id, { ...draft, subtasks: [] });
    expect(database.todoDB.findById(todo.id, user.id)?.subtasks).toHaveLength(2);
  });

  it('rejects corrupted checklists and rolls back if inserting a checklist fails', () => {
    database = createDatabase(':memory:');
    const user = database.userDB.create('alice');
    const template = database.templateDB.create(user.id, {
      ...draft, subtasks: [{ title: 'Task', position: 0 }],
    });
    database.connection.exec(`CREATE TRIGGER reject_template_subtask BEFORE INSERT ON subtasks
      BEGIN SELECT RAISE(ABORT, 'test insertion failure'); END;`);
    expect(() => database.templateDB.use(template.id, user.id, new Date())).toThrow();
    expect(database.todoDB.findAllByUser(user.id)).toEqual([]);
    database.connection.prepare('UPDATE templates SET subtasks_json = ? WHERE id = ?').run('{', template.id);
    expect(() => database.templateDB.use(template.id, user.id, new Date())).toThrow('Stored template checklist is invalid');
    expect(database.todoDB.findAllByUser(user.id)).toEqual([]);
  });

  it('migrates existing template tables without losing rows and can reopen them', () => {
    const folder = mkdtempSync(join(tmpdir(), 'template-migration-'));
    const filename = join(folder, 'test.db');
    try {
      const old = new Database(filename);
      old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, created_at TEXT);
        INSERT INTO users VALUES (1, 'alice', '2026-10-30');
        CREATE TABLE templates (
          id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, description TEXT, category TEXT,
          title_template TEXT, priority TEXT, is_recurring INTEGER, recurrence_pattern TEXT,
          due_date_offset_minutes INTEGER, created_at TEXT);
        INSERT INTO templates VALUES (1,1,'Legacy',NULL,NULL,'Task','medium',0,NULL,NULL,'2026-10-30');`);
      old.close();
      database = createDatabase(filename);
      expect(database.templateDB.findById(1, 1)).toMatchObject({
        name: 'Legacy', reminder_minutes: null, subtasks_json: null,
      });
      database.close();
      database = createDatabase(filename);
      expect(database.templateDB.use(1, 1, new Date())?.subtasks).toEqual([]);
      database.close();
    } finally {
      rmSync(filename, { force: true });
      rmdirSync(folder);
    }
  });
});
