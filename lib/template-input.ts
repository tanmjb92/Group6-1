import { z } from 'zod';
import type { CreateTemplateInput, TemplateSubtask } from './db';
import { getSingaporeNow } from './timezone';
import { SUBTASK_TITLE_MAX_LENGTH } from './subtask-constants';
import { REMINDER_PRESETS } from './reminder-options';

export const TEMPLATE_REMINDERS = [
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];

const checklistSchema = z.array(z.object({
  title: z.string().trim().min(1).max(SUBTASK_TITLE_MAX_LENGTH),
  position: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()).refine(
  (items) => new Set(items.map((item) => item.position)).size === items.length,
  'Checklist positions must be unique',
);

export class TemplateChecklistError extends Error {
  constructor() { super('Stored template checklist is invalid'); }
}

export function parseTemplateSubtasks(json: string | null): TemplateSubtask[] {
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) throw new TemplateChecklistError();
    throw error;
  }
  const result = checklistSchema.safeParse(parsed);
  if (!result.success) throw new TemplateChecklistError();
  return result.data;
}

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required').max(200),
  title_template: z.string().trim().min(1, 'Todo title is required').max(200),
  description: optionalText(2000),
  category: optionalText(100),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  is_recurring: z.boolean().default(false),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  due_date_offset_minutes: z.number().int().min(1).nullable().optional(),
  reminder_minutes: z.literal(REMINDER_PRESETS, { error: 'Invalid reminder timing' }).nullable().optional(),
  subtasks: checklistSchema.default([]),
}).strict();

export function templateDueDate(offset: number | null, now: Date): string | null {
  if (offset === null) return null;
  const due = new Date(now.getTime() + offset * 60_000);
  if (!Number.isSafeInteger(offset) || offset < 1 || Number.isNaN(due.getTime())) {
    throw new Error('Due-date offset must produce a valid future date');
  }
  return due.toISOString();
}

export function validateTemplate(
  input: unknown,
): { success: true; data: CreateTemplateInput } | { success: false; error: string } {
  const result = templateSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: result.error.issues[0]?.message ?? 'Invalid template data' };
  }
  const data = result.data;
  const offset = data.due_date_offset_minutes ?? null;
  if (data.is_recurring && (!data.recurrence_pattern || offset === null)) {
    return { success: false, error: 'Recurring templates require a pattern and due-date offset' };
  }
  if (data.reminder_minutes != null && offset === null) {
    return { success: false, error: 'Templates with reminders require a due-date offset' };
  }
  try {
    templateDueDate(offset, getSingaporeNow());
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { success: false, error: error.message };
  }
  return {
    success: true,
    data: {
      ...data,
      recurrence_pattern: data.is_recurring ? (data.recurrence_pattern ?? null) : null,
      due_date_offset_minutes: offset,
      reminder_minutes: data.reminder_minutes ?? null,
    },
  };
}
