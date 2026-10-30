import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB, todoDB, type CreateSubtaskDto } from '@/lib/db';
import { SUBTASK_TITLE_MAX_LENGTH } from '@/lib/subtask-constants';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const todoId = parseId((await params).id);
  if (todoId === null || !todoDB.findById(todoId, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    throw error;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
  }

  const title = (body as Record<string, unknown>).title;
  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
  }
  if (title.trim().length > SUBTASK_TITLE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Subtask title must be ${SUBTASK_TITLE_MAX_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const input: CreateSubtaskDto = { title: title.trim() };
  const subtask = subtaskDB.create(todoId, input);
  return NextResponse.json(subtask, { status: 201 });
}