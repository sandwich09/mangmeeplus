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
    intro: 'โปรดอ่านเอกสารฉบับเต็มและยืนยันทั้ง 3 รายการด้านล่าง ระบบจะบันทึกฉบับเอกสาร วันเวลา บัญชี และกิจการที่คุณยืนยันไว้เป็นหลักฐาน',
    company: 'กำลังยืนยันสำหรับ',
    requiredLegend: '* ข้อมูลจำเป็น',
    termsHeading: 'ข้อกำหนดการใช้งาน',
    privacyHeading: 'นโยบายความเป็นส่วนตัว',
    capacityHeading: {
      AUTHORIZED_REPRESENTATIVE: 'อำนาจในการยืนยันแทนกิจการ',
      INVITED_MEMBER: 'สิทธิการใช้งานที่กิจการมอบหมาย',
      SYSTEM_OPERATOR: 'ขอบเขตหน้าที่ของผู้ดูแลระบบ',
    },
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
    privacyLink: 'นโยบายความเป็นส่วนตัว',
    termsLink: 'ข้อกำหนดการใช้งาน',
    deletionLink: 'การลบข้อมูล',
    footer: 'คุณสามารถเปิดอ่านเอกสารฉบับเต็มในแท็บใหม่ได้ก่อนยืนยัน',
  },
  en: {
    title: 'Before you start using MangmeePlus',
    intro: 'Please read the full documents and confirm all three required items below. We record the document versions, date and time, account, and company as evidence of your confirmation.',
    company: 'Confirming for',
    requiredLegend: '* Required',
    termsHeading: 'Terms of Use',
    privacyHeading: 'Privacy Notice',
    capacityHeading: {
      AUTHORIZED_REPRESENTATIVE: 'Authority to confirm for the company',
      INVITED_MEMBER: 'Access assigned by the company',
      SYSTEM_OPERATOR: 'Platform administrator responsibilities',
    },
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
  return <span className="doc-accept-required" aria-hidden>*</span>;
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
        // The API gate reads append-only DB evidence, so token rotation is a best-effort hardening
        // step rather than a condition for using an acceptance that is already durable.
        void refreshSessionSilently();
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
      void refreshSessionSilently();
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

  return (
    // `doc` carries the shared legal-document token block from legal.css: this screen
    // is the signature page of the notices it links to, so it is set in their language.
    <main lang={locale} className="doc">
      <div className="doc-accept-main">
        <header className="doc-accept-brand">
          <span className="doc-wordmark-glyph" aria-hidden>
            <MangmeeLogo size={19} />
          </span>
          <div>
            <p className="doc-accept-brand-name">
              มั่ง<span style={{ color: 'var(--doc-gold)' }}>มี</span> MangmeePlus
            </p>
            <p className="doc-accept-brand-sub doc-display">Business &amp; Accounting Assistant</p>
          </div>
        </header>

        <section className="doc-accept-sheet">
          <div className="doc-accept-plate">
            <p className="doc-eyebrow doc-display">Legal acceptance</p>
            <h1 className="doc-title">{copy.title}</h1>
            <p className="doc-standfirst">{copy.intro}</p>
            {status ? (
              <p className="doc-accept-for">
                <span className="doc-accept-for-label">{copy.company}</span>
                <span className="doc-accept-for-value">{status.companyName}</span>
              </p>
            ) : null}
          </div>

          <div className="doc-accept-body">
            {loading ? (
              <div className="doc-accept-status" role="status">
                <span className="doc-accept-spinner" aria-hidden />
                <p style={{ margin: 0 }}>{copy.loading}</p>
              </div>
            ) : !status ? (
              <div className="doc-accept-status" role="alert">
                <p className="doc-accept-error" style={{ marginTop: 0 }}>{error ?? copy.loadError}</p>
                <Button type="button" variant="secondary" onClick={() => void loadStatus()}>{copy.retry}</Button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={submit} noValidate>
                <div className="doc-accept-legend">
                  <p className="doc-accept-legend-title">รายการที่ต้องยืนยัน</p>
                  <p className="doc-accept-legend-note doc-accept-required">{copy.requiredLegend}</p>
                </div>

                {error ? (
                  <p id="legal-acceptance-error" role="alert" className="doc-accept-error">
                    {error}
                  </p>
                ) : null}

                {/* Three confirmations in a fixed order — the numerals record position
                    in a required sequence, not decoration. */}
                <ol className="doc-accept-list">
                  <li className="doc-accept-item">
                    <span className="doc-accept-num" aria-hidden>1</span>
                    <div>
                      <div className="doc-accept-head">
                        <div>
                          <h2 className="doc-accept-item-title">{copy.termsHeading}</h2>
                          <p className="doc-accept-item-meta">{title(status.terms)} · {version(status.terms)}</p>
                        </div>
                        <a href={status.terms.href} target="_blank" rel="noopener noreferrer" className="doc-accept-open">
                          {copy.openDocument} ↗<span className="sr-only"> (เปิดในแท็บใหม่)</span>
                        </a>
                      </div>
                      <label className="doc-accept-check">
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
                    </div>
                  </li>

                  <li className="doc-accept-item">
                    <span className="doc-accept-num" aria-hidden>2</span>
                    <div>
                      <div className="doc-accept-head">
                        <div>
                          <h2 className="doc-accept-item-title">{copy.privacyHeading}</h2>
                          <p className="doc-accept-item-meta">{title(status.privacy)} · {version(status.privacy)}</p>
                        </div>
                        <a href={status.privacy.href} target="_blank" rel="noopener noreferrer" className="doc-accept-open">
                          {copy.openDocument} ↗<span className="sr-only"> (เปิดในแท็บใหม่)</span>
                        </a>
                      </div>
                      <label className="doc-accept-check">
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
                      <p id="privacy-acknowledgment-note" className="doc-accept-note">
                        <strong>หมายเหตุ:</strong> {copy.privacyNotConsent}
                      </p>
                    </div>
                  </li>

                  <li className="doc-accept-item">
                    <span className="doc-accept-num" aria-hidden>3</span>
                    <div>
                      <h2 className="doc-accept-item-title">{copy.capacityHeading[status.capacity]}</h2>
                      <label className="doc-accept-check">
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
                    </div>
                  </li>
                </ol>

                <div className="doc-accept-actions">
                  <Button type="submit" size="lg" loading={submitting} className="w-full !rounded-xl">
                    {copy.submit}
                    <span aria-hidden>→</span>
                  </Button>
                  <p className="doc-accept-hint">{copy.footer}</p>
                </div>
              </form>
            )}
          </div>
        </section>

        <footer className="doc-accept-foot">
          <nav aria-label="เอกสารทางกฎหมาย" className="doc-accept-foot-links">
            <a href="/privacy" target="_blank" rel="noopener noreferrer">{copy.privacyLink}</a>
            <a href="/terms" target="_blank" rel="noopener noreferrer">{copy.termsLink}</a>
            <a href="/data-deletion" target="_blank" rel="noopener noreferrer">{copy.deletionLink}</a>
          </nav>
          <button
            type="button"
            disabled={submitting || loggingOut}
            onClick={() => void signOut()}
            className="doc-accept-signout"
          >
            {loggingOut ? 'กำลังออกจากระบบ…' : copy.logout}
          </button>
        </footer>
      </div>
    </main>
  );
}
