import { describe, expect, it } from 'vitest';
import type { Todo } from './db';
import { sectionTodos, sortTodos } from './todo-sort';

function todo(
  id: number,
  options: Partial<Todo> = {},
): Todo {
  return {
    id,
    user_id: 1,
    title: `Todo ${id}`,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at: `2026-01-01T00:00:0${id}.000Z`,
    updated_at: null,
    ...options,
  };
}

describe('todo ordering and sections', () => {
  it('sorts by priority, due date, then newest creation time without mutating input', () => {
    const input = [
      todo(1, { priority: 'medium' }),
      todo(2, { priority: 'high', due_date: '2026-01-16T00:00:00.000Z' }),
      todo(3, { priority: 'high', due_date: '2026-01-15T00:00:00.000Z' }),
      todo(4, { priority: 'high', due_date: '2026-01-15T00:00:00.000Z', created_at: '2026-01-02T00:00:00.000Z' }),
      todo(5, { priority: 'low', due_date: '2026-01-14T00:00:00.000Z' }),
    ];

    expect(sortTodos(input).map(({ id }) => id)).toEqual([4, 3, 2, 1, 5]);
    expect(input.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('places todos without due dates after dated todos at the same priority', () => {
    expect(
      sortTodos([
        todo(1),
        todo(2, { due_date: '2026-01-15T00:00:00.000Z' }),
      ]).map(({ id }) => id),
    ).toEqual([2, 1]);
  });

  it('splits overdue, pending, and completed using the exact due-date boundary', () => {
    const now = new Date('2026-01-15T04:30:00.000Z');
    const todos = [
      todo(1, { due_date: '2026-01-15T04:29:59.999Z' }),
      todo(2, { due_date: '2026-01-15T04:30:00.000Z' }),
      todo(3),
      todo(4, { completed: true, due_date: '2026-01-01T00:00:00.000Z' }),
    ];

    expect(sectionTodos(todos, now)).toMatchObject({
      overdue: [{ id: 1 }],
      pending: [{ id: 2 }, { id: 3 }],
      completed: [{ id: 4 }],
    });
  });

  it('sorts completed todos by latest update time first', () => {
    const sections = sectionTodos(
      [
        todo(1, { completed: true, updated_at: '2026-01-01T00:00:00.000Z' }),
        todo(2, { completed: true, updated_at: '2026-01-02T00:00:00.000Z' }),
      ],
      new Date('2026-01-15T00:00:00.000Z'),
    );

    expect(sections.completed.map(({ id }) => id)).toEqual([2, 1]);
  });
});
