'use client';

import { useEffect, useState } from 'react';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { getPlatformAccess, setPlatformAccess, type PlatformAccessStatus } from './system-partners.api';

export default function PlatformAccessPage() {
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();
  const [status, setStatus] = useState<PlatformAccessStatus | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getPlatformAccess().then(setStatus).catch((nextError: unknown) => setError(apiErrorMessage(nextError)));
  }, []);

  const change = async (state: 'OPEN' | 'CLOSED') => {
    if (state === 'OPEN' && !(await confirm({
      title: 'ยืนยันเปิดระบบ',
      message: 'เปิดระบบให้ผู้ใช้ทั่วไปเข้าสู่ระบบและใช้งานจริง?',
      confirmLabel: 'เปิดระบบ',
      variant: 'primary',
    }))) return;
    if (state === 'CLOSED' && !(await confirm({
      title: 'ยืนยันปิดระบบ',
      message: 'ปิดการเข้าสู่ระบบของผู้ใช้ทั่วไปทันที?',
      confirmLabel: 'ปิดระบบ',
    }))) return;
    setSaving(true);
    try {
      const next = await setPlatformAccess(state, reason);
      setStatus(next);
      setReason('');
      toast.success(state === 'OPEN' ? 'เปิดระบบให้ผู้ใช้ทั่วไปแล้ว' : 'ปิดระบบสำหรับผู้ใช้ทั่วไปแล้ว');
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-dvh bg-gray-50 p-6">
      {confirmDialog}
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">เปิด–ปิดระบบ</h1>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            ควบคุมการเข้าสู่ระบบของผู้ใช้ทั่วไประหว่างการเตรียมเปิดใช้งานหรือปรับปรุงระบบ
          </p>
        </div>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
        {!status ? (
          <div className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white" />
        ) : (
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm text-gray-500">สถานะที่มีผลตอนนี้</div>
                <div
                  data-platform-access-state={status.effectiveState.toLowerCase()}
                  className={`mt-1 text-3xl font-extrabold ${status.effectiveState === 'OPEN' ? 'text-brand-700' : 'text-amber-700'}`}
                >
                  {status.effectiveState === 'OPEN' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                </div>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                deployment: {status.servingMode}
              </span>
            </div>

            {status.requestedState !== status.effectiveState ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                ค่าที่บันทึกไว้คือ {status.requestedState} แต่ deployment ปัจจุบันบังคับปิดเพื่อความปลอดภัย
              </div>
            ) : null}
            {!status.canOpen ? (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                ยังเปิดไม่ได้จนกว่าจะ deploy production แบบ live ที่ผ่าน UAT, security และ legal gate ครบ
              </div>
            ) : null}

            <label className="mt-5 block text-sm font-medium text-gray-700" htmlFor="platform-access-reason">
              เหตุผลหรือหมายเหตุ
            </label>
            <textarea
              id="platform-access-reason"
              className="mangmee-input mt-2 min-h-24 w-full"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="เช่น เปิด pilot หลังตรวจสอบ production สำเร็จ"
              disabled={saving}
            />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="mangmee-btn mangmee-btn-primary disabled:opacity-50"
                disabled={saving || !status.canOpen || status.effectiveState === 'OPEN'} aria-busy={Boolean(saving)}
                onClick={() => void change('OPEN')}
              >
                เปิดระบบ
              </button>
              <button
                type="button"
                className="mangmee-btn border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
                disabled={saving || status.effectiveState === 'CLOSED'} aria-busy={Boolean(saving)}
                onClick={() => void change('CLOSED')}
              >
                ปิดระบบ
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
