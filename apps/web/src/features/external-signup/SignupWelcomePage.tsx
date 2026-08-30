'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/common/components/button';
import { Modal } from '@/common/components/modal';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { fetchPlanTermNotice } from '@/features/plan-term/plan-term.api';
import { SignupBrandHeader } from './SignupChrome';
import { readClaimedCompany, type WelcomeHandoff } from './welcome-handoff.logic';

const LINE_GREEN = '#06C755';

// The link-after-password lane of P12-2: with a session already established by the claim, the BFF
// callback links the verified LINE identity to this user instead of issuing new tokens.
const LINE_LINK_URL = `/api/auth/line-login/start?returnTo=${encodeURIComponent('/signup/welcome')}`;

const BULLETS = [
  'ถ่ายรูปใบเสร็จส่งในแชต ระบบลงบัญชีให้',
  'มีงานรออนุมัติ ระบบเตือนใน LINE',
  'ครั้งหน้าเข้าเว็บด้วย LINE ได้ ไม่ต้องพิมพ์รหัส',
];

function LineLinkButton({ className = '' }: { className?: string }) {
  return (
    <a
      href={LINE_LINK_URL}
      className={`flex h-12 w-full items-center justify-center gap-2.5 rounded-xl text-[16px] font-bold text-white ${className}`}
      style={{ backgroundColor: LINE_GREEN }}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-sm font-extrabold" style={{ color: LINE_GREEN }}>
        L
      </span>
      เชื่อมกับ LINE
    </a>
  );
}

/**
 * Shown every time a link attempt hits an account that already owns this LINE (spec §4F: the offer
 * repeats, it is not a one-shot). Only two ways out — merge, or leave both accounts standing.
 * "Move LINE off the other account" is deliberately absent from this screen.
 */
function MergeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [declined, setDeclined] = useState(false);

  return (
    <Modal
      open={open}
      size="sm"
      title="LINE นี้เชื่อมกับบัญชีอื่นอยู่แล้ว"
      onClose={onClose}
      footer={
        declined ? (
          <Button type="button" size="lg" className="w-full !rounded-xl" onClick={onClose}>
            เข้าใจแล้ว
          </Button>
        ) : (
          <div className="flex w-full flex-col gap-2.5">
            {/* Merging moves the new company's membership onto the existing user. No API does that
                yet (there is no merge endpoint and the OAuth link path never sets allowReassign),
                so the recommended path is announced but not offered. */}
            <span title="เร็ว ๆ นี้" className="w-full">
              <Button type="button" size="lg" className="w-full !rounded-xl" disabled>
                รวมเป็นบัญชีเดียว (แนะนำ)
              </Button>
            </span>
            <p className="text-center text-[12.5px] text-gray-500">การรวมบัญชีจะเปิดให้ใช้เร็ว ๆ นี้</p>
            <Button type="button" size="lg" variant="secondary" className="w-full !rounded-xl" onClick={() => setDeclined(true)}>
              ยังไม่รวมตอนนี้
            </Button>
          </div>
        )
      }
    >
      {declined ? (
        <p className="text-[15px] leading-7 text-gray-700">
          ร้านใหม่เข้าใช้ทางเว็บด้วยอีเมล และรหัสผ่าน ส่วน LINE ยังใช้กับร้านเดิมตามเดิม เปลี่ยนใจมารวมทีหลังได้
        </p>
      ) : (
        <p className="text-[15px] leading-7 text-gray-700">
          บัญชี LINE นี้ถูกใช้กับผู้ใช้อีกคนในระบบมั่งมีพลัสอยู่แล้ว จึงยังเชื่อมกับร้านใหม่นี้ไม่ได้
        </p>
      )}
    </Modal>
  );
}

function Welcome() {
  const searchParams = useSearchParams();
  const [handoff, setHandoff] = useState<WelcomeHandoff | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  // The BFF sends the link lane back here with the reason; a 409 is the merge case. Read after
  // mount, not during render: the prerendered HTML has no query string, so branching on it while
  // rendering makes the server and client trees disagree.
  const [lineOutcome, setLineOutcome] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  useEffect(() => {
    const outcome = searchParams.get('line');
    setLineOutcome(outcome);
    setMergeOpen(outcome === 'link-conflict');
  }, [searchParams]);

  useEffect(() => {
    setHandoff(readClaimedCompany());
    let active = true;
    void fetchPlanTermNotice().then((notice) => {
      if (active && notice) setTrialEndsAt(notice.termEndsAt);
    });
    return () => {
      active = false;
    };
  }, []);

  const companyName = handoff?.companyName ?? 'ร้านของคุณ';
  const homePath = handoff?.homePath ?? '/';

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-12">
        <div className="lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E7F4EC] text-[#046B29]">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <h1 className="mt-4 text-[24px] font-extrabold leading-9 text-gray-900">{companyName} พร้อมใช้งานแล้ว</h1>
            {/* Hidden entirely when the term is unknown: a made-up date is worse than no date. */}
            {trialEndsAt ? (
              <p className="mt-2 text-[15px] leading-7 text-gray-600">
                ทดลองใช้แพ็กเกจ PRO ฟรี ถึง {formatThaiDate(trialEndsAt)}
              </p>
            ) : null}

            {lineOutcome === 'link-failed' ? (
              <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14.5px] leading-7 text-amber-900">
                เชื่อมกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือข้ามไปก่อนแล้วค่อยเชื่อมทีหลังได้
              </div>
            ) : null}

            <section className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
              <h2 className="text-[17px] font-extrabold text-gray-900">ขั้นตอนสุดท้าย — เชื่อมกับ LINE</h2>
              <p className="mt-1.5 text-[14.5px] leading-7 text-gray-600">
                กดปุ่มเดียว ระบบพาไปยืนยันในแอป LINE และเพิ่มเพื่อน “น้องมั่งมี” ให้ในคราวเดียว
              </p>
              <ul className="mt-3.5 space-y-2">
                {BULLETS.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2.5 text-[14.5px] leading-7 text-gray-700">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: LINE_GREEN }} />
                    {bullet}
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <LineLinkButton />
              </div>
            </section>

            <a href={homePath} className="mt-5 block text-center text-[14.5px] font-semibold text-gray-600 underline hover:text-gray-900">
              ไว้ทีหลัง — เข้าใช้งานเลย
            </a>
          </div>

          {/* Desktop column. P12 ships a QR only for *login* (it hands the scanner a session); there
              is no link-mode QR to reuse, and minting one here would let a scan sign someone in. */}
          <aside className="mt-5 hidden rounded-2xl border border-gray-200 bg-white p-6 lg:mt-0 lg:block">
            <h2 className="text-[17px] font-extrabold text-gray-900">ทำบนมือถือได้เลย</h2>
            <p className="mt-2 text-[14.5px] leading-7 text-gray-600">
              การเชื่อม LINE ต้องยืนยันในแอป LINE บนมือถือ กดปุ่มด้านซ้ายบนเครื่องนี้ได้ ถ้ามีแอป LINE
              หรือเปิดหน้านี้บนมือถือแล้วกดเชื่อมก็ได้เหมือนกัน
            </p>
            <div className="mt-4">
              <LineLinkButton />
            </div>
            <p className="mt-4 text-[13px] leading-6 text-gray-500">
              ข้ามขั้นตอนนี้ไปก่อนได้ เชื่อม LINE ทีหลังจากหน้าตั้งค่าได้ตลอด
            </p>
          </aside>
        </div>
      </main>

      <MergeDialog open={mergeOpen} onClose={() => setMergeOpen(false)} />
    </div>
  );
}

export default function SignupWelcomePage() {
  return (
    <Suspense fallback={null}>
      <Welcome />
    </Suspense>
  );
}
