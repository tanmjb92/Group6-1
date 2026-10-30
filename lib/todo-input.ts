import { z } from 'zod';
import type {
  CreateTodoInput,
  Priority,
  RecurrencePattern,
  Todo,
  UpdateTodoInput,
} from './db';
import {
  fromSingaporeDateTimeLocal,
  getSingaporeDateTimeLocal,
  parseDueDate,
} from './timezone';

const prioritySchema = z.enum(['high', 'medium', 'low']);
const recurrencePatternSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
const createSchema = z
  .object({
    title: z.string(),
    due_date: z.string().nullable().optional(),
    priority: prioritySchema.nullable().optional(),
    is_recurring: z.boolean().optional(),
    recurrence_pattern: recurrencePatternSchema.nullable().optional(),
  })
  .strict();
const updateSchema = z
  .object({
    title: z.string().optional(),
    due_date: z.string().nullable().optional(),
    priority: prioritySchema.optional(),
    completed: z.boolean().optional(),
    is_recurring: z.boolean().optional(),
    recurrence_pattern: recurrencePatternSchema.nullable().optional(),
  })
  .strict();

type Validation<T> = { success: true; data: T } | { success: false; error: string };
export type TodoEditDraft = {
  title: string;
  due_date: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern;
};
const PRIORITY_ERROR = "Must be 'high', 'medium', or 'low'.";
const RECURRENCE_PATTERNS: RecurrencePattern[] = ['daily', 'weekly', 'monthly', 'yearly'];

function hasInvalidRecurrencePattern(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    !RECURRENCE_PATTERNS.some((pattern) => pattern === value)
  );
}

function isPriority(value: unknown): value is Priority {
  return value === 'high' || value === 'medium' || value === 'low';
}

function invalidPriority(value: unknown): Validation<never> {
  return {
    success: false,
    error: `Invalid priority: ${String(value)}. ${PRIORITY_ERROR}`,
  };
}

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
  if (
    typeof input === 'object' &&
    input !== null &&
    'priority' in input &&
    input.priority != null &&
    !isPriority(input.priority)
  ) {
    return invalidPriority(input.priority);
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'recurrence_pattern' in input &&
    hasInvalidRecurrencePattern(input.recurrence_pattern)
  ) {
    return { success: false, error: 'Invalid recurrence pattern' };
  }

  const result = createSchema.safeParse(input);
  if (!result.success) return { success: false, error: 'Invalid todo data' };

  const title = result.data.title.trim();
  if (!title) return { success: false, error: 'Title is required' };
  const dueDate =
    result.data.due_date == null
      ? { success: true as const, data: null }
      : normalizeDueDate(result.data.due_date, now);
  if (!dueDate.success) return dueDate;
  const isRecurring = result.data.is_recurring ?? false;
  const recurrencePattern = result.data.recurrence_pattern ?? null;
  if (isRecurring && !dueDate.data) {
    return { success: false, error: 'Recurring todos require a due date' };
  }
  if (isRecurring && !recurrencePattern) {
    return { success: false, error: 'Invalid recurrence pattern' };
  }

  return {
    success: true,
    data: {
      title,
      due_date: dueDate.data,
      priority: (result.data.priority ?? 'medium') as Priority,
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
    },
  };
}

export function validateUpdateTodo(
  input: unknown,
  now: Date,
  current?: Todo,
): Validation<UpdateTodoInput> {
  if (
    typeof input === 'object' &&
    input !== null &&
    'priority' in input &&
    !isPriority(input.priority)
  ) {
    return invalidPriority(input.priority);
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'recurrence_pattern' in input &&
    hasInvalidRecurrencePattern(input.recurrence_pattern)
  ) {
    return { success: false, error: 'Invalid recurrence pattern' };
  }

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
  if (result.data.is_recurring !== undefined) data.is_recurring = result.data.is_recurring;
  if (result.data.recurrence_pattern !== undefined) {
    data.recurrence_pattern = result.data.recurrence_pattern;
  }

  const isRecurring = data.is_recurring ?? current?.is_recurring ?? false;
  const dueDate = data.due_date !== undefined ? data.due_date : (current?.due_date ?? null);
  const recurrencePattern =
    data.recurrence_pattern !== undefined
      ? data.recurrence_pattern
      : (current?.recurrence_pattern ?? null);
  if (isRecurring && !dueDate) {
    return { success: false, error: 'Recurring todos require a due date' };
  }
  if (isRecurring && !recurrencePattern) {
    return { success: false, error: 'Invalid recurrence pattern' };
  }
  if (data.is_recurring === false) data.recurrence_pattern = null;
  return { success: true, data };
}

export function buildTodoEditUpdate(
  todo: Todo,
  draft: TodoEditDraft,
  now: Date,
): Validation<UpdateTodoInput> {
  const title = draft.title.trim();
  if (!title) return { success: false, error: 'Title cannot be empty' };
  if (draft.is_recurring && !draft.due_date) {
    return { success: false, error: 'Recurring todos require a due date' };
  }

  const currentDueDate = todo.due_date
    ? getSingaporeDateTimeLocal(new Date(todo.due_date))
    : '';
  const data: UpdateTodoInput = {
    title,
    priority: draft.priority,
    is_recurring: draft.is_recurring,
    recurrence_pattern: draft.is_recurring ? draft.recurrence_pattern : null,
  };
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
