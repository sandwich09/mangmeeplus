'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ExecutiveUserCredential, ExecutiveUserView } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { EXECUTIVE_PAGE_CLASS, ExecutiveSectionCard } from '../executive-reports/ExecutiveReportDesign';
import { Button } from '@/common/components/button';
import { TextField, SwitchField } from '@/common/components/field';
import { MangmeePage, MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useInputPrompt } from '@/common/components/modal';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { createExecutiveUser, getExecutiveUser, commandExecutiveUser } from './executive-users.api';
import {
  executiveWords as words, EXECUTIVE_USERS_TITLE, EXECUTIVE_RIGHTS, EXECUTIVE_EXPORT_NOTE, EXECUTIVE_CONTACT_NOTE, EXECUTIVE_CONTACT_EXPORT_NOTE,
  emptyExecutiveForm, validateExecutiveForm, executiveCreateBody, executiveFieldErrors, executiveActions,
  executiveActionLabel, executiveConfirmation, executiveCommand, executiveStatus, executiveStatusTone, executiveRights, executiveExpiryNotice,
  type ExecutiveAction, type ExecutiveForm, type ExecutiveFormErrors,
} from './executive-users.logic';

/** Same one-time handoff as SalesCredentialPanel, without its sales-only delivery claims. */
function ExecutiveCredentialPanel({ credential, onClose }: { credential: ExecutiveUserCredential; onClose: () => void }) {
  const [copyMessage, setCopyMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const copyPending = useRef(false);
  async function copy() {
    if (copyPending.current) return;
    copyPending.current = true; setCopying(true); setCopyMessage('');
    try { await navigator.clipboard.writeText(credential.temporaryPassword); setCopyMessage(words.copied); }
    catch { setCopyMessage(words.copyFailed); }
    finally { copyPending.current = false; setCopying(false); }
  }
  return <MangmeeCard className="min-w-0 border-brand-200 bg-brand-25 p-4">
    <h2 className="font-semibold">{words.credentialTitle(credential.username)}</h2>
    <p className="mt-2 text-sm text-gray-600">{words.credentialOnce}</p>
    <div className="my-3 flex flex-wrap items-center gap-3">
      <span className="min-w-0 select-all break-all text-lg font-bold">{credential.temporaryPassword}</span>
      <Button variant="secondary" loading={copying} onClick={() => void copy()}>{words.copy}</Button>
    </div>
    <p className="text-sm text-gray-600">{words.credentialDelivery}</p>
    <p className="text-sm text-gray-600">{words.credentialExpiry(credential.expiresAt)}</p>
    {copyMessage && <p role="status" className="mt-2 text-sm">{copyMessage}</p>}
    <Button variant="secondary" className="mt-3" onClick={onClose}>{words.closeCredential}</Button>
  </MangmeeCard>;
}

export default function ExecutiveUserPage({ userId }: { userId?: string }) {
  const [values, setValues] = useState(emptyExecutiveForm);
  const [errors, setErrors] = useState<ExecutiveFormErrors>({});
  const [user, setUser] = useState<ExecutiveUserView | null>(null);
  const [credential, setCredential] = useState<ExecutiveUserCredential | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [protectedAccount, setProtectedAccount] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [reasonDraft, setReasonDraft] = useState('');
  const { promptInput, inputPromptDialog } = useInputPrompt();

  function handleError(cause: unknown) {
    const code = apiErrorCode(cause);
    setError(apiErrorMessage(cause)); setRefreshRequired(true);
    if (code === 'EXECUTIVE_ACCESS_DENIED' || (cause as { status?: number })?.status === 403) {
      setDenied(true); setUser(null); setCredential(null);
    }
    if (code === 'ACCOUNT_PROTECTED') { setProtectedAccount(true); setCredential(null); }
    if (code === 'ACCOUNT_REVOKED') { setUser(previous => previous ? { ...previous, status: 'REVOKED' } : null); setCredential(null); }
    if (code === 'ACCOUNT_NOT_FOUND') { setUser(null); setCredential(null); }
  }
  const currentUserId = userId ?? user?.userId;
  useEffect(() => {
    if (!currentUserId) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void getExecutiveUser(currentUserId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setUser(result); setDenied(false); setProtectedAccount(false); setRefreshRequired(false); }
    }).catch(cause => { if (!controller.signal.aborted) handleError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentUserId, retry]);

  function set<K extends keyof ExecutiveForm>(key: K, value: ExecutiveForm[K]) {
    setValues(previous => ({ ...previous, [key]: value }));
    setErrors(previous => ({ ...previous, [key]: undefined }));
  }
  async function create() {
    if (busyRef.current || denied) return;
    const found = validateExecutiveForm(values); setErrors(found);
    if (Object.keys(found).length) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const result = await createExecutiveUser(executiveCreateBody(values));
      setUser(result.user); setCredential(result.credential); setRefreshRequired(false); setNotice(words.created);
    } catch (cause) { handleError(cause); setErrors(executiveFieldErrors(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function act(action: ExecutiveAction) {
    if (!user || busyRef.current || refreshRequired || !executiveActions(user, protectedAccount).includes(action)) return;
    busyRef.current = true; setBusy(true);
    try {
      const reason = await promptInput({ title: executiveActionLabel(user, action), message: <span className="whitespace-pre-line [overflow-wrap:anywhere]">{executiveConfirmation(user, action)}</span>,
        label: words.reasonLabel, required: true, initialValue: reasonDraft, variant: action === 'suspend' ? 'danger' : 'primary' });
      if (reason === null) return;
      setReasonDraft(reason);
      const command = executiveCommand(user, action, reason);
      if (!command) { setError(words.reasonInvalid); return; }
      setError(null); setNotice('');
      if (command.path === 'credential') setCredential(null);
      const result = await commandExecutiveUser(user.userId, command);
      setReasonDraft('');
      if ('temporaryPassword' in result) {
        setCredential(result);
        // Read the server status: resetting a suspended account does not reactivate it.
        setUser(await getExecutiveUser(user.userId));
      } else { setUser(result); }
      setNotice(words.saved);
    } catch (cause) { handleError(cause); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const expiryNotice = user && executiveExpiryNotice(user);
  return <MangmeePage title={userId || user ? words.detail : words.add}
    eyebrow={<Link href="/system/executive-users" className="mangmee-btn mangmee-btn-secondary hover:bg-brand-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">{EXECUTIVE_USERS_TITLE}</Link>}
    className={`${EXECUTIVE_PAGE_CLASS} [&_label>span]:text-sm`}>
    {inputPromptDialog}
    {denied ? <ForbiddenState description={error ?? undefined} /> : <>
      {credential && <ExecutiveCredentialPanel key={credential.expiresAt} credential={credential} onClose={() => setCredential(null)} />}
      {notice && <p role="status" className="text-sm text-brand-800">{notice}</p>}
      {error && <ErrorState description={error} onRetry={currentUserId ? () => setRetry(value => value + 1) : undefined} />}
      {loading ? <LoadingState label={words.loadingAccount} /> : user ? <ExecutiveSectionCard title={words.account} actions={protectedAccount || user.status === 'REVOKED' ? <p className="text-sm text-gray-600">{apiErrorMessage({ code: protectedAccount ? 'ACCOUNT_PROTECTED' : 'ACCOUNT_REVOKED' })}</p>
          : <div className="flex flex-wrap gap-3">{executiveActions(user, protectedAccount).map(action => <Button key={action} variant={action === 'suspend' ? 'danger' : 'secondary'} loading={busy} disabled={busy || refreshRequired} onClick={() => void act(action)}>{executiveActionLabel(user, action)}</Button>)}</div>}>
        <dl className="grid gap-4 sm:grid-cols-2">{[
          [words.displayName, user.displayName], [words.username, user.username], [words.phoneNumber, user.phoneNumber || words.unspecified],
          [words.email, user.email || words.unspecified], [words.rights, executiveRights(user)], [words.lastEntry, user.lastWebEntryAt ? formatThaiDateTime(user.lastWebEntryAt) : words.missing],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl>
        <p>{words.status}: <MangmeeBadge tone={executiveStatusTone(user.status)}>{executiveStatus(user.status)}</MangmeeBadge></p>
        {expiryNotice && <p className="text-sm text-gray-600">{expiryNotice}</p>}
        {!userId && <Link href={`/system/executive-users/${encodeURIComponent(user.userId)}`} className="mangmee-btn mangmee-btn-secondary hover:bg-brand-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">{words.openAccount}</Link>}
      </ExecutiveSectionCard> : !userId && <ExecutiveSectionCard title={words.add}>
        <form noValidate className="grid gap-4 md:grid-cols-2 [&>label]:min-w-0 [&>div]:md:col-span-2 [&>p]:md:col-span-2" onSubmit={event => { event.preventDefault(); void create(); }}>
          <TextField label={words.username} name="username" value={values.username} autoComplete="off" maxLength={40} required disabled={busy} error={errors.username} onChange={event => set('username', event.target.value)} />
          <TextField label={words.displayName} name="displayName" value={values.displayName} maxLength={120} required disabled={busy} error={errors.displayName} onChange={event => set('displayName', event.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={`${words.phoneNumber} ${words.optional}`} name="phoneNumber" type="tel" value={values.phoneNumber} maxLength={20} disabled={busy} error={errors.phoneNumber} onChange={event => set('phoneNumber', event.target.value)} />
            <TextField label={`${words.email} ${words.optional}`} name="email" type="email" value={values.email} maxLength={254} disabled={busy} error={errors.email} onChange={event => set('email', event.target.value)} />
          </div>
          <p className="font-medium">{EXECUTIVE_RIGHTS.canRead}</p>
          <SwitchField label={EXECUTIVE_RIGHTS.canExport} name="canExport" checked={values.canExport} disabled={busy} onChange={event => set('canExport', event.target.checked)} />
          <p className="text-sm text-gray-600">{EXECUTIVE_EXPORT_NOTE}</p>
          <SwitchField label={EXECUTIVE_RIGHTS.canSeeContacts} name="canSeeContacts" checked={values.canSeeContacts} disabled={busy} onChange={event => set('canSeeContacts', event.target.checked)} />
          <p className="text-sm text-gray-600">{EXECUTIVE_CONTACT_NOTE} {EXECUTIVE_CONTACT_EXPORT_NOTE}</p>
          <div className="flex flex-wrap gap-3"><Button type="submit" loading={busy}>{words.save}</Button><Link href="/system/executive-users" className="mangmee-btn mangmee-btn-secondary hover:bg-brand-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">{words.cancel}</Link></div>
        </form>
      </ExecutiveSectionCard>}
    </>}
  </MangmeePage>;
}
