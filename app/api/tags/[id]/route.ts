import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';
import { validateUpdateTag } from '@/lib/tag-input';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function isDuplicateTagName(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    error.message.includes('tags.user_id, tags.name')
  );
}

export async function PUT(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = parseId((await params).id);
  if (id === null || !tagDB.findById(id, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
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
  const result = validateUpdateTag(body);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });

  try {
    const tag = tagDB.update(id, session.userId, result.data);
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    return NextResponse.json(tag);
  } catch (error) {
    if (isDuplicateTagName(error)) {
      return NextResponse.json(
        { error: 'A tag with this name already exists' },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = parseId((await params).id);
  if (id === null || !tagDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
