'use client';

import { Suspense, useEffect, useState } from 'react';
import type { AccountMergeCompanyOutcomeDto, AccountMergePreviewDto } from '@watchdog-bms/contracts';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/common/components/button';
import { Modal } from '@/common/components/modal';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { fetchPlanTermNotice } from '@/features/plan-term/plan-term.api';
import { getAccountSecurityState } from '@/features/auth/auth.api';
import { SignupBrandHeader } from './SignupChrome';
import { SIGNUP_TRIAL_AFTER } from './signup.logic';
import { readClaimedCompany, shouldFetchMergeOffer, type WelcomeHandoff } from './welcome-handoff.logic';

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
      onClick={(event) => {
        // LINE in-app browser: force the whole OAuth round trip into the system browser, or the
        // transaction cookie and the callback land in different browsers (UAT 2026-09-01).
        event.preventDefault();
        window.location.assign(withLineExternalBrowser(LINE_LINK_URL, navigator.userAgent));
      }}
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

type MergeOffer = {
  ready: boolean;
  existingAccount?: { displayName: string; companyNames: string[] };
  /** Review R05: what the merge would do, per shop, and which way of signing in survives. */
  preview?: AccountMergePreviewDto;
};

/** Owner copy. No plus sign anywhere in user-facing text: write "และ". */
const MERGE_OUTCOME_TH: Record<AccountMergeCompanyOutcomeDto['outcome'], string> = {
  move: 'ย้ายไปอยู่กับบัญชีเดิม',
  close_duplicate: 'บัญชีเดิมมีสิทธิ์ร้านนี้อยู่แล้ว',
  blocked: 'รวมไม่ได้',
};

const MERGE_BLOCK_TH: Record<string, string> = {
  last_active_owner: 'ร้านนี้จะไม่เหลือเจ้าของร้าน',
  role_conflict: 'สองบัญชีมีสิทธิ์ในร้านนี้ไม่เหมือนกัน',
  target_membership_inactive: 'สิทธิ์ของบัญชีเดิมในร้านนี้ถูกปิดอยู่',
};

const SIGN_IN_TH: Record<string, string> = { line: 'LINE', password: 'ชื่อผู้ใช้และรหัสผ่าน' };

const signInLabel = (ways: string[]) =>
  ways.map((way) => SIGN_IN_TH[way] ?? way).join(' หรือ ') || 'ยังไม่มีวิธีเข้าสู่ระบบ';

const MERGE_ERROR_DEFAULT = 'รวมบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง หรือติดต่อ 098-256-5628';
const MERGE_EXPIRED = 'คำขอรวมบัญชีหมดอายุแล้ว กดปุ่ม เชื่อมกับ LINE อีกครั้ง แล้วเลือกรวมบัญชี';
const MERGE_ERROR_TH: Record<string, string> = {
  merge_ticket_missing: MERGE_EXPIRED,
  merge_ticket_invalid: MERGE_EXPIRED,
  merge_ticket_expired: MERGE_EXPIRED,
  merge_ticket_not_yours: 'บัญชีที่เข้าใช้อยู่ไม่ตรงกับคำขอนี้ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  session_expired: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  merge_in_progress: 'กำลังรวมบัญชีอยู่ กรุณารอสักครู่แล้วเปิดหน้านี้ใหม่',
  merge_target_unavailable: 'บัญชีเดิมใช้งานไม่ได้ในตอนนี้ ติดต่อ 098-256-5628',
  merge_not_needed: 'สองบัญชีนี้เป็นบัญชีเดียวกันอยู่แล้ว ไม่ต้องรวม',
  // Review R05: the server refuses rather than decide on its own which role set should win.
  account_merge_role_conflict: 'รวมบัญชีไม่ได้ เพราะสิทธิ์ในร้านที่ซ้ำกันไม่ตรงกัน ติดต่อ 098-256-5628',
};

/**
 * Shown every time a link attempt hits an account that already owns this LINE (spec §4F: the offer
 * repeats, it is not a one-shot). Only two ways out — merge, or leave both accounts standing.
 * "Move LINE off the other account" is deliberately absent from this screen.
 */
function MergeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [declined, setDeclined] = useState(false);
  const [offer, setOffer] = useState<MergeOffer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ticket lives in an HttpOnly cookie, so only the server can say whether an offer is live.
  // A cookie that has expired is not an error — the user simply presses the LINE button again.
  //
  // Review F6: fetched ONCE per mount, not on every open. The dialog is re-offered on every failed
  // link attempt, and each open used to cost a preview call — which the API rate-limits.
  useEffect(() => {
    if (!shouldFetchMergeOffer(open, offer)) return undefined;
    let active = true;
    void fetch('/api/auth/account-merge/ticket', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: MergeOffer) => { if (active) setOffer(data); })
      .catch(() => { if (active) setOffer({ ready: false }); });
    return () => { active = false; };
  }, [open, offer]);

  const confirmMerge = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/account-merge', { method: 'POST', cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { merged?: boolean; code?: string };
      if (res.ok && data.merged) {
        // Full navigation, not a router push: the session cookies now belong to the other account.
        window.location.assign('/');
        return;
      }
      setError((data.code && MERGE_ERROR_TH[data.code]) ?? MERGE_ERROR_DEFAULT);
    } catch {
      setError(MERGE_ERROR_DEFAULT);
    }
    setPending(false);
  };

  const existing = offer?.ready ? offer.existingAccount : undefined;
  const preview = offer?.ready ? offer.preview : undefined;
  // Fail closed in the UI too: a plan that says no disables the button rather than letting the
  // person press it and read a 409.
  const blockedByPlan = preview ? !preview.canMerge : false;

  return (
    <Modal
      open={open}
      size="sm"
      title="LINE นี้เชื่อมกับบัญชีอื่นอยู่แล้ว"
      onClose={pending ? () => {} : onClose}
      footer={
        declined ? (
          <Button type="button" size="lg" className="w-full !rounded-xl" onClick={onClose}>
            เข้าใจแล้ว
          </Button>
        ) : (
          <div className="flex w-full flex-col gap-2.5">
            <Button
              type="button"
              size="lg"
              className="w-full !rounded-xl"
              disabled={!offer?.ready || pending || blockedByPlan}
              loading={pending}
              onClick={confirmMerge}
            >
              รวมเข้าบัญชีเดิม
            </Button>
            <p className="text-center text-[12.5px] leading-6 text-gray-500">
              {!offer?.ready
                ? MERGE_EXPIRED
                : blockedByPlan
                  ? 'มีร้านที่รวมไม่ได้ ดูรายละเอียดด้านบน แล้วติดต่อ 098-256-5628'
                  : preview
                    ? `หลังรวมแล้ว เข้าสู่ระบบด้วย ${signInLabel(preview.keeps.signInWith)}`
                    : 'ร้านของบัญชีนี้จะย้ายไปอยู่กับบัญชีเดิม แล้วใช้ LINE เข้าใช้งานได้ทุกร้าน'}
            </p>
            <Button type="button" size="lg" variant="secondary" className="w-full !rounded-xl" disabled={pending} onClick={() => setDeclined(true)}>
              ไว้ก่อน
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
        <>
          <p className="text-[15px] leading-7 text-gray-700">
            บัญชี LINE นี้ถูกใช้กับผู้ใช้อีกคนในระบบมั่งมีพลัสอยู่แล้ว จึงยังเชื่อมกับร้านใหม่นี้ไม่ได้
          </p>
          {/* Naming the other account is what makes the choice answerable. It is bounded to a
              display name and shop names — the LINE account the user just proved they control. */}
          {existing ? (
            <div className="mt-3.5 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
              <p className="text-[12.5px] font-semibold text-gray-500">บัญชีเดิมที่จะรวมเข้าไป</p>
              <p className="mt-1 text-[15px] font-extrabold text-gray-900">{existing.displayName || 'บัญชีผู้ใช้เดิม'}</p>
              {existing.companyNames.length > 0 ? (
                <>
                  <p className="mt-2 text-[12.5px] font-semibold text-gray-500">ร้านที่บัญชีเดิมมีอยู่</p>
                  <ul className="mt-1 space-y-1">
                    {existing.companyNames.map((name) => (
                      <li key={name} className="text-[14px] leading-6 text-gray-700">{name}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {/* The screen explained the shops moving and said nothing about the credentials.
                  Merging DISABLES this new account, so the username and password just chosen stop
                  working — which is the part someone needs to know before they press it. */}
              <p className="mt-2.5 border-t border-gray-200 pt-2.5 text-[13px] leading-6 text-gray-600">
                หลังรวม เข้าสู่ระบบด้วยบัญชีเดิม หรือด้วย LINE นี้ ส่วนชื่อผู้ใช้และรหัสผ่านที่เพิ่งตั้งไว้จะใช้ไม่ได้อีก
              </p>
            </div>
          ) : null}
          {/* Review R05: consent needs the consequences. One line per shop, then the credentials
              that survive and the ones that stop working. */}
          {preview ? (
            <div className="mt-3.5 rounded-xl border border-gray-200 p-3.5">
              <p className="text-[12.5px] font-semibold text-gray-500">สิ่งที่จะเกิดกับแต่ละร้าน</p>
              <ul className="mt-1.5 space-y-1.5">
                {preview.companies.map((company) => (
                  <li key={company.companyName} className="text-[14px] leading-6 text-gray-700">
                    <span className="font-semibold text-gray-900">{company.companyName}</span>
                    {' — '}
                    <span className={company.outcome === 'blocked' ? 'text-amber-800' : undefined}>
                      {MERGE_OUTCOME_TH[company.outcome]}
                      {company.outcome === 'blocked' && company.reason
                        ? ` (${MERGE_BLOCK_TH[company.reason] ?? company.reason})`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[13.5px] leading-6 text-gray-600">
                เข้าสู่ระบบต่อด้วย {signInLabel(preview.keeps.signInWith)}
                {preview.closes.signInWith.length > 0
                  ? ` และจะใช้ ${signInLabel(preview.closes.signInWith)} ของบัญชีนี้ไม่ได้อีก`
                  : ''}
              </p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[14px] leading-6 text-amber-900">
              {error}
            </p>
          ) : null}
        </>
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
  // What the BACKEND says about this account's LINE identity. `null` = not answered yet (or the
  // read failed), which is the only case where the query string is allowed to decide.
  const [linkedOnServer, setLinkedOnServer] = useState<boolean | null>(null);
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
    // The `line=linked` query is only ever present on the ONE navigation the callback makes. Coming
    // back from the sidebar, or reloading, the page could not tell a fresh visit from a finished
    // link and re-offered the connect panel to someone already linked. The backend knows.
    void getAccountSecurityState()
      .then((state) => { if (active) setLinkedOnServer(state.lineLinked); })
      // A read that cannot answer must not claim the link is missing: leave the query to decide.
      .catch(() => { if (active) setLinkedOnServer(null); });
    return () => {
      active = false;
    };
  }, []);

  const companyName = handoff?.companyName ?? 'ร้านของคุณ';
  const homePath = handoff?.homePath ?? '/';
  // Server first, the callback's query only as the answer while that read is in flight.
  const lineLinked = linkedOnServer ?? lineOutcome === 'linked';

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-12">
        <div className="lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
            {/* The green check and the "ready" headline are claims about a signup that just
                finished. Reached from the sidebar menu instead, this page is only the LINE step,
                so both give way to a neutral title. */}
            {handoff ? (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E7F4EC] text-[#046B29]">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              </span>
            ) : null}
            <h1 className="mt-4 text-[24px] font-extrabold leading-9 text-gray-900">
              {handoff ? `${companyName} พร้อมใช้งานแล้ว` : 'เชื่อมบัญชี LINE'}
            </h1>
            {/* Owner 2026-09-05: one free trial for everyone, so this no longer names a tier the
                shop was never put on. Hidden entirely when the term is unknown: a made-up date is
                worse than no date. */}
            {trialEndsAt ? (
              <p className="mt-2 text-[15px] leading-7 text-gray-600">
                {/* F1: named the PRO package while provisioning writes the free trial. The
                    wording table's "what happens after" rides the same line, so the date never
                    stands alone implying a renewal. */}
                ทดลองใช้ฟรี ถึง {formatThaiDate(trialEndsAt)} — {SIGNUP_TRIAL_AFTER}
              </p>
            ) : null}

            {lineOutcome === 'link-failed' ? (
              <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14.5px] leading-7 text-amber-900">
                เชื่อมกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือข้ามไปก่อนแล้วค่อยเชื่อมทีหลังได้
              </div>
            ) : null}

            {/* The one screen that says the link worked. Reached with no `line` param the page
                cannot tell a fresh visit from a completed round trip, so it used to re-offer the
                connect panel and the button reopened LINE (Owner UAT 2026-08-31). */}
            {lineLinked ? (
              <section role="status" className="mt-6 rounded-xl border border-[#B6E0C4] bg-[#F2F9F4] p-4 sm:p-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#046B29]">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                <h2 className="mt-3 text-[17px] font-extrabold text-gray-900">เชื่อมบัญชี LINE สำเร็จแล้ว</h2>
                <p className="mt-1.5 text-[14.5px] leading-7 text-gray-600">
                  ส่งรูปใบเสร็จเข้าแชต “น้องมั่งมี” ได้เลย และครั้งหน้าเข้าเว็บด้วย LINE ได้ ไม่ต้องพิมพ์รหัส
                </p>
                <a
                  href="/"
                  className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-[#046B29] text-[15.5px] font-semibold text-white"
                >
                  เข้าใช้งาน
                </a>
              </section>
            ) : (
              <>
                <section className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
                  <h2 className="text-[17px] font-extrabold text-gray-900">ขั้นตอนสุดท้าย — เชื่อมกับ LINE</h2>
                  {/* This flow links an identity; it does not add a friend for anyone, and it has
                      no friend-state check to know whether one was added. Saying it did left the
                      owner expecting to send a receipt into a chat that was never opened. */}
                  <p className="mt-1.5 text-[14.5px] leading-7 text-gray-600">
                    กดปุ่มนี้ ระบบจะเปิดแอป LINE ให้ยืนยันตัวตน จากนั้นทำตามหน้าจอเพื่อเพิ่มเพื่อน “น้องมั่งมี” แล้วจึงส่งรูปใบเสร็จเข้าแชตได้
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
              </>
            )}
          </div>

          {/* Desktop column. P12 ships a QR only for *login* (it hands the scanner a session); there
              is no link-mode QR to reuse, and minting one here would let a scan sign someone in.
              Gone once the link succeeded — a second "connect" button beside a success notice is
              exactly the contradiction that made the loop unreadable. */}
          {lineLinked ? null : (
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
          )}
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
