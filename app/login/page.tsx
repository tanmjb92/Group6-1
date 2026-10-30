import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LoginForm from './login-form';

export default async function LoginPage() {
  if (await getSession()) redirect('/');

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold">Todo App</h1>
        <p className="mt-2 text-sm text-gray-600">
          Register or sign in with a passkey. Your device keeps the private key.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
