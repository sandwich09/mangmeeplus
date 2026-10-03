'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MangmeeBadge } from '@/common/components/mangmee';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { isLineInAppBrowser, withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { accountEmailOtpCommand, getAccountEmailOtp, type AccountEmailOtpState } from './account-email-otp.api';

const button = 'mangmee-btn mangmee-btn-secondary min-h-11';
const primaryButton = 'mangmee-btn mangmee-btn-primary min-h-11';
const field = 'mangmee-input mt-2 block min-h-11 w-full min-w-0';
const sameEmailMessage = 'อีเมลนี้ยืนยันแล้ว หากต้องการเปลี่ยน กรุณากรอกอีเมลใหม่';
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
      else setError('ยังยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กดปุ่มยืนยันผ่าน LINE เพื่อลองใหม่');
    }
    if (line?.startsWith('email-reauth')) { const url = new URL(window.location.href); url.searchParams.delete('line'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  // Reuse the containing page's account read; do not remount and lose the editor draft.
  useEffect(() => {
    void refresh().catch(e => { if (mounted.current) setError(apiErrorMessage(e)); });
  }, [refresh, refreshKey]);
  const challenge = state?.challenge;
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
  async function run(work: () => Promise<AccountEmailOtpState>, success?: string) {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setNotice('');
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
      const next = await run(() => accountEmailOtpCommand(`/${challenge.id}/cancel`, {}), 'ยกเลิกรหัสเดิมแล้ว แก้อีเมลและขอรหัสใหม่ได้');
      if (!next || next.challenge?.status === 'PENDING') return;
      setEmail(challenge.email); setEditing(true); setCode('');
    } else { setError(''); setNotice(''); }
    setStep('email');
  }
  function send(resend = false) {
    if (!state || running.current || retrySeconds > 0) return;
    if (!resend && sameVerifiedEmail) { setError(sameEmailMessage); return; }
    if ((!resend || reauthNeeded) && passwordRequired && !password) { setError('กรุณากรอกรหัสผ่านปัจจุบันก่อนขอรหัสยืนยัน'); return; }
    const target = (resend ? challenge?.email ?? email : email).trim().toLowerCase();
    const fingerprint = target;
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID(), revision: state.emailRevision };
    const body = { newEmail: target, requestKey: request.current.key, expectedEmailRevision: request.current.revision, ...(password ? { currentPassword: password } : {}) };
    void run(() => accountEmailOtpCommand(resend && challenge ? `/${challenge.id}/resend` : '/request', body));
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
  const passwordField = <div>
    <label className="block" htmlFor={`${id}-password`}>รหัสผ่านปัจจุบัน</label>
    <div className="relative mt-2">
      <input id={`${id}-password`} className="mangmee-input block min-h-11 w-full min-w-0 pr-12" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} required={!pending && passwordRequired} disabled={busy} onChange={e => setPassword(e.target.value)} />
      <button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-gray-500 hover:text-gray-800" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m3 3 18 18" />}</svg>
      </button>
    </div>
  </div>;
  const lineReauthButton = <div className="space-y-4">
    {state?.hasPassword && <div className="flex items-center gap-3 text-sm text-gray-500"><span className="h-px flex-1 bg-gray-200" /><span>หรือ</span><span className="h-px flex-1 bg-gray-200" /></div>}
    {inLineBrowser
      ? <div className="space-y-2 rounded-xl bg-gray-50 p-3"><p className="text-sm text-gray-600">ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ในเบราว์เซอร์ภายนอกก่อน</p><button type="button" className={`${button} w-full justify-center`} disabled={busy} aria-busy={busy} onClick={reopenOutsideLine}>เปิดหน้านี้ในเบราว์เซอร์ภายนอก</button></div>
      : <button type="button" className={`${button} w-full justify-center`} disabled={busy} aria-busy={busy} onClick={reauthenticate}>ยืนยันตัวตนผ่าน LINE</button>}
  </div>;
  return <section className="mangmee-card min-w-0 space-y-5 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">อีเมลบัญชีของฉัน</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500">ยืนยันอีเมลเพื่อใช้กับบัญชีของคุณ · อีเมลรับเอกสารจัดการแยกที่หน้าแพ็กเกจ</p>
      </div>
      {state?.emailRequirement === 'READY' && !editing && <button type="button" className={button} onClick={() => { setEmail(''); setPassword(''); setShowPassword(false); setError(''); setNotice(''); setEditingLogin(false); setStep('email'); setEditing(true); }}>เปลี่ยนอีเมล</button>}
      {state?.emailRequirement === 'READY' && editing && <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="ปิดการแก้ไข" title="ปิดการแก้ไข" disabled={busy} onClick={() => { setEditing(false); setPassword(''); setShowPassword(false); setError(''); setNotice(''); }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>}
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
      {state && <p className="min-w-0 break-all text-base font-semibold text-gray-900">{state.email ?? 'ยังไม่ได้ผูกอีเมล'}</p>}
      {state && <MangmeeBadge tone={state.emailVerified ? 'brand' : 'amber'}>{state.emailVerified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</MangmeeBadge>}
    </div>
    {editingEmail && <div className="max-w-2xl space-y-5">
      <ol aria-label="ขั้นตอนการยืนยันอีเมล" className="grid grid-cols-3 gap-2">
        {steps.map((label, index) => <li key={label} aria-current={currentStep === index + 1 ? 'step' : undefined} className={`flex min-w-0 flex-col gap-2 border-t-2 pt-3 text-sm ${currentStep >= index + 1 ? 'border-green-600 text-green-800' : 'border-gray-200 text-gray-500'}`}>
          <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full font-semibold ${currentStep === index + 1 ? 'bg-green-700 text-white' : 'bg-gray-100'}`}>{index + 1}</span>
          <span className={currentStep === index + 1 ? 'font-semibold' : ''}>{label}</span>
        </li>)}
      </ol>
      <h3 ref={stepHeading} tabIndex={-1} className="text-base font-semibold text-gray-900 outline-none">ขั้นตอน {currentStep} จาก 3 · {steps[currentStep - 1]}</h3>
    </div>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-800">{notice}</p>}
    {!state ? <button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(refresh)}>โหลดข้อมูลอีเมลอีกครั้ง</button> : <>
      {state.emailRequirement === 'CHANGE_PENDING' && <p className="rounded-xl bg-amber-50 p-3">กำลังรอยืนยันอีเมลใหม่ กรุณายืนยันหรือยกเลิกคำขอนี้ก่อน อีเมลเดิมยังคงอยู่</p>}
      {editingEmail && <>
        {pending ? <form onSubmit={e => { e.preventDefault(); if (challenge) void run(() => accountEmailOtpCommand(`/${challenge.id}/confirm`, { code }), 'ยืนยันอีเมลเรียบร้อยแล้ว'); }} className="max-w-2xl space-y-4">
          {reauthNeeded && <div className="space-y-3 rounded-xl bg-gray-50 p-4"><p>ยืนยันตัวตนอีกครั้งก่อนขอรหัสใหม่</p>{state.hasPassword && passwordField}{state.lineLinked && lineReauthButton}</div>}
          <p className="break-words">รหัสสำหรับ <strong>{challenge.email}</strong> · กรอกได้อีก {challenge.attemptsRemaining} ครั้ง</p>
          <p role="status">{challenge.delivered ? 'ระบบส่งถึงเซิร์ฟเวอร์อีเมลแล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม' : challenge.deliveryStatus === 'ACCEPTED' ? 'ผู้ให้บริการรับคำขอส่งแล้ว กรุณาตรวจกล่องจดหมายและสแปม' : ['READY', 'SENDING', 'UNKNOWN'].includes(challenge.deliveryStatus) ? 'ยังยืนยันผลการส่งไม่ได้ หากได้รับรหัสสามารถกรอกได้ หรือรอขอรหัสใหม่' : 'ส่งรหัสไม่สำเร็จ กรุณาตรวจอีเมลและขอรหัสใหม่ หรือยกเลิกคำขอนี้'}</p>
          <label className="block" htmlFor={`${id}-code`}>รหัสยืนยัน 6 หลัก<input ref={codeInput} id={`${id}-code`} className={`${field} tracking-widest`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} /></label>
          <p>รหัสใช้ได้อีก {Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 60_000))} นาที</p>
          <button type="button" className={button} disabled={busy || retrySeconds > 0 || (reauthNeeded && passwordRequired && !password)} aria-busy={Boolean(busy)} onClick={() => send(true)}>{retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสใหม่'}</button>
          <p className="text-sm text-gray-500">หากต้องการแก้อีเมล กดย้อนกลับเพื่อยกเลิกคำขอและรหัสเดิม</p>
          <div className="flex flex-wrap justify-between gap-3"><button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void backToEmail()}>ย้อนกลับ</button><button className={primaryButton} disabled={busy || code.length !== 6} aria-busy={Boolean(busy)}>ยืนยันอีเมล</button></div>
        </form> : step === 'email' ? <form onSubmit={e => { e.preventDefault(); if (!busy && email.trim() && !sameVerifiedEmail) { setError(''); setNotice(''); setStep('identity'); } }} className="max-w-2xl space-y-4">
          <p className="text-sm text-gray-600">กรอกอีเมลที่ต้องการใช้ แล้วกดถัดไปเพื่อยืนยันตัวตน</p>
          <label className="block" htmlFor={`${id}-email`}>อีเมลที่ต้องการยืนยัน<span className="text-red-600" aria-hidden="true"> *</span><input id={`${id}-email`} className={field} type="email" autoComplete="email" maxLength={254} value={email} required disabled={busy} onChange={e => { setEmail(e.target.value); request.current = null; }} /></label>
          {sameVerifiedEmail && <p role="status" className="text-sm text-gray-600">{sameEmailMessage}</p>}
          <div className="flex justify-end"><button className={primaryButton} disabled={busy || !email.trim() || sameVerifiedEmail} aria-busy={busy}>ถัดไป</button></div>
        </form> : <form onSubmit={e => { e.preventDefault(); send(); }} className="max-w-2xl space-y-4">
          <p className="break-words text-sm text-gray-600">ยืนยันตัวตนเพื่อส่งรหัสยืนยัน 6 หลักไปที่ <strong>{email}</strong></p>
          {challenge && challenge.status !== 'USED' && <p role="status">รหัสเดิมหมดอายุหรือใช้ไม่ได้แล้ว กรุณาขอรหัสใหม่</p>}
          {passwordRequired && passwordField}
          {state.lineLinked && Date.now() >= lineReauthUntil && lineReauthButton}
          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={() => void backToEmail()}>ย้อนกลับ</button>
            <button className={primaryButton} disabled={busy || !email.trim() || sameVerifiedEmail || (passwordRequired && !password) || retrySeconds > 0} aria-busy={Boolean(busy)}>{busy ? 'กำลังดำเนินการ…' : retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ถัดไป · ขอรหัสยืนยัน'}</button>
          </div>
        </form>}
      </>}
      {state.emailRequirement === 'READY' && !editing && <div className="space-y-3 border-t border-gray-200 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">เข้าสู่ระบบด้วยรหัสทางอีเมล</h3>
            <p className="mt-1 text-sm text-gray-600">{state.emailLoginEnabled ? 'เปิดใช้งานอยู่' : 'ยังไม่เปิดใช้งาน'}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">เมื่อเลือกเข้าสู่ระบบด้วยรหัสทางอีเมล ให้นำรหัสยืนยันแบบใช้ครั้งเดียว 6 หลักที่ได้รับมากรอกแทนรหัสผ่าน</p>
          </div>
          {!editingLogin && <button type="button" className={button} onClick={() => { setPassword(''); setEditingLogin(true); }}>เปลี่ยนวิธีเข้าสู่ระบบ</button>}
        </div>
        {editingLogin && <form className="space-y-4 rounded-xl bg-gray-50 p-4" onSubmit={event => {
          event.preventDefault();
          void run(() => accountEmailOtpCommand('/login-method', { enabled: !state.emailLoginEnabled, ...(password ? { currentPassword: password } : {}) }), loginSavedMessage);
        }}>
          <p className="text-sm text-gray-600">ยืนยันตัวตนก่อน{state.emailLoginEnabled ? 'ปิด' : 'เปิด'}การเข้าสู่ระบบด้วยอีเมล</p>
          {state.hasPassword && passwordField}
          {state.lineLinked && lineReauthButton}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primaryButton} disabled={busy || (passwordRequired && !password)} aria-busy={busy}>{state.emailLoginEnabled ? 'ยืนยันปิดการเข้าด้วยอีเมล' : 'ยืนยันเปิดการเข้าด้วยอีเมล'}</button>
            <button type="button" className={button} disabled={busy} onClick={() => { setEditingLogin(false); setPassword(''); }}>ยกเลิก</button>
          </div>
        </form>}
      </div>}
      {!state.hasPassword && !state.emailLoginEnabled && <p className="text-gray-600">หากต้องการใช้รหัสผ่านเข้าสู่ระบบ จัดการรหัสผ่านสำรองได้ในหน้าบัญชีของฉัน</p>}
    </>}
    <details className="group border-t border-gray-100 pt-4 text-sm text-gray-500" open={Boolean(error)}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">ไม่ได้รับรหัสยืนยันทางอีเมล<svg aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></summary><p className="mt-2">ตรวจกล่องจดหมายขยะ หรือขอรหัสใหม่เมื่อครบเวลาที่ระบุ หากยังไม่ได้รับ ติดต่อทีมงาน 098-256-5628</p></details>
  </section>;
}
