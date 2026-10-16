'use client';
import Link from 'next/link';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { sanitizeNextPath } from '@/common/auth/middleware.logic';
import { legalAcceptancePath } from '@/common/auth/session-gate.logic';
import { rememberPendingRedirect } from './auth.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useEffect, useRef, useState } from 'react';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { primaryButtonClass, quietButtonClass, secondaryButtonClass } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { isThaiMobile } from '@/features/external-signup/signup.logic';
import { AuthFrame, authTitleClass, BackToLoginLink } from './AuthFrame';

/** Loose on purpose, like the sign-up form: the server decides whether the address really exists. */
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
type FieldErrors = { email?: string; code?: string; companyName?: string; displayName?: string; phoneNumber?: string };
type Result = { companyId?: string; passwordChangeRequired?: boolean; legalAcceptanceRequired?: boolean; email?: string; kind?: string; state?: string; message?: string; code?: string; redirectPath?: string;
  deliveryStatus?: string; retryAt?: string; retryAfterSeconds?: number };
export default function EmailAccessPage() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [step, setStep] = useState('email');
  const [companyName, setCompanyName] = useState(''), [displayName, setDisplayName] = useState(''), [phoneNumber, setPhone] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Said under the field it is about, in the page's own words (every form here is `noValidate`:
  // the browser's own bubble speaks the browser's language and names no field).
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const clearField = (name: keyof FieldErrors) => setFieldErrors(prev => prev[name] ? { ...prev, [name]: undefined } : prev);
  /** Shows what is wrong and puts the cursor in the first wrong field; true when nothing is wrong. */
  const check = (errors: FieldErrors, ids: Partial<Record<keyof FieldErrors, string>>) => {
    setFieldErrors(errors);
    const first = (Object.keys(ids) as (keyof FieldErrors)[]).find(name => errors[name]);
    if (!first) return true;
    setError(''); document.getElementById(ids[first]!)?.focus();
    return false;
  };
  const [notice, setNotice] = useState(''), [state, setState] = useState(''), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const running = useRef(false), key = useRef(''), alert = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (step === 'code') document.getElementById('access-code')?.focus(); }, [step]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  async function call(action: string, body: unknown = {}): Promise<Result> {
    const response = await fetch(`/api/auth/email-access/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as Result;
    if (!response.ok) {
      if (result.retryAfterSeconds) setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      if (result.code === 'EMAIL_ACCESS_INVALID') { key.current = ''; setCode(''); setStep('email'); }
      throw Object.assign(new Error('email-access-failed'), { code: result.code, statusCode: response.status });
    }
    return result;
  }
  useEffect(() => {
    // Browser binding lives in HttpOnly cookie; a reload can resume without saving secrets in JS.
    // Resolve the previous browser proof before accepting a new email; a late resume must not switch the user's account.
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
    let active = true;
    void fetch('/api/auth/email-access/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal })
      .then(async response => { if (active && response.ok) await apply(await response.json()); }).catch(() => {})
      .finally(() => { clearTimeout(timeout); if (active) setReady(true); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);
  async function apply(result: Result) {
    if (result.kind === 'CODE') { setEmail(result.email ?? ''); setRetryAt(Date.parse(result.retryAt ?? '') || 0); setStep('code'); setNotice('กรอกรหัสล่าสุดที่ได้รับทางอีเมล หรือขอรหัสใหม่เมื่อครบเวลา'); return; }
    if (result.kind === 'LOGIN') {
      const target = sanitizeNextPath(result.redirectPath) ?? '/';
      const redirectPath = result.legalAcceptanceRequired !== false ? legalAcceptancePath(target, result.companyId) : target;
      if (result.passwordChangeRequired) { rememberPendingRedirect({ companyId: result.companyId ?? null, redirectPath }); window.location.assign('/change-password'); }
      else window.location.assign(redirectPath);
      return;
    }
    if (result.kind === 'EXISTING_LOGIN_REQUIRED') { setStep('existing'); return; }
    if (result.kind === 'SIGNUP') { await apply(await call('status')); return; }
    if (result.kind === 'NEW') { setStep('signup'); return; }
    if (result.kind === 'STATUS') { setState(result.state ?? 'PENDING_REVIEW'); setStep('status'); }
  }
  async function run(work: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(apiErrorMessage(e)); }
    finally { running.current = false; setBusy(false); }
  }
  function send(resend = false) {
    void run(async () => {
      if (!key.current || resend) key.current = crypto.randomUUID();
      const result = await call('request', { email: email.trim(), requestKey: key.current, nextPath: sanitizeNextPath(new URLSearchParams(window.location.search).get('next')) });
      setRetryAt(Date.parse(result.retryAt ?? '') || Date.now() + 60_000); setCode(''); setStep('code');
      setNotice(result.deliveryStatus === 'ACCEPTED' ? 'ส่งรหัสแล้ว ถ้าไม่เจอ ดูในอีเมลขยะ' : ['READY', 'SENDING', 'UNKNOWN'].includes(result.deliveryStatus ?? '')
        ? 'ยังยืนยันไม่ได้ว่าส่งถึงแล้ว ถ้าได้รับรหัสแล้วกรอกได้เลย หรือรอขอรหัสใหม่' : 'ส่งรหัสไม่สำเร็จ ตรวจอีเมลแล้วขอรหัสใหม่');
    });
  }
  // Each step says where the person is in its own title: the page is the way in for someone who
  // has an account AND the way to open a shop for someone who has none, so no single sentence
  // about "signing in" is true on every step.
  const rejected = state === 'REJECTED' || state === 'SUSPENDED';
  const title = step === 'code' ? 'กรอกรหัสยืนยัน 6 หลัก' : step === 'signup' ? 'เปิดร้านใหม่'
    : step === 'status' ? (rejected ? 'ติดต่อทีมงานมั่งมีเรื่องคำขอของคุณ' : 'ทีมงานกำลังตรวจคำขอเปิดร้าน')
      : step === 'existing' ? 'อีเมลนี้เข้าด้วยรหัสยืนยันทางอีเมลไม่ได้' : t('auth.email_access.title', 'th');
  return <AuthFrame below={<BackToLoginLink />}>
    <h1 className={authTitleClass}>{title}</h1>
    {error && <Notice ref={alert} tabIndex={-1} tone="error" className="mt-4">{error}</Notice>}
    {step === 'email' && <form className="mt-5 space-y-4" noValidate onSubmit={e => {
      e.preventDefault();
      const value = email.trim();
      if (check({ ...(value ? looksLikeEmail(value) ? {} : { email: 'อีเมลต้องมี @ และชื่อเว็บ เช่น somchai@gmail.com' } : { email: 'กรอกอีเมล' }) }, { email: 'access-email' })) send();
    }}>
      <TextField id="access-email" label="อีเมล" type="email" inputMode="email" autoComplete="email" maxLength={254} required value={email} disabled={!ready || busy}
        hint={fieldErrors.email ? undefined : 'เราจะส่งรหัสยืนยัน 6 หลักไปที่อีเมลนี้'} error={fieldErrors.email}
        onChange={e => { setEmail(e.target.value); key.current = ''; clearField('email'); }} />
      <button className={`${primaryButtonClass} w-full`} disabled={!ready || busy || wait > 0} aria-busy={busy}>{!ready ? 'กำลังเตรียมหน้า…' : busy ? 'กำลังส่งรหัส…' : wait ? `ขอรหัสใหม่ได้ใน ${wait} วินาที` : 'ส่งรหัสยืนยัน'}</button>
    </form>}
    {step === 'code' && <form className="mt-3 space-y-4" noValidate onSubmit={e => {
      e.preventDefault();
      if (check({ ...(code.length === 6 ? {} : { code: 'กรอกรหัสให้ครบ 6 หลัก' }) }, { code: 'access-code' })) void run(async () => apply(await call('confirm', { code })));
    }}>
      <p className="text-[15px] leading-7 text-gray-700 [overflow-wrap:anywhere]">ส่งรหัสไปที่ <strong>{email}</strong></p>
      <p role="status" className="text-sm text-gray-600">{notice}</p>
      <TextField id="access-code" label="รหัสยืนยัน 6 หลัก" className="tracking-widest" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} disabled={!ready || busy}
        hint={fieldErrors.code ? undefined : 'รหัสใช้ได้ 10 นาที และใช้ได้กับเครื่องที่ขอรหัสเท่านั้น'} error={fieldErrors.code}
        onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); clearField('code'); }} />
      <button className={`${primaryButtonClass} w-full`} disabled={!ready || busy} aria-busy={busy}>{busy ? 'กำลังยืนยัน…' : 'ยืนยันรหัส'}</button>
      <ActionGroup>
        <button type="button" className={secondaryButtonClass} disabled={!ready || busy} onClick={() => { setStep('email'); key.current = ''; setFieldErrors({}); }}>แก้อีเมล</button>
        <button type="button" className={secondaryButtonClass} disabled={!ready || busy || wait > 0} aria-busy={busy} aria-describedby={wait ? 'access-resend-wait' : undefined} onClick={() => send(true)}>ขอรหัสใหม่</button>
      </ActionGroup>
      {/* The reason the button waits is said beside it; a countdown inside its name made the pair too wide to sit on one row. */}
      {wait > 0 && <p id="access-resend-wait" className="text-center text-sm text-gray-600 sm:text-right">ขอรหัสใหม่ได้ใน {wait} วินาที</p>}
    </form>}
    {step === 'signup' && <form className="mt-2 space-y-4" noValidate onSubmit={e => {
      e.preventDefault();
      const phone = phoneNumber.trim();
      // The same rule the server applies (10 digits from 0; it also takes +66 for the leading 0).
      const errors: FieldErrors = {
        ...(companyName.trim() ? {} : { companyName: 'กรอกชื่อร้าน' }),
        ...(displayName.trim() ? {} : { displayName: 'กรอกชื่อผู้ติดต่อ' }),
        ...(phone ? isThaiMobile(phone.replace(/^\+66/, '0')) ? {} : { phoneNumber: 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678' } : { phoneNumber: 'กรอกเบอร์มือถือ' }),
      };
      if (check(errors, { companyName: 'access-shop', displayName: 'access-name', phoneNumber: 'access-phone' })) void run(async () => apply(await call('signup', { companyName, displayName, phoneNumber, consentVersion: 'EMAIL_SIGNUP_V1' })));
    }}>
      {/* Owner 2026-09-20 (spec R1): no trial. Signing up opens the shop; it works once a package
          is paid for, so this promises the step, not an allowance the shop will not get. */}
      <p className="text-sm text-gray-600">เปิดร้านแล้วเลือกแพ็กเกจเพื่อเริ่มใช้งาน ไม่ต้องผูกบัตร</p>
      <TextField id="access-shop" label="ชื่อร้าน" required maxLength={120} autoComplete="organization" value={companyName} disabled={!ready || busy} error={fieldErrors.companyName} onChange={e => { setCompanyName(e.target.value); clearField('companyName'); }} />
      <TextField id="access-name" label="ชื่อผู้ติดต่อ" required maxLength={160} autoComplete="name" value={displayName} disabled={!ready || busy} error={fieldErrors.displayName} onChange={e => { setDisplayName(e.target.value); clearField('displayName'); }} />
      <TextField id="access-phone" label="เบอร์มือถือ" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" value={phoneNumber} disabled={!ready || busy} error={fieldErrors.phoneNumber} onChange={e => { setPhone(e.target.value); clearField('phoneNumber'); }} />
      <p className="text-sm leading-6 text-gray-600">เมื่อกดเปิดร้าน ถือว่าได้รับทราบ <Link className="underline" href="/terms" target="_blank">ข้อกำหนดการใช้งาน</Link> และ <Link className="underline" href="/privacy" target="_blank">ประกาศความเป็นส่วนตัว</Link> แล้ว โดยจะยืนยันการยอมรับเมื่อเข้าระบบครั้งแรก ทีมงานอาจตรวจคำขอก่อนเปิดร้าน</p>
      <button className={`${primaryButtonClass} w-full`} disabled={!ready || busy} aria-busy={busy}>{busy ? 'กำลังเปิดร้าน…' : 'เปิดร้าน'}</button>
    </form>}
    {step === 'status' && <div className="mt-2 space-y-4">
      <p className="text-[15px] leading-7 text-gray-600">{['PENDING_REVIEW', 'RECEIVED', 'VALIDATED', 'REJECTED'].includes(state) ? 'ร้านยังไม่เปิด กลับมาดูสถานะได้ด้วยอีเมลเดิม' : 'ระบบกำลังเปิดร้านจากคำขอเดิม กดตรวจสถานะอีกครั้ง ถ้ายังเข้าไม่ได้ ติดต่อทีมงานมั่งมี'}</p>
      <ActionGroup><button className={secondaryButtonClass} disabled={!ready || busy} aria-busy={busy} onClick={() => void run(async () => apply(await call('status')))}>ตรวจสถานะอีกครั้ง</button></ActionGroup>
    </div>}
    {step === 'existing' && <div className="mt-2 space-y-4">
      <p className="text-[15px] leading-7 text-gray-600">เข้าสู่ระบบด้วยรหัสผ่านหรือ LINE แทน</p>
      <Link className={`${primaryButtonClass} w-full`} href="/login">ไปหน้าเข้าสู่ระบบ</Link>
      <Link className={`${quietButtonClass} w-full`} href="/forgot-password">ลืมรหัสผ่าน</Link>
    </div>}
    <p className="mt-6 border-t border-gray-100 pt-4 text-sm leading-6 text-gray-600">ติดปัญหา ติดต่อทีมงานมั่งมี <a className="mangmee-unit font-semibold text-brand-700 underline" href="tel:0982565628">098-256-5628</a></p>
  </AuthFrame>;
}
