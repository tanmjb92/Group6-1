'use client';

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ApiError {
  error?: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(payload.error ?? 'The request could not be completed.');
  return payload;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Passkey request cancelled. You can try again when ready.';
  }
  if (error instanceof Error) return error.message;
  return 'Passkey request failed. Please try again.';
}

export default function LoginForm() {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function runCeremony(ceremony: 'register' | 'login') {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || busy) return;
    setError(null);
    if (!browserSupportsWebAuthn()) {
      setError('This browser does not support passkeys. Try a current browser on a supported device.');
      return;
    }

    setBusy(true);
    try {
      const optionsPath =
        ceremony === 'register'
          ? '/api/auth/register-options'
          : '/api/auth/login-options';
      const options = await postJson<
        PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON
      >(optionsPath, { username: trimmedUsername });

      const credential =
        ceremony === 'register'
          ? await startRegistration({
              optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
            })
          : await startAuthentication({
              optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
            });

      await postJson(
        ceremony === 'register'
          ? '/api/auth/register-verify'
          : '/api/auth/login-verify',
        { username: trimmedUsername, response: credential },
      );
      router.replace('/');
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void runCeremony('login');
      }}
    >
      <label className="block text-sm font-medium" htmlFor="username">
        Username
      </label>
      <input
        id="username"
        name="username"
        autoComplete="username webauthn"
        required
        maxLength={64}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2"
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !username.trim()}
          onClick={() => void runCeremony('register')}
          className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Please wait…' : 'Register'}
        </button>
        <button
          type="submit"
          disabled={busy || !username.trim()}
          className="rounded-md border border-gray-300 px-4 py-2 font-medium disabled:opacity-50"
        >
          {busy ? 'Please wait…' : 'Login'}
        </button>
      </div>
    </form>
  );
}
