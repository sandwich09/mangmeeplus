'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, primaryButtonClass } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { useLocale } from '@/common/i18n/use-locale';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { readEmailLinkToken, validatePasswordConfirmation } from './auth.logic';
import { confirmEmailPasswordReset } from './auth.api';
import { AuthFrame, authTitleClass, BackToLoginLink } from './AuthFrame';

function Confirmation({token}:{token:string|null}){
  const [locale]=useLocale(),active=useRef(true),intent=useRef<string|null>(null);
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const [error,setError]=useState(''),[invalid,setInvalid]=useState(!token);
  // Said under the field it is about (the form is `noValidate`: the browser's own bubble speaks the browser's language).
  const [fieldErrors,setFieldErrors]=useState<{password?:string;confirmation?:string}>({});
  const text=(th:string,en:string)=>locale==='th'?th:en;
  useEffect(()=>{active.current=true;return()=>{active.current=false;intent.current=null;};},[]);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!token||busy||done)return;
    const mismatch=validatePasswordConfirmation(password,confirmation);
    const wrong={...(password.length<8?{password:t('auth.change.error.min',locale)}:{}),...(mismatch?{confirmation:t(mismatch,locale)}:{})};
    setFieldErrors(wrong);
    if(wrong.password||wrong.confirmation){setError('');document.getElementById(wrong.password?'new-password':'confirm-password')?.focus();return;}
    intent.current??=password;setBusy(true);setError('');
    try{await confirmEmailPasswordReset(token,intent.current);if(active.current){setDone(true);setPassword('');setConfirmation('');intent.current=null;}}
    catch(failure){if(active.current){const e=failure as {code?:string;statusCode?:number};
      if(e.code==='email_reset_invalid'||e.statusCode===403){setInvalid(true);intent.current=null;}
      else if(e.code==='password_reuse'){intent.current=null;setFieldErrors({password:text('ใช้รหัสผ่านใหม่ที่ต่างจากรหัสเดิม','Choose a password different from the current one.')});}
      else if(e.statusCode===400){setInvalid(true);intent.current=null;}
      else {setError(text('ยังยืนยันผลไม่ได้ ลองบันทึกอีกครั้งด้วยรหัสเดิมที่เพิ่งกรอก หรือเข้าสู่ระบบด้วยรหัสใหม่นี้','The result is not confirmed. Retry with the password you just entered, or try signing in with it.'));}
    }}finally{if(active.current)setBusy(false);}
  };
  // Three states, each with its one next step as a button (a refusal carries its way out: thai-ux-standard §1.6).
  if(done)return <AuthFrame>
    <h1 className={authTitleClass}>{text('ตั้งรหัสผ่านใหม่แล้ว','Password changed')}</h1>
    <p role="status" className="mt-2 text-[15px] leading-7 text-gray-600">{text('ทุกเครื่องออกจากระบบแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่','You have been signed out on all devices. Sign in with your new password.')}</p>
    <Link className={`${primaryButtonClass} mt-6 w-full`} href="/login">{text('เข้าสู่ระบบ','Sign in')}</Link>
  </AuthFrame>;
  if(invalid)return <AuthFrame below={<BackToLoginLink label={t('auth.forgot.back_to_login',locale)} />}>
    <h1 className={authTitleClass}>{text('ลิงก์นี้ใช้ไม่ได้แล้ว','This link no longer works')}</h1>
    <p role="alert" className="mt-2 text-[15px] leading-7 text-gray-600">{text('ลิงก์หมดอายุ ถูกใช้ไปแล้ว หรือข้อมูลบัญชีเปลี่ยน','The link expired, was already used, or your account changed.')}</p>
    <Link className={`${primaryButtonClass} mt-6 w-full`} href="/forgot-password">{text('ขอลิงก์ใหม่','Request a new link')}</Link>
  </AuthFrame>;
  return <AuthFrame below={<BackToLoginLink label={t('auth.forgot.back_to_login',locale)} />}>
    <h1 className={authTitleClass}>{t('auth.reset.title',locale)}</h1>
    <p className="mt-1 text-sm text-gray-600">{text('บันทึกแล้วทุกเครื่องจะออกจากระบบ','Saving signs you out on all devices.')}</p>
    {error&&<Notice tone="error" className="mt-4">{error}</Notice>}
    <form onSubmit={event=>void submit(event)} className="mt-5 space-y-4" noValidate>
      <TextField label={t('auth.reset.new_password',locale)} type="password" name="new-password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} disabled={busy||!!intent.current}
        hint={fieldErrors.password?undefined:t('auth.reset.hint_min',locale)} error={fieldErrors.password} onChange={event=>{setPassword(event.target.value);setError('');if(fieldErrors.password)setFieldErrors(prev=>({...prev,password:undefined}));}}/>
      <TextField label={t('auth.reset.confirm_password',locale)} type="password" name="confirm-password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={busy||!!intent.current}
        error={fieldErrors.confirmation} onChange={event=>{setConfirmation(event.target.value);setError('');if(fieldErrors.confirmation)setFieldErrors(prev=>({...prev,confirmation:undefined}));}}/>
      <Button type="submit" className="w-full" loading={busy}>{t('auth.reset.submit',locale)}</Button>
    </form>
  </AuthFrame>;
}
export default function ResetPasswordPage(){
  const params=useSearchParams(),[token,setToken]=useState<string|null>();
  useEffect(()=>{const read=()=>setToken(new URLSearchParams(window.location.search).has('token')?null:readEmailLinkToken('',window.location.hash));read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[params]);
  return token===undefined?<AuthFrame><p role="status" className="text-sm text-gray-600">กำลังเปิดหน้าตั้งรหัสผ่าน…</p></AuthFrame>:<Confirmation key={token??'invalid'} token={token}/>;
}
