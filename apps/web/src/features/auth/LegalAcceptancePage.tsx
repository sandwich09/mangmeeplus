'use client';

import type {
  LegalAcceptanceCapacity,
  LegalAcceptanceLocale,
  LegalAcceptanceStatusResponse,
} from '@watchdog-bms/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/common/components/button';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { logoutCurrentSession } from '@/common/auth/session';
import {
  acceptLegalDocuments,
  getLegalAcceptanceStatus,
  refreshSessionSilently,
} from './auth.api';
import { buildLegalAcceptanceInput } from './legal-acceptance.logic';

type Props = {
  companyId: string;
  returnTo: string;
};

type Copy = {
  title: string;
  intro: string;
  company: string;
  requiredLegend: string;
  termsHeading: string;
  privacyHeading: string;
  capacityHeading: Record<LegalAcceptanceCapacity, string>;
  capacityLabel: string;
  capacityValue: Record<LegalAcceptanceCapacity, string>;
  effectiveLabel: string;
  fingerprintLabel: string;
  attestation: string;
  openDocument: string;
  privacyNotConsent: string;
  submit: string;
  logout: string;
  loading: string;
  loadError: string;
  retry: string;
  requiredError: string;
  saveError: string;
  staleError: string;
  logoutError: string;
  privacyLink: string;
  termsLink: string;
  deletionLink: string;
  footer: string;
};

const COPY: Record<LegalAcceptanceLocale, Copy> = {
  th: {
    title: 'ก่อนเริ่มใช้งาน MangmeePlus',
    intro: 'โปรดอ่านเอกสารฉบับเต็มและยืนยันทั้ง 3 รายการด้านล่าง การยืนยันนี้ใช้กับบัญชีของคุณทุกกิจการ และระบบจะถามอีกครั้งเฉพาะเมื่อเอกสารออกฉบับใหม่',
    company: 'กิจการอ้างอิงสำหรับหลักฐานครั้งแรก',
    requiredLegend: '* ข้อมูลจำเป็น',
    termsHeading: 'ข้อกำหนดการใช้งาน',
    privacyHeading: 'ประกาศความเป็นส่วนตัว',
    capacityHeading: {
      AUTHORIZED_REPRESENTATIVE: 'อำนาจในการยืนยันแทนกิจการ',
      INVITED_MEMBER: 'สิทธิการใช้งานที่กิจการมอบหมาย',
      SYSTEM_OPERATOR: 'ขอบเขตหน้าที่ของผู้ดูแลระบบ',
    },
    capacityLabel: 'สถานะผู้ยืนยัน',
    capacityValue: {
      AUTHORIZED_REPRESENTATIVE: 'ผู้มีอำนาจกระทำการแทนกิจการ',
      INVITED_MEMBER: 'ผู้ใช้งานที่กิจการมอบหมาย',
      SYSTEM_OPERATOR: 'ผู้ดูแลระบบแพลตฟอร์ม',
    },
    effectiveLabel: 'วันที่เอกสารมีผลใช้บังคับ',
    fingerprintLabel: 'ค่าตรวจสอบไฟล์ (SHA-256)',
    attestation: 'เมื่อกดยืนยัน ระบบจะบันทึกวันเวลา ฉบับเอกสารและค่าตรวจสอบไฟล์ ข้อความที่คุณยืนยัน บัญชีผู้ยืนยัน และกิจการที่อ้างอิง ไว้เป็นหลักฐานแบบเพิ่มได้อย่างเดียว',
    openDocument: 'เปิดอ่านเอกสารฉบับเต็ม',
    privacyNotConsent: 'การรับทราบนี้ไม่ใช่การให้ความยินยอม ไม่เป็นการสละสิทธิของคุณตาม PDPA และไม่ทำให้ MangmeePlus ใช้ข้อมูลนอกเหนือจากฐานกฎหมายและวัตถุประสงค์ที่แจ้งไว้',
    submit: 'ยืนยันและเริ่มใช้งาน',
    logout: 'ออกจากระบบ',
    loading: 'กำลังตรวจสอบเอกสารที่ต้องยืนยัน…',
    loadError: 'ไม่สามารถโหลดเอกสารที่ต้องยืนยันได้ กรุณาลองใหม่อีกครั้ง',
    retry: 'ลองใหม่',
    requiredError: 'กรุณายืนยันรายการที่มีเครื่องหมาย * ให้ครบทั้ง 3 รายการ',
    saveError: 'ยังบันทึกการยืนยันไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง',
    staleError: 'ข้อมูลกิจการ บทบาท หรือฉบับเอกสารเปลี่ยนระหว่างที่คุณอ่าน กรุณาตรวจสอบข้อความล่าสุดและยืนยันใหม่',
    logoutError: 'ไม่สามารถออกจากระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    privacyLink: 'ประกาศความเป็นส่วนตัว',
    termsLink: 'ข้อกำหนดการใช้งาน',
    deletionLink: 'การลบข้อมูล',
    footer: 'คุณสามารถเปิดอ่านเอกสารฉบับเต็มในแท็บใหม่ได้ก่อนยืนยัน',
  },
  en: {
    title: 'Before you start using MangmeePlus',
    intro: 'Please read the full documents and confirm all three required items below. This confirmation applies to your account across companies, and we ask again only when a new document release is issued.',
    company: 'Initial company evidence context',
    requiredLegend: '* Required',
    termsHeading: 'Terms of Use',
    privacyHeading: 'Privacy Notice',
    capacityHeading: {
      AUTHORIZED_REPRESENTATIVE: 'Authority to confirm for the company',
      INVITED_MEMBER: 'Access assigned by the company',
      SYSTEM_OPERATOR: 'Platform administrator responsibilities',
    },
    capacityLabel: 'Signing capacity',
    capacityValue: {
      AUTHORIZED_REPRESENTATIVE: 'Authorized representative of the company',
      INVITED_MEMBER: 'Member assigned by the company',
      SYSTEM_OPERATOR: 'Platform administrator',
    },
    effectiveLabel: 'Documents effective from',
    fingerprintLabel: 'File checksum (SHA-256)',
    attestation: 'On confirming, we record the date and time, the document versions and file checksums, the statements you confirmed, your account, and the company in scope, as append-only evidence.',
    openDocument: 'Read the full document',
    privacyNotConsent: 'This acknowledgment is not consent, does not waive your data-protection rights, and does not permit MangmeePlus to use data beyond the lawful bases and purposes described in the notice.',
    submit: 'Confirm and start using MangmeePlus',
    logout: 'Sign out',
    loading: 'Checking the documents you need to confirm…',
    loadError: 'We could not load the documents you need to confirm. Please try again.',
    retry: 'Try again',
    requiredError: 'Please confirm all three items marked with *.',
    saveError: 'We could not save your confirmation. Check your connection and try again.',
    staleError: 'Your company, role, or document version changed while you were reviewing. Check the latest statements and confirm again.',
    logoutError: 'We could not sign you out. Please try again.',
    privacyLink: 'Privacy Notice',
    termsLink: 'Terms of Use',
    deletionLink: 'Data Deletion',
    footer: 'You can open each full document in a new tab before confirming.',
  },
};

function RequiredMark() {
  return <span className="doc-gate-required" aria-hidden>*</span>;
}

// Buddhist era, unconditionally: this screen is Thai-only for the release (see `locale`
// below). The register renders only after the status fetch resolves on the client, so
// this can never produce server/client skew. UTC keeps a date-only value on its own day.
const EFFECTIVE_DATE_FORMAT = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function effectiveDate(...dates: string[]): string {
  // The pair can be released separately; the later date is when this pair took effect.
  return EFFECTIVE_DATE_FORMAT.format(new Date(`${[...dates].sort().at(-1)!}T00:00:00Z`));
}

/** Head and tail of the artifact checksum — enough to compare against the evidence row. */
function shortFingerprint(sha256: string): string {
  return `${sha256.slice(0, 12)}…${sha256.slice(-12)}`;
}

export default function LegalAcceptancePage({ companyId, returnTo }: Props) {
  // Acceptance is Thai-only for this release because the immutable full Terms
  // and Privacy artifacts are currently published in Thai only.
  const locale = 'th' as const;
  const copy = COPY.th;
  const [status, setStatus] = useState<LegalAcceptanceStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [capacityConfirmed, setCapacityConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function loadStatus(messageAfterLoad?: string) {
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await getLegalAcceptanceStatus(companyId);
      setStatus(nextStatus);
      if (!nextStatus.required) {
        if (!(await refreshSessionSilently())) throw new Error('Session refresh after legal acceptance failed.');
        window.location.assign(returnTo);
        return;
      }
      if (messageAfterLoad) setError(messageAfterLoad);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    // Re-fetching when copy/locale changes would be unnecessary and could race a submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form?.checkValidity()) {
      setError(copy.requiredError);
      form?.querySelector<HTMLInputElement>('input:invalid')?.focus();
      return;
    }
    if (!status) return;

    setSubmitting(true);
    setError(null);
    try {
      await acceptLegalDocuments(companyId, buildLegalAcceptanceInput(status));
      if (!(await refreshSessionSilently())) throw new Error('Session refresh after legal acceptance failed.');
      window.location.assign(returnTo);
    } catch (nextError) {
      const code = (nextError as { code?: string }).code;
      if (code === 'legal_acceptance_challenge_stale' || code === 'legal_document_version_stale') {
        setTermsAccepted(false);
        setPrivacyAcknowledged(false);
        setCapacityConfirmed(false);
        setSubmitting(false);
        await loadStatus(copy.staleError);
        return;
      }
      setError(copy.saveError);
      setSubmitting(false);
    }
  }

  async function signOut() {
    setLoggingOut(true);
    setError(null);
    if (!(await logoutCurrentSession('/login'))) {
      setError(copy.logoutError);
      setLoggingOut(false);
    }
  }

  const statements = status?.statements.th;
  const version = (document: { displayVersionTh: string }) => document.displayVersionTh;
  const title = (document: { titleTh: string }) => document.titleTh;

  // Drives the progress line and the ready state of the execute control. The button is
  // never disabled: an empty submit has to report *which* item is missing and focus it,
  // which a disabled control cannot do.
  const confirmations = [termsAccepted, privacyAcknowledged, capacityConfirmed];
  const confirmed = confirmations.filter(Boolean).length;

  return (
    // `doc` carries the shared legal-document token block from legal.css: this screen
    // is the signature page of the notices it links to, so it is set in their language.
    // `doc-gate` makes it the full-viewport two-column signing screen.
    <main lang={locale} className="doc doc-gate">
      {/* Identity and register: who is signing, for which company, from what date.
          Pinned for the whole scroll on wide screens, stacked on top on narrow ones. */}
      <aside className="doc-gate-aside">
        <div className="doc-gate-brand">
          <span className="doc-gate-brand-mark" aria-hidden>
            <MangmeeLogo size={22} />
          </span>
          <div>
            <p className="doc-gate-brand-name">
              มั่ง<span style={{ color: 'var(--doc-gold)' }}>มี</span> MangmeePlus
            </p>
            <p className="doc-gate-brand-sub doc-display">Secure business workspace</p>
          </div>
        </div>

        <div className="doc-gate-lede">
          <p className="doc-gate-eyebrow doc-display">Legal acceptance</p>
          <h1 className="doc-gate-title">{copy.title}</h1>
          <p className="doc-gate-intro">{copy.intro}</p>
        </div>

        {status ? (
          <dl className="doc-gate-register">
            <div>
              <dt>{copy.company}</dt>
              <dd>{status.companyName}</dd>
            </div>
            <div>
              <dt>{copy.capacityLabel}</dt>
              <dd>{copy.capacityValue[status.capacity]}</dd>
            </div>
            <div>
              <dt>{copy.effectiveLabel}</dt>
              <dd>{effectiveDate(status.terms.effectiveDate, status.privacy.effectiveDate)}</dd>
            </div>
          </dl>
        ) : null}

      </aside>

      <div className="doc-gate-panel">
        <div className="doc-gate-work">
          {loading ? (
            <div className="doc-gate-status" role="status">
              <span className="doc-gate-spinner" aria-hidden />
              <p style={{ margin: 0 }}>{copy.loading}</p>
            </div>
          ) : !status ? (
            <div className="doc-gate-status" role="alert">
              <p className="doc-gate-error" style={{ margin: 0 }}>{error ?? copy.loadError}</p>
              <Button type="button" variant="secondary" onClick={() => void loadStatus()}>{copy.retry}</Button>
            </div>
          ) : (
            <form ref={formRef} onSubmit={submit} noValidate className="doc-gate-form">
              <div className="doc-gate-legend">
                <div>
                  <p className="doc-gate-legend-title">รายการที่ต้องยืนยัน</p>
                  <p className="doc-gate-legend-hint">{copy.footer}</p>
                </div>
                <p className="doc-gate-legend-note doc-gate-required">{copy.requiredLegend}</p>
              </div>

              {error ? (
                <p id="legal-acceptance-error" role="alert" className="doc-gate-error">
                  {error}
                </p>
              ) : null}

              {/* Three confirmations in a fixed order — the numerals record position
                  in a required sequence, not decoration. */}
              <ol className="doc-gate-steps">
                <li className="doc-gate-step">
                  <div className="doc-gate-step-head">
                    <div className="doc-gate-step-id">
                      <span className="doc-gate-step-num doc-display" aria-hidden>1</span>
                      <div>
                        <h2 className="doc-gate-step-title">{copy.termsHeading}</h2>
                        <p className="doc-gate-step-meta">{title(status.terms)} · {version(status.terms)}</p>
                      </div>
                    </div>
                    <a href={status.terms.href} target="_blank" rel="noopener noreferrer" className="doc-gate-open">
                      {copy.openDocument} ↗<span className="sr-only"> (เปิดในแท็บใหม่)</span>
                    </a>
                  </div>
                  <p className="doc-gate-hash doc-display" title={status.terms.artifactSha256}>
                    <span className="doc-gate-hash-label">{copy.fingerprintLabel}</span>{' '}
                    {shortFingerprint(status.terms.artifactSha256)}
                  </p>
                  <label className="doc-gate-check">
                    <input
                      type="checkbox"
                      name="termsAccepted"
                      required
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                      aria-describedby={error ? 'legal-acceptance-error' : undefined}
                    />
                    <span>{statements?.terms}<RequiredMark /></span>
                  </label>
                </li>

                <li className="doc-gate-step">
                  <div className="doc-gate-step-head">
                    <div className="doc-gate-step-id">
                      <span className="doc-gate-step-num doc-display" aria-hidden>2</span>
                      <div>
                        <h2 className="doc-gate-step-title">{copy.privacyHeading}</h2>
                        <p className="doc-gate-step-meta">{title(status.privacy)} · {version(status.privacy)}</p>
                      </div>
                    </div>
                    <a href={status.privacy.href} target="_blank" rel="noopener noreferrer" className="doc-gate-open">
                      {copy.openDocument} ↗<span className="sr-only"> (เปิดในแท็บใหม่)</span>
                    </a>
                  </div>
                  <p className="doc-gate-hash doc-display" title={status.privacy.artifactSha256}>
                    <span className="doc-gate-hash-label">{copy.fingerprintLabel}</span>{' '}
                    {shortFingerprint(status.privacy.artifactSha256)}
                  </p>
                  <label className="doc-gate-check">
                    <input
                      type="checkbox"
                      name="privacyAcknowledged"
                      required
                      checked={privacyAcknowledged}
                      onChange={(event) => setPrivacyAcknowledged(event.target.checked)}
                      aria-describedby={error
                        ? 'privacy-acknowledgment-note legal-acceptance-error'
                        : 'privacy-acknowledgment-note'}
                    />
                    <span>{statements?.privacy}<RequiredMark /></span>
                  </label>
                  <p id="privacy-acknowledgment-note" className="doc-gate-note">
                    <strong>หมายเหตุ:</strong> {copy.privacyNotConsent}
                  </p>
                </li>

                <li className="doc-gate-step">
                  <div className="doc-gate-step-head">
                    <div className="doc-gate-step-id">
                      <span className="doc-gate-step-num doc-display" aria-hidden>3</span>
                      <h2 className="doc-gate-step-title">{copy.capacityHeading[status.capacity]}</h2>
                    </div>
                  </div>
                  <label className="doc-gate-check">
                    <input
                      type="checkbox"
                      name="capacityConfirmed"
                      required
                      checked={capacityConfirmed}
                      onChange={(event) => setCapacityConfirmed(event.target.checked)}
                      aria-describedby={error ? 'legal-acceptance-error' : undefined}
                    />
                    <span>{statements?.capacity}<RequiredMark /></span>
                  </label>
                </li>
              </ol>

              <p className="doc-gate-attest">{copy.attestation}</p>

              {/* Last child of the form and sticky to the bottom: Accept is on screen
                  from the first paint at any viewport height, and comes to rest here
                  once the reader reaches the end. */}
              <div className="doc-gate-execute">
                <div className="doc-gate-progress">
                  <span>ยืนยันแล้ว <b>{confirmed}</b> จาก 3 รายการ</span>
                  <span className="doc-gate-progress-rail" aria-hidden>
                    {confirmations.map((done, index) => (
                      <span key={index} className={done ? 'is-on' : undefined} />
                    ))}
                  </span>
                </div>
                <Button
                  type="submit"
                  size="lg"
                  loading={submitting}
                  className={confirmed === 3 ? 'doc-gate-submit is-ready' : 'doc-gate-submit'}
                >
                  {copy.submit}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Its own grid child, placed under the work column on a phone and continuing the
          brand column on a wide screen: these are the secondary exits, and on a small
          screen they were pushing the first confirmation off the opening viewport. */}
      <footer className="doc-gate-foot">
        <nav aria-label="เอกสารทางกฎหมาย" className="doc-gate-foot-links">
          <a href="/privacy" target="_blank" rel="noopener noreferrer">{copy.privacyLink}</a>
          <a href="/terms" target="_blank" rel="noopener noreferrer">{copy.termsLink}</a>
          <a href="/data-deletion" target="_blank" rel="noopener noreferrer">{copy.deletionLink}</a>
        </nav>
        <button
          type="button"
          disabled={submitting || loggingOut}
          onClick={() => void signOut()}
          className="doc-gate-signout"
        >
          {loggingOut ? 'กำลังออกจากระบบ…' : copy.logout}
        </button>
      </footer>
    </main>
  );
}
