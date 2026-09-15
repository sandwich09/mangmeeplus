'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { accountEmailOtpCommand, getAccountEmailOtp, type AccountEmailOtpState } from './account-email-otp.api';

const button = 'min-h-11 rounded-xl border px-4 py-3 text-base font-semibold disabled:opacity-50';
const field = 'mt-2 block min-h-11 w-full min-w-0 rounded-xl border p-3 text-base';
export function AccountEmailOtpPanel({ onState, billing = false, billingInterval }: { onState?: (state: AccountEmailOtpState) => void; billing?: boolean; billingInterval?: 'month' | 'year' }) {
  const id = useId(), callback = useRef(onState); callback.current = onState;
  const [state, setState] = useState<AccountEmailOtpState | null>(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false), [now, setNow] = useState(Date.now()), [rateLimitUntil, setRateLimitUntil] = useState(0);
  const offset = useRef(0), previous = useRef(''), running = useRef(false), mounted = useRef(true), codeInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ fingerprint: string; key: string; revision: number } | null>(null);
  const apply = useCallback((next: AccountEmailOtpState) => {
    if (!mounted.current) return;
    offset.current = Date.parse(next.serverNow) - Date.now(); setNow(Date.parse(next.serverNow));
    setState(next);
    const fingerprint = JSON.stringify([next.emailRevision, next.emailRequirement, next.email]);
    if (previous.current !== fingerprint) { previous.current = fingerprint; callback.current?.(next); }
    setEmail(value => value || next.challenge?.email || next.email || '');
  }, []);
  const refresh = useCallback(async () => { const next = await getAccountEmailOtp(); apply(next); return next; }, [apply]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(e => { if (mounted.current) setError(apiErrorMessage(e)); });
    const visible = () => { if (document.visibilityState === 'visible') void refresh().catch(() => {}); };
    const poll = window.setInterval(visible, 15_000);
    const tick = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    const line = new URLSearchParams(window.location.search).get('line');
    if (line === 'email-reauthenticated') setNotice('ยืนยันตัวตนผ่าน LINE แล้ว กรอกอีเมลและขอรหัสได้ภายใน 5 นาที');
    else if (line?.startsWith('email-reauth-')) setError('ยังยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กดปุ่มยืนยันผ่าน LINE เพื่อลองใหม่');
    if (line?.startsWith('email-reauth')) { const url = new URL(window.location.href); url.searchParams.delete('line'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const challenge = state?.challenge;
  const pending = challenge?.status === 'PENDING' && Date.parse(challenge.expiresAt) > now;
  const retrySeconds = Math.max(0, Math.ceil((Math.max(rateLimitUntil, challenge ? Date.parse(challenge.retryAt) : 0) - now) / 1000));
  useEffect(() => { if (pending) { setCode(''); codeInput.current?.focus(); } }, [challenge?.id]);
  async function run(work: () => Promise<AccountEmailOtpState>, success?: string) {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setNotice('');
    try { const next = await work(); apply(next); setPassword(''); request.current = null; if (next.challenge?.status === 'USED') setEditing(false); if (success) setNotice(success); }
    catch (e) {
      setError(apiErrorMessage(e));
      const seconds = (e as { details?: { retryAfterSeconds?: number } })?.details?.retryAfterSeconds;
      if ((apiErrorCode(e) === 'EMAIL_OTP_RATE_LIMITED' || (e as { statusCode?: number }).statusCode === 429) && typeof seconds === 'number' && seconds > 0 && seconds <= 86400) setRateLimitUntil(Date.now() + offset.current + seconds * 1000);
      if (apiErrorCode(e)) request.current = null;
      await refresh().catch(() => {});
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function send(resend = false) {
    if (!state) return;
    const target = (resend ? challenge?.email ?? email : email).trim().toLowerCase();
    const fingerprint = target;
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID(), revision: state.emailRevision };
    const body = { newEmail: target, requestKey: request.current.key, expectedEmailRevision: request.current.revision, ...(password ? { currentPassword: password } : {}) };
    void run(() => accountEmailOtpCommand(resend && challenge ? `/${challenge.id}/resend` : '/request', body));
  }
  function reauthenticate() {
    const path = window.location.pathname;
    const interval = billingInterval ?? new URLSearchParams(window.location.search).get('interval');
    const returnTo = path + (billing && ['month', 'year'].includes(interval ?? '') ? `?interval=${interval}` : '');
    window.location.assign(`/api/auth/line-login/start?purpose=email-reauth&returnTo=${encodeURIComponent(returnTo)}`);
  }
  return <section className="min-w-0 space-y-4 rounded-2xl border bg-white p-4 sm:p-6" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-lg font-semibold">{billing ? 'ยืนยันอีเมลก่อนชำระเงิน' : 'อีเมลบัญชีของฉัน'}</h2>
    <p className="break-words text-base">อีเมลปัจจุบัน: <strong>{state?.email ?? 'ยังไม่ได้ผูกอีเมล'}</strong>{state?.emailVerified ? ' · ยืนยันแล้ว' : state ? ' · ยังไม่ยืนยัน' : ''}</p>
    <p className="text-base text-gray-600">ใช้รับเอกสารการชำระเงินและแจ้งเตือนบัญชี อีเมลใหม่จะใช้ได้เมื่อยืนยันรหัสสำเร็จ เอกสารเดิมของร้านคงผู้รับเดิม</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-800">{notice}</p>}
    {!state ? <button type="button" className={button} disabled={busy} onClick={() => void run(refresh)}>โหลดข้อมูลอีเมลอีกครั้ง</button> : <>
      {state.emailRequirement === 'CHANGE_PENDING' && <p className="rounded-xl bg-amber-50 p-3">กำลังรอยืนยันอีเมลใหม่ กรุณายืนยันหรือยกเลิกคำขอก่อนเริ่มชำระเงินใหม่ อีเมลเดิมยังคงอยู่</p>}
      {(state.emailRequirement !== 'READY' || editing) && <>
        {state.lineLinked && <div className="space-y-2"><p>ยืนยันตัวตนก่อนขอรหัส หากเพิ่งยืนยันแล้วสามารถขอรหัสได้ทันที</p><button type="button" className={button} disabled={busy} onClick={reauthenticate}>ยืนยันตัวตนผ่าน LINE</button></div>}
        {state.hasPassword && <label className="block" htmlFor={`${id}-password`}>รหัสผ่านปัจจุบัน (ใช้แทนการยืนยันผ่าน LINE ได้)<input id={`${id}-password`} className={field} type="password" autoComplete="current-password" maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>}
        {pending ? <form onSubmit={e => { e.preventDefault(); if (challenge) void run(() => accountEmailOtpCommand(`/${challenge.id}/confirm`, { code }), billing ? 'ยืนยันอีเมลแล้ว กรุณาตรวจสรุปและยืนยันการชำระเงินอีกครั้ง' : 'ยืนยันอีเมลเรียบร้อยแล้ว'); }} className="space-y-4">
          <p className="break-words">รหัสสำหรับ <strong>{challenge.email}</strong> · กรอกได้อีก {challenge.attemptsRemaining} ครั้ง</p>
          <p role="status">{challenge.delivered ? 'ระบบส่งถึงเซิร์ฟเวอร์อีเมลแล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม' : challenge.deliveryStatus === 'ACCEPTED' ? 'ผู้ให้บริการรับคำขอส่งแล้ว กรุณาตรวจกล่องจดหมายและสแปม' : ['READY', 'SENDING', 'UNKNOWN'].includes(challenge.deliveryStatus) ? 'ยังยืนยันผลการส่งไม่ได้ หากได้รับรหัสสามารถกรอกได้ หรือรอขอรหัสใหม่' : 'ส่งรหัสไม่สำเร็จ กรุณาตรวจอีเมลและขอรหัสใหม่ หรือยกเลิกคำขอนี้'}</p>
          <label className="block" htmlFor={`${id}-code`}>รหัสยืนยัน 6 หลัก<input ref={codeInput} id={`${id}-code`} className={`${field} tracking-widest`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} /></label>
          <p>รหัสใช้ได้อีก {Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 60_000))} นาที</p>
          <div className="flex flex-wrap gap-3"><button className={`${button} bg-green-600 text-white`} disabled={busy || code.length !== 6}>ยืนยันอีเมล</button><button type="button" className={button} disabled={busy || retrySeconds > 0} onClick={() => send(true)}>{retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสใหม่'}</button><button type="button" className={button} disabled={busy} onClick={() => void run(() => accountEmailOtpCommand(`/${challenge.id}/cancel`, {}), 'ยกเลิกคำขอแล้ว อีเมลเดิมยังคงอยู่')}>ยกเลิกคำขอ / แก้อีเมล</button></div>
        </form> : <form onSubmit={e => { e.preventDefault(); send(); }} className="space-y-4">
          {challenge && challenge.status !== 'USED' && <p role="status">รหัสเดิมหมดอายุหรือใช้ไม่ได้แล้ว กรุณาขอรหัสใหม่</p>}
          <label className="block" htmlFor={`${id}-email`}>อีเมลที่ต้องการยืนยัน<input id={`${id}-email`} className={field} type="email" autoComplete="email" maxLength={254} value={email} required disabled={busy} onChange={e => { setEmail(e.target.value); request.current = null; }} /></label>
          <button className={`${button} bg-green-600 text-white`} disabled={busy || !email.trim() || retrySeconds > 0}>{busy ? 'กำลังดำเนินการ…' : retrySeconds ? `ขอรหัสใหม่ได้ใน ${retrySeconds} วินาที` : 'ขอรหัสยืนยัน'}</button>
        </form>}
      </>}
      {state.emailRequirement === 'READY' && !editing && <button type="button" className={button} onClick={() => { setEmail(state.email ?? ''); setEditing(true); }}>เปลี่ยนอีเมล</button>}
      {state.emailRequirement === 'READY' && editing && <button type="button" className={button} disabled={busy} onClick={() => setEditing(false)}>ปิดการแก้ไข</button>}
      {!state.hasPassword && <p className="text-gray-600">อีเมลที่ยืนยันแล้วไม่ใช่รหัสผ่าน หากต้องการเข้าเว็บโดยไม่ใช้ LINE ให้ตั้งชื่อผู้ใช้และรหัสผ่านสำรองในหน้าบัญชีของฉัน</p>}
    </>}
    <p className="text-gray-600">หากยังรับรหัสไม่ได้ คุณยังใช้งานร้าน ดูเอกสารเดิม และยกเลิกต่ออายุได้ ติดต่อทีมงาน 098-256-5628</p>
  </section>;
}
