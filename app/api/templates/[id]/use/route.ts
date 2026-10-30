import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { TemplateChecklistError } from '@/lib/template-input';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  let todo;
  try {
    todo = templateDB.use(Number(id), session.userId, getSingaporeNow());
  } catch (error) {
    if (!(error instanceof TemplateChecklistError)) throw error;
    console.error('Cannot use corrupted template checklist', error);
    return NextResponse.json({ error: 'Template checklist is invalid. Edit it before using this template.' }, { status: 409 });
  }
  if (!todo) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json(todo, { status: 201 });
}
