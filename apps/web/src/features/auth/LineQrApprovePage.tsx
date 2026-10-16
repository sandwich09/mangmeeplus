'use client';

import { useEffect, useState } from 'react';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Button, quietButtonClass, secondaryButtonClass } from '@/common/components/button';
import { AuthFrame, authTitleClass } from './AuthFrame';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { lineStartUrl } from './auth.logic';

type ApproveState = 'idle' | 'approving' | 'approved' | 'declined' | 'expired' | 'failed' | 'need_login' | 'forbidden';

const passwordLoginHref = (code: string) => `/login?line=qr-approve&next=${encodeURIComponent(`/line-qr/${code}`)}`;

/**
 * Signed-out body, reached when the confirm tap comes back 401 — the page sat open long enough for
 * the session to die. LINE login leads because the phone that just scanned a LINE QR already has
 * LINE open; a text link to the password form used to be the only way out (UAT 2026-09-01).
 * Availability is server-driven, exactly as on the login page: a channel the browser cannot
 * confirm is not offered.
 */
export function LineQrNeedLogin({ code, lineLoginAvailable }: { code: string; lineLoginAvailable: boolean }) {
  return (
    <div role="alert">
      <h1 className={authTitleClass}>ต้องเข้าสู่ระบบอีกครั้ง</h1>
      <p className="mt-2 text-[15px] leading-7 text-gray-600">
        เข้าสู่ระบบแล้วระบบจะพากลับมาหน้านี้เพื่อกดยืนยัน QR เดิมยังใช้ได้ถ้ายังไม่หมดเวลา
      </p>
      {lineLoginAvailable ? (
        <button
          type="button"
          data-size="lg"
          onClick={() => window.location.assign(withLineExternalBrowser(lineStartUrl(`/line-qr/${encodeURIComponent(code)}`), navigator.userAgent))}
          className={`${secondaryButtonClass} mt-6 w-full`}
        >
          <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-md bg-[#06C755] text-sm font-bold text-white">L</span>
          เข้าสู่ระบบด้วย LINE
        </button>
      ) : null}
      <a href={passwordLoginHref(code)} className={`${quietButtonClass} mt-2 w-full`}>
        เข้าสู่ระบบด้วยรหัสผ่าน
      </a>
    </div>
  );
}

// P12-3a: the phone half of desktop QR login. Nothing is approved by arriving here — rule 6, the
// page never acts for the user, so a session is handed to the desktop only after an explicit tap.
export default function LineQrApprovePage({ code }: { code: string }) {
  const [state, setState] = useState<ApproveState>('idle');
  const [lineLoginAvailable, setLineLoginAvailable] = useState(false);

  // The server route already proved there is a session before this page rendered, so nothing here
  // re-checks it. Only which login channels exist is unknown to the browser, and it is fetched on
  // mount rather than on the 401 so the need-login body never pops a button in late. Nothing waits
  // on this: the confirm UI renders immediately either way.
  useEffect(() => {
    let active = true;
    void fetch('/api/auth/line-login/availability')
      .then((response) => response.json())
      .then((data: { available?: boolean }) => {
        if (active) setLineLoginAvailable(Boolean(data?.available));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
      else if (response.status === 401) setState('need_login');
      else if (response.status === 403) setState('forbidden');
      else if (response.status === 404) setState('expired');
      else setState('failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <AuthFrame>
      {state === 'approved' ? (
        <div role="status" className="space-y-2">
          <h1 className={authTitleClass}>ยืนยันแล้ว</h1>
          <p className="text-[15px] leading-7 text-gray-600">กลับไปที่หน้าจอคอมพิวเตอร์ได้เลย</p>
        </div>
      ) : state === 'declined' ? (
        <div role="status" className="space-y-2">
          <h1 className={authTitleClass}>ไม่ได้ยืนยัน</h1>
          <p className="text-[15px] leading-7 text-gray-600">ไม่มีการเข้าสู่ระบบบนคอมพิวเตอร์ ปิดหน้านี้ได้เลย</p>
        </div>
      ) : state === 'need_login' ? (
        <LineQrNeedLogin code={code} lineLoginAvailable={lineLoginAvailable} />
      ) : state === 'forbidden' ? (
        <div role="alert" className="space-y-2">
          <h1 className={authTitleClass}>บัญชีนี้ยืนยันการเข้าสู่ระบบให้ไม่ได้</h1>
          <p className="text-[15px] leading-7 text-gray-600">
            บัญชีบนมือถือยังทำขั้นตอนในระบบไม่ครบ หรือถูกจำกัดสิทธิ์อยู่ เปิดเว็บมั่งมีพลัสบนมือถือเพื่อทำขั้นตอนที่ค้างให้เสร็จก่อน หรือติดต่อทีมงานมั่งมี <span className="mangmee-unit">098-256-5628</span>
          </p>
        </div>
      ) : state === 'expired' ? (
        <div role="alert" className="space-y-2">
          <h1 className={authTitleClass}>QR หมดอายุแล้ว</h1>
          <p className="text-[15px] leading-7 text-gray-600">กลับไปที่คอมพิวเตอร์แล้วกดสร้าง QR ใหม่</p>
        </div>
      ) : state === 'failed' ? (
        // Not the QR's fault and not the person's: our side did not answer. The same QR can be tried again.
        <div role="alert">
          <h1 className={authTitleClass}>ยืนยันไม่สำเร็จ</h1>
          <p className="mt-2 text-[15px] leading-7 text-gray-600">ระบบขัดข้องชั่วคราว ยังไม่ได้ยืนยันให้</p>
          <ActionGroup className="mt-6">
            <Button type="button" variant="secondary" onClick={() => setState('idle')}>ลองอีกครั้ง</Button>
          </ActionGroup>
        </div>
      ) : (
        <>
          <h1 className={authTitleClass}>ยืนยันการเข้าสู่ระบบบนคอมพิวเตอร์</h1>
          <p className="mt-2 text-[15px] leading-7 text-gray-600">
            มีการขอเข้าสู่ระบบ มั่งมี จากเบราว์เซอร์บนคอมพิวเตอร์ ถ้าไม่ใช่คุณ อย่ากดยืนยัน
          </p>
          <ActionGroup className="mt-6">
            <Button type="button" variant="secondary" disabled={state === 'approving'} onClick={() => setState('declined')}>
              ไม่ใช่ฉัน
            </Button>
            <Button type="button" loading={state === 'approving'} onClick={approve}>
              ยืนยันการเข้าสู่ระบบ
            </Button>
          </ActionGroup>
        </>
      )}
    </AuthFrame>
  );
}
