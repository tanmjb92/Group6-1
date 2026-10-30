import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB, type UpdateSubtaskDto } from '@/lib/db';
import { SUBTASK_TITLE_MAX_LENGTH } from '@/lib/subtask-constants';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseUpdateInput(value: unknown): UpdateSubtaskDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const body = value as Record<string, unknown>;
  const fields = Object.keys(body);
  if (fields.length === 0 || fields.some((field) => field !== 'title' && field !== 'completed')) {
    return null;
  }

  const input: UpdateSubtaskDto = {};
  if ('title' in body) {
    if (
      typeof body.title !== 'string' ||
      !body.title.trim() ||
      body.title.trim().length > SUBTASK_TITLE_MAX_LENGTH
    ) {
      return null;
    }
    input.title = body.title.trim();
  }
  if ('completed' in body) {
    if (typeof body.completed !== 'boolean') return null;
    input.completed = body.completed;
  }
  return input;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    throw error;
  }

  const input = parseUpdateInput(body);
  if (!input) {
    return NextResponse.json({ error: 'Provide a valid title or completion state' }, { status: 400 });
  }

  const updated = subtaskDB.update(id, session.userId, input);
  if (!updated) return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const id = parseId((await params).id);
  if (id === null || !subtaskDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}