import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type TodoExport } from '@/lib/db';
import { formatExportDate, toCsv, toExportItem } from '@/lib/todo-export';
import { getSingaporeNow } from '@/lib/timezone';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const format = new URL(request.url).searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'Format must be json or csv' }, { status: 400 });
  }

  const now = getSingaporeNow();
  const date = formatExportDate(now);
  const filename = `todos-${date}.${format}`;
  const headers = {
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  };
  const todos = todoDB.findAllByUser(session.userId);

  if (format === 'csv') {
    return new NextResponse(toCsv(todos), {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }

  const payload: TodoExport = {
    version: 1,
    exported_at: now.toISOString(),
    todos: todos.map(toExportItem),
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
