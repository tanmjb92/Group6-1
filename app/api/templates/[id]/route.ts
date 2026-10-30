import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { parseTemplateSubtasks, TemplateChecklistError, validateTemplate } from '@/lib/template-input';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await params;
  const existing = /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    ? templateDB.findById(Number(id), session.userId) : null;
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'At least one template field is required' }, { status: 400 });
  }
  let subtasks;
  try {
    subtasks = 'subtasks' in body ? body.subtasks : parseTemplateSubtasks(existing.subtasks_json);
  } catch (error) {
    if (!(error instanceof TemplateChecklistError)) throw error;
    console.error('Cannot update corrupted template checklist', error);
    return NextResponse.json({ error: 'Template checklist is invalid. Replace the checklist before saving.' }, { status: 409 });
  }
  const result = validateTemplate({
    name: existing.name, description: existing.description, category: existing.category,
    title_template: existing.title_template, priority: existing.priority,
    is_recurring: existing.is_recurring, recurrence_pattern: existing.recurrence_pattern,
    due_date_offset_minutes: existing.due_date_offset_minutes,
    reminder_minutes: existing.reminder_minutes, subtasks, ...body,
  });
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  const updated = templateDB.update(Number(id), session.userId, result.data);
  if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) ||
      !templateDB.delete(Number(id), session.userId)) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
