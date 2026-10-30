import { describe, expect, it } from 'vitest';
import type { Todo } from './db';
import { formatExportDate, toCsv, toExportItem, todoImportSchema } from './todo-export';

const todo: Todo = {
  id: 7,
  user_id: 3,
  title: 'Buy milk, eggs, "bread"\nand tea',
  completed: false,
  due_date: null,
  priority: 'high',
  is_recurring: false,
  recurrence_pattern: null,
  reminder_minutes: null,
  last_notification_sent: '2026-10-30T00:00:00.000Z',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  subtasks: [
    {
      id: 21,
      todo_id: 7,
      title: 'First step',
      completed: true,
      position: 0,
      created_at: '2026-10-01T00:00:00.000Z',
    },
  ],
  tags: [{ id: 31, user_id: 3, name: 'Work', color: '#123456', created_at: '2026-10-01T00:00:00.000Z' }],
};

describe('todo export helpers', () => {
  it('exports relations without database IDs or internal fields', () => {
    expect(toExportItem(todo)).toEqual({
      title: todo.title,
      completed: false,
      due_date: null,
      priority: 'high',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      created_at: todo.created_at,
      subtasks: [{ title: 'First step', completed: true, position: 0 }],
      tags: [{ name: 'Work', color: '#123456' }],
    });
  });

  it('writes RFC 4180 CSV columns and escapes commas, quotes, and newlines', () => {
    expect(toCsv([todo])).toBe(
      'ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder\r\n' +
        '7,"Buy milk, eggs, ""bread""\nand tea",false,,high,false,,\r\n',
    );
  });

  it('neutralizes spreadsheet formulas in exported text fields', () => {
    expect(toCsv([{ ...todo, title: '=HYPERLINK("https://example.test")' }])).toContain(
      `7,"'=HYPERLINK(""https://example.test"")",false,,high,false,,`,
    );
    expect(toCsv([{ ...todo, title: '\n=1+1' }])).toContain('7,"\'\n=1+1",false,,high,false,,');
  });

  it('validates versioned import payloads and rejects invalid enums and fields', () => {
    const valid = {
      version: 1,
      exported_at: '2026-10-30T00:00:00.000Z',
      todos: [toExportItem(todo)],
    };
    expect(todoImportSchema.safeParse(valid).success).toBe(true);
    expect(
      todoImportSchema.safeParse({
        ...valid,
        todos: [{ ...valid.todos[0], priority: 'urgent' }],
      }).success,
    ).toBe(false);
    expect(todoImportSchema.safeParse({ version: 2, exported_at: 'x', todos: [] }).success).toBe(
      false,
    );
    expect(
      todoImportSchema.safeParse({
        ...valid,
        todos: [{ ...valid.todos[0], reminder_minutes: -15 }],
      }).success,
    ).toBe(false);
    expect(
      todoImportSchema.safeParse({
        ...valid,
        todos: [{ ...valid.todos[0], created_at: 'not a timestamp' }],
      }).success,
    ).toBe(false);
    expect(
      todoImportSchema.safeParse({
        ...valid,
        todos: [
          {
            ...valid.todos[0],
            is_recurring: true,
            due_date: null,
            recurrence_pattern: null,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      todoImportSchema.safeParse({
        ...valid,
        todos: [{ ...valid.todos[0], recurrence_pattern: 'weekly' }],
      }).success,
    ).toBe(false);
  });

  it('formats download dates in Singapore time near UTC midnight', () => {
    expect(formatExportDate(new Date('2026-10-30T16:30:00.000Z'))).toBe('2026-10-31');
  });
});
