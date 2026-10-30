'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  CreateTagInput,
  CreateTemplateInput,
  Priority,
  ReminderMinutes,
  RecurrencePattern,
  Subtask,
  Tag,
  Template,
  TemplateSubtask,
  Todo,
  UpdateTagInput,
  UpdateTodoInput,
} from '@/lib/db';
import { REMINDER_LABELS, REMINDER_PRESETS } from '@/lib/reminder-options';
import { buildTodoEditUpdate, type TodoEditDraft } from '@/lib/todo-input';
import { ManageTagsModal, TagPill, TagSelector } from './tag-ui';
import { LARGE_IMPORT_WARNING_BYTES, MAX_IMPORT_BODY_BYTES } from '@/lib/import-limits';
import { SUBTASK_TITLE_MAX_LENGTH } from '@/lib/subtask-constants';
import { calculateProgress } from '@/lib/subtask-progress';
import {
  fromSingaporeDateTimeLocal,
  formatSingaporeDate,
  getSingaporeDateTimeLocal,
  getSingaporeNow,
} from '@/lib/timezone';
import { sectionTodos } from '@/lib/todo-sort';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { parseTemplateSubtasks, TEMPLATE_REMINDERS, validateTemplate } from '@/lib/template-input';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterState } from '@/lib/filters';
import { deletePreset, loadPresets, savePreset, type FilterPreset } from '@/lib/filter-presets';
import { useDebounce } from '@/lib/hooks/useDebounce';

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

async function loadTodoData(signal?: AbortSignal): Promise<{ todos: Todo[]; tags: Tag[] }> {
  const [todosResponse, tagsResponse] = await Promise.all([
    fetch('/api/todos', { signal }),
    fetch('/api/tags', { signal }),
  ]);
  if (!todosResponse.ok) throw new Error(await errorMessage(todosResponse));
  if (!tagsResponse.ok) throw new Error(await errorMessage(tagsResponse));
  const [todos, tags] = await Promise.all([
    todosResponse.json() as Promise<Todo[]>,
    tagsResponse.json() as Promise<Tag[]>,
  ]);
  return { todos, tags };
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

function ReminderBadge({ minutes }: { minutes: ReminderMinutes }) {
  return (
    <span
      data-testid={`reminder-badge-${minutes}`}
      className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100"
    >
      🔔 {REMINDER_LABELS[minutes]}
    </span>
  );
}

function ReminderSelect({
  value,
  disabled,
  onChange,
}: {
  value: ReminderMinutes | null;
  disabled: boolean;
  onChange: (value: ReminderMinutes | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">Reminder</span>
      <select
        aria-label="Reminder"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value ? (Number(event.target.value) as ReminderMinutes) : null)
        }
        className="w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100"
      >
        <option value="">None</option>
        {REMINDER_PRESETS.map((minutes) => (
          <option key={minutes} value={minutes}>
            {minutes === 15 || minutes === 30
              ? `${minutes} minutes before`
              : minutes === 60
                ? '1 hour before'
                : minutes === 120
                  ? '2 hours before'
                  : minutes === 1440
                    ? '1 day before'
                    : minutes === 2880
                      ? '2 days before'
                      : '1 week before'}
          </option>
        ))}
      </select>
    </label>
  );
}

function TodoRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
  onSaveTemplate,
  onTagFilter,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  todoUpdating,
}: {
  todo: Todo;
  onToggle: (todo: Todo, completed: boolean) => Promise<boolean>;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onSaveTemplate: (todo: Todo) => void;
  onTagFilter: (tag: Tag) => void;
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
      <button type="button" aria-label={`Save "${todo.title}" as template`}
        disabled={todo.id < 0 || todoUpdating || addingSubtask || pendingSubtaskIds.size > 0}
        onClick={() => onSaveTemplate(todo)} className="text-sm text-blue-700 underline">
        Save as Template
      </button>
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
            {todo.reminder_minutes !== null && (
              <ReminderBadge minutes={todo.reminder_minutes} />
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-gray-600">
            {todo.due_date && <time dateTime={todo.due_date}>{formatSingaporeDate(new Date(todo.due_date))}</time>}
          </div>
          {!!todo.tags?.length && (
            <div className="mt-2 flex flex-wrap gap-2">
              {todo.tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  label={`Filter by tag ${tag.name}`}
                  onClick={() => onTagFilter(tag)}
                />
              ))}
            </div>
          )}
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
  onSaveTemplate,
  onTagFilter,
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
  onSaveTemplate: (todo: Todo) => void;
  onTagFilter: (tag: Tag) => void;
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

  if (todos.length === 0) return null;

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
              onSaveTemplate={onSaveTemplate}
              onTagFilter={onTagFilter}
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
  tags,
  onCancel,
  onSave,
}: {
  todo: Todo;
  tags: Tag[];
  onCancel: () => void;
  onSave: (id: number, draft: TodoEditDraft) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(todo.title);
  const [dueDate, setDueDate] = useState(
    todo.due_date ? getSingaporeDateTimeLocal(new Date(todo.due_date)) : '',
  );
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes | null>(
    todo.reminder_minutes as ReminderMinutes | null,
  );
  const [priority, setPriority] = useState<Priority>(todo.priority);
  const [isRecurring, setIsRecurring] = useState(todo.is_recurring);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>(
    todo.recurrence_pattern ?? 'daily',
  );
  const [saving, setSaving] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(
    (todo.tags ?? []).map((tag) => tag.id),
  );
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
        reminder_minutes: reminderMinutes,
        tag_ids: selectedTagIds,
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
        <TagSelector
          tags={tags}
          selectedIds={selectedTagIds}
          onToggle={(id) =>
            setSelectedTagIds((current) =>
              current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id],
            )
          }
        />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Due date and time (Singapore)</span>
          <input
            type="datetime-local"
            min={localDateMinimum()}
            value={dueDate}
            onChange={(event) => {
              setDueDate(event.target.value);
              if (!event.target.value) {
                setIsRecurring(false);
                setReminderMinutes(null);
              }
            }}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <ReminderSelect
          value={reminderMinutes}
          disabled={!dueDate}
          onChange={setReminderMinutes}
        />
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

function TemplateEditor({
  initial, onClose, onSave,
}: {
  initial: CreateTemplateInput & { id?: number };
  onClose: () => void;
  onSave: (input: CreateTemplateInput, id?: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [offset, setOffset] = useState(initial.due_date_offset_minutes?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const { id, ...fields } = draft;
    const result = validateTemplate({
      ...fields, due_date_offset_minutes: offset === '' ? null : Number(offset),
    });
    if (!result.success) { setError(result.error); return; }
    setSaving(true);
    savingRef.current = true;
    setError(null);
    try {
      await onSave(result.data, id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save template');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="template-editor-heading"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
      className="m-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl p-6 shadow-xl backdrop:bg-black/40"
    >
      <h2 id="template-editor-heading" className="text-xl font-semibold">
        {initial.id ? 'Edit Template' : 'Save as Template'}
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Saves title, priority, recurrence, relative timing, reminders, and an unchecked checklist. Tags are not copied.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <fieldset disabled={saving} className="space-y-3 disabled:opacity-60">
          <label className="block">Template name
            <input autoFocus required maxLength={200} value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="block w-full rounded border p-2" />
          </label>
          <label className="block">Todo title
            <input required maxLength={200} value={draft.title_template}
              onChange={(event) => setDraft({ ...draft, title_template: event.target.value })}
              className="block w-full rounded border p-2" />
          </label>
          <label className="block">Description
            <textarea maxLength={2000} value={draft.description ?? ''}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className="block w-full rounded border p-2" />
          </label>
          <label className="block">Category
            <input list="template-category-suggestions" maxLength={100} value={draft.category ?? ''}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              className="block w-full rounded border p-2" />
          </label>
          <datalist id="template-category-suggestions">
            {['Work', 'Personal', 'Finance', 'Health', 'Education'].map((category) => <option key={category} value={category} />)}
          </datalist>
          <label className="block">Priority
            <select aria-label="Priority" value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              className="block w-full rounded border p-2">
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </label>
          <label className="block">Due-date offset (minutes)
            <input type="number" min={1} step={1} value={offset}
              onChange={(event) => setOffset(event.target.value)}
              className="block w-full rounded border p-2" />
          </label>
          <p className="text-sm text-gray-600">
            Leave blank for no due date. Otherwise, each use sets a new due date this many minutes from now (Singapore time).
          </p>
          <label className="block">Reminder timing
            <select aria-label="Reminder timing" value={draft.reminder_minutes ?? ''}
              onChange={(event) => setDraft({
                ...draft, reminder_minutes: event.target.value === '' ? null : Number(event.target.value) as ReminderMinutes,
              })} className="block w-full rounded border p-2">
              <option value="">No reminder</option>
              {TEMPLATE_REMINDERS.map((option) => (
                <option key={option.minutes} value={option.minutes}>{option.label}</option>
              ))}
            </select>
          </label>
          <p className="text-sm text-gray-600">
            Reminder settings are copied to new todos. Browser notification delivery is not yet available.
            Reminders require a due-date offset; an offset shorter than the reminder period makes it immediately due.
          </p>
          <fieldset className="space-y-2 rounded border p-3">
            <legend>Checklist</legend>
            <p className="text-sm text-gray-600">Every use creates fresh unchecked items in this order.</p>
            {draft.subtasks.map((item, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <label className="flex-1">Checklist item {index + 1}
                  <input required maxLength={SUBTASK_TITLE_MAX_LENGTH} value={item.title}
                    onChange={(event) => setDraft({
                      ...draft, subtasks: draft.subtasks.map((entry, itemIndex) =>
                        itemIndex === index ? { ...entry, title: event.target.value } : entry),
                    })} className="block w-full rounded border p-2" />
                </label>
                <button type="button" disabled={index === 0} aria-label={`Move checklist item ${index + 1} up`}
                  onClick={() => setDraft({
                    ...draft,
                    subtasks: [
                      ...draft.subtasks.slice(0, index - 1), item, draft.subtasks[index - 1],
                      ...draft.subtasks.slice(index + 1),
                    ].map((entry, position) => ({ ...entry, position })),
                  })} className="rounded border px-2 py-1">Up</button>
                <button type="button" aria-label={`Remove checklist item ${index + 1}`}
                  onClick={() => setDraft({
                    ...draft, subtasks: draft.subtasks.filter((_, itemIndex) => itemIndex !== index)
                      .map((entry, position) => ({ ...entry, position })),
                  })} className="text-red-700 underline">Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setDraft({
              ...draft, subtasks: [...draft.subtasks, { title: '', position: draft.subtasks.length }],
            })} className="rounded border px-3 py-1">Add checklist item</button>
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.is_recurring}
              onChange={(event) => setDraft({
                ...draft, is_recurring: event.target.checked,
                recurrence_pattern: draft.recurrence_pattern ?? 'daily',
              })} />
            Repeat
          </label>
          {draft.is_recurring && (
            <label className="block">Recurrence pattern
              <select aria-label="Recurrence pattern" value={draft.recurrence_pattern ?? 'daily'}
                onChange={(event) => setDraft({ ...draft, recurrence_pattern: event.target.value as RecurrencePattern })}
                className="block w-full rounded border p-2">
                <option value="daily">Daily</option><option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
              </select>
            </label>
          )}
        </fieldset>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={saving} onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
          <button type="submit" disabled={saving} className="rounded bg-blue-700 px-4 py-2 text-white">
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function TemplateManager({
  templates, busy, error, onClose, onUse, onEdit, onDelete,
}: {
  templates: Template[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onUse: (id: number) => void;
  onEdit: (template: Template) => void;
  onDelete: (template: Template) => void;
}) {
  const [category, setCategory] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const categories = [...new Set(templates.flatMap((template) => template.category ? [template.category] : []))].sort();
  const visible = category ? templates.filter((template) => template.category === category) : templates;
  return (
    <dialog ref={dialog} aria-labelledby="template-manager-heading"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl p-6 shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-4">
        <h2 id="template-manager-heading" className="text-xl font-semibold">Templates</h2>
        <button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-1">Close</button>
      </div>
      <label className="my-4 block">Filter templates by category
        <select aria-label="Filter templates by category" value={category} onChange={(event) => setCategory(event.target.value)}
          className="ml-3 rounded border p-2">
          <option value="">All categories</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {visible.length === 0 && <p>No templates in this category.</p>}
      <ul className="space-y-4">
        {visible.map((template) => (
          <li key={template.id} className="space-y-2 break-words rounded border p-4">
            <h3 className="font-semibold">{template.name}</h3>
            {template.category && <p className="text-sm">{template.category}</p>}
            {template.description && <p>{template.description}</p>}
            <p>Todo: {template.title_template}</p>
            <div className="flex flex-wrap gap-2">
              <PriorityBadge priority={template.priority} />
              {template.is_recurring && template.recurrence_pattern && <RecurrenceBadge pattern={template.recurrence_pattern} />}
            </div>
            <p className="text-sm">{template.due_date_offset_minutes === null
              ? 'No due date' : `Due ${template.due_date_offset_minutes} minutes after use (Singapore time)`}</p>
            {template.reminder_minutes !== null && (
              <p className="text-sm">Reminder: {TEMPLATE_REMINDERS.find(
                (option) => option.minutes === template.reminder_minutes,
              )?.label ?? `${template.reminder_minutes} minutes before`} (notification delivery not yet available)</p>
            )}
            <TemplateChecklistPreview json={template.subtasks_json} />
            <div className="flex gap-4">
              <button type="button" disabled={busy} onClick={() => onUse(template.id)} className="text-blue-700 underline">Use</button>
              <button type="button" disabled={busy} onClick={() => onEdit(template)} className="text-blue-700 underline">Edit</button>
              <button type="button" disabled={busy} onClick={() => onDelete(template)} className="text-red-700 underline">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </dialog>
  );
}

function TemplateChecklistPreview({ json }: { json: string | null }) {
  let items: TemplateSubtask[] = [];
  let message: string | null = null;
  try {
    items = parseTemplateSubtasks(json).sort((a, b) => a.position - b.position);
  } catch (error) {
    message = error instanceof Error ? error.message : 'Cannot read template checklist';
  }
  if (message) return <p role="alert" className="text-red-700">{message}</p>;
  return items.length > 0 ? (
    <ol className="max-h-48 list-inside list-decimal overflow-y-auto text-sm">
      {items.map((item) => <li key={item.position}>{item.title}</li>)}
    </ol>
  ) : <p className="text-sm">No checklist items</p>;
}

function filterSummary(filters: FilterState, tags: Tag[]): string {
  const parts: string[] = [];
  if (filters.search.trim()) parts.push(`Search: "${filters.search.trim()}"`);
  if (filters.priority !== 'all') parts.push(`Priority: ${filters.priority}`);
  if (filters.tagId !== 'all') parts.push(`Tag: ${tags.find((tag) => tag.id === filters.tagId)?.name ?? 'Deleted tag'}`);
  if (filters.completion !== 'all') parts.push(
    `Completion: ${filters.completion === 'incomplete' ? 'Incomplete' : 'Completed'}`,
  );
  if (filters.dueDateFrom || filters.dueDateTo) parts.push(
    `Date (Singapore): ${filters.dueDateFrom ?? 'any'} to ${filters.dueDateTo ?? 'any'}`,
  );
  return parts.join(' | ');
}

function SaveFilterDialog({
  filters, tags, onClose, onSave,
}: {
  filters: FilterState;
  tags: Tag[];
  onClose: () => void;
  onSave: (name: string, filters: FilterState) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError('Filter name is required'); return; }
    try {
      onSave(name.trim(), filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save filter preset');
    }
  }
  return (
    <dialog ref={dialog} aria-labelledby="save-filter-heading" onCancel={onClose}
      className="m-auto w-full max-w-lg rounded-xl p-6 shadow-xl backdrop:bg-black/40">
      <h2 id="save-filter-heading" className="text-xl font-semibold">Save Filter</h2>
      <p className="my-4 break-words text-sm">{filterSummary(filters, tags)}</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">Filter name
          <input autoFocus required maxLength={100} value={name}
            onChange={(event) => setName(event.target.value)} className="block w-full rounded border p-2" />
        </label>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
          <button type="submit" className="rounded bg-green-700 px-4 py-2 text-white">Save</button>
        </div>
      </form>
    </dialog>
  );
}

export default function TodoApp({ userId }: TodoAppProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pendingTodoIds, setPendingTodoIds] = useState<Set<number>>(() => new Set());
  const pendingTodoIdsRef = useRef(new Set<number>());
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes | null>(null);
  const [priority, setPriority] = useState<Priority>('medium');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('daily');
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTER_STATE });
  const { debouncedValue: debouncedSearch, flush: flushSearch } = useDebounce(filters.search, 300);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<FilterState | null>(null);
  const [manageTags, setManageTags] = useState(false);
  const [activeEdit, setActiveEdit] = useState<Todo | null>(null);
  const [importing, setImporting] = useState(false);
  const [transferMessage, setTransferMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => getSingaporeNow());
  const { permission, error: notificationError, requestPermission } = useNotifications();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<(CreateTemplateInput & { id?: number }) | null>(null);
  const priorityFilter = filters.priority;
  const tagFilter = !loading && filters.tagId !== 'all' && !tags.some((tag) => tag.id === filters.tagId)
    ? 'all' : filters.tagId;
  const activeFilters = hasActiveFilters({ ...filters, tagId: tagFilter });

  function setTagFilter(tagId: number | 'all') {
    setFilters((current) => ({ ...current, tagId }));
  }
  function setPriorityFilter(priority: PriorityFilter) {
    setFilters((current) => ({ ...current, priority }));
  }
  function clearSearch() {
    setFilters((current) => ({ ...current, search: '' }));
    flushSearch('');
  }
  function clearFilters() {
    setFilters({ ...DEFAULT_FILTER_STATE });
    flushSearch('');
    setFilterNotice(null);
  }
  function applyPreset(preset: FilterPreset) {
    const missingTag = preset.filters.tagId !== 'all' && !tags.some((tag) => tag.id === preset.filters.tagId);
    const next = { ...preset.filters, tagId: missingTag ? 'all' as const : preset.filters.tagId };
    setFilters(next);
    flushSearch(next.search);
    setFilterNotice(missingTag ? 'This preset tag no longer exists. Showing all tags instead.' : null);
  }
  function saveCurrentPreset(name: string, snapshot: FilterState) {
    const saved = savePreset({
      id: crypto.randomUUID(), name, filters: snapshot, createdAt: getSingaporeNow().toISOString(),
    });
    setPresets(saved);
    setPresetError(null);
    setPresetDraft(null);
    setAdvancedOpen(true);
  }
  function removePreset(preset: FilterPreset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      setPresets(deletePreset(preset.id));
      setPresetError(null);
    } catch (cause) {
      setPresetError(cause instanceof Error ? cause.message : 'Could not delete preset');
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setPresets(loadPresets(undefined, setPresetError));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/templates', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return (await response.json()) as Template[];
      })
      .then(setTemplates)
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setTemplateError(cause instanceof Error ? cause.message : 'Failed to load templates');
      })
      .finally(() => setTemplatesLoading(false));
    return () => controller.abort();
  }, []);

  function openTemplateEditor() {
    let offset: number | null = null;
    if (dueDate) {
      const due = fromSingaporeDateTimeLocal(dueDate);
      if (!due || Date.parse(due) < getSingaporeNow().getTime() + 60_000) {
        setTemplateError('Due date must be at least 1 minute in the future');
        return;
      }
      offset = Math.ceil((Date.parse(due) - getSingaporeNow().getTime()) / 60_000);
    }
    setTemplateError(null);
    setTemplateDraft({
      name: '', description: null, category: null, title_template: title.trim(),
      priority, is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
      due_date_offset_minutes: offset,
      reminder_minutes: reminderMinutes, subtasks: [],
    });
  }

  function saveTodoAsTemplate(todo: Todo) {
    if (todo.id < 0) return;
    const minutes = todo.due_date
      ? Math.ceil((Date.parse(todo.due_date) - getSingaporeNow().getTime()) / 60_000) : null;
    setTemplateError(null);
    setTemplateDraft({
      name: '', description: null, category: null, title_template: todo.title,
      priority: todo.priority, is_recurring: todo.is_recurring,
      recurrence_pattern: todo.recurrence_pattern,
      due_date_offset_minutes: minutes !== null && minutes >= 1 ? minutes : null,
      reminder_minutes: todo.reminder_minutes,
      subtasks: (todo.subtasks ?? []).map(({ title, position }) => ({ title, position }))
        .sort((a, b) => a.position - b.position).map((item, position) => ({ ...item, position })),
    });
  }

  function editTemplate(template: Template) {
    try {
      const subtasks = parseTemplateSubtasks(template.subtasks_json)
        .sort((a, b) => a.position - b.position).map((item, position) => ({ ...item, position }));
      setTemplateDraft({
        id: template.id, name: template.name, description: template.description,
        category: template.category, title_template: template.title_template,
        priority: template.priority, is_recurring: template.is_recurring,
        recurrence_pattern: template.recurrence_pattern,
        due_date_offset_minutes: template.due_date_offset_minutes,
        reminder_minutes: template.reminder_minutes, subtasks,
      });
      setManagerOpen(false);
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : 'Cannot edit template checklist');
    }
  }

  async function saveTemplate(input: CreateTemplateInput, id?: number) {
    const response = await fetch(id ? `/api/templates/${id}` : '/api/templates', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const saved = (await response.json()) as Template;
    setTemplates((current) => id ? current.map((item) => item.id === id ? saved : item) : [saved, ...current]);
    setTemplateDraft(null);
    setTemplateError(null);
    if (id) setManagerOpen(true);
  }

  async function createTodoFromTemplate(id: number) {
    if (templateBusy) return;
    setTemplateBusy(true);
    setTemplateError(null);
    try {
      const response = await fetch(`/api/templates/${id}/use`, { method: 'POST' });
      if (!response.ok) throw new Error(await errorMessage(response));
      const todo = (await response.json()) as Todo;
      setTodos((current) => [...current, todo]);
      setPriorityFilter('all');
      setManagerOpen(false);
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : 'Failed to use template');
    } finally {
      setTemplateBusy(false);
    }
  }

  async function deleteTemplate(template: Template) {
    if (templateBusy || !window.confirm(`Delete template "${template.name}"? Existing todos will not be changed.`)) return;
    setTemplateBusy(true);
    setTemplateError(null);
    try {
      const response = await fetch(`/api/templates/${template.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await errorMessage(response));
      setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : 'Failed to delete template');
    } finally {
      setTemplateBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadTodoData(controller.signal)
      .then(({ todos: todoRows, tags: tagRows }) => {
        setTags(tagRows);
        setTodos(todoRows);
      })
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

  const filteredTodos = useMemo(() => applyFilters(todos, {
    search: debouncedSearch, priority: priorityFilter, tagId: tagFilter,
    completion: filters.completion, dueDateFrom: filters.dueDateFrom, dueDateTo: filters.dueDateTo,
  }), [todos, debouncedSearch, priorityFilter, tagFilter, filters.completion, filters.dueDateFrom, filters.dueDateTo]);
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
      reminder_minutes: reminderMinutes,
      last_notification_sent: null,
      created_at: now.toISOString(),
      updated_at: null,
      tags: tags.filter((tag) => selectedTagIds.includes(tag.id)),
    };
    setTodos((current) => [...current, optimistic]);
    setTitle('');
    setDueDate('');
    setReminderMinutes(null);
    setPriority('medium');
    setIsRecurring(false);
    setRecurrencePattern('daily');
    const assignedTagIds = selectedTagIds;
    setSelectedTagIds([]);

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          due_date: normalizedDueDate,
          reminder_minutes: reminderMinutes,
          priority,
          is_recurring: isRecurring,
          recurrence_pattern: recurrencePattern,
          tag_ids: assignedTagIds,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = (await response.json()) as Todo;
      setTodos((current) => current.map((todo) => (todo.id === optimisticId ? saved : todo)));
    } catch (cause) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticId));
      setTitle(trimmedTitle);
      setDueDate(dueDate);
      setReminderMinutes(reminderMinutes);
      setPriority(priority);
      setIsRecurring(isRecurring);
      setRecurrencePattern(recurrencePattern);
      setSelectedTagIds(assignedTagIds);
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

  async function createTag(input: CreateTagInput) {
    const response = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const tag = (await response.json()) as Tag;
    setTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function updateTag(id: number, input: UpdateTagInput) {
    const response = await fetch(`/api/tags/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const updated = (await response.json()) as Tag;
    setTags((current) =>
      current.map((tag) => (tag.id === id ? updated : tag)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    setTodos((current) =>
      current.map((todo) => ({
        ...todo,
        tags: todo.tags?.map((tag) => (tag.id === id ? updated : tag)),
      })),
    );
  }

  async function deleteTag(id: number) {
    const response = await fetch(`/api/tags/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await errorMessage(response));
    setTags((current) => current.filter((tag) => tag.id !== id));
    setTodos((current) =>
      current.map((todo) => ({ ...todo, tags: todo.tags?.filter((tag) => tag.id !== id) })),
    );
    setSelectedTagIds((current) => current.filter((tagId) => tagId !== id));
    setFilters((current) => ({ ...current, tagId: current.tagId === id ? 'all' : current.tagId }));
  }

  async function importTodos(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setTransferMessage(null);
    let importedCount: number | null = null;
    try {
      if (file.size > MAX_IMPORT_BODY_BYTES) {
        throw new Error('Import file is too large (25 MiB maximum)');
      }
      if (file.size > LARGE_IMPORT_WARNING_BYTES) {
        setTransferMessage({ type: 'info', text: 'Large import file; this may take a while.' });
      }

      let payload: unknown;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error('Invalid JSON format');
      }
      try {
        payload = JSON.parse(text);
      } catch (cause) {
        if (cause instanceof SyntaxError) throw new Error('Invalid JSON format');
        throw cause;
      }

      const response = await fetch('/api/todos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = (await response.json()) as { imported: number };
      importedCount = result.imported;

      try {
        const refreshed = await loadTodoData();
        setTodos(refreshed.todos);
        setTags(refreshed.tags);
      } catch {
        setTransferMessage({
          type: 'error',
          text: `Imported ${importedCount} todos, but the list could not be refreshed.`,
        });
        return;
      }

      setTransferMessage({
        type: 'success',
        text: `Successfully imported ${importedCount} todos`,
      });
    } catch (cause) {
      setTransferMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Failed to import todos',
      });
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  }

  async function exportTodos(format: 'json' | 'csv') {
    setTransferMessage(null);
    try {
      const response = await fetch(`/api/todos/export?format=${format}`);
      if (!response.ok) throw new Error(await errorMessage(response));

      const contentDisposition = response.headers.get('Content-Disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(contentDisposition)?.[1] ?? `todos.${format}`;
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (cause) {
      setTransferMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Failed to export todos',
      });
    }
  }

  return (
    <div className="mt-8">
      <section className="rounded-xl bg-white p-6 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Add a todo</h2>
          <button
            type="button"
            onClick={() => void requestPermission()}
            disabled={permission === 'granted' || permission === 'unsupported'}
            className={`rounded px-3 py-2 text-sm font-medium disabled:cursor-not-allowed ${
              permission === 'granted'
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : permission === 'denied' || permission === 'unsupported'
                  ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                  : 'bg-orange-500 text-white hover:bg-orange-600'
            }`}
          >
            {permission === 'granted'
              ? '🔔 Notifications On'
              : permission === 'denied'
                ? '🔔 Notifications Blocked'
                : permission === 'unsupported'
                  ? '🔔 Notifications Unsupported'
                  : '🔔 Enable Notifications'}
          </button>
        </div>
        {notificationError && (
          <p role="status" className="mt-2 text-sm text-red-700" aria-live="polite">
            {notificationError}
          </p>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <button type="button" disabled={templatesLoading || templateBusy}
            onClick={() => setManagerOpen(true)} className="rounded border px-4 py-2">Templates</button>
          <label>Use Template
            <select aria-label="Use Template" value="" disabled={templatesLoading || templateBusy || templates.length === 0}
              onChange={(event) => { if (event.target.value) void createTodoFromTemplate(Number(event.target.value)); }}
              className="ml-3 rounded border p-2">
              <option value="">{templatesLoading ? 'Loading templates...' : 'Choose a template'}</option>
              {templates.map((template) => <option key={template.id} value={template.id}>
                {template.name}{template.category ? ` (${template.category})` : ''}
              </option>)}
            </select>
          </label>
        </div>
        {templateError && !managerOpen && <p role="alert" className="mb-4 text-red-700">{templateError}</p>}
        <button
          type="button"
          onClick={() => setManageTags(true)}
          className="mt-2 text-sm text-blue-700 underline"
        >
          Manage Tags
        </button>
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
                if (!event.target.value) {
                  setIsRecurring(false);
                  setReminderMinutes(null);
                }
              }}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <ReminderSelect
            value={reminderMinutes}
            disabled={!dueDate}
            onChange={setReminderMinutes}
          />
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
          <TagSelector
            tags={tags}
            selectedIds={selectedTagIds}
            onToggle={(id) =>
              setSelectedTagIds((current) =>
                current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id],
              )
            }
          />
          <div className="sm:col-span-2">
            <button type="submit" className="rounded bg-blue-700 px-4 py-2 font-medium text-white">
              Add
            </button>
            {title.trim() && (
              <button type="button" disabled={templatesLoading} onClick={openTemplateEditor}
                className="ml-3 rounded border px-4 py-2">Save as Template</button>
            )}
          </div>
        </form>
      </section>

      <section aria-label="Todo backup" className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void exportTodos('json')}
          className="rounded bg-green-700 px-3 py-2 text-sm font-medium text-white"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => void exportTodos('csv')}
          className="rounded bg-green-900 px-3 py-2 text-sm font-medium text-white"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => importFileRef.current?.click()}
          disabled={importing}
          className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {importing ? 'Importing…' : 'Import JSON'}
        </button>
        <input
          ref={importFileRef}
          aria-label="Import JSON file"
          type="file"
          accept="application/json,.json"
          className="hidden"
          disabled={importing}
          onChange={importTodos}
        />
        <span className="text-xs text-gray-600">Imports add todos; they do not merge existing ones.</span>
      </section>
      {transferMessage && (
        <p
          role={transferMessage.type === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded border p-3 text-sm ${
            transferMessage.type === 'success'
              ? 'border-green-300 bg-green-50 text-green-800'
              : transferMessage.type === 'info'
                ? 'border-blue-300 bg-blue-50 text-blue-800'
                : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {transferMessage.text}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {!loading && !error && todos.length === 0 && (
        <p className="mt-8 text-center text-gray-600">No todos yet. Add one above to get started.</p>
      )}
      {!loading && (
        <section aria-label="Search and filters" className="mt-8 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2">
              <span aria-hidden="true">🔍</span>
              <span className="sr-only">Search todos and subtasks</span>
              <input type="search" placeholder="Search todos and subtasks..." value={filters.search}
                onChange={(event) => {
                  const search = event.target.value;
                  setFilters((current) => ({ ...current, search }));
                  if (search === '') flushSearch('');
                }}
                className="w-full rounded border border-gray-300 p-2 dark:border-gray-600 dark:bg-gray-800" />
            </label>
            {filters.search && <button type="button" aria-label="Clear search" onClick={clearSearch}
              className="rounded border px-3 py-2">Clear search</button>}
          </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3">
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
          {tags.length > 0 && <label className="flex items-center gap-3">
            <span className="font-medium">Filter by tags</span>
            <select
              aria-label="Filter by tags"
              value={tagFilter}
              onChange={(event) =>
                setTagFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
              className="rounded border border-gray-300 bg-white px-3 py-2"
            >
              <option value="all">All Tags</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>}
          <button type="button" aria-label="Advanced" aria-expanded={advancedOpen} aria-controls="advanced-filters"
            onClick={() => setAdvancedOpen((current) => !current)}
            className={`rounded px-3 py-2 ${advancedOpen ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-800'}`}>
            {advancedOpen ? '▼ Advanced' : '▶ Advanced'}
          </button>
          {activeFilters && <>
            <button type="button" onClick={clearFilters} className="font-medium text-red-700">Clear All</button>
            <button type="button" onClick={() => setPresetDraft({ ...filters, tagId: tagFilter })}
              className="font-medium text-green-700">Save Filter</button>
          </>}
        </div>
          {activeFilters && <p className="break-words text-sm text-gray-600" aria-label="Active filters">
            {filterSummary({ ...filters, tagId: tagFilter }, tags)}
          </p>}
          {filterNotice && <p role="status" aria-label="Filter notice" className="text-sm text-blue-800">{filterNotice}</p>}
          {presetError && <p role="alert" aria-label="Saved filter error" className="text-red-700">{presetError}</p>}
          {advancedOpen && <div id="advanced-filters" className="space-y-4 rounded border border-blue-200 p-4">
            <div className="flex flex-wrap gap-4">
              <label>Completion Status
                <select value={filters.completion}
                  onChange={(event) => setFilters((current) => ({
                    ...current, completion: event.target.value as FilterState['completion'],
                  }))} className="ml-2 rounded border p-2">
                  <option value="all">All Todos</option>
                  <option value="incomplete">Incomplete Only</option>
                  <option value="completed">Completed Only</option>
                </select>
              </label>
              <label>Due Date From
                <input type="date" value={filters.dueDateFrom ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, dueDateFrom: event.target.value || null }))}
                  className="ml-2 rounded border p-2" />
              </label>
              <label>Due Date To
                <input type="date" value={filters.dueDateTo ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, dueDateTo: event.target.value || null }))}
                  className="ml-2 rounded border p-2" />
              </label>
            </div>
            <p className="text-sm text-gray-600">Dates use Singapore time, inclusive of both bounds. Undated todos are excluded when a date bound is set.</p>
            {filters.dueDateFrom && filters.dueDateTo && filters.dueDateFrom > filters.dueDateTo &&
              <p className="text-sm text-red-700">From date is after To date.</p>}
            <h3 className="font-medium">Saved filters (this browser only)</h3>
            {presets.length === 0 && <p className="text-sm text-gray-600">No saved filters yet.</p>}
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => <span key={preset.id} className="inline-flex items-center gap-3 rounded-full border px-3 py-1">
                <button type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>
                <button type="button" aria-label={`Delete preset ${preset.name}`} onClick={() => removePreset(preset)}
                  className="text-red-700">Delete</button>
              </span>)}
            </div>
          </div>}
        </section>
      )}
      {!loading && todos.length > 0 && filteredTodos.length === 0 && (
        <p className="mt-8 text-center text-gray-600">No todos match your filters.</p>
      )}
      {loading ? (
        <p className="mt-8" role="status">Loading todos…</p>
      ) : (
        <>
          <TodoSection
            title="Overdue"
            onSaveTemplate={saveTodoAsTemplate}
            onTagFilter={(tag) => setTagFilter(tag.id)}
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
            onSaveTemplate={saveTodoAsTemplate}
            onTagFilter={(tag) => setTagFilter(tag.id)}
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
            onSaveTemplate={saveTodoAsTemplate}
            onTagFilter={(tag) => setTagFilter(tag.id)}
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
          tags={tags}
          onCancel={() => setActiveEdit(null)}
          onSave={saveEdit}
        />
      )}
      {managerOpen && (
        <TemplateManager templates={templates} busy={templateBusy} error={templateError}
          onClose={() => setManagerOpen(false)} onUse={(id) => void createTodoFromTemplate(id)}
          onEdit={editTemplate}
          onDelete={(template) => void deleteTemplate(template)} />
      )}
      {templateDraft && (
        <TemplateEditor initial={templateDraft} onClose={() => setTemplateDraft(null)} onSave={saveTemplate} />
      )}
      {manageTags && (
        <ManageTagsModal
          tags={tags}
          onClose={() => setManageTags(false)}
          onCreate={createTag}
          onUpdate={updateTag}
          onDelete={deleteTag}
        />
      )}
      {presetDraft && <SaveFilterDialog filters={presetDraft} tags={tags}
        onClose={() => setPresetDraft(null)} onSave={saveCurrentPreset} />}
    </div>
  );
}
