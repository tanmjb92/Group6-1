import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { validateUpdateTodo } from '@/lib/todo-input';
import { calculateNextDueDate } from '@/lib/recurrence';
import { getSingaporeNow } from '@/lib/timezone';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
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

  const result = validateUpdateTodo(body, getSingaporeNow(), existing);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (result.data.completed === true) {
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
  }

  const updated = todoDB.update(id, session.userId, result.data);
  if (!updated) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  return NextResponse.json(updated);
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
