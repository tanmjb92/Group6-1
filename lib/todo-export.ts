import { z } from 'zod';
import type { Todo, TodoExportItem } from './db';
import { REMINDER_PRESETS } from './reminder-options';
import { formatSingaporeDate, parseDueDate } from './timezone';

export const todoImportSchema = z.object({
  version: z.literal(1),
  exported_at: z.string().refine((value) => parseDueDate(value) !== null),
  todos: z.array(
    z.object({
      title: z.string().trim().min(1).max(200),
      completed: z.boolean(),
      due_date: z.string().refine((value) => parseDueDate(value) !== null).nullable(),
      priority: z.enum(['high', 'medium', 'low']),
      is_recurring: z.boolean(),
      recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable(),
      reminder_minutes: z.literal(REMINDER_PRESETS).nullable(),
      created_at: z.string().refine((value) => parseDueDate(value) !== null),
      subtasks: z.array(
        z.object({
          title: z.string().trim().min(1).max(200),
          completed: z.boolean(),
          position: z.number().int(),
        }),
      ),
      tags: z.array(
        z.object({
          name: z.string().trim().min(1),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        }),
      ),
    }).superRefine((todo, context) => {
      if (todo.is_recurring && (!todo.due_date || !todo.recurrence_pattern)) {
        context.addIssue({
          code: 'custom',
          message: 'Recurring todos require a due date and recurrence pattern',
        });
      }
      if (!todo.is_recurring && todo.recurrence_pattern !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Non-recurring todos cannot have a recurrence pattern',
        });
      }
    }),
  ),
});

export type TodoImportData = z.infer<typeof todoImportSchema>;

export function toExportItem(todo: Todo): TodoExportItem {
  return {
    title: todo.title,
    completed: todo.completed,
    due_date: todo.due_date,
    priority: todo.priority,
    is_recurring: todo.is_recurring,
    recurrence_pattern: todo.recurrence_pattern,
    reminder_minutes: todo.reminder_minutes,
    created_at: todo.created_at,
    subtasks: (todo.subtasks ?? []).map(({ title, completed, position }) => ({
      title,
      completed,
      position,
    })),
    tags: (todo.tags ?? []).map(({ name, color }) => ({ name, color })),
  };
}

function escapeCsvField(value: string): string {
  const safeValue = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue;
}

export function toCsv(todos: Todo[]): string {
  const rows = [
    ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder'],
    ...todos.map((todo) => [
      String(todo.id),
      todo.title,
      String(todo.completed),
      todo.due_date ?? '',
      todo.priority,
      String(todo.is_recurring),
      todo.recurrence_pattern ?? '',
      todo.reminder_minutes == null ? '' : String(todo.reminder_minutes),
    ]),
  ];
  return `${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}

export function formatExportDate(date: Date): string {
  return formatSingaporeDate(date).slice(0, 10);
}
