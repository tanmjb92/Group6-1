import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { REMINDER_PRESETS, todoDB, type ReminderMinutes } from '@/lib/db';
import { validateUpdateTodo } from '@/lib/todo-input';
import { calculateNextDueDate } from '@/lib/recurrence';
import { getSingaporeNow } from '@/lib/timezone';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseReminderAcknowledgement(
  input: unknown,
): { due_date: string; reminder_minutes: ReminderMinutes } | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const acknowledgement = input as Record<string, unknown>;
  if (
    Object.keys(acknowledgement).length !== 2 ||
    typeof acknowledgement.due_date !== 'string' ||
    typeof acknowledgement.reminder_minutes !== 'number' ||
    !REMINDER_PRESETS.some((preset) => preset === acknowledgement.reminder_minutes)
  ) {
    return null;
  }
  const dueDate = new Date(acknowledgement.due_date);
  if (Number.isNaN(dueDate.getTime()) || dueDate.toISOString() !== acknowledgement.due_date) {
    return null;
  }
  return {
    due_date: acknowledgement.due_date,
    reminder_minutes: acknowledgement.reminder_minutes as ReminderMinutes,
  };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

  const todo = todoDB.findById(id, session.userId);
  if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  return NextResponse.json(todo);
}

export async function PUT(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    throw error;
  }

  const existing = todoDB.findById(id, session.userId);
  if (!existing) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

  if (typeof body === 'object' && body !== null && 'notification_ack' in body) {
    const acknowledgement =
      Object.keys(body).length === 1
        ? parseReminderAcknowledgement(
            (body as { notification_ack?: unknown }).notification_ack,
          )
        : null;
    if (!acknowledgement) {
      return NextResponse.json({ error: 'Invalid reminder acknowledgement' }, { status: 400 });
    }

    const acknowledged = todoDB.acknowledgeReminder(
      id,
      session.userId,
      acknowledgement.due_date,
      acknowledgement.reminder_minutes,
      getSingaporeNow().toISOString(),
    );
    if (!acknowledged) {
      return NextResponse.json({ error: 'Reminder changed or already acknowledged' }, { status: 409 });
    }
    return NextResponse.json(todoDB.findById(id, session.userId));
  }

  const result = validateUpdateTodo(body, getSingaporeNow(), existing);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (result.data.completed === true) {
    try {
      const completion = todoDB.updateWithNextOccurrence(
        id,
        session.userId,
        result.data,
        calculateNextDueDate,
      );
      if (!completion.todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
      return NextResponse.json({
        ...completion.todo,
        ...(completion.nextInstance ? { nextInstance: completion.nextInstance } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Tag not found') {
        return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
      }
      if (error instanceof Error && error.message === 'Todo not found') {
        return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
      }
      throw error;
    }
  }

  try {
    const updated = todoDB.update(id, session.userId, result.data);
    if (!updated) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Todo not found') {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const id = parseId((await params).id);
  if (id === null || !todoDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
