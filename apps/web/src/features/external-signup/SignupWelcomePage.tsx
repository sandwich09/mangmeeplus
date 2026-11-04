'use client';
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

import { Suspense, useEffect, useState } from 'react';
import type { AccountMergeCompanyOutcomeDto, AccountMergePreviewDto } from '@watchdog-bms/contracts';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { useSearchParams } from 'next/navigation';
import { Button, primaryButtonClass, quietButtonClass } from '@/common/components/button';
import { Modal } from '@/common/components/modal';
import { Notice } from '@/common/components/notice';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { fetchPlanTermNotice } from '@/features/plan-term/plan-term.api';
import { getAccountSecurityState } from '@/features/auth/auth.api';
import { SignupBrandHeader } from './SignupChrome';
import { SIGNUP_TRIAL_AFTER } from './signup.logic';
import { packagePathFor, readClaimedCompany, shouldFetchMergeOffer, type WelcomeHandoff } from './welcome-handoff.logic';

const LINE_GREEN = '#06C755';

// The link-after-password lane of P12-2: with a session already established by the claim, the BFF
// callback links the verified LINE identity to this user instead of issuing new tokens.
const LINE_LINK_URL = `/api/auth/line-login/start?returnTo=${encodeURIComponent('/signup/welcome')}`;

const BULLETS = [
  'ใช้มั่งมีพลัสบันทึกรายจ่ายและเก็บใบเสร็จให้ค้นหาได้ง่าย',
  'มีงานรออนุมัติ ระบบเตือนใน LINE',
  'ครั้งหน้าเข้าเว็บด้วย LINE ได้ ไม่ต้องพิมพ์รหัสผ่าน',
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
      className={`flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[10px] text-base font-bold text-white ${className}`}
      style={{ backgroundColor: LINE_GREEN }}
    >
      <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-sm font-bold" style={{ color: LINE_GREEN }}>
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
  last_active_owner: `ร้านนี้จะไม่เหลือ${THAI_SYSTEM_ROLE_NAMES.OWNER}`,
  role_conflict: 'สองบัญชีมีสิทธิ์ในร้านนี้ไม่เหมือนกัน',
  target_membership_inactive: 'สิทธิ์ของบัญชีเดิมในร้านนี้ถูกปิดอยู่',
};

const SIGN_IN_TH: Record<string, string> = { line: 'LINE', password: 'ชื่อผู้ใช้และรหัสผ่าน' };

const signInLabel = (ways: string[]) =>
  ways.map((way) => SIGN_IN_TH[way] ?? way).join(' หรือ ') || 'ยังไม่มีวิธีเข้าสู่ระบบ';

const MERGE_ERROR_DEFAULT = 'รวมบัญชีไม่สำเร็จ ลองอีกครั้ง หรือติดต่อทีมงานมั่งมี 098-256-5628';
const MERGE_EXPIRED = 'คำขอรวมบัญชีหมดอายุแล้ว กดปุ่ม เชื่อมกับ LINE อีกครั้ง แล้วเลือกรวมบัญชี';
const MERGE_ERROR_TH: Record<string, string> = {
  merge_ticket_missing: MERGE_EXPIRED,
  merge_ticket_invalid: MERGE_EXPIRED,
  merge_ticket_expired: MERGE_EXPIRED,
  merge_ticket_not_yours: 'บัญชีที่เข้าใช้อยู่ไม่ตรงกับคำขอนี้ เข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  session_expired: 'การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  merge_in_progress: 'กำลังรวมบัญชีอยู่ รอสักครู่แล้วเปิดหน้านี้ใหม่',
  merge_target_unavailable: 'บัญชีเดิมใช้งานไม่ได้ในตอนนี้ ติดต่อทีมงานมั่งมี 098-256-5628',
  merge_not_needed: 'สองบัญชีนี้เป็นบัญชีเดียวกันอยู่แล้ว ไม่ต้องรวม',
  // Review R05: the server refuses rather than decide on its own which role set should win.
  account_merge_role_conflict: 'รวมบัญชีไม่ได้ เพราะสิทธิ์ในร้านที่ซ้ำกันไม่ตรงกัน ติดต่อทีมงานมั่งมี 098-256-5628',
};

/**
 * Shown every time a link attempt hits an account that already owns this LINE (spec §4F: the offer
 * repeats, it is not a one-shot). Only two ways out — merge, or leave both accounts standing.
 * "Move LINE off the other account" is deliberately absent from this screen.
 */
function MergeDialog({ open, onClose, onCancel }: { open: boolean; onClose: () => void; onCancel: () => void }) {
  const [offer, setOffer] = useState<MergeOffer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const blockedByPlan = preview ? !preview.canMerge : false;
  // What signing in looks like afterwards, said ONCE (it used to be said three times on this dialog).
  const afterMerge = preview
    ? `หลังรวม เข้าสู่ระบบด้วย ${signInLabel(preview.keeps.signInWith)}${
        preview.closes.signInWith.length > 0 ? ` ส่วน ${signInLabel(preview.closes.signInWith)} ของบัญชีนี้จะใช้ไม่ได้อีก` : ''}`
    : 'หลังรวม เข้าสู่ระบบด้วยบัญชีเดิม หรือด้วย LINE นี้ ส่วนชื่อผู้ใช้และรหัสผ่านที่เพิ่งตั้งไว้จะใช้ไม่ได้อีก';

  return (
    <Modal
      open={open}
      size="sm"
      title="LINE นี้เชื่อมกับบัญชีอื่นอยู่แล้ว"
      onClose={pending ? () => {} : onClose}
      // The two outcomes, named, back-out first: the shared footer gives them one width and puts
      // the acting one at the right (on top when they stack).
      footer={
        <>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            ไม่รวม
          </Button>
          <Button type="button" disabled={!offer?.ready || pending || blockedByPlan} loading={pending} onClick={confirmMerge}>
            รวมบัญชี
          </Button>
        </>
      }
    >
      <p className="text-[15px] leading-7 text-gray-700">
        LINE นี้ใช้กับอีกบัญชีในมั่งมีพลัสอยู่แล้ว จึงเชื่อมกับร้านใหม่นี้ไม่ได้ รวมสองบัญชีเป็นบัญชีเดียวได้
      </p>
      {/* Naming the other account is what makes the choice answerable. It is bounded to a
          display name and shop names — the LINE account the user just proved they control. */}
      {existing ? (
        <div className="mt-3.5 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
          <p className="text-xs font-semibold text-gray-500">บัญชีเดิมที่จะรวมเข้าไป</p>
          <p className="mt-1 text-[15px] font-bold text-gray-900">{existing.displayName || 'บัญชีผู้ใช้เดิม'}</p>
          {existing.companyNames.length > 0 ? (
            <>
              <p className="mt-2 text-xs font-semibold text-gray-500">ร้านที่บัญชีเดิมมีอยู่</p>
              <ul className="mt-1 space-y-1">
                {existing.companyNames.map((name) => (
                  <li key={name} className="text-sm leading-6 text-gray-700">{name}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {/* Review R05: consent needs the consequences. One line per shop, then, once, the way of
          signing in that survives and the one that stops working (merging DISABLES this new
          account, so the username and password just chosen stop working). */}
      {preview ? (
        <>
          <p className="mt-3.5 text-xs font-semibold text-gray-500">สิ่งที่จะเกิดกับแต่ละร้าน</p>
          <ul className="mt-1.5 space-y-1.5">
            {preview.companies.map((company) => (
              <li key={company.companyName} className="text-sm leading-6 text-gray-700">
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
        </>
      ) : null}
      {offer?.ready ? <p className="mt-3.5 text-sm leading-6 text-gray-700">{afterMerge}</p> : null}
      {/* Why the main button cannot be pressed is said beside it, in the body right above the footer. */}
      {offer && !offer.ready ? <Notice tone="warning" className="mt-3.5">{MERGE_EXPIRED}</Notice> : null}
      {blockedByPlan ? <Notice tone="warning" className="mt-3.5">มีร้านที่รวมไม่ได้ ติดต่อทีมงานมั่งมี 098-256-5628</Notice> : null}
      {error ? <Notice tone="error" className="mt-3.5">{error}</Notice> : null}
    </Modal>
  );
}

function Welcome() {
  const searchParams = useSearchParams();
  const [handoff, setHandoff] = useState<WelcomeHandoff | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  // Owner 2026-09-20 (spec §19): no trial, so a fresh shop is locked at once. `null` (not answered
  // yet) reads the same as locked — neither state may promise the shop is ready to use.
  const [locked, setLocked] = useState<boolean | null>(null);
  // The BFF sends the link lane back here with the reason; a 409 is the merge case. Read after
  // mount, not during render: the prerendered HTML has no query string, so branching on it while
  // rendering makes the server and client trees disagree.
  const [lineOutcome, setLineOutcome] = useState<string | null>(null);
  // What the BACKEND says about this account's LINE identity. `null` = not answered yet (or the
  // read failed), which is the only case where the query string is allowed to decide.
  const [linkedOnServer, setLinkedOnServer] = useState<boolean | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  // Declining the merge closes the dialog; what that means is said on the page, not in a second dialog state.
  const [mergeDeclined, setMergeDeclined] = useState(false);

  useEffect(() => {
    const outcome = searchParams.get('line');
    setLineOutcome(outcome);
    setMergeOpen(outcome === 'link-conflict');
  }, [searchParams]);

  useEffect(() => {
    setHandoff(readClaimedCompany());
    let active = true;
    void fetchPlanTermNotice().then((notice) => {
      if (!active || !notice) return;
      const expired = notice.derivedState === 'EXPIRED';
      setLocked(expired);
      // Owner 2026-09-20: a shop opened today has a term that is already over (no trial), so its
      // date would read as "you have until today". Only a term still running is worth a date.
      if (!expired) setTrialEndsAt(notice.termEndsAt);
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
  const packagePath = handoff ? packagePathFor(handoff) : homePath;
  // Server first, the callback's query only as the answer while that read is in flight.
  const lineLinked = linkedOnServer ?? lineOutcome === 'linked';
  // Only a confirmed running term may call the shop ready; not-yet-loaded reads as locked so
  // neither state promises use of a shop that cannot yet be vouched for (spec §19).
  const ready = Boolean(handoff) && locked === false;
  const showLocked = Boolean(handoff) && locked === true;
  // While the notice is still in flight the links stay neutral: neither "เข้าใช้งาน" (false for a
  // locked shop) nor "ไปเลือกแพ็กเกจ" (wrong for a shop whose old trial still runs).
  const settling = Boolean(handoff) && locked === null;

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className={`mx-auto w-full max-w-md px-4 py-6 lg:py-12 ${lineLinked ? '' : 'lg:max-w-4xl'}`}>
        <div className={lineLinked ? undefined : 'lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-6'}>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
            {/* The green check and the "ready" headline are claims about a signup that just
                finished. Reached from the sidebar menu instead, this page is only the LINE step,
                so both give way to a neutral title. */}
            {handoff ? (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E7F4EC] text-[#046B29]">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              </span>
            ) : null}
            <h1 className={`${handoff ? 'mt-4 ' : ''}break-words text-[22px] font-bold leading-9 text-gray-900`}>
              {handoff ? (ready ? `${companyName} พร้อมใช้งานแล้ว` : `เปิดร้าน ${companyName} แล้ว`) : 'เชื่อมบัญชี LINE'}
            </h1>
            {/* Owner 2026-09-20 (spec R1): no trial to date-stamp any more. A shop that still
                carries a running term — one opened before the trial closed — keeps being told when
                it ends; every new shop is simply told what to do next. Said only to someone who
                just opened a shop: a person who came from the menu to link LINE already has one,
                and a starting price under "เชื่อมบัญชี LINE" was about nothing they came for. */}
            {handoff ? (
              <p className="mt-2 text-[15px] leading-7 text-gray-600">
                {trialEndsAt ? `ใช้งานได้ถึง ${formatThaiDate(trialEndsAt)} ` : ''}{SIGNUP_TRIAL_AFTER}
              </p>
            ) : null}

            {lineOutcome === 'link-failed' ? (
              <Notice tone="warning" className="mt-5">เชื่อมกับ LINE ไม่สำเร็จ ลองอีกครั้ง หรือข้ามไปก่อนแล้วเชื่อมทีหลังได้</Notice>
            ) : null}
            {mergeDeclined ? (
              <Notice tone="info" className="mt-5">ร้านใหม่เข้าใช้ทางเว็บด้วยอีเมลและรหัสผ่าน ส่วน LINE ยังใช้กับร้านเดิม เปลี่ยนใจมารวมทีหลังได้</Notice>
            ) : null}

            {/* The one screen that says the link worked. Reached with no `line` param the page
                cannot tell a fresh visit from a completed round trip, so it used to re-offer the
                connect panel and the button reopened LINE (Owner UAT 2026-08-31). */}
            {lineLinked ? (
              <section role="status" className="mt-6">
                <h2 className="text-[17px] font-bold text-gray-900">เชื่อมบัญชี LINE แล้ว</h2>
                <p className="mt-1.5 text-[15px] leading-7 text-gray-600">
                  {showLocked
                    ? 'ครั้งหน้าเข้าเว็บด้วย LINE ได้ เมื่อเลือกแพ็กเกจแล้ว ส่งรูปใบเสร็จเข้าแชต “น้องมั่งมี” ได้เลย'
                    : 'ส่งรูปใบเสร็จเข้าแชต “น้องมั่งมี” ได้เลย และครั้งหน้าเข้าเว็บด้วย LINE ได้ ไม่ต้องพิมพ์รหัสผ่าน'}
                </p>
                <a href={showLocked ? packagePath : '/'} className={`${primaryButtonClass} mt-5 w-full`}>
                  {showLocked ? 'ไปเลือกแพ็กเกจ' : settling ? 'ไปต่อ' : 'เข้าใช้งาน'}
                </a>
              </section>
            ) : (
              <>
                <section className={handoff ? 'mt-6 border-t border-gray-100 pt-5' : 'mt-3'}>
                  {/* "The last step" is true only right after a sign-up; from the menu the page's own title already says what this is. */}
                  {handoff ? <h2 className="text-[17px] font-bold text-gray-900">ขั้นตอนสุดท้าย เชื่อมกับ LINE</h2> : null}
                  {/* This flow links an identity; it does not add a friend for anyone, and it has
                      no friend-state check to know whether one was added. Saying it did left the
                      owner expecting to send a receipt into a chat that was never opened. */}
                  <p className="mt-1.5 text-[15px] leading-7 text-gray-600">
                    กดแล้ว LINE จะเปิดให้ยืนยันตัวตน จากนั้นเพิ่มเพื่อน “น้องมั่งมี” เพื่อส่งรูปใบเสร็จเข้าแชต
                  </p>
                  <ul className="mt-3.5 space-y-2">
                    {BULLETS.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2.5 text-[15px] leading-7 text-gray-700">
                        <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: LINE_GREEN }} />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    <LineLinkButton />
                  </div>
                </section>

                <a href={showLocked ? packagePath : homePath} className={`${quietButtonClass} mt-2 w-full`}>
                  {showLocked ? 'ไว้ทีหลัง ไปเลือกแพ็กเกจก่อน' : settling ? 'ไว้ทีหลัง' : 'ไว้ทีหลัง เข้าใช้งานเลย'}
                </a>
              </>
            )}
          </div>

          {/* Desktop column. P12 ships a QR only for *login* (it hands the scanner a session); there
              is no link-mode QR to reuse, and minting one here would let a scan sign someone in.
              Gone once the link succeeded. It carries no second "connect" button: one control per
              destination, and the one that connects is in the card at the left. */}
          {lineLinked ? null : (
            <aside className="mt-5 hidden rounded-2xl border border-gray-200 bg-white p-6 lg:mt-0 lg:block">
              <h2 className="text-[17px] font-bold text-gray-900">ใช้คอมพิวเตอร์อยู่</h2>
              <p className="mt-2 text-[15px] leading-7 text-gray-600">
                การเชื่อม LINE ต้องยืนยันในแอป LINE ถ้าเครื่องนี้ไม่มีแอป LINE ให้เปิดหน้านี้บนมือถือแล้วกดเชื่อม
              </p>
              <p className="mt-3 text-sm leading-6 text-gray-500">
                ข้ามไปก่อนได้ เชื่อม LINE ทีหลังได้จากเมนูผู้ใช้
              </p>
            </aside>
          )}
        </div>
      </main>

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        onCancel={() => { setMergeOpen(false); setMergeDeclined(true); }}
      />
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
