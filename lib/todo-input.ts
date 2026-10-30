import { z } from 'zod';
import type { CreateTodoInput, Priority, Todo, UpdateTodoInput } from './db';
import {
  fromSingaporeDateTimeLocal,
  getSingaporeDateTimeLocal,
  parseDueDate,
} from './timezone';

const prioritySchema = z.enum(['high', 'medium', 'low']);
const createSchema = z
  .object({
    title: z.string(),
    due_date: z.string().nullable().optional(),
    priority: prioritySchema.optional(),
  })
  .strict();
const updateSchema = z
  .object({
    title: z.string().optional(),
    due_date: z.string().nullable().optional(),
    priority: prioritySchema.optional(),
    completed: z.boolean().optional(),
  })
  .strict();

type Validation<T> = { success: true; data: T } | { success: false; error: string };
export type TodoEditDraft = { title: string; due_date: string; priority: Priority };

function normalizeDueDate(value: string, now: Date): Validation<string> {
  const singaporeLocal = fromSingaporeDateTimeLocal(value);
  const instant = singaporeLocal ? new Date(singaporeLocal) : parseDueDate(value);
  if (!instant) return { success: false, error: 'Due date must be a valid date and time' };
  if (instant.getTime() < now.getTime() + 60_000) {
    return {
      success: false,
      error: 'Due date must be at least 1 minute in the future',
    };
  }
  return { success: true, data: instant.toISOString() };
}

export function validateCreateTodo(input: unknown, now: Date): Validation<CreateTodoInput> {
  const result = createSchema.safeParse(input);
  if (!result.success) return { success: false, error: 'Invalid todo data' };

  const title = result.data.title.trim();
  if (!title) return { success: false, error: 'Title is required' };
  const dueDate =
    result.data.due_date == null
      ? { success: true as const, data: null }
      : normalizeDueDate(result.data.due_date, now);
  if (!dueDate.success) return dueDate;

  return {
    success: true,
    data: {
      title,
      due_date: dueDate.data,
      priority: (result.data.priority ?? 'medium') as Priority,
    },
  };
}

export function validateUpdateTodo(input: unknown, now: Date): Validation<UpdateTodoInput> {
  const result = updateSchema.safeParse(input);
  if (!result.success) return { success: false, error: 'Invalid todo data' };
  if (Object.keys(result.data).length === 0) {
    return { success: false, error: 'At least one field is required' };
  }

  const data: UpdateTodoInput = {};
  if (result.data.title !== undefined) {
    data.title = result.data.title.trim();
    if (!data.title) return { success: false, error: 'Title cannot be empty' };
  }
  if (result.data.due_date !== undefined) {
    if (result.data.due_date === null) {
      data.due_date = null;
    } else {
      const dueDate = normalizeDueDate(result.data.due_date, now);
      if (!dueDate.success) return dueDate;
      data.due_date = dueDate.data;
    }
  }
  if (result.data.priority !== undefined) data.priority = result.data.priority;
  if (result.data.completed !== undefined) data.completed = result.data.completed;
  return { success: true, data };
}

export function buildTodoEditUpdate(
  todo: Todo,
  draft: TodoEditDraft,
  now: Date,
): Validation<UpdateTodoInput> {
  const title = draft.title.trim();
  if (!title) return { success: false, error: 'Title cannot be empty' };

  const currentDueDate = todo.due_date
    ? getSingaporeDateTimeLocal(new Date(todo.due_date))
    : '';
  const data: UpdateTodoInput = { title, priority: draft.priority };
  if (draft.due_date !== currentDueDate) {
    if (!draft.due_date) {
      data.due_date = null;
    } else {
      const singaporeLocal = fromSingaporeDateTimeLocal(draft.due_date);
      if (!singaporeLocal) {
        return { success: false, error: 'Due date must be a valid date and time' };
      }
      const dueDate = normalizeDueDate(singaporeLocal, now);
      if (!dueDate.success) return dueDate;
      data.due_date = dueDate.data;
    }
  }
  return { success: true, data };
}
