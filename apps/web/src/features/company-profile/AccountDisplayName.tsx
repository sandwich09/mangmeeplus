'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MangmeeCard } from '@/common/components/mangmee';
import { TextField } from '@/common/components/field';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { primaryButtonClass, quietButtonClass } from '@/common/components/button/button-classes';
import { ErrorState, LoadingState } from '@/common/components/state';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useToast } from '@/common/components/toast';
import { ACCOUNT_NAME_CHANGED_EVENT, getDisplayNameHistory, setMyDisplayName, type DisplayNameHistory } from './company-profile.api';

export function DisplayNameHistoryDisclosure({ companyId, userId, data }: { companyId: string; userId?: string; data?: DisplayNameHistory }) {
  const [loaded, setLoaded] = useState<DisplayNameHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const history = data ?? loaded;
  const load = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { setLoaded(await getDisplayNameHistory(companyId, userId)); }
    catch (failure) { setError(apiErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  return <details className="mt-4" onToggle={async event => { if (event.currentTarget.open && !history) await load(); }}>
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">ประวัติการแก้ชื่อ</summary>
    {error ? <ErrorState description={error} onRetry={() => void load()} /> : !history ? <LoadingState label="กำลังโหลดประวัติ…" />
      : history.history.length ? <ul className="grid gap-3">{history.history.map(row => <li key={row.id} className="break-words">
        <time className="text-sm text-gray-500" dateTime={row.changedAt}>{formatThaiDateTime(row.changedAt)}</time>
        <p>{row.oldName} → {row.newName}</p>
        <p className="text-sm text-gray-500">{row.changedByName ? `แก้โดย ${row.changedByName}` : 'ไม่พบชื่อผู้แก้ไข'}</p>
      </li>)}</ul> : <p className="text-sm text-gray-500">ยังไม่มีการแก้ชื่อ</p>}
  </details>;
}

export function AccountDisplayName({ companyId }: { companyId: string }) {
  const [data, setData] = useState<DisplayNameHistory | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setError('');
    try { const next = await getDisplayNameHistory(companyId); if (version === loadVersion.current) { setData(next); setName(next.displayName); } }
    catch (failure) { if (version === loadVersion.current) setError(apiErrorMessage(failure)); }
  }, [companyId]);
  useEffect(() => { void load(); return () => { loadVersion.current++; }; }, [load]);
  const save = async () => {
    if (busy) return;
    if (!name.trim() || name.trim().length > 160) { setError('ชื่อที่แสดงต้องมี 1–160 ตัว แก้ชื่อแล้วบันทึกอีกครั้ง'); return; }
    loadVersion.current++;
    setBusy(true); setError('');
    try {
      const next = await setMyDisplayName(companyId, name); setData(next); setName(next.displayName);
      window.dispatchEvent(new CustomEvent(ACCOUNT_NAME_CHANGED_EVENT, { detail: { displayName: next.displayName } })); toast.success('บันทึกชื่อแล้ว');
    } catch (failure) {
      const error = failure as { status?: number; details?: { retryAfterSeconds?: unknown } };
      const seconds = error?.details?.retryAfterSeconds;
      setError(error?.status === 429
        ? typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
          ? `บันทึกบ่อยเกินไป ลองอีกครั้งใน ${Math.ceil(seconds / 60)} นาที`
          : 'บันทึกบ่อยเกินไป ลองอีกครั้งภายหลัง'
        : apiErrorMessage(failure));
    }
    finally { setBusy(false); }
  };
  if (!data) return error ? <ErrorState description={error} onRetry={() => void load()} /> : <LoadingState label="กำลังโหลดชื่อ…" />;
  return <MangmeeCard className="mb-5 p-5 sm:p-6"><form onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="grid gap-4 sm:grid-cols-2"><TextField label="ชื่อที่แสดง" value={name} required maxLength={160} disabled={busy} error={error || undefined} onChange={event => { loadVersion.current++; setName(event.target.value); }} /></div>
    <DisplayNameHistoryDisclosure companyId={companyId} data={data} />
    <FormActionBar><ActionGroup><button className={name.trim() !== data.displayName ? primaryButtonClass : quietButtonClass} type="submit" disabled={busy} aria-busy={busy}>บันทึกชื่อ</button></ActionGroup></FormActionBar>
  </form></MangmeeCard>;
}
