import type { Priority, Todo } from './db';

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const priorityDifference = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDifference !== 0) return priorityDifference;

    const aDue = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
    const bDue = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

export function sectionTodos(todos: Todo[], now: Date) {
  const incomplete = todos.filter((todo) => !todo.completed);
  const completed = todos
    .filter((todo) => todo.completed)
    .sort(
      (a, b) =>
        Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at),
    );

  return {
    overdue: sortTodos(
      incomplete.filter((todo) => todo.due_date !== null && Date.parse(todo.due_date) < now.getTime()),
    ),
    pending: sortTodos(
      incomplete.filter((todo) => todo.due_date === null || Date.parse(todo.due_date) >= now.getTime()),
    ),
    completed,
  };
}
