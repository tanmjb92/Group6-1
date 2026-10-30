import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

async function updateAssociation(
  request: Request,
  context: RouteContext,
  attach: boolean,
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const todoId = parseId((await context.params).id);
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
  if (
    typeof body !== 'object' ||
    body === null ||
    !('tag_id' in body) ||
    !Number.isSafeInteger(body.tag_id) ||
    Number(body.tag_id) < 1
  ) {
    return NextResponse.json({ error: 'A valid tag_id is required' }, { status: 400 });
  }
  const tagId = Number(body.tag_id);
  if (!tagDB.findById(tagId, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }
  const succeeded = attach
    ? tagDB.attachToTodo(todoId, tagId, session.userId)
    : tagDB.detachFromTodo(todoId, tagId, session.userId);
  if (!succeeded) return NextResponse.json({ error: 'Todo or tag not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function POST(request: Request, context: RouteContext) {
  return updateAssociation(request, context, true);
}

export async function DELETE(request: Request, context: RouteContext) {
  return updateAssociation(request, context, false);
}
