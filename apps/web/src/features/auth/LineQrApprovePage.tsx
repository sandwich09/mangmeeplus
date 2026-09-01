'use client';

import { useState } from 'react';
import { Button } from '@/common/components/button';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

type ApproveState = 'idle' | 'approving' | 'approved' | 'declined' | 'failed' | 'session_expired' | 'forbidden';

// P12-3a: the phone half of desktop QR login. Nothing is approved by arriving here — rule 6, the
// page never acts for the user, so a session is handed to the desktop only after an explicit tap.
export default function LineQrApprovePage({ code }: { code: string }) {
  const [state, setState] = useState<ApproveState>('idle');

  const approve = async () => {
    setState('approving');
    try {
      const response = await fetch('/api/auth/line-qr/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      // UAT 2026-09-01: every failure used to read "QR หมดอายุแล้ว", so a 403 (a guard refusal)
      // sent the user hunting for a new QR that would fail the same way. Each status now tells
      // the truth the user can act on; only 404 — the API's real expired/consumed answer — keeps
      // the expired message.
      if (response.ok) setState('approved');
      else if (response.status === 401) setState('session_expired');
      else if (response.status === 403) setState('forbidden');
      else setState('failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-500 to-brand-900">
            <MangmeeLogo size={24} />
          </span>
          <span className="text-xl font-extrabold text-gray-900">
            มั่ง<span className="text-gold-500">มี</span>
          </span>
        </div>

        {state === 'approved' ? (
          <div role="status" className="mt-6 space-y-2">
            <h1 className="text-xl font-bold text-gray-900">อนุมัติแล้ว ✓</h1>
            <p className="text-[15px] leading-7 text-gray-600">กลับไปที่หน้าจอคอมพิวเตอร์ได้เลย</p>
          </div>
        ) : state === 'declined' ? (
          <div role="status" className="mt-6 space-y-2">
            <h1 className="text-xl font-bold text-gray-900">ยกเลิกแล้ว</h1>
            <p className="text-[15px] leading-7 text-gray-600">ปิดหน้านี้ได้เลย ระบบไม่ได้อนุมัติอะไร</p>
          </div>
        ) : state === 'session_expired' ? (
          <div role="alert" className="mt-6 space-y-2">
            <h1 className="text-xl font-bold text-gray-900">เซสชันบนมือถือหมดอายุ</h1>
            <p className="text-[15px] leading-7 text-gray-600">
              <a href={`/login?line=qr-approve&next=${encodeURIComponent(`/line-qr/${code}`)}`} className="font-semibold text-brand-700 underline">เข้าสู่ระบบบนมือถืออีกครั้ง</a>
              {' '}แล้วกดยืนยันใหม่ได้เลย QR เดิมยังใช้ได้ถ้ายังไม่หมดเวลา
            </p>
          </div>
        ) : state === 'forbidden' ? (
          <div role="alert" className="mt-6 space-y-2">
            <h1 className="text-xl font-bold text-gray-900">บัญชีนี้ยืนยันการเข้าสู่ระบบให้ไม่ได้</h1>
            <p className="text-[15px] leading-7 text-gray-600">
              บัญชีบนมือถือยังทำขั้นตอนในระบบไม่ครบ หรือถูกจำกัดสิทธิ์อยู่ เปิดเว็บมั่งมีพลัสบนมือถือเพื่อทำขั้นตอนที่ค้างให้เสร็จก่อน หรือติดต่อ 098-256-5628
            </p>
          </div>
        ) : state === 'failed' ? (
          <div role="alert" className="mt-6 space-y-2">
            <h1 className="text-xl font-bold text-gray-900">QR หมดอายุแล้ว</h1>
            <p className="text-[15px] leading-7 text-gray-600">กลับไปที่คอมพิวเตอร์แล้วกดสร้าง QR ใหม่</p>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-bold text-gray-900">ยืนยันการเข้าสู่ระบบบนคอมพิวเตอร์</h1>
            <p className="mt-2 text-[15px] leading-7 text-gray-600">
              มีการขอเข้าสู่ระบบ MangmeePlus จากเบราว์เซอร์บนคอมพิวเตอร์ ถ้าไม่ใช่คุณ อย่ากดยืนยัน
            </p>
            <div className="mt-6 space-y-3">
              <Button
                type="button"
                size="lg"
                className="w-full !rounded-xl"
                loading={state === 'approving'}
                onClick={approve}
              >
                ยืนยันการเข้าสู่ระบบ
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="w-full !rounded-xl"
                disabled={state === 'approving'}
                onClick={() => setState('declined')}
              >
                ไม่ใช่ฉัน / ยกเลิก
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
