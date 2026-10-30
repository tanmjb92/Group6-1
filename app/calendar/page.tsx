import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function CalendarPage() {
  if (!(await getSession())) redirect('/login');

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Calendar</h1>
      <p className="mt-2 text-gray-600">Calendar view will be available with Feature 10.</p>
      <Link href="/" className="mt-6 inline-block text-blue-700 underline">
        Back to todos
      </Link>
    </main>
  );
}
