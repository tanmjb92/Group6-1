'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Priority, Todo, UpdateTodoInput } from '@/lib/db';
import { buildTodoEditUpdate, type TodoEditDraft } from '@/lib/todo-input';
import {
  fromSingaporeDateTimeLocal,
  formatSingaporeDate,
  getSingaporeDateTimeLocal,
  getSingaporeNow,
} from '@/lib/timezone';
import { sectionTodos } from '@/lib/todo-sort';

type TodoAppProps = { userId: number };
let nextOptimisticTodoId = 0;

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

function TodoRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
}: {
  todo: Todo;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={(event) => onToggle(todo, event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
          aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
        />
        <div className="min-w-0">
          <p className={`break-words font-medium ${todo.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
            {todo.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-gray-600">
            <span className="capitalize">{todo.priority} priority</span>
            {todo.due_date && <time dateTime={todo.due_date}>{formatSingaporeDate(new Date(todo.due_date))}</time>}
          </div>
        </div>
      </div>
      <div className="flex gap-4 text-sm">
        <button type="button" onClick={() => onEdit(todo)} className="text-blue-700 underline">
          Edit
        </button>
        <button type="button" onClick={() => onDelete(todo)} className="text-red-700 underline">
          Delete
        </button>
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
}: {
  title: string;
  todos: Todo[];
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const saved = await onSave(todo.id, { title, due_date: dueDate, priority });
    setSaving(false);
    if (saved) onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
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
            onChange={(event) => setDueDate(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
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
          <button type="button" onClick={onCancel} className="rounded border px-4 py-2">
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
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
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

  const sections = useMemo(() => sectionTodos(todos, now), [todos, now]);

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
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: now.toISOString(),
      updated_at: null,
    };
    setTodos((current) => [...current, optimistic]);
    setTitle('');
    setDueDate('');
    setPriority('medium');

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, due_date: normalizedDueDate, priority }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = (await response.json()) as Todo;
      setTodos((current) => current.map((todo) => (todo.id === optimisticId ? saved : todo)));
    } catch (cause) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticId));
      setTitle(trimmedTitle);
      setDueDate(dueDate);
      setPriority(priority);
      setError(cause instanceof Error ? cause.message : 'Failed to create todo');
    }
  }

  async function updateTodo(id: number, changes: UpdateTodoInput): Promise<boolean> {
    setError(null);
    const previous = todos.find((todo) => todo.id === id);
    if (!previous) return false;
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
      const updated = (await response.json()) as Todo;
      setTodos((current) => current.map((todo) => (todo.id === id ? updated : todo)));
      return true;
    } catch (cause) {
      setTodos((current) => current.map((todo) => (todo.id === id ? previous : todo)));
      setError(cause instanceof Error ? cause.message : 'Failed to update todo');
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
              onChange={(event) => setDueDate(event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
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
      {loading ? (
        <p className="mt-8" role="status">Loading todos…</p>
      ) : (
        <>
          <TodoSection title="Overdue" todos={sections.overdue} onToggle={(todo, completed) => void updateTodo(todo.id, { completed })} onEdit={setActiveEdit} onDelete={(todo) => void deleteTodo(todo)} />
          <TodoSection title="Pending" todos={sections.pending} onToggle={(todo, completed) => void updateTodo(todo.id, { completed })} onEdit={setActiveEdit} onDelete={(todo) => void deleteTodo(todo)} />
          <TodoSection title="Completed" todos={sections.completed} onToggle={(todo, completed) => void updateTodo(todo.id, { completed })} onEdit={setActiveEdit} onDelete={(todo) => void deleteTodo(todo)} />
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
