import Link from 'next/link';
import { redirect } from 'next/navigation';
import AddPasskeyButton from './add-passkey-button';
import LogoutButton from './logout-button';
import { getSession } from '@/lib/auth';

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Todo App</h1>
          <p className="mt-1 text-gray-600">Signed in as {session.username}</p>
        </div>
        <LogoutButton />
      </header>
      <section className="mt-10 rounded-xl bg-white p-6 shadow">
        <h2 className="text-xl font-medium">Passkey security</h2>
        <p className="mt-2 text-gray-600">
          Add a passkey on another device so you have an additional way to sign in.
        </p>
        <AddPasskeyButton username={session.username} />
      </section>
      <Link href="/calendar" className="mt-6 inline-block text-blue-700 underline">
        Calendar
      </Link>
    </main>
  );
}
