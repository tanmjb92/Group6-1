'use client';

import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CreateTagInput, Tag, UpdateTagInput } from '@/lib/db';
import { getTagTextColor } from '@/lib/tag-input';

export function TagPill({
  tag,
  label,
  onClick,
}: {
  tag: Tag;
  label: string;
  onClick?: () => void;
}) {
  const content = <span className="truncate">{tag.name}</span>;
  const className =
    'inline-flex max-w-40 items-center rounded-full border border-black/20 px-2 py-0.5 text-xs font-medium';
  return (
    onClick ? (
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        style={{ backgroundColor: tag.color, color: getTagTextColor(tag.color) }}
        className={className}
      >
        {content}
      </button>
    ) : (
      <span
        aria-label={label}
        style={{ backgroundColor: tag.color, color: getTagTextColor(tag.color) }}
        className={className}
      >
        {content}
      </span>
    )
  );
}

export function TagSelector({
  tags,
  selectedIds,
  onToggle,
}: {
  tags: Tag[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-2 text-sm font-medium">Tags</legend>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={selected}
              aria-label={`Toggle tag ${tag.name}`}
              onClick={() => onToggle(tag.id)}
              style={
                selected
                  ? { backgroundColor: tag.color, color: getTagTextColor(tag.color) }
                  : undefined
              }
              className={`max-w-40 truncate rounded-full border px-3 py-1 text-sm ${
                selected ? 'border-transparent' : 'border-gray-300 bg-white text-gray-800'
              }`}
            >
              {selected ? '✓ ' : ''}{tag.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ManageTagsModal({
  tags,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  tags: Tag[];
  onClose: () => void;
  onCreate: (input: CreateTagInput) => Promise<void>;
  onUpdate: (id: number, input: UpdateTagInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#3B82F6');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name, color });
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create tag');
    } finally {
      setSaving(false);
    }
  }

  async function update(event: FormEvent<HTMLFormElement>, tagId: number) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onUpdate(tagId, { name: editName, color: editColor });
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update tag');
    } finally {
      setSaving(false);
    }
  }

  async function remove(tag: Tag) {
    if (!window.confirm(`Delete tag "${tag.name}"? This removes it from all todos.`)) return;
    setError(null);
    try {
      await onDelete(tag.id);
      if (editingId === tag.id) setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete tag');
    }
  }

  function keepTabFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled)',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-tags-heading"
        onKeyDown={keepTabFocusInside}
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="manage-tags-heading" className="text-xl font-semibold">Manage Tags</h2>
        <ul className="max-h-64 space-y-3 overflow-y-auto">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center justify-between gap-2">
              {editingId === tag.id ? (
                <form
                  onSubmit={(event) => void update(event, tag.id)}
                  className="grid flex-1 grid-cols-2 gap-2"
                >
                  <label className="col-span-2">
                    <span className="sr-only">Edit tag name</span>
                    <input
                      aria-label="Edit tag name"
                      required
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      className="w-full rounded border px-2 py-1"
                    />
                  </label>
                  <label>
                    <span className="sr-only">Edit tag color</span>
                    <input
                      aria-label="Edit tag color"
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(editColor) ? editColor : '#3B82F6'}
                      onChange={(event) => setEditColor(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Edit tag hex color</span>
                    <input
                      aria-label="Edit tag hex color"
                      value={editColor}
                      onChange={(event) => setEditColor(event.target.value)}
                      className="w-full rounded border px-2 py-1"
                    />
                  </label>
                  <div className="col-span-2 flex gap-2">
                    <button type="submit" disabled={saving} className="text-blue-700 underline">
                      Save {editName || tag.name}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="underline">
                      Cancel edit
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <TagPill tag={tag} label={tag.name} />
                  <div className="flex gap-3 text-sm">
                    <button
                      type="button"
                      aria-label={`Edit ${tag.name}`}
                      onClick={() => {
                        setEditingId(tag.id);
                        setEditName(tag.name);
                        setEditColor(tag.color);
                        setError(null);
                      }}
                      className="text-blue-700 underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${tag.name}`}
                      onClick={() => void remove(tag)}
                      className="text-red-700 underline"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          {tags.length === 0 && <li className="text-sm text-gray-500">No tags yet.</li>}
        </ul>

        <form onSubmit={(event) => void create(event)} className="grid grid-cols-2 gap-3 border-t pt-4">
          <label className="col-span-2">
            <span className="mb-1 block text-sm font-medium">Tag name</span>
            <input
              autoFocus
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded border px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Tag color</span>
            <input
              aria-label="Tag color"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3B82F6'}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Hex color</span>
            <input
              aria-label="Hex color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="w-full rounded border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="col-span-2 rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            Create Tag
          </button>
        </form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="button" onClick={onClose} className="text-gray-700 underline">Close</button>
      </section>
    </div>
  );
}
