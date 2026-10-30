'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReminderMinutes, Todo } from '@/lib/db';
import { formatSingaporeDate } from '@/lib/timezone';

const POLL_INTERVAL_MS = 30_000;

type NotificationStatus = NotificationPermission | 'unsupported';
type ReminderTodo = Pick<Todo, 'id' | 'title' | 'due_date' | 'reminder_minutes'>;

function reminderKey(todo: ReminderTodo): string {
  return `${todo.id}:${todo.due_date}:${todo.reminder_minutes}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected notification error';
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationStatus>('default');
  const [error, setError] = useState<string | null>(null);
  const pendingAcknowledgements = useRef(new Map<string, ReminderTodo>());
  const displayedReminders = useRef(new Set<string>());

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
      setPermission('unsupported');
      setError('Browser notifications are not supported');
      return;
    }

    try {
      const result = await window.Notification.requestPermission();
      setPermission(result);
      setError(result === 'denied' ? 'Notification permission is blocked in browser settings' : null);
    } catch (cause) {
      setError(`Could not request notification permission: ${describeError(cause)}`);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setPermission(
        typeof window.Notification !== 'undefined'
          ? window.Notification.permission
          : 'unsupported',
      );
    });
  }, []);

  useEffect(() => {
    if (permission !== 'granted' || typeof window.Notification === 'undefined') return;

    const controller = new AbortController();
    let polling = false;

    async function acknowledge(todo: ReminderTodo) {
      if (!todo.due_date || todo.reminder_minutes === null) return;
      const key = reminderKey(todo);
      try {
        const response = await fetch(`/api/todos/${todo.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notification_ack: {
              due_date: todo.due_date,
              reminder_minutes: todo.reminder_minutes as ReminderMinutes,
            },
          }),
          signal: controller.signal,
        });
        if (response.ok || response.status === 409) {
          pendingAcknowledgements.current.delete(key);
          displayedReminders.current.delete(key);
          return;
        }
        if (response.status < 500) pendingAcknowledgements.current.delete(key);
        throw new Error(`Could not acknowledge reminder (${response.status})`);
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setError(`Reminder acknowledgement failed: ${describeError(cause)}`);
      }
    }

    async function poll() {
      if (polling || controller.signal.aborted) return;
      if (window.Notification.permission !== 'granted') {
        setPermission(window.Notification.permission);
        return;
      }
      polling = true;
      try {
        const response = await fetch('/api/notifications/check', { signal: controller.signal });
        if (!response.ok) throw new Error(`Reminder check failed (${response.status})`);
        const result = (await response.json()) as { success?: boolean; data?: ReminderTodo[] };
        if (!result.success || !Array.isArray(result.data)) {
          throw new Error('Reminder check returned invalid data');
        }
        setError(null);
        for (const todo of result.data) {
          if (controller.signal.aborted) return;
          if (window.Notification.permission !== 'granted') {
            setPermission(window.Notification.permission);
            return;
          }
          const key = reminderKey(todo);
          if (pendingAcknowledgements.current.has(key)) {
            await acknowledge(todo);
            continue;
          }
          if (displayedReminders.current.has(key)) continue;
          if (!todo.due_date || todo.reminder_minutes === null) continue;

          try {
            new window.Notification(todo.title, {
              body: `Due ${formatSingaporeDate(new Date(todo.due_date))}`,
              tag: `todo-${todo.id}`,
            });
          } catch (cause) {
            setError(`Could not display reminder: ${describeError(cause)}`);
            continue;
          }
          displayedReminders.current.add(key);
          pendingAcknowledgements.current.set(key, todo);
          await acknowledge(todo);
        }
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) {
          setError(`Notification check failed: ${describeError(cause)}`);
        }
      } finally {
        polling = false;
      }
    }

    const refreshPermission = () => {
      const current = window.Notification.permission;
      if (current !== 'granted') setPermission(current);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) refreshPermission();
    };
    window.addEventListener('focus', refreshPermission);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();
    const interval = window.setInterval(() => {
      refreshPermission();
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', refreshPermission);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
      controller.abort();
    };
  }, [permission]);

  return { permission, error, requestPermission };
}
