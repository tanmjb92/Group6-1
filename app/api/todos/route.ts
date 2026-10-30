import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { PRIORITY_VALUES, todoDB } from '@/lib/db';
import { validateCreateTodo } from '@/lib/todo-input';
import { getSingaporeNow } from '@/lib/timezone';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const priority = new URL(request.url).searchParams.get('priority');
  if (priority !== null && !PRIORITY_VALUES.some((value) => value === priority)) {
    return NextResponse.json(
      { error: "Invalid priority. Must be 'high', 'medium', or 'low'." },
      { status: 400 },
    );
  }
  const todos = todoDB.findAllByUser(session.userId);
  return NextResponse.json(
    priority ? todos.filter((todo) => todo.priority === priority) : todos,
  );
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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

  const result = validateCreateTodo(body, getSingaporeNow());
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  try {
    return NextResponse.json(todoDB.create(session.userId, result.data), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    throw error;
  }
}
