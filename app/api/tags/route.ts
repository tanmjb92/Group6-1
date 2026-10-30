import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';
import { validateCreateTag } from '@/lib/tag-input';

function isDuplicateTagName(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    error.message.includes('tags.user_id, tags.name')
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return NextResponse.json(tagDB.findAllByUser(session.userId));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    throw error;
  }
  const result = validateCreateTag(body);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });

  try {
    return NextResponse.json(tagDB.create(session.userId, result.data), { status: 201 });
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
