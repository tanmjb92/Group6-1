import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getSingaporeNow } from '@/lib/timezone';
import CalendarView from './calendar-view';

export default async function CalendarPage() {
  if (!(await getSession())) redirect('/login');

  return <CalendarView initialNow={getSingaporeNow().toISOString()} />;
}
