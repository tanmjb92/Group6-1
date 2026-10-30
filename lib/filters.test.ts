import { describe, expect, it } from 'vitest';
import type { Todo } from './db';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterState } from './filters';

function todo(id: number, overrides: Partial<Todo> = {}): Todo {
  return {
    id, user_id: 1, title: 'Team meeting', priority: 'high', completed: false,
    due_date: '2026-11-01T16:30:00.000Z', is_recurring: false, recurrence_pattern: null,
    reminder_minutes: null, last_notification_sent: null, created_at: '2026-10-30T00:00:00Z',
    updated_at: null, ...overrides,
  };
}
const todos = [
  todo(1, { tags: [{ id: 1, user_id: 1, name: 'Work', color: '#000000', created_at: '' }] }),
  todo(2, { title: 'Shopping', priority: 'medium', due_date: '2026-11-01T15:59:00Z',
    subtasks: [{ id: 1, todo_id: 2, title: 'Buy CAFÉ supplies', completed: false, position: 0, created_at: '' }] }),
  todo(3, { title: 'Read book', priority: 'low', completed: true, due_date: null }),
];
const filter = (fields: Partial<FilterState> = {}) => applyFilters(todos, { ...DEFAULT_FILTER_STATE, ...fields }).map(({ id }) => id);

describe('client filters', () => {
  it('searches titles and subtasks with trimmed case-insensitive partial matching only', () => {
    expect(filter()).toEqual([1, 2, 3]);
    expect(filter({ search: ' MEET ' })).toEqual([1]);
    expect(filter({ search: 'café' })).toEqual([2]);
    expect(filter({ search: 'work' })).toEqual([]);
    expect(filter({ search: '   ' })).toEqual([1, 2, 3]);
    expect(filter({ search: '[.*' })).toEqual([]);
  });
  it.each(['high', 'medium', 'low'] as const)('filters priority %s', (priority) => {
    expect(filter({ priority })).toEqual([priority === 'high' ? 1 : priority === 'medium' ? 2 : 3]);
  });
  it('filters tags and completion, including missing arrays', () => {
    expect(filter({ tagId: 1 })).toEqual([1]);
    expect(filter({ tagId: 99 })).toEqual([]);
    expect(filter({ completion: 'completed' })).toEqual([3]);
    expect(filter({ completion: 'incomplete' })).toEqual([1, 2]);
  });
  it('uses inclusive Singapore calendar date bounds, not UTC date prefixes', () => {
    expect(filter({ dueDateFrom: '2026-11-02' })).toEqual([1]);
    expect(filter({ dueDateTo: '2026-11-01' })).toEqual([2]);
    expect(filter({ dueDateFrom: '2026-11-02', dueDateTo: '2026-11-02' })).toEqual([1]);
    expect(filter({ dueDateFrom: '2026-11-03', dueDateTo: '2026-11-01' })).toEqual([]);
  });
  it('combines all dimensions as AND without changing order or input', () => {
    const snapshot = JSON.stringify(todos);
    expect(filter({
      search: 'meeting', priority: 'high', tagId: 1, completion: 'incomplete',
      dueDateFrom: '2026-11-02', dueDateTo: '2026-11-02',
    })).toEqual([1]);
    expect(filter({ search: 'shopping', priority: 'high' })).toEqual([]);
    expect(JSON.stringify(todos)).toBe(snapshot);
  });
  it('detects active dimensions independently', () => {
    expect(hasActiveFilters(DEFAULT_FILTER_STATE)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTER_STATE, search: '  ' })).toBe(false);
    for (const fields of [
      { search: 'x' }, { priority: 'high' }, { tagId: 1 }, { completion: 'completed' },
      { dueDateFrom: '2026-11-02' }, { dueDateTo: '2026-11-02' },
    ] satisfies Partial<FilterState>[]) {
      expect(hasActiveFilters({ ...DEFAULT_FILTER_STATE, ...fields })).toBe(true);
    }
  });
  it('filters 1000 todos with all dimensions in under 100ms', () => {
    const input = Array.from({ length: 1000 }, (_, index) => ({ ...todos[0], id: index }));
    const start = performance.now();
    const result = applyFilters(input, {
      search: 'meeting', priority: 'high', tagId: 1, completion: 'incomplete',
      dueDateFrom: '2026-11-02', dueDateTo: '2026-11-02',
    });
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1000);
    expect(elapsed).toBeLessThan(100);
  });
});
