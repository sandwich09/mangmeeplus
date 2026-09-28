'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BillingDocumentResendResult, BillingEmailRecipient, BillingEmailRecipientOperation, BillingInvoiceItem, BillingRecipientOtpChallenge, BillingRecipientOtpProof, BillingStatus } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { getAccountEmailOtp, type AccountEmailOtpState } from '@/features/auth/account-email-otp.api';
import { billingApi } from './billing.api';
import { billingSupportReference } from './billing-display';
import { billingResendText } from './billing-error-text';

const button = 'mangmee-btn mangmee-btn-secondary min-h-11';
const primary = 'mangmee-btn mangmee-btn-primary min-h-11';
const field = 'mangmee-input mt-2 block min-h-11 w-full min-w-0';
const IN_FLIGHT = ['QUEUED', 'RUNNING', 'RECONCILING'];
type Step = 'idle' | 'choose' | 'code_sent' | 'previewed' | 'op_pending' | 'done';
const opText = (state: string) => state === 'BLOCKED' ? 'ข้อมูลเปลี่ยนหรือยังดำเนินการไม่ได้ กรุณายกเลิกคำขอแล้วตรวจใหม่'
  : state === 'RECONCILING' ? 'กำลังตรวจผลกับผู้ให้บริการ หากยังไม่สำเร็จ ติดต่อทีมมั่งมีพร้อมเลขอ้างอิงด้านล่าง'
    : state === 'CANCELLED' ? 'ยกเลิกคำขอแล้ว' : state === 'FAILED' ? 'ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วเริ่มคำขอใหม่' : 'กำลังดำเนินการ';

/** R-A8/R-D2: change who receives the company's billing documents — the verified account email, or any
 *  mailbox proven with a code sent to it — then resend the latest documents there. */
export function BillingEmailRecipientPanel({ companyId, status, latestInvoice, openRequest = 0, onChanged, apiOverride }: {
  companyId: string; status: BillingStatus; latestInvoice?: BillingInvoiceItem | null; openRequest?: number; onChanged?: () => void;
  apiOverride?: ReturnType<typeof billingApi>;
}) {
  const api = useMemo(() => apiOverride ?? billingApi(companyId), [companyId, apiOverride]);
  const id = useId(), changed = useRef(onChanged); changed.current = onChanged;
  const [current, setCurrent] = useState<BillingEmailRecipient | null>(null);
  const [account, setAccount] = useState<AccountEmailOtpState | null>(null);
  const [step, setStep] = useState<Step>('idle'), [choice, setChoice] = useState<'account' | 'other'>('other');
  const [newEmail, setNewEmail] = useState(''), [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<BillingRecipientOtpChallenge | null>(null), [proof, setProof] = useState<BillingRecipientOtpProof | null>(null);
  const [operation, setOperation] = useState<BillingEmailRecipientOperation | null>(null);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0), [rateLimitUntil, setRateLimitUntil] = useState(0);
  const [resent, setResent] = useState<BillingDocumentResendResult | null>(null);
  const running = useRef(false), requestKey = useRef<{ email: string; key: string } | null>(null);
  const load = useCallback(async () => { const value = await api.recipient(); setCurrent(value); return value; }, [api]);
  const settle = useCallback((next: BillingEmailRecipientOperation) => {
    setOperation(next);
    if (next.state === 'COMPLETED') { setStep('done'); void load().catch(() => {}); changed.current?.(); }
    else if (next.state !== 'PREVIEW') { setStep('op_pending'); if (!IN_FLIGHT.includes(next.state)) void load().catch(() => {}); }
  }, [load]);
  useEffect(() => {
    let active = true;
    void api.recipient().then(value => { if (!active) return; setCurrent(value); if (value.operation) settle(value.operation); })
      .catch(e => { if (active) setError(apiErrorMessage(e)); });
    return () => { active = false; };
  }, [api, settle]);
  useEffect(() => {
    if (!operation || !IN_FLIGHT.includes(operation.state)) return;
    let active = true;
    const timer = window.setInterval(() => { void api.recipientOperation(operation.id).then(value => { if (active) settle(value); })
      .catch(e => { if (active) setError(apiErrorMessage(e)); }); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, settle, operation?.id, operation?.state]);
  useEffect(() => {
    if (step !== 'code_sent') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);
  // The account email is read once when the editor opens, only to decide whether to offer it (no polling).
  const open = useCallback(() => {
    setStep(value => value === 'previewed' || value === 'op_pending' ? value : 'choose');
    setChoice('other'); setError(''); setErrorCode(null); setResent(null); setAccount(null);
    void getAccountEmailOtp().then(setAccount, () => setAccount(null));
  }, []);
  useEffect(() => { if (openRequest) open(); }, [openRequest, open]);

  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setErrorCode(null);
    try { await work(); }
    catch (e) {
      const code = apiErrorCode(e);
      // The shared text for EMAIL_REAUTH_REQUIRED sends people to a password/LINE re-login step this
      // panel has no UI for (it confirms in the same session that requested the code, R-A8). Confirming
      // from another session/browser is the only way this panel hits that code.
      setError(code === 'EMAIL_REAUTH_REQUIRED' ? 'กรุณายืนยันรหัสในเบราว์เซอร์เดียวกับที่ขอรหัส หรือกดขอรหัสใหม่' : apiErrorMessage(e));
      setErrorCode(code);
      const seconds = (e as { details?: { retryAfterSeconds?: unknown } } | null)?.details?.retryAfterSeconds;
      if (code === 'EMAIL_OTP_RATE_LIMITED' && typeof seconds === 'number' && seconds > 0) setRateLimitUntil(Date.now() + seconds * 1000);
      if (code === 'EMAIL_OTP_INVALID') setChallenge(value => value && { ...value, attemptsRemaining: Math.max(0, value.attemptsRemaining - 1) });
    } finally { running.current = false; setBusy(false); }
  }
  // One key per request: the API answers a repeated key with the same challenge and sends nothing,
  // so the key is kept only to retry a request whose answer never arrived.
  const requestCode = (email: string) => run(async () => {
    const target = email.trim();
    if (!requestKey.current || requestKey.current.email !== target.toLowerCase()) requestKey.current = { email: target.toLowerCase(), key: crypto.randomUUID() };
    try {
      const next = await api.recipientOtpRequest(target, requestKey.current.key);
      requestKey.current = null;
      setChallenge(next); setProof(null); setCode(''); setRateLimitUntil(0); setStep('code_sent');
    } catch (e) { if (apiErrorCode(e)) requestKey.current = null; throw e; }
  });
  const confirmCode = () => run(async () => {
    if (!challenge) return;
    const verified = proof ?? await api.recipientOtpConfirm(challenge.challengeId, code);
    setProof(verified);
    setOperation(await api.recipientPreview(verified.recipientProofId)); setStep('previewed');
  });
  const chooseAccountEmail = () => run(async () => { setOperation(await api.recipientPreview()); setStep('previewed'); });
  const submit = () => run(async () => {
    if (!operation) return;
    const next = await api.recipientSubmit(operation);
    await api.refresh().catch(() => {});
    settle(next);
  });
  const cancelOperation = () => run(async () => {
    if (operation) await api.recipientCancel(operation);
    setOperation(null); setProof(null); setChallenge(null); setStep('idle'); await load();
  });
  const refreshState = () => run(async () => { await load(); if (operation) settle(await api.recipientOperation(operation.id)); });
  const resend = () => run(async () => { if (!latestInvoice) return; setResent(null); setResent(await api.resendDocument(latestInvoice.id)); });
  const clear = () => { setStep('idle'); setChallenge(null); setProof(null); setCode(''); setNewEmail(''); setResent(null); setError(''); setErrorCode(null); setOperation(null); };

  if (!current?.hasCustomer && !error) return null;
  // F04: the recipient op refuses while a purchase is in flight; the status says so (`canChange`).
  const blockedByPurchase = status.recipient ? !status.recipient.canChange && !current?.busy
    : Boolean(status.attemptId && status.applyState !== 'APPLIED' && status.paymentState !== 'FAILED');
  const canEdit = Boolean(current?.hasCustomer) && !current?.busy && !blockedByPurchase;
  const view = !canEdit && (step === 'choose' || step === 'code_sent') ? 'idle' : step;
  const accountOption = account?.emailRequirement === 'READY' && account.email && account.email !== current?.email ? account.email : null;
  const retrySeconds = Math.max(0, Math.ceil((Math.max(rateLimitUntil, challenge ? Date.parse(challenge.retryAt) : 0) - now) / 1000));
  const accountHref = status.accessState === 'ACTIVE' ? `/companies/${encodeURIComponent(companyId)}/settings/profile#account`
    : `/account/email?company=${encodeURIComponent(companyId)}`;
  return <section aria-label="ผู้รับเอกสารของบริษัท" className="mangmee-card space-y-4 p-5 sm:p-6">
    <h2 className="text-base font-semibold">อีเมลรับเอกสารของบริษัท</h2>
    {error && <div role="alert" className="space-y-1 rounded-xl bg-red-50 p-3"><p className="break-words">{error}</p>
      {errorCode === 'BILLING_EMAIL_VERIFICATION_REQUIRED' && <a className="inline-flex min-h-11 items-center text-brand-700 underline" href={accountHref}>ไปที่บัญชีของฉัน</a>}</div>}
    {/* Documents, notices and bounce tracking all read the stored column, not the live Stripe value. */}
    {current && <p className="break-all">ผู้รับปัจจุบัน: <strong>{current.stored?.email ?? current.email ?? 'ยังไม่ระบุ'}</strong></p>}
    {view === 'idle' && <div className="space-y-2">
      <button className={button} disabled={!canEdit} onClick={open}>แก้อีเมลรับเอกสาร</button>
      {current?.hasCustomer && blockedByPurchase && <p className="text-sm text-gray-600">แก้อีเมลรับเอกสารได้เมื่อรายการชำระเงินปัจจุบันเปิดสิทธิ์เสร็จ</p>}
    </div>}
    {view === 'choose' && <div className="space-y-3">
      <fieldset className="space-y-1"><legend className="font-semibold">เลือกวิธีตั้งอีเมลรับเอกสาร</legend>
        {accountOption && <label className="flex min-h-11 items-center gap-3"><input type="radio" name={`${id}-recipient`} checked={choice === 'account'} disabled={busy} onChange={() => setChoice('account')} />
          <span className="min-w-0 break-all">ใช้อีเมลบัญชีที่ยืนยันแล้ว ({accountOption})</span></label>}
        <label className="flex min-h-11 items-center gap-3"><input type="radio" name={`${id}-recipient`} checked={choice === 'other' || !accountOption} disabled={busy} onChange={() => setChoice('other')} />ใช้อีเมลอื่น</label>
      </fieldset>
      {choice === 'account' && accountOption ? <div className="flex flex-wrap gap-3">
        <button className={primary} disabled={busy} aria-busy={busy} onClick={() => void chooseAccountEmail()}>ใช้เมลที่ยืนยันแล้วสำหรับเอกสารในอนาคต</button>
        <button className={button} disabled={busy} onClick={clear}>ยกเลิก</button>
      </div> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void requestCode(newEmail); }}>
        <label className="block">อีเมลรับเอกสารใหม่<input className={field} type="email" inputMode="email" autoComplete="email" required maxLength={254}
          value={newEmail} disabled={busy} onChange={event => setNewEmail(event.target.value)} /></label>
        <div className="flex flex-wrap gap-3"><button type="submit" className={primary} disabled={busy || !newEmail.trim() || retrySeconds > 0} aria-busy={busy}>{retrySeconds > 0 ? `ขอรหัสยืนยันได้ใน ${retrySeconds} วินาที` : 'ขอรหัสยืนยัน'}</button>
          <button type="button" className={button} disabled={busy} onClick={clear}>ยกเลิก</button></div>
      </form>}
    </div>}
    {view === 'code_sent' && challenge && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void confirmCode(); }}>
      <p className="break-all">รหัสยืนยัน 6 หลักสำหรับ <strong>{challenge.email}</strong> · กรอกได้อีก {challenge.attemptsRemaining} ครั้ง</p>
      {/* Same delivery-status mapping as the account-email panel (AccountEmailOtpPanel.tsx): a failed
          send says so, instead of the code always reading as sent. */}
      <p role="status">{challenge.delivered ? 'ระบบส่งถึงเซิร์ฟเวอร์อีเมลแล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม' : challenge.deliveryStatus === 'ACCEPTED' ? 'ผู้ให้บริการรับคำขอส่งแล้ว กรุณาตรวจกล่องจดหมายและสแปม' : ['READY', 'SENDING', 'UNKNOWN'].includes(challenge.deliveryStatus) ? 'ยังยืนยันผลการส่งไม่ได้ หากได้รับรหัสสามารถกรอกได้ หรือรอขอรหัสใหม่' : 'ส่งรหัสไม่สำเร็จ กรุณาตรวจอีเมลและขอรหัสใหม่ หรือยกเลิกคำขอนี้'}</p>
      <label className="block">รหัสยืนยัน 6 หลัก<input className={field} inputMode="numeric" autoComplete="one-time-code" required maxLength={6}
        value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primary} disabled={busy || code.length !== 6} aria-busy={busy}>ยืนยันรหัส</button>
        <button type="button" className={button} disabled={busy || retrySeconds > 0} aria-busy={busy} onClick={() => void requestCode(challenge.email)}>{retrySeconds > 0 ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสใหม่'}</button>
        <button type="button" className={button} disabled={busy} onClick={() => { setStep('choose'); setChallenge(null); setProof(null); setCode(''); }}>ยกเลิก</button>
      </div>
    </form>}
    {(view === 'previewed' || view === 'op_pending') && operation && <div className="space-y-3 rounded-xl bg-gray-50 p-3">
      <p className="break-all">จาก {operation.previousEmail ?? 'ยังไม่ระบุ'} เป็น <strong>{operation.newEmail}</strong>{view === 'previewed' && ' · มีผลกับเอกสารใหม่ของบริษัทนี้'}</p>
      {view === 'op_pending' && <p role="status">{opText(operation.state)}</p>}
      {view === 'op_pending' && operation.state === 'RECONCILING' && <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงสำหรับแจ้งทีมงาน</summary><p className="break-all">{billingSupportReference(operation.id)}</p></details>}
      <div className="flex flex-wrap gap-3">
        {view === 'previewed' && operation.canSubmit && <button className={primary} disabled={busy} aria-busy={busy} onClick={() => void submit()}>ยืนยันเปลี่ยนผู้รับเอกสาร</button>}
        {operation.canCancel && <button className={button} disabled={busy} aria-busy={busy} onClick={() => void cancelOperation()}>ยกเลิกคำขอ</button>}
        {view === 'op_pending' && (IN_FLIGHT.includes(operation.state) || operation.state === 'BLOCKED') && <button className={button} disabled={busy} aria-busy={busy} onClick={() => void refreshState()}>ตรวจสถานะผู้รับเอกสาร</button>}
        {view === 'op_pending' && ['FAILED', 'CANCELLED'].includes(operation.state) && <button className={button} disabled={busy} onClick={clear}>ปิด</button>}
      </div>
    </div>}
    {view === 'done' && operation && <div className="space-y-3 rounded-xl bg-green-50 p-3">
      <p role="status" className="break-all">เปลี่ยนผู้รับเอกสารเป็น <strong>{operation.newEmail}</strong> แล้ว เอกสารใหม่จะส่งไปที่อีเมลนี้</p>
      {resent && <p role="status" className="break-all">{billingResendText(resent, 'recipient')}</p>}
      <div className="flex flex-wrap gap-3">
        {latestInvoice?.documentActions?.canResend && <button className={primary} disabled={busy} aria-busy={busy} onClick={() => void resend()}>ส่งเอกสารล่าสุดไปอีเมลใหม่</button>}
        <button className={button} disabled={busy} onClick={clear}>ปิด</button>
      </div>
    </div>}
  </section>;
}
