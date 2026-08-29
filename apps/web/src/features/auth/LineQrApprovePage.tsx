'use client';

import { useState } from 'react';
import { Button } from '@/common/components/button';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

type ApproveState = 'idle' | 'approving' | 'approved' | 'declined' | 'failed';

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
      setState(response.ok ? 'approved' : 'failed');
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
