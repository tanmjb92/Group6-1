import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { readBoundedJson } from '@/lib/read-bounded-json';
import { todoImportSchema } from '@/lib/todo-export';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await readBoundedJson(request);
  if (!body.success) {
    return NextResponse.json({ error: body.error }, { status: body.status });
  }

  const parsed = todoImportSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Failed to import todos. Please check the file format.' },
      { status: 400 },
    );
  }

  try {
    const result = todoDB.importAll(session.userId, parsed.data.todos);
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: 'Failed to import todos' }, { status: 500 });
  }
}
