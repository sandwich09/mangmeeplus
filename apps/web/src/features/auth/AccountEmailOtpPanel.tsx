'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MangmeeBadge } from '@/common/components/mangmee';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { isLineInAppBrowser, withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { accountEmailOtpCommand, getAccountEmailOtp, type AccountEmailOtpState } from './account-email-otp.api';

const button = 'mangmee-btn mangmee-btn-secondary min-h-11';
const primaryButton = 'mangmee-btn mangmee-btn-primary min-h-11';
const field = 'mangmee-input mt-2 block min-h-11 w-full min-w-0';
export function AccountEmailOtpPanel({ onState, reauthReturnTo }: { onState?: (state: AccountEmailOtpState) => void; reauthReturnTo?: string }) {
  const id = useId(), callback = useRef(onState); callback.current = onState;
  const [state, setState] = useState<AccountEmailOtpState | null>(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editingLogin, setEditingLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false), [lineReauthUntil, setLineReauthUntil] = useState(0), [reauthNeeded, setReauthNeeded] = useState(false);
  const [editing, setEditing] = useState(false), [now, setNow] = useState(Date.now()), [rateLimitUntil, setRateLimitUntil] = useState(0);
  const [inLineBrowser, setInLineBrowser] = useState(false);
  const offset = useRef(0), previous = useRef(''), running = useRef(false), mounted = useRef(true), codeInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ fingerprint: string; key: string; revision: number } | null>(null);
  const apply = useCallback((next: AccountEmailOtpState) => {
    if (!mounted.current) return;
    offset.current = Date.parse(next.serverNow) - Date.now(); setNow(Date.parse(next.serverNow));
    setState(next);
    if (!previous.current) setEmail(next.challenge?.email || next.email || '');
    const fingerprint = JSON.stringify([next.emailRevision, next.emailRequirement, next.email, next.emailLoginEnabled]);
    if (previous.current !== fingerprint) { previous.current = fingerprint; callback.current?.(next); }
  }, []);
  const refresh = useCallback(async () => { const next = await getAccountEmailOtp(); apply(next); return next; }, [apply]);
  useEffect(() => {
    mounted.current = true;
    setInLineBrowser(isLineInAppBrowser(navigator.userAgent));
    void refresh().catch(e => { if (mounted.current) setError(apiErrorMessage(e)); });
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
      } catch { /* Editor restoration is optional; server reauthentication is unchanged. */ }
      setEditingLogin(loginIntent); setEditing(!loginIntent);
      if (line === 'email-reauthenticated') { setLineReauthUntil(Date.now() + 5 * 60_000); setNotice(loginIntent
        ? 'ยืนยันตัวตนผ่าน LINE แล้ว กดยืนยันเปลี่ยนวิธีเข้าสู่ระบบได้ภายใน 5 นาที'
        : 'ยืนยันตัวตนผ่าน LINE แล้ว กรอกอีเมลและขอรหัสได้ภายใน 5 นาที'); }
      else setError('ยังยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กดปุ่มยืนยันผ่าน LINE เพื่อลองใหม่');
    }
    if (line?.startsWith('email-reauth')) { const url = new URL(window.location.href); url.searchParams.delete('line'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const challenge = state?.challenge;
  const pending = challenge?.status === 'PENDING' && Date.parse(challenge.expiresAt) > now;
  const retrySeconds = Math.max(0, Math.ceil((Math.max(rateLimitUntil, challenge ? Date.parse(challenge.retryAt) : 0) - now) / 1000));
  const sameVerifiedEmail = Boolean(state?.emailVerified && email.trim().toLowerCase() === state.email?.trim().toLowerCase());
  const passwordRequired = Boolean(state?.hasPassword && Date.now() >= lineReauthUntil);
  useEffect(() => { if (pending) { setCode(''); codeInput.current?.focus(); } }, [challenge?.id]);
  async function run(work: () => Promise<AccountEmailOtpState>, success?: string) {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setNotice('');
    try { const next = await work(); apply(next); setPassword(''); setShowPassword(false); setReauthNeeded(false); request.current = null; if (next.challenge?.status === 'USED') setEditing(false); if (success) setNotice(success); if (success === 'บันทึกวิธีเข้าสู่ระบบแล้ว') setEditingLogin(false); }
    catch (e) {
      setError(apiErrorMessage(e));
      if (apiErrorCode(e) === 'EMAIL_REAUTH_REQUIRED') { setReauthNeeded(true); setLineReauthUntil(0); }
      const seconds = (e as { details?: { retryAfterSeconds?: number } })?.details?.retryAfterSeconds;
      if ((apiErrorCode(e) === 'EMAIL_OTP_RATE_LIMITED' || (e as { statusCode?: number }).statusCode === 429) && typeof seconds === 'number' && seconds > 0 && seconds <= 86400) setRateLimitUntil(Date.now() + offset.current + seconds * 1000);
      if (apiErrorCode(e)) request.current = null;
      await refresh().catch(() => {});
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function send(resend = false) {
    if (!state || running.current || retrySeconds > 0) return;
    if (!resend && sameVerifiedEmail) { setError('อีเมลนี้ยืนยันแล้ว หากต้องการเปลี่ยน กรุณากรอกอีเมลใหม่'); return; }
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
    try { window.sessionStorage.setItem(`email-login-editor:${path}`, editingLogin ? '1' : '0'); } catch { /* Navigation still works without browser storage. */ }
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
  const lineReauthButton = inLineBrowser
    ? <div className="space-y-2 rounded-xl bg-gray-50 p-3"><p className="text-sm text-gray-600">ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ใน Safari หรือ Chrome ก่อน</p><button type="button" className={button} onClick={reopenOutsideLine}>เปิดหน้านี้ใน Safari/Chrome</button></div>
    : <button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={reauthenticate}>ยืนยันตัวตนผ่าน LINE</button>;
  const passwordField = <div>
    <label className="block" htmlFor={`${id}-password`}>รหัสผ่านปัจจุบัน{state?.lineLinked && ' (หรือยืนยันตัวตนผ่าน LINE)'}</label>
    <div className="relative mt-2">
      <input id={`${id}-password`} className="mangmee-input block min-h-11 w-full min-w-0 pr-12" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} required={!pending && passwordRequired} disabled={busy} onChange={e => setPassword(e.target.value)} />
      <button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-gray-500 hover:text-gray-800" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m3 3 18 18" />}</svg>
      </button>
    </div>
  </div>;
  return <section className="mangmee-card min-w-0 space-y-5 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">อีเมลบัญชีของฉัน</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500">ใช้เข้าสู่ระบบด้วยรหัส OTP รับแจ้งเตือนบัญชี และเป็นอีเมลตั้งต้นของเอกสารการชำระเงิน</p>
      </div>
      {state?.emailRequirement === 'READY' && !editing && <button type="button" className={button} onClick={() => { setEmail(''); setPassword(''); setShowPassword(false); setError(''); setNotice(''); setEditingLogin(false); setEditing(true); }}>เปลี่ยนอีเมล</button>}
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
      <p className="min-w-0 break-all text-base font-semibold text-gray-900">{state?.email ?? 'ยังไม่ได้ผูกอีเมล'}</p>
      {state && <MangmeeBadge tone={state.emailVerified ? 'brand' : 'amber'}>{state.emailVerified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</MangmeeBadge>}
    </div>
    {(editing || pending) && <p className="text-sm leading-6 text-gray-500">{pending ? 'ขั้นตอน 2 จาก 2 · กรอกรหัสจากอีเมลใหม่เพื่อยืนยันการเปลี่ยน' : 'ขั้นตอน 1 จาก 2 · กรอกอีเมลใหม่และยืนยันตัวตน ระบบจะส่งรหัส OTP 6 หลักไปที่อีเมลใหม่'}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-800">{notice}</p>}
    {!state ? <button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(refresh)}>โหลดข้อมูลอีเมลอีกครั้ง</button> : <>
      {state.emailRequirement === 'CHANGE_PENDING' && <p className="rounded-xl bg-amber-50 p-3">กำลังรอยืนยันอีเมลใหม่ กรุณายืนยันหรือยกเลิกคำขอนี้ก่อน อีเมลเดิมยังคงอยู่</p>}
      {(state.emailRequirement !== 'READY' || editing) && <>
        {pending ? <form onSubmit={e => { e.preventDefault(); if (challenge) void run(() => accountEmailOtpCommand(`/${challenge.id}/confirm`, { code }), 'ยืนยันอีเมลเรียบร้อยแล้ว'); }} className="space-y-4">
          {reauthNeeded && <div className="space-y-3 rounded-xl bg-gray-50 p-4"><p>ยืนยันตัวตนอีกครั้งก่อนขอรหัสใหม่</p>{state.hasPassword && passwordField}{state.lineLinked && lineReauthButton}</div>}
          <p className="break-words">รหัสสำหรับ <strong>{challenge.email}</strong> · กรอกได้อีก {challenge.attemptsRemaining} ครั้ง</p>
          <p role="status">{challenge.delivered ? 'ระบบส่งถึงเซิร์ฟเวอร์อีเมลแล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม' : challenge.deliveryStatus === 'ACCEPTED' ? 'ผู้ให้บริการรับคำขอส่งแล้ว กรุณาตรวจกล่องจดหมายและสแปม' : ['READY', 'SENDING', 'UNKNOWN'].includes(challenge.deliveryStatus) ? 'ยังยืนยันผลการส่งไม่ได้ หากได้รับรหัสสามารถกรอกได้ หรือรอขอรหัสใหม่' : 'ส่งรหัสไม่สำเร็จ กรุณาตรวจอีเมลและขอรหัสใหม่ หรือยกเลิกคำขอนี้'}</p>
          <label className="block" htmlFor={`${id}-code`}>รหัสยืนยัน 6 หลัก<input ref={codeInput} id={`${id}-code`} className={`${field} tracking-widest`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} /></label>
          <p>รหัสใช้ได้อีก {Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 60_000))} นาที</p>
          <div className="flex flex-wrap gap-3"><button className={primaryButton} disabled={busy || code.length !== 6} aria-busy={Boolean(busy)}>ยืนยันอีเมล</button><button type="button" className={button} disabled={busy || retrySeconds > 0 || (reauthNeeded && passwordRequired && !password)} aria-busy={Boolean(busy)} onClick={() => send(true)}>{retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสใหม่'}</button><button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(() => accountEmailOtpCommand(`/${challenge.id}/cancel`, {}), 'ยกเลิกคำขอแล้ว อีเมลเดิมยังคงอยู่')}>ยกเลิกคำขอ / แก้อีเมล</button></div>
        </form> : <form onSubmit={e => { e.preventDefault(); send(); }} className="space-y-4">
          {challenge && challenge.status !== 'USED' && <p role="status">รหัสเดิมหมดอายุหรือใช้ไม่ได้แล้ว กรุณาขอรหัสใหม่</p>}
          {state.hasPassword && passwordField}
          {state.lineLinked && lineReauthButton}
          <label className="block" htmlFor={`${id}-email`}>อีเมลที่ต้องการยืนยัน<span className="text-red-600" aria-hidden="true"> *</span><input id={`${id}-email`} className={field} type="email" autoComplete="email" maxLength={254} value={email} required disabled={busy} onChange={e => { setEmail(e.target.value); request.current = null; }} /></label>
          {sameVerifiedEmail && <p role="status" className="text-sm text-gray-600">อีเมลนี้ยืนยันแล้ว หากต้องการเปลี่ยน กรุณากรอกอีเมลใหม่</p>}
          <button className={primaryButton} disabled={busy || !email.trim() || sameVerifiedEmail || (passwordRequired && !password) || retrySeconds > 0} aria-busy={Boolean(busy)}>{busy ? 'กำลังดำเนินการ…' : retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสยืนยัน'}</button>
        </form>}
      </>}
      {state.emailRequirement === 'READY' && editing && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(false); setPassword(''); setShowPassword(false); setError(''); setNotice(''); }}>ปิดการแก้ไข</button>}
      {state.emailRequirement === 'READY' && !editing && <div className="space-y-3 border-t border-gray-200 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">เข้าสู่ระบบด้วยรหัสทางอีเมล</h3>
            <p className="mt-1 text-sm text-gray-600">{state.emailLoginEnabled ? 'เปิดใช้งานอยู่' : 'ยังไม่เปิดใช้งาน'}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">เมื่อเปิดใช้งาน ระบบจะส่งรหัสยืนยันแบบใช้ครั้งเดียว (OTP) 6 หลักไปที่อีเมลของคุณทุกครั้งที่เข้าสู่ระบบ ใช้รหัสนี้แทนรหัสผ่าน</p>
          </div>
          {!editingLogin && <button type="button" className={button} onClick={() => { setPassword(''); setEditingLogin(true); }}>เปลี่ยนวิธีเข้าสู่ระบบ</button>}
        </div>
        {editingLogin && <form className="space-y-4 rounded-xl bg-gray-50 p-4" onSubmit={event => {
          event.preventDefault();
          void run(() => accountEmailOtpCommand('/login-method', { enabled: !state.emailLoginEnabled, ...(password ? { currentPassword: password } : {}) }), 'บันทึกวิธีเข้าสู่ระบบแล้ว');
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
      {!state.hasPassword && !state.emailLoginEnabled && <p className="text-gray-600">อีเมลที่ยืนยันแล้วไม่ใช่รหัสผ่าน หากต้องการเข้าเว็บโดยไม่ใช้ LINE ให้ตั้งชื่อผู้ใช้และรหัสผ่านสำรองในหน้าบัญชีของฉัน</p>}
    </>}
    <details className="group border-t border-gray-100 pt-4 text-sm text-gray-500" open={pending || Boolean(error)}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">ไม่ได้รับรหัสยืนยันทางอีเมล<svg aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></summary><p className="mt-2">ตรวจกล่องจดหมายขยะ หรือขอรหัสใหม่เมื่อครบเวลาที่ระบุ หากยังไม่ได้รับ ติดต่อทีมงาน 098-256-5628</p></details>
  </section>;
}
