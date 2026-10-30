'use client';

import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { useState } from 'react';

export default function AddPasskeyButton({ username }: { username: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addPasskey() {
    setBusy(true);
    setMessage(null);
    try {
      const optionsResponse = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const optionsPayload = (await optionsResponse.json()) as {
        error?: string;
      } & Partial<PublicKeyCredentialCreationOptionsJSON>;
      if (!optionsResponse.ok) {
        throw new Error(optionsPayload.error ?? 'Could not start passkey registration.');
      }

      const credential = await startRegistration({
        optionsJSON: optionsPayload as PublicKeyCredentialCreationOptionsJSON,
      });
      const verifyResponse = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, response: credential }),
      });
      const verifyPayload = (await verifyResponse.json()) as { error?: string };
      if (!verifyResponse.ok) {
        throw new Error(verifyPayload.error ?? 'Could not add this passkey.');
      }
      setMessage('Passkey added.');
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Passkey registration cancelled.'
          : error instanceof Error
            ? error.message
            : 'Could not add this passkey.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void addPasskey()}
        disabled={busy}
        className="rounded-md border border-gray-300 px-4 py-2 disabled:opacity-50"
      >
        {busy ? 'Registering…' : 'Add another passkey'}
      </button>
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    </div>
  );
}
