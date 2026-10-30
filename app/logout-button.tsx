'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Logout failed. Please try again.');
      router.replace('/login');
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Logout failed.');
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        className="rounded-md bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? 'Logging out…' : 'Logout'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
