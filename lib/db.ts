import Database from 'better-sqlite3';
import { createChallengeStore } from './auth/challenge-store';
import { getSingaporeNow } from './timezone';
import { generateCalendarGrid } from './calendar';

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export type Priority = 'high' | 'medium' | 'low';
export const PRIORITY_VALUES: Priority[] = ['high', 'medium', 'low'];
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags?: Tag[];
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface CreateSubtaskDto {
  title: string;
}

export interface UpdateSubtaskDto {
  title?: string;
  completed?: boolean;
}

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
}

export interface CreateTodoInput {
  title: string;
  due_date?: string | null;
  priority?: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: number | null;
}

export interface UpdateTodoInput {
  title?: string;
  due_date?: string | null;
  priority?: Priority;
  completed?: boolean;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
}

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

function toTodo(row: Todo | undefined): Todo | null {
  if (!row) return null;
  return {
    ...row,
    completed: Boolean(row.completed),
    is_recurring: Boolean(row.is_recurring),
  };
}

function toSubtask(row: Subtask | undefined): Subtask | null {
  if (!row) return null;
  return { ...row, completed: Boolean(row.completed) };
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

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT,
      next_occurrence_created INTEGER NOT NULL DEFAULT 0,
      reminder_minutes INTEGER,
      last_notification_sent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);
  `);
  const todoColumns = connection.pragma('table_info(todos)') as Array<{ name: string }>;
  if (!todoColumns.some((column) => column.name === 'next_occurrence_created')) {
    connection.exec(
      'ALTER TABLE todos ADD COLUMN next_occurrence_created INTEGER NOT NULL DEFAULT 0',
    );
  }

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
  const todoById = connection.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?');
  const todosByUser = connection.prepare(
    'SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC, id DESC',
  );
  const subtasksByTodo = connection.prepare(
    'SELECT * FROM subtasks WHERE todo_id = ? ORDER BY position ASC, id ASC',
  );
  const subtasksByUser = connection.prepare(
    `SELECT subtasks.* FROM subtasks
     INNER JOIN todos ON todos.id = subtasks.todo_id
     WHERE todos.user_id = ?
     ORDER BY subtasks.todo_id, subtasks.position ASC, subtasks.id ASC`,
  );
  const subtaskByIdForUser = connection.prepare(
    `SELECT subtasks.* FROM subtasks
     INNER JOIN todos ON todos.id = subtasks.todo_id
     WHERE subtasks.id = ? AND todos.user_id = ?`,
  );
  const createSubtaskTransaction = connection.transaction((todoId: number, title: string) => {
    const nextPosition = connection
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM subtasks WHERE todo_id = ?')
      .get(todoId) as { position: number };
    const result = connection
      .prepare('INSERT INTO subtasks (todo_id, title, position) VALUES (?, ?, ?)')
      .run(todoId, title, nextPosition.position);
    return connection.prepare('SELECT * FROM subtasks WHERE id = ?').get(result.lastInsertRowid) as
      | Subtask
      | undefined;
  });

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

  const todoDB = {
    findAllByUser(userId: number): Todo[] {
      const todos = (todosByUser.all(userId) as Todo[]).map((row) => toTodo(row)!);
      const subtasks = (subtasksByUser.all(userId) as Subtask[]).map((row) => toSubtask(row)!);
      const subtasksByTodoId = new Map<number, Subtask[]>();
      for (const subtask of subtasks) {
        const current = subtasksByTodoId.get(subtask.todo_id) ?? [];
        current.push(subtask);
        subtasksByTodoId.set(subtask.todo_id, current);
      }
      return todos.map((todo) => ({
        ...todo,
        subtasks: subtasksByTodoId.get(todo.id) ?? [],
      }));
    },
    findById(id: number, userId: number): Todo | null {
      const todo = toTodo(todoById.get(id, userId) as Todo | undefined);
      if (!todo) return null;
      return {
        ...todo,
        subtasks: (subtasksByTodo.all(id) as Subtask[]).map((row) => toSubtask(row)!),
      };
    },
    create(userId: number, input: CreateTodoInput): Todo {
      const result = connection
        .prepare(
          `INSERT INTO todos
            (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          input.title.trim(),
          input.due_date ?? null,
          input.priority ?? 'medium',
          Number(input.is_recurring ?? false),
          input.is_recurring ? (input.recurrence_pattern ?? null) : null,
          input.reminder_minutes ?? null,
          getSingaporeNow().toISOString(),
        );
      const todo = this.findById(Number(result.lastInsertRowid), userId);
      if (!todo) throw new Error('Created todo could not be loaded');
      return todo;
    },
    update(id: number, userId: number, input: UpdateTodoInput): Todo | null {
      const assignments: string[] = [];
      const values: (string | number | null)[] = [];

      if (input.title !== undefined) {
        assignments.push('title = ?');
        values.push(input.title.trim());
      }
      if (input.due_date !== undefined) {
        assignments.push('due_date = ?');
        values.push(input.due_date);
      }
      if (input.priority !== undefined) {
        assignments.push('priority = ?');
        values.push(input.priority);
      }
      if (input.completed !== undefined) {
        assignments.push('completed = ?');
        values.push(Number(input.completed));
      }
      if (input.is_recurring !== undefined) {
        assignments.push('is_recurring = ?');
        values.push(Number(input.is_recurring));
      }
      if (input.recurrence_pattern !== undefined || input.is_recurring === false) {
        assignments.push('recurrence_pattern = ?');
        values.push(input.is_recurring === false ? null : (input.recurrence_pattern ?? null));
      }
      if (assignments.length === 0) return this.findById(id, userId);

      assignments.push('updated_at = ?');
      values.push(getSingaporeNow().toISOString(), id, userId);
      connection
        .prepare(`UPDATE todos SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`)
        .run(...values);
      return this.findById(id, userId);
    },
    updateWithNextOccurrence(
      id: number,
      userId: number,
      input: UpdateTodoInput,
      calculateNextDueDate: (dueDate: string, pattern: RecurrencePattern) => string,
    ): { todo: Todo | null; nextInstance: Todo | null } {
      return connection.transaction(() => {
        const existing = this.findById(id, userId);
        if (!existing) return { todo: null, nextInstance: null };

        const updated = this.update(id, userId, input);
        if (!updated) return { todo: null, nextInstance: null };
        const justCompleted = input.completed === true && !existing.completed;
        if (
          !justCompleted ||
          !updated.is_recurring ||
          !updated.recurrence_pattern ||
          !updated.due_date
        ) {
          return { todo: updated, nextInstance: null };
        }

        const claimed = connection
          .prepare(
            `UPDATE todos SET next_occurrence_created = 1
             WHERE id = ? AND user_id = ? AND next_occurrence_created = 0`,
          )
          .run(id, userId);
        if (claimed.changes !== 1) return { todo: updated, nextInstance: null };

        const nextInstance = this.create(userId, {
          title: updated.title,
          due_date: calculateNextDueDate(updated.due_date, updated.recurrence_pattern),
          priority: updated.priority,
          is_recurring: true,
          recurrence_pattern: updated.recurrence_pattern,
          reminder_minutes: updated.reminder_minutes,
        });
        return { todo: updated, nextInstance };
      })();
    },
    delete(id: number, userId: number): boolean {
      return (
        connection.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, userId)
          .changes === 1
      );
    },
  };

  const holidayDB = {
    findAll(): Holiday[] {
      return connection.prepare('SELECT id, date, name FROM holidays ORDER BY date').all() as Holiday[];
    },
    findByMonth(year: number, month: number): Holiday[] {
      const cells = generateCalendarGrid(year, month);
      return connection
        .prepare('SELECT id, date, name FROM holidays WHERE date >= ? AND date <= ? ORDER BY date')
        .all(cells[0].date, cells[41].date) as Holiday[];
    },
    upsertAll(holidays: Omit<Holiday, 'id'>[]): void {
      const insert = connection.prepare(
        `INSERT INTO holidays (date, name) VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET name = excluded.name`,
      );
      connection.transaction(() => {
        for (const holiday of holidays) insert.run(holiday.date, holiday.name);
      })();
    },
  };

  const subtaskDB = {
    findByTodoId(todoId: number): Subtask[] {
      return (subtasksByTodo.all(todoId) as Subtask[]).map((row) => toSubtask(row)!);
    },
    findById(id: number, userId: number): Subtask | null {
      return toSubtask(subtaskByIdForUser.get(id, userId) as Subtask | undefined);
    },
    create(todoId: number, input: CreateSubtaskDto): Subtask {
      const row = createSubtaskTransaction(todoId, input.title.trim());
      if (!row) throw new Error('Created subtask could not be loaded');
      return toSubtask(row)!;
    },
    update(id: number, userId: number, input: UpdateSubtaskDto): Subtask | null {
      const assignments: string[] = [];
      const values: (string | number)[] = [];

      if (input.title !== undefined) {
        assignments.push('title = ?');
        values.push(input.title.trim());
      }
      if (input.completed !== undefined) {
        assignments.push('completed = ?');
        values.push(Number(input.completed));
      }
      if (assignments.length === 0) return this.findById(id, userId);

      connection
        .prepare(
          `UPDATE subtasks SET ${assignments.join(', ')}
           WHERE id = ? AND todo_id IN (SELECT id FROM todos WHERE user_id = ?)`,
        )
        .run(...values, id, userId);
      return this.findById(id, userId);
    },
    delete(id: number, userId: number): boolean {
      return (
        connection
          .prepare(
            `DELETE FROM subtasks
             WHERE id = ? AND todo_id IN (SELECT id FROM todos WHERE user_id = ?)`,
          )
          .run(id, userId).changes === 1
      );
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
    todoDB,
    holidayDB,
    subtaskDB,
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
export const todoDB = database.todoDB;
export const holidayDB = database.holidayDB;
export const subtaskDB = database.subtaskDB;
export const createUserWithAuthenticator = database.createUserWithAuthenticator;
export const challengeStore = database.challengeStore;
