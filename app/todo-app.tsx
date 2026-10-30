'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Priority, RecurrencePattern, Subtask, Todo, UpdateTodoInput } from '@/lib/db';
import { SUBTASK_TITLE_MAX_LENGTH } from '@/lib/subtask-constants';
import { buildTodoEditUpdate, type TodoEditDraft } from '@/lib/todo-input';
import { calculateProgress } from '@/lib/subtask-progress';
import {
  fromSingaporeDateTimeLocal,
  formatSingaporeDate,
  getSingaporeDateTimeLocal,
  getSingaporeNow,
} from '@/lib/timezone';
import { sectionTodos } from '@/lib/todo-sort';

type TodoAppProps = { userId: number };
type PriorityFilter = Priority | 'all';
let nextOptimisticTodoId = 0;
let nextOptimisticSubtaskId = 0;

function localDateMinimum(): string {
  return getSingaporeDateTimeLocal(new Date(getSingaporeNow().getTime() + 60_000));
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // The response may not contain JSON.
  }
  return `Request failed (${response.status})`;
}

const PRIORITY_BADGE_STYLES: Record<Priority, string> = {
  high: 'border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-100',
  medium:
    'border-yellow-300 bg-yellow-100 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-100',
  low: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100',
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const label = priority[0].toUpperCase() + priority.slice(1);
  return (
    <span
      data-testid={`priority-badge-${priority}`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE_STYLES[priority]}`}
    >
      {label}
    </span>
  );
}

function RecurrenceBadge({ pattern }: { pattern: RecurrencePattern }) {
  return (
    <span
      data-testid={`recurrence-badge-${pattern}`}
      className="inline-flex items-center gap-1 rounded-full border border-purple-300 bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-100"
    >
      🔄 {pattern}
    </span>
  );
}

function TodoRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  todoUpdating,
}: {
  todo: Todo;
  onToggle: (todo: Todo, completed: boolean) => Promise<boolean>;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onAddSubtask: (todoId: number, title: string) => Promise<boolean>;
  onToggleSubtask: (todo: Todo, subtask: Subtask, completed: boolean) => Promise<boolean>;
  onDeleteSubtask: (todo: Todo, subtask: Subtask) => Promise<boolean>;
  todoUpdating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [pendingSubtaskIds, setPendingSubtaskIds] = useState<Set<number>>(() => new Set());
  const subtasks = todo.subtasks ?? [];
  const progress = calculateProgress(subtasks);

  async function addSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = newSubtaskTitle.trim();
    if (!trimmedTitle || addingSubtask || todo.id < 0) return;

    setAddingSubtask(true);
    const added = await onAddSubtask(todo.id, trimmedTitle);
    setAddingSubtask(false);
    if (added) setNewSubtaskTitle('');
  }

  async function toggleSubtask(subtask: Subtask, completed: boolean) {
    setPendingSubtaskIds((current) => new Set(current).add(subtask.id));
    await onToggleSubtask(todo, subtask, completed);
    setPendingSubtaskIds((current) => {
      const next = new Set(current);
      next.delete(subtask.id);
      return next;
    });
  }

  async function deleteSubtask(subtask: Subtask) {
    setPendingSubtaskIds((current) => new Set(current).add(subtask.id));
    await onDeleteSubtask(todo, subtask);
    setPendingSubtaskIds((current) => {
      const next = new Set(current);
      next.delete(subtask.id);
      return next;
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={todo.completed}
          disabled={todoUpdating}
          onChange={(event) => void onToggle(todo, event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
          aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`break-words font-medium ${todo.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
              {todo.title}
            </p>
            <PriorityBadge priority={todo.priority} />
            {todo.is_recurring && todo.recurrence_pattern && (
              <RecurrenceBadge pattern={todo.recurrence_pattern} />
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-gray-600">
            {todo.due_date && <time dateTime={todo.due_date}>{formatSingaporeDate(new Date(todo.due_date))}</time>}
          </div>
        </div>
      </div>
      <div className="flex gap-4 text-sm">
        <button type="button" disabled={todoUpdating} onClick={() => onEdit(todo)} className="text-blue-700 underline disabled:opacity-50">
          Edit
        </button>
        <button type="button" disabled={todoUpdating} onClick={() => onDelete(todo)} className="text-red-700 underline disabled:opacity-50">
          Delete
        </button>
      </div>
      <div className="w-full border-t border-gray-100 pt-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`subtasks-${todo.id}`}
          aria-label={`${expanded ? 'Hide' : 'Show'} subtasks for ${todo.title}`}
          onClick={() => setExpanded((current) => !current)}
          className="text-sm font-medium text-gray-700 underline"
        >
          {expanded ? 'Hide subtasks' : 'Subtasks'} ({subtasks.length})
        </button>

        {progress.total > 0 && (
          <div className="mt-2" aria-label={`Subtask progress for ${todo.title}`}>
            <div className="mb-1 flex justify-between text-xs text-gray-600">
              <span>{progress.completed}/{progress.total} subtasks</span>
              <span>{progress.percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={`Subtask completion for ${todo.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              className="h-2 overflow-hidden rounded-full bg-gray-200"
            >
              <div
                className={`h-full transition-[width] duration-200 ${progress.percent === 100 ? 'bg-green-600' : 'bg-blue-600'}`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {expanded && (
          <div id={`subtasks-${todo.id}`} className="mt-3 space-y-2 pl-1">
            {subtasks.length > 0 && (
              <ul aria-label={`Subtasks for ${todo.title}`} className="space-y-2">
                {subtasks.map((subtask) => (
                  <li key={subtask.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={subtask.completed}
                      disabled={subtask.id < 0 || pendingSubtaskIds.has(subtask.id)}
                      aria-label={`Mark subtask "${subtask.title}" as ${subtask.completed ? 'incomplete' : 'complete'}`}
                      onChange={(event) => void toggleSubtask(subtask, event.target.checked)}
                    />
                    <span className={`min-w-0 flex-1 break-words text-sm ${subtask.completed ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      disabled={todo.id < 0 || pendingSubtaskIds.has(subtask.id)}
                      aria-label={`Delete subtask ${subtask.title}`}
                      onClick={() => void deleteSubtask(subtask)}
                      className="rounded border px-2 py-1 text-sm text-red-700 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addSubtask} className="flex gap-2">
              <label className="sr-only" htmlFor={`new-subtask-${todo.id}`}>
                Add a subtask to {todo.title}
              </label>
              <input
                id={`new-subtask-${todo.id}`}
                maxLength={SUBTASK_TITLE_MAX_LENGTH}
                value={newSubtaskTitle}
                disabled={todo.id < 0 || addingSubtask}
                onChange={(event) => setNewSubtaskTitle(event.target.value)}
                placeholder="Add a subtask"
                className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              />
              <button
                type="submit"
                disabled={todo.id < 0 || addingSubtask || !newSubtaskTitle.trim()}
                className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {addingSubtask ? 'Adding…' : 'Add'}
              </button>
            </form>
          </div>
        )}
      </div>
    </li>
  );
}

function TodoSection({
  title,
  todos,
  onToggle,
  onEdit,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  pendingTodoIds,
}: {
  title: string;
  todos: Todo[];
  onToggle: (todo: Todo, completed: boolean) => Promise<boolean>;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onAddSubtask: (todoId: number, title: string) => Promise<boolean>;
  onToggleSubtask: (todo: Todo, subtask: Subtask, completed: boolean) => Promise<boolean>;
  onDeleteSubtask: (todo: Todo, subtask: Subtask) => Promise<boolean>;
  pendingTodoIds: Set<number>;
}) {
  const sectionStyle =
    title === 'Overdue'
      ? 'border-red-200 bg-red-50'
      : title === 'Pending'
        ? 'border-gray-200 bg-gray-50'
        : 'border-green-200 bg-green-50';

  return (
    <section aria-label={title} className={`mt-8 rounded-xl border p-4 ${sectionStyle}`}>
      <h2 className="mb-3 text-xl font-semibold">
        {title} ({todos.length})
      </h2>
      {todos.length > 0 ? (
        <ul className="space-y-3">
          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
              todoUpdating={pendingTodoIds.has(todo.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">No todos in this section.</p>
      )}
    </section>
  );
}

function TodoEditDialog({
  todo,
  onCancel,
  onSave,
}: {
  todo: Todo;
  onCancel: () => void;
  onSave: (id: number, draft: TodoEditDraft) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(todo.title);
  const [dueDate, setDueDate] = useState(
    todo.due_date ? getSingaporeDateTimeLocal(new Date(todo.due_date)) : '',
  );
  const [priority, setPriority] = useState<Priority>(todo.priority);
  const [isRecurring, setIsRecurring] = useState(todo.is_recurring);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>(
    todo.recurrence_pattern ?? 'daily',
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, saving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onSave(todo.id, {
        title,
        due_date: dueDate,
        priority,
        is_recurring: isRecurring,
        recurrence_pattern: recurrencePattern,
      });
      if (saved) onCancel();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-todo-heading"
        onSubmit={submit}
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="edit-todo-heading" className="text-xl font-semibold">Edit todo</h2>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Title</span>
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Due date and time (Singapore)</span>
          <input
            type="datetime-local"
            min={localDateMinimum()}
            value={dueDate}
            onChange={(event) => {
              setDueDate(event.target.value);
              if (!event.target.value) setIsRecurring(false);
            }}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              aria-label="Repeat"
              checked={isRecurring}
              disabled={!dueDate}
              onChange={(event) => setIsRecurring(event.target.checked)}
            />
            Repeat
          </label>
          {isRecurring && (
            <select
              aria-label="Recurrence pattern"
              value={recurrencePattern}
              onChange={(event) => setRecurrencePattern(event.target.value as RecurrencePattern)}
              className="rounded border border-gray-300 px-3 py-2"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          )}
          {!dueDate && (
            <span className="text-xs text-gray-500">Set a due date to enable repeat</span>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" disabled={saving} onClick={onCancel} className="rounded border px-4 py-2 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-60">
            {saving ? 'Updating…' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function TodoApp({ userId }: TodoAppProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pendingTodoIds, setPendingTodoIds] = useState<Set<number>>(() => new Set());
  const pendingTodoIdsRef = useRef(new Set<number>());
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('daily');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [activeEdit, setActiveEdit] = useState<Todo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => getSingaporeNow());

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/todos', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return (await response.json()) as Todo[];
      })
      .then(setTodos)
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => setLoading(false));
    const timer = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const filteredTodos = useMemo(
    () =>
      priorityFilter === 'all'
        ? todos
        : todos.filter((todo) => todo.priority === priorityFilter),
    [todos, priorityFilter],
  );
  const sections = useMemo(() => sectionTodos(filteredTodos, now), [filteredTodos, now]);

  async function createTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }

    let normalizedDueDate: string | null = null;
    if (dueDate) {
      normalizedDueDate = fromSingaporeDateTimeLocal(dueDate);
      if (!normalizedDueDate || Date.parse(normalizedDueDate) < now.getTime() + 60_000) {
        setError('Due date must be at least 1 minute in the future');
        return;
      }
    }

    const optimisticId = --nextOptimisticTodoId;
    const optimistic: Todo = {
      id: optimisticId,
      user_id: userId,
      title: trimmedTitle,
      completed: false,
      due_date: normalizedDueDate,
      priority,
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: now.toISOString(),
      updated_at: null,
    };
    setTodos((current) => [...current, optimistic]);
    setTitle('');
    setDueDate('');
    setPriority('medium');
    setIsRecurring(false);
    setRecurrencePattern('daily');

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          due_date: normalizedDueDate,
          priority,
          is_recurring: isRecurring,
          recurrence_pattern: recurrencePattern,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = (await response.json()) as Todo;
      setTodos((current) => current.map((todo) => (todo.id === optimisticId ? saved : todo)));
    } catch (cause) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticId));
      setTitle(trimmedTitle);
      setDueDate(dueDate);
      setPriority(priority);
      setIsRecurring(isRecurring);
      setRecurrencePattern(recurrencePattern);
      setError(cause instanceof Error ? cause.message : 'Failed to create todo');
    }
  }

  async function updateTodo(id: number, changes: UpdateTodoInput): Promise<boolean> {
    setError(null);
    if (pendingTodoIdsRef.current.has(id)) return false;
    const previous = todos.find((todo) => todo.id === id);
    if (!previous) return false;
    pendingTodoIdsRef.current.add(id);
    setPendingTodoIds((current) => new Set(current).add(id));
    setTodos((current) =>
      current.map((todo) => (todo.id === id ? { ...todo, ...changes } : todo)),
    );

    try {
      const response = await fetch(`/api/todos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const responseTodo = (await response.json()) as Todo & { nextInstance?: Todo };
      const { nextInstance, ...updated } = responseTodo;
      setTodos((current) => {
        const updatedTodos = current.map((todo) =>
          todo.id === id
            ? { ...updated, subtasks: todo.subtasks ?? updated.subtasks ?? [] }
            : todo,
        );
        if (!nextInstance || updatedTodos.some((todo) => todo.id === nextInstance.id)) {
          return updatedTodos;
        }
        return [...updatedTodos, nextInstance];
      });
      return true;
    } catch (cause) {
      setTodos((current) =>
        current.map((todo) =>
          todo.id === id
            ? { ...previous, subtasks: todo.subtasks ?? previous.subtasks ?? [] }
            : todo,
        ),
      );
      setError(cause instanceof Error ? cause.message : 'Failed to update todo');
      return false;
    } finally {
      pendingTodoIdsRef.current.delete(id);
      setPendingTodoIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function addTodoSubtask(todoId: number, title: string): Promise<boolean> {
    setError(null);
    const todo = todos.find((item) => item.id === todoId);
    if (!todo || todoId < 1) return false;

    const existingSubtasks = todo.subtasks ?? [];
    const optimisticId = --nextOptimisticSubtaskId;
    const optimistic: Subtask = {
      id: optimisticId,
      todo_id: todoId,
      title,
      completed: false,
      position: existingSubtasks.reduce((maximum, item) => Math.max(maximum, item.position), -1) + 1,
      created_at: getSingaporeNow().toISOString(),
    };
    setTodos((current) =>
      current.map((item) =>
        item.id === todoId ? { ...item, subtasks: [...(item.subtasks ?? []), optimistic] } : item,
      ),
    );

    try {
      const response = await fetch(`/api/todos/${todoId}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = (await response.json()) as Subtask;
      setTodos((current) =>
        current.map((item) => {
          if (item.id !== todoId) return item;
          const currentSubtasks = (item.subtasks ?? []).filter(
            (subtask) => subtask.id !== optimisticId,
          );
          const reconciledSubtasks = currentSubtasks.some((subtask) => subtask.id === saved.id)
            ? currentSubtasks
            : [...currentSubtasks, saved];
          return {
            ...item,
            subtasks: reconciledSubtasks.sort(
              (left, right) => left.position - right.position || left.id - right.id,
            ),
          };
        }),
      );
      return true;
    } catch (cause) {
      setTodos((current) =>
        current.map((item) =>
          item.id === todoId
            ? { ...item, subtasks: (item.subtasks ?? []).filter((subtask) => subtask.id !== optimisticId) }
            : item,
        ),
      );
      setError(cause instanceof Error ? cause.message : 'Failed to add subtask');
      return false;
    }
  }

  async function toggleTodoSubtask(
    todo: Todo,
    subtask: Subtask,
    completed: boolean,
  ): Promise<boolean> {
    setError(null);
    setTodos((current) =>
      current.map((item) =>
        item.id === todo.id
          ? {
              ...item,
              subtasks: (item.subtasks ?? []).map((child) =>
                child.id === subtask.id ? { ...child, completed } : child,
              ),
            }
          : item,
      ),
    );

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const updated = (await response.json()) as Subtask;
      setTodos((current) =>
        current.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                subtasks: (item.subtasks ?? []).map((child) =>
                  child.id === updated.id ? updated : child,
                ),
              }
            : item,
        ),
      );
      return true;
    } catch (cause) {
      setTodos((current) =>
        current.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                subtasks: (item.subtasks ?? []).map((child) =>
                  child.id === subtask.id ? { ...child, completed: subtask.completed } : child,
                ),
              }
            : item,
        ),
      );
      setError(cause instanceof Error ? cause.message : 'Failed to update subtask');
      return false;
    }
  }

  async function deleteTodoSubtask(todo: Todo, subtask: Subtask): Promise<boolean> {
    setError(null);
    setTodos((current) =>
      current.map((item) =>
        item.id === todo.id
          ? { ...item, subtasks: (item.subtasks ?? []).filter((child) => child.id !== subtask.id) }
          : item,
      ),
    );

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await errorMessage(response));
      return true;
    } catch (cause) {
      setTodos((current) =>
        current.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                subtasks: (item.subtasks ?? []).some((child) => child.id === subtask.id)
                  ? item.subtasks
                  : [...(item.subtasks ?? []), subtask].sort(
                      (left, right) => left.position - right.position || left.id - right.id,
                    ),
              }
            : item,
        ),
      );
      setError(cause instanceof Error ? cause.message : 'Failed to delete subtask');
      return false;
    }
  }

  async function saveEdit(id: number, draft: TodoEditDraft): Promise<boolean> {
    const todo = todos.find((item) => item.id === id);
    if (!todo) return false;
    const result = buildTodoEditUpdate(todo, draft, getSingaporeNow());
    if (!result.success) {
      setError(result.error);
      return false;
    }
    return updateTodo(id, result.data);
  }

  async function deleteTodo(todo: Todo) {
    setError(null);
    setTodos((current) => current.filter((item) => item.id !== todo.id));
    try {
      const response = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await errorMessage(response));
    } catch (cause) {
      setTodos((current) =>
        current.some((item) => item.id === todo.id) ? current : [...current, todo],
      );
      setError(cause instanceof Error ? cause.message : 'Failed to delete todo');
    }
  }

  return (
    <div className="mt-8">
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="text-xl font-semibold">Add a todo</h2>
        <form onSubmit={createTodo} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Title</span>
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              placeholder="What needs to be done?"
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Due date and time (Singapore)</span>
            <input
              type="datetime-local"
              min={localDateMinimum()}
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                if (!event.target.value) setIsRecurring(false);
              }}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              aria-label="Repeat"
              checked={isRecurring}
              disabled={!dueDate}
              onChange={(event) => setIsRecurring(event.target.checked)}
            />
            Repeat
          </label>
          {isRecurring && (
            <label>
              <span className="mb-1 block text-sm font-medium">Repeats</span>
              <select
                aria-label="Recurrence pattern"
                value={recurrencePattern}
                onChange={(event) => setRecurrencePattern(event.target.value as RecurrencePattern)}
                className="w-full rounded border border-gray-300 px-3 py-2"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          )}
          {!dueDate && (
            <p className="text-xs text-gray-500">Set a due date to enable repeat</p>
          )}
          <label>
            <span className="mb-1 block text-sm font-medium">Priority</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded bg-blue-700 px-4 py-2 font-medium text-white">
              Add
            </button>
          </div>
        </form>
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {!loading && !error && todos.length === 0 && (
        <p className="mt-8 text-center text-gray-600">No todos yet. Add one above to get started.</p>
      )}
      {!loading && todos.length > 0 && (
        <label className="mt-8 flex items-center gap-3">
          <span className="font-medium">Filter by priority</span>
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
            className="rounded border border-gray-300 bg-white px-3 py-2"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>
        </label>
      )}
      {loading ? (
        <p className="mt-8" role="status">Loading todos…</p>
      ) : (
        <>
          <TodoSection
            title="Overdue"
            todos={sections.overdue}
            onToggle={(todo, completed) => updateTodo(todo.id, { completed })}
            onEdit={setActiveEdit}
            onDelete={(todo) => void deleteTodo(todo)}
            onAddSubtask={addTodoSubtask}
            onToggleSubtask={toggleTodoSubtask}
            onDeleteSubtask={deleteTodoSubtask}
            pendingTodoIds={pendingTodoIds}
          />
          <TodoSection
            title="Pending"
            todos={sections.pending}
            onToggle={(todo, completed) => updateTodo(todo.id, { completed })}
            onEdit={setActiveEdit}
            onDelete={(todo) => void deleteTodo(todo)}
            onAddSubtask={addTodoSubtask}
            onToggleSubtask={toggleTodoSubtask}
            onDeleteSubtask={deleteTodoSubtask}
            pendingTodoIds={pendingTodoIds}
          />
          <TodoSection
            title="Completed"
            todos={sections.completed}
            onToggle={(todo, completed) => updateTodo(todo.id, { completed })}
            onEdit={setActiveEdit}
            onDelete={(todo) => void deleteTodo(todo)}
            onAddSubtask={addTodoSubtask}
            onToggleSubtask={toggleTodoSubtask}
            onDeleteSubtask={deleteTodoSubtask}
            pendingTodoIds={pendingTodoIds}
          />
        </>
      )}

      {activeEdit && (
        <TodoEditDialog
          key={activeEdit.id}
          todo={activeEdit}
          onCancel={() => setActiveEdit(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}
