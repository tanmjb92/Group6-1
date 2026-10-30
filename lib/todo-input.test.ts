import { describe, expect, it } from 'vitest';
import { buildTodoEditUpdate, validateCreateTodo, validateUpdateTodo } from './todo-input';
import type { Todo } from './db';

const now = new Date('2026-01-15T04:30:00.000Z');

describe('todo input validation', () => {
  it('trims titles and applies creation defaults', () => {
    expect(validateCreateTodo({ title: '  Buy milk  ' }, now)).toEqual({
      success: true,
      data: { title: 'Buy milk', due_date: null, priority: 'medium' },
    });
  });

  it('rejects empty titles and unknown fields', () => {
    expect(validateCreateTodo({ title: '  ' }, now)).toMatchObject({
      success: false,
      error: 'Title is required',
    });
    expect(validateCreateTodo({ title: 'Task', user_id: 7 }, now)).toMatchObject({
      success: false,
      error: 'Invalid todo data',
    });
  });

  it('accepts a due date at least one minute in the future', () => {
    expect(
      validateCreateTodo({ title: 'Task', due_date: '2026-01-15T04:31:00.000Z' }, now),
    ).toMatchObject({
      success: true,
      data: { due_date: '2026-01-15T04:31:00.000Z' },
    });
  });

  it('rejects invalid and too-soon due dates', () => {
    expect(
      validateCreateTodo({ title: 'Task', due_date: '2026-01-15T04:30:59.999Z' }, now),
    ).toMatchObject({ success: false, error: 'Due date must be at least 1 minute in the future' });
    expect(validateCreateTodo({ title: 'Task', due_date: 'not-a-date' }, now)).toMatchObject({
      success: false,
      error: 'Due date must be a valid date and time',
    });
  });

  it('defaults null creation priority to medium and reports invalid values precisely', () => {
    expect(validateCreateTodo({ title: 'Task', priority: null }, now)).toEqual({
      success: true,
      data: { title: 'Task', due_date: null, priority: 'medium' },
    });
    expect(validateCreateTodo({ title: 'Task', priority: 'urgent' }, now)).toEqual({
      success: false,
      error: "Invalid priority: urgent. Must be 'high', 'medium', or 'low'.",
    });
    expect(validateCreateTodo({ title: 'Task', priority: 'HIGH' }, now)).toMatchObject({
      success: false,
      error: "Invalid priority: HIGH. Must be 'high', 'medium', or 'low'.",
    });
  });

  it('validates updates without resetting fields omitted from the payload', () => {
    expect(validateUpdateTodo({ completed: true }, now)).toEqual({
      success: true,
      data: { completed: true },
    });
    expect(validateUpdateTodo({ title: '  ' }, now)).toMatchObject({
      success: false,
      error: 'Title cannot be empty',
    });
    expect(validateUpdateTodo({}, now)).toMatchObject({
      success: false,
      error: 'At least one field is required',
    });
  });

  it('allows clearing the due date and rejects unknown priority values', () => {
    expect(validateUpdateTodo({ due_date: null }, now)).toEqual({
      success: true,
      data: { due_date: null },
    });
    expect(validateCreateTodo({ title: 'Task', priority: 'urgent' }, now).success).toBe(false);
  });

  it('rejects null and invalid update priorities with a descriptive error', () => {
    expect(validateUpdateTodo({ priority: null }, now)).toEqual({
      success: false,
      error: "Invalid priority: null. Must be 'high', 'medium', or 'low'.",
    });
    expect(validateUpdateTodo({ priority: 'urgent' }, now)).toEqual({
      success: false,
      error: "Invalid priority: urgent. Must be 'high', 'medium', or 'low'.",
    });
  });

  it('allows editing other fields while keeping an existing overdue date unchanged', () => {
    const todo: Todo = {
      id: 1,
      user_id: 1,
      title: 'Old task',
      completed: false,
      due_date: '2026-01-15T04:00:00.000Z',
      priority: 'medium',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: null,
    };

    expect(
      buildTodoEditUpdate(
        todo,
        { title: 'Edited title', due_date: '2026-01-15T12:00', priority: 'high' },
        now,
      ),
    ).toEqual({ success: true, data: { title: 'Edited title', priority: 'high' } });
  });
});
