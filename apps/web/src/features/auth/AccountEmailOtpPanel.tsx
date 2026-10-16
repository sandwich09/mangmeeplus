'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Button, secondaryButtonClass } from '@/common/components/button';
import { FieldError } from '@/common/components/field/Field';
import { MangmeeBadge } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { isLineInAppBrowser, withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { accountEmailOtpCommand, getAccountEmailOtp, type AccountEmailOtpState } from './account-email-otp.api';

const field = 'mangmee-input mt-2 block w-full min-w-0';
const sameEmailMessage = 'อีเมลนี้ยืนยันแล้ว ถ้าจะเปลี่ยน ให้กรอกอีเมลอื่น';
// As loose as the sign-up form: the server decides whether the address is real.
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
type Doing = 'submit' | 'back' | 'resend';
const loginSavedMessage = 'บันทึกวิธีเข้าสู่ระบบแล้ว';
const steps = ['กรอกอีเมล', 'ยืนยันตัวตน', 'กรอกรหัสยืนยัน'];
export function AccountEmailOtpPanel({ onState, reauthReturnTo, refreshKey }: { refreshKey?: object | null; onState?: (state: AccountEmailOtpState) => void; reauthReturnTo?: string }) {
  const id = useId(), callback = useRef(onState); callback.current = onState;
  const [state, setState] = useState<AccountEmailOtpState | null>(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editingLogin, setEditingLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false), [lineReauthUntil, setLineReauthUntil] = useState(0), [reauthNeeded, setReauthNeeded] = useState(false);
  const [editing, setEditing] = useState(false), [now, setNow] = useState(Date.now()), [rateLimitUntil, setRateLimitUntil] = useState(0);
  const [inLineBrowser, setInLineBrowser] = useState(false);
  const [step, setStep] = useState<'email' | 'identity'>('email');
  // Said under the field in the page's own words; the browser's bubble speaks the browser's language.
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string; code?: string }>({});
  // Which button was pressed, so only that one shows it is working.
  const [doing, setDoing] = useState<Doing>('submit');
  const restoredEmail = useRef<string | null>(null), stepHeading = useRef<HTMLHeadingElement>(null);
  const offset = useRef(0), previous = useRef(''), running = useRef(false), mounted = useRef(true), codeInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ fingerprint: string; key: string; revision: number } | null>(null);
  const apply = useCallback((next: AccountEmailOtpState) => {
    if (!mounted.current) return;
    offset.current = Date.parse(next.serverNow) - Date.now(); setNow(Date.parse(next.serverNow));
    setState(next);
    if (!previous.current) setEmail(restoredEmail.current ?? next.challenge?.email ?? next.email ?? '');
    const fingerprint = JSON.stringify([next.emailRevision, next.emailRequirement, next.email, next.emailLoginEnabled]);
    if (previous.current !== fingerprint) { previous.current = fingerprint; callback.current?.(next); }
  }, []);
  const refresh = useCallback(async () => { const next = await getAccountEmailOtp(); apply(next); return next; }, [apply]);
  useEffect(() => {
    mounted.current = true;
    setInLineBrowser(isLineInAppBrowser(navigator.userAgent));
    const visible = () => { if (!running.current && document.visibilityState === 'visible') void refresh().catch(() => {}); };
    const poll = window.setInterval(visible, 15_000);
    const tick = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    const line = new URLSearchParams(window.location.search).get('line');
    if (line?.startsWith('email-reauth')) {
      let loginIntent = false;
      try {
        loginIntent = window.sessionStorage.getItem(`email-login-editor:${window.location.pathname}`) === '1';
        window.sessionStorage.removeItem(`email-login-editor:${window.location.pathname}`);
        restoredEmail.current = window.sessionStorage.getItem(`email-editor-draft:${window.location.pathname}`);
        window.sessionStorage.removeItem(`email-editor-draft:${window.location.pathname}`);
      } catch { /* Editor restoration is optional; server reauthentication is unchanged. */ }
      setEditingLogin(loginIntent); setEditing(!loginIntent);
      if (!loginIntent && restoredEmail.current) { setEmail(restoredEmail.current); setStep('identity'); }
      if (line === 'email-reauthenticated') { setLineReauthUntil(Date.now() + 5 * 60_000); setNotice(loginIntent
        ? 'ยืนยันตัวตนผ่าน LINE แล้ว กดยืนยันเปลี่ยนวิธีเข้าสู่ระบบได้ภายใน 5 นาที'
        : 'ยืนยันตัวตนผ่าน LINE แล้ว ขอรหัสยืนยันอีเมลได้ภายใน 5 นาที'); }
      else setError('ยังยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กดปุ่มยืนยันผ่าน LINE เพื่อลองอีกครั้ง');
    }
    if (line?.startsWith('email-reauth')) { const url = new URL(window.location.href); url.searchParams.delete('line'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  // Reuse the containing page's account read; do not remount and lose the editor draft.
  useEffect(() => {
    void refresh().catch(e => { if (mounted.current) setError(apiErrorMessage(e)); });
  }, [refresh, refreshKey]);
  const challenge = state?.challenge;
  const hasEmail = Boolean(state?.email?.trim());
  const pending = challenge?.status === 'PENDING' && Date.parse(challenge.expiresAt) > now;
  const retrySeconds = Math.max(0, Math.ceil((Math.max(rateLimitUntil, challenge ? Date.parse(challenge.retryAt) : 0) - now) / 1000));
  const sameVerifiedEmail = Boolean(state?.emailVerified && email.trim().toLowerCase() === state.email?.trim().toLowerCase());
  const passwordRequired = Boolean(state?.hasPassword && Date.now() >= lineReauthUntil);
  const currentStep = pending ? 3 : step === 'identity' ? 2 : 1;
  const editingEmail = Boolean(state && (state.emailRequirement !== 'READY' || editing));
  useEffect(() => { if (pending) { setCode(''); codeInput.current?.focus(); } }, [challenge?.id]);
  useEffect(() => {
    if (pending) codeInput.current?.focus();
    else if (editingEmail) stepHeading.current?.focus();
  }, [currentStep, editingEmail, pending]);
  async function run(work: () => Promise<AccountEmailOtpState>, success?: string, who: Doing = 'submit') {
    if (running.current) return; running.current = true; setDoing(who); setBusy(true); setError(''); setNotice(''); setFieldError({});
    try { const next = await work(); apply(next); setPassword(''); setShowPassword(false); setReauthNeeded(false); request.current = null; if (next.challenge?.status === 'USED') { setEditing(false); setStep('email'); } if (success) setNotice(success); if (success === loginSavedMessage) setEditingLogin(false); return next; }
    catch (e) {
      setError(apiErrorMessage(e));
      if (apiErrorCode(e) === 'EMAIL_REAUTH_REQUIRED') { setReauthNeeded(true); setLineReauthUntil(0); }
      const seconds = (e as { details?: { retryAfterSeconds?: number } })?.details?.retryAfterSeconds;
      if ((apiErrorCode(e) === 'EMAIL_OTP_RATE_LIMITED' || (e as { statusCode?: number }).statusCode === 429) && typeof seconds === 'number' && seconds > 0 && seconds <= 86400) setRateLimitUntil(Date.now() + offset.current + seconds * 1000);
      if (apiErrorCode(e)) request.current = null;
      await refresh().catch(() => {});
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function backToEmail() {
    if (pending && challenge) {
      const next = await run(() => accountEmailOtpCommand(`/${challenge.id}/cancel`, {}), 'ยกเลิกรหัสเดิมแล้ว แก้อีเมลและขอรหัสใหม่ได้', 'back');
      if (!next || next.challenge?.status === 'PENDING') return;
      setEmail(challenge.email); setEditing(true); setCode('');
    } else { setError(''); setNotice(''); setFieldError({}); }
    setStep('email');
  }
  function send(resend = false) {
    if (!state || running.current || retrySeconds > 0) return;
    if (!resend && sameVerifiedEmail) { setError(sameEmailMessage); return; }
    if ((!resend || reauthNeeded) && passwordRequired && !password) { setError(''); setFieldError({ password: 'กรอกรหัสผ่านปัจจุบัน' }); document.getElementById(`${id}-password`)?.focus(); return; }
    const target = (resend ? challenge?.email ?? email : email).trim().toLowerCase();
    const fingerprint = target;
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID(), revision: state.emailRevision };
    const body = { newEmail: target, requestKey: request.current.key, expectedEmailRevision: request.current.revision, ...(password ? { currentPassword: password } : {}) };
    void run(() => accountEmailOtpCommand(resend && challenge ? `/${challenge.id}/resend` : '/request', body), undefined, resend ? 'resend' : 'submit');
  }
  function reauthenticate() {
    const path = window.location.pathname;
    const returnTo = reauthReturnTo ?? `${path}#account`;
    try {
      window.sessionStorage.setItem(`email-login-editor:${path}`, editingLogin ? '1' : '0');
      if (!editingLogin) window.sessionStorage.setItem(`email-editor-draft:${path}`, email);
    } catch { /* Navigation still works without browser storage. */ }
    window.location.assign(`/api/auth/line-login/start?purpose=email-reauth&returnTo=${encodeURIComponent(returnTo)}`);
  }
  // R-B4 (purchase-without-setup §18.2 / RV23): the LINE round trip cannot finish inside LINE's own
  // browser (the transaction cookie is set there, the callback lands in Safari/Chrome with no
  // session and no `next`). Reopen this page outside first; `channel=line` makes /login start LINE
  // login by itself when the outside browser has no session yet (R-B5).
  function reopenOutsideLine() {
    const url = new URL(window.location.href);
    url.searchParams.set('channel', 'line');
    window.location.assign(withLineExternalBrowser(url.pathname + url.search + url.hash, navigator.userAgent));
  }
  const working = (who: Doing) => busy && doing === who;
  const passwordField = <div>
    <label className="block" htmlFor={`${id}-password`}>รหัสผ่านปัจจุบัน</label>
    <div className="relative mt-2">
      <input id={`${id}-password`} className="mangmee-input mangmee-input-icon-end block w-full min-w-0" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} required={!pending && passwordRequired} disabled={busy} aria-invalid={Boolean(fieldError.password)} aria-describedby={fieldError.password ? `${id}-password-error` : undefined} onChange={e => { setPassword(e.target.value); if (fieldError.password) setFieldError({}); }} />
      <button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-gray-500 hover:text-gray-800" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m3 3 18 18" />}</svg>
      </button>
    </div>
    {fieldError.password && <div className="mt-1"><FieldError id={`${id}-password-error`}>{fieldError.password}</FieldError></div>}
  </div>;
  const lineReauthButton = <div className="space-y-4">
    {state?.hasPassword && <div className="flex items-center gap-3 text-sm text-gray-500"><span className="h-px flex-1 bg-gray-200" /><span>หรือ</span><span className="h-px flex-1 bg-gray-200" /></div>}
    {inLineBrowser
      ? <div className="space-y-2 rounded-xl bg-gray-50 p-3"><p className="text-sm text-gray-600">ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ เปิดหน้านี้ในเบราว์เซอร์ภายนอกก่อน</p><button type="button" className={`${secondaryButtonClass} w-full`} disabled={busy} aria-busy={busy} onClick={reopenOutsideLine}>เปิดหน้านี้ในเบราว์เซอร์ภายนอก</button></div>
      : <button type="button" className={`${secondaryButtonClass} w-full`} disabled={busy} aria-busy={busy} onClick={reauthenticate}>ยืนยันตัวตนผ่าน LINE</button>}
  </div>;
  return <section className="mangmee-card min-w-0 space-y-5 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">อีเมลบัญชีของฉัน</h2>
        {/* Kept on purpose (signup-optional-email-otp-billing spec): the shop's documents go to another address, managed elsewhere. */}
        <p className="mt-1 text-sm leading-6 text-gray-500">อีเมลรับเอกสารจัดการแยกที่หน้าแพ็กเกจ</p>
      </div>
      {state?.emailRequirement === 'READY' && !editing && <button type="button" className={`${secondaryButtonClass} shrink-0`} onClick={() => { setEmail(''); setPassword(''); setShowPassword(false); setError(''); setNotice(''); setFieldError({}); setEditingLogin(false); setStep('email'); setEditing(true); }}>เปลี่ยนอีเมล</button>}
      {state?.emailRequirement === 'READY' && editing && <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="ปิดการแก้ไข" title="ปิดการแก้ไข" disabled={busy} onClick={() => { setEditing(false); setPassword(''); setShowPassword(false); setError(''); setNotice(''); setFieldError({}); }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>}
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
      {state && <p className="min-w-0 break-all text-base font-semibold text-gray-900">{hasEmail ? state.email : 'ยังไม่ได้ผูกอีเมล'}</p>}
      {state && hasEmail && <MangmeeBadge tone={state.emailVerified ? 'brand' : 'amber'}>{state.emailVerified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</MangmeeBadge>}
    </div>
    {/* One caption says where the person is; it takes the focus when the step changes. No strip: three steps of one field each. */}
    {editingEmail && <h3 ref={stepHeading} tabIndex={-1} className="text-sm font-medium text-gray-500 outline-none">ขั้นตอน {currentStep} จาก 3 · {steps[currentStep - 1]}</h3>}
    {error && <Notice tone="error">{error}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {!state ? <Button type="button" variant="secondary" loading={busy} onClick={() => void run(refresh)}>โหลดข้อมูลอีเมลอีกครั้ง</Button> : <>
      {state.emailRequirement === 'CHANGE_PENDING' && <Notice tone="warning">กำลังรอยืนยันอีเมลใหม่ ยืนยันหรือยกเลิกคำขอนี้ก่อน{hasEmail && ' อีเมลเดิมยังคงอยู่'}</Notice>}
      {editingEmail && <>
        {pending ? <form noValidate onSubmit={e => {
          e.preventDefault();
          if (!challenge) return;
          if (code.length !== 6) { setError(''); setFieldError({ code: 'กรอกรหัสให้ครบ 6 หลัก' }); codeInput.current?.focus(); return; }
          void run(() => accountEmailOtpCommand(`/${challenge.id}/confirm`, { code }), 'ยืนยันอีเมลแล้ว');
        }} className="max-w-2xl space-y-4">
          {reauthNeeded && <div className="space-y-3 rounded-xl bg-gray-50 p-4"><p>ยืนยันตัวตนอีกครั้งก่อนขอรหัสใหม่</p>{state.hasPassword && passwordField}{state.lineLinked && lineReauthButton}</div>}
          <p className="break-words">รหัสสำหรับ <strong>{challenge.email}</strong> · กรอกได้อีก {challenge.attemptsRemaining} ครั้ง</p>
          <p role="status">{challenge.delivered ? 'ระบบส่งถึงเซิร์ฟเวอร์อีเมลแล้ว ดูในกล่องจดหมาย ถ้าไม่เจอ ดูในอีเมลขยะ' : challenge.deliveryStatus === 'ACCEPTED' ? 'ผู้ให้บริการรับคำขอส่งแล้ว ดูในกล่องจดหมาย ถ้าไม่เจอ ดูในอีเมลขยะ' : ['READY', 'SENDING', 'UNKNOWN'].includes(challenge.deliveryStatus) ? 'ยังยืนยันผลการส่งไม่ได้ ถ้าได้รับรหัสแล้วกรอกได้เลย หรือรอขอรหัสใหม่' : 'ส่งรหัสไม่สำเร็จ ตรวจอีเมลแล้วขอรหัสใหม่ หรือยกเลิกคำขอนี้'}</p>
          <div>
            <label className="block" htmlFor={`${id}-code`}>รหัสยืนยัน 6 หลัก<input ref={codeInput} id={`${id}-code`} className={`${field} tracking-widest`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} aria-invalid={Boolean(fieldError.code)} aria-describedby={fieldError.code ? `${id}-code-error` : undefined} onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); if (fieldError.code) setFieldError({}); }} /></label>
            {fieldError.code && <div className="mt-1"><FieldError id={`${id}-code-error`}>{fieldError.code}</FieldError></div>}
          </div>
          <p>รหัสใช้ได้อีก {Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 60_000))} นาที</p>
          <Button type="button" variant="secondary" loading={working('resend')} disabled={busy || retrySeconds > 0 || (reauthNeeded && passwordRequired && !password)} onClick={() => send(true)}>{retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสใหม่'}</Button>
          <p className="text-sm text-gray-500">กดกลับเพื่อแก้อีเมล คำขอและรหัสเดิมจะถูกยกเลิก</p>
          <ActionGroup>
            <Button type="button" variant="secondary" loading={working('back')} disabled={busy} onClick={() => void backToEmail()}>กลับ</Button>
            <Button type="submit" loading={working('submit')} disabled={busy}>ยืนยันอีเมล</Button>
          </ActionGroup>
        </form> : step === 'email' ? <form noValidate onSubmit={e => {
          e.preventDefault();
          if (busy || !email.trim() || sameVerifiedEmail) return;
          if (!looksLikeEmail(email.trim())) { setError(''); setFieldError({ email: 'อีเมลต้องมี @ และชื่อเว็บ เช่น somchai@gmail.com' }); document.getElementById(`${id}-email`)?.focus(); return; }
          setError(''); setNotice(''); setFieldError({}); setStep('identity');
        }} className="max-w-2xl space-y-4">
          <div>
            <label className="block" htmlFor={`${id}-email`}>อีเมล<span className="text-red-600" aria-hidden="true"> *</span><input id={`${id}-email`} className={field} type="email" autoComplete="email" maxLength={254} value={email} required disabled={busy} aria-invalid={Boolean(fieldError.email)} aria-describedby={fieldError.email ? `${id}-email-error` : undefined} onChange={e => { setEmail(e.target.value); request.current = null; if (fieldError.email) setFieldError({}); }} /></label>
            {fieldError.email && <div className="mt-1"><FieldError id={`${id}-email-error`}>{fieldError.email}</FieldError></div>}
          </div>
          {sameVerifiedEmail && <p role="status" className="text-sm text-gray-600">{sameEmailMessage}</p>}
          <ActionGroup><Button type="submit" loading={busy} disabled={!email.trim() || sameVerifiedEmail}>ถัดไป</Button></ActionGroup>
        </form> : <form noValidate onSubmit={e => { e.preventDefault(); send(); }} className="max-w-2xl space-y-4">
          <p className="break-words text-sm text-gray-600">ยืนยันว่าเป็นคุณ เพื่อส่งรหัส 6 หลักไปที่ <strong>{email}</strong></p>
          {challenge && challenge.status !== 'USED' && <p role="status">รหัสเดิมหมดอายุหรือใช้ไม่ได้แล้ว ขอรหัสใหม่ได้เลย</p>}
          {passwordRequired && passwordField}
          {state.lineLinked && Date.now() >= lineReauthUntil && lineReauthButton}
          {/* The acting button stays open: an empty password is answered under the field, not by a grey button. */}
          <ActionGroup>
            <Button type="button" variant="secondary" loading={working('back')} disabled={busy} onClick={() => void backToEmail()}>กลับ</Button>
            <Button type="submit" loading={working('submit')} disabled={busy || !email.trim() || sameVerifiedEmail || retrySeconds > 0}>{retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสยืนยัน'}</Button>
          </ActionGroup>
        </form>}
      </>}
      {state.emailRequirement === 'READY' && !editing && <div className="space-y-3 border-t border-gray-200 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">เข้าสู่ระบบด้วยรหัสทางอีเมล</h3>
            <p className="mt-1 text-sm text-gray-600">{state.emailLoginEnabled ? 'เปิดใช้งานอยู่' : 'ยังไม่เปิดใช้งาน'}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">เมื่อเลือกเข้าสู่ระบบด้วยรหัสทางอีเมล ให้นำรหัสยืนยันแบบใช้ครั้งเดียว 6 หลักที่ได้รับมากรอกแทนรหัสผ่าน</p>
          </div>
          {!editingLogin && <button type="button" className={secondaryButtonClass} onClick={() => { setPassword(''); setEditingLogin(true); }}>เปลี่ยนวิธีเข้าสู่ระบบ</button>}
        </div>
        {editingLogin && <form className="max-w-2xl space-y-4 rounded-xl bg-gray-50 p-4" onSubmit={event => {
          event.preventDefault();
          void run(() => accountEmailOtpCommand('/login-method', { enabled: !state.emailLoginEnabled, ...(password ? { currentPassword: password } : {}) }), loginSavedMessage);
        }}>
          <p className="text-sm text-gray-600">ยืนยันตัวตนก่อน{state.emailLoginEnabled ? 'ปิด' : 'เปิด'}การเข้าสู่ระบบด้วยอีเมล</p>
          {state.hasPassword && passwordField}
          {state.lineLinked && lineReauthButton}
          <ActionGroup>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => { setEditingLogin(false); setPassword(''); }}>ยกเลิก</button>
            <Button type="submit" loading={busy} disabled={busy || (passwordRequired && !password)}>{state.emailLoginEnabled ? 'ยืนยันปิดการเข้าด้วยอีเมล' : 'ยืนยันเปิดการเข้าด้วยอีเมล'}</Button>
          </ActionGroup>
        </form>}
      </div>}
      {!state.hasPassword && !state.emailLoginEnabled && <p className="text-gray-600">หากต้องการใช้รหัสผ่านเข้าสู่ระบบ จัดการรหัสผ่านสำรองได้ในหน้าบัญชีของฉัน</p>}
    </>}
    {(hasEmail || challenge?.email?.trim()) && <details className="group border-t border-gray-100 pt-4 text-sm text-gray-500" open={Boolean(error)}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">ไม่ได้รับรหัสยืนยันทางอีเมล<svg aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></summary><p className="mt-2">ดูในอีเมลขยะ หรือขอรหัสใหม่เมื่อครบเวลา หากยังไม่ได้รับ ติดต่อทีมงานมั่งมี <span className="mangmee-unit">098-256-5628</span></p></details>}
  </section>;
}
