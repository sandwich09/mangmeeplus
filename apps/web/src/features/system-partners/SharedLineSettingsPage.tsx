/**
 * Shared LINE credential console — HIDDEN, not deleted (audit H-14, owner decision 2026-08-10).
 *
 * Three things were wrong at once, and only the first is cheap to fix:
 *
 * 1. `system-line.controller.ts` requires `system.shared_line_credential.manage`, a key that is not
 *    in the permission registry. Nobody holds it, SYSTEM_ADMIN included — that role is granted an
 *    explicit list, not everything — so the endpoint answers 403 to every caller.
 * 2. Adding the row by hand does not survive: `sync-permissions.ts` revokes grants on system roles
 *    that the registry does not declare, deliberately, because system roles are code-defined.
 * 3. Even past both, saving here would change nothing. The webhook verifies signatures with
 *    `config.lineMessagingChannelSecret` — the value from AWS/env — and never reads the row this
 *    screen writes.
 *
 * So fixing only (1) would be the harmful move: the screen would report success and rotate nothing,
 * and an operator would believe a credential had been replaced when it had not. A 403 at least
 * tells the truth. Credential rotation stays where it works today: change the secret in AWS/env and
 * redeploy.
 *
 * To bring this back, both have to land together:
 *   - declare `system.shared_line_credential.manage` in the permission registry and grant it to
 *     SYSTEM_ADMIN, so the endpoint is reachable;
 *   - make the LINE webhook read the stored credential first and fall back to AWS/env, including
 *     cache invalidation on write, so a save actually takes effect.
 *
 * The route and this component stay so that work is a diff rather than a rewrite; only the two
 * links into it are commented out (SystemHeader, PartnerDetailPage).
 */
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { setSharedLineCredential } from './system-partners.api';
import type { SharedLineCredentialMetadataDto } from './system-partners.api';

type CredentialKind = 'LINE_MESSAGING_API' | 'LINE_LOGIN' | 'LINE_LIFF';

const CREDENTIAL_KINDS: CredentialKind[] = ['LINE_MESSAGING_API', 'LINE_LOGIN', 'LINE_LIFF'];

const KIND_DESCRIPTION: Record<CredentialKind, string> = {
  LINE_MESSAGING_API: 'Used for sending and receiving messages via LINE Messaging API webhook.',
  LINE_LOGIN: 'Used for LINE Login OAuth flow to link user accounts.',
  LINE_LIFF: 'Used for LINE Front-end Framework (LIFF) mini-app.',
};

const inputClass = 'mangmee-input';
const btnPrimary = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const btnSecondary = 'rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

function CredentialCard({ kind, onSaved }: { kind: CredentialKind; onSaved: (kind: CredentialKind, meta: SharedLineCredentialMetadataDto) => void }) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [channelSecret, setChannelSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const meta = await setSharedLineCredential(kind, {
        channelId,
        channelSecret,
        ...(accessToken ? { accessToken } : {}),
      });
      setChannelId('');
      setChannelSecret('');
      setAccessToken('');
      setOpen(false);
      onSaved(kind, meta);
    } catch (err) {
      setError((err as Error).message || 'Failed to save credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold font-mono text-gray-900">{kind}</p>
          <p className="text-xs text-gray-500 mt-0.5">{KIND_DESCRIPTION[kind]}</p>
        </div>
        <button
          type="button"
          className="flex-shrink-0 text-xs text-brand-700 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Cancel' : 'Configure / Replace'}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="border-t border-gray-100 pt-3 space-y-3">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Secrets are write-only and encrypted at rest. Values are never displayed after save.
          </p>
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Channel ID *</label>
            <input
              className={inputClass}
              required
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Channel Secret *</label>
            <input
              className={inputClass}
              type="password"
              required
              value={channelSecret}
              onChange={(e) => setChannelSecret(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>
          {(kind === 'LINE_MESSAGING_API' || kind === 'LINE_LIFF') && (
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Channel Access Token (optional)</label>
              <input
                className={inputClass}
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={loading}>
              {loading ? 'Saving…' : 'Save credentials'}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function SharedLineSettingsPage() {
  const toast = useToast();
  const [savedMeta, setSavedMeta] = useState<Partial<Record<CredentialKind, SharedLineCredentialMetadataDto>>>({});

  const handleSaved = (kind: CredentialKind, meta: SharedLineCredentialMetadataDto) => {
    setSavedMeta((prev) => ({ ...prev, [kind]: meta }));
    toast.success(`${kind} credentials saved successfully.`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />

        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/system/partners" className="hover:text-brand-700">Partners</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">Shared LINE Settings</span>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-gray-900">Platform Shared LINE Credentials</h1>
          <p className="text-sm text-gray-500 mt-1">
            WatchDog uses a single shared LINE Official Account for all partner companies.
            Credentials are stored encrypted and are write-only — values cannot be retrieved after save.
          </p>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <strong>How company context works:</strong> When a LINE user sends a message,
          the platform resolves their company from their linked WatchDog identity.
          Users with multiple active company memberships must select their active company
          before the AI assistant can respond.
        </div>

        <div className="space-y-3">
          {CREDENTIAL_KINDS.map((kind) => (
            <div key={kind}>
              <CredentialCard kind={kind} onSaved={handleSaved} />
              {savedMeta[kind] && (
                <p className="mt-1 px-1 text-xs text-gray-400">
                  Last updated: {formatThaiDateTime(savedMeta[kind]!.updatedAt)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
