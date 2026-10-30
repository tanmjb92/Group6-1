import { describe, expect, it } from 'vitest';
import { parseTemplateSubtasks, templateDueDate, validateTemplate } from './template-input';

const draft = { name: ' Review ', title_template: ' Weekly review ', priority: 'high' };

describe('template input', () => {
  it('trims fields and supplies nullable defaults', () => {
    expect(validateTemplate(draft)).toEqual({
      success: true,
      data: {
        name: 'Review', title_template: 'Weekly review', priority: 'high',
        description: null, category: null, is_recurring: false,
        recurrence_pattern: null, due_date_offset_minutes: null, reminder_minutes: null, subtasks: [],
      },
    });
  });

  it.each([
    null, {}, { ...draft, name: ' ' }, { ...draft, title_template: '' },
    { ...draft, priority: 'urgent' }, { ...draft, due_date_offset_minutes: 0 },
    { ...draft, due_date_offset_minutes: 1.5 },
    { ...draft, due_date_offset_minutes: Number.MAX_SAFE_INTEGER },
    { ...draft, reminder_minutes: 16 }, { ...draft, subtasks: [{ title: ' ', position: 0 }] },
    { ...draft, tags: [] }, { ...draft, user_id: 1 },
    { ...draft, is_recurring: true },
    { ...draft, is_recurring: true, recurrence_pattern: 'daily' },
    { ...draft, is_recurring: true, recurrence_pattern: 'invalid', due_date_offset_minutes: 60 },
  ])('rejects invalid or deferred fields: %j', (input) => {
    expect(validateTemplate(input).success).toBe(false);
  });

  it('accepts recurring templates with an offset and normalizes optional text', () => {
    const result = validateTemplate({
      ...draft, description: ' Details ', category: ' ', is_recurring: true,
      recurrence_pattern: 'weekly', due_date_offset_minutes: 60,
    });
    expect(result.success && result.data).toMatchObject({
      description: 'Details', category: null, is_recurring: true,
      recurrence_pattern: 'weekly', due_date_offset_minutes: 60,
    });
  });

  it('clears stale recurrence settings on nonrecurring templates', () => {
    const result = validateTemplate({ ...draft, recurrence_pattern: 'daily' });
    expect(result.success && result.data.recurrence_pattern).toBeNull();
  });

  it('resolves offsets relative to the use instant and preserves no-date templates', () => {
    const now = new Date('2026-10-30T08:00:00.000Z');
    expect(templateDueDate(90, now)).toBe('2026-10-30T09:30:00.000Z');
    expect(templateDueDate(null, now)).toBeNull();
    expect(() => templateDueDate(Number.MAX_SAFE_INTEGER, now)).toThrow();
  });

  it.each([15, 30, 60, 120, 1440, 2880, 10080])('accepts reminder %i with a due offset', (reminder) => {
    const result = validateTemplate({ ...draft, reminder_minutes: reminder, due_date_offset_minutes: 60 });
    expect(result.success && result.data.reminder_minutes).toBe(reminder);
    expect(validateTemplate({ ...draft, reminder_minutes: reminder }).success).toBe(false);
  });

  it('validates checklist titles and positions without imposing a count cap', () => {
    const subtasks = Array.from({ length: 100 }, (_, position) => ({ title: `Task ${position}`, position }));
    const result = validateTemplate({ ...draft, subtasks });
    expect(result.success && result.data.subtasks).toEqual(subtasks);
    for (const invalid of [
      [{ title: 'Task', position: -1 }], [{ title: 'Task', position: 0.5 }],
      [{ title: 'x'.repeat(201), position: 0 }],
      [{ title: 'Task', position: 0, completed: true }],
      [{ title: 'One', position: 0 }, { title: 'Two', position: 0 }],
    ]) expect(validateTemplate({ ...draft, subtasks: invalid }).success).toBe(false);
  });

  it('parses stored checklists explicitly and rejects corruption', () => {
    expect(parseTemplateSubtasks(null)).toEqual([]);
    expect(parseTemplateSubtasks(JSON.stringify([{ title: 'Task', position: 3 }]))).toEqual([
      { title: 'Task', position: 3 },
    ]);
    for (const invalid of ['{', '{}', 'null', '[{"title":" ","position":0}]']) {
      expect(() => parseTemplateSubtasks(invalid)).toThrow('Stored template checklist is invalid');
    }
  });
});
