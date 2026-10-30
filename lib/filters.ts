import type { Priority, Todo } from './db';
import { fromSingaporeDateTimeLocal } from './timezone';

export interface FilterState {
  search: string;
  priority: Priority | 'all';
  tagId: number | 'all';
  completion: 'all' | 'incomplete' | 'completed';
  dueDateFrom: string | null;
  dueDateTo: string | null;
}

export const DEFAULT_FILTER_STATE: Readonly<FilterState> = {
  search: '', priority: 'all', tagId: 'all', completion: 'all',
  dueDateFrom: null, dueDateTo: null,
};

export function hasActiveFilters(filters: FilterState): boolean {
  return filters.search.trim() !== '' || filters.priority !== 'all' ||
    filters.tagId !== 'all' || filters.completion !== 'all' ||
    filters.dueDateFrom !== null || filters.dueDateTo !== null;
}

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  const query = filters.search.trim().toLowerCase();
  let result = todos;
  if (query) {
    result = result.filter((todo) =>
      todo.title.toLowerCase().includes(query) ||
      (todo.subtasks ?? []).some((subtask) => subtask.title.toLowerCase().includes(query)),
    );
  }
  if (filters.priority !== 'all') result = result.filter((todo) => todo.priority === filters.priority);
  if (filters.tagId !== 'all') {
    result = result.filter((todo) => (todo.tags ?? []).some((tag) => tag.id === filters.tagId));
  }
  if (filters.completion !== 'all') {
    result = result.filter((todo) => todo.completed === (filters.completion === 'completed'));
  }
  if (filters.dueDateFrom || filters.dueDateTo) {
    // Compare instants against Singapore midnight bounds; API timestamps are UTC.
    const from = filters.dueDateFrom
      ? fromSingaporeDateTimeLocal(`${filters.dueDateFrom}T00:00`) : null;
    const to = filters.dueDateTo
      ? fromSingaporeDateTimeLocal(`${filters.dueDateTo}T00:00`) : null;
    const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const end = to ? Date.parse(to) + 86_400_000 : Number.POSITIVE_INFINITY;
    result = result.filter((todo) => {
      if (!todo.due_date) return false;
      const due = Date.parse(todo.due_date);
      return due >= start && due < end;
    });
  }
  return result;
}
