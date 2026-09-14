'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TextField } from '@/common/components/field';
import { useLocale } from '@/common/i18n/use-locale';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { readEmailLinkToken, validatePasswordConfirmation } from './auth.logic';
import { confirmEmailPasswordReset } from './auth.api';

function Confirmation({token}:{token:string|null}){
  const [locale]=useLocale(),active=useRef(true),intent=useRef<string|null>(null);
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const [error,setError]=useState(''),[invalid,setInvalid]=useState(!token);
  const text=(th:string,en:string)=>locale==='th'?th:en;
  useEffect(()=>{active.current=true;return()=>{active.current=false;intent.current=null;};},[]);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!token||busy||done)return;
    const mismatch=validatePasswordConfirmation(password,confirmation);if(mismatch){setError(t(mismatch,locale));return;}
    intent.current??=password;setBusy(true);setError('');
    try{await confirmEmailPasswordReset(token,intent.current);if(active.current){setDone(true);setPassword('');setConfirmation('');intent.current=null;}}
    catch(failure){if(active.current){const e=failure as {code?:string;statusCode?:number};
      if(e.code==='email_reset_invalid'||e.statusCode===403){setInvalid(true);intent.current=null;}
      else if(e.code==='password_reuse'){intent.current=null;setError(text('ใช้รหัสผ่านใหม่ที่ต่างจากรหัสเดิม','Choose a password different from the current one.'));}
      else if(e.statusCode===400){setInvalid(true);intent.current=null;}
      else {setError(text('ยังยืนยันผลไม่ได้ ลองบันทึกอีกครั้งด้วยรหัสเดิมที่เพิ่งกรอก หรือเข้าสู่ระบบด้วยรหัสใหม่นี้','The result is not confirmed. Retry with the password you just entered, or try signing in with it.'));}
    }}finally{if(active.current)setBusy(false);}
  };
  return <main className="mx-auto my-8 w-full max-w-md space-y-5 rounded-xl border bg-white p-6 text-base [&_label]:text-base [&_label_button]:min-h-11 [&_label_button]:min-w-11">
    <h1 className="text-2xl font-bold">{done?text('ตั้งรหัสผ่านใหม่สำเร็จ','Password changed'):t('auth.reset.title',locale)}</h1>
    {done?<p role="status">{text('ออกจากระบบทุกอุปกรณ์แล้ว ใช้รหัสผ่านใหม่เข้าสู่ระบบอีกครั้ง','You have been signed out on all devices. Sign in again with your new password.')}</p>:invalid?
      <p role="alert">{text('ลิงก์นี้ใช้ไม่ได้ หมดอายุ หรือข้อมูลบัญชีเปลี่ยน กรุณาขอลิงก์ใหม่','This link is invalid, expired, or your account changed. Request a new link.')}</p>:<>
      <p>{text('ตั้งรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร เมื่อบันทึกแล้ว ระบบจะออกจากระบบทุกอุปกรณ์','Use at least 8 characters. Saving signs you out on all devices.')}</p>
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
      <form onSubmit={event=>void submit(event)} className="space-y-4">
        <TextField className="sm:h-11 sm:text-base" label={t('auth.reset.new_password',locale)} type="password" name="new-password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} disabled={busy||!!intent.current} onChange={event=>{setPassword(event.target.value);setError('');}}/>
        <TextField className="sm:h-11 sm:text-base" label={t('auth.reset.confirm_password',locale)} type="password" name="confirm-password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={busy||!!intent.current} onChange={event=>{setConfirmation(event.target.value);setError('');}}/>
        <button className="min-h-11 w-full rounded-lg bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={busy}>{busy?text('กำลังบันทึก…','Saving…'):t('auth.reset.submit',locale)}</button>
      </form></>}
    <nav className="flex flex-wrap gap-4"><Link className="inline-flex min-h-11 items-center underline" href="/login">{t('auth.forgot.back_to_login',locale)}</Link>
      {!done&&<Link className="inline-flex min-h-11 items-center underline" href="/forgot-password">{text('ขอลิงก์กู้รหัสผ่านใหม่','Request a new reset link')}</Link>}</nav>
  </main>;
}
export default function ResetPasswordPage(){
  const params=useSearchParams(),[token,setToken]=useState<string|null>();
  useEffect(()=>{const read=()=>setToken(new URLSearchParams(window.location.search).has('token')?null:readEmailLinkToken('',window.location.hash));read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[params]);
  return <div className="min-h-dvh bg-gray-50 p-4">{token===undefined?<p role="status">กำลังเปิดหน้าตั้งรหัสผ่าน…</p>:<Confirmation key={token??'invalid'} token={token}/>}</div>;
}
