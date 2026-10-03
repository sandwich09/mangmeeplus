'use client';
import Link from 'next/link';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { sanitizeNextPath } from '@/common/auth/middleware.logic';
import { legalAcceptancePath } from '@/common/auth/session-gate.logic';
import { rememberPendingRedirect } from './auth.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useEffect, useRef, useState } from 'react';
const field = 'mangmee-input mt-2 min-h-12 w-full min-w-0 text-base';
const button = 'mangmee-btn mangmee-btn-secondary min-h-12 text-base';
type Result = { companyId?: string; passwordChangeRequired?: boolean; legalAcceptanceRequired?: boolean; email?: string; kind?: string; state?: string; message?: string; code?: string; redirectPath?: string;
  deliveryStatus?: string; retryAt?: string; retryAfterSeconds?: number };
export default function EmailAccessPage() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [step, setStep] = useState('email');
  const [companyName, setCompanyName] = useState(''), [displayName, setDisplayName] = useState(''), [phoneNumber, setPhone] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), [state, setState] = useState(''), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const running = useRef(false), key = useRef(''), otp = useRef<HTMLInputElement>(null), alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (step === 'code') otp.current?.focus(); }, [step]);
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
      setNotice(result.deliveryStatus === 'ACCEPTED' ? 'ส่งรหัสแล้ว กรุณาตรวจกล่องจดหมายและสแปม' : ['READY', 'SENDING', 'UNKNOWN'].includes(result.deliveryStatus ?? '')
        ? 'ยังยืนยันผลส่งไม่ได้ หากได้รับรหัสสามารถกรอกได้ หรือรอขอรหัสใหม่' : 'ยังส่งรหัสไม่สำเร็จ กรุณาตรวจอีเมลแล้วขอรหัสใหม่');
    });
  }
  return <main className="min-h-dvh bg-gray-50 px-4 py-8 text-gray-900"><section className="mangmee-card mx-auto max-w-md space-y-5 p-5 sm:p-8">
    <Link href="/login" className="inline-block py-2 text-brand-700">← กลับหน้าเข้าสู่ระบบ</Link>
    <h1 className="text-2xl font-bold">{t('auth.email_access.title', 'th')}</h1>
    <p className="text-base leading-7 text-gray-600">กรอกอีเมลเพื่อรับรหัสยืนยันแบบใช้ครั้งเดียว 6 หลัก แล้วนำรหัสมากรอกในขั้นตอนถัดไป</p>
    {error && <p ref={alert} tabIndex={-1} role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {step === 'email' && <form className="space-y-5" onSubmit={e => { e.preventDefault(); send(); }}>
      <label className="block" htmlFor="access-email">อีเมลของคุณ<input id="access-email" className={field} type="email" autoComplete="email" maxLength={254} required value={email} disabled={!ready || busy} onChange={e => { setEmail(e.target.value); key.current = ''; }} /></label>
      <button className="mangmee-btn mangmee-btn-primary min-h-12 w-full text-base" disabled={!ready || busy || wait > 0} aria-busy={busy}>{!ready ? 'กำลังเตรียมหน้า…' : busy ? 'กำลังส่งรหัส…' : wait ? `ขอรหัสใหม่ได้ใน ${wait} วินาที` : 'ส่งรหัสยืนยัน ไปที่อีเมล'}</button>
    </form>}
    {step === 'code' && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => apply(await call('confirm', { code }))); }}>
      <p className="break-words">อีเมล <strong>{email}</strong></p><p role="status" className="text-gray-600">{notice}</p>
      <label className="block" htmlFor="access-code">รหัส 6 หลัก<input id="access-code" ref={otp} className={`${field} tracking-widest`} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required value={code} disabled={!ready || busy} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} /></label>
      <p className="text-gray-600">รหัสใช้ได้ 10 นาที หากเปิดเว็บอีกอุปกรณ์ ให้ขอรหัสจากอุปกรณ์นั้น</p>
      <button className="mangmee-btn mangmee-btn-primary min-h-12 w-full text-base" disabled={!ready || busy || code.length !== 6} aria-busy={busy}>{busy ? 'กำลังยืนยัน…' : 'ยืนยันและดำเนินการต่อ'}</button>
      <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={!ready || busy || wait > 0} aria-busy={busy} onClick={() => send(true)}>{wait ? `ขอใหม่ใน ${wait} วินาที` : 'ขอรหัสใหม่'}</button><button type="button" className={button} disabled={!ready || busy} onClick={() => { setStep('email'); key.current = ''; }}>แก้อีเมล</button></div>
    </form>}
    {step === 'signup' && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => apply(await call('signup', { companyName, displayName, phoneNumber, consentVersion: 'EMAIL_SIGNUP_V1' }))); }}>
      {/* Owner 2026-09-20 (spec R1): no trial. Signing up opens the shop; it works once a package
          is paid for, so this promises the step, not an allowance the shop will not get. */}
      <h2 className="text-xl font-semibold">เริ่มต้นร้านของคุณ</h2><p>เปิดร้านแล้วเลือกแพ็กเกจเพื่อเริ่มใช้งาน · ไม่ผูกบัตร</p>
      <label className="block" htmlFor="access-shop">ชื่อร้าน<input id="access-shop" className={field} required maxLength={120} autoComplete="organization" value={companyName} disabled={!ready || busy} onChange={e => setCompanyName(e.target.value)} /></label>
      <label className="block" htmlFor="access-name">ชื่อผู้ติดต่อ<input id="access-name" className={field} required maxLength={160} autoComplete="name" value={displayName} disabled={!ready || busy} onChange={e => setDisplayName(e.target.value)} /></label>
      <label className="block" htmlFor="access-phone">เบอร์มือถือ<input id="access-phone" className={field} type="tel" required maxLength={20} autoComplete="tel" value={phoneNumber} disabled={!ready || busy} onChange={e => setPhone(e.target.value)} /></label>
      <p className="text-sm leading-6 text-gray-600">เมื่อกดเปิดร้าน ถือว่าได้รับทราบ <Link className="underline" href="/terms" target="_blank">ข้อกำหนดการใช้งาน</Link> และ <Link className="underline" href="/privacy" target="_blank">ประกาศความเป็นส่วนตัว</Link> แล้ว โดยจะยืนยันการยอมรับเมื่อเข้าระบบครั้งแรก ทีมงานอาจตรวจคำขอก่อนเปิดร้าน</p>
      <button className="mangmee-btn mangmee-btn-primary min-h-12 w-full text-base" disabled={!ready || busy} aria-busy={busy}>{busy ? 'กำลังเปิดร้าน…' : 'เปิดร้าน'}</button>
    </form>}
    {step === 'status' && <div className="space-y-4"><h2 className="text-xl font-semibold">{state === 'REJECTED' || state === 'SUSPENDED' ? 'กรุณาติดต่อทีมงานเรื่องคำขอของคุณ' : 'ทีมงานกำลังตรวจคำขอของคุณ'}</h2><p>{['PENDING_REVIEW', 'RECEIVED', 'VALIDATED', 'REJECTED'].includes(state) ? 'ร้านยังไม่เปิด กลับมาตรวจสถานะได้ด้วยอีเมลเดิม' :'กำลังดำเนินการกับคำขอเดิม กรุณากดตรวจสถานะอีกครั้ง หากยังเข้าไม่ได้ให้ติดต่อทีมงาน'}</p><button className={button} disabled={!ready || busy} aria-busy={busy} onClick={() => void run(async () => apply(await call('status')))}>ตรวจสถานะอีกครั้ง</button></div>}
    {step === 'existing' && <div className="space-y-4"><h2 className="text-xl font-semibold">ยืนยันอีเมลสำเร็จแล้ว แต่บัญชีนี้เข้าสู่ระบบด้วยรหัสยืนยันทางอีเมลไม่ได้</h2><p>กรุณาเข้าสู่ระบบด้วยรหัสผ่านหรือ LINE เดิม หากยังเข้าไม่ได้ให้ติดต่อทีมงาน</p><Link className={`${button} block text-center`} href="/login">เข้าสู่ระบบด้วยรหัสผ่านหรือ LINE</Link><Link className="block py-2 text-brand-700" href="/forgot-password">ลืมรหัสผ่าน</Link></div>}
    <p className="text-sm leading-6 text-gray-600">ติดปัญหา ติดต่อทีมงาน <a className="underline" href="tel:0982565628">098-256-5628</a></p>
  </section></main>;
}
